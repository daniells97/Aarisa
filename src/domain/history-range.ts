import { addDays, daysBetween, weekStart } from './dates';

// The date range of the History screen: a day, its week (Monday to Sunday), its month, or any range of up
// to a year. Pure, so the screen and the server agree on it.

export type HistoryPeriod = 'day' | 'week' | 'month' | 'range';
export const MAX_RANGE_DAYS = 366;

export function historyRange(period: HistoryPeriod, date: string, from?: string, to?: string) {
  if (period === 'day') return { from: date, to: date };
  if (period === 'week') { const s = weekStart(date); return { from: s, to: addDays(s, 6) }; }
  if (period === 'month') {
    const first = `${date.slice(0, 7)}-01`;
    return { from: first, to: addDays(`${addDays(first, 32).slice(0, 7)}-01`, -1) };
  }
  const a = from ?? date, b = to ?? date;
  return a <= b ? { from: a, to: b } : { from: b, to: a };
}

export const rangeTooLong = (from: string, to: string) => daysBetween(from, to) + 1 > MAX_RANGE_DAYS;
