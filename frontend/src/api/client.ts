import type {
  AppSettings,
  ComparisonData,
  DashboardData,
  DashboardParams,
  ManagedUser,
  PeriodsResponse,
  Role,
  SnapshotSummary,
  UploadResult,
  UploadsStatus,
  User,
  YtdData
} from './types';

const TOKEN_KEY = 'orelDashToken';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable */
  }
}

export class ApiError extends Error {
  status: number;
  data: { error?: string; missing?: string[] };
  constructor(status: number, data: ApiError['data']) {
    super(data?.error || `Request failed (${status})`);
    this.status = status;
    this.data = data || {};
  }
}

let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const res = await fetch(`/api${path}`, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/login')) onUnauthorized();
    throw new ApiError(res.status, data);
  }
  return data as T;
}

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });
const qs = (params: Record<string, string | undefined>) => {
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => v !== undefined && sp.set(k, v));
  return `?${sp.toString()}`;
};

export const api = {
  login: (email: string, password: string) => request<{ token: string; user: User }>('/auth/login', json('POST', { email, password })),
  me: () => request<{ user: User }>('/auth/me'),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: true }>('/auth/change-password', json('POST', { currentPassword, newPassword })),

  dashboard: (p: DashboardParams) => request<DashboardData>(`/dashboard${qs({ ...p })}`),
  comparison: (current?: string, prev?: string) => request<ComparisonData>(`/comparison${qs({ current, prev })}`),
  ytd: (current?: string, comparison?: string) => request<YtdData>(`/ytd${qs({ current, comparison })}`),

  snapshots: () => request<{ snapshots: SnapshotSummary[] }>('/snapshots'),
  saveSnapshot: (month: string, mode: 'replace' | 'new_version', gp: number, npat: number) =>
    request<{ snapshot: unknown }>('/snapshots', json('POST', { month, mode, gp, npat })),
  deleteSnapshot: (id: number) => request<{ ok: true }>(`/snapshots/${id}`, { method: 'DELETE' }),

  settings: () => request<{ settings: AppSettings }>('/settings'),
  updateSettings: (patch: Partial<AppSettings>) => request<{ settings: AppSettings }>('/settings', json('PUT', patch)),

  uploads: () => request<UploadsStatus>('/uploads'),
  /** `month` is required for month-based datasets (sales, expenses, debtor, inventory). */
  upload: (dataset: string, file: File, month?: string) => {
    const form = new FormData();
    form.append('file', file);
    return request<UploadResult>(`/uploads/${dataset}${month ? `?month=${encodeURIComponent(month)}` : ''}`, { method: 'POST', body: form });
  },
  removeUpload: (dataset: string, month?: string) =>
    request<{ ok: true }>(`/uploads/${dataset}${month ? `?month=${encodeURIComponent(month)}` : ''}`, { method: 'DELETE' }),

  periods: () => request<PeriodsResponse>('/periods'),
  lockPeriod: (month: string) => request<{ ok: true }>(`/periods/${encodeURIComponent(month)}/lock`, json('POST', {})),
  unlockPeriod: (month: string, note?: string) => request<{ ok: true }>(`/periods/${encodeURIComponent(month)}/unlock`, json('POST', { note })),
  setElectricianPoint: (month: string, value: number) =>
    request<{ ok: true }>(`/periods/${encodeURIComponent(month)}/electrician-point`, json('PUT', { value })),

  users: () => request<{ users: ManagedUser[] }>('/users'),
  createUser: (u: { email: string; name: string; password: string; role: Role }) =>
    request<{ user: ManagedUser }>('/users', json('POST', u)),
  updateUser: (id: number, patch: Partial<{ name: string; role: Role; isActive: boolean; password: string }>) =>
    request<{ user: ManagedUser }>(`/users/${id}`, json('PATCH', patch)),
  deleteUser: (id: number) => request<{ ok: true }>(`/users/${id}`, { method: 'DELETE' })
};
