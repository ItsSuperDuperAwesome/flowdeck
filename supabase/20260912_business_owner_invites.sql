create extension if not exists pgcrypto;

drop function if exists public.get_business_invite(text);
drop function if exists public.accept_business_invite(text);

create table if not exists public.business_invites (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  email text not null,
  role text not null default 'owner',
  token_hash text not null unique,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

alter table public.business_invites add column if not exists email text;
alter table public.business_invites add column if not exists role text not null default 'owner';
alter table public.business_invites add column if not exists token_hash text;
alter table public.business_invites add column if not exists expires_at timestamptz;
alter table public.business_invites add column if not exists accepted_at timestamptz;
alter table public.business_invites add column if not exists accepted_by uuid references auth.users(id) on delete set null;
alter table public.business_invites add column if not exists revoked_at timestamptz;
alter table public.business_invites add column if not exists created_at timestamptz not null default now();
alter table public.business_invites add column if not exists created_by uuid references auth.users(id) on delete set null;

alter table public.business_invites drop constraint if exists business_invites_email_check;
alter table public.business_invites add constraint business_invites_email_check
check (email = lower(trim(email)) and email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$');

alter table public.business_invites drop constraint if exists business_invites_role_check;
alter table public.business_invites add constraint business_invites_role_check
check (role in ('owner'));

alter table public.business_invites drop constraint if exists business_invites_token_hash_check;
alter table public.business_invites add constraint business_invites_token_hash_check
check (token_hash ~ '^[a-f0-9]{64}$');

create index if not exists business_invites_business_id_idx on public.business_invites(business_id);
create index if not exists business_invites_pending_email_idx
on public.business_invites(business_id, email)
where accepted_at is null and revoked_at is null;
create unique index if not exists business_invites_token_hash_key on public.business_invites(token_hash);

alter table public.business_invites enable row level security;
revoke all on table public.business_invites from anon, authenticated;
grant select, insert, update on table public.business_invites to authenticated;

drop policy if exists "Platform admins can view business invites." on public.business_invites;
create policy "Platform admins can view business invites."
on public.business_invites for select
to authenticated
using (private.is_platform_admin());

drop policy if exists "Platform admins can create business invites." on public.business_invites;
create policy "Platform admins can create business invites."
on public.business_invites for insert
to authenticated
with check (private.is_platform_admin());

drop policy if exists "Platform admins can update business invites." on public.business_invites;
create policy "Platform admins can update business invites."
on public.business_invites for update
to authenticated
using (private.is_platform_admin())
with check (private.is_platform_admin());

create or replace function public.platform_admin_create_owner_invite(
  target_business_id uuid,
  invite_email text,
  invite_token_hash text,
  invite_expires_at timestamptz default now() + interval '14 days'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean_email text := lower(trim(coalesce(invite_email, '')));
  clean_hash text := lower(trim(coalesce(invite_token_hash, '')));
  created_invite_id uuid;
begin
  if not private.is_platform_admin() then
    return jsonb_build_object('ok', false, 'code', 'forbidden', 'message', 'Only platform admins can create workspace invites.');
  end if;

  if not exists (select 1 from public.businesses where id = target_business_id) then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'Workspace not found.');
  end if;

  if clean_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_email', 'message', 'Enter a valid owner email.');
  end if;

  if clean_hash !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_token', 'message', 'Invite token could not be created.');
  end if;

  update public.business_invites
  set revoked_at = now()
  where business_id = target_business_id
    and email = clean_email
    and role = 'owner'
    and accepted_at is null
    and revoked_at is null;

  insert into public.business_invites (
    business_id,
    email,
    role,
    token_hash,
    expires_at,
    created_by
  )
  values (
    target_business_id,
    clean_email,
    'owner',
    clean_hash,
    greatest(invite_expires_at, now() + interval '1 hour'),
    (select auth.uid())
  )
  returning id into created_invite_id;

  update public.businesses
  set client_owner_email = clean_email
  where id = target_business_id;

  insert into public.platform_admin_audit_logs (
    platform_admin_user_id,
    business_id,
    action,
    entity_type,
    metadata
  )
  values (
    (select auth.uid()),
    target_business_id,
    'owner_invite_created',
    'business_invite',
    jsonb_build_object('invite_id', created_invite_id, 'email', clean_email, 'role', 'owner')
  );

  return jsonb_build_object('ok', true, 'invite_id', created_invite_id, 'email', clean_email, 'expires_at', invite_expires_at);
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'code', 'duplicate', 'message', 'Could not create a unique invite. Try again.');
end;
$$;

create or replace function public.platform_admin_revoke_owner_invite(target_invite_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_invite public.business_invites;
begin
  if not private.is_platform_admin() then
    return jsonb_build_object('ok', false, 'code', 'forbidden', 'message', 'Only platform admins can revoke workspace invites.');
  end if;

  select *
  into target_invite
  from public.business_invites
  where id = target_invite_id
  for update;

  if target_invite.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'Invite not found.');
  end if;

  if target_invite.accepted_at is not null then
    return jsonb_build_object('ok', false, 'code', 'accepted', 'message', 'Accepted invites cannot be revoked.');
  end if;

  update public.business_invites
  set revoked_at = coalesce(revoked_at, now())
  where id = target_invite.id;

  insert into public.platform_admin_audit_logs (
    platform_admin_user_id,
    business_id,
    action,
    entity_type,
    metadata
  )
  values (
    (select auth.uid()),
    target_invite.business_id,
    'owner_invite_revoked',
    'business_invite',
    jsonb_build_object('invite_id', target_invite.id, 'email', target_invite.email)
  );

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.get_business_invite(invite_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  clean_hash text := lower(trim(coalesce(invite_token_hash, '')));
  target_invite public.business_invites;
  target_business public.businesses;
  invite_status text;
begin
  if clean_hash !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  select *
  into target_invite
  from public.business_invites
  where token_hash = clean_hash
  limit 1;

  if target_invite.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  select *
  into target_business
  from public.businesses
  where id = target_invite.business_id
  limit 1;

  if target_business.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  invite_status := case
    when target_invite.accepted_at is not null then 'accepted'
    when target_invite.revoked_at is not null then 'revoked'
    when target_invite.expires_at <= now() then 'expired'
    else 'pending'
  end;

  return jsonb_build_object(
    'ok', true,
    'status', invite_status,
    'business_id', target_business.id,
    'business_name', target_business.name,
    'business_slug', target_business.slug,
    'email', target_invite.email,
    'role', target_invite.role,
    'expires_at', target_invite.expires_at,
    'accepted_at', target_invite.accepted_at
  );
end;
$$;

create or replace function public.accept_business_invite(invite_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean_hash text := lower(trim(coalesce(invite_token_hash, '')));
  target_invite public.business_invites;
  signed_in_email text;
begin
  if clean_hash !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'Invite not found.');
  end if;

  if (select auth.uid()) is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated', 'message', 'Sign in before accepting this invite.');
  end if;

  select lower(email)
  into signed_in_email
  from auth.users
  where id = (select auth.uid());

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

grant execute on function public.platform_admin_create_owner_invite(uuid, text, text, timestamptz) to authenticated;
grant execute on function public.platform_admin_revoke_owner_invite(uuid) to authenticated;
grant execute on function public.get_business_invite(text) to anon, authenticated;
grant execute on function public.accept_business_invite(text) to authenticated;
