alter table public.quote_messages drop constraint if exists quote_messages_source_check;
alter table public.quote_messages add constraint quote_messages_source_check
check (source in ('customer', 'business'));

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
    'Customer sent a quote message.',
    jsonb_build_object('quote_id', target_quote.id, 'quote_message_id', created_message_id, 'source', 'public_quote', 'message', clean_message)
  );

  return jsonb_build_object('ok', true, 'duplicate', false, 'message_id', created_message_id);
end;
$$;
