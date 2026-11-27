import { useEffect, useRef, useState } from 'react';

export type SortKey = 'entry' | 'driver' | 'code' | 'route' | 'status';
export interface Sort { key: SortKey; desc: boolean }

/**
 * The order of the lines of Daily operations. By default lines keep their place while people work (a saved line
 * never jumps; new lines go at the end). A column can be chosen to sort by (again: reversed). The choice is kept
 * in this browser only.
 */
export function useLineOrder<T>(lines: T[], keyOf: (x: T) => string, compare: Record<Exclude<SortKey, 'entry'>, (a: T, b: T) => number>, storageKey: string) {
  const [sort, setSort] = useState<Sort>({ key: 'entry', desc: false });
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null') as Sort | null;
      if (saved?.key) setSort(saved);
    } catch { /* no storage: default order */ }
  }, [storageKey]);
  const choose = (key: SortKey) => {
    const next: Sort = key === sort.key && key !== 'entry' ? { key, desc: !sort.desc } : { key, desc: false };
    setSort(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* fine */ }
  };

  // Entry order: lines already seen keep their place; new ones go after them, in the order they come.
  const seen = useRef<string[]>([]);
  const byKey = new Map(lines.map((x) => [keyOf(x), x]));
  const kept = seen.current.filter((k) => byKey.has(k));
  const added = lines.map(keyOf).filter((k) => !kept.includes(k));
  const entry = [...kept, ...added];
  seen.current = entry;

  if (sort.key === 'entry') return { lines: entry.map((k) => byKey.get(k)!), sort, choose };
  const cmp = compare[sort.key];
  const sorted = entry.map((k) => byKey.get(k)!).sort((a, b) => (sort.desc ? -1 : 1) * cmp(a, b));
  return { lines: sorted, sort, choose };
}
