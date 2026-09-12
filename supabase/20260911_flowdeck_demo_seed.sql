begin;

do $$
declare
  flowdeck_business_id uuid := 'd1af64b8-8f24-4ee0-86ca-f61ee1f7950c';
  removed_jobs integer := 0;
  removed_customers integer := 0;
begin
  if not exists (
    select 1
    from public.businesses
    where id = flowdeck_business_id
      and name = 'FlowDeck'
      and slug = 'testing-business'
  ) then
    raise exception 'FlowDeck workspace identity check failed. Aborting seed.';
  end if;

  create temporary table flowdeck_demo_customers (
    name text primary key,
    email text not null,
    phone text not null,
    address_line1 text not null,
    city text not null,
    state text not null,
    postal_code text not null,
    notes text
  ) on commit drop;

  create temporary table flowdeck_demo_jobs (
    customer_name text not null,
    title text primary key,
    description text not null,
    status text not null check (status in ('lead', 'contacted', 'quoted', 'scheduled', 'in_progress', 'completed', 'lost')),
    price_cents integer not null,
    revenue_cents bigint not null,
    source text not null,
    project_type text not null,
    scheduled_start timestamptz,
    scheduled_end timestamptz,
    preferred_date date,
    first_contact_at timestamptz,
    quote_sent_at timestamptz,
    won_at timestamptz,
    next_follow_up_at timestamptz,
    lost_at timestamptz,
    completed_at timestamptz,
    lost_reason text,
    job_address text not null,
    internal_notes text
  ) on commit drop;

  insert into flowdeck_demo_customers (name, email, phone, address_line1, city, state, postal_code, notes)
  values
    ('DFW Detail Co.', 'ops@dfwdetail.example', '214-555-0181', '4201 Commerce St', 'Dallas', 'TX', '75226', 'Mobile detailing operator evaluating lead follow-up and scheduling.'),
    ('Prime Painting', 'hello@primepainting.example', '469-555-0124', '1800 Main St', 'Plano', 'TX', '75074', 'Painting contractor with multiple crews and repeat customer work.'),
    ('Metro Cleaning', 'admin@metrocleaning.example', '972-555-0168', '2600 Market Center Blvd', 'Dallas', 'TX', '75207', 'Commercial cleaning company comparing pipeline and calendar workflows.'),
    ('Rapid Wash', 'team@rapidwash.example', '817-555-0117', '905 W Magnolia Ave', 'Fort Worth', 'TX', '76104', 'Pressure washing business focused on missed follow-ups.'),
    ('Lone Star Services', 'owner@lonestarservices.example', '214-555-0142', '1200 Legacy Dr', 'Frisco', 'TX', '75034', 'General service company interested in dashboards and source tracking.'),
    ('North Texas Roofing', 'sales@northtxroofing.example', '940-555-0193', '3100 Teasley Ln', 'Denton', 'TX', '76205', 'Roofing team with inbound web leads and estimate coordination.'),
    ('ClearView Windows', 'support@clearviewwindows.example', '972-555-0139', '7600 Windrose Ave', 'Plano', 'TX', '75024', 'Window cleaning operator ready for onboarding.'),
    ('Apex Landscaping', 'office@apexlandscaping.example', '214-555-0176', '330 Bishop Ave', 'Dallas', 'TX', '75208', 'Landscaping business needs crew schedule visibility.'),
    ('Dallas Mobile Detail', 'booking@dallasmobiledetail.example', '469-555-0155', '1550 Dragon St', 'Dallas', 'TX', '75207', 'Repeat-service prospect looking for automated follow-up.'),
    ('Summit Home Services', 'contact@summithome.example', '817-555-0188', '500 W 7th St', 'Fort Worth', 'TX', '76102', 'Multi-service home operator reviewing implementation plan.');

  insert into flowdeck_demo_jobs (
    customer_name, title, description, status, price_cents, revenue_cents, source, project_type,
    scheduled_start, scheduled_end, preferred_date, first_contact_at, quote_sent_at, won_at,
    next_follow_up_at, lost_at, completed_at, lost_reason, job_address, internal_notes
  )
  values
    ('DFW Detail Co.', 'Lead capture and intake setup', 'Replace spreadsheet inquiries with a public intake form and organized follow-up queue.', 'lead', 150000, 0, 'website_form', 'SaaS Setup', null, null, '2026-09-18', null, null, null, null, null, null, null, '4201 Commerce St, Dallas, TX 75226', 'New inbound prospect. Needs first response.'),
    ('North Texas Roofing', 'Storm lead response workflow', 'Build a faster lead response workflow for storm-season estimate requests.', 'lead', 250000, 0, 'google', 'Workflow Configuration', null, null, '2026-09-19', null, null, null, null, null, null, null, '3100 Teasley Ln, Denton, TX 76205', 'High-value inbound lead from search.'),
    ('Rapid Wash', 'Follow-up pipeline cleanup', 'Move pressure washing quotes out of notes and into a simple status-driven pipeline.', 'contacted', 120000, 0, 'instagram', 'Workflow Configuration', null, null, '2026-09-20', '2026-09-08 15:20+00', null, null, '2026-09-10 15:00+00', null, null, null, '905 W Magnolia Ave, Fort Worth, TX 76104', 'Follow-up is overdue; owner asked for examples.'),
    ('Dallas Mobile Detail', 'Repeat customer reminder workflow', 'Create a lightweight repeat-customer workflow for recurring detail reminders.', 'contacted', 180000, 0, 'repeat_customer', 'Automation Setup', null, null, '2026-09-24', '2026-09-10 17:00+00', null, null, '2026-09-15 16:30+00', null, null, null, '1550 Dragon St, Dallas, TX 75207', 'Interested in automation but not ready for proposal yet.'),
    ('Prime Painting', 'Proposal and scheduling dashboard', 'Configure proposal tracking, scheduling, and owner-level dashboard views.', 'quoted', 300000, 0, 'referral', 'Custom Dashboard', null, null, '2026-09-22', '2026-09-07 14:00+00', '2026-09-09 16:00+00', null, '2026-09-12 15:00+00', null, null, null, '1800 Main St, Plano, TX 75074', 'Proposal sent; decision expected this week.'),
    ('Apex Landscaping', 'Crew calendar and proposal flow', 'Set up a calendar view and proposal handoff workflow for seasonal landscaping projects.', 'quoted', 450000, 0, 'facebook', 'Custom Implementation', null, null, '2026-09-23', '2026-09-06 18:00+00', '2026-09-08 20:00+00', null, '2026-09-11 17:00+00', null, null, null, '330 Bishop Ave, Dallas, TX 75208', 'Sent proposal after discovery call.'),
    ('Metro Cleaning', 'Onboarding kickoff for operations dashboard', 'Initial onboarding session for managers and cleaning crew schedule setup.', 'scheduled', 250000, 250000, 'phone', 'Team Onboarding', '2026-09-16 15:00+00', '2026-09-16 16:30+00', '2026-09-16', '2026-09-05 15:00+00', '2026-09-06 16:00+00', '2026-09-09 18:00+00', null, null, null, null, '2600 Market Center Blvd, Dallas, TX 75207', 'Kickoff scheduled with operations manager.'),
    ('Lone Star Services', 'Source tracking implementation', 'Implement lead source tracking and dashboard reporting for weekly owner reviews.', 'in_progress', 500000, 500000, 'manual', 'Custom Dashboard', '2026-09-12 16:00+00', '2026-09-12 18:00+00', '2026-09-12', '2026-09-02 15:00+00', '2026-09-03 16:00+00', '2026-09-04 18:00+00', null, null, null, null, '1200 Legacy Dr, Frisco, TX 75034', 'Implementation underway. Source report is the key outcome.'),
    ('ClearView Windows', 'Client onboarding automation', 'Configure intake, reminders, and basic scheduling workflow for recurring window jobs.', 'in_progress', 300000, 300000, 'referral', 'Automation Setup', '2026-09-15 14:00+00', '2026-09-15 17:00+00', '2026-09-15', '2026-09-01 17:00+00', '2026-09-02 17:30+00', '2026-09-03 19:00+00', null, null, null, null, '7600 Windrose Ave, Plano, TX 75024', 'Configuration review scheduled before go-live.'),
    ('Summit Home Services', 'Multi-service workflow launch', 'Launch a single pipeline for multiple home-service offerings with source reporting.', 'completed', 500000, 500000, 'google', 'Custom Implementation', '2026-09-09 15:00+00', '2026-09-09 17:00+00', '2026-09-09', '2026-08-29 16:00+00', '2026-08-30 15:00+00', '2026-09-01 18:00+00', null, null, '2026-09-10 20:00+00', null, '500 W 7th St, Fort Worth, TX 76102', 'Went live with owner dashboard and pipeline.'),
    ('Metro Cleaning', 'Manager dashboard add-on', 'Add a focused operations dashboard for area managers.', 'completed', 180000, 180000, 'repeat_customer', 'Custom Dashboard', '2026-09-08 14:00+00', '2026-09-08 16:00+00', '2026-09-08', '2026-08-26 16:00+00', '2026-08-27 15:00+00', '2026-08-28 19:00+00', null, null, '2026-09-09 18:30+00', null, '2600 Market Center Blvd, Dallas, TX 75207', 'Small expansion after initial onboarding.'),
    ('ClearView Windows', 'Advanced reporting package', 'Evaluate deeper analytics and conversion reporting for the next phase.', 'lost', 0, 0, 'manual', 'Custom Dashboard', null, null, '2026-09-17', '2026-08-31 15:30+00', '2026-09-01 15:30+00', null, null, '2026-09-10 16:00+00', null, 'timing', '7600 Windrose Ave, Plano, TX 75024', 'Closed for now; customer wants to revisit next quarter.');

  with demo_jobs as (
    select jobs.id
    from public.jobs
    left join public.customers on customers.id = jobs.customer_id
    where jobs.business_id = flowdeck_business_id
      and (
        jobs.title ilike any (array['%QA%', '%Epoxy%', '%Garage floor%', '%Patio%', '%Flake%', '%Browser Flow%', '%Lifecycle QA%', '%Photo QA%', '%Public Message%', '%Expired Quote%', '%Source Public%'])
        or jobs.description ilike any (array['%QA%', '%epoxy%', '%flooring%', '%photo audit%', '%public intake photo%'])
        or jobs.project_type ilike any (array['%Garage floor%', '%Patio%', '%Commercial floor%', '%Basement%'])
        or customers.name ilike any (array['%QA%', '%Bob Shmob%', '%Browser Flow%', '%Photo QA%', '%Morgan Intake%', '%Source Public%'])
      )
  ),
  deleted_quote_messages as (
    delete from public.quote_messages
    where business_id = flowdeck_business_id
      and job_id in (select id from demo_jobs)
  ),
  deleted_quotes as (
    delete from public.quotes
    where business_id = flowdeck_business_id
      and job_id in (select id from demo_jobs)
  ),
  deleted_files as (
    delete from public.job_files
    where business_id = flowdeck_business_id
      and job_id in (select id from demo_jobs)
  ),
  deleted_activity as (
    delete from public.job_activity
    where business_id = flowdeck_business_id
      and job_id in (select id from demo_jobs)
  ),
  deleted_jobs as (
    delete from public.jobs
    where id in (select id from demo_jobs)
    returning id
  )
  select count(*) into removed_jobs from deleted_jobs;

  with demo_customers as (
    select customers.id
    from public.customers
    where customers.business_id = flowdeck_business_id
      and not exists (
        select 1
        from public.jobs
        where jobs.customer_id = customers.id
      )
      and (
        customers.name ilike any (array['%QA%', '%Bob Shmob%', '%Browser Flow%', '%Photo QA%', '%Morgan Intake%', '%Source Public%', 'testing'])
        or customers.email ilike any (array['%qa%', '%example.com%', 'bilalnachef1@gmail.com'])
      )
  ),
  deleted_customers as (
    delete from public.customers
    where id in (select id from demo_customers)
    returning id
  )
  select count(*) into removed_customers from deleted_customers;

  with inserted_customers as (
    insert into public.customers (
      business_id, name, email, phone, address_line1, city, state, postal_code, notes
    )
    select flowdeck_business_id, name, email, phone, address_line1, city, state, postal_code, notes
    from flowdeck_demo_customers
    where not exists (
      select 1
      from public.customers existing
      where existing.business_id = flowdeck_business_id
        and existing.name = flowdeck_demo_customers.name
    )
    returning id, name
  ),
  all_seed_customers as (
    select id, name from inserted_customers
    union all
    select id, name
    from public.customers
    where business_id = flowdeck_business_id
      and name in (select name from flowdeck_demo_customers)
  ),
  updated_existing_jobs as (
    update public.jobs existing
    set
      description = demo_jobs.description,
      notes = demo_jobs.description,
      status = demo_jobs.status,
      price_cents = demo_jobs.price_cents,
      revenue_cents = demo_jobs.revenue_cents,
      source = demo_jobs.source,
      project_type = demo_jobs.project_type,
      scheduled_start = demo_jobs.scheduled_start,
      scheduled_end = demo_jobs.scheduled_end,
      preferred_date = demo_jobs.preferred_date,
      first_contact_at = demo_jobs.first_contact_at,
      quote_sent_at = demo_jobs.quote_sent_at,
      won_at = demo_jobs.won_at,
      next_follow_up_at = demo_jobs.next_follow_up_at,
      lost_at = demo_jobs.lost_at,
      completed_at = demo_jobs.completed_at,
      lost_reason = demo_jobs.lost_reason,
      job_address = demo_jobs.job_address,
      site_address = demo_jobs.job_address,
      internal_notes = demo_jobs.internal_notes,
      updated_at = now()
    from flowdeck_demo_jobs demo_jobs
    where existing.business_id = flowdeck_business_id
      and existing.title = demo_jobs.title
    returning existing.id, existing.title, existing.status, existing.price_cents, existing.quote_sent_at, existing.won_at, existing.lost_at, existing.completed_at
  ),
  inserted_jobs as (
    insert into public.jobs (
      business_id,
      customer_id,
      customer_name,
      customer_email,
      customer_phone,
      title,
      job_title,
      description,
      notes,
      status,
      price_cents,
      revenue_cents,
      source,
      project_type,
      scheduled_start,
      scheduled_end,
      preferred_date,
      first_contact_at,
      quote_sent_at,
      won_at,
      next_follow_up_at,
      lost_at,
      completed_at,
      lost_reason,
      job_address,
      site_address,
      internal_notes
    )
    select
      flowdeck_business_id,
      customers.id,
      customers.name,
      demo_customers.email,
      demo_customers.phone,
      demo_jobs.title,
      demo_jobs.title,
      demo_jobs.description,
      demo_jobs.description,
      demo_jobs.status,
      demo_jobs.price_cents,
      demo_jobs.revenue_cents,
      demo_jobs.source,
      demo_jobs.project_type,
      demo_jobs.scheduled_start,
      demo_jobs.scheduled_end,
      demo_jobs.preferred_date,
      demo_jobs.first_contact_at,
      demo_jobs.quote_sent_at,
      demo_jobs.won_at,
      demo_jobs.next_follow_up_at,
      demo_jobs.lost_at,
      demo_jobs.completed_at,
      demo_jobs.lost_reason,
      demo_jobs.job_address,
      demo_jobs.job_address,
      demo_jobs.internal_notes
    from flowdeck_demo_jobs demo_jobs
    join flowdeck_demo_customers demo_customers on demo_customers.name = demo_jobs.customer_name
    join all_seed_customers customers on customers.name = demo_jobs.customer_name
    where not exists (
      select 1
      from public.jobs existing
      where existing.business_id = flowdeck_business_id
        and existing.title = demo_jobs.title
    )
    returning id, title, status, price_cents, quote_sent_at, won_at, lost_at, completed_at
  ),
  all_seed_jobs as (
    select id, title, status, price_cents, quote_sent_at, won_at, lost_at, completed_at
    from inserted_jobs
    union all
    select id, title, status, price_cents, quote_sent_at, won_at, lost_at, completed_at
    from updated_existing_jobs
  ),
  updated_existing_quotes as (
    update public.quotes existing
    set
      amount_cents = seed_jobs.price_cents,
      status = case
        when seed_jobs.status in ('scheduled', 'in_progress', 'completed') then 'accepted'
        when seed_jobs.status = 'lost' then 'declined'
        else 'sent'
      end,
      sent_at = coalesce(seed_jobs.quote_sent_at, existing.sent_at, now() - interval '5 days'),
      accepted_at = case when seed_jobs.status in ('scheduled', 'in_progress', 'completed') then seed_jobs.won_at else null end,
      declined_at = case when seed_jobs.status = 'lost' then seed_jobs.lost_at else null end,
      valid_until = current_date + 14,
      updated_at = now()
    from all_seed_jobs seed_jobs
    where existing.business_id = flowdeck_business_id
      and existing.job_id = seed_jobs.id
    returning existing.id
  ),
  inserted_quotes as (
    insert into public.quotes (
      business_id, job_id, amount_cents, notes, status, sent_at, accepted_at, declined_at, valid_until
    )
    select
      flowdeck_business_id,
      seed_jobs.id,
      seed_jobs.price_cents,
      case
        when seed_jobs.status = 'quoted' then 'FlowDeck proposal scope and setup plan.'
        when seed_jobs.status = 'completed' then 'Accepted FlowDeck implementation package.'
        when seed_jobs.status = 'lost' then 'Declined reporting expansion proposal.'
        else 'FlowDeck onboarding scope.'
      end,
      case
        when seed_jobs.status in ('scheduled', 'in_progress', 'completed') then 'accepted'
        when seed_jobs.status = 'lost' then 'declined'
        else 'sent'
      end,
      coalesce(seed_jobs.quote_sent_at, now() - interval '5 days'),
      case when seed_jobs.status in ('scheduled', 'in_progress', 'completed') then seed_jobs.won_at else null end,
      case when seed_jobs.status = 'lost' then seed_jobs.lost_at else null end,
      current_date + 14
    from all_seed_jobs seed_jobs
    where seed_jobs.status in ('quoted', 'scheduled', 'in_progress', 'completed', 'lost')
      and not exists (
        select 1
        from public.quotes
        where quotes.business_id = flowdeck_business_id
          and quotes.job_id = seed_jobs.id
      )
    returning id
  )
  insert into public.job_activity (business_id, job_id, event_type, message, metadata, created_at)
  select flowdeck_business_id, seed_jobs.id, activity.event_type, activity.message, '{}'::jsonb, activity.created_at
  from all_seed_jobs seed_jobs
  cross join lateral (
    values
      ('lead_created', 'Prospect created.', coalesce(seed_jobs.quote_sent_at, seed_jobs.won_at, seed_jobs.completed_at, seed_jobs.lost_at, now()) - interval '6 days'),
      ('contacted', 'First contact recorded.', coalesce(seed_jobs.quote_sent_at, seed_jobs.won_at, seed_jobs.completed_at, seed_jobs.lost_at, now()) - interval '5 days'),
      ('quote_sent', 'Proposal sent.', seed_jobs.quote_sent_at),
      ('quote_accepted', 'Proposal accepted.', seed_jobs.won_at),
      ('scheduled', 'Onboarding scheduled.', case when seed_jobs.status in ('scheduled', 'in_progress', 'completed') then seed_jobs.won_at + interval '1 day' else null end),
      ('started', 'Implementation started.', case when seed_jobs.status in ('in_progress', 'completed') then coalesce(seed_jobs.won_at, now()) + interval '2 days' else null end),
      ('completed', 'Client went live.', seed_jobs.completed_at),
      ('lost', 'Opportunity closed lost.', seed_jobs.lost_at)
  ) as activity(event_type, message, created_at)
  where activity.created_at is not null
    and not exists (
      select 1
      from public.job_activity existing
      where existing.business_id = flowdeck_business_id
        and existing.job_id = seed_jobs.id
        and existing.event_type = activity.event_type
        and existing.message = activity.message
    );

  raise notice 'FlowDeck cleanup removed % obvious demo jobs and % orphan demo customers.', removed_jobs, removed_customers;
end $$;

commit;
