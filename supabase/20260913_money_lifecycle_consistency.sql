-- Keeps FlowDeck money semantics consistent:
-- jobs.price_cents = current opportunity value
-- jobs.won_at = accepted/booked opportunity timestamp
-- jobs.revenue_cents = completed revenue only

update public.jobs
set revenue_cents = 0
where status <> 'completed'
  and revenue_cents <> 0;

update public.jobs as jobs
set won_at = null
where status in ('lead', 'contacted', 'quoted')
  and won_at is not null
  and not exists (
    select 1
    from public.quotes
    where quotes.business_id = jobs.business_id
      and quotes.job_id = jobs.id
      and quotes.status = 'accepted'
  );

update public.jobs
set revenue_cents = greatest(revenue_cents, price_cents::bigint)
where status = 'completed'
  and price_cents > 0
  and revenue_cents = 0;

create or replace function public.public_accept_quote(quote_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_quote public.quotes%rowtype;
  accepted_time timestamptz;
begin
  select *
  into target_quote
  from public.quotes
  where public_token = quote_token
    and public_access_revoked_at is null
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

  update public.jobs
  set
    status = case when status in ('lead', 'contacted', 'quoted') then 'quoted' else status end,
    first_contact_at = coalesce(first_contact_at, accepted_time),
    quote_sent_at = coalesce(quote_sent_at, accepted_time),
    next_follow_up_at = null,
    price_cents = target_quote.amount_cents,
    revenue_cents = case when status = 'completed' then target_quote.amount_cents else 0 end,
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
