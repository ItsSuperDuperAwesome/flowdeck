-- Job Tracker schema
-- Safe to rerun. This migration keeps legacy job columns while moving the app
-- to proper customers, customer_id relationships, scheduling fields, and activity.

do $$
begin
  create type public.job_status as enum (
    'lead',
    'contacted',
    'quoted',
    'scheduled',
    'in_progress',
    'completed',
    'lost'
  );
exception
  when duplicate_object then null;
end $$;

create table if not exists public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.business_members (
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner',
  created_at timestamptz not null default now(),
  primary key (business_id, user_id)
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  email text,
  phone text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  postal_code text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete restrict,
  title text,
  description text,
  status public.job_status not null default 'lead',
  price_cents integer not null default 0 check (price_cents >= 0),
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  job_address text,
  internal_notes text,
  customer_name text,
  job_title text,
  scheduled_date date,
  customer_email text,
  customer_phone text,
  site_address text,
  notes text,
  first_contact_at timestamptz,
  quote_sent_at timestamptz,
  won_at timestamptz,
  next_follow_up_at timestamptz,
  lost_at timestamptz,
  completed_at timestamptz,
  lost_reason text,
  revenue_cents bigint not null default 0 check (revenue_cents >= 0),
  intake_upload_token text,
  intake_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.job_activity (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  amount_cents integer not null default 0,
  notes text,
  status text not null default 'draft',
  sent_at timestamptz,
  accepted_at timestamptz,
  declined_at timestamptz,
  valid_until date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.intake_fields (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  field_key text not null,
  label text not null,
  field_type text not null,
  required boolean not null default false,
  enabled boolean not null default true,
  options jsonb not null default '[]'::jsonb,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, field_key)
);

create table if not exists public.job_files (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  storage_bucket text not null default 'job-files',
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 10485760),
  category text not null default 'other',
  source_context text not null default 'manual',
  created_at timestamptz not null default now()
);

alter table public.businesses add column if not exists slug text;
alter table public.businesses add column if not exists intake_form_enabled boolean not null default true;
alter table public.businesses add column if not exists intake_form_title text not null default 'Tell us about your project';
alter table public.businesses add column if not exists intake_form_description text not null default 'Share a few details and we will follow up with next steps.';

alter table public.jobs add column if not exists customer_id uuid references public.customers(id) on delete restrict;
alter table public.jobs add column if not exists title text;
alter table public.jobs add column if not exists description text;
alter table public.jobs add column if not exists price_cents integer not null default 0 check (price_cents >= 0);
alter table public.jobs add column if not exists scheduled_start timestamptz;
alter table public.jobs add column if not exists scheduled_end timestamptz;
alter table public.jobs add column if not exists job_address text;
alter table public.jobs add column if not exists internal_notes text;
alter table public.jobs add column if not exists customer_name text;
alter table public.jobs add column if not exists job_title text;
alter table public.jobs add column if not exists scheduled_date date;
alter table public.jobs add column if not exists customer_email text;
alter table public.jobs add column if not exists customer_phone text;
alter table public.jobs add column if not exists site_address text;
alter table public.jobs add column if not exists notes text;
alter table public.jobs add column if not exists source text not null default 'manual';
alter table public.jobs add column if not exists project_type text;
alter table public.jobs add column if not exists preferred_date date;
alter table public.jobs add column if not exists square_feet integer check (square_feet is null or square_feet >= 0);
alter table public.jobs add column if not exists budget_range text;
alter table public.jobs add column if not exists first_contact_at timestamptz;
alter table public.jobs add column if not exists quote_sent_at timestamptz;
alter table public.jobs add column if not exists won_at timestamptz;
alter table public.jobs add column if not exists next_follow_up_at timestamptz;
alter table public.jobs add column if not exists lost_at timestamptz;
alter table public.jobs add column if not exists completed_at timestamptz;
alter table public.jobs add column if not exists lost_reason text;
alter table public.jobs add column if not exists revenue_cents bigint not null default 0;
alter table public.jobs add column if not exists intake_dedupe_key text;
alter table public.jobs add column if not exists intake_upload_token text;
alter table public.jobs add column if not exists intake_data jsonb not null default '{}'::jsonb;
alter table public.jobs add column if not exists updated_at timestamptz not null default now();

alter table public.jobs alter column status drop default;
alter table public.jobs alter column status type text using status::text;
alter table public.jobs alter column status set default 'lead';
alter table public.jobs drop constraint if exists jobs_status_check;
alter table public.jobs add constraint jobs_status_check
check (status in ('lead', 'contacted', 'quoted', 'scheduled', 'in_progress', 'completed', 'lost'));

alter table public.job_files add column if not exists storage_bucket text not null default 'job-files';
alter table public.job_files add column if not exists storage_path text;
alter table public.job_files add column if not exists file_name text;
alter table public.job_files add column if not exists mime_type text;
alter table public.job_files add column if not exists size_bytes integer;
alter table public.job_files add column if not exists category text not null default 'other';
alter table public.job_files add column if not exists source_context text not null default 'manual';

alter table public.quotes add column if not exists business_id uuid references public.businesses(id) on delete cascade;
alter table public.quotes add column if not exists job_id uuid references public.jobs(id) on delete cascade;
alter table public.quotes add column if not exists amount_cents integer not null default 0;
alter table public.quotes add column if not exists notes text;
alter table public.quotes add column if not exists status text not null default 'draft';
alter table public.quotes add column if not exists sent_at timestamptz;
alter table public.quotes add column if not exists accepted_at timestamptz;
alter table public.quotes add column if not exists declined_at timestamptz;
alter table public.quotes add column if not exists valid_until date;
alter table public.quotes add column if not exists created_at timestamptz not null default now();
alter table public.quotes add column if not exists updated_at timestamptz not null default now();

alter table public.intake_fields add column if not exists business_id uuid references public.businesses(id) on delete cascade;
alter table public.intake_fields add column if not exists field_key text;
alter table public.intake_fields add column if not exists label text;
alter table public.intake_fields add column if not exists field_type text;
alter table public.intake_fields add column if not exists required boolean not null default false;
alter table public.intake_fields add column if not exists enabled boolean not null default true;
alter table public.intake_fields add column if not exists options jsonb not null default '[]'::jsonb;
alter table public.intake_fields add column if not exists sort_order integer not null default 0;
alter table public.intake_fields add column if not exists created_at timestamptz not null default now();
alter table public.intake_fields add column if not exists updated_at timestamptz not null default now();

alter table public.jobs drop constraint if exists jobs_source_check;
alter table public.jobs add constraint jobs_source_check
check (source in ('manual', 'website_form', 'google', 'facebook', 'instagram', 'referral', 'repeat_customer', 'phone', 'walk_in', 'other'));

alter table public.jobs drop constraint if exists jobs_revenue_cents_check;
alter table public.jobs add constraint jobs_revenue_cents_check
check (revenue_cents >= 0);

alter table public.jobs drop constraint if exists jobs_lost_reason_check;
alter table public.jobs add constraint jobs_lost_reason_check
check (lost_reason is null or lost_reason in ('price', 'no_response', 'competitor', 'timing', 'canceled_project', 'not_qualified', 'other'));

alter table public.jobs drop constraint if exists jobs_square_feet_check;
alter table public.jobs add constraint jobs_square_feet_check
check (square_feet is null or square_feet >= 0);

alter table public.quotes drop constraint if exists quotes_amount_cents_check;
alter table public.quotes add constraint quotes_amount_cents_check
check (amount_cents >= 0);

alter table public.quotes drop constraint if exists quotes_status_check;
alter table public.quotes add constraint quotes_status_check
check (status in ('draft', 'sent', 'accepted', 'declined'));

alter table public.intake_fields drop constraint if exists intake_fields_field_key_check;
alter table public.intake_fields add constraint intake_fields_field_key_check
check (field_key ~ '^[a-z][a-z0-9_]{1,40}$');

alter table public.intake_fields drop constraint if exists intake_fields_label_check;
alter table public.intake_fields add constraint intake_fields_label_check
check (char_length(trim(label)) between 1 and 80);

alter table public.intake_fields drop constraint if exists intake_fields_field_type_check;
alter table public.intake_fields add constraint intake_fields_field_type_check
check (field_type in ('short_text', 'long_text', 'number', 'select', 'checkbox', 'date'));

alter table public.intake_fields drop constraint if exists intake_fields_options_check;
alter table public.intake_fields add constraint intake_fields_options_check
check (jsonb_typeof(options) = 'array');

alter table public.job_files drop constraint if exists job_files_storage_path_key;
alter table public.job_files add constraint job_files_storage_path_key unique (storage_path);

alter table public.job_files drop constraint if exists job_files_category_check;
alter table public.job_files add constraint job_files_category_check
check (category in ('intake', 'before', 'damage', 'prep', 'progress', 'completed', 'other'));

alter table public.job_files drop constraint if exists job_files_source_context_check;
alter table public.job_files add constraint job_files_source_context_check
check (source_context in ('intake', 'job_detail', 'manual'));

alter table public.customers add column if not exists email text;
alter table public.customers add column if not exists phone text;
alter table public.customers add column if not exists address_line1 text;
alter table public.customers add column if not exists address_line2 text;
alter table public.customers add column if not exists city text;
alter table public.customers add column if not exists state text;
alter table public.customers add column if not exists postal_code text;
alter table public.customers add column if not exists notes text;
alter table public.customers add column if not exists updated_at timestamptz not null default now();

insert into public.customers (business_id, name, email, phone, address_line1)
select
  jobs.business_id,
  trim(jobs.customer_name),
  max(nullif(trim(jobs.customer_email), '')),
  max(nullif(trim(jobs.customer_phone), '')),
  max(nullif(trim(coalesce(jobs.site_address, jobs.job_address)), ''))
from public.jobs
where jobs.customer_id is null
  and nullif(trim(coalesce(jobs.customer_name, '')), '') is not null
group by jobs.business_id, lower(trim(jobs.customer_name)), trim(jobs.customer_name)
on conflict do nothing;

update public.jobs
set
  customer_id = customers.id,
  title = coalesce(nullif(jobs.title, ''), nullif(jobs.job_title, ''), 'Untitled job'),
  scheduled_start = coalesce(jobs.scheduled_start, jobs.scheduled_date::timestamptz),
  job_address = coalesce(nullif(jobs.job_address, ''), nullif(jobs.site_address, '')),
  internal_notes = coalesce(nullif(jobs.internal_notes, ''), nullif(jobs.notes, '')),
  updated_at = now()
from public.customers
where jobs.customer_id is null
  and customers.business_id = jobs.business_id
  and lower(customers.name) = lower(trim(jobs.customer_name));

update public.jobs
set
  title = coalesce(nullif(title, ''), nullif(job_title, ''), 'Untitled job'),
  customer_name = coalesce(nullif(customer_name, ''), 'Unknown customer'),
  scheduled_start = coalesce(scheduled_start, scheduled_date::timestamptz),
  job_address = coalesce(nullif(job_address, ''), nullif(site_address, '')),
  internal_notes = coalesce(nullif(internal_notes, ''), nullif(notes, '')),
  updated_at = now();

update public.jobs
set
  won_at = coalesce(won_at, quote_sent_at, scheduled_start, updated_at),
  revenue_cents = greatest(revenue_cents, price_cents::bigint),
  updated_at = now()
where status in ('scheduled', 'in_progress')
  and price_cents > 0;

update public.jobs
set
  won_at = coalesce(won_at, quote_sent_at, scheduled_start, updated_at),
  completed_at = coalesce(completed_at, updated_at),
  revenue_cents = greatest(revenue_cents, price_cents::bigint),
  updated_at = now()
where status = 'completed'
  and price_cents > 0;

update public.jobs
set
  revenue_cents = 0,
  updated_at = now()
where status = 'lost'
  and revenue_cents <> 0;

insert into public.job_activity (business_id, job_id, event_type, message, metadata)
select
  jobs.business_id,
  jobs.id,
  'job_created',
  'Job imported from the original job list.',
  jsonb_build_object('source', 'schema_migration')
from public.jobs
where not exists (
  select 1
  from public.job_activity
  where job_activity.job_id = jobs.id
);

create index if not exists business_members_user_id_idx on public.business_members(user_id);
create index if not exists customers_business_id_idx on public.customers(business_id);
create index if not exists jobs_business_id_idx on public.jobs(business_id);
create index if not exists jobs_customer_id_idx on public.jobs(customer_id);
create index if not exists jobs_status_idx on public.jobs(status);
create index if not exists jobs_scheduled_date_idx on public.jobs(scheduled_date);
create index if not exists jobs_scheduled_start_idx on public.jobs(scheduled_start);
create index if not exists jobs_source_idx on public.jobs(source);
create index if not exists jobs_preferred_date_idx on public.jobs(preferred_date);
create index if not exists jobs_won_at_idx on public.jobs(won_at);
create index if not exists jobs_completed_at_idx on public.jobs(completed_at);
create unique index if not exists jobs_intake_dedupe_key_idx on public.jobs(business_id, intake_dedupe_key) where intake_dedupe_key is not null;
create index if not exists quotes_business_id_idx on public.quotes(business_id);
create index if not exists quotes_job_id_created_at_idx on public.quotes(job_id, created_at desc);
create index if not exists intake_fields_business_sort_idx on public.intake_fields(business_id, sort_order, created_at);
create index if not exists job_activity_business_id_idx on public.job_activity(business_id);
create index if not exists job_activity_job_id_idx on public.job_activity(job_id, created_at desc);
create index if not exists job_files_business_id_idx on public.job_files(business_id);
create index if not exists job_files_job_id_idx on public.job_files(job_id);

create schema if not exists private;

create or replace function private.is_business_member(business_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.business_members
    where business_members.business_id = is_business_member.business_id
      and business_members.user_id = (select auth.uid())
  );
$$;

create or replace function private.user_owns_business(business_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.businesses
    where businesses.id = user_owns_business.business_id
      and businesses.created_by = (select auth.uid())
  );
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.slugify(value text)
returns text
language sql
immutable
as $$
  select coalesce(
    nullif(
      regexp_replace(
        regexp_replace(lower(trim(value)), '[^a-z0-9]+', '-', 'g'),
        '(^-|-$)',
        '',
        'g'
      ),
      ''
    ),
    'workspace'
  );
$$;

create or replace function public.ensure_business_slug()
returns trigger
language plpgsql
as $$
declare
  base_slug text;
  candidate text;
  suffix integer := 1;
begin
  if new.slug is not null and trim(new.slug) <> '' then
    new.slug = public.slugify(new.slug);
    return new;
  end if;

  base_slug = public.slugify(new.name);
  candidate = base_slug;

  while exists (
    select 1
    from public.businesses
    where businesses.slug = candidate
      and businesses.id is distinct from new.id
  ) loop
    suffix = suffix + 1;
    candidate = base_slug || '-' || suffix::text;
  end loop;

  new.slug = candidate;
  return new;
end;
$$;

drop trigger if exists businesses_ensure_slug on public.businesses;
create trigger businesses_ensure_slug
before insert or update of name, slug on public.businesses
for each row execute function public.ensure_business_slug();

drop trigger if exists customers_set_updated_at on public.customers;
create trigger customers_set_updated_at
before update on public.customers
for each row execute function public.set_updated_at();

drop trigger if exists jobs_set_updated_at on public.jobs;
create trigger jobs_set_updated_at
before update on public.jobs
for each row execute function public.set_updated_at();

drop trigger if exists quotes_set_updated_at on public.quotes;
create trigger quotes_set_updated_at
before update on public.quotes
for each row execute function public.set_updated_at();

drop trigger if exists intake_fields_set_updated_at on public.intake_fields;
create trigger intake_fields_set_updated_at
before update on public.intake_fields
for each row execute function public.set_updated_at();

with numbered as (
  select
    id,
    public.slugify(name) as base_slug,
    row_number() over (partition by public.slugify(name) order by created_at, id) as slug_index
  from public.businesses
  where slug is null or trim(slug) = ''
)
update public.businesses
set slug = case
  when numbered.slug_index = 1 then numbered.base_slug
  else numbered.base_slug || '-' || numbered.slug_index::text
end
from numbered
where businesses.id = numbered.id;

create unique index if not exists businesses_slug_key on public.businesses(slug);

revoke execute on function private.is_business_member(uuid) from public;
revoke execute on function private.user_owns_business(uuid) from public;
grant usage on schema private to authenticated;
grant execute on function private.is_business_member(uuid) to authenticated;
grant execute on function private.user_owns_business(uuid) to authenticated;

alter table public.businesses enable row level security;
alter table public.business_members enable row level security;
alter table public.customers enable row level security;
alter table public.jobs enable row level security;
alter table public.job_activity enable row level security;
alter table public.quotes enable row level security;
alter table public.intake_fields enable row level security;
alter table public.job_files enable row level security;

revoke all on table public.businesses from anon, authenticated;
revoke all on table public.business_members from anon, authenticated;
revoke all on table public.customers from anon, authenticated;
revoke all on table public.jobs from anon, authenticated;
revoke all on table public.job_activity from anon, authenticated;
revoke all on table public.quotes from anon, authenticated;
revoke all on table public.intake_fields from anon, authenticated;
revoke all on table public.job_files from anon, authenticated;

grant select, insert, update, delete on table public.businesses to authenticated;
grant select, insert, update, delete on table public.business_members to authenticated;
grant select, insert, update, delete on table public.customers to authenticated;
grant select, insert, update, delete on table public.jobs to authenticated;
grant select, insert, update, delete on table public.job_activity to authenticated;
grant select, insert, update, delete on table public.quotes to authenticated;
grant select, insert, update, delete on table public.intake_fields to authenticated;
grant select, insert, update, delete on table public.job_files to authenticated;

drop policy if exists "Users can create their own businesses." on public.businesses;
create policy "Users can create their own businesses."
on public.businesses for insert
to authenticated
with check ((select auth.uid()) = created_by);

drop policy if exists "Business members can view businesses." on public.businesses;
create policy "Business members can view businesses."
on public.businesses for select
to authenticated
using (private.is_business_member(id) or created_by = (select auth.uid()));

drop policy if exists "Business owners can update businesses." on public.businesses;
create policy "Business owners can update businesses."
on public.businesses for update
to authenticated
using ((select auth.uid()) = created_by)
with check ((select auth.uid()) = created_by);

drop policy if exists "Business owners can delete businesses." on public.businesses;
create policy "Business owners can delete businesses."
on public.businesses for delete
to authenticated
using ((select auth.uid()) = created_by);

drop policy if exists "Users can add themselves to businesses they created." on public.business_members;
create policy "Users can add themselves to businesses they created."
on public.business_members for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and private.user_owns_business(business_id)
);

drop policy if exists "Business members can view memberships." on public.business_members;
create policy "Business members can view memberships."
on public.business_members for select
to authenticated
using (private.is_business_member(business_id));

drop policy if exists "Business members can manage customers." on public.customers;
create policy "Business members can manage customers."
on public.customers for all
to authenticated
using (private.is_business_member(business_id))
with check (private.is_business_member(business_id));

drop policy if exists "Business members can view jobs." on public.jobs;
create policy "Business members can view jobs."
on public.jobs for select
to authenticated
using (private.is_business_member(business_id));

drop policy if exists "Business members can create jobs." on public.jobs;
create policy "Business members can create jobs."
on public.jobs for insert
to authenticated
with check (
  private.is_business_member(business_id)
  and (
    customer_id is null
    or exists (
      select 1
      from public.customers
      where customers.id = customer_id
        and customers.business_id = jobs.business_id
    )
  )
);

drop policy if exists "Business members can update jobs." on public.jobs;
create policy "Business members can update jobs."
on public.jobs for update
to authenticated
using (private.is_business_member(business_id))
with check (
  private.is_business_member(business_id)
  and (
    customer_id is null
    or exists (
      select 1
      from public.customers
      where customers.id = customer_id
        and customers.business_id = jobs.business_id
    )
  )
);

drop policy if exists "Business members can delete jobs." on public.jobs;
create policy "Business members can delete jobs."
on public.jobs for delete
to authenticated
using (private.is_business_member(business_id));

drop policy if exists "Business members can manage job activity." on public.job_activity;
create policy "Business members can manage job activity."
on public.job_activity for all
to authenticated
using (private.is_business_member(business_id))
with check (
  private.is_business_member(business_id)
  and exists (
    select 1
    from public.jobs
    where jobs.id = job_activity.job_id
      and jobs.business_id = job_activity.business_id
  )
);

drop policy if exists "Business members can manage quotes." on public.quotes;
create policy "Business members can manage quotes."
on public.quotes for all
to authenticated
using (private.is_business_member(business_id))
with check (
  private.is_business_member(business_id)
  and exists (
    select 1
    from public.jobs
    where jobs.id = quotes.job_id
      and jobs.business_id = quotes.business_id
  )
);

drop policy if exists "Business members can manage intake fields." on public.intake_fields;
create policy "Business members can manage intake fields."
on public.intake_fields for all
to authenticated
using (private.is_business_member(business_id))
with check (private.is_business_member(business_id));

drop policy if exists "Business members can manage job files." on public.job_files;
create policy "Business members can manage job files."
on public.job_files for all
to authenticated
using (private.is_business_member(business_id))
with check (
  private.is_business_member(business_id)
  and exists (
    select 1
    from public.jobs
    where jobs.id = job_files.job_id
      and jobs.business_id = job_files.business_id
  )
);

drop policy if exists "Public intake can upload constrained job photos." on storage.objects;
drop policy if exists "Public intake can clean up failed photo metadata." on storage.objects;
drop function if exists public.can_upload_public_intake_photo(text, jsonb);

create or replace function public.can_upload_public_intake_photo(
  object_name text
)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select
    (storage.foldername(object_name))[3] = 'intake'
    and nullif((storage.foldername(object_name))[4], '') is not null
    and lower(storage.extension(object_name)) in ('jpg', 'jpeg', 'png', 'webp', 'gif')
    and exists (
      select 1
      from storage.buckets
      where buckets.id = 'job-files'
        and buckets.file_size_limit <= 10485760
        and buckets.allowed_mime_types @> array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
    )
    and exists (
      select 1
      from public.jobs
      where jobs.business_id::text = (storage.foldername(object_name))[1]
        and jobs.id::text = (storage.foldername(object_name))[2]
        and jobs.intake_upload_token = (storage.foldername(object_name))[4]
        and jobs.source = 'website_form'
        and jobs.created_at > now() - interval '30 minutes'
    );
$$;

create or replace function public.can_clean_up_public_intake_photo(object_name text)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select
    (storage.foldername(object_name))[3] = 'intake'
    and nullif((storage.foldername(object_name))[4], '') is not null
    and exists (
      select 1
      from public.jobs
      where jobs.business_id::text = (storage.foldername(object_name))[1]
        and jobs.id::text = (storage.foldername(object_name))[2]
        and jobs.intake_upload_token = (storage.foldername(object_name))[4]
        and jobs.source = 'website_form'
        and jobs.created_at > now() - interval '30 minutes'
    );
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'job-files',
  'job-files',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
set
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

drop policy if exists "Public intake can upload constrained job photos." on storage.objects;
create policy "Public intake can upload constrained job photos."
on storage.objects for insert
to anon
with check (
  bucket_id = 'job-files'
  and public.can_upload_public_intake_photo(name)
);

drop policy if exists "Business members can upload job photos." on storage.objects;
create policy "Business members can upload job photos."
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'job-files'
  and (storage.foldername(name))[3] in ('before', 'damage', 'prep', 'progress', 'completed', 'other')
  and lower(storage.extension(name)) in ('jpg', 'jpeg', 'png', 'webp', 'gif')
  and exists (
    select 1
    from storage.buckets
    where buckets.id = 'job-files'
      and buckets.file_size_limit <= 10485760
      and buckets.allowed_mime_types @> array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
  )
  and exists (
    select 1
    from public.jobs
    where jobs.business_id::text = (storage.foldername(name))[1]
      and jobs.id::text = (storage.foldername(name))[2]
      and private.is_business_member(jobs.business_id)
  )
);

drop policy if exists "Business members can delete job photos." on storage.objects;
create policy "Business members can delete job photos."
on storage.objects for delete
to authenticated
using (
  bucket_id = 'job-files'
  and exists (
    select 1
    from public.jobs
    where jobs.business_id::text = (storage.foldername(name))[1]
      and jobs.id::text = (storage.foldername(name))[2]
      and private.is_business_member(jobs.business_id)
  )
);

drop policy if exists "Public intake can clean up failed photo metadata." on storage.objects;
create policy "Public intake can clean up failed photo metadata."
on storage.objects for delete
to anon
using (
  bucket_id = 'job-files'
  and public.can_clean_up_public_intake_photo(name)
);

drop policy if exists "Business members can read job photos." on storage.objects;
create policy "Business members can read job photos."
on storage.objects for select
to authenticated
using (
  bucket_id = 'job-files'
  and exists (
    select 1
    from public.jobs
    where jobs.business_id::text = (storage.foldername(name))[1]
      and jobs.id::text = (storage.foldername(name))[2]
      and private.is_business_member(jobs.business_id)
  )
);

drop function if exists public.submit_public_intake(text, text, text, text, text, text, text, text, text, text, date, integer, text, text);
drop function if exists public.submit_public_intake(text, text, text, text, text, text, text, text, text, text, date, integer, text, text, jsonb);

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
  normalized_email = nullif(lower(trim(coalesce(contact_email, ''))), '');

  if nullif(trim(coalesce(full_name, '')), '') is null
    or nullif(trim(coalesce(service_type, '')), '') is null
    or nullif(trim(coalesce(project_description, '')), '') is null
    or (normalized_phone is null and normalized_email is null)
  then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;

  if normalized_email is not null and normalized_email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_email');
  end if;

  if normalized_phone is not null and length(normalized_phone) < 7 then
    return jsonb_build_object('ok', false, 'code', 'invalid_phone');
  end if;

  if jsonb_typeof(coalesce(custom_data, '{}'::jsonb)) <> 'object' then
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
      and regexp_replace(coalesce(customers.phone, ''), '\D', '', 'g') = normalized_phone
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
    left(trim(submit_public_intake.service_type), 120),
    left(trim(submit_public_intake.service_type), 120),
    left(trim(submit_public_intake.project_description), 2000),
    'lead',
    'website_form',
    left(trim(submit_public_intake.service_type), 120),
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

drop function if exists public.record_intake_file(uuid, uuid, text, text, text, integer);

create or replace function public.record_intake_file(
  business_id uuid,
  job_id uuid,
  storage_path text,
  file_name text,
  mime_type text,
  size_bytes integer,
  intake_upload_token text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if size_bytes <= 0
    or size_bytes > 10485760
    or lower(mime_type) not in ('image/jpeg', 'image/png', 'image/webp', 'image/gif')
    or nullif(trim(coalesce(intake_upload_token, '')), '') is null
    or storage_path not like business_id::text || '/' || job_id::text || '/intake/' || intake_upload_token || '/%'
    or not exists (
      select 1
      from public.jobs
      where jobs.id = record_intake_file.job_id
        and jobs.business_id = record_intake_file.business_id
        and jobs.source = 'website_form'
        and jobs.intake_upload_token = record_intake_file.intake_upload_token
        and jobs.created_at > now() - interval '30 minutes'
    )
  then
    raise exception 'Invalid intake file';
  end if;

  insert into public.job_files (
    business_id,
    job_id,
    storage_bucket,
    storage_path,
    file_name,
    mime_type,
    size_bytes,
    category,
    source_context
  )
  values (
    business_id,
    job_id,
    'job-files',
    storage_path,
    left(file_name, 120),
    lower(mime_type),
    size_bytes,
    'intake',
    'intake'
  )
  on conflict on constraint job_files_storage_path_key do nothing;
end;
$$;

revoke all on function public.submit_public_intake(text, text, text, text, text, text, text, text, text, text, date, integer, text, text, jsonb, text) from public;
revoke all on function public.get_public_intake_form(text) from public;
revoke all on function public.record_intake_file(uuid, uuid, text, text, text, integer, text) from public;
revoke all on function public.can_upload_public_intake_photo(text) from public;
revoke all on function public.can_clean_up_public_intake_photo(text) from public;
grant execute on function public.submit_public_intake(text, text, text, text, text, text, text, text, text, text, date, integer, text, text, jsonb, text) to anon, authenticated;
grant execute on function public.get_public_intake_form(text) to anon, authenticated;
grant execute on function public.record_intake_file(uuid, uuid, text, text, text, integer, text) to anon, authenticated;
grant execute on function public.can_upload_public_intake_photo(text) to anon, authenticated;
grant execute on function public.can_clean_up_public_intake_photo(text) to anon, authenticated;
