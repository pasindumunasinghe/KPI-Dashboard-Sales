import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { Layout } from './components/Layout';
import { ComparisonPage } from './pages/ComparisonPage';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';
import { UploadPage } from './pages/UploadPage';
import { UsersPage } from './pages/UsersPage';
import { YtdPage } from './pages/YtdPage';

function RoleGate({ allow, children }: { allow: boolean; children: ReactNode }) {
  return allow ? <>{children}</> : <Navigate to="/dashboard" replace />;
}

export function App() {
  const { user, loading, canManageData, isAdmin } = useAuth();
  if (loading) return <div className="state-msg">Loading…</div>;
  if (!user) return <LoginPage />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="comparison" element={<ComparisonPage />} />
        <Route path="ytd" element={<YtdPage />} />
        <Route path="upload" element={<RoleGate allow={canManageData}><UploadPage /></RoleGate>} />
        <Route path="users" element={<RoleGate allow={isAdmin}><UsersPage /></RoleGate>} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
}
