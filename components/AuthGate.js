'use client';
import { useState } from 'react';
import { useAuth, canAccess } from '../lib/auth';

const FONT_H = 'Flecha M, Georgia, serif';

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
      await signIn(email, password, pin);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-8 w-[380px]">
        <h1 className="text-2xl font-bold text-gray-900 mb-1" style={{ fontFamily: FONT_H }}>HDLA Hub</h1>
        <p className="text-sm text-gray-500 mb-6">Sign in to continue</p>
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Email</label>
            <input
              type="email" value={email} onChange={e => setEmail(e.target.value)} required
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-hdla-green"
              placeholder="you@hodgsondouglas.com"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Password</label>
            <input
              type="password" value={password} onChange={e => setPassword(e.target.value)} required
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-hdla-green"
              placeholder="••••••••"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Access Code</label>
            <input
              type="password" value={pin} onChange={e => setPin(e.target.value)} required
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-hdla-green"
              placeholder="Team access code"
            />
          </div>
          {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}
          <button
            type="submit" disabled={loading}
            className="w-full bg-hdla-green text-white rounded-lg py-2.5 text-sm font-semibold disabled:opacity-50 hover:bg-opacity-90 transition-colors"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
        <p className="text-xs text-gray-400 mt-4 text-center">Contact RJ or CM if you need access</p>
      </div>
    </div>
  );
}

export function AuthGate({ moduleId, children }) {
  const { user, profile, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-pulse text-gray-400">Loading...</div>
      </div>
    );
  }

  if (!user) return <LoginScreen />;

  const role = profile?.role || 'staff';
  if (!canAccess(role, moduleId)) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-8 w-[420px] text-center">
          <h1 className="text-xl font-bold text-gray-900 mb-2" style={{ fontFamily: FONT_H }}>Access Restricted</h1>
          <p className="text-sm text-gray-500 mb-4">
            Your account ({profile?.display_name || profile?.initials || 'Unknown'}) doesn't have access to this module.
          </p>
          <a href="/" className="text-sm text-hdla-green font-medium hover:underline">← Back to Hub</a>
        </div>
      </div>
    );
  }

  return children;
}
