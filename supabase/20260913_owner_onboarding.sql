create extension if not exists pgcrypto with schema extensions;

create table if not exists public.business_onboarding_states (
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null default 'owner_invite',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  skipped_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (business_id, user_id)
);

alter table public.business_onboarding_states add column if not exists source text not null default 'owner_invite';
alter table public.business_onboarding_states add column if not exists started_at timestamptz not null default now();
alter table public.business_onboarding_states add column if not exists completed_at timestamptz;
alter table public.business_onboarding_states add column if not exists skipped_at timestamptz;
alter table public.business_onboarding_states add column if not exists updated_at timestamptz not null default now();

alter table public.business_onboarding_states drop constraint if exists business_onboarding_states_source_check;
alter table public.business_onboarding_states add constraint business_onboarding_states_source_check
check (source in ('owner_invite', 'manual_restart'));

alter table public.business_onboarding_states enable row level security;
revoke all on table public.business_onboarding_states from anon, authenticated;
grant select, insert, update on table public.business_onboarding_states to authenticated;

drop policy if exists "Members can view own onboarding state." on public.business_onboarding_states;
create policy "Members can view own onboarding state."
on public.business_onboarding_states for select
to authenticated
using (
  user_id = (select auth.uid())
  and private.is_business_member(business_id)
);

drop policy if exists "Members can create own onboarding state." on public.business_onboarding_states;
create policy "Members can create own onboarding state."
on public.business_onboarding_states for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and private.is_business_member(business_id)
);

drop policy if exists "Members can update own onboarding state." on public.business_onboarding_states;
create policy "Members can update own onboarding state."
on public.business_onboarding_states for update
to authenticated
using (
  user_id = (select auth.uid())
  and private.is_business_member(business_id)
)
with check (
  user_id = (select auth.uid())
  and private.is_business_member(business_id)
);

drop function if exists public.accept_business_invite(text);

create or replace function public.accept_business_invite(invite_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean_hash text := encode(extensions.digest(coalesce(invite_token, ''), 'sha256'), 'hex');
  target_invite public.business_invites;
  signed_in_email text;
  signed_in_confirmed_at timestamptz;
begin
  if nullif(trim(coalesce(invite_token, '')), '') is null then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'Invite not found.');
  end if;

  if (select auth.uid()) is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated', 'message', 'Sign in before accepting this invite.');
  end if;

  select lower(email), email_confirmed_at
  into signed_in_email, signed_in_confirmed_at
  from auth.users
  where id = (select auth.uid());

  if signed_in_confirmed_at is null then
    return jsonb_build_object('ok', false, 'code', 'email_unconfirmed', 'message', 'Confirm your email before accepting this invite.');
  end if;

  select *
  into target_invite
  from public.business_invites
  where token_hash = clean_hash
  for update;

  if target_invite.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'Invite not found.');
  end if;

  if target_invite.accepted_at is not null then
    return jsonb_build_object('ok', false, 'code', 'accepted', 'message', 'This invite has already been accepted.');
  end if;

  if target_invite.revoked_at is not null then
    return jsonb_build_object('ok', false, 'code', 'revoked', 'message', 'This invite has been revoked.');
  end if;

  if target_invite.expires_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'expired', 'message', 'This invite has expired.');
  end if;

  if signed_in_email is null or signed_in_email <> target_invite.email then
    return jsonb_build_object('ok', false, 'code', 'email_mismatch', 'message', 'Sign in with the email address this invite was sent to.');
  end if;

  insert into public.business_members (business_id, user_id, role)
  values (target_invite.business_id, (select auth.uid()), target_invite.role)
  on conflict (business_id, user_id)
  do update set role = excluded.role;

  insert into public.business_onboarding_states (business_id, user_id, source)
  values (target_invite.business_id, (select auth.uid()), 'owner_invite')
  on conflict (business_id, user_id)
  do update set
    source = 'owner_invite',
    started_at = now(),
    completed_at = null,
    skipped_at = null,
    updated_at = now();

  update public.business_invites
  set
    accepted_at = now(),
    accepted_by = (select auth.uid())
  where id = target_invite.id;

  if target_invite.created_by is not null then
    insert into public.platform_admin_audit_logs (
      platform_admin_user_id,
      business_id,
      action,
      entity_type,
      metadata
    )
    values (
      target_invite.created_by,
      target_invite.business_id,
      'owner_invite_accepted',
      'business_invite',
      jsonb_build_object('invite_id', target_invite.id, 'email', target_invite.email, 'accepted_by', (select auth.uid()))
    );
  end if;

  return jsonb_build_object('ok', true, 'business_id', target_invite.business_id);
end;
$$;

grant execute on function public.accept_business_invite(text) to authenticated;
