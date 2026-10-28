'use client';
// Password reset. Two modes on one page:
//   /reset            → ask for an email; Supabase sends a link that lands back here.
//   /reset#access_token=…&type=recovery  → Supabase has signed the person in with a recovery
//                        session; show the new-password form, save, go home.
// This page is deliberately outside the Shell/login gate so it works while signed out.
// Supabase → Authentication → URL Configuration: Site URL must be this site, and
// https://<site>/reset must be in Redirect URLs.
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

const FONT_H = 'Flecha M, Georgia, serif';
const input = 'w-full border border-rule rounded-md px-3 py-2.5 text-sm bg-white focus:outline-none focus:border-ink';

export default function ResetPage() {
  const [mode, setMode] = useState('request'); // 'request' | 'set' | 'done'
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    // Arriving from the email link: the URL hash carries a recovery token and the client fires PASSWORD_RECOVERY.
    if (typeof window !== 'undefined' && /type=recovery/.test(window.location.hash)) setMode('set');
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setMode('set');
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  async function request(e) {
    e.preventDefault(); setBusy(true); setErr(''); setMsg('');
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/reset` });
      if (error) throw error;
      setMsg('Check your email for a reset link. It expires in an hour.');
    } catch (e2) { setErr(e2.message || 'Could not send the reset email.'); }
    setBusy(false);
  }

  async function save(e) {
    e.preventDefault(); setErr('');
    if (pw.length < 8) return setErr('Use at least 8 characters.');
    if (pw !== pw2) return setErr('The two passwords do not match.');
    setBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('This reset link has expired or was already used. Request a new one.');
      const { error } = await supabase.auth.updateUser({ password: pw });
      if (error) throw error;
      setMode('done');
      setTimeout(() => { window.location.href = '/'; }, 1200);
    } catch (e2) { setErr(e2.message || 'Could not save the new password.'); }
    setBusy(false);
  }

  return (
    <div className="min-h-screen bg-ground flex items-center justify-center p-4">
      <div className="bg-white border border-rule rounded-xl p-8 w-full max-w-[380px]">
        <h1 className="text-2xl mb-1" style={{ fontFamily: FONT_H }}>OneFirm</h1>
        {mode === 'request' && (
          <>
            <p className="text-sm text-muted mb-6">Reset your password</p>
            <form onSubmit={request} className="space-y-4">
              <div>
                <label className="block text-xs text-muted uppercase tracking-wide mb-1">Email</label>
                <input type="email" required value={email} onChange={e => setEmail(e.target.value)} className={input} placeholder="you@hodgsondouglas.com" />
              </div>
              {msg && <div className="text-sm bg-accent-tint text-ink rounded-md px-3 py-2">{msg}</div>}
              {err && <div className="text-sm text-red-700 bg-red-50 rounded-md px-3 py-2">{err}</div>}
              <button type="submit" disabled={busy} className="w-full bg-ink text-white rounded-md py-2.5 text-sm disabled:opacity-50">{busy ? 'Sending…' : 'Send reset link'}</button>
            </form>
            <p className="text-xs text-muted mt-4 text-center"><a href="/" className="hover:underline">← Back to sign in</a></p>
          </>
        )}
        {mode === 'set' && (
          <>
            <p className="text-sm text-muted mb-6">Choose a new password</p>
            <form onSubmit={save} className="space-y-4">
              <div>
                <label className="block text-xs text-muted uppercase tracking-wide mb-1">New password</label>
                <input type="password" required value={pw} onChange={e => setPw(e.target.value)} className={input} autoComplete="new-password" />
              </div>
              <div>
                <label className="block text-xs text-muted uppercase tracking-wide mb-1">Again</label>
                <input type="password" required value={pw2} onChange={e => setPw2(e.target.value)} className={input} autoComplete="new-password" />
              </div>
              {err && <div className="text-sm text-red-700 bg-red-50 rounded-md px-3 py-2">{err}</div>}
              <button type="submit" disabled={busy} className="w-full bg-ink text-white rounded-md py-2.5 text-sm disabled:opacity-50">{busy ? 'Saving…' : 'Save password'}</button>
            </form>
          </>
        )}
        {mode === 'done' && <p className="text-sm text-muted">Password saved. Taking you to OneFirm…</p>}
      </div>
    </div>
  );
}
