import { NavLink, Outlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { useAuth, ROLE_LABELS } from '../auth/AuthContext';
import { formatRelativeTime } from '../format';
import { useTheme } from '../theme';

export function Layout() {
  const { user, logout, canManageData, isAdmin } = useAuth();
  const { theme, toggle } = useTheme();
  const status = useQuery({ queryKey: ['uploads'], queryFn: api.uploads, refetchInterval: 60000 });

  const times = Object.values(status.data?.datasets || {}).map((d) => new Date(d.uploadedAt).getTime());
  const lastUpdated = times.length ? new Date(Math.max(...times)).toISOString() : null;
  const tab = ({ isActive }: { isActive: boolean }) => 'tab' + (isActive ? ' active' : '');

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="logo-badge sm">OREL</div>
          <div>
            <div className="brand-title">Orel Performance Dashboard</div>
            <div className="brand-sub">Sales · Margin · Profitability</div>
          </div>
        </div>
        <div className="topbar-actions">
          <div className="pill">
            <span className="dot" />
            Last updated {formatRelativeTime(lastUpdated)}
          </div>
          <div className="pill" title={user ? ROLE_LABELS[user.role] : ''}>
            {user && user.name !== ROLE_LABELS[user.role] ? `${user.name} · ` : ''}{user ? ROLE_LABELS[user.role] : ''}
          </div>
          <button className="theme-btn" onClick={toggle}>
            {theme === 'light' ? '🌙  Dark' : '☀️  Light'}
          </button>
          <button className="logout-btn" onClick={logout}>
            Sign out
          </button>
        </div>
      </header>

      <nav className="tabbar">
        <NavLink to="/dashboard" className={tab}>Dashboard</NavLink>
        <NavLink to="/comparison" className={tab}>Monthly Comparison</NavLink>
        <NavLink to="/ytd" className={tab}>YTD Comparison</NavLink>
        {canManageData && <NavLink to="/upload" className={tab}>Upload Data</NavLink>}
        {isAdmin && <NavLink to="/users" className={tab}>Users</NavLink>}
      </nav>

      <Outlet />

      <footer className="footer">
        Orel Electrical · Sales &amp; Profitability Dashboard · FY26/27 · monthly uploads &amp; locking · build {__BUILD_TIME__.slice(0, 16).replace('T', ' ')} UTC
      </footer>
    </div>
  );
}
