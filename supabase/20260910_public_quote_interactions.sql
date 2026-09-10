create extension if not exists pgcrypto;

alter table public.quotes add column if not exists public_token text;
alter table public.quotes add column if not exists public_token_created_at timestamptz;
alter table public.quotes add column if not exists public_access_revoked_at timestamptz;

update public.quotes
set
  public_token = encode(gen_random_bytes(32), 'hex'),
  public_token_created_at = coalesce(public_token_created_at, now())
where public_token is null or trim(public_token) = '';

alter table public.quotes alter column public_token set not null;
alter table public.quotes alter column public_token set default encode(gen_random_bytes(32), 'hex');
alter table public.quotes alter column public_token_created_at set default now();

create unique index if not exists quotes_public_token_key on public.quotes(public_token);
create index if not exists quotes_public_token_active_idx on public.quotes(public_token) where public_access_revoked_at is null;

create table if not exists public.quote_messages (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  quote_id uuid not null references public.quotes(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  message text not null,
  source text not null default 'customer',
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.quote_messages add column if not exists business_id uuid references public.businesses(id) on delete cascade;
alter table public.quote_messages add column if not exists quote_id uuid references public.quotes(id) on delete cascade;
alter table public.quote_messages add column if not exists job_id uuid references public.jobs(id) on delete cascade;
alter table public.quote_messages add column if not exists message text;
alter table public.quote_messages add column if not exists source text not null default 'customer';
alter table public.quote_messages add column if not exists resolved_at timestamptz;
alter table public.quote_messages add column if not exists created_at timestamptz not null default now();

alter table public.quote_messages drop constraint if exists quote_messages_source_check;
alter table public.quote_messages add constraint quote_messages_source_check
check (source = 'customer');

alter table public.quote_messages drop constraint if exists quote_messages_message_check;
alter table public.quote_messages add constraint quote_messages_message_check
check (char_length(trim(message)) between 1 and 1000);

create index if not exists quote_messages_business_id_idx on public.quote_messages(business_id);
create index if not exists quote_messages_quote_id_created_at_idx on public.quote_messages(quote_id, created_at desc);
create index if not exists quote_messages_unresolved_idx on public.quote_messages(business_id, resolved_at, created_at desc) where resolved_at is null;

alter table public.quote_messages enable row level security;
revoke all on table public.quote_messages from anon, authenticated;
grant select, insert, update, delete on table public.quote_messages to authenticated;

drop policy if exists "Business members can manage quote messages." on public.quote_messages;
create policy "Business members can manage quote messages."
on public.quote_messages for all
to authenticated
using (private.is_business_member(business_id))
with check (
  private.is_business_member(business_id)
  and exists (
    select 1
    from public.quotes
    where quotes.id = quote_messages.quote_id
      and quotes.business_id = quote_messages.business_id
      and quotes.job_id = quote_messages.job_id
  )
);

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
    'job_title', target_job.title,
    'quote_amount_cents', target_quote.amount_cents,
    'quote_notes', target_quote.notes,
    'quote_status', target_quote.status,
    'sent_at', target_quote.sent_at,
    'accepted_at', target_quote.accepted_at,
    'declined_at', target_quote.declined_at,
    'valid_until', target_quote.valid_until,
    'expired', target_quote.valid_until is not null and target_quote.valid_until < current_date
  );
end;
$$;

create or replace function public.public_accept_quote(quote_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_quote public.quotes;
  target_job public.jobs;
  accepted_time timestamptz;
begin
  select *
  into target_quote
  from public.quotes
  where quotes.public_token = quote_token
    and quotes.public_access_revoked_at is null
  for update;

  if target_quote.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  if target_quote.valid_until is not null and target_quote.valid_until < current_date then
    return jsonb_build_object('ok', false, 'code', 'expired');
  end if;

  if target_quote.status = 'declined' then
    return jsonb_build_object('ok', false, 'code', 'declined');
  end if;

  if target_quote.status = 'draft' then
    return jsonb_build_object('ok', false, 'code', 'not_sent');
  end if;

  if target_quote.status = 'accepted' then
    return jsonb_build_object('ok', true, 'status', 'accepted', 'duplicate', true);
  end if;

  accepted_time = now();

  update public.quotes
  set
    status = 'accepted',
    accepted_at = coalesce(accepted_at, accepted_time),
    declined_at = null,
    sent_at = coalesce(sent_at, accepted_time)
  where id = target_quote.id;

  select *
  into target_job
  from public.jobs
  where jobs.id = target_quote.job_id
    and jobs.business_id = target_quote.business_id
  for update;

  update public.jobs
  set
    status = case when status in ('lead', 'contacted', 'quoted') then 'quoted' else status end,
    first_contact_at = coalesce(first_contact_at, accepted_time),
    quote_sent_at = coalesce(quote_sent_at, accepted_time),
    next_follow_up_at = null,
    price_cents = target_quote.amount_cents,
    revenue_cents = target_quote.amount_cents,
    won_at = coalesce(won_at, accepted_time)
  where id = target_quote.job_id
    and business_id = target_quote.business_id;

  insert into public.job_activity (business_id, job_id, event_type, message, metadata)
  values (
    target_quote.business_id,
    target_quote.job_id,
    'quote_accepted',
    'Customer accepted the quote.',
    jsonb_build_object('quote_id', target_quote.id, 'accepted_at', accepted_time, 'amount_cents', target_quote.amount_cents, 'source', 'public_quote')
  );

  return jsonb_build_object('ok', true, 'status', 'accepted', 'duplicate', false);
end;
$$;

create or replace function public.public_decline_quote(quote_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_quote public.quotes;
  declined_time timestamptz;
begin
  select *
  into target_quote
  from public.quotes
  where quotes.public_token = quote_token
    and quotes.public_access_revoked_at is null
  for update;

  if target_quote.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  if target_quote.status = 'accepted' then
    return jsonb_build_object('ok', false, 'code', 'accepted');
  end if;

  if target_quote.status = 'draft' then
    return jsonb_build_object('ok', false, 'code', 'not_sent');
  end if;

  if target_quote.status = 'declined' then
    return jsonb_build_object('ok', true, 'status', 'declined', 'duplicate', true);
  end if;

  declined_time = now();

  update public.quotes
  set
    status = 'declined',
    accepted_at = null,
    declined_at = coalesce(declined_at, declined_time)
  where id = target_quote.id;

  insert into public.job_activity (business_id, job_id, event_type, message, metadata)
  values (
    target_quote.business_id,
    target_quote.job_id,
    'quote_declined',
    'Customer declined the quote.',
    jsonb_build_object('quote_id', target_quote.id, 'declined_at', declined_time, 'amount_cents', target_quote.amount_cents, 'source', 'public_quote')
  );

  return jsonb_build_object('ok', true, 'status', 'declined', 'duplicate', false);
end;
$$;

create or replace function public.public_send_quote_message(quote_token text, customer_message text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_quote public.quotes;
  clean_message text;
  existing_message_id uuid;
  created_message_id uuid;
begin
  clean_message = left(trim(coalesce(customer_message, '')), 1000);

  if nullif(clean_message, '') is null then
    return jsonb_build_object('ok', false, 'code', 'empty');
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

  if target_quote.status not in ('sent', 'accepted', 'declined') then
    return jsonb_build_object('ok', false, 'code', 'not_sent');
  end if;

  select id
  into existing_message_id
  from public.quote_messages
  where quote_messages.quote_id = target_quote.id
    and quote_messages.source = 'customer'
    and quote_messages.message = clean_message
    and quote_messages.created_at > now() - interval '2 minutes'
  order by quote_messages.created_at desc
  limit 1;

  if existing_message_id is not null then
    return jsonb_build_object('ok', true, 'duplicate', true, 'message_id', existing_message_id);
  end if;

  insert into public.quote_messages (business_id, quote_id, job_id, message, source)
  values (target_quote.business_id, target_quote.id, target_quote.job_id, clean_message, 'customer')
  returning id into created_message_id;

  insert into public.job_activity (business_id, job_id, event_type, message, metadata)
  values (
    target_quote.business_id,
    target_quote.job_id,
    'quote_message_received',
    'Customer sent a quote question.',
    jsonb_build_object('quote_id', target_quote.id, 'quote_message_id', created_message_id, 'source', 'public_quote', 'message', clean_message)
  );

  return jsonb_build_object('ok', true, 'duplicate', false, 'message_id', created_message_id);
end;
$$;

revoke all on function public.get_public_quote(text) from public;
revoke all on function public.public_accept_quote(text) from public;
revoke all on function public.public_decline_quote(text) from public;
revoke all on function public.public_send_quote_message(text, text) from public;
grant execute on function public.get_public_quote(text) to anon, authenticated;
grant execute on function public.public_accept_quote(text) to anon, authenticated;
grant execute on function public.public_decline_quote(text) to anon, authenticated;
grant execute on function public.public_send_quote_message(text, text) to anon, authenticated;
