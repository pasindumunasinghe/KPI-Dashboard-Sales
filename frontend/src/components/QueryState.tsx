import type { ReactNode } from 'react';

/** Renders loading / error states for a React Query result, otherwise the children. */
export function QueryState({
  isLoading,
  error,
  children
}: {
  isLoading: boolean;
  error: unknown;
  children: ReactNode;
}) {
  if (error) return <div className="state-msg">{error instanceof Error ? error.message : 'Something went wrong.'}</div>;
  if (isLoading) return <div className="state-msg">Loading…</div>;
  return <>{children}</>;
}
