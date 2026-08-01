import React, { createContext, useContext, useCallback, useState } from 'react';
import { CheckCircle2, AlertTriangle, X } from 'lucide-react';

// A tiny, dependency-free toast system that mirrors the { toast({ title,
// description, variant }) } API the ported CRM pages expect — so those pages
// work unchanged without pulling in Radix. Toasts auto-dismiss after 4s.
const ToastContext = createContext(null);

let idSeq = 0;

export const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const toast = useCallback(
    ({ title, description, variant = 'default' }) => {
      const id = ++idSeq;
      setToasts((t) => [...t, { id, title, description, variant }]);
      setTimeout(() => dismiss(id), 4000);
      return id;
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={{ toast, dismiss }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-[min(92vw,360px)]">
        {toasts.map((t) => {
          const destructive = t.variant === 'destructive';
          const Icon = destructive ? AlertTriangle : CheckCircle2;
          return (
            <div
              key={t.id}
              className={`flex items-start gap-3 rounded-xl border p-3 shadow-lg bg-white ${
                destructive ? 'border-rose-200' : 'border-slate-200'
              }`}
            >
              <Icon className={`w-5 h-5 mt-0.5 shrink-0 ${destructive ? 'text-rose-500' : 'text-emerald-500'}`} />
              <div className="min-w-0 flex-1">
                {t.title && <div className="text-sm font-medium text-slate-900">{t.title}</div>}
                {t.description && <div className="text-xs text-slate-500 mt-0.5 break-words">{t.description}</div>}
              </div>
              <button onClick={() => dismiss(t.id)} className="text-slate-300 hover:text-slate-500">
                <X className="w-4 h-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
};
