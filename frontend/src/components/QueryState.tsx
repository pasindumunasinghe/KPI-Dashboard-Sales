import type { ReactNode } from 'react';
import { ApiError } from '../api/client';

/** Renders loading / error / seeding states for a React Query result, otherwise the children. */
export function QueryState({
  isLoading,
  error,
  children
}: {
  isLoading: boolean;
  error: unknown;
  children: ReactNode;
}) {
  if (error) {
    const seeding = error instanceof ApiError && error.status === 503 && error.data.seeding;
    return (
      <div className="state-msg">
        {seeding
          ? 'The initial data load is still running (this takes a minute on first start). The dashboard will appear automatically…'
          : error instanceof Error
            ? error.message
            : 'Something went wrong.'}
      </div>
    );
  }
  if (isLoading) return <div className="state-msg">Loading…</div>;
  return <>{children}</>;
}
