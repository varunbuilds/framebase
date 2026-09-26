-- Project membership and share links.
-- Apply with the Supabase CLI or the SQL editor. The app does not run this file.
--
-- A share URL contains a random token, not a project id. The database stores
-- only the SHA-256 hash of that token. Redeeming a valid token adds the
-- signed-in user as an editor of that one project.
--
-- Project SELECT now includes members. can_access_project_media is still
-- security invoker, so cloud source media follows the same project visibility.
-- The media bucket stays private. There is no second media permission system.
--
-- A later Liveblocks auth endpoint should check project_members for the
-- signed-in user and issue a token for room id = project id. It must not use
-- a public API key, and it must not sync source bytes or caches.

create table public.project_members (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'editor')),
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create index project_members_user_idx
  on public.project_members (user_id);

create table public.project_share_links (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  token_hash text not null unique,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create unique index project_share_links_one_active
  on public.project_share_links (project_id)
  where revoked_at is null;

insert into public.project_members (project_id, user_id, role)
select id, owner_id, 'owner'
from public.projects
on conflict do nothing;

create or replace function public.add_project_owner_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.project_members (project_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict do nothing;
  return new;
end;
$$;

create trigger projects_add_owner_membership
  after insert on public.projects
  for each row
  execute function public.add_project_owner_membership();

create or replace function public.protect_project_owner()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.id is distinct from old.id or new.owner_id is distinct from old.owner_id then
    raise exception 'project ownership cannot be changed';
  end if;
  return new;
end;
$$;

create trigger projects_protect_owner
  before update on public.projects
  for each row
  execute function public.protect_project_owner();

alter table public.project_members enable row level security;
alter table public.project_share_links enable row level security;

create policy "read own project membership"
  on public.project_members
  for select
  to authenticated
  using (user_id = auth.uid());

grant select on public.project_members to authenticated;

drop policy if exists "read own projects" on public.projects;
drop policy if exists "update own projects" on public.projects;
drop policy if exists "delete own projects" on public.projects;

create policy "read accessible projects"
  on public.projects
  for select
  to authenticated
  using (
    owner_id = auth.uid()
    or exists (
      select 1
      from public.project_members as member
      where member.project_id = projects.id
        and member.user_id = auth.uid()
    )
  );

create policy "update accessible projects"
  on public.projects
  for update
  to authenticated
  using (
    owner_id = auth.uid()
    or exists (
      select 1
      from public.project_members as member
      where member.project_id = projects.id
        and member.user_id = auth.uid()
    )
  )
  with check (
    owner_id = auth.uid()
    or exists (
      select 1
      from public.project_members as member
      where member.project_id = projects.id
        and member.user_id = auth.uid()
    )
  );

create policy "delete own projects"
  on public.projects
  for delete
  to authenticated
  using (owner_id = auth.uid());

comment on function public.can_access_project_media(text) is
  'True when this user can select a project whose document lists the media id. Owners and project members can select. The source bucket stays private.';

create or replace function public.share_token_hash(raw_token text)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select encode(extensions.digest(raw_token, 'sha256'), 'hex');
$$;

create or replace function public.create_project_share_link(target_project_id uuid)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  raw_token text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not exists (
    select 1
    from public.projects
    where id = target_project_id
      and owner_id = auth.uid()
  ) then
    raise exception 'not allowed';
  end if;

  update public.project_share_links
  set revoked_at = now()
  where project_id = target_project_id
    and revoked_at is null;

  raw_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.project_share_links (project_id, token_hash, created_by)
  values (target_project_id, public.share_token_hash(raw_token), auth.uid());
  return raw_token;
end;
$$;

create or replace function public.revoke_project_share_link(target_project_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not exists (
    select 1
    from public.projects
    where id = target_project_id
      and owner_id = auth.uid()
  ) then
    raise exception 'not allowed';
  end if;

  update public.project_share_links
  set revoked_at = now()
  where project_id = target_project_id
    and revoked_at is null;
end;
$$;

create or replace function public.project_share_link_active(target_project_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not exists (
    select 1
    from public.projects
    where id = target_project_id
      and owner_id = auth.uid()
  ) then
    raise exception 'not allowed';
  end if;

  return exists (
    select 1
    from public.project_share_links
    where project_id = target_project_id
      and revoked_at is null
  );
end;
$$;

-- Does not return a project id. Logged-out visitors can check a token they already have.
create or replace function public.preview_project_share_link(raw_token text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if raw_token is null or raw_token !~ '^[0-9a-f]{64}$' then
    return false;
  end if;
  return exists (
    select 1
    from public.project_share_links
    where token_hash = public.share_token_hash(raw_token)
      and revoked_at is null
  );
end;
$$;

create or replace function public.redeem_project_share_link(raw_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  found_project uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if raw_token is null or raw_token !~ '^[0-9a-f]{64}$' then
    raise exception 'share_link_invalid';
  end if;

  select project_id
  into found_project
  from public.project_share_links
  where token_hash = public.share_token_hash(raw_token)
    and revoked_at is null;

  if found_project is null then
    raise exception 'share_link_invalid';
  end if;

  insert into public.project_members (project_id, user_id, role)
  values (found_project, auth.uid(), 'editor')
  on conflict (project_id, user_id) do nothing;

  return found_project;
end;
$$;

revoke all on function public.share_token_hash(text) from public;
revoke all on function public.create_project_share_link(uuid) from public;
revoke all on function public.revoke_project_share_link(uuid) from public;
revoke all on function public.project_share_link_active(uuid) from public;
revoke all on function public.preview_project_share_link(text) from public;
revoke all on function public.redeem_project_share_link(text) from public;

grant execute on function public.create_project_share_link(uuid) to authenticated;
grant execute on function public.revoke_project_share_link(uuid) to authenticated;
grant execute on function public.project_share_link_active(uuid) to authenticated;
grant execute on function public.preview_project_share_link(text) to anon, authenticated;
grant execute on function public.redeem_project_share_link(text) to authenticated;

-- The next collaboration milestone should authorize a Liveblocks room with
-- this project id only after confirming a project_members row for auth.uid().
comment on table public.project_members is
  'Owner and editor access. A future Liveblocks auth check uses this table; the room id is the project id. Media bytes are not part of that room.';
