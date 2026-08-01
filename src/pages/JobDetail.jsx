import React, { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { crmApi, CRM_CONFIGURED } from '@/lib/crmApi';
import { PIPELINE_STAGES, stageMeta, timeAgo } from '@/lib/constants';
import { useToast } from '@/components/ui/Toast';
import { ArrowLeft, Phone, Mail, MapPin, Save, MessageSquarePlus, CalendarPlus, CalendarCheck, Trash2 } from 'lucide-react';
import SetupNotice from '@/components/SetupNotice';

const Field = ({ label, children }) => (
  <div>
    <label className="block text-xs font-medium text-slate-500 mb-1">{label}</label>
    {children}
  </div>
);

const inputCls = 'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-brand';

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');

const JobDetail = () => {
  const { id } = useParams();
  const { toast } = useToast();
  const [state, setState] = useState({ loading: true, error: null });
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState('');
  const [noteType, setNoteType] = useState('note');
  const [appt, setAppt] = useState({ kind: 'estimate', starts_at: '' });

  const load = useCallback(async () => {
    try {
      const data = await crmApi.getJob(id);
      setState({ loading: false, error: null, ...data });
      setForm({
        title: data.job.title || '',
        service_type: data.job.service_type || '',
        stage: data.job.stage,
        priority: data.job.priority || 'normal',
        estimate_amount: data.job.estimate_amount ?? '',
        final_amount: data.job.final_amount ?? '',
        scheduled_for: data.job.scheduled_for ? data.job.scheduled_for.slice(0, 16) : '',
        address: data.job.address || '',
        description: data.job.description || '',
      });
    } catch (e) {
      setState({ loading: false, error: e });
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    setSaving(true);
    try {
      await crmApi.updateJob({
        id,
        ...form,
        scheduled_for: form.scheduled_for ? new Date(form.scheduled_for).toISOString() : null,
      });
      toast({ title: 'Saved' });
      await load();
    } catch (e) {
      toast({ title: 'Save failed', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const addNote = async () => {
    if (!note.trim()) return;
    try {
      await crmApi.addActivity({ job_id: id, contact_id: state.contact?.id, type: noteType, direction: noteType === 'call' ? 'outbound' : null, body: note.trim() });
      setNote('');
      toast({ title: 'Logged' });
      await load();
    } catch (e) {
      toast({ title: 'Could not log', description: e.message, variant: 'destructive' });
    }
  };

  const addAppointment = async () => {
    if (!appt.starts_at) {
      toast({ title: 'Pick a date & time first', variant: 'destructive' });
      return;
    }
    try {
      const { calendar_synced } = await crmApi.createAppointment({
        job_id: id,
        contact_id: state.contact?.id,
        kind: appt.kind,
        title: `${appt.kind === 'estimate' ? 'Estimate' : 'Job'} — ${state.job.title || 'Tree work'}`,
        location: form.address || state.job.address,
        starts_at: new Date(appt.starts_at).toISOString(),
      });
      setAppt({ kind: 'estimate', starts_at: '' });
      toast({ title: calendar_synced ? 'Added & pushed to Google Calendar' : 'Appointment added' });
      await load();
    } catch (e) {
      toast({ title: 'Could not add appointment', description: e.message, variant: 'destructive' });
    }
  };

  const removeAppointment = async (apptId) => {
    try {
      await crmApi.deleteAppointment(apptId);
      toast({ title: 'Appointment removed' });
      await load();
    } catch (e) {
      toast({ title: 'Could not remove', description: e.message, variant: 'destructive' });
    }
  };

  if (!CRM_CONFIGURED || [401, 403].includes(state.error?.status)) {
    return <div className="p-6 md:p-8"><SetupNotice error={state.error} /></div>;
  }
  if (state.loading) return <div className="p-8 text-sm text-slate-400">Loading job…</div>;
  if (state.error) return <div className="p-8 text-sm text-rose-600">Couldn&apos;t load this job.</div>;

  const { job, contact, activities = [], appointments = [] } = state;

  return (
    <div className="p-6 md:p-8 max-w-4xl">
      <Link to="/pipeline" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand mb-4">
        <ArrowLeft className="w-4 h-4" /> Back to pipeline
      </Link>

      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{job.title || 'Untitled job'}</h1>
          <span className={`inline-block mt-2 text-xs font-medium px-2 py-1 rounded border ${stageMeta(job.stage).color}`}>{stageMeta(job.stage).label}</span>
        </div>
        <button onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 bg-brand hover:bg-brand-dark text-white text-sm px-4 py-2 rounded-lg disabled:opacity-50">
          <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        {/* Job form */}
        <div className="md:col-span-2 bg-white rounded-xl border border-slate-200 p-5 space-y-4">
          <Field label="Job title"><input className={inputCls} value={form.title} onChange={set('title')} /></Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Service type"><input className={inputCls} value={form.service_type} onChange={set('service_type')} placeholder="Tree removal…" /></Field>
            <Field label="Stage">
              <select className={inputCls} value={form.stage} onChange={set('stage')}>
                {PIPELINE_STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Priority">
              <select className={inputCls} value={form.priority} onChange={set('priority')}>
                <option value="emergency">Emergency</option>
                <option value="high">High</option>
                <option value="normal">Normal</option>
                <option value="low">Low</option>
              </select>
            </Field>
            <Field label="Scheduled for"><input type="datetime-local" className={inputCls} value={form.scheduled_for} onChange={set('scheduled_for')} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Estimate ($)"><input type="number" className={inputCls} value={form.estimate_amount} onChange={set('estimate_amount')} /></Field>
            <Field label="Final billed ($)"><input type="number" className={inputCls} value={form.final_amount} onChange={set('final_amount')} /></Field>
          </div>
          <Field label="Property address"><input className={inputCls} value={form.address} onChange={set('address')} /></Field>
          <Field label="Description / scope"><textarea rows={4} className={inputCls} value={form.description} onChange={set('description')} /></Field>
        </div>

        {/* Contact + appointments + timeline */}
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <h3 className="font-semibold text-slate-900 mb-3">Contact</h3>
            {contact ? (
              <div className="space-y-2 text-sm">
                <div className="font-medium text-slate-800">{contact.name || 'Unknown'}</div>
                {contact.phone && <a href={`tel:${contact.phone}`} className="flex items-center gap-2 text-slate-600 hover:text-brand"><Phone className="w-4 h-4" />{contact.phone}</a>}
                {contact.email && <a href={`mailto:${contact.email}`} className="flex items-center gap-2 text-slate-600 hover:text-brand"><Mail className="w-4 h-4" />{contact.email}</a>}
                {contact.address && <div className="flex items-center gap-2 text-slate-600"><MapPin className="w-4 h-4" />{contact.address}</div>}
              </div>
            ) : (
              <p className="text-sm text-slate-400">No contact linked.</p>
            )}
          </div>

          {/* Appointments → Google Calendar */}
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <h3 className="font-semibold text-slate-900 mb-3">Appointments</h3>
            <ul className="space-y-2 mb-3">
              {appointments.length === 0 && <li className="text-sm text-slate-400">None scheduled.</li>}
              {appointments.map((a) => (
                <li key={a.id} className="flex items-start gap-2 text-sm border-l-2 border-slate-100 pl-3">
                  <CalendarCheck className={`w-4 h-4 mt-0.5 shrink-0 ${a.google_event_id ? 'text-emerald-500' : 'text-slate-300'}`} />
                  <div className="min-w-0 flex-1">
                    <div className="text-slate-700 capitalize">{a.kind}</div>
                    <div className="text-xs text-slate-500">{fmtDate(a.starts_at)}</div>
                    <div className="text-[10px] text-slate-400">{a.google_event_id ? 'On Google Calendar' : a.sync_status === 'failed' ? 'Calendar sync failed' : 'Local only'}</div>
                  </div>
                  <button onClick={() => removeAppointment(a.id)} className="text-slate-300 hover:text-rose-500" title="Remove">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <select value={appt.kind} onChange={(e) => setAppt((s) => ({ ...s, kind: e.target.value }))} className="text-xs border border-slate-200 rounded-lg px-2 bg-slate-50">
                <option value="estimate">Estimate</option>
                <option value="job">Job</option>
                <option value="follow_up">Follow-up</option>
              </select>
              <input type="datetime-local" value={appt.starts_at} onChange={(e) => setAppt((s) => ({ ...s, starts_at: e.target.value }))} className="flex-1 text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand" />
              <button onClick={addAppointment} className="bg-brand hover:bg-brand-dark text-white px-2.5 rounded-lg" title="Add & sync to Google Calendar">
                <CalendarPlus className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <h3 className="font-semibold text-slate-900 mb-3">Activity</h3>
            <div className="flex gap-2 mb-2">
              <select value={noteType} onChange={(e) => setNoteType(e.target.value)} className="text-xs border border-slate-200 rounded-lg px-2 bg-slate-50">
                <option value="note">Note</option>
                <option value="call">Call</option>
                <option value="email">Email</option>
                <option value="sms">SMS</option>
              </select>
            </div>
            <div className="flex gap-2 mb-4">
              <input value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addNote()} placeholder="Log a note or call…" className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-brand" />
              <button onClick={addNote} className="bg-brand hover:bg-brand-dark text-white px-2.5 rounded-lg"><MessageSquarePlus className="w-4 h-4" /></button>
            </div>
            <ul className="space-y-3 max-h-80 overflow-y-auto">
              {activities.length === 0 && <li className="text-sm text-slate-400">No activity yet.</li>}
              {activities.map((a) => (
                <li key={a.id} className="text-sm border-l-2 border-slate-100 pl-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-slate-500 uppercase">{a.type.replace('_', ' ')}</span>
                    <span className="text-xs text-slate-300">{timeAgo(a.created_at)}</span>
                  </div>
                  {a.subject && <div className="text-slate-700">{a.subject}</div>}
                  {a.body && <div className="text-slate-600 whitespace-pre-wrap">{a.body}</div>}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default JobDetail;
