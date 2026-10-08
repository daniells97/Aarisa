import type { MessageKey } from '~/i18n';
import type { Blocker } from '~/domain/payroll';

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;
type F = { date: (d: string, o?: Intl.DateTimeFormatOptions) => string };

export function blockerText(b: Blocker, t: T, f: F) {
  switch (b.kind) {
    case 'missing_report': return t('pay.blocker.missing_report', { weeks: b.weeks.map((w) => f.date(w, { month: 'long', day: 'numeric' })).join(', ') });
    case 'open_exceptions': return t('pay.blocker.open_exceptions', { count: b.count });
    case 'missing_rates': return t('pay.blocker.missing_rates', { count: b.count });
    case 'no_work': return t('pay.blocker.no_work');
  }
}

export function rangeText(p: { start: string; end: string }, t: T, f: F) {
  return t('pay.range', { start: f.date(p.start, { month: 'long', day: 'numeric' }), end: f.date(p.end, { month: 'long', day: 'numeric' }) });
}

export const statusTone = { draft: 'warn', ready: 'ok', approved: 'ok', reopened: 'waiting', paid: 'muted' } as const;
