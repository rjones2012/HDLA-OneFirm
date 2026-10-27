'use client';
// Installs a fetch interceptor so every same-origin /api request carries the signed-in user's
// Supabase access token. Ported pages call fetch('/api/...') with no headers; this is what lets
// the server verify who is calling without touching every call site.
import { supabase } from './supabase';

let installed = false;

export function installAuthFetch() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const orig = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    try {
      const url = typeof input === 'string' ? input : input?.url || '';
      const sameOriginApi = url.startsWith('/api/') || url.startsWith(window.location.origin + '/api/');
      if (sameOriginApi) {
        const { data } = await supabase.auth.getSession();
        const token = data?.session?.access_token;
        if (token) {
          const headers = new Headers(init.headers || (typeof input !== 'string' ? input.headers : undefined) || {});
          if (!headers.has('authorization')) headers.set('authorization', `Bearer ${token}`);
          init = { ...init, headers };
        }
      }
    } catch (e) { /* fall through to a plain fetch */ }
    return orig(input, init);
  };
}

// For code that wants to be explicit (opening a PDF in a new tab, say)
export async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  return token ? { authorization: `Bearer ${token}` } : {};
}
