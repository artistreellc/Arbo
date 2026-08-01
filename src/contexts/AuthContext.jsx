import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { supabase, AUTH_CONFIGURED } from '@/lib/supabaseClient';

// Real Supabase Auth. The provider tracks the current session, exposes the
// access token (JWT) for the API client, and offers email/password sign in and
// sign out. This replaces the Phase-1 shared-token gate.
const AuthContext = createContext(undefined);

export const AuthProvider = ({ children }) => {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!AUTH_CONFIGURED) {
      setLoading(false);
      return;
    }
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session ?? null);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });
    return () => {
      mounted = false;
      sub?.subscription?.unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (email, password) => {
    if (!AUTH_CONFIGURED) return { error: new Error('Auth is not configured.') };
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  }, []);

  const sendReset = useCallback(async (email) => {
    if (!AUTH_CONFIGURED) return { error: new Error('Auth is not configured.') };
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/login`,
    });
    return { error };
  }, []);

  const signOut = useCallback(async () => {
    if (!AUTH_CONFIGURED) return { error: null };
    const { error } = await supabase.auth.signOut();
    return { error };
  }, []);

  const value = useMemo(
    () => ({
      configured: AUTH_CONFIGURED,
      session,
      user: session?.user ?? null,
      token: session?.access_token ?? null,
      loading,
      signIn,
      sendReset,
      signOut,
    }),
    [session, loading, signIn, sendReset, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (ctx === undefined) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
};
