create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.platform_admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  platform_admin_user_id uuid not null references auth.users(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  action text not null,
  entity_type text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.businesses add column if not exists workspace_status text not null default 'active';
alter table public.businesses drop constraint if exists businesses_workspace_status_check;
alter table public.businesses add constraint businesses_workspace_status_check
check (workspace_status in ('active', 'trial', 'paused'));

create or replace function private.is_platform_admin()
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.platform_admins
    where platform_admins.user_id = (select auth.uid())
  );
$$;

create or replace function public.is_platform_admin()
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select private.is_platform_admin();
$$;

create or replace function public.platform_admin_log(
  target_business_id uuid,
  action text,
  entity_type text,
  metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_platform_admin() then
    raise exception 'not authorized';
  end if;

  insert into public.platform_admin_audit_logs (
    platform_admin_user_id,
    business_id,
    action,
    entity_type,
    metadata
  )
  values (
    (select auth.uid()),
    target_business_id,
    left(action, 80),
    left(entity_type, 80),
    coalesce(metadata, '{}'::jsonb)
  );
end;
$$;

alter table public.platform_admins enable row level security;
alter table public.platform_admin_audit_logs enable row level security;

revoke all on table public.platform_admins from anon, authenticated;
revoke all on table public.platform_admin_audit_logs from anon, authenticated;
grant select on table public.platform_admins to authenticated;
grant select on table public.platform_admin_audit_logs to authenticated;

drop policy if exists "Platform admins can view platform admins." on public.platform_admins;
create policy "Platform admins can view platform admins."
on public.platform_admins for select
to authenticated
using (private.is_platform_admin());

drop policy if exists "Platform admins can view audit logs." on public.platform_admin_audit_logs;
create policy "Platform admins can view audit logs."
on public.platform_admin_audit_logs for select
to authenticated
using (private.is_platform_admin());

grant execute on function public.is_platform_admin() to authenticated;
grant execute on function public.platform_admin_log(uuid, text, text, jsonb) to authenticated;

drop policy if exists "Business members can view businesses." on public.businesses;
create policy "Business members can view businesses."
on public.businesses for select
to authenticated
using (private.is_business_member(id) or created_by = (select auth.uid()) or private.is_platform_admin());

drop policy if exists "Business owners can update businesses." on public.businesses;
create policy "Business owners can update businesses."
on public.businesses for update
to authenticated
using ((select auth.uid()) = created_by or private.is_platform_admin())
with check ((select auth.uid()) = created_by or private.is_platform_admin());

drop policy if exists "Business members can view memberships." on public.business_members;
create policy "Business members can view memberships."
on public.business_members for select
to authenticated
using (private.is_business_member(business_id) or private.is_platform_admin());

drop policy if exists "Business members can manage customers." on public.customers;
create policy "Business members can manage customers."
on public.customers for all
to authenticated
using (private.is_business_member(business_id) or private.is_platform_admin())
with check (private.is_business_member(business_id) or private.is_platform_admin());

drop policy if exists "Business members can view jobs." on public.jobs;
create policy "Business members can view jobs."
on public.jobs for select
to authenticated
using (private.is_business_member(business_id) or private.is_platform_admin());

drop policy if exists "Business members can create jobs." on public.jobs;
create policy "Business members can create jobs."
on public.jobs for insert
to authenticated
with check (
  (private.is_business_member(business_id) or private.is_platform_admin())
  and exists (
    select 1
    from public.customers
    where customers.id = jobs.customer_id
      and customers.business_id = jobs.business_id
  )
);

drop policy if exists "Business members can update jobs." on public.jobs;
create policy "Business members can update jobs."
on public.jobs for update
to authenticated
using (private.is_business_member(business_id) or private.is_platform_admin())
with check (
  (private.is_business_member(business_id) or private.is_platform_admin())
  and (customer_id is null or exists (
    select 1
    from public.customers
    where customers.id = jobs.customer_id
      and customers.business_id = jobs.business_id
  ))
);

drop policy if exists "Business members can manage job activity." on public.job_activity;
create policy "Business members can manage job activity."
on public.job_activity for all
to authenticated
using (private.is_business_member(business_id) or private.is_platform_admin())
with check (
  private.is_business_member(business_id)
  or private.is_platform_admin()
);

drop policy if exists "Business members can manage quotes." on public.quotes;
create policy "Business members can manage quotes."
on public.quotes for all
to authenticated
using (private.is_business_member(business_id) or private.is_platform_admin())
with check (
  (private.is_business_member(business_id) or private.is_platform_admin())
  and exists (
    select 1
    from public.jobs
    where jobs.id = quotes.job_id
      and jobs.business_id = quotes.business_id
  )
);

drop policy if exists "Business members can manage terminology." on public.business_terminology;
create policy "Business members can manage terminology."
on public.business_terminology for all
to authenticated
using (private.is_business_member(business_id) or private.is_platform_admin())
with check (private.is_business_member(business_id) or private.is_platform_admin());

drop policy if exists "Business members can manage service types." on public.business_service_types;
create policy "Business members can manage service types."
on public.business_service_types for all
to authenticated
using (private.is_business_member(business_id) or private.is_platform_admin())
with check (private.is_business_member(business_id) or private.is_platform_admin());

drop policy if exists "Business members can manage pipeline statuses." on public.business_pipeline_statuses;
create policy "Business members can manage pipeline statuses."
on public.business_pipeline_statuses for all
to authenticated
using (private.is_business_member(business_id) or private.is_platform_admin())
with check (private.is_business_member(business_id) or private.is_platform_admin());

drop policy if exists "Business members can manage dashboard widgets." on public.business_dashboard_widgets;
create policy "Business members can manage dashboard widgets."
on public.business_dashboard_widgets for all
to authenticated
using (private.is_business_member(business_id) or private.is_platform_admin())
with check (private.is_business_member(business_id) or private.is_platform_admin());

create or replace function public.platform_admin_workspaces()
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  if not private.is_platform_admin() then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;

  return jsonb_build_object(
    'ok', true,
    'workspaces', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', businesses.id,
          'name', businesses.name,
          'slug', businesses.slug,
          'workspace_status', businesses.workspace_status,
          'intake_form_enabled', businesses.intake_form_enabled,
          'created_at', businesses.created_at,
          'owner_email', owner_users.email,
          'member_count', coalesce(members.member_count, 0),
          'customer_count', coalesce(customers.customer_count, 0),
          'job_count', coalesce(jobs.job_count, 0),
          'last_activity_at', activity.last_activity_at,
          'terminology_custom', coalesce(terms.terminology_custom, false),
          'service_count', coalesce(services.service_count, 0),
          'pipeline_count', coalesce(pipeline.pipeline_count, 0),
          'dashboard_count', coalesce(widgets.dashboard_count, 0)
        )
        order by coalesce(activity.last_activity_at, businesses.created_at) desc
      )
      from public.businesses
      left join auth.users owner_users on owner_users.id = businesses.created_by
      left join lateral (
        select count(*)::int as member_count from public.business_members where business_members.business_id = businesses.id
      ) members on true
      left join lateral (
        select count(*)::int as customer_count from public.customers where customers.business_id = businesses.id
      ) customers on true
      left join lateral (
        select count(*)::int as job_count from public.jobs where jobs.business_id = businesses.id
      ) jobs on true
      left join lateral (
        select max(job_activity.created_at) as last_activity_at from public.job_activity where job_activity.business_id = businesses.id
      ) activity on true
      left join lateral (
        select count(*)::int as service_count from public.business_service_types where business_service_types.business_id = businesses.id and business_service_types.enabled is true
      ) services on true
      left join lateral (
        select count(*)::int as pipeline_count from public.business_pipeline_statuses where business_pipeline_statuses.business_id = businesses.id and business_pipeline_statuses.enabled is true
      ) pipeline on true
      left join lateral (
        select count(*)::int as dashboard_count from public.business_dashboard_widgets where business_dashboard_widgets.business_id = businesses.id and business_dashboard_widgets.enabled is true
      ) widgets on true
      left join lateral (
        select (
          business_terminology.job_singular <> 'Job'
          or business_terminology.job_plural <> 'Jobs'
          or business_terminology.customer_singular <> 'Customer'
          or business_terminology.customer_plural <> 'Customers'
          or business_terminology.quote_singular <> 'Quote'
          or business_terminology.quote_plural <> 'Quotes'
        ) as terminology_custom
        from public.business_terminology
        where business_terminology.business_id = businesses.id
        limit 1
      ) terms on true
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.platform_admin_workspace_detail(target_business_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  target_business public.businesses;
begin
  if not private.is_platform_admin() then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;

  select * into target_business from public.businesses where id = target_business_id;
  if target_business.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  return jsonb_build_object(
    'ok', true,
    'workspace', jsonb_build_object(
      'id', target_business.id,
      'name', target_business.name,
      'slug', target_business.slug,
      'workspace_status', target_business.workspace_status,
      'intake_form_enabled', target_business.intake_form_enabled,
      'intake_form_title', target_business.intake_form_title,
      'intake_form_description', target_business.intake_form_description,
      'created_at', target_business.created_at,
      'owner_email', (select email from auth.users where id = target_business.created_by),
      'member_count', (select count(*)::int from public.business_members where business_id = target_business.id),
      'customer_count', (select count(*)::int from public.customers where business_id = target_business.id),
      'job_count', (select count(*)::int from public.jobs where business_id = target_business.id),
      'last_activity_at', (select max(created_at) from public.job_activity where business_id = target_business.id)
    ),
    'terminology', public.workspace_terminology_json(target_business.id),
    'services', coalesce((select jsonb_agg(to_jsonb(s) order by s.sort_order, s.created_at) from public.business_service_types s where s.business_id = target_business.id), '[]'::jsonb),
    'pipeline', coalesce((select jsonb_agg(to_jsonb(p) order by p.sort_order, p.created_at) from public.business_pipeline_statuses p where p.business_id = target_business.id), '[]'::jsonb),
    'dashboard_widgets', coalesce((select jsonb_agg(to_jsonb(w) order by w.sort_order, w.created_at) from public.business_dashboard_widgets w where w.business_id = target_business.id), '[]'::jsonb),
    'audit_logs', coalesce((
      select jsonb_agg(to_jsonb(a) order by a.created_at desc)
      from (
        select platform_admin_audit_logs.id, platform_admin_audit_logs.platform_admin_user_id, platform_admin_audit_logs.action, platform_admin_audit_logs.entity_type, platform_admin_audit_logs.metadata, platform_admin_audit_logs.created_at
        from public.platform_admin_audit_logs
        where platform_admin_audit_logs.business_id = target_business.id
        order by platform_admin_audit_logs.created_at desc
        limit 8
      ) a
    ), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.platform_admin_workspaces() to authenticated;
grant execute on function public.platform_admin_workspace_detail(uuid) to authenticated;
