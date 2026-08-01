import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { crmApi, CRM_CONFIGURED } from '@/lib/crmApi';
import { sourceMeta, timeAgo } from '@/lib/constants';
import { useToast } from '@/components/ui/Toast';
import { Phone, Mail, MapPin, ArrowRightCircle, Archive, Ban, CheckCircle2 } from 'lucide-react';
import SetupNotice from '@/components/SetupNotice';

const FILTERS = [
  { key: 'new', label: 'New' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'qualified', label: 'Qualified' },
  { key: 'all', label: 'All' },
];

const LeadInbox = () => {
  const [filter, setFilter] = useState('new');
  const [state, setState] = useState({ loading: true, error: null, leads: [] });
  const [busy, setBusy] = useState(null);
  const { toast } = useToast();
  const navigate = useNavigate();

  const load = useCallback(async (status) => {
    setState((s) => ({ ...s, loading: true }));
    try {
      const { leads } = await crmApi.listLeads(status);
      setState({ loading: false, error: null, leads });
    } catch (e) {
      setState({ loading: false, error: e, leads: [] });
    }
  }, []);

  useEffect(() => {
    load(filter);
  }, [filter, load]);

  const act = async (fn, id, successMsg) => {
    setBusy(id);
    try {
      await fn();
      if (successMsg) toast({ title: successMsg });
      await load(filter);
    } catch (e) {
      toast({ title: 'Something went wrong', description: e.message, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const convert = (lead) =>
    act(
      async () => {
        const { job } = await crmApi.convertLead(lead.id);
        navigate(`/jobs/${job.id}`);
      },
      lead.id,
      'Lead added to pipeline'
    );

  if (!CRM_CONFIGURED || [401, 403].includes(state.error?.status) || state.error?.data?.error === 'not_configured') {
    return <div className="p-6 md:p-8"><SetupNotice error={state.error} /></div>;
  }

  const { loading, leads } = state;

  return (
    <div className="p-6 md:p-8 max-w-5xl">
      <header className="mb-5">
        <h1 className="text-2xl font-bold text-slate-900">Lead Inbox</h1>
        <p className="text-slate-500 text-sm">Every inquiry from every channel — triage it here.</p>
      </header>

      <div className="flex gap-2 mb-4 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
              filter === f.key ? 'bg-brand text-white border-brand' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading && <div className="text-sm text-slate-400 p-4">Loading leads…</div>}
      {!loading && leads.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-slate-400">
          Nothing here. New leads from your website, receptionist, and synced channels will appear automatically.
        </div>
      )}

      <ul className="space-y-3">
        {leads.map((lead) => {
          const src = sourceMeta(lead.source);
          const isEmergency = lead.urgency === 'emergency';
          return (
            <li
              key={lead.id}
              className={`bg-white rounded-xl border p-4 md:p-5 ${isEmergency ? 'border-red-300 ring-1 ring-red-100' : 'border-slate-200'}`}
            >
              <div className="flex items-start gap-4">
                <div className="text-2xl leading-none pt-0.5" title={src.label}>{src.icon}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-slate-900">{lead.name || 'Unknown caller'}</span>
                    <span className="text-xs text-slate-400">via {src.label}</span>
                    {isEmergency && <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">EMERGENCY</span>}
                    <span className="text-xs text-slate-400 ml-auto">{timeAgo(lead.created_at)}</span>
                  </div>

                  {lead.service_needed && <div className="text-sm font-medium text-brand mt-1">{lead.service_needed}</div>}
                  {lead.message && <p className="text-sm text-slate-600 mt-1 whitespace-pre-wrap line-clamp-4">{lead.message}</p>}

                  <div className="flex items-center gap-4 mt-2 text-sm text-slate-500 flex-wrap">
                    {lead.phone && <a href={`tel:${lead.phone}`} className="flex items-center gap-1 hover:text-brand"><Phone className="w-3.5 h-3.5" />{lead.phone}</a>}
                    {lead.email && <a href={`mailto:${lead.email}`} className="flex items-center gap-1 hover:text-brand"><Mail className="w-3.5 h-3.5" />{lead.email}</a>}
                    {lead.address && <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{lead.address}</span>}
                  </div>

                  <div className="flex items-center gap-2 mt-4 flex-wrap">
                    <button
                      disabled={busy === lead.id}
                      onClick={() => convert(lead)}
                      className="inline-flex items-center gap-1.5 text-sm bg-brand hover:bg-brand-dark text-white px-3 py-1.5 rounded-lg disabled:opacity-50"
                    >
                      <ArrowRightCircle className="w-4 h-4" /> Add to pipeline
                    </button>
                    {lead.status !== 'contacted' && (
                      <button
                        disabled={busy === lead.id}
                        onClick={() => act(() => crmApi.setLeadStatus(lead.id, 'contacted'), lead.id, 'Marked as contacted')}
                        className="inline-flex items-center gap-1.5 text-sm bg-white border border-slate-200 hover:border-slate-300 text-slate-700 px-3 py-1.5 rounded-lg disabled:opacity-50"
                      >
                        <CheckCircle2 className="w-4 h-4" /> Contacted
                      </button>
                    )}
                    <button
                      disabled={busy === lead.id}
                      onClick={() => act(() => crmApi.setLeadStatus(lead.id, 'archived'), lead.id, 'Archived')}
                      className="inline-flex items-center gap-1.5 text-sm bg-white border border-slate-200 hover:border-slate-300 text-slate-500 px-3 py-1.5 rounded-lg disabled:opacity-50"
                    >
                      <Archive className="w-4 h-4" /> Archive
                    </button>
                    <button
                      disabled={busy === lead.id}
                      onClick={() => act(() => crmApi.setLeadStatus(lead.id, 'spam'), lead.id)}
                      className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-rose-600 px-2 py-1.5 rounded-lg disabled:opacity-50"
                      title="Mark as spam"
                    >
                      <Ban className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default LeadInbox;
