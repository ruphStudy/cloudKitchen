-- Seed data. Safe to re-run.

insert into public.menu_items (slug, name, description, category, price_paise, sort_order) values
  ('mutton-sukha',  'Mutton Sukha bowl',  'Dry, spicy Kolhapuri-style mutton with fresh masala.', 'mutton',  3500, 10),
  ('mutton-curry',  'Mutton Curry bowl',  'Slow-cooked mutton in a rich, homestyle gravy.',      'mutton',  3500, 20),
  ('chicken-sukha', 'Chicken Sukha bowl', 'Dry roasted chicken tossed in coconut masala.',       'chicken', 2500, 30),
  ('chicken-curry', 'Chicken Curry bowl', 'Tender chicken in a light, homestyle gravy.',         'chicken', 2500, 40)
on conflict (slug) do nothing;

-- Next Saturday and Sunday (Pune time). If today is Saturday, next week's.
-- Default schedule (Asia/Kolkata):
--   Saturday: opens Friday 00:00, closes Friday 21:00
--   Sunday:   opens Friday 00:00, closes Saturday 21:00
with base as (
  select (now() at time zone 'Asia/Kolkata')::date as today,
         extract(isodow from (now() at time zone 'Asia/Kolkata')::date)::int as dow
),
sat as (
  select today + (case when (6 - dow + 7) % 7 = 0 then 7 else (6 - dow + 7) % 7 end) as d from base
),
days as (
  select d, d - 1 as friday from sat
  union all
  select d + 1, d - 1 from sat
)
insert into public.service_days (date, is_enabled, opens_at, closes_at)
select d,
       true,
       (friday::timestamp) at time zone 'Asia/Kolkata',
       ((d - 1)::timestamp + time '21:00') at time zone 'Asia/Kolkata'
from days
on conflict (date) do nothing;

insert into public.slots (service_day_id, label, start_time, end_time, capacity)
select sd.id, s.label, s.start_time, s.end_time, 40
from public.service_days sd
cross join (values
  ('12–1 PM', time '12:00', time '13:00'),
  ('1–2 PM',  time '13:00', time '14:00'),
  ('2–3 PM',  time '14:00', time '15:00')
) as s(label, start_time, end_time)
where sd.date >= (now() at time zone 'Asia/Kolkata')::date
on conflict (service_day_id, start_time) do nothing;

insert into public.day_stock (service_day_id, category, stock_limit)
select sd.id, c.category, c.stock_limit
from public.service_days sd
cross join (values ('mutton', 75), ('chicken', 25)) as c(category, stock_limit)
where sd.date >= (now() at time zone 'Asia/Kolkata')::date
on conflict (service_day_id, category) do nothing;

-- Admins: add your email(s) here, or use ADMIN_EMAILS in the environment.
-- insert into public.admins (email) values ('you@example.com') on conflict do nothing;
