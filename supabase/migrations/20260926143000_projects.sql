-- Framebase project persistence.
-- This file is the schema to apply in Supabase. Running the app does not
-- execute it. Apply it with the Supabase CLI or the SQL editor.
--
-- The projects.document column stores the versioned ProjectDocument JSON
-- ({ version, document }). It must not contain files, blob URLs, media
-- elements, or filmstrip/waveform caches.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  document jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index projects_owner_updated_idx
  on public.projects (owner_id, updated_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row
  execute function public.set_updated_at();

create trigger projects_set_updated_at
  before update on public.projects
  for each row
  execute function public.set_updated_at();

-- Inserts the profile row as the user. Security definer is limited to this
-- insert; browser code never uses a service-role key.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.projects enable row level security;

create policy "read own profile"
  on public.profiles
  for select
  to authenticated
  using (id = auth.uid());

create policy "update own profile"
  on public.profiles
  for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy "read own projects"
  on public.projects
  for select
  to authenticated
  using (owner_id = auth.uid());

create policy "create own projects"
  on public.projects
  for insert
  to authenticated
  with check (owner_id = auth.uid());

create policy "update own projects"
  on public.projects
  for update
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy "delete own projects"
  on public.projects
  for delete
  to authenticated
  using (owner_id = auth.uid());

grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.projects to authenticated;
