alter table public.jobs add column if not exists won_at timestamptz;
alter table public.jobs add column if not exists completed_at timestamptz;
alter table public.jobs add column if not exists revenue_cents bigint not null default 0;

alter table public.jobs drop constraint if exists jobs_source_check;
alter table public.jobs add constraint jobs_source_check
check (source in ('manual', 'website_form', 'google', 'facebook', 'instagram', 'referral', 'repeat_customer', 'phone', 'walk_in', 'other'));

alter table public.jobs drop constraint if exists jobs_revenue_cents_check;
alter table public.jobs add constraint jobs_revenue_cents_check
check (revenue_cents >= 0);

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

create index if not exists jobs_won_at_idx on public.jobs(won_at);
create index if not exists jobs_completed_at_idx on public.jobs(completed_at);
