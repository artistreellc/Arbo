import React from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { LayoutDashboard, Inbox, KanbanSquare, Settings, TreePine, LogOut, Phone } from 'lucide-react';

const NAV = [
  { to: '/', end: true, label: 'Dashboard', icon: LayoutDashboard },
  { to: '/inbox', label: 'Lead Inbox', icon: Inbox },
  { to: '/pipeline', label: 'Pipeline', icon: KanbanSquare },
  { to: '/settings', label: 'Receptionist & Settings', icon: Settings },
];

const CrmLayout = () => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col md:flex-row">
      {/* Sidebar */}
      <aside className="md:w-64 md:min-h-screen bg-brand-deep text-white flex md:flex-col md:sticky md:top-0">
        <div className="p-4 md:p-6 flex items-center gap-2 border-b border-white/10 w-full">
          <div className="w-9 h-9 rounded-lg bg-brand-accent flex items-center justify-center shrink-0">
            <TreePine className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="font-semibold leading-tight truncate">Arbo</div>
            <div className="text-xs text-white/60 leading-tight">Command Center</div>
          </div>
        </div>

        <nav className="flex md:flex-col gap-1 p-2 md:p-3 flex-1 overflow-x-auto">
          {NAV.map(({ to, end, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm whitespace-nowrap transition-colors ${
                  isActive ? 'bg-white/15 text-white font-medium' : 'text-white/70 hover:bg-white/10 hover:text-white'
                }`
              }
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="hidden md:block p-3 border-t border-white/10 space-y-2">
          <a
            href="tel:+17573195131"
            className="flex items-center gap-2 text-xs text-white/70 hover:text-white px-3 py-2 rounded-lg hover:bg-white/10"
          >
            <Phone className="w-3.5 h-3.5" /> (757) 319-5131
          </a>
          <button
            onClick={handleSignOut}
            className="flex items-center gap-2 text-xs text-white/70 hover:text-white px-3 py-2 rounded-lg hover:bg-white/10 w-full"
          >
            <LogOut className="w-3.5 h-3.5" /> Sign out {user?.email ? `(${user.email})` : ''}
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 min-w-0">
        <Outlet />
      </main>
    </div>
  );
};

export default CrmLayout;
