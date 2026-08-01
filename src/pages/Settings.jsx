import React, { useEffect, useState, useRef } from 'react';
import { crmApi, CRM_CONFIGURED } from '@/lib/crmApi';
import { useToast } from '@/components/ui/Toast';
import { Save, Bot, Send, Mail, Calendar, Phone, CheckCircle2, Circle, RefreshCw, Globe } from 'lucide-react';
import SetupNotice from '@/components/SetupNotice';

const inputCls = 'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-brand';

const PERSONA_PLACEHOLDER = `Example: Always ask whether the tree is touching a structure or power line first. Push hard for a phone number before anything else. Mention our 5% military/first-responder/senior discount when it fits. Be extra reassuring on storm calls. Never promise a same-day visit — say the team will confirm timing. For stump grinding only, ask the stump diameter.`;

// Live test panel for the AI receptionist.
const ReceptionistTester = () => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [captured, setCaptured] = useState(false);
  const endRef = useRef(null);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    const next = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setInput('');
    setBusy(true);
    try {
      const res = await fetch('/api/crm/receptionist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: next, channel: 'test' }),
      });
      const data = await res.json();
      if (data.reply) setMessages((m) => [...m, { role: 'assistant', content: data.reply }]);
      else setMessages((m) => [...m, { role: 'assistant', content: '(Receptionist unavailable — check ANTHROPIC_API_KEY.)' }]);
      if (data.lead_captured) setCaptured(true);
    } catch {
      setMessages((m) => [...m, { role: 'assistant', content: '(Network error.)' }]);
    } finally {
      setBusy(false);
      setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex items-center gap-2 mb-3">
        <Bot className="w-5 h-5 text-brand" />
        <h3 className="font-semibold text-slate-900">Test the receptionist</h3>
        {captured && <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full ml-auto">Lead captured ✓</span>}
      </div>
      <p className="text-xs text-slate-500 mb-3">Save your instructions first, then role-play a caller. Leads captured here land in your inbox tagged “AI Receptionist.”</p>
      <div className="h-64 overflow-y-auto bg-slate-50 rounded-lg p-3 space-y-2 mb-3">
        {messages.length === 0 && <div className="text-sm text-slate-400 text-center pt-16">Say something like “Hi, I&apos;ve got a big oak leaning over my house.”</div>}
        {messages.map((m, i) => (
          <div key={i} className={`text-sm max-w-[85%] px-3 py-2 rounded-2xl ${m.role === 'user' ? 'ml-auto bg-brand text-white' : 'bg-white border border-slate-200 text-slate-700'}`}>
            {m.content}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <div className="flex gap-2">
        <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} placeholder="Type as a caller…" className={inputCls} />
        <button onClick={send} disabled={busy} className="bg-brand hover:bg-brand-dark text-white px-3 rounded-lg disabled:opacity-50"><Send className="w-4 h-4" /></button>
      </div>
    </div>
  );
};

const Integration = ({ icon: Icon, name, connected, children, action }) => (
  <div className="flex items-start gap-3 py-3">
    <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center text-slate-500 shrink-0"><Icon className="w-4 h-4" /></div>
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-medium text-slate-800 text-sm">{name}</span>
        {connected ? (
          <span className="text-xs text-emerald-600 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Connected</span>
        ) : (
          <span className="text-xs text-slate-400 flex items-center gap-1"><Circle className="w-3.5 h-3.5" /> Not connected</span>
        )}
        {action}
      </div>
      <p className="text-xs text-slate-500 mt-0.5">{children}</p>
    </div>
  </div>
);

const Settings = () => {
  const { toast } = useToast();
  const [state, setState] = useState({ loading: true, error: null });
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [integrations, setIntegrations] = useState(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { settings } = await crmApi.getSettings();
        setState({ loading: false, error: null });
        setForm(settings);
      } catch (e) {
        setState({ loading: false, error: e });
      }
      try {
        const data = await crmApi.getIntegrations();
        setIntegrations(data);
      } catch {
        /* integrations are best-effort */
      }
    })();
  }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    setSaving(true);
    try {
      await crmApi.updateSettings({
        business_name: form.business_name,
        business_phone: form.business_phone,
        business_email: form.business_email,
        notify_email: form.notify_email,
        receptionist_greeting: form.receptionist_greeting,
        receptionist_persona: form.receptionist_persona,
        booking_rules: form.booking_rules,
      });
      toast({ title: 'Settings saved' });
    } catch (e) {
      toast({ title: 'Save failed', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const runGmail = async () => {
    setSyncing(true);
    try {
      const res = await crmApi.runGmailSync();
      toast({ title: 'Gmail sync ran', description: `${res.captured ?? 0} new lead(s) from ${res.scanned ?? 0} email(s).` });
    } catch (e) {
      toast({ title: 'Gmail sync failed', description: e.message, variant: 'destructive' });
    } finally {
      setSyncing(false);
    }
  };

  if (!CRM_CONFIGURED || [401, 403].includes(state.error?.status) || state.error?.data?.error === 'not_configured') {
    return <div className="p-6 md:p-8"><SetupNotice error={state.error} /></div>;
  }
  if (state.loading) return <div className="p-8 text-sm text-slate-400">Loading settings…</div>;

  const gmailOn = integrations?.gmail?.connected;
  const calOn = integrations?.calendar?.connected;
  const resendOn = integrations?.resend?.connected;

  return (
    <div className="p-6 md:p-8 max-w-5xl">
      <header className="mb-6 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Receptionist &amp; Settings</h1>
          <p className="text-slate-500 text-sm">Teach the AI receptionist to handle inbound exactly the way you want.</p>
        </div>
        <button onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 bg-brand hover:bg-brand-dark text-white text-sm px-4 py-2 rounded-lg disabled:opacity-50">
          <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save'}
        </button>
      </header>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
            <h3 className="font-semibold text-slate-900">AI Receptionist</h3>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Greeting</label>
              <input className={inputCls} value={form.receptionist_greeting || ''} onChange={set('receptionist_greeting')} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Your instructions — how you want inbound handled</label>
              <textarea rows={8} className={inputCls} value={form.receptionist_persona || ''} onChange={set('receptionist_persona')} placeholder={PERSONA_PLACEHOLDER} />
              <p className="text-xs text-slate-400 mt-1">Plain English. These rules are layered on top of the built-in safety guardrails (never quotes prices, escalates emergencies, etc.).</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Booking rules</label>
              <textarea rows={3} className={inputCls} value={form.booking_rules || ''} onChange={set('booking_rules')} placeholder="e.g. Estimates Mon–Fri 8am–4pm. Emergencies routed to the on-call phone. Don't book Sundays." />
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
            <h3 className="font-semibold text-slate-900">Business</h3>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="block text-xs font-medium text-slate-500 mb-1">Name</label><input className={inputCls} value={form.business_name || ''} onChange={set('business_name')} /></div>
              <div><label className="block text-xs font-medium text-slate-500 mb-1">Phone</label><input className={inputCls} value={form.business_phone || ''} onChange={set('business_phone')} /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="block text-xs font-medium text-slate-500 mb-1">Business email</label><input className={inputCls} value={form.business_email || ''} onChange={set('business_email')} /></div>
              <div><label className="block text-xs font-medium text-slate-500 mb-1">Notify new leads to</label><input className={inputCls} value={form.notify_email || ''} onChange={set('notify_email')} /></div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <h3 className="font-semibold text-slate-900 mb-1">Lead sources &amp; integrations</h3>
            <p className="text-xs text-slate-500 mb-2">Connect these to auto-feed the inbox. Setup steps are in README.md.</p>
            <div className="divide-y divide-slate-100">
              <Integration icon={Globe} name="Website form" connected>Your site&apos;s contact form posts straight into the inbox.</Integration>
              <Integration icon={Bot} name="AI Receptionist" connected>Captures callers/chatters as leads automatically.</Integration>
              <Integration
                icon={Mail}
                name="Gmail"
                connected={gmailOn}
                action={
                  gmailOn ? (
                    <button onClick={runGmail} disabled={syncing} className="text-xs text-brand hover:underline flex items-center gap-1 ml-auto disabled:opacity-50">
                      <RefreshCw className={`w-3 h-3 ${syncing ? 'animate-spin' : ''}`} /> Sync now
                    </button>
                  ) : null
                }
              >
                Auto-create leads from inquiry emails to your business inbox.
              </Integration>
              <Integration icon={Calendar} name="Google Calendar" connected={calOn}>Push estimates &amp; scheduled jobs onto your calendar.</Integration>
              <Integration icon={Mail} name="Email notifications (Resend)" connected={resendOn}>Email you the moment a new or emergency lead lands.</Integration>
              <Integration icon={Phone} name="Business phone" connected={false}>Log calls &amp; texts (via a number provider) as activities.</Integration>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <ReceptionistTester />
        </div>
      </div>
    </div>
  );
};

export default Settings;
