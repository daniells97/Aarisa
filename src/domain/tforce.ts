// T-Force weekly check (spec §5.3): report rows (date, route, pieces) joined to the daily
// driver list by (date, route). Pure; the server turns the result into records and exceptions.

export type Payee = { driverId: string; contractorId?: null } | { contractorId: string; driverId?: null };

export interface ReportRow { date: string; route: string; pieces: number }
export interface ListEntry { date: string; route: string; payee: Payee | null; rawName: string | null }

export type CheckException =
  | { type: 'no_driver'; date: string; route: string; pieces: number }
  | { type: 'unknown_name'; date: string; route: string; pieces: number; rawName: string }
  | { type: 'no_pieces'; date: string; route: string; payee: Payee }
  | { type: 'low_pieces'; date: string; route: string; pieces: number; payee: Payee | null; median: number; low: number; high: number };

export interface Matched { date: string; route: string; pieces: number; payee: Payee }

/** Default for open question 12: flag a day under 10% of the route's usual pieces. */
export const LOW_PIECES_RATIO = 0.1;

function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/**
 * `history` is pieces per route from the previous 4 weeks; when a route has fewer than
 * 4 days of history the current week is used instead (spec §5.3).
 */
export function crossCheck(report: ReportRow[], list: ListEntry[], history: ReportRow[] = [], ratio = LOW_PIECES_RATIO) {
  const key = (d: string, r: string) => `${d}|${r}`;
  const listByKey = new Map(list.map((l) => [key(l.date, l.route), l]));
  const reportKeys = new Set(report.map((r) => key(r.date, r.route)));
  const matched: Matched[] = [];
  const exceptions: CheckException[] = [];

  const usual = new Map<string, number[]>();
  for (const route of new Set(report.map((r) => r.route))) {
    const past = history.filter((h) => h.route === route).map((h) => h.pieces);
    usual.set(route, past.length >= 4 ? past : report.filter((r) => r.route === route).map((r) => r.pieces));
  }

  for (const r of report) {
    const entry = listByKey.get(key(r.date, r.route));
    const payee = entry?.payee ?? null;
    if (!payee) {
      if (entry?.rawName) exceptions.push({ type: 'unknown_name', date: r.date, route: r.route, pieces: r.pieces, rawName: entry.rawName });
      else exceptions.push({ type: 'no_driver', date: r.date, route: r.route, pieces: r.pieces });
    } else {
      matched.push({ ...r, payee });
    }
    const sample = usual.get(r.route) ?? [];
    const m = median(sample);
    if (sample.length > 1 && r.pieces < ratio * m) {
      const others = sample.filter((x) => x !== r.pieces);
      exceptions.push({ type: 'low_pieces', date: r.date, route: r.route, pieces: r.pieces, payee, median: m, low: Math.min(...others), high: Math.max(...others) });
    }
  }
  for (const l of list) {
    if (l.payee && !reportKeys.has(key(l.date, l.route))) exceptions.push({ type: 'no_pieces', date: l.date, route: l.route, payee: l.payee });
  }
  exceptions.sort((a, b) => a.date.localeCompare(b.date) || a.route.localeCompare(b.route));
  return { matched, exceptions };
}

/** One row per route with pieces per day, for the route × day grid. */
export function pieceGrid(report: ReportRow[], days: string[]) {
  const routes = [...new Set(report.map((r) => r.route))].sort();
  return routes.map((route) => {
    const cells = days.map((d) => report.filter((r) => r.route === route && r.date === d).reduce((s, r) => s + r.pieces, 0) || null);
    return { route, cells, total: cells.reduce<number>((s, c) => s + (c ?? 0), 0) };
  });
}
