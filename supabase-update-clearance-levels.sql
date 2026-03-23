-- Migration: Update role values from admin/editor/viewer to super_admin/admin/user
-- Run this ONCE against the Supabase database before deploying the code changes.

-- 1. Drop the existing check constraint that restricts role values
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;

-- 2. Rename existing role values (order matters: rename 'admin' first to avoid conflicts)
UPDATE profiles SET role = 'super_admin' WHERE role = 'admin';
UPDATE profiles SET role = 'admin' WHERE role = 'editor';
UPDATE profiles SET role = 'user' WHERE role = 'viewer';

-- 3. Add new check constraint with the updated values
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check CHECK (role IN ('super_admin', 'admin', 'user'));

-- 4. Update the default role for new users
ALTER TABLE profiles ALTER COLUMN role SET DEFAULT 'user';
