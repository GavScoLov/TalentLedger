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
  return profile?.role || 'viewer';
}

// Check if current user is an admin
export async function isAdmin() {
  const role = await getUserRole();
  return role === 'admin';
}

// Get the list of pages the current user can access
export async function getAllowedPages() {
  const profile = await _getProfile();
  if (!profile) return null; // no profile = allow all (graceful fallback)
  if (profile.role === 'admin') return null; // null = all pages
  if (!profile.allowed_pages || !Array.isArray(profile.allowed_pages) || profile.allowed_pages.length === 0) return null;
  return profile.allowed_pages;
}

// Check if the current user can access a specific page, redirect if not
export async function checkPageAccess(pageSlug) {
  const allowed = await getAllowedPages();
  if (allowed === null) return true; // admin has access to everything
  if (!allowed.includes(pageSlug)) {
    window.location.href = './commission.html';
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
  const { error } = await supabase
    .from('profiles')
    .update({ role })
    .eq('id', userId);
  if (error) throw error;
}

// Admin: update a user's allowed pages
export async function updateUserPages(userId, pages) {
  const { error } = await supabase
    .from('profiles')
    .update({ allowed_pages: pages })
    .eq('id', userId);
  if (error) throw error;
}

// Admin: delete a user's profile (does not delete auth user)
export async function deleteUserProfile(userId) {
  const { error } = await supabase
    .from('profiles')
    .delete()
    .eq('id', userId);
  if (error) throw error;
}
