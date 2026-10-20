import type { ReactNode } from 'react';

export type PillTone = 'ok' | 'waiting' | 'warn' | 'contractor' | 'muted' | 'bad';

/** Status pill: dot plus a label, never color alone. */
export function Pill({ tone, children }: { tone: PillTone; children: ReactNode }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

/** Amber count next to a nav item with open items. */
export function Badge({ count, label }: { count: number; label: string }) {
  if (count <= 0) return null;
  return <span className="badge" aria-label={label}>{count}</span>;
}
