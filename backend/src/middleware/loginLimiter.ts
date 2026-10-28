const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 8;

const failures = new Map<string, { count: number; first: number }>();

/** Minimal in-memory brute-force guard for the login endpoint. */
export function isLockedOut(key: string): boolean {
  const entry = failures.get(key);
  if (!entry) return false;
  if (Date.now() - entry.first > WINDOW_MS) {
    failures.delete(key);
    return false;
  }
  return entry.count >= MAX_FAILURES;
}

export function recordFailure(key: string): void {
  const entry = failures.get(key);
  if (!entry || Date.now() - entry.first > WINDOW_MS) failures.set(key, { count: 1, first: Date.now() });
  else entry.count++;
}

export function clearFailures(key: string): void {
  failures.delete(key);
}
