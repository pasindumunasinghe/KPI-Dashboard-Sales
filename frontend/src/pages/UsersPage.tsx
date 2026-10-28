import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Role } from '../api/types';
import { ROLE_LABELS, useAuth } from '../auth/AuthContext';
import { QueryState } from '../components/QueryState';

const ROLES: Role[] = ['admin', 'finance', 'viewer'];

export function UsersPage() {
  const { user: me } = useAuth();
  const queryClient = useQueryClient();
  const users = useQuery({ queryKey: ['users'], queryFn: api.users });
  const [error, setError] = useState('');
  const [form, setForm] = useState({ email: '', name: '', password: '', role: 'viewer' as Role });

  const done = () => { setError(''); void queryClient.invalidateQueries({ queryKey: ['users'] }); };
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : 'Request failed.');

  const create = useMutation({
    mutationFn: () => api.createUser(form),
    onSuccess: () => { setForm({ email: '', name: '', password: '', role: 'viewer' }); done(); },
    onError: fail
  });
  const update = useMutation({
    mutationFn: (v: { id: number; patch: Parameters<typeof api.updateUser>[1] }) => api.updateUser(v.id, v.patch),
    onSuccess: done,
    onError: fail
  });
  const remove = useMutation({ mutationFn: (id: number) => api.deleteUser(id), onSuccess: done, onError: fail });

  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  function resetPassword(id: number, name: string) {
    const password = window.prompt(`New password for ${name} (min 8 characters):`);
    if (password) update.mutate({ id, patch: { password } });
  }

  return (
    <div className="body">
      <div className="intro">
        <h2>Users &amp; roles</h2>
        <p>Administrators manage users. Finance / Data Managers upload data, change settings and save snapshots. Viewers can only view dashboards and comparisons.</p>
      </div>
      {error && <div className="msg error" role="alert" style={{ marginBottom: 16 }}>{error}</div>}
      <div className="card">
        <div className="card-title">Add user</div>
        <form className="user-form" onSubmit={submit}>
          <div><label className="field-label" htmlFor="u-name">Name</label><input id="u-name" className="text-input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div><label className="field-label" htmlFor="u-email">Email</label><input id="u-email" className="text-input" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          <div><label className="field-label" htmlFor="u-pass">Password</label><input id="u-pass" className="text-input" type="password" minLength={8} required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
          <div>
            <label className="field-label" htmlFor="u-role">Role</label>
            <select id="u-role" className="select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
          </div>
          <button className="btn" type="submit" disabled={create.isPending}>Add user</button>
        </form>
        <QueryState isLoading={users.isLoading} error={users.error}>
          <div className="table-scroll">
            <table className="users">
              <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Last sign-in</th><th /></tr></thead>
              <tbody>
                {users.data?.users.map((u) => (
                  <tr key={u.id}>
                    <td>{u.name}{u.id === me?.id ? ' (you)' : ''}</td>
                    <td>{u.email}</td>
                    <td>
                      <select className="select" value={u.role} aria-label={`Role for ${u.name}`} onChange={(e) => update.mutate({ id: u.id, patch: { role: e.target.value as Role } })}>
                        {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                      </select>
                    </td>
                    <td>{u.isActive ? 'Active' : 'Disabled'}</td>
                    <td>{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'Never'}</td>
                    <td className="actions">
                      <button className="btn small" onClick={() => update.mutate({ id: u.id, patch: { isActive: !u.isActive } })}>{u.isActive ? 'Disable' : 'Enable'}</button>
                      <button className="btn small" onClick={() => resetPassword(u.id, u.name)}>Reset password</button>
                      {u.id !== me?.id && (
                        <button className="btn small danger" onClick={() => window.confirm(`Delete ${u.name}?`) && remove.mutate(u.id)}>Delete</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </QueryState>
      </div>
    </div>
  );
}
