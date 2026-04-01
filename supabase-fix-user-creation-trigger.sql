-- ============================================================
-- Fix: make handle_new_user trigger robust for admin-created users
--
-- Problems with the original trigger:
--  1. Didn't supply `role`, so if the column is NOT NULL the insert threw
--     a constraint error, which rolled back the entire auth.users INSERT
--     ("Database error creating new user").
--  2. No ON CONFLICT guard — re-inviting a removed profile would duplicate-key.
--  3. Any trigger exception blocked user creation entirely.
--
-- Run this ONCE in:
--   Supabase Dashboard → Your Project → SQL Editor
--   https://supabase.com/dashboard/project/txhyfogbyzwueazhrqax/sql
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, username, role)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'username',
    COALESCE(NEW.raw_user_meta_data->>'role', 'user')
  )
  ON CONFLICT (id) DO NOTHING;   -- safe if profile already exists

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block user creation because of a profile-table issue.
  -- The /api/create-user serverless function will upsert the profile row
  -- as a fallback if the trigger didn't create it.
  RETURN NEW;
END;
$$;
