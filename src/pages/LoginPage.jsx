import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { TreePine, LogIn } from 'lucide-react';

const inputCls =
  'w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand/40';

const LoginPage = () => {
  const { configured, user, signIn, sendReset, loading } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname || '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  // Already signed in → go straight in.
  React.useEffect(() => {
    if (!loading && user) navigate(from, { replace: true });
  }, [loading, user, from, navigate]);

  const submit = async (e) => {
    e.preventDefault();
    if (!configured) {
      toast({ title: 'Auth not configured', description: 'Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.', variant: 'destructive' });
      return;
    }
    setBusy(true);
    const { error } = await signIn(email.trim(), password);
    setBusy(false);
    if (error) {
      toast({ title: 'Sign in failed', description: error.message, variant: 'destructive' });
    } else {
      navigate(from, { replace: true });
    }
  };

  const reset = async () => {
    if (!email.trim()) {
      toast({ title: 'Enter your email first', variant: 'destructive' });
      return;
    }
    const { error } = await sendReset(email.trim());
    toast({
      title: error ? 'Could not send reset' : 'Reset email sent',
      description: error ? error.message : 'Check your inbox for a password reset link.',
      variant: error ? 'destructive' : 'default',
    });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-brand-deep p-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 justify-center mb-6 text-white">
          <div className="w-10 h-10 rounded-lg bg-brand-accent flex items-center justify-center">
            <TreePine className="w-6 h-6" />
          </div>
          <div>
            <div className="font-semibold text-lg leading-tight">Arbo</div>
            <div className="text-xs text-white/60">Tree Service CRM</div>
          </div>
        </div>

        <form onSubmit={submit} className="bg-white rounded-2xl p-6 shadow-xl space-y-4">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">Sign in</h1>
            <p className="text-sm text-slate-500">Admin access to your command center.</p>
          </div>

          {!configured && (
            <div className="text-xs bg-amber-50 border border-amber-200 text-amber-700 rounded-lg p-3">
              Auth isn’t configured yet. Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>, then
              redeploy.
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Email</label>
            <input type="email" autoComplete="email" className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Password</label>
            <input type="password" autoComplete="current-password" className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>

          <button
            type="submit"
            disabled={busy}
            className="w-full inline-flex items-center justify-center gap-2 bg-brand hover:bg-brand-dark text-white text-sm font-medium px-4 py-2.5 rounded-lg disabled:opacity-50"
          >
            <LogIn className="w-4 h-4" /> {busy ? 'Signing in…' : 'Sign in'}
          </button>

          <button type="button" onClick={reset} className="w-full text-xs text-slate-400 hover:text-brand">
            Forgot password?
          </button>
        </form>
      </div>
    </div>
  );
};

export default LoginPage;
