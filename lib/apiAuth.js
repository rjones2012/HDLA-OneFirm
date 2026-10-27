// lib/apiAuth.js — server-only: who is calling this API route?
// Every browser request carries the Supabase session token (Authorization: Bearer <access_token>);
// lib/authFetch.js adds it to every same-origin /api call automatically after sign-in.
import 'server-only';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from './supabaseAdmin';

export const LEADERSHIP = ['partner', 'operations', 'office', 'principal', 'marketing'];
export const FINANCE = ['partner', 'operations', 'office'];
export const PARTNERS = ['partner'];

export async function getCaller(req) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) return null;
  const { data: profile } = await supabaseAdmin.from('staff_profiles').select('id, initials, role, display_name, office').eq('id', data.user.id).single();
  return profile || null;
}

export function hasRole(caller, roles) { return !!caller && roles.includes(caller.role); }

// Returns { caller } or { error: NextResponse }. Usage:
//   const { caller, error } = await requireCaller(req, FINANCE); if (error) return error;
export async function requireCaller(req, roles) {
  const caller = await getCaller(req);
  if (!caller) return { caller: null, error: NextResponse.json({ error: 'Sign in required' }, { status: 401 }) };
  if (roles && !roles.includes(caller.role)) return { caller, error: NextResponse.json({ error: 'Not allowed for your role' }, { status: 403 }) };
  return { caller, error: null };
}

// Vercel cron sends `Authorization: Bearer <CRON_SECRET>` when CRON_SECRET is set in the project.
export function isCron(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return (req.headers.get('authorization') || '') === `Bearer ${secret}`;
}
