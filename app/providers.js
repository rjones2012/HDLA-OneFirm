'use client';
import { AuthProvider } from '../lib/auth';
import { installAuthFetch } from '../lib/authFetch';

// Install the token-attaching fetch wrapper at module load, before any page effect can fire a request.
// (A useEffect here would run AFTER child effects, so the first /api calls would go out without a token.)
installAuthFetch();

export function Providers({ children }) {
  return <AuthProvider>{children}</AuthProvider>;
}
