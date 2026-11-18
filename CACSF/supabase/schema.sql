-- Run this script in Supabase SQL Editor.
create table if not exists public.alumni (
  id uuid primary key default gen_random_uuid(),
  alias text not null,
  first_name text not null,
  surname text not null,
  email text,
  birth_month text not null,
  birth_day integer not null check (birth_day between 1 and 31),
  graduation_year integer not null,
  phone text,
  profession text,
  photo_path text not null,
  created_at timestamptz not null default now()
);
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  subject text not null,
  message text not null,
  created_at timestamptz not null default now()
);
create table if not exists public.media (
  id uuid primary key default gen_random_uuid(),
  year integer not null check (year between 2023 and 2027),
  category text not null check (category in ('designs','images','videos')),
  caption text,
  file_path text not null,
  created_at timestamptz not null default now()
);
create table if not exists public.project_gallery (
  id uuid primary key default gen_random_uuid(),
  caption text,
  file_path text not null,
  created_at timestamptz not null default now()
);
alter table public.alumni enable row level security;
alter table public.messages enable row level security;
alter table public.media enable row level security;
alter table public.project_gallery enable row level security;

-- Public users may submit registrations and contact messages.
create policy "public can submit alumni registration" on public.alumni for insert to anon, authenticated with check (true);
create policy "public can send contact messages" on public.messages for insert to anon, authenticated with check (true);
-- Public may view published media; admin-only writes are performed by authenticated users.
create policy "public can view media" on public.media for select to anon, authenticated using (true);
create policy "admins manage media" on public.media for all to authenticated using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "public can view project gallery" on public.project_gallery for select to anon, authenticated using (true);
create policy "admins manage project gallery" on public.project_gallery for all to authenticated using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- NOTE: For real production use, create an admin allow-list and replace broad
-- authenticated write policies with checks against that allow-list. Do not
-- assume every authenticated account should be an administrator.

-- Create a Storage bucket named cacsf-media in Supabase Storage.
-- Set it to PUBLIC so public gallery assets can render. Add upload policies
-- restricted to authenticated admin users. Public upload for alumni photos
-- may be enabled for INSERT only, with file size/type limits enforced in bucket settings.
