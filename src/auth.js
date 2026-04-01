// Auth module — Supabase Auth (with caching to avoid redundant API calls)

import { supabase } from './supabaseClient.js';

// Cache to avoid multiple round-trips per page load
let _cachedUser = undefined;   // undefined = not fetched, null = no user
let _cachedProfile = undefined;

// Internal: get user (cached)
async function _getUser() {
  if (_cachedUser !== undefined) return _cachedUser;
  const { data: { user } } = await supabase.auth.getUser();
  _cachedUser = user || null;
  return _cachedUser;
}

// Internal: get profile (cached)
async function _getProfile() {
  if (_cachedProfile !== undefined) return _cachedProfile;
  const user = await _getUser();
  if (!user) { _cachedProfile = null; return null; }
  const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single();
  _cachedProfile = data || null;
  return _cachedProfile;
}

// Check if user is authenticated, redirect to login if not
export async function checkAuth() {
  const user = await _getUser();
  if (!user) {
    window.location.href = './index.html';
    return null;
  }
  return user;
}

// Sign in with email and password
export async function login(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

// Sign in with Google OAuth
export async function loginWithGoogle() {
  const { data, error } = await supabase.auth.signInWithOAuth({ provider: 'google' });
  if (error) throw error;
  return data;
}

// Sign out
export async function logout() {
  _cachedUser = undefined;
  _cachedProfile = undefined;
  await supabase.auth.signOut();
  window.location.href = './index.html';
}

// Get current user (returns null if not logged in)
export async function getUser() {
  return _getUser();
}

// Get user profile from profiles table
export async function getProfile() {
  return _getProfile();
}

// Listen for auth state changes
export function onAuthStateChange(callback) {
  return supabase.auth.onAuthStateChange((event, session) => {
    callback(event, session);
  });
}

// Get current user's role from profiles table
export async function getUserRole() {
  const profile = await _getProfile();
  return profile?.role || 'user';
}

// Check if current user is a super admin
export async function isSuperAdmin() {
  const role = await getUserRole();
  return role === 'super_admin';
}

// Get the list of pages the current user can access
export async function getAllowedPages() {
  const profile = await _getProfile();
  if (!profile) return null; // no profile = allow all (graceful fallback)
  if (profile.role === 'super_admin') return null; // null = all pages
  if (!profile.allowed_pages || !Array.isArray(profile.allowed_pages) || profile.allowed_pages.length === 0) return null;
  return profile.allowed_pages;
}

// Canonical page order — must match the slug used in each page's checkPageAccess() call
const _PAGE_ORDER = [
  { slug: 'dashboard',             file: 'dashboard.html' },
  { slug: 'commission',            file: 'commission.html' },
  { slug: 'data-visualization',    file: 'data-visualization.html' },
  { slug: 'hours-breakdown',       file: 'hours-breakdown.html' },
  { slug: 'profit-loss',           file: 'profit-loss.html' },
  { slug: 'timesheet-review',      file: 'timesheet-review.html' },
  { slug: 'time-tracker-settings', file: 'time-tracker-settings.html' },
  { slug: 'worker-assignments',    file: 'worker-assignments.html' },
  { slug: 'scheduler',             file: 'scheduler.html' },
  { slug: 'tempworks',             file: 'tempworks.html' },
  { slug: 'reports',               file: 'reports.html' },
  { slug: 'roster-tracker',        file: 'roster-tracker.html' },
  { slug: 'state-tax',             file: 'state-tax.html' },
  { slug: 'settings',              file: 'settings.html' },
];

// Get the landing page for the current user (first page they have access to).
// Super admins and unrestricted users always land on dashboard.
export async function getHomePage() {
  const allowed = await getAllowedPages();
  if (allowed === null) return './dashboard.html';
  const first = _PAGE_ORDER.find(p => allowed.includes(p.slug));
  if (first) return './' + first.file;
  // No recognized page found (e.g. stale/unknown slug in allowed_pages).
  // Sign out to avoid a redirect loop — user will see the login page cleanly.
  _cachedUser = undefined;
  _cachedProfile = undefined;
  await supabase.auth.signOut();
  return './index.html';
}

// Check if the current user can access a specific page, redirect if not
export async function checkPageAccess(pageSlug) {
  const allowed = await getAllowedPages();
  if (allowed === null) return true; // admin has access to everything
  if (!allowed.includes(pageSlug)) {
    window.location.href = await getHomePage();
    return false;
  }
  return true;
}

// Admin: get all user profiles
export async function getAllUsers() {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

// Admin: update a user's role
export async function updateUserRole(userId, role) {
  const { data, error } = await supabase
    .from('profiles')
    .update({ role })
    .eq('id', userId)
    .select('id');
  if (error) throw error;
  // If RLS silently blocks the update, data will be empty
  if (!data || data.length === 0) {
    throw new Error('Update was blocked — check Supabase RLS policies on the profiles table (see supabase-migration.sql for the fix).');
  }
}

// Admin: update a user's allowed pages
export async function updateUserPages(userId, pages) {
  const { data, error } = await supabase
    .from('profiles')
    .update({ allowed_pages: pages })
    .eq('id', userId)
    .select('id');
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error('Update was blocked — check Supabase RLS policies on the profiles table (see supabase-migration.sql for the fix).');
  }
}

// Admin: delete a user's profile (does not delete auth user)
export async function deleteUserProfile(userId) {
  const { error } = await supabase
    .from('profiles')
    .delete()
    .eq('id', userId);
  if (error) throw error;
}

// ── Company management ──

// Get all companies
export async function getAllCompanies() {
  const { data, error } = await supabase
    .from('roster_companies')
    .select('*')
    .order('name');
  if (error) throw error;
  return data || [];
}

// Create a new company
export async function createCompany(name, slug) {
  const { data, error } = await supabase
    .from('roster_companies')
    .insert({ name, slug })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Delete a company
export async function deleteCompany(companyId) {
  const { error } = await supabase
    .from('roster_companies')
    .delete()
    .eq('id', companyId);
  if (error) throw error;
}

// ── User-Company assignments ──

// Get all user-company assignments
export async function getAllUserCompanies() {
  const { data, error } = await supabase
    .from('roster_user_companies')
    .select('*');
  if (error) throw error;
  return data || [];
}

// Set companies for a user (replace all)
export async function setUserCompanies(userId, companyIds) {
  // Delete existing assignments
  const { error: delError } = await supabase
    .from('roster_user_companies')
    .delete()
    .eq('user_id', userId);
  if (delError) throw delError;

  // Insert new assignments
  if (companyIds.length > 0) {
    const rows = companyIds.map(cid => ({ user_id: userId, company_id: cid }));
    const { error: insError } = await supabase
      .from('roster_user_companies')
      .insert(rows);
    if (insError) throw insError;
  }
}

// ── User creation (invite) ──

// Create a new user with email + temporary password.
// Calls the /api/create-user serverless function so the admin's session
// is never replaced (supabase.auth.signUp would log in as the new user).
export async function createUserWithEmail(email, password) {
  const res = await fetch('/api/create-user', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to create user');
  return data;
}
