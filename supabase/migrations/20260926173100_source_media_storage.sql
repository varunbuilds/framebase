-- Private source-media bucket.
-- Stores original video/audio only, at media/<mediaSourceId>/source.
-- Filmstrips, waveforms, and other caches are not stored here.
-- Apply with the Supabase CLI or the SQL editor. The app does not run this file.
--
-- Access follows project row-level security. Today that is owner-only.
-- A later collaborator policy on public.projects grants the same media
-- without changing these object paths.

insert into storage.buckets (id, name, public)
values ('framebase-source-media', 'framebase-source-media', false)
on conflict (id) do nothing;

create or replace function public.storage_media_source_id(object_name text)
returns text
language sql
immutable
as $$
  select substring(object_name from '^media/([A-Za-z0-9_-]+)/source$');
$$;

-- Security invoker: the projects RLS policy decides who can see a row.
create or replace function public.can_access_project_media(media_source_id text)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select media_source_id is not null
    and exists (
      select 1
      from public.projects as project
      where exists (
        select 1
        from jsonb_array_elements(
          coalesce(project.document #> '{document,mediaSources}', '[]'::jsonb)
        ) as source
        where source->>'id' = media_source_id
      )
    );
$$;

grant execute on function public.storage_media_source_id(text) to authenticated;
grant execute on function public.can_access_project_media(text) to authenticated;

create policy "read own project source media"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'framebase-source-media'
    and public.can_access_project_media(public.storage_media_source_id(name))
  );

create policy "upload own project source media"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'framebase-source-media'
    and public.can_access_project_media(public.storage_media_source_id(name))
  );

create policy "replace own project source media"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'framebase-source-media'
    and public.can_access_project_media(public.storage_media_source_id(name))
  )
  with check (
    bucket_id = 'framebase-source-media'
    and public.can_access_project_media(public.storage_media_source_id(name))
  );

create policy "delete own project source media"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'framebase-source-media'
    and public.can_access_project_media(public.storage_media_source_id(name))
  );
