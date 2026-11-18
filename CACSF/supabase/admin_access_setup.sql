-- CACSF admin read/write access hardening. Run in Supabase SQL Editor.
-- First, replace PASTE_ADMIN_AUTH_USER_UUID with the UUID shown for your admin
-- account in Authentication > Users. This does not change alumni registrations.
create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admin_users enable row level security;

create or replace function public.is_cacsf_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.admin_users where user_id = auth.uid()); $$;

-- After running this script, copy the admin user's UUID from Authentication > Users,
-- replace the placeholder below, remove the leading '--', and run that INSERT separately:
-- insert into public.admin_users(user_id) values ('PASTE_ADMIN_AUTH_USER_UUID'::uuid) on conflict (user_id) do nothing;

-- Alumni and contact messages are private: only approved admins can read them.
drop policy if exists "admin can read alumni" on public.alumni;
create policy "admin can read alumni" on public.alumni for select to authenticated using (public.is_cacsf_admin());
drop policy if exists "admin can read messages" on public.messages;
create policy "admin can read messages" on public.messages for select to authenticated using (public.is_cacsf_admin());

-- Public website visitors can view published media; only approved admins can manage it.
drop policy if exists "admins manage media" on public.media;
create policy "admins manage media" on public.media for all to authenticated using (public.is_cacsf_admin()) with check (public.is_cacsf_admin());
drop policy if exists "admins manage project gallery" on public.project_gallery;
create policy "admins manage project gallery" on public.project_gallery for all to authenticated using (public.is_cacsf_admin()) with check (public.is_cacsf_admin());

-- Storage uploads/removals are restricted to approved admins in the CACSF bucket.
drop policy if exists "CACSF admins upload media" on storage.objects;
create policy "CACSF admins upload media" on storage.objects for insert to authenticated with check (bucket_id = 'cacsf-media' and public.is_cacsf_admin());
drop policy if exists "CACSF admins update media" on storage.objects;
create policy "CACSF admins update media" on storage.objects for update to authenticated using (bucket_id = 'cacsf-media' and public.is_cacsf_admin()) with check (bucket_id = 'cacsf-media' and public.is_cacsf_admin());
drop policy if exists "CACSF admins delete media" on storage.objects;
create policy "CACSF admins delete media" on storage.objects for delete to authenticated using (bucket_id = 'cacsf-media' and public.is_cacsf_admin());

notify pgrst, 'reload schema';

-- Additional admin permissions required by the complete dashboard.
-- These policies are restricted to accounts in public.admin_users via the helper above.
drop policy if exists "admin can update alumni" on public.alumni;
create policy "admin can update alumni" on public.alumni
  for update to authenticated
  using (public.is_cacsf_admin())
  with check (public.is_cacsf_admin());

drop policy if exists "admin can delete alumni" on public.alumni;
create policy "admin can delete alumni" on public.alumni
  for delete to authenticated
  using (public.is_cacsf_admin());

grant select, update, delete on public.alumni to authenticated;
grant select on public.messages to authenticated;

notify pgrst, 'reload schema';
