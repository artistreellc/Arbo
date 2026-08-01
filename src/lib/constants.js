// Shared CRM vocabulary: pipeline stages, lead statuses, and channels — with
// display labels and colors so the whole app reads consistently.

export const PIPELINE_STAGES = [
  { key: 'new', label: 'New', color: 'bg-slate-100 text-slate-700 border-slate-200' },
  { key: 'estimate_scheduled', label: 'Estimate Scheduled', color: 'bg-sky-100 text-sky-700 border-sky-200' },
  { key: 'estimate_sent', label: 'Estimate Sent', color: 'bg-indigo-100 text-indigo-700 border-indigo-200' },
  { key: 'won', label: 'Won', color: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  { key: 'scheduled', label: 'Scheduled', color: 'bg-teal-100 text-teal-700 border-teal-200' },
  { key: 'in_progress', label: 'In Progress', color: 'bg-amber-100 text-amber-700 border-amber-200' },
  { key: 'completed', label: 'Completed', color: 'bg-green-100 text-green-700 border-green-200' },
  { key: 'paid', label: 'Paid', color: 'bg-green-200 text-green-900 border-green-300' },
  { key: 'lost', label: 'Lost', color: 'bg-rose-100 text-rose-700 border-rose-200' },
];

export const stageMeta = (key) => PIPELINE_STAGES.find((s) => s.key === key) || PIPELINE_STAGES[0];

export const LEAD_STATUSES = [
  { key: 'new', label: 'New' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'qualified', label: 'Qualified' },
  { key: 'converted', label: 'Converted' },
  { key: 'archived', label: 'Archived' },
  { key: 'spam', label: 'Spam' },
];

export const LEAD_SOURCES = {
  website_form: { label: 'Website Form', icon: '🌐' },
  phone: { label: 'Phone Call', icon: '📞' },
  gmail: { label: 'Gmail', icon: '✉️' },
  receptionist: { label: 'AI Receptionist', icon: '🤖' },
  google: { label: 'Google', icon: '🔎' },
  facebook: { label: 'Facebook', icon: '📘' },
  referral: { label: 'Referral', icon: '🤝' },
  manual: { label: 'Manual Entry', icon: '✍️' },
  other: { label: 'Other', icon: '•' },
};

export const sourceMeta = (key) => LEAD_SOURCES[key] || LEAD_SOURCES.other;

export const PRIORITY = {
  emergency: { label: 'Emergency', color: 'bg-red-100 text-red-700' },
  high: { label: 'High', color: 'bg-orange-100 text-orange-700' },
  normal: { label: 'Normal', color: 'bg-slate-100 text-slate-600' },
  low: { label: 'Low', color: 'bg-slate-50 text-slate-400' },
};

export const money = (v) =>
  v == null
    ? '—'
    : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);

export const timeAgo = (iso) => {
  if (!iso) return '';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
};
