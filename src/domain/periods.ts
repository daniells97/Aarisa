import { addDays, daysBetween } from './dates';

export type PayCycle = 'weekly' | 'biweekly';

/** The pay period containing `date`, counted from the operation's anchor (any period's first day). */
export function periodFor(anchor: string, cycle: PayCycle, date: string): { start: string; end: string } {
  const len = cycle === 'weekly' ? 7 : 14;
  const offset = daysBetween(anchor, date);
  const n = Math.floor(offset / len);
  const start = addDays(anchor, n * len);
  return { start, end: addDays(start, len - 1) };
}

/** Every period touched by the dates, sorted. */
export function periodsFor(anchor: string, cycle: PayCycle, dates: Iterable<string>) {
  const map = new Map<string, { start: string; end: string }>();
  for (const d of dates) {
    const p = periodFor(anchor, cycle, d);
    map.set(p.start, p);
  }
  return [...map.values()].sort((a, b) => a.start.localeCompare(b.start));
}
