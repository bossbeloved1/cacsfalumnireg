
-- ============================================================
-- CACSF ADO-EKITI ALUMNI WEBSITE
-- COMPLETE DATABASE SETUP
-- EXISTING BIRTHDAY SYSTEM + NEW WEDDING ANNIVERSARY SYSTEM
-- ============================================================

-- ============================================================
-- 1. BIRTHDAY / ALUMNI REGISTRATIONS
-- ============================================================

create table if not exists public.alumni (
  id uuid primary key default gen_random_uuid(),
  alias text not null,
  first_name text not null,
  surname text not null,
  email text,
  birth_month text not null,
  birth_day integer not null
    check (birth_day between 1 and 31),
  graduation_year integer not null,
  phone text,
  profession text,
  photo_path text not null,
  created_at timestamptz not null default now()
);


-- ============================================================
-- 2. CONTACT MESSAGES
-- ============================================================

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  subject text not null,
  message text not null,
  created_at timestamptz not null default now()
);


-- ============================================================
-- 3. REUNION MEDIA
-- ============================================================

create table if not exists public.media (
  id uuid primary key default gen_random_uuid(),
  year integer not null
    check (year between 2023 and 2027),
  category text not null
    check (category in ('designs','images','videos')),
  caption text,
  file_path text not null,
  created_at timestamptz not null default now()
);


-- ============================================================
-- 4. PROJECT GALLERY
-- ============================================================

create table if not exists public.project_gallery (
  id uuid primary key default gen_random_uuid(),
  caption text,
  file_path text not null,
  created_at timestamptz not null default now()
);


-- ============================================================
-- 5. WEDDING ANNIVERSARY REGISTRATIONS
-- COMPLETELY SEPARATE FROM BIRTHDAY REGISTRATIONS
-- ============================================================

create table if not exists public.wedding_registrations (
  id uuid primary key default gen_random_uuid(),

  couple_name text not null,

  wedding_date date not null,

  email text not null,

  -- First photograph is compulsory.
  -- Can be a photograph of both partners together,
  -- or one partner's individual photograph.
  photo_one_path text not null,

  -- Second photograph is optional.
  -- Used when the couple uploads separate photographs.
  photo_two_path text,

  created_at timestamptz not null default now()
);


-- ============================================================
-- 6. ENABLE ROW LEVEL SECURITY
-- ============================================================

alter table public.alumni enable row level security;
alter table public.messages enable row level security;
alter table public.media enable row level security;
alter table public.project_gallery enable row level security;
alter table public.wedding_registrations enable row level security;


-- ============================================================
-- 7. BIRTHDAY REGISTRATION POLICIES
-- ============================================================

drop policy if exists
"public can submit alumni registration"
on public.alumni;

create policy "public can submit alumni registration"
on public.alumni
for insert
to anon, authenticated
with check (true);


-- ============================================================
-- 8. CONTACT MESSAGE POLICIES
-- ============================================================

drop policy if exists
"public can send contact messages"
on public.messages;

create policy "public can send contact messages"
on public.messages
for insert
to anon, authenticated
with check (true);


-- ============================================================
-- 9. REUNION MEDIA POLICIES
-- ============================================================

drop policy if exists
"public can view media"
on public.media;

create policy "public can view media"
on public.media
for select
to anon, authenticated
using (true);


drop policy if exists
"admins manage media"
on public.media;

create policy "admins manage media"
on public.media
for all
to authenticated
using (auth.role() = 'authenticated')
with check (auth.role() = 'authenticated');


-- ============================================================
-- 10. PROJECT GALLERY POLICIES
-- ============================================================

drop policy if exists
"public can view project gallery"
on public.project_gallery;

create policy "public can view project gallery"
on public.project_gallery
for select
to anon, authenticated
using (true);


drop policy if exists
"admins manage project gallery"
on public.project_gallery;

create policy "admins manage project gallery"
on public.project_gallery
for all
to authenticated
using (auth.role() = 'authenticated')
with check (auth.role() = 'authenticated');


-- ============================================================
-- 11. WEDDING REGISTRATION POLICIES
-- ============================================================

-- Visitors can submit wedding registrations.
-- They cannot read or manage wedding records.

drop policy if exists
"public can submit wedding registrations"
on public.wedding_registrations;

create policy "public can submit wedding registrations"
on public.wedding_registrations
for insert
to anon, authenticated
with check (true);


-- Authenticated users can manage wedding records.
-- IMPORTANT: Restrict this to your approved admin accounts
-- before production, using your admin allow-list.

drop policy if exists
"admins manage wedding registrations"
on public.wedding_registrations;

create policy "admins manage wedding registrations"
on public.wedding_registrations
for all
to authenticated
using (auth.role() = 'authenticated')
with check (auth.role() = 'authenticated');


-- ============================================================
-- 12. EXISTING CACSF MEDIA STORAGE BUCKET
-- ============================================================

-- Existing birthday photographs, reunion media and project
-- gallery assets continue using cacsf-media.

insert into storage.buckets (
  id,
  name,
  public
)
values (
  'cacsf-media',
  'cacsf-media',
  true
)
on conflict (id) do nothing;


-- ============================================================
-- 13. NEW SEPARATE WEDDING PHOTO STORAGE BUCKET
-- ============================================================

-- Wedding photographs are stored separately from birthday
-- photographs and other website media.
--
-- Maximum file size: 20 MB per photograph.
-- Accepted formats: JPEG, PNG and WebP.
-- Public bucket allows uploaded photos to display on the site.

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'cacsf-weddings',
  'cacsf-weddings',
  true,
  20971520,
  array[
    'image/jpeg',
    'image/png',
    'image/webp'
  ]
)
on conflict (id) do update
set
  public = true,
  file_size_limit = 20971520,
  allowed_mime_types = array[
    'image/jpeg',
    'image/png',
    'image/webp'
  ];


-- ============================================================
-- 14. WEDDING PHOTO STORAGE POLICIES
-- ============================================================

-- Anyone can view wedding photographs.

drop policy if exists
"Public can view wedding photos"
on storage.objects;

create policy "Public can view wedding photos"
on storage.objects
for select
to anon, authenticated
using (
  bucket_id = 'cacsf-weddings'
);


-- Public visitors can upload wedding photographs.
-- Uploads must be inside the weddings folder.

drop policy if exists
"Public can upload wedding photos"
on storage.objects;

create policy "Public can upload wedding photos"
on storage.objects
for insert
to anon, authenticated
with check (
  bucket_id = 'cacsf-weddings'
  and (storage.foldername(name))[1] = 'weddings'
);


-- Authenticated users can manage wedding photographs.
-- Restrict to approved administrators before production.

drop policy if exists
"Authenticated users manage wedding photos"
on storage.objects;

create policy "Authenticated users manage wedding photos"
on storage.objects
for all
to authenticated
using (
  bucket_id = 'cacsf-weddings'
)
with check (
  bucket_id = 'cacsf-weddings'
);


-- ============================================================
-- 15. INDEXES FOR FASTER ADMIN SEARCH
-- ============================================================

create index if not exists alumni_created_at_idx
on public.alumni (created_at desc);

create index if not exists alumni_birthday_idx
on public.alumni (birth_month, birth_day);

create index if not exists wedding_created_at_idx
on public.wedding_registrations (created_at desc);

create index if not exists wedding_date_idx
on public.wedding_registrations (wedding_date);


-- ============================================================
-- END OF CACSF DATABASE SETUP
-- ============================================================
