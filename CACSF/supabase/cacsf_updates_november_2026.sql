-- CACSF Alumni Website updates (November 2026)
-- Run this script in Supabase SQL Editor after backing up the project.
-- It does not delete or recreate alumni registrations.

-- 1. Keep email and phone mandatory for new/updated registrations.
-- NOT VALID preserves legacy rows that may currently contain blanks, while
-- enforcing the rule for new inserts and future updates.
alter table public.alumni
  drop constraint if exists alumni_email_required;
alter table public.alumni
  add constraint alumni_email_required
  check (email is not null and length(btrim(email)) > 0) not valid;

alter table public.alumni
  drop constraint if exists alumni_phone_required;
alter table public.alumni
  add constraint alumni_phone_required
  check (phone is not null and length(btrim(phone)) > 0) not valid;

-- 2. Correction-link token storage. The Edge Function accesses this table
-- with the service-role key; browser clients must not read or write tokens.
create table if not exists public.alumni_correction_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  alumni_id uuid not null references public.alumni(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists alumni_correction_tokens_alumni_created_idx
  on public.alumni_correction_tokens (alumni_id, created_at desc);
alter table public.alumni_correction_tokens enable row level security;
revoke all on public.alumni_correction_tokens from anon, authenticated;

-- 3. Super-Admin-only clearing of routine activity records.
-- Security and login audit records are deliberately protected from deletion.
-- Requires the existing public.is_cacsf_super_admin() role-check function and
-- public.admin_activity table already used by the current dashboard.
create or replace function public.clear_cacsf_admin_activity(
  p_activity_ids uuid[] default null,
  p_clear_all boolean default false
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer := 0;
begin
  if auth.uid() is null or not public.is_cacsf_super_admin() then
    raise exception 'Only an active Super Admin can clear administrator activity logs.'
      using errcode = '42501';
  end if;

  if p_clear_all is not true and coalesce(array_length(p_activity_ids, 1), 0) = 0 then
    raise exception 'Select at least one activity record to clear.';
  end if;

  delete from public.admin_activity
  where
    (p_clear_all is true or id = any(p_activity_ids))
    and not (
      event_type ~* '(admin_(invited|suspended|reactivated|role_changed|access_removed)|admin_login|admin_logout|(^|_)(login|logout)(_|$)|security|activity_logs_cleared)'
    );

  get diagnostics deleted_count = row_count;

  -- Keep a protected audit trace that a clear operation took place.
  insert into public.admin_activity
    (actor_id, event_type, entity_type, entity_id, details)
  values
    (auth.uid(), 'activity_logs_cleared', 'admin_activity', null,
     jsonb_build_object(
       'deleted_count', deleted_count,
       'scope', case when p_clear_all then 'all_routine_activity' else 'selected_routine_activity' end
     ));

  return deleted_count;
end;
$$;

revoke all on function public.clear_cacsf_admin_activity(uuid[], boolean) from public, anon;
grant execute on function public.clear_cacsf_admin_activity(uuid[], boolean) to authenticated;

notify pgrst, 'reload schema';
