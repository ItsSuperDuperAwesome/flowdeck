update public.businesses
set name = 'FlowDeck'
where lower(name) = 'flowdeck';

insert into public.business_service_types (business_id, key, label, sort_order)
select businesses.id, defaults.key, defaults.label, defaults.sort_order
from public.businesses
cross join (values
  ('site_visit', 'Site visit', 10),
  ('new_install', 'New installation', 20),
  ('repair', 'Repair', 30),
  ('maintenance', 'Maintenance', 40),
  ('consultation', 'Consultation', 50),
  ('other', 'Other', 60)
) as defaults(key, label, sort_order)
on conflict (business_id, key) do nothing;

with mismatched as (
  select
    id,
    business_id,
    lower(
      regexp_replace(
        regexp_replace(trim(label), '[^a-zA-Z0-9]+', '_', 'g'),
        '^_|_$',
        '',
        'g'
      )
    ) as repaired_key
  from public.business_service_types
  where key in ('garage_floor', 'patio', 'commercial_floor', 'basement')
    and lower(label) not in ('garage floor', 'patio', 'commercial floor', 'basement')
),
repairable as (
  select mismatched.*
  from mismatched
  where repaired_key ~ '^[a-z][a-z0-9_]{1,40}$'
    and not exists (
      select 1
      from public.business_service_types existing
      where existing.business_id = mismatched.business_id
        and existing.key = mismatched.repaired_key
        and existing.id <> mismatched.id
    )
)
update public.business_service_types
set key = repairable.repaired_key
from repairable
where business_service_types.id = repairable.id;
