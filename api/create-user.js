// Vercel Serverless Function — creates a new Supabase auth user server-side.
// Uses the service-role key so the calling admin's session is never affected.
// POST /api/create-user   { email: string, password: string }

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://txhyfogbyzwueazhrqax.supabase.co';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' });
  }

  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  // Admin client — never exposed to the browser
  const admin = createClient(SUPABASE_URL, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // skip confirmation email — admin is setting the temp password
  });

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  // Belt-and-suspenders: explicitly upsert the profile row.
  // The handle_new_user trigger should do this, but if it fails (e.g. the
  // role column is NOT NULL and wasn't supplied) the user would be created
  // in auth.users but be invisible in the admin panel.
  // Using ON CONFLICT so this is a no-op if the trigger already created it.
  if (data.user?.id) {
    const { error: profileError } = await admin
      .from('profiles')
      .upsert(
        { id: data.user.id, email: data.user.email, role: 'user' },
        { onConflict: 'id', ignoreDuplicates: true }
      );
    if (profileError) {
      // Log but don't fail — auth user was created successfully
      console.error('Profile upsert warning:', profileError.message);
    }
  }

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ user: data.user });
}
