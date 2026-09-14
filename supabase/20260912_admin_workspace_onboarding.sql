alter table public.businesses add column if not exists client_owner_email text;

alter table public.businesses drop constraint if exists businesses_client_owner_email_check;
alter table public.businesses add constraint businesses_client_owner_email_check
check (
  client_owner_email is null
  or client_owner_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
);

drop policy if exists "Business members can manage follow-up settings." on public.business_followup_settings;
create policy "Business members can manage follow-up settings."
on public.business_followup_settings for all
to authenticated
using (private.is_business_member(business_id) or private.is_platform_admin())
with check (private.is_business_member(business_id) or private.is_platform_admin());

create or replace function public.platform_admin_create_workspace(
  workspace_name text,
  workspace_slug text,
  primary_owner_email text default null,
  workspace_status text default 'trial'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_business_id uuid;
  normalized_slug text;
  clean_name text := trim(coalesce(workspace_name, ''));
  clean_owner_email text := nullif(lower(trim(coalesce(primary_owner_email, ''))), '');
  clean_status text := lower(trim(coalesce(workspace_status, 'trial')));
begin
  if not private.is_platform_admin() then
    return jsonb_build_object('ok', false, 'code', 'forbidden', 'message', 'Only platform admins can create workspaces.');
  end if;

  normalized_slug := public.slugify(workspace_slug);

  if char_length(clean_name) < 2 or char_length(clean_name) > 120 then
    return jsonb_build_object('ok', false, 'code', 'invalid_name', 'message', 'Workspace name must be 2-120 characters.');
  end if;

  if normalized_slug !~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_slug', 'message', 'Use a slug like north-texas-roofing.');
  end if;

  if exists (select 1 from public.businesses where slug = normalized_slug) then
    return jsonb_build_object('ok', false, 'code', 'duplicate_slug', 'message', 'That workspace slug is already in use.');
  end if;

  if clean_status not in ('active', 'trial', 'paused') then
    clean_status := 'trial';
  end if;

  if clean_owner_email is not null and clean_owner_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_owner_email', 'message', 'Enter a valid owner email or leave it blank.');
  end if;

  insert into public.businesses (
    name,
    slug,
    created_by,
    workspace_status,
    client_owner_email,
    intake_form_enabled,
    intake_form_title,
    intake_form_description
  )
  values (
    clean_name,
    normalized_slug,
    (select auth.uid()),
    clean_status,
    clean_owner_email,
    true,
    'Tell us about your project',
    'Share a few details and our team will follow up with next steps.'
  )
  returning id into created_business_id;

  insert into public.business_service_types (business_id, key, label, sort_order)
  values
    (created_business_id, 'site_visit', 'Site visit', 10),
    (created_business_id, 'new_install', 'New installation', 20),
    (created_business_id, 'repair', 'Repair', 30),
    (created_business_id, 'maintenance', 'Maintenance', 40),
    (created_business_id, 'consultation', 'Consultation', 50),
    (created_business_id, 'other', 'Other', 60);

  insert into public.business_pipeline_statuses (business_id, key, label, semantic_type, sort_order)
  values
    (created_business_id, 'lead', 'Lead', 'lead', 10),
    (created_business_id, 'contacted', 'Contacted', 'contacted', 20),
    (created_business_id, 'quoted', 'Quoted', 'quoted', 30),
    (created_business_id, 'scheduled', 'Scheduled', 'scheduled', 40),
    (created_business_id, 'in_progress', 'In Progress', 'in_progress', 50),
    (created_business_id, 'completed', 'Completed', 'completed', 60),
    (created_business_id, 'lost', 'Lost', 'lost', 70);

  insert into public.business_dashboard_widgets (business_id, widget_key, sort_order)
  values
    (created_business_id, 'new_leads', 10),
    (created_business_id, 'scheduled', 20),
    (created_business_id, 'in_progress', 30),
    (created_business_id, 'open_pipeline', 40),
    (created_business_id, 'quoted', 50),
    (created_business_id, 'completed', 60),
    (created_business_id, 'avg_job', 70),
    (created_business_id, 'needs_attention', 80),
    (created_business_id, 'active_job_board', 90),
    (created_business_id, 'upcoming', 100);

  insert into public.business_terminology (
    business_id,
    job_singular,
    job_plural,
    customer_singular,
    customer_plural,
    quote_singular,
    quote_plural,
    active_board_title,
    upcoming_title,
    new_job_button_label,
    new_customer_button_label
  )
  values (
    created_business_id,
    'Job',
    'Jobs',
    'Customer',
    'Customers',
    'Quote',
    'Quotes',
    'Active job board',
    'Upcoming',
    'New Job',
    'New Customer'
  );

  insert into public.business_followup_settings (
    business_id,
    new_lead_followup_hours,
    contacted_followup_days,
    proposal_followup_days,
    stale_opportunity_days,
    reminders_enabled
  )
  values (created_business_id, 24, 3, 3, 7, true);

  insert into public.platform_admin_audit_logs (
    platform_admin_user_id,
    business_id,
    action,
    entity_type,
    metadata
  )
  values (
    (select auth.uid()),
    created_business_id,
    'workspace_created',
    'business',
    jsonb_build_object('name', clean_name, 'slug', normalized_slug, 'workspace_status', clean_status, 'client_owner_email', clean_owner_email)
  );

  return jsonb_build_object(
    'ok', true,
    'business_id', created_business_id,
    'slug', normalized_slug
  );
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'code', 'duplicate', 'message', 'That workspace could not be created because a unique value already exists.');
  when others then
    raise;
end;
$$;

grant execute on function public.platform_admin_create_workspace(text, text, text, text) to authenticated;

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
          'owner_email', coalesce(businesses.client_owner_email, owner_users.email),
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
      'owner_email', coalesce(target_business.client_owner_email, (select email from auth.users where id = target_business.created_by)),
      'member_count', (select count(*)::int from public.business_members where business_id = target_business.id),
      'customer_count', (select count(*)::int from public.customers where business_id = target_business.id),
      'job_count', (select count(*)::int from public.jobs where business_id = target_business.id),
      'last_activity_at', (select max(created_at) from public.job_activity where business_id = target_business.id)
    ),
    'terminology', public.workspace_terminology_json(target_business.id),
    'services', coalesce((select jsonb_agg(to_jsonb(s) order by s.sort_order, s.created_at) from public.business_service_types s where s.business_id = target_business.id), '[]'::jsonb),
    'pipeline', coalesce((select jsonb_agg(to_jsonb(p) order by p.sort_order, p.created_at) from public.business_pipeline_statuses p where p.business_id = target_business.id), '[]'::jsonb),
    'dashboard_widgets', coalesce((select jsonb_agg(to_jsonb(w) order by w.sort_order, w.created_at) from public.business_dashboard_widgets w where w.business_id = target_business.id), '[]'::jsonb),
    'followup_settings', (select to_jsonb(f) from public.business_followup_settings f where f.business_id = target_business.id),
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
