import React, { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from '@/contexts/AuthContext';
import { ToastProvider } from '@/components/ui/Toast';
import ProtectedRoute from '@/components/ProtectedRoute';
import CrmLayout from '@/crm/CrmLayout';

const LoginPage = lazy(() => import('@/pages/LoginPage'));
const Dashboard = lazy(() => import('@/pages/Dashboard'));
const LeadInbox = lazy(() => import('@/pages/LeadInbox'));
const Pipeline = lazy(() => import('@/pages/Pipeline'));
const JobDetail = lazy(() => import('@/pages/JobDetail'));
const Settings = lazy(() => import('@/pages/Settings'));

const Boot = () => (
  <div className="min-h-screen flex items-center justify-center bg-slate-50">
    <div className="w-8 h-8 border-4 border-brand border-t-transparent rounded-full animate-spin" />
  </div>
);

// The whole app is the CRM. Everything except /login lives behind auth.
const App = () => (
  <AuthProvider>
    <ToastProvider>
      <Suspense fallback={<Boot />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            element={
              <ProtectedRoute>
                <CrmLayout />
              </ProtectedRoute>
            }
          >
            <Route path="/" element={<Dashboard />} />
            <Route path="/inbox" element={<LeadInbox />} />
            <Route path="/pipeline" element={<Pipeline />} />
            <Route path="/jobs/:id" element={<JobDetail />} />
            <Route path="/settings" element={<Settings />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </ToastProvider>
  </AuthProvider>
);

export default App;
