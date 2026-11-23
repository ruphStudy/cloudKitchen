-- Weekend cloud kitchen: initial schema
-- Money is always stored as integer paise (₹1 = 100 paise).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.menu_items (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,
  name          text not null,
  description   text not null default '',
  category      text not null check (category in ('mutton', 'chicken')),
  price_paise   integer not null check (price_paise > 0),
  image_url     text,
  is_active     boolean not null default true,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now()
);

create table public.service_days (
  id          uuid primary key default gen_random_uuid(),
  date        date not null unique,
  is_enabled  boolean not null default true,
  -- Ordering window. NULL opens_at = open now; NULL closes_at = never closes.
  opens_at    timestamptz,
  closes_at   timestamptz,
  created_at  timestamptz not null default now()
);

create table public.slots (
  id              uuid primary key default gen_random_uuid(),
  service_day_id  uuid not null references public.service_days (id) on delete cascade,
  label           text not null,
  start_time      time not null,
  end_time        time not null,
  capacity        integer not null check (capacity >= 0), -- max number of orders
  is_enabled      boolean not null default true,
  unique (service_day_id, start_time)
);

-- Stock per service day per dish category (e.g. 75 mutton bowls on Saturday).
create table public.day_stock (
  id              uuid primary key default gen_random_uuid(),
  service_day_id  uuid not null references public.service_days (id) on delete cascade,
  category        text not null check (category in ('mutton', 'chicken')),
  stock_limit     integer not null check (stock_limit >= 0),
  unique (service_day_id, category)
);

create table public.coupons (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique,
  kind             text not null check (kind in ('flat', 'percent')),
  value            integer not null check (value > 0), -- paise for flat, % for percent
  min_order_paise  integer not null default 0,
  max_uses         integer,
  is_active        boolean not null default true,
  valid_from       timestamptz,
  valid_until      timestamptz,
  created_at       timestamptz not null default now()
);

create sequence public.order_no_seq start with 1001;

create table public.orders (
  id                   uuid primary key default gen_random_uuid(),
  order_no             text not null unique default ('K-' || nextval('public.order_no_seq')),
  public_token         uuid not null unique default gen_random_uuid(),
  service_day_id       uuid not null references public.service_days (id),
  slot_id              uuid not null references public.slots (id),
  customer_name        text not null,
  customer_phone       text not null check (customer_phone ~ '^[6-9][0-9]{9}$'),
  fulfilment           text not null default 'pickup' check (fulfilment in ('pickup', 'delivery')),
  delivery_address     text,
  status               text not null default 'pending_payment'
                         check (status in ('pending_payment', 'paid', 'ready', 'picked_up', 'cancelled')),
  subtotal_paise       integer not null check (subtotal_paise >= 0),
  discount_paise       integer not null default 0 check (discount_paise >= 0),
  total_paise          integer not null check (total_paise >= 0),
  coupon_id            uuid references public.coupons (id),
  razorpay_order_id    text unique,
  razorpay_payment_id  text unique,
  paid_at              timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index orders_day_status_idx on public.orders (service_day_id, status, created_at);
create index orders_slot_status_idx on public.orders (slot_id, status, created_at);

create table public.order_items (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null references public.orders (id) on delete cascade,
  menu_item_id      uuid not null references public.menu_items (id),
  name              text not null,     -- snapshot at time of order
  category          text not null,     -- snapshot at time of order
  unit_price_paise  integer not null check (unit_price_paise >= 0),
  quantity          integer not null check (quantity > 0),
  line_total_paise  integer not null check (line_total_paise >= 0)
);

create index order_items_order_idx on public.order_items (order_id);

create table public.feedback (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders (id) on delete cascade,
  rating      integer not null check (rating between 1 and 5),
  comment     text,
  created_at  timestamptz not null default now(),
  unique (order_id)
);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger orders_touch_updated_at
before update on public.orders
for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- Anon may only read the public catalogue. Everything else goes through
-- server routes using the service role key (which bypasses RLS).
-- ---------------------------------------------------------------------------

alter table public.menu_items   enable row level security;
alter table public.service_days enable row level security;
alter table public.slots        enable row level security;
alter table public.day_stock    enable row level security;
alter table public.orders       enable row level security;
alter table public.order_items  enable row level security;
alter table public.coupons      enable row level security;
alter table public.feedback     enable row level security;

create policy "public reads active menu items"
  on public.menu_items for select to anon, authenticated
  using (is_active);

create policy "public reads enabled service days"
  on public.service_days for select to anon, authenticated
  using (is_enabled);

create policy "public reads slots of enabled days"
  on public.slots for select to anon, authenticated
  using (exists (select 1 from public.service_days d where d.id = service_day_id and d.is_enabled));

create policy "public reads stock of enabled days"
  on public.day_stock for select to anon, authenticated
  using (exists (select 1 from public.service_days d where d.id = service_day_id and d.is_enabled));

-- Belt and braces: no direct writes from the browser, even if a policy is added by mistake.
revoke insert, update, delete, truncate on all tables in schema public from anon, authenticated;
revoke all on sequence public.order_no_seq from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Functions (service role only)
-- An order "holds" capacity/stock if it is paid (or later), or if it is
-- pending_payment and was created in the last 10 minutes.
-- ---------------------------------------------------------------------------

-- Aggregated usage for the catalogue: orders per slot and bowls per day/category.
create or replace function public.get_availability()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with live as (
    select o.id, o.slot_id, o.service_day_id
    from orders o
    join service_days d on d.id = o.service_day_id
    where d.date >= (now() at time zone 'Asia/Kolkata')::date
      and (o.status in ('paid', 'ready', 'picked_up')
           or (o.status = 'pending_payment' and o.created_at > now() - interval '10 minutes'))
  )
  select jsonb_build_object(
    'slots', coalesce((
      select jsonb_object_agg(slot_id, n)
      from (select slot_id, count(*)::int as n from live group by slot_id) s
    ), '{}'::jsonb),
    'stock', coalesce((
      select jsonb_agg(jsonb_build_object('service_day_id', service_day_id, 'category', category, 'used', qty))
      from (
        select l.service_day_id, oi.category, sum(oi.quantity)::int as qty
        from live l join order_items oi on oi.order_id = l.id
        group by l.service_day_id, oi.category
      ) u
    ), '[]'::jsonb)
  );
$$;

-- Atomically validate and create a pending order. Prices come from the DB.
-- Raises: DAY_CLOSED, SLOT_INVALID, SLOT_FULL, ITEM_INVALID, SOLD_OUT
create or replace function public.place_order(
  p_service_day_id uuid,
  p_slot_id        uuid,
  p_customer_name  text,
  p_customer_phone text,
  p_fulfilment     text,
  p_items          jsonb  -- [{ "menu_item_id": uuid, "quantity": int }]
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
  v_subtotal integer;
  v_order    orders%rowtype;
  r          record;
begin
  -- Serialise all orders for the same day so capacity/stock checks can't race.
  perform pg_advisory_xact_lock(hashtextextended(p_service_day_id::text, 0));

  select * into v_day from service_days where id = p_service_day_id;
  if not found
     or not v_day.is_enabled
     or v_day.date < (now() at time zone 'Asia/Kolkata')::date
     or (v_day.opens_at is not null and now() < v_day.opens_at)
     or (v_day.closes_at is not null and now() >= v_day.closes_at) then
    raise exception 'DAY_CLOSED';
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

  -- Normalise requested lines (merge duplicates) and validate items.
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

  -- Stock check per category for this day.
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

revoke all on function public.get_availability() from public, anon, authenticated;
revoke all on function public.place_order(uuid, uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.get_availability() to service_role;
grant execute on function public.place_order(uuid, uuid, text, text, text, jsonb) to service_role;
