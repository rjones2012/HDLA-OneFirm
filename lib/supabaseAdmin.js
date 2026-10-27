// Server-only Supabase client with the service-role key (bypasses RLS).
// Import this ONLY from app/api/** and other server code — never from a page or component.
import 'server-only';
import { createClient } from '@supabase/supabase-js';
export { dbToProject, projectToDb } from './supabase';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  // Don't throw at import time (it would break the build); every query will fail loudly instead.
  console.error('OneFirm: SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_URL must be set in the environment');
}

export const supabaseAdmin = createClient(SUPABASE_URL || 'http://localhost', SUPABASE_SERVICE_KEY || 'missing', { auth: { persistSession: false } });
