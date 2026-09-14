create table if not exists public.business_action_playbooks (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  service_type_id uuid references public.business_service_types(id) on delete cascade,
  pipeline_status_id uuid references public.business_pipeline_statuses(id) on delete set null,
  pipeline_key text not null,
  action_key text not null,
  action_label text not null,
  action_type text not null,
  is_enabled boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.business_action_playbooks drop constraint if exists business_action_playbooks_pipeline_key_check;
alter table public.business_action_playbooks add constraint business_action_playbooks_pipeline_key_check
check (pipeline_key in ('lead', 'contacted', 'quoted', 'scheduled', 'in_progress', 'completed', 'lost'));

alter table public.business_action_playbooks drop constraint if exists business_action_playbooks_action_key_check;
alter table public.business_action_playbooks add constraint business_action_playbooks_action_key_check
check (action_key ~ '^[a-z][a-z0-9_]{1,60}$');

alter table public.business_action_playbooks drop constraint if exists business_action_playbooks_action_label_check;
alter table public.business_action_playbooks add constraint business_action_playbooks_action_label_check
check (char_length(trim(action_label)) between 1 and 120);

alter table public.business_action_playbooks drop constraint if exists business_action_playbooks_action_type_check;
alter table public.business_action_playbooks add constraint business_action_playbooks_action_type_check
check (action_type in ('call', 'email', 'set_follow_up', 'schedule', 'review_proposal', 'mark_contacted', 'mark_lost', 'custom_instruction', 'open_opportunity'));

create index if not exists business_action_playbooks_business_status_idx
on public.business_action_playbooks(business_id, pipeline_key, service_type_id, sort_order, created_at);

alter table public.business_action_playbooks
drop constraint if exists business_action_playbooks_business_id_service_type_id_pipeline_key_action_key_key;

create unique index if not exists business_action_playbooks_default_unique_idx
on public.business_action_playbooks(business_id, pipeline_key, action_key)
where service_type_id is null;

create unique index if not exists business_action_playbooks_service_unique_idx
on public.business_action_playbooks(business_id, service_type_id, pipeline_key, action_key)
where service_type_id is not null;

drop trigger if exists business_action_playbooks_set_updated_at on public.business_action_playbooks;
create trigger business_action_playbooks_set_updated_at
before update on public.business_action_playbooks
for each row execute function public.set_updated_at();

alter table public.business_action_playbooks enable row level security;

revoke all on table public.business_action_playbooks from anon, authenticated;
grant select, insert, update, delete on table public.business_action_playbooks to authenticated;

drop policy if exists "Business members can manage action playbooks." on public.business_action_playbooks;
create policy "Business members can manage action playbooks."
on public.business_action_playbooks for all
to authenticated
using (private.is_business_member(business_id) or private.is_platform_admin())
with check (private.is_business_member(business_id) or private.is_platform_admin());

with default_actions as (
  select *
  from (values
    ('lead', 'mark_contacted', 'Mark Contacted', 'mark_contacted', 10),
    ('lead', 'call_client', 'Call Client', 'call', 20),
    ('lead', 'set_follow_up', 'Set Follow-Up', 'set_follow_up', 30),
    ('contacted', 'set_follow_up', 'Set Follow-Up', 'set_follow_up', 10),
    ('contacted', 'schedule', 'Schedule', 'schedule', 20),
    ('contacted', 'open_opportunity', 'Open Opportunity', 'open_opportunity', 30),
    ('quoted', 'set_follow_up', 'Set Follow-Up', 'set_follow_up', 10),
    ('quoted', 'review_proposal', 'Review Proposal', 'review_proposal', 20),
    ('quoted', 'call_client', 'Call Client', 'call', 30),
    ('scheduled', 'open_opportunity', 'Open Opportunity', 'open_opportunity', 10),
    ('in_progress', 'open_opportunity', 'Open Opportunity', 'open_opportunity', 10)
  ) as actions(pipeline_key, action_key, action_label, action_type, sort_order)
)
insert into public.business_action_playbooks (
  business_id,
  pipeline_status_id,
  pipeline_key,
  action_key,
  action_label,
  action_type,
  sort_order
)
select
  businesses.id,
  business_pipeline_statuses.id,
  default_actions.pipeline_key,
  default_actions.action_key,
  default_actions.action_label,
  default_actions.action_type,
  default_actions.sort_order
from public.businesses
join default_actions on true
left join public.business_pipeline_statuses
  on business_pipeline_statuses.business_id = businesses.id
 and business_pipeline_statuses.semantic_type = default_actions.pipeline_key
on conflict (business_id, pipeline_key, action_key) where service_type_id is null do nothing;
