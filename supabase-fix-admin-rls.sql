-- ============================================================
-- Fix: Allow super_admin and admin roles to update any profile
-- Run this in the Supabase SQL editor:
--   https://supabase.com/dashboard/project/txhyfogbyzwueazhrqax/sql
-- ============================================================

-- Helper function: get the role of the currently authenticated user
-- Uses SECURITY DEFINER so it can read profiles without hitting RLS
create or replace function get_my_role()
returns text
language sql
security definer
stable
as $$
  select role from profiles where id = auth.uid();
$$;

-- ── profiles table RLS policies ─────────────────────────────

-- Allow any authenticated user to read all profiles
-- (needed for the Admin Panel user list)
drop policy if exists "Profiles are viewable by authenticated users" on profiles;
create policy "Profiles are viewable by authenticated users"
  on profiles for select
  to authenticated
  using (true);

-- Allow users to update their own profile (e.g. display name)
drop policy if exists "Users can update own profile" on profiles;
create policy "Users can update own profile"
  on profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Allow super_admin and admin to update ANY profile
-- This is the policy that was missing, causing the Admin Panel save to silently fail
drop policy if exists "Admins can update any profile" on profiles;
create policy "Admins can update any profile"
  on profiles for update
  to authenticated
  using (get_my_role() in ('super_admin', 'admin'))
  with check (get_my_role() in ('super_admin', 'admin'));

-- Allow super_admin and admin to delete any profile
drop policy if exists "Admins can delete any profile" on profiles;
create policy "Admins can delete any profile"
  on profiles for delete
  to authenticated
  using (get_my_role() in ('super_admin', 'admin'));
