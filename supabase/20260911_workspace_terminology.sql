create table if not exists public.business_terminology (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  job_singular text not null default 'Job',
  job_plural text not null default 'Jobs',
  customer_singular text not null default 'Customer',
  customer_plural text not null default 'Customers',
  quote_singular text not null default 'Quote',
  quote_plural text not null default 'Quotes',
  active_board_title text,
  upcoming_title text,
  new_job_button_label text,
  new_customer_button_label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id)
);

alter table public.business_terminology drop constraint if exists business_terminology_terms_check;
alter table public.business_terminology add constraint business_terminology_terms_check
check (
  char_length(trim(job_singular)) between 1 and 40
  and char_length(trim(job_plural)) between 1 and 40
  and char_length(trim(customer_singular)) between 1 and 40
  and char_length(trim(customer_plural)) between 1 and 40
  and char_length(trim(quote_singular)) between 1 and 40
  and char_length(trim(quote_plural)) between 1 and 40
  and (active_board_title is null or char_length(trim(active_board_title)) between 1 and 40)
  and (upcoming_title is null or char_length(trim(upcoming_title)) between 1 and 40)
  and (new_job_button_label is null or char_length(trim(new_job_button_label)) between 1 and 40)
  and (new_customer_button_label is null or char_length(trim(new_customer_button_label)) between 1 and 40)
);

create index if not exists business_terminology_business_idx on public.business_terminology(business_id);

drop trigger if exists business_terminology_set_updated_at on public.business_terminology;
create trigger business_terminology_set_updated_at
before update on public.business_terminology
for each row execute function public.set_updated_at();

alter table public.business_terminology enable row level security;

revoke all on table public.business_terminology from anon, authenticated;
grant select, insert, update, delete on table public.business_terminology to authenticated;

drop policy if exists "Business members can manage terminology." on public.business_terminology;
create policy "Business members can manage terminology."
on public.business_terminology for all
to authenticated
using (private.is_business_member(business_id))
with check (private.is_business_member(business_id));

insert into public.business_terminology (
  business_id,
  job_singular,
  job_plural,
  customer_singular,
  customer_plural,
  quote_singular,
  quote_plural
)
select
  businesses.id,
  'Job',
  'Jobs',
  'Customer',
  'Customers',
  'Quote',
  'Quotes'
from public.businesses
on conflict (business_id) do nothing;

create or replace function public.workspace_terminology_json(target_business_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
stable
as $$
  select jsonb_build_object(
    'job_singular', coalesce(nullif(trim(business_terminology.job_singular), ''), 'Job'),
    'job_plural', coalesce(nullif(trim(business_terminology.job_plural), ''), 'Jobs'),
    'customer_singular', coalesce(nullif(trim(business_terminology.customer_singular), ''), 'Customer'),
    'customer_plural', coalesce(nullif(trim(business_terminology.customer_plural), ''), 'Customers'),
    'quote_singular', coalesce(nullif(trim(business_terminology.quote_singular), ''), 'Quote'),
    'quote_plural', coalesce(nullif(trim(business_terminology.quote_plural), ''), 'Quotes'),
    'active_board_title', business_terminology.active_board_title,
    'upcoming_title', business_terminology.upcoming_title,
    'new_job_button_label', business_terminology.new_job_button_label,
    'new_customer_button_label', business_terminology.new_customer_button_label
  )
  from public.business_terminology
  where business_terminology.business_id = target_business_id
  union all
  select jsonb_build_object(
    'job_singular', 'Job',
    'job_plural', 'Jobs',
    'customer_singular', 'Customer',
    'customer_plural', 'Customers',
    'quote_singular', 'Quote',
    'quote_plural', 'Quotes',
    'active_board_title', null,
    'upcoming_title', null,
    'new_job_button_label', null,
    'new_customer_button_label', null
  )
  limit 1;
$$;

revoke all on function public.workspace_terminology_json(uuid) from public;
grant execute on function public.workspace_terminology_json(uuid) to anon, authenticated;

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
    'terminology', public.workspace_terminology_json(target_business.id),
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

create or replace function public.get_public_quote(quote_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  target_quote public.quotes;
  target_job public.jobs;
  target_business public.businesses;
begin
  if nullif(trim(coalesce(quote_token, '')), '') is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  select *
  into target_quote
  from public.quotes
  where quotes.public_token = quote_token
    and quotes.public_access_revoked_at is null
  limit 1;

  if target_quote.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  select *
  into target_job
  from public.jobs
  where jobs.id = target_quote.job_id
    and jobs.business_id = target_quote.business_id
  limit 1;

  select *
  into target_business
  from public.businesses
  where businesses.id = target_quote.business_id
  limit 1;

  if target_job.id is null or target_business.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  return jsonb_build_object(
    'ok', true,
    'business_name', target_business.name,
    'terminology', public.workspace_terminology_json(target_business.id),
    'job_title', target_job.title,
    'quote_amount_cents', target_quote.amount_cents,
    'quote_notes', target_quote.notes,
    'quote_status', target_quote.status,
    'sent_at', target_quote.sent_at,
    'accepted_at', target_quote.accepted_at,
    'declined_at', target_quote.declined_at,
    'valid_until', target_quote.valid_until,
    'expired', target_quote.valid_until is not null and target_quote.valid_until < current_date,
    'messages', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'source', quote_messages.source,
          'message', quote_messages.message,
          'created_at', quote_messages.created_at
        )
        order by quote_messages.created_at
      )
      from public.quote_messages
      where quote_messages.quote_id = target_quote.id
    ), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.get_public_quote(text) to anon, authenticated;
