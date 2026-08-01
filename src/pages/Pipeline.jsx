import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { crmApi, CRM_CONFIGURED } from '@/lib/crmApi';
import { PIPELINE_STAGES, stageMeta, money, timeAgo, PRIORITY } from '@/lib/constants';
import { useToast } from '@/components/ui/Toast';
import { Plus, Phone } from 'lucide-react';
import SetupNotice from '@/components/SetupNotice';

// Columns shown on the board (lost is reachable via the card menu but not a column).
const COLUMNS = PIPELINE_STAGES.filter((s) => s.key !== 'lost');

const JobCard = ({ job, onMove }) => {
  const contact = job.contact || {};
  const pr = PRIORITY[job.priority] || PRIORITY.normal;
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <Link to={`/jobs/${job.id}`} className="font-medium text-slate-800 text-sm hover:text-brand leading-snug">
          {job.title || 'Untitled job'}
        </Link>
        {job.priority && job.priority !== 'normal' && (
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${pr.color}`}>{pr.label}</span>
        )}
      </div>
      {(contact.name || job.address) && (
        <div className="text-xs text-slate-500 mt-1 truncate">{contact.name}{contact.name && job.address ? ' · ' : ''}{job.address}</div>
      )}
      <div className="flex items-center justify-between mt-2">
        <span className="text-xs font-semibold text-emerald-700">{job.estimate_amount != null ? money(job.estimate_amount) : ''}</span>
        {contact.phone && (
          <a href={`tel:${contact.phone}`} className="text-slate-400 hover:text-brand" title={contact.phone}>
            <Phone className="w-3.5 h-3.5" />
          </a>
        )}
      </div>
      <select
        value={job.stage}
        onChange={(e) => onMove(job, e.target.value)}
        className="mt-2 w-full text-xs border border-slate-200 rounded px-1.5 py-1 text-slate-600 bg-slate-50 focus:outline-none focus:ring-1 focus:ring-brand"
      >
        {PIPELINE_STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
      </select>
      <div className="text-[10px] text-slate-300 mt-1">{timeAgo(job.updated_at || job.created_at)}</div>
    </div>
  );
};

const Pipeline = () => {
  const [state, setState] = useState({ loading: true, error: null, jobs: [] });
  const { toast } = useToast();

  const load = useCallback(async () => {
    try {
      const { jobs } = await crmApi.listJobs();
      setState({ loading: false, error: null, jobs });
    } catch (e) {
      setState({ loading: false, error: e, jobs: [] });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const move = async (job, stage) => {
    if (stage === job.stage) return;
    // optimistic
    setState((s) => ({ ...s, jobs: s.jobs.map((j) => (j.id === job.id ? { ...j, stage } : j)) }));
    try {
      await crmApi.updateJob({ id: job.id, stage });
      toast({ title: `Moved to ${stageMeta(stage).label}` });
    } catch (e) {
      toast({ title: 'Move failed', description: e.message, variant: 'destructive' });
      load();
    }
  };

  const addJob = async () => {
    try {
      const { job } = await crmApi.createJob({ title: 'New job', stage: 'new' });
      setState((s) => ({ ...s, jobs: [job, ...s.jobs] }));
      toast({ title: 'Job created — open it to add details' });
    } catch (e) {
      toast({ title: 'Could not create job', description: e.message, variant: 'destructive' });
    }
  };

  if (!CRM_CONFIGURED || [401, 403].includes(state.error?.status) || state.error?.data?.error === 'not_configured') {
    return <div className="p-6 md:p-8"><SetupNotice error={state.error} /></div>;
  }

  const { loading, jobs } = state;

  return (
    <div className="p-6 md:p-8">
      <header className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Pipeline</h1>
          <p className="text-slate-500 text-sm">Lead → estimate → scheduled → done → paid.</p>
        </div>
        <button onClick={addJob} className="inline-flex items-center gap-1.5 bg-brand hover:bg-brand-dark text-white text-sm px-3 py-2 rounded-lg">
          <Plus className="w-4 h-4" /> New job
        </button>
      </header>

      {loading ? (
        <div className="text-sm text-slate-400">Loading board…</div>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {COLUMNS.map((col) => {
            const colJobs = jobs.filter((j) => j.stage === col.key);
            const value = colJobs.reduce((s, j) => s + (Number(j.estimate_amount) || 0), 0);
            return (
              <div key={col.key} className="w-72 shrink-0">
                <div className="flex items-center justify-between mb-2 px-1">
                  <span className={`text-xs font-medium px-2 py-1 rounded border ${col.color}`}>{col.label}</span>
                  <span className="text-xs text-slate-400">{colJobs.length}{value > 0 ? ` · ${money(value)}` : ''}</span>
                </div>
                <div className="space-y-2 bg-slate-100/60 rounded-xl p-2 min-h-[120px]">
                  {colJobs.map((job) => <JobCard key={job.id} job={job} onMove={move} />)}
                  {colJobs.length === 0 && <div className="text-xs text-slate-300 text-center py-6">—</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default Pipeline;
