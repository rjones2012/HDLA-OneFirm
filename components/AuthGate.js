'use client';
import { useState } from 'react';
import { useAuth, canAccess } from '../lib/auth';

const FONT_H = 'Flecha M, Georgia, serif';
const input = 'w-full border border-rule rounded-md px-3 py-2.5 text-sm bg-white focus:outline-none focus:border-ink';
const label = 'block text-xs text-muted uppercase tracking-wide mb-1';

function Card({ children }) {
  return (
    <div className="min-h-screen bg-ground flex items-center justify-center p-4">
      <div className="bg-white border border-rule rounded-xl p-8 w-full max-w-[380px]">{children}</div>
    </div>
  );
}

export function LoginScreen() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await signIn(email.trim(), password, pin.trim());
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  return (
    <Card>
      <h1 className="text-2xl mb-1" style={{ fontFamily: FONT_H }}>OneFirm</h1>
      <p className="text-sm text-muted mb-6">Hodgson Douglas · sign in to continue</p>
      <form onSubmit={handleLogin} className="space-y-4">
        <div>
          <label className={label}>Email</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} required className={input} placeholder="you@hodgsondouglas.com" autoComplete="username" />
        </div>
        <div>
          <label className={label}>Password</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} required className={input} placeholder="••••••••" autoComplete="current-password" />
        </div>
        <div>
          <label className={label}>Access code</label>
          <input type="password" value={pin} onChange={e => setPin(e.target.value)} required className={input} placeholder="Team access code" autoComplete="off" />
        </div>
        {error && <div className="text-sm text-red-700 bg-red-50 rounded-md px-3 py-2">{error}</div>}
        <button type="submit" disabled={loading} className="w-full bg-ink text-white rounded-md py-2.5 text-sm disabled:opacity-50 hover:bg-black transition-colors">
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <p className="text-xs text-muted mt-4 text-center">
        <a href="/reset" className="hover:underline">Forgot your password?</a> · Contact RJ or CM if you need access
      </p>
    </Card>
  );
}

export function AuthGate({ moduleId, children }) {
  const { user, profile, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-ground flex items-center justify-center">
        <div className="animate-pulse text-muted text-sm">Loading…</div>
      </div>
    );
  }

  if (!user) return <LoginScreen />;

  const role = profile?.role || 'staff';
  if (!canAccess(role, moduleId)) {
    return (
      <Card>
        <h1 className="text-xl mb-2" style={{ fontFamily: FONT_H }}>Access restricted</h1>
        <p className="text-sm text-muted mb-4">
          Your account ({profile?.display_name || profile?.initials || 'Unknown'}) doesn't have access to this module.
        </p>
        <a href="/" className="text-sm text-accent hover:underline">← Back to home</a>
      </Card>
    );
  }

  return children;
}
