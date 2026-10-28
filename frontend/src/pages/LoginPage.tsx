import { useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthContext';

export function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError('Please enter your email and password.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="logo-badge lg">OREL</div>
        <div className="login-title">Orel Performance Dashboard</div>
        <div className="login-sub">Sign in to view sales, cost &amp; profitability KPIs</div>
        <div className="form-stack">
          <div>
            <label className="field-label" htmlFor="email">Email</label>
            <input id="email" className="text-input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
          </div>
          <div>
            <label className="field-label" htmlFor="password">Password</label>
            <input id="password" className="text-input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
          </div>
          {error && <div className="form-error" role="alert">{error}</div>}
          <button className="btn-primary" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </div>
      </form>
    </div>
  );
}
