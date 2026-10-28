import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

interface Filters {
  month: string;
  main: string;
  sub: string;
  gp: string;
  npat: string;
}

interface FiltersState extends Filters {
  setMonth: (v: string) => void;
  setMain: (v: string) => void;
  setSub: (v: string) => void;
  setGp: (v: string) => void;
  setNpat: (v: string) => void;
  reset: () => void;
}

const FiltersContext = createContext<FiltersState | null>(null);

const TARGETS_KEY = 'orelDashTargets';

function readTargets(): { gp: string; npat: string } {
  try {
    const saved = JSON.parse(localStorage.getItem(TARGETS_KEY) || 'null');
    if (saved && typeof saved.gp === 'string' && typeof saved.npat === 'string') return saved;
  } catch {
    /* ignore */
  }
  return { gp: '20', npat: '10' };
}

/** Dashboard filters live above the pages so the Comparison tab can snapshot the month chosen on the Dashboard. */
export function FiltersProvider({ children }: { children: ReactNode }) {
  const [month, setMonth] = useState('ALL');
  const [main, setMainState] = useState('ALL');
  const [sub, setSub] = useState('ALL');
  const [targets, setTargets] = useState(readTargets);

  useEffect(() => {
    try {
      localStorage.setItem(TARGETS_KEY, JSON.stringify(targets));
    } catch {
      /* ignore */
    }
  }, [targets]);

  const value = useMemo<FiltersState>(
    () => ({
      month,
      main,
      sub,
      gp: targets.gp,
      npat: targets.npat,
      setMonth,
      setMain: (v) => {
        setMainState(v);
        setSub('ALL');
      },
      setSub,
      setGp: (gp) => setTargets((t) => ({ ...t, gp })),
      setNpat: (npat) => setTargets((t) => ({ ...t, npat })),
      reset: () => {
        setMonth('ALL');
        setMainState('ALL');
        setSub('ALL');
      }
    }),
    [month, main, sub, targets]
  );
  return <FiltersContext.Provider value={value}>{children}</FiltersContext.Provider>;
}

export function useFilters(): FiltersState {
  const ctx = useContext(FiltersContext);
  if (!ctx) throw new Error('useFilters must be used inside FiltersProvider');
  return ctx;
}
