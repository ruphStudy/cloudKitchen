-- Sprint 2: admin, rate limiting, day labels, realtime, menu images.

-- ---------------------------------------------------------------------------
-- Service day extras
-- ---------------------------------------------------------------------------
alter table public.service_days
  add column if not exists label text,
  add column if not exists is_tasting_day boolean not null default false;

-- ---------------------------------------------------------------------------
-- Admins
-- Emails in ADMIN_EMAILS (env) are copied here on first login, so RLS/Realtime
-- can see them too.
-- ---------------------------------------------------------------------------
create table if not exists public.admins (
  email       text primary key check (email = lower(email)),
  created_at  timestamptz not null default now()
);
alter table public.admins enable row level security;
revoke insert, update, delete, truncate on public.admins from anon, authenticated;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admins a
    where a.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;

-- Admins may read everything (needed for Supabase Realtime on orders).
-- All admin writes still go through server code using the service role.
create policy "admins read orders"       on public.orders       for select to authenticated using (public.is_admin());
create policy "admins read order items"  on public.order_items  for select to authenticated using (public.is_admin());
create policy "admins read all menu"     on public.menu_items   for select to authenticated using (public.is_admin());
create policy "admins read all days"     on public.service_days for select to authenticated using (public.is_admin());
create policy "admins read all slots"    on public.slots        for select to authenticated using (public.is_admin());
create policy "admins read all stock"    on public.day_stock    for select to authenticated using (public.is_admin());

-- Realtime: broadcast changes on orders (Supabase projects have this publication).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders'
     ) then
    alter publication supabase_realtime add table public.orders;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Rate limiting (fixed-window counter per bucket, e.g. hashed IP)
-- ---------------------------------------------------------------------------
create table if not exists public.rate_limit_events (
  id          bigserial primary key,
  bucket      text not null,
  created_at  timestamptz not null default now()
);
create index if not exists rate_limit_events_bucket_idx on public.rate_limit_events (bucket, created_at);
alter table public.rate_limit_events enable row level security;
revoke all on public.rate_limit_events from anon, authenticated;

-- Returns true and records a hit if the bucket is under p_limit in the window.
create or replace function public.hit_rate_limit(p_bucket text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('rl:' || p_bucket, 0));

  delete from rate_limit_events
  where bucket = p_bucket and created_at < now() - make_interval(secs => p_window_seconds);

  -- Occasional global cleanup so the table stays small.
  if random() < 0.02 then
    delete from rate_limit_events where created_at < now() - interval '1 day';
  end if;

  select count(*) into v_count from rate_limit_events where bucket = p_bucket;
  if v_count >= p_limit then
    return false;
  end if;

  insert into rate_limit_events (bucket) values (p_bucket);
  return true;
end;
$$;
revoke all on function public.hit_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.hit_rate_limit(text, integer, integer) to service_role;

-- ---------------------------------------------------------------------------
-- place_order: same as Sprint 1, plus "max 2 pending orders per phone".
-- Still the only code path that inserts orders.
-- ---------------------------------------------------------------------------
create or replace function public.place_order(
  p_service_day_id uuid,
  p_slot_id        uuid,
  p_customer_name  text,
  p_customer_phone text,
  p_fulfilment     text,
  p_items          jsonb
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
  v_subtotal integer;
  v_order    orders%rowtype;
  r          record;
begin
  -- Lock order: day first, then phone. Nobody takes them the other way round, so no deadlocks.
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

  insert into orders (service_day_id, slot_id, customer_name, customer_phone, fulfilment,
                      subtotal_paise, discount_paise, total_paise)
  values (p_service_day_id, p_slot_id, p_customer_name, p_customer_phone, p_fulfilment,
          v_subtotal, 0, v_subtotal)
  returning * into v_order;

  insert into order_items (order_id, menu_item_id, name, category, unit_price_paise, quantity, line_total_paise)
  select v_order.id, m.id, m.name, m.category, m.price_paise, q.quantity, m.price_paise * q.quantity
  from _req q join menu_items m on m.id = q.menu_item_id;

  return query select v_order.id, v_order.order_no, v_order.public_token, v_order.total_paise;
end;
$$;

revoke all on function public.place_order(uuid, uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.place_order(uuid, uuid, text, text, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Storage bucket for dish photos (public read; uploads via service role only).
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public)
    values ('menu-images', 'menu-images', true)
    on conflict (id) do nothing;
  end if;
end $$;
