'use client';
import { createContext, useContext, useState, useEffect, useRef } from 'react';
import { supabase } from './supabase';

const AuthContext = createContext(null);

// ─── Access Control Matrix ─────────────────────────────────────
// Role-based module access. 'home' is everyone's landing page; 'admin' is rates, people,
// QuickBooks connection and uploads. Order here is the nav order.
export const MODULES = [
  { id: 'home',      label: 'Home',      path: '/' },
  { id: 'workplan',  label: 'Work Plan', path: '/workplan' },
  { id: 'time',      label: 'Time',      path: '/time' },
  { id: 'marketing', label: 'Marketing', path: '/marketing' },
  { id: 'billing',   label: 'Billing',   path: '/billing' },
  { id: 'exec',      label: 'Exec',      path: '/exec' },
  { id: 'admin',     label: 'Admin',     path: '/admin', quiet: true },
];
const ACCESS_MATRIX = {
  partner:    ['home', 'workplan', 'time', 'marketing', 'billing', 'exec', 'admin'],
  operations: ['home', 'workplan', 'time', 'marketing', 'billing', 'exec', 'admin'],  // CM
  office:     ['home', 'workplan', 'time', 'marketing', 'billing', 'exec'],           // EP
  marketing:  ['home', 'workplan', 'time', 'marketing'],                              // SD
  principal:  ['home', 'workplan', 'time', 'marketing'],                              // MM, AB, RW, HD
  staff:      ['home', 'workplan', 'time'],                                           // everyone else
};

export function canAccess(role, moduleId) {
  const allowed = ACCESS_MATRIX[role] || ACCESS_MATRIX.staff;
  return allowed.includes(moduleId);
}

export function getAccessibleModules(role) {
  return ACCESS_MATRIX[role] || ACCESS_MATRIX.staff;
}

export const isLeadershipRole = role => ['partner', 'operations', 'office', 'marketing', 'principal'].includes(role);
export const isFinanceRole = role => ['partner', 'operations', 'office'].includes(role);

// ─── Auth Provider ─────────────────────────────────────────────
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const signingIn = useRef(false);

  useEffect(() => {
    // Check existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        loadProfile(session.user);
      } else {
        setLoading(false);
      }
    });

    // Listen for auth changes — only handle SIGNED_IN (if not already handling) and SIGNED_OUT
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        setUser(null);
        setProfile(null);
        setLoading(false);
      } else if (event === 'SIGNED_IN' && session?.user && !signingIn.current) {
        loadProfile(session.user);
      }
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  const loadProfile = async (u) => {
    setUser(u);
    try {
      const res = await fetch(`/api/auth-profile?user_id=${u.id}`);
      const data = await res.json();
      setProfile(data.profile || null);
    } catch (e) {
      console.error('Failed to load profile:', e);
      setProfile(null);
    }
    setLoading(false);
  };

  const signIn = async (email, password, pin) => {
    signingIn.current = true;
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      // Verify tier PIN server-side
      const pinRes = await fetch('/api/auth-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: data.user.id, pin }),
      });
      const pinData = await pinRes.json();
      if (!pinData.valid) {
        await supabase.auth.signOut();
        throw new Error('Invalid access code for your role');
      }
      await loadProfile(data.user);
      return data.user;
    } finally {
      signingIn.current = false;
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
  };

  return (
    <AuthContext.Provider value={{ user, profile, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
