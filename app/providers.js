'use client';
import { useEffect } from 'react';
import { AuthProvider } from '../lib/auth';
import { installAuthFetch } from '../lib/authFetch';

export function Providers({ children }) {
  useEffect(() => { installAuthFetch(); }, []);
  return <AuthProvider>{children}</AuthProvider>;
}
