import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

// Gate that requires a signed-in Supabase user. While the session is resolving
// it shows a spinner; unauthenticated users are bounced to /login.
const ProtectedRoute = ({ children }) => {
  const { user, loading, configured } = useAuth();
  const location = useLocation();

  if (!configured) {
    // Auth env not set yet — send to login, which explains setup.
    return <Navigate to="/login" replace />;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-4 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
};

export default ProtectedRoute;
