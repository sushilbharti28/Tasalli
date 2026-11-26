import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, setAuthToken, setUnauthorizedHandler, unwrap } from '@/api/client';
import type { User } from '@/api/types';
import { setAppLocale, type AppLocale } from '@/i18n';
import { getItem, KEYS, removeItem, setItem } from '@/lib/storage';

interface AuthState {
  ready: boolean;
  token: string | null;
  user: User | null;
  signIn: (token: string, user: User | undefined) => Promise<void>;
  signOut: () => Promise<void>;
  setUser: (u: User) => void;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);

  const signOut = useCallback(async () => {
    setAuthToken(null);
    setToken(null);
    setUser(null);
    await removeItem(KEYS.token);
    await removeItem(KEYS.setupDraft); // the next account starts its own setup
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => void signOut());
    (async () => {
      const savedLocale = (await getItem(KEYS.locale)) as AppLocale | null;
      if (savedLocale === 'en' || savedLocale === 'hi') await setAppLocale(savedLocale);
      const saved = await getItem(KEYS.token);
      if (saved) {
        setAuthToken(saved);
        try {
          const me = await unwrap(api.GET('/me'));
          setUser(me);
          setToken(saved);
        } catch {
          setAuthToken(null);
        }
      }
      setReady(true);
    })();
    return () => setUnauthorizedHandler(null);
  }, [signOut]);

  const signIn = useCallback(async (t: string, u: User | undefined) => {
    setAuthToken(t);
    await setItem(KEYS.token, t);
    setUser(u ?? null);
    setToken(t);
  }, []);

  const value = useMemo(() => ({ ready, token, user, signIn, signOut, setUser }), [ready, token, user, signIn, signOut]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
