create table if not exists public.public_intake_attempts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  request_fingerprint_hash text not null,
  dedupe_key_hash text,
  outcome text not null default 'allowed',
  created_at timestamptz not null default now(),
  constraint public_intake_attempts_fingerprint_check check (length(request_fingerprint_hash) between 32 and 128),
  constraint public_intake_attempts_dedupe_key_check check (dedupe_key_hash is null or length(dedupe_key_hash) between 32 and 128),
  constraint public_intake_attempts_outcome_check check (outcome in ('allowed', 'rate_limited'))
);

create index if not exists public_intake_attempts_fingerprint_created_idx
on public.public_intake_attempts(business_id, request_fingerprint_hash, created_at desc);

create index if not exists public_intake_attempts_created_idx
on public.public_intake_attempts(created_at desc);

alter table public.public_intake_attempts enable row level security;
revoke all on table public.public_intake_attempts from anon, authenticated;

drop function if exists public.check_public_intake_throttle(text, text, text);

create or replace function public.check_public_intake_throttle(
  business_slug text,
  request_fingerprint_hash text,
  dedupe_key_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_business_id uuid;
  clean_fingerprint text := left(trim(coalesce(request_fingerprint_hash, '')), 128);
  clean_dedupe text := nullif(left(trim(coalesce(dedupe_key_hash, '')), 128), '');
  one_minute_count integer;
  ten_minute_count integer;
begin
  select businesses.id
  into target_business_id
  from public.businesses
  where businesses.slug = public.slugify(business_slug)
    and businesses.intake_form_enabled is true
  limit 1;

  if target_business_id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  if length(clean_fingerprint) < 32 then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;

  select count(*)::int
  into one_minute_count
  from public.public_intake_attempts
  where public_intake_attempts.business_id = target_business_id
    and public_intake_attempts.request_fingerprint_hash = clean_fingerprint
    and public_intake_attempts.created_at > now() - interval '1 minute';

  select count(*)::int
  into ten_minute_count
  from public.public_intake_attempts
  where public_intake_attempts.business_id = target_business_id
    and public_intake_attempts.request_fingerprint_hash = clean_fingerprint
    and public_intake_attempts.created_at > now() - interval '10 minutes';

  if one_minute_count >= 8 or ten_minute_count >= 25 then
    insert into public.public_intake_attempts (business_id, request_fingerprint_hash, dedupe_key_hash, outcome)
    values (target_business_id, clean_fingerprint, clean_dedupe, 'rate_limited');

    return jsonb_build_object('ok', false, 'code', 'rate_limited');
  end if;

  insert into public.public_intake_attempts (business_id, request_fingerprint_hash, dedupe_key_hash, outcome)
  values (target_business_id, clean_fingerprint, clean_dedupe, 'allowed');

  return jsonb_build_object('ok', true, 'business_id', target_business_id);
end;
$$;

grant execute on function public.check_public_intake_throttle(text, text, text) to anon, authenticated;

create or replace function public.submit_public_intake(
  business_slug text,
  full_name text,
  contact_email text,
  contact_phone text,
  service_type text,
  project_description text,
  street_address text,
  city text,
  state text,
  postal_code text,
  preferred_date date,
  square_feet integer,
  budget_range text,
  dedupe_key text,
  custom_data jsonb default '{}'::jsonb,
  intake_upload_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_business public.businesses;
  matched_customer public.customers;
  created_job public.jobs;
  normalized_phone text;
  normalized_email text;
  service_address text;
  existing_job_id uuid;
  cleaned_service text := nullif(trim(coalesce(service_type, '')), '');
begin
  select *
  into target_business
  from public.businesses
  where businesses.slug = public.slugify(business_slug)
  limit 1;

  if target_business.id is null or target_business.intake_form_enabled is not true then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  normalized_phone = nullif(regexp_replace(coalesce(contact_phone, ''), '\D', '', 'g'), '');
  if normalized_phone is not null and length(normalized_phone) = 11 and left(normalized_phone, 1) = '1' then
    normalized_phone = right(normalized_phone, 10);
  end if;
  normalized_email = nullif(lower(trim(coalesce(contact_email, ''))), '');

  if nullif(trim(coalesce(full_name, '')), '') is null
    or cleaned_service is null
    or nullif(trim(coalesce(project_description, '')), '') is null
    or (normalized_phone is null and normalized_email is null)
  then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;

  if length(trim(full_name)) > 120
    or length(coalesce(normalized_email, '')) > 180
    or length(coalesce(contact_phone, '')) > 40
    or length(cleaned_service) > 120
    or length(trim(project_description)) > 2000
    or length(coalesce(street_address, '')) > 180
    or length(coalesce(city, '')) > 80
    or length(coalesce(state, '')) > 40
    or length(coalesce(postal_code, '')) > 20
    or length(coalesce(budget_range, '')) > 80
  then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;

  if normalized_email is not null and normalized_email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_email');
  end if;

  if normalized_phone is not null and length(normalized_phone) < 7 then
    return jsonb_build_object('ok', false, 'code', 'invalid_phone');
  end if;

  if square_feet is not null and (square_feet < 0 or square_feet > 1000000) then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;

  if exists (
    select 1
    from public.business_service_types
    where business_service_types.business_id = target_business.id
      and business_service_types.enabled is true
  ) then
    if not exists (
      select 1
      from public.business_service_types
      where business_service_types.business_id = target_business.id
        and business_service_types.enabled is true
        and business_service_types.key = cleaned_service
    ) then
      return jsonb_build_object('ok', false, 'code', 'invalid_service');
    end if;
  elsif cleaned_service not in ('site_visit', 'new_install', 'repair', 'maintenance', 'consultation', 'other') then
    return jsonb_build_object('ok', false, 'code', 'invalid_service');
  end if;

  if jsonb_typeof(coalesce(custom_data, '{}'::jsonb)) <> 'object' then
    return jsonb_build_object('ok', false, 'code', 'invalid_custom_fields');
  end if;

  if exists (
    select 1
    from jsonb_object_keys(coalesce(custom_data, '{}'::jsonb)) as submitted(field_key)
    where not exists (
      select 1
      from public.intake_fields
      where intake_fields.business_id = target_business.id
        and intake_fields.enabled is true
        and intake_fields.field_key = submitted.field_key
    )
  ) then
    return jsonb_build_object('ok', false, 'code', 'invalid_custom_fields');
  end if;

  if exists (
    select 1
    from public.intake_fields
    where intake_fields.business_id = target_business.id
      and intake_fields.enabled is true
      and intake_fields.required is true
      and (
        not (coalesce(custom_data, '{}'::jsonb) ? intake_fields.field_key)
        or (
          intake_fields.field_type = 'checkbox'
          and lower(coalesce(custom_data->intake_fields.field_key->>'value', '')) <> 'true'
        )
        or (
          intake_fields.field_type <> 'checkbox'
          and nullif(trim(coalesce(custom_data->intake_fields.field_key->>'value', '')), '') is null
        )
      )
  ) then
    return jsonb_build_object('ok', false, 'code', 'missing_custom_fields');
  end if;

  if exists (
    select 1
    from public.intake_fields
    where intake_fields.business_id = target_business.id
      and intake_fields.enabled is true
      and coalesce(custom_data, '{}'::jsonb) ? intake_fields.field_key
      and (
        jsonb_typeof(custom_data->intake_fields.field_key) <> 'object'
        or custom_data->intake_fields.field_key->>'type' <> intake_fields.field_type
        or (
          intake_fields.field_type = 'select'
          and not (intake_fields.options ? coalesce(custom_data->intake_fields.field_key->>'value', ''))
        )
        or (
          intake_fields.field_type = 'short_text'
          and length(coalesce(custom_data->intake_fields.field_key->>'value', '')) > 240
        )
        or (
          intake_fields.field_type = 'long_text'
          and length(coalesce(custom_data->intake_fields.field_key->>'value', '')) > 1000
        )
        or (
          intake_fields.field_type = 'date'
          and coalesce(custom_data->intake_fields.field_key->>'value', '') !~ '^\d{4}-\d{2}-\d{2}$'
        )
      )
  ) then
    return jsonb_build_object('ok', false, 'code', 'invalid_custom_fields');
  end if;

  select jobs.id
  into existing_job_id
  from public.jobs
  where jobs.business_id = target_business.id
    and jobs.intake_dedupe_key = nullif(trim(coalesce(dedupe_key, '')), '')
  limit 1;

  if existing_job_id is not null then
    return jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'business_id', target_business.id,
      'job_id', existing_job_id
    );
  end if;

  if normalized_phone is not null then
    select *
    into matched_customer
    from public.customers
    where customers.business_id = target_business.id
      and (
        regexp_replace(coalesce(customers.phone, ''), '\D', '', 'g') = normalized_phone
        or (
          length(regexp_replace(coalesce(customers.phone, ''), '\D', '', 'g')) = 11
          and left(regexp_replace(coalesce(customers.phone, ''), '\D', '', 'g'), 1) = '1'
          and right(regexp_replace(coalesce(customers.phone, ''), '\D', '', 'g'), 10) = normalized_phone
        )
      )
    order by customers.updated_at desc
    limit 1;
  end if;

  if matched_customer.id is null and normalized_email is not null then
    select *
    into matched_customer
    from public.customers
    where customers.business_id = target_business.id
      and lower(trim(coalesce(customers.email, ''))) = normalized_email
    order by customers.updated_at desc
    limit 1;
  end if;

  if matched_customer.id is null then
    insert into public.customers (
      business_id,
      name,
      email,
      phone,
      address_line1,
      city,
      state,
      postal_code,
      notes
    )
    values (
      target_business.id,
      left(trim(submit_public_intake.full_name), 120),
      normalized_email,
      normalized_phone,
      nullif(left(trim(coalesce(submit_public_intake.street_address, '')), 180), ''),
      nullif(left(trim(coalesce(submit_public_intake.city, '')), 80), ''),
      nullif(left(trim(coalesce(submit_public_intake.state, '')), 40), ''),
      nullif(left(trim(coalesce(submit_public_intake.postal_code, '')), 20), ''),
      'Created from public intake form.'
    )
    returning * into matched_customer;
  else
    update public.customers
    set
      email = coalesce(customers.email, normalized_email),
      phone = coalesce(customers.phone, normalized_phone),
      address_line1 = coalesce(customers.address_line1, nullif(left(trim(coalesce(submit_public_intake.street_address, '')), 180), '')),
      city = coalesce(customers.city, nullif(left(trim(coalesce(submit_public_intake.city, '')), 80), '')),
      state = coalesce(customers.state, nullif(left(trim(coalesce(submit_public_intake.state, '')), 40), '')),
      postal_code = coalesce(customers.postal_code, nullif(left(trim(coalesce(submit_public_intake.postal_code, '')), 20), ''))
    where customers.id = matched_customer.id
    returning * into matched_customer;
  end if;

  service_address = nullif(
    array_to_string(
      array_remove(array[
        nullif(left(trim(coalesce(submit_public_intake.street_address, '')), 180), ''),
        nullif(left(trim(coalesce(submit_public_intake.city, '')), 80), ''),
        nullif(left(trim(coalesce(submit_public_intake.state, '')), 40), ''),
        nullif(left(trim(coalesce(submit_public_intake.postal_code, '')), 20), '')
      ], null),
      ', '
    ),
    ''
  );

  insert into public.jobs (
    business_id,
    customer_id,
    customer_name,
    customer_email,
    customer_phone,
    title,
    job_title,
    description,
    status,
    source,
    project_type,
    preferred_date,
    square_feet,
    budget_range,
    job_address,
    site_address,
    intake_dedupe_key,
    intake_upload_token,
    intake_data
  )
  values (
    target_business.id,
    matched_customer.id,
    matched_customer.name,
    matched_customer.email,
    matched_customer.phone,
    cleaned_service,
    cleaned_service,
    left(trim(submit_public_intake.project_description), 2000),
    'lead',
    'website_form',
    cleaned_service,
    submit_public_intake.preferred_date,
    submit_public_intake.square_feet,
    nullif(left(trim(coalesce(submit_public_intake.budget_range, '')), 80), ''),
    service_address,
    service_address,
    nullif(trim(coalesce(submit_public_intake.dedupe_key, '')), ''),
    nullif(trim(coalesce(submit_public_intake.intake_upload_token, '')), ''),
    coalesce(submit_public_intake.custom_data, '{}'::jsonb)
  )
  returning * into created_job;

  insert into public.job_activity (business_id, job_id, event_type, message, metadata)
  values (
    target_business.id,
    created_job.id,
    'public_intake_submitted',
    'Lead submitted through public intake form.',
    jsonb_build_object(
      'source', 'website_form',
      'project_type', created_job.project_type,
      'preferred_date', created_job.preferred_date,
      'custom_fields', (
        select count(*)
        from jsonb_object_keys(coalesce(created_job.intake_data, '{}'::jsonb))
      )
    )
  );

  return jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'business_id', target_business.id,
    'job_id', created_job.id
  );
exception
  when unique_violation then
    select jobs.id
    into existing_job_id
    from public.jobs
    where jobs.business_id = target_business.id
      and jobs.intake_dedupe_key = nullif(trim(coalesce(dedupe_key, '')), '')
    limit 1;

    return jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'business_id', target_business.id,
      'job_id', existing_job_id
    );
end;
$$;

grant execute on function public.submit_public_intake(text, text, text, text, text, text, text, text, text, text, date, integer, text, text, jsonb, text) to anon, authenticated;
