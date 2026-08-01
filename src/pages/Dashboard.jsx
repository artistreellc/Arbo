import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { crmApi, CRM_CONFIGURED } from '@/lib/crmApi';
import { PIPELINE_STAGES, sourceMeta, money, timeAgo } from '@/lib/constants';
import { Inbox, KanbanSquare, DollarSign, Hammer, ArrowRight, AlertTriangle } from 'lucide-react';
import SetupNotice from '@/components/SetupNotice';

const OPEN_STAGES = ['new', 'estimate_scheduled', 'estimate_sent', 'won', 'scheduled', 'in_progress'];

const Stat = ({ icon: Icon, label, value, to, tint }) => (
  <Link to={to} className="bg-white rounded-xl border border-slate-200 p-5 hover:shadow-md transition-shadow block">
    <div className="flex items-center justify-between">
      <div>
        <div className="text-2xl font-bold text-slate-900">{value}</div>
        <div className="text-sm text-slate-500 mt-0.5">{label}</div>
      </div>
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${tint}`}>
        <Icon className="w-5 h-5" />
      </div>
    </div>
  </Link>
);

const Dashboard = () => {
  const [state, setState] = useState({ loading: true, error: null, leads: [], jobs: [] });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [{ leads }, { jobs }] = await Promise.all([crmApi.listLeads('new'), crmApi.listJobs()]);
        if (alive) setState({ loading: false, error: null, leads, jobs });
      } catch (e) {
        if (alive) setState((s) => ({ ...s, loading: false, error: e }));
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (!CRM_CONFIGURED || [401, 403].includes(state.error?.status) || state.error?.data?.error === 'not_configured') {
    return <div className="p-6 md:p-8"><SetupNotice error={state.error} /></div>;
  }

  const { loading, leads, jobs } = state;
  const openJobs = jobs.filter((j) => OPEN_STAGES.includes(j.stage));
  const pipelineValue = openJobs.reduce((sum, j) => sum + (Number(j.estimate_amount) || 0), 0);
  const emergencies = [...leads.filter((l) => l.urgency === 'emergency'), ...openJobs.filter((j) => j.priority === 'emergency')];

  return (
    <div className="p-6 md:p-8 max-w-6xl">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <p className="text-slate-500 text-sm">Everything coming in, at a glance.</p>
      </header>

      {emergencies.length > 0 && (
        <div className="mb-6 flex items-start gap-3 bg-red-50 border border-red-200 text-red-800 rounded-xl p-4">
          <AlertTriangle className="w-5 h-5 mt-0.5 shrink-0" />
          <div className="text-sm">
            <strong>{emergencies.length} emergency {emergencies.length === 1 ? 'item' : 'items'}</strong> need attention.
            <Link to="/inbox" className="underline ml-1">Open inbox</Link>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <Stat icon={Inbox} label="New leads" value={loading ? '—' : leads.length} to="/inbox" tint="bg-sky-50 text-sky-600" />
        <Stat icon={Hammer} label="Open jobs" value={loading ? '—' : openJobs.length} to="/pipeline" tint="bg-amber-50 text-amber-600" />
        <Stat icon={DollarSign} label="Pipeline value" value={loading ? '—' : money(pipelineValue)} to="/pipeline" tint="bg-emerald-50 text-emerald-600" />
        <Stat icon={KanbanSquare} label="Total jobs" value={loading ? '—' : jobs.length} to="/pipeline" tint="bg-indigo-50 text-indigo-600" />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Recent leads */}
        <section className="bg-white rounded-xl border border-slate-200">
          <div className="flex items-center justify-between p-4 border-b border-slate-100">
            <h2 className="font-semibold text-slate-900">Latest leads</h2>
            <Link to="/inbox" className="text-sm text-brand hover:underline flex items-center gap-1">
              Inbox <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          <ul className="divide-y divide-slate-100">
            {loading && <li className="p-4 text-sm text-slate-400">Loading…</li>}
            {!loading && leads.length === 0 && <li className="p-6 text-sm text-slate-400 text-center">No new leads yet.</li>}
            {leads.slice(0, 6).map((l) => (
              <li key={l.id} className="p-4 flex items-center gap-3">
                <span className="text-lg" title={sourceMeta(l.source).label}>{sourceMeta(l.source).icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-slate-800 truncate">{l.name || l.phone || l.email || 'Unknown'}</div>
                  <div className="text-xs text-slate-500 truncate">{l.service_needed || l.message || sourceMeta(l.source).label}</div>
                </div>
                <span className="text-xs text-slate-400 whitespace-nowrap">{timeAgo(l.created_at)}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* Pipeline snapshot */}
        <section className="bg-white rounded-xl border border-slate-200">
          <div className="flex items-center justify-between p-4 border-b border-slate-100">
            <h2 className="font-semibold text-slate-900">Pipeline snapshot</h2>
            <Link to="/pipeline" className="text-sm text-brand hover:underline flex items-center gap-1">
              Board <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          <ul className="p-4 space-y-2">
            {PIPELINE_STAGES.filter((s) => s.key !== 'lost').map((s) => {
              const count = jobs.filter((j) => j.stage === s.key).length;
              return (
                <li key={s.key} className="flex items-center justify-between text-sm">
                  <span className={`px-2 py-0.5 rounded border text-xs ${s.color}`}>{s.label}</span>
                  <span className="font-medium text-slate-700">{loading ? '—' : count}</span>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
};

export default Dashboard;
