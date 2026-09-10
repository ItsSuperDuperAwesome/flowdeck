create table if not exists public.business_service_types (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  key text not null,
  label text not null,
  enabled boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, key)
);

create table if not exists public.business_pipeline_statuses (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  key text not null,
  label text not null,
  semantic_type text not null,
  enabled boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, key),
  unique (business_id, semantic_type)
);

create table if not exists public.business_dashboard_widgets (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  widget_key text not null,
  label_override text,
  enabled boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, widget_key)
);

alter table public.business_service_types drop constraint if exists business_service_types_key_check;
alter table public.business_service_types add constraint business_service_types_key_check
check (key ~ '^[a-z][a-z0-9_]{1,40}$');

alter table public.business_service_types drop constraint if exists business_service_types_label_check;
alter table public.business_service_types add constraint business_service_types_label_check
check (char_length(trim(label)) between 1 and 80);

alter table public.business_pipeline_statuses drop constraint if exists business_pipeline_statuses_key_check;
alter table public.business_pipeline_statuses add constraint business_pipeline_statuses_key_check
check (key in ('lead', 'contacted', 'quoted', 'scheduled', 'in_progress', 'completed', 'lost'));

alter table public.business_pipeline_statuses drop constraint if exists business_pipeline_statuses_semantic_type_check;
alter table public.business_pipeline_statuses add constraint business_pipeline_statuses_semantic_type_check
check (semantic_type in ('lead', 'contacted', 'quoted', 'scheduled', 'in_progress', 'completed', 'lost'));

alter table public.business_pipeline_statuses drop constraint if exists business_pipeline_statuses_label_check;
alter table public.business_pipeline_statuses add constraint business_pipeline_statuses_label_check
check (char_length(trim(label)) between 1 and 80);

alter table public.business_dashboard_widgets drop constraint if exists business_dashboard_widgets_widget_key_check;
alter table public.business_dashboard_widgets add constraint business_dashboard_widgets_widget_key_check
check (widget_key in ('new_leads', 'quoted', 'scheduled', 'in_progress', 'completed', 'open_pipeline', 'avg_job', 'needs_attention', 'active_job_board', 'upcoming'));

alter table public.business_dashboard_widgets drop constraint if exists business_dashboard_widgets_label_override_check;
alter table public.business_dashboard_widgets add constraint business_dashboard_widgets_label_override_check
check (label_override is null or char_length(trim(label_override)) between 1 and 80);

create index if not exists business_service_types_business_sort_idx on public.business_service_types(business_id, sort_order, created_at);
create index if not exists business_pipeline_statuses_business_sort_idx on public.business_pipeline_statuses(business_id, sort_order, created_at);
create index if not exists business_dashboard_widgets_business_sort_idx on public.business_dashboard_widgets(business_id, sort_order, created_at);

drop trigger if exists business_service_types_set_updated_at on public.business_service_types;
create trigger business_service_types_set_updated_at
before update on public.business_service_types
for each row execute function public.set_updated_at();

drop trigger if exists business_pipeline_statuses_set_updated_at on public.business_pipeline_statuses;
create trigger business_pipeline_statuses_set_updated_at
before update on public.business_pipeline_statuses
for each row execute function public.set_updated_at();

drop trigger if exists business_dashboard_widgets_set_updated_at on public.business_dashboard_widgets;
create trigger business_dashboard_widgets_set_updated_at
before update on public.business_dashboard_widgets
for each row execute function public.set_updated_at();

alter table public.business_service_types enable row level security;
alter table public.business_pipeline_statuses enable row level security;
alter table public.business_dashboard_widgets enable row level security;

revoke all on table public.business_service_types from anon, authenticated;
revoke all on table public.business_pipeline_statuses from anon, authenticated;
revoke all on table public.business_dashboard_widgets from anon, authenticated;

grant select, insert, update, delete on table public.business_service_types to authenticated;
grant select, insert, update, delete on table public.business_pipeline_statuses to authenticated;
grant select, insert, update, delete on table public.business_dashboard_widgets to authenticated;

drop policy if exists "Business members can manage service types." on public.business_service_types;
create policy "Business members can manage service types."
on public.business_service_types for all
to authenticated
using (private.is_business_member(business_id))
with check (private.is_business_member(business_id));

drop policy if exists "Business members can manage pipeline statuses." on public.business_pipeline_statuses;
create policy "Business members can manage pipeline statuses."
on public.business_pipeline_statuses for all
to authenticated
using (private.is_business_member(business_id))
with check (private.is_business_member(business_id));

drop policy if exists "Business members can manage dashboard widgets." on public.business_dashboard_widgets;
create policy "Business members can manage dashboard widgets."
on public.business_dashboard_widgets for all
to authenticated
using (private.is_business_member(business_id))
with check (private.is_business_member(business_id));

insert into public.business_service_types (business_id, key, label, sort_order)
select businesses.id, defaults.key, defaults.label, defaults.sort_order
from public.businesses
cross join (values
  ('garage_floor', 'Garage floor', 10),
  ('patio', 'Patio', 20),
  ('commercial_floor', 'Commercial floor', 30),
  ('basement', 'Basement', 40),
  ('other', 'Other', 50)
) as defaults(key, label, sort_order)
on conflict (business_id, key) do nothing;

insert into public.business_pipeline_statuses (business_id, key, label, semantic_type, sort_order)
select businesses.id, defaults.key, defaults.label, defaults.semantic_type, defaults.sort_order
from public.businesses
cross join (values
  ('lead', 'Lead', 'lead', 10),
  ('contacted', 'Contacted', 'contacted', 20),
  ('quoted', 'Quoted', 'quoted', 30),
  ('scheduled', 'Scheduled', 'scheduled', 40),
  ('in_progress', 'In Progress', 'in_progress', 50),
  ('completed', 'Completed', 'completed', 60),
  ('lost', 'Lost', 'lost', 70)
) as defaults(key, label, semantic_type, sort_order)
on conflict (business_id, key) do nothing;

insert into public.business_dashboard_widgets (business_id, widget_key, sort_order)
select businesses.id, defaults.widget_key, defaults.sort_order
from public.businesses
cross join (values
  ('new_leads', 10),
  ('scheduled', 20),
  ('in_progress', 30),
  ('open_pipeline', 40),
  ('quoted', 50),
  ('completed', 60),
  ('avg_job', 70),
  ('needs_attention', 80),
  ('active_job_board', 90),
  ('upcoming', 100)
) as defaults(widget_key, sort_order)
on conflict (business_id, widget_key) do nothing;

drop function if exists public.get_public_intake_form(text);

create or replace function public.get_public_intake_form(business_slug text)
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  target_business public.businesses;
begin
  select *
  into target_business
  from public.businesses
  where businesses.slug = public.slugify(business_slug)
  limit 1;

  if target_business.id is null or target_business.intake_form_enabled is not true then
    return jsonb_build_object('ok', false);
  end if;

  return jsonb_build_object(
    'ok', true,
    'business_name', target_business.name,
    'title', target_business.intake_form_title,
    'description', target_business.intake_form_description,
    'service_types', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'key', business_service_types.key,
          'label', business_service_types.label,
          'sort_order', business_service_types.sort_order
        )
        order by business_service_types.sort_order, business_service_types.created_at
      )
      from public.business_service_types
      where business_service_types.business_id = target_business.id
        and business_service_types.enabled is true
    ), '[]'::jsonb),
    'fields', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', intake_fields.id,
          'field_key', intake_fields.field_key,
          'label', intake_fields.label,
          'field_type', intake_fields.field_type,
          'required', intake_fields.required,
          'options', intake_fields.options,
          'sort_order', intake_fields.sort_order
        )
        order by intake_fields.sort_order, intake_fields.created_at
      )
      from public.intake_fields
      where intake_fields.business_id = target_business.id
        and intake_fields.enabled is true
    ), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.get_public_intake_form(text) to anon, authenticated;
