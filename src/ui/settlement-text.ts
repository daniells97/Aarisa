import type { MessageKey } from '~/i18n';
import type { PillTone } from './Pill';

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;
type F = { date: (d: string, o?: Intl.DateTimeFormatOptions) => string };

export interface LineLike {
  operation: string; kind: string; reference: string | null; periodStart: string | null; periodEnd: string | null;
  job: { service: string; date: string; orderNumber: string | null } | null;
}

export const clientName = (op: string) => (op === 'tforce' ? 'T-Force' : 'Hovership');

const short = (f: F, d: string) => f.date(d, { month: 'short', day: 'numeric' });

/** "Week ending Jun 21", "Jun 15 to Jun 21, e-commerce", "Recovery route, Jun 18". */
export function coversText(l: LineLike, t: T, f: F) {
  if (l.kind === 'hovership_invoice' && l.periodEnd) return t('st.weekEnding', { date: short(f, l.periodEnd) });
  if (l.kind === 'tforce_weekly' && l.periodStart && l.periodEnd) return t('st.ecommerce', { start: short(f, l.periodStart), end: short(f, l.periodEnd) });
  if (l.job) return `${l.job.service}, ${short(f, l.job.date)}`;
  return l.reference ?? '';
}

export function statusPill(status: string, daysLate: number, t: T): { tone: PillTone; label: string } {
  switch (status) {
    case 'paid': return { tone: 'ok', label: t('st.s.paid') };
    case 'late': return { tone: 'bad', label: t('st.s.late', { days: daysLate }) };
    case 'short': return { tone: 'warn', label: t('st.s.short') };
    case 'claim_ready': return { tone: 'warn', label: t('st.s.claim_ready') };
    case 'claimed': return { tone: 'waiting', label: t('st.s.claimed') };
    default: return { tone: 'muted', label: t('st.s.open') };
  }
}
