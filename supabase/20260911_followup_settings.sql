create table if not exists public.business_followup_settings (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  new_lead_followup_hours integer not null default 24,
  contacted_followup_days integer not null default 3,
  proposal_followup_days integer not null default 3,
  stale_opportunity_days integer not null default 7,
  reminders_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.business_followup_settings drop constraint if exists business_followup_settings_new_lead_followup_hours_check;
alter table public.business_followup_settings add constraint business_followup_settings_new_lead_followup_hours_check
check (new_lead_followup_hours between 1 and 720);

alter table public.business_followup_settings drop constraint if exists business_followup_settings_contacted_followup_days_check;
alter table public.business_followup_settings add constraint business_followup_settings_contacted_followup_days_check
check (contacted_followup_days between 1 and 365);

alter table public.business_followup_settings drop constraint if exists business_followup_settings_proposal_followup_days_check;
alter table public.business_followup_settings add constraint business_followup_settings_proposal_followup_days_check
check (proposal_followup_days between 1 and 365);

alter table public.business_followup_settings drop constraint if exists business_followup_settings_stale_opportunity_days_check;
alter table public.business_followup_settings add constraint business_followup_settings_stale_opportunity_days_check
check (stale_opportunity_days between 1 and 365);

drop trigger if exists business_followup_settings_set_updated_at on public.business_followup_settings;
create trigger business_followup_settings_set_updated_at
before update on public.business_followup_settings
for each row execute function public.set_updated_at();

alter table public.business_followup_settings enable row level security;

revoke all on table public.business_followup_settings from anon, authenticated;
grant select, insert, update, delete on table public.business_followup_settings to authenticated;

drop policy if exists "Business members can manage follow-up settings." on public.business_followup_settings;
create policy "Business members can manage follow-up settings."
on public.business_followup_settings for all
to authenticated
using (private.is_business_member(business_id))
with check (private.is_business_member(business_id));

insert into public.business_followup_settings (business_id)
select businesses.id
from public.businesses
on conflict (business_id) do nothing;
