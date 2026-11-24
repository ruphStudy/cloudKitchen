-- Sprint 3: coupons, tasting-day rules, refunds, feedback details.

-- ---------------------------------------------------------------------------
-- Orders: refunded status + refund fields
-- ---------------------------------------------------------------------------
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status in ('pending_payment', 'paid', 'ready', 'picked_up', 'cancelled', 'refunded'));

alter table public.orders
  add column if not exists refund_id             text,
  add column if not exists refund_amount_paise   integer,
  add column if not exists refund_requested_at   timestamptz,
  add column if not exists refunded_at           timestamptz,
  add column if not exists refund_note           text;

create index if not exists orders_phone_day_idx on public.orders (customer_phone, service_day_id);
create index if not exists orders_coupon_idx on public.orders (coupon_id) where coupon_id is not null;

-- ---------------------------------------------------------------------------
-- Coupons
-- ---------------------------------------------------------------------------
alter table public.coupons
  add column if not exists used_count integer not null default 0 check (used_count >= 0);
alter table public.coupons drop constraint if exists coupons_code_upper;
alter table public.coupons add constraint coupons_code_upper check (code = upper(code) and code ~ '^[A-Z0-9_-]{3,20}$');
alter table public.coupons drop constraint if exists coupons_percent_range;
alter table public.coupons add constraint coupons_percent_range check (kind <> 'percent' or value between 1 and 100);

create policy "admins read coupons" on public.coupons for select to authenticated using (public.is_admin());

-- Validate a coupon for a subtotal and return the discount. Raises:
--   COUPON_INVALID, COUPON_INACTIVE, COUPON_MIN_ORDER (detail = min paise), COUPON_USED_UP
-- Unpaid orders from the last 10 minutes count towards max_uses (except the same phone's own retries).
-- The discount never brings the total below ₹1 (100 paise).
create or replace function public.evaluate_coupon(p_code text, p_subtotal integer, p_phone text default null)
returns table (coupon_id uuid, code text, discount_paise integer)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  c         coupons%rowtype;
  v_pending integer;
  v_disc    integer;
begin
  select * into c from coupons where coupons.code = upper(trim(p_code));
  if not found then
    raise exception 'COUPON_INVALID';
  end if;
  if not c.is_active
     or (c.valid_from is not null and now() < c.valid_from)
     or (c.valid_until is not null and now() >= c.valid_until) then
    raise exception 'COUPON_INACTIVE';
  end if;
  if p_subtotal < c.min_order_paise then
    raise exception 'COUPON_MIN_ORDER' using detail = c.min_order_paise::text;
  end if;
  if c.max_uses is not null then
    select count(*) into v_pending
    from orders o
    where o.coupon_id = c.id
      and o.status = 'pending_payment'
      and o.created_at > now() - interval '10 minutes'
      and o.customer_phone is distinct from p_phone;
    if c.used_count + v_pending >= c.max_uses then
      raise exception 'COUPON_USED_UP';
    end if;
  end if;

  v_disc := case when c.kind = 'flat' then c.value else (p_subtotal * c.value) / 100 end;
  v_disc := least(v_disc, greatest(p_subtotal - 100, 0));
  return query select c.id, c.code, v_disc;
end;
$$;

-- ---------------------------------------------------------------------------
-- place_order v3: + coupon, + tasting-day rules. Still the only order-insert path.
-- Raises: DAY_CLOSED, TASTING_ONE_ITEM, TASTING_ALREADY_BOOKED, TOO_MANY_PENDING,
--         SLOT_INVALID, SLOT_FULL, ITEM_INVALID, SOLD_OUT, COUPON_*
-- ---------------------------------------------------------------------------
drop function if exists public.place_order(uuid, uuid, text, text, text, jsonb);

create or replace function public.place_order(
  p_service_day_id uuid,
  p_slot_id        uuid,
  p_customer_name  text,
  p_customer_phone text,
  p_fulfilment     text,
  p_items          jsonb,
  p_coupon_code    text default null
)
returns table (order_id uuid, order_no text, public_token uuid, total_paise integer)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_day      service_days%rowtype;
  v_slot     slots%rowtype;
  v_booked   integer;
  v_pending  integer;
  v_qty      integer;
  v_subtotal integer;
  v_discount integer := 0;
  v_coupon   uuid;
  v_order    orders%rowtype;
  r          record;
begin
  -- Lock order: day → phone → coupon. Always the same order, so no deadlocks.
  perform pg_advisory_xact_lock(hashtextextended(p_service_day_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('phone:' || coalesce(p_customer_phone, ''), 0));

  select * into v_day from service_days where id = p_service_day_id;
  if not found
     or not v_day.is_enabled
     or v_day.date < (now() at time zone 'Asia/Kolkata')::date
     or (v_day.opens_at is not null and now() < v_day.opens_at)
     or (v_day.closes_at is not null and now() >= v_day.closes_at) then
    raise exception 'DAY_CLOSED';
  end if;

  -- Normalise requested lines (merge duplicates) and validate items.
  if to_regclass('pg_temp._req') is not null then
    drop table pg_temp._req;
  end if;
  create temporary table _req on commit drop as
    select x.menu_item_id, sum(x.quantity)::int as quantity
    from jsonb_to_recordset(p_items) as x(menu_item_id uuid, quantity int)
    group by x.menu_item_id;

  if not exists (select 1 from _req)
     or exists (
       select 1 from _req q
       left join menu_items m on m.id = q.menu_item_id and m.is_active
       where m.id is null or q.quantity is null or q.quantity < 1 or q.quantity > 50
     ) then
    raise exception 'ITEM_INVALID';
  end if;

  -- Tasting day: 1 item, one paid order per phone. A new attempt replaces the phone's earlier unpaid one.
  if v_day.is_tasting_day then
    select sum(quantity) into v_qty from _req;
    if v_qty <> 1 then
      raise exception 'TASTING_ONE_ITEM';
    end if;
    if exists (
      select 1 from orders o
      where o.service_day_id = p_service_day_id
        and o.customer_phone = p_customer_phone
        and o.status in ('paid', 'ready', 'picked_up')
    ) then
      raise exception 'TASTING_ALREADY_BOOKED';
    end if;
    update orders o set status = 'cancelled'
    where o.service_day_id = p_service_day_id
      and o.customer_phone = p_customer_phone
      and o.status = 'pending_payment';
  end if;

  select count(*) into v_pending
  from orders o
  where o.customer_phone = p_customer_phone
    and o.status = 'pending_payment'
    and o.created_at > now() - interval '10 minutes';
  if v_pending >= 2 then
    raise exception 'TOO_MANY_PENDING';
  end if;

  select * into v_slot from slots
  where id = p_slot_id and service_day_id = p_service_day_id and is_enabled;
  if not found then
    raise exception 'SLOT_INVALID';
  end if;

  select count(*) into v_booked
  from orders o
  where o.slot_id = p_slot_id
    and (o.status in ('paid', 'ready', 'picked_up')
         or (o.status = 'pending_payment' and o.created_at > now() - interval '10 minutes'));
  if v_booked >= v_slot.capacity then
    raise exception 'SLOT_FULL';
  end if;

  for r in
    with req as (
      select m.category, sum(q.quantity)::int as qty
      from _req q join menu_items m on m.id = q.menu_item_id
      group by m.category
    ),
    used as (
      select oi.category, sum(oi.quantity)::int as qty
      from order_items oi
      join orders o on o.id = oi.order_id
      where o.service_day_id = p_service_day_id
        and (o.status in ('paid', 'ready', 'picked_up')
             or (o.status = 'pending_payment' and o.created_at > now() - interval '10 minutes'))
      group by oi.category
    )
    select req.category, req.qty, coalesce(used.qty, 0) as used_qty, ds.stock_limit
    from req
    left join used on used.category = req.category
    left join day_stock ds on ds.service_day_id = p_service_day_id and ds.category = req.category
  loop
    if r.stock_limit is null or r.used_qty + r.qty > r.stock_limit then
      raise exception 'SOLD_OUT' using detail = r.category;
    end if;
  end loop;

  select sum(m.price_paise * q.quantity)::int into v_subtotal
  from _req q join menu_items m on m.id = q.menu_item_id;

  if nullif(trim(coalesce(p_coupon_code, '')), '') is not null then
    perform pg_advisory_xact_lock(hashtextextended('coupon:' || upper(trim(p_coupon_code)), 0));
    select e.coupon_id, e.discount_paise into v_coupon, v_discount
    from evaluate_coupon(p_coupon_code, v_subtotal, p_customer_phone) e;
  end if;

  insert into orders (service_day_id, slot_id, customer_name, customer_phone, fulfilment,
                      subtotal_paise, discount_paise, total_paise, coupon_id)
  values (p_service_day_id, p_slot_id, p_customer_name, p_customer_phone, p_fulfilment,
          v_subtotal, v_discount, v_subtotal - v_discount, v_coupon)
  returning * into v_order;

  insert into order_items (order_id, menu_item_id, name, category, unit_price_paise, quantity, line_total_paise)
  select v_order.id, m.id, m.name, m.category, m.price_paise, q.quantity, m.price_paise * q.quantity
  from _req q join menu_items m on m.id = q.menu_item_id;

  return query select v_order.id, v_order.order_no, v_order.public_token, v_order.total_paise;
end;
$$;

-- ---------------------------------------------------------------------------
-- mark_order_paid: the single idempotent "payment captured" update, used by
-- both /api/payments/verify and the webhook. Increments coupon used_count
-- exactly once, on the pending_payment → paid transition.
-- Returns result: paid | already_paid | paid_after_cancel | not_payable | amount_mismatch | not_found
-- ---------------------------------------------------------------------------
create or replace function public.mark_order_paid(
  p_razorpay_order_id text,
  p_payment_id        text,
  p_amount_paise      integer default null
)
returns table (result text, public_token uuid)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v orders%rowtype;
begin
  select * into v from orders where razorpay_order_id = p_razorpay_order_id for update;
  if not found then
    return query select 'not_found'::text, null::uuid;
    return;
  end if;
  if p_amount_paise is not null and p_amount_paise <> v.total_paise then
    return query select 'amount_mismatch'::text, v.public_token;
    return;
  end if;

  if v.status = 'pending_payment' then
    update orders set status = 'paid', razorpay_payment_id = p_payment_id, paid_at = now() where id = v.id;
    if v.coupon_id is not null then
      update coupons set used_count = used_count + 1 where id = v.coupon_id;
    end if;
    return query select 'paid'::text, v.public_token;
  elsif v.status = 'cancelled' then
    -- Paid after cancel: keep cancelled (stock already released), record payment → "Refund needed".
    update orders
    set razorpay_payment_id = coalesce(razorpay_payment_id, p_payment_id), paid_at = coalesce(paid_at, now())
    where id = v.id;
    return query select 'paid_after_cancel'::text, v.public_token;
  elsif v.status = 'refunded' then
    return query select 'not_payable'::text, v.public_token;
  else
    return query select 'already_paid'::text, v.public_token;
  end if;
end;
$$;

revoke all on function public.evaluate_coupon(text, integer, text) from public, anon, authenticated;
revoke all on function public.place_order(uuid, uuid, text, text, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.mark_order_paid(text, text, integer) from public, anon, authenticated;
grant execute on function public.evaluate_coupon(text, integer, text) to service_role;
grant execute on function public.place_order(uuid, uuid, text, text, text, jsonb, text) to service_role;
grant execute on function public.mark_order_paid(text, text, integer) to service_role;

-- ---------------------------------------------------------------------------
-- Feedback details (rating = taste 1–5)
-- ---------------------------------------------------------------------------
alter table public.feedback
  add column if not exists spice         text check (spice in ('less', 'right', 'more')),
  add column if not exists quantity_feel text check (quantity_feel in ('less', 'right', 'more'));
alter table public.feedback drop constraint if exists feedback_comment_length;
alter table public.feedback add constraint feedback_comment_length check (comment is null or char_length(comment) <= 1000);

create policy "admins read feedback" on public.feedback for select to authenticated using (public.is_admin());
