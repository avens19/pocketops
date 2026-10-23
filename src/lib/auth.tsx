import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { resetConnection } from '@/lib/connection';
import { clearCredentials, loadCredentials, saveCredentials } from '@/lib/credentials';
import { SignozClient, type Credentials } from '@/lib/signoz/client';

type AuthState =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'signed-in'; client: SignozClient };

interface AuthContextValue {
  state: AuthState;
  signIn: (credentials: Credentials) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  const queryClient = useQueryClient();

  useEffect(() => {
    let cancelled = false;
    loadCredentials()
      .then((creds) => {
        if (cancelled) return;
        setState(creds ? { status: 'signed-in', client: new SignozClient(creds) } : { status: 'signed-out' });
      })
      .catch(() => !cancelled && setState({ status: 'signed-out' }));
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(
    async (credentials: Credentials) => {
      await saveCredentials(credentials);
      queryClient.clear();
      resetConnection();
      setState({ status: 'signed-in', client: new SignozClient(credentials) });
    },
    [queryClient],
  );

  const signOut = useCallback(async () => {
    await clearCredentials();
    queryClient.clear();
    resetConnection();
    setState({ status: 'signed-out' });
  }, [queryClient]);

  const value = useMemo(() => ({ state, signIn, signOut }), [state, signIn, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/** The signed-in client. Only call from screens that sit behind the signed-in guard. */
export function useClient(): SignozClient {
  const { state } = useAuth();
  if (state.status !== 'signed-in') throw new Error('useClient called while signed out');
  return state.client;
}
