-- Database tests for stock counting, slot capacity, order window and rate limits.
-- Runs inside a transaction and ROLLS BACK, so it is safe on a dev database.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/order_rules.sql
-- Prints "ALL DB TESTS PASSED" on success; raises an error on the first failure.

begin;

create function pg_temp.expect_error(p_sql text, p_expected text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm = p_expected then return; end if;
    raise exception 'expected error % but got: %', p_expected, sqlerrm;
  end;
  raise exception 'expected error % but the statement succeeded', p_expected;
end $$;

create function pg_temp.assert_eq(p_actual bigint, p_expected bigint, p_what text) returns void
language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'FAIL %: expected %, got %', p_what, p_expected, p_actual;
  end if;
end $$;

-- Fixtures: a far-future day so we never clash with real data.
create temp table fx as
with d as (
  insert into public.service_days (date, is_enabled, opens_at, closes_at)
  values ((now() at time zone 'Asia/Kolkata')::date + 400, true, now() - interval '1 hour', now() + interval '1 hour')
  returning id
),
s as (
  insert into public.slots (service_day_id, label, start_time, end_time, capacity)
  select d.id, 'T', time '12:00', time '13:00', 3 from d
  returning id, service_day_id
),
m1 as (insert into public.menu_items (slug, name, category, price_paise) values ('t-m1', 'T Mutton A', 'mutton', 3500) returning id),
m2 as (insert into public.menu_items (slug, name, category, price_paise) values ('t-m2', 'T Mutton B', 'mutton', 4000) returning id),
c1 as (insert into public.menu_items (slug, name, category, price_paise) values ('t-c1', 'T Chicken', 'chicken', 2500) returning id)
select d.id as day_id, s.id as slot_id, m1.id as m1, m2.id as m2, c1.id as c1 from d, s, m1, m2, c1;

insert into public.day_stock (service_day_id, category, stock_limit)
select day_id, 'mutton', 5 from fx union all select day_id, 'chicken', 1 from fx;

create function pg_temp.place(p_phone text, p_items jsonb) returns text
language sql as $$
  select order_no from public.place_order(
    (select day_id from fx), (select slot_id from fx), 'Test', p_phone, 'pickup', p_items)
$$;

create function pg_temp.items(p_m1 int, p_m2 int, p_c1 int) returns jsonb
language sql as $$
  select coalesce(jsonb_agg(x), '[]'::jsonb) from (
    select jsonb_build_object('menu_item_id', (select m1 from fx), 'quantity', p_m1) x where p_m1 > 0
    union all select jsonb_build_object('menu_item_id', (select m2 from fx), 'quantity', p_m2) where p_m2 > 0
    union all select jsonb_build_object('menu_item_id', (select c1 from fx), 'quantity', p_c1) where p_c1 > 0
  ) t
$$;

do $$
declare
  v_total int;
begin
  -- 1. Total is priced from the DB: 2×35 + 1×40 = ₹110
  perform pg_temp.place('9000000001', pg_temp.items(2, 1, 0));
  select total_paise into v_total from orders where customer_phone = '9000000001';
  perform pg_temp.assert_eq(v_total, 11000, 'server-side total');

  -- 2. Mutton dishes share one limit (5): 3 used, 2 more OK, 1 more is SOLD_OUT.
  perform pg_temp.expect_error($q$ select pg_temp.place('9000000002', pg_temp.items(1, 2, 0)) $q$, 'SOLD_OUT');
  perform pg_temp.place('9000000002', pg_temp.items(1, 1, 0));
  perform pg_temp.expect_error($q$ select pg_temp.place('9000000003', pg_temp.items(0, 1, 0)) $q$, 'SOLD_OUT');

  -- 3. Chicken has its own limit, untouched by mutton.
  perform pg_temp.expect_error($q$ select pg_temp.place('9000000003', pg_temp.items(0, 0, 2)) $q$, 'SOLD_OUT');

  -- 4. Pending orders older than 10 minutes release stock and slot capacity.
  update orders set created_at = now() - interval '11 minutes' where customer_phone = '9000000002';
  perform pg_temp.place('9000000003', pg_temp.items(0, 2, 0));  -- 3 + 2 = 5, fits again

  -- 5. Paid orders hold stock forever; cancelled never do.
  update orders set status = 'paid', created_at = now() - interval '1 day' where customer_phone = '9000000001';
  update orders set status = 'cancelled' where customer_phone = '9000000003';
  perform pg_temp.place('9000000004', pg_temp.items(2, 0, 0));  -- paid 3 + new 2 = 5
  perform pg_temp.expect_error($q$ select pg_temp.place('9000000005', pg_temp.items(1, 0, 0)) $q$, 'SOLD_OUT');

  -- 6. Slot capacity counts ORDERS (capacity 3): paid #1, pending #4 → 2 holding. One more OK, then SLOT_FULL.
  perform pg_temp.place('9000000006', pg_temp.items(0, 0, 1));
  perform pg_temp.expect_error($q$ select pg_temp.place('9000000007', pg_temp.items(0, 0, 1)) $q$, 'SLOT_FULL');

  -- get_availability agrees with place_order.
  perform pg_temp.assert_eq(
    ((public.get_availability() -> 'slots' ->> (select slot_id::text from fx)))::int, 3, 'availability slot count');

  -- 7. Max 2 pending orders per phone (checked before slot/stock).
  update slots set capacity = 100 where id = (select slot_id from fx);
  update day_stock set stock_limit = 100 where service_day_id = (select day_id from fx);
  perform pg_temp.place('9111111111', pg_temp.items(1, 0, 0));
  perform pg_temp.place('9111111111', pg_temp.items(1, 0, 0));
  perform pg_temp.expect_error($q$ select pg_temp.place('9111111111', pg_temp.items(1, 0, 0)) $q$, 'TOO_MANY_PENDING');
  -- …and the limit lifts once one is paid.
  update orders set status = 'paid'
  where id = (select id from orders where customer_phone = '9111111111' order by created_at limit 1);
  perform pg_temp.place('9111111111', pg_temp.items(1, 0, 0));

  -- 8. Order window: before opens_at, at/after closes_at, and disabled are all DAY_CLOSED.
  update service_days set opens_at = now() + interval '1 minute' where id = (select day_id from fx);
  perform pg_temp.expect_error($q$ select pg_temp.place('9222222222', pg_temp.items(1, 0, 0)) $q$, 'DAY_CLOSED');
  update service_days set opens_at = null, closes_at = now() where id = (select day_id from fx);
  perform pg_temp.expect_error($q$ select pg_temp.place('9222222222', pg_temp.items(1, 0, 0)) $q$, 'DAY_CLOSED');
  update service_days set closes_at = null, is_enabled = false where id = (select day_id from fx);
  perform pg_temp.expect_error($q$ select pg_temp.place('9222222222', pg_temp.items(1, 0, 0)) $q$, 'DAY_CLOSED');
  update service_days set is_enabled = true where id = (select day_id from fx);
  perform pg_temp.place('9222222222', pg_temp.items(1, 0, 0));  -- open again

  -- 9. Per-IP rate limit helper: limit 2 per window.
  if not public.hit_rate_limit('test:ip', 2, 600) then raise exception 'FAIL rate limit hit 1'; end if;
  if not public.hit_rate_limit('test:ip', 2, 600) then raise exception 'FAIL rate limit hit 2'; end if;
  if public.hit_rate_limit('test:ip', 2, 600) then raise exception 'FAIL rate limit should block hit 3'; end if;
  update rate_limit_events set created_at = now() - interval '11 minutes' where bucket = 'test:ip';
  if not public.hit_rate_limit('test:ip', 2, 600) then raise exception 'FAIL rate limit should reset'; end if;

  raise notice 'ALL DB TESTS PASSED';
end $$;


-- ===========================================================================
-- Sprint 3: coupons, tasting days, mark_order_paid
-- ===========================================================================
update slots set capacity = 100 where id = (select slot_id from fx);
update day_stock set stock_limit = 100 where service_day_id = (select day_id from fx);
update service_days set opens_at = null, closes_at = null, is_enabled = true where id = (select day_id from fx);

insert into public.coupons (code, kind, value, min_order_paise, max_uses) values
  ('FLAT20', 'flat', 2000, 0, null),
  ('HALF', 'percent', 50, 0, null),
  ('BIG', 'flat', 999900, 0, null),
  ('MIN100', 'flat', 1000, 10000, null),
  ('ONCE', 'flat', 500, 0, 1);
insert into public.coupons (code, kind, value, is_active) values ('OFF', 'flat', 500, false);
insert into public.coupons (code, kind, value, valid_until) values ('OLD', 'flat', 500, now() - interval '1 day');

create function pg_temp.place_c(p_phone text, p_items jsonb, p_code text) returns text
language sql as $$
  select order_no from public.place_order(
    (select day_id from fx), (select slot_id from fx), 'Test', p_phone, 'pickup', p_items, p_code)
$$;

create function pg_temp.pay(p_order_no text) returns text
language plpgsql as $$
declare v_rzp text := 'order_' || p_order_no; v text;
begin
  update orders set razorpay_order_id = v_rzp where order_no = p_order_no and razorpay_order_id is null;
  select result into v from public.mark_order_paid(v_rzp, 'pay_' || p_order_no);
  return v;
end $$;

do $$
declare
  v_no text; v_sub int; v_disc int; v_total int; v_used int; v_status text;
begin
  -- 10. Flat coupon: 2×35 = 70 − 20 = ₹50
  v_no := pg_temp.place_c('9300000001', pg_temp.items(2, 0, 0), 'flat20');  -- case-insensitive
  select subtotal_paise, discount_paise, total_paise into v_sub, v_disc, v_total from orders where order_no = v_no;
  perform pg_temp.assert_eq(v_disc, 2000, 'flat discount');
  perform pg_temp.assert_eq(v_total, 5000, 'flat total');

  -- 11. Percent coupon: 50% of 35+40 = 75 → 37.50 off
  v_no := pg_temp.place_c('9300000002', pg_temp.items(1, 1, 0), 'HALF');
  select discount_paise, total_paise into v_disc, v_total from orders where order_no = v_no;
  perform pg_temp.assert_eq(v_disc, 3750, 'percent discount');
  perform pg_temp.assert_eq(v_total, 3750, 'percent total');

  -- 12. Total never below ₹1
  v_no := pg_temp.place_c('9300000003', pg_temp.items(1, 0, 0), 'BIG');
  select total_paise into v_total from orders where order_no = v_no;
  perform pg_temp.assert_eq(v_total, 100, 'minimum ₹1 total');

  -- 13. Invalid / inactive / expired / min order
  perform pg_temp.expect_error($q$ select pg_temp.place_c('9300000004', pg_temp.items(1,0,0), 'NOPE') $q$, 'COUPON_INVALID');
  perform pg_temp.expect_error($q$ select pg_temp.place_c('9300000004', pg_temp.items(1,0,0), 'OFF') $q$, 'COUPON_INACTIVE');
  perform pg_temp.expect_error($q$ select pg_temp.place_c('9300000004', pg_temp.items(1,0,0), 'OLD') $q$, 'COUPON_INACTIVE');
  perform pg_temp.expect_error($q$ select pg_temp.place_c('9300000004', pg_temp.items(2,0,0), 'MIN100') $q$, 'COUPON_MIN_ORDER');
  perform pg_temp.place_c('9300000004', pg_temp.items(2, 1, 0), 'MIN100');  -- 110 ≥ 100: ok

  -- 14. used_count increments only on payment, exactly once (verify + webhook both call it)
  v_no := pg_temp.place_c('9300000005', pg_temp.items(1, 0, 0), 'ONCE');
  select used_count into v_used from coupons where code = 'ONCE';
  perform pg_temp.assert_eq(v_used, 0, 'used_count not incremented at creation');
  -- another phone can't take the last use while it's held by a fresh unpaid order
  perform pg_temp.expect_error($q$ select pg_temp.place_c('9300000006', pg_temp.items(1,0,0), 'ONCE') $q$, 'COUPON_USED_UP');
  if pg_temp.pay(v_no) <> 'paid' then raise exception 'FAIL first mark paid'; end if;
  if pg_temp.pay(v_no) <> 'already_paid' then raise exception 'FAIL second mark paid'; end if;
  select used_count into v_used from coupons where code = 'ONCE';
  perform pg_temp.assert_eq(v_used, 1, 'used_count after two confirmations');
  perform pg_temp.expect_error($q$ select pg_temp.place_c('9300000007', pg_temp.items(1,0,0), 'ONCE') $q$, 'COUPON_USED_UP');

  -- 15. mark_order_paid: amount mismatch, paid after cancel, refunded
  v_no := pg_temp.place_c('9300000008', pg_temp.items(1, 0, 0), null);
  update orders set razorpay_order_id = 'order_' || v_no where order_no = v_no;
  if (select result from public.mark_order_paid('order_' || v_no, 'pay_x', 1)) <> 'amount_mismatch' then
    raise exception 'FAIL amount mismatch';
  end if;
  update orders set status = 'cancelled' where order_no = v_no;
  if pg_temp.pay(v_no) <> 'paid_after_cancel' then raise exception 'FAIL paid after cancel'; end if;
  select status into v_status from orders where order_no = v_no;
  if v_status <> 'cancelled' or (select razorpay_payment_id from orders where order_no = v_no) is null then
    raise exception 'FAIL paid-after-cancel should stay cancelled with payment id';
  end if;
  update orders set status = 'refunded' where order_no = v_no;
  if pg_temp.pay(v_no) <> 'not_payable' then raise exception 'FAIL refunded not payable'; end if;
  if (select result from public.mark_order_paid('order_missing', 'pay_y')) <> 'not_found' then
    raise exception 'FAIL not found';
  end if;

  -- 16. Tasting day: one item, one paid order per phone, retries replace the unpaid attempt
  update service_days set is_tasting_day = true where id = (select day_id from fx);
  perform pg_temp.expect_error($q$ select pg_temp.place('9400000001', pg_temp.items(2,0,0)) $q$, 'TASTING_ONE_ITEM');
  perform pg_temp.expect_error($q$ select pg_temp.place('9400000001', pg_temp.items(1,0,1)) $q$, 'TASTING_ONE_ITEM');
  v_no := pg_temp.place('9400000001', pg_temp.items(1, 0, 0));
  perform pg_temp.place('9400000001', pg_temp.items(0, 0, 1));  -- second attempt cancels the first unpaid one
  select status into v_status from orders where order_no = v_no;
  if v_status <> 'cancelled' then raise exception 'FAIL earlier unpaid tasting order should be cancelled'; end if;
  v_no := (select order_no from orders where customer_phone = '9400000001' and status = 'pending_payment');
  perform pg_temp.pay(v_no);
  perform pg_temp.expect_error($q$ select pg_temp.place('9400000001', pg_temp.items(1,0,0)) $q$, 'TASTING_ALREADY_BOOKED');
  perform pg_temp.place('9400000002', pg_temp.items(1, 0, 0));  -- a different phone is fine

  raise notice 'ALL SPRINT 3 DB TESTS PASSED';
end $$;

rollback;
