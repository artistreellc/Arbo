import React from 'react';
import { Settings2 } from 'lucide-react';

// Shown when the CRM API isn't wired up yet (missing env / schema, or the
// signed-in user isn't on the admin allowlist). Keeps the app friendly instead
// of throwing a raw error at the owner.
const SetupNotice = ({ error }) => {
  const unauthorized = error?.status === 401 || error?.status === 403;
  const forbidden = error?.status === 403;
  return (
    <div className="max-w-xl mx-auto mt-10 bg-white rounded-xl border border-slate-200 p-6">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
          <Settings2 className="w-5 h-5" />
        </div>
        <h2 className="text-lg font-semibold text-slate-900">
          {forbidden ? 'Your account isn’t an admin yet' : 'Almost ready — finish the connection'}
        </h2>
      </div>
      {forbidden ? (
        <p className="text-sm text-slate-600 mb-4">
          You’re signed in, but this email isn’t on the CRM admin allowlist. Add it to{' '}
          <code className="bg-slate-100 px-1 rounded">CRM_ADMIN_EMAILS</code> in the Vercel environment variables and
          redeploy.
        </p>
      ) : (
        <p className="text-sm text-slate-600 mb-4">
          The CRM interface is live, but it isn&apos;t talking to your database yet.
          {unauthorized ? ' Your session may have expired — try signing in again.' : ' A few environment variables need to be set on Vercel.'}
        </p>
      )}
      <ol className="text-sm text-slate-700 space-y-2 list-decimal list-inside">
        <li>
          Run the schema in <code className="bg-slate-100 px-1 rounded">supabase/migrations/</code> on your Supabase project.
        </li>
        <li>
          In Vercel → Settings → Environment Variables, set{' '}
          <code className="bg-slate-100 px-1 rounded">SUPABASE_SERVICE_ROLE_KEY</code>,{' '}
          <code className="bg-slate-100 px-1 rounded">VITE_SUPABASE_URL</code>,{' '}
          <code className="bg-slate-100 px-1 rounded">VITE_SUPABASE_ANON_KEY</code>, and{' '}
          <code className="bg-slate-100 px-1 rounded">CRM_ADMIN_EMAILS</code>.
        </li>
        <li>
          Redeploy. Full step-by-step is in <code className="bg-slate-100 px-1 rounded">README.md</code>.
        </li>
      </ol>
    </div>
  );
};

export default SetupNotice;
