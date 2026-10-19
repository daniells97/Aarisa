import { parseCsv } from './csv';
import { toCount, toIsoDate } from './columns';
import { toCents } from '~/domain/money';

// Reads any client's report with its saved layout (premise 1, stage 6c of the redesign). Each layout
// column says what one column of the file means; this turns the file into one row per day and driver
// code (clients whose report names the driver) or per day and route (clients whose drivers come from
// Aarisa's daily list). Pure: the server writes the rows.

export type Meaning =
  | 'work_date' | 'driver_code' | 'driver_name' | 'route_code' | 'quantity' | 'bonus'
  | 'other_revenue' | 'other_revenue_reason' | 'expected_pay' | 'ignore';

export interface LayoutColumn {
  id: string;
  sourceName: string;
  aliases: string[];
  meaning: Meaning;
  required: boolean;
  /** For quantities: the service and tier the pieces count for. For other revenue: its type. */
  serviceTypeId: string | null;
  tierId: string | null;
  revenueTypeId: string | null;
}

export interface ReportRow {
  /** Line numbers in the file this row was built from (more than one when a key repeats). */
  lines: number[];
  date: string;
  driverCode: string | null;
  driverName: string | null;
  routeCode: string | null;
  /** Pieces per layout column id (quantity columns only). */
  quantities: Record<string, number>;
  bonusCents: number;
  /** Other revenue per layout column id, with the reason text if the file has one. */
  otherRevenue: Record<string, number>;
  otherRevenueReason: string | null;
  expectedPayCents: number | null;
}

export interface RowProblem { line: number; message: string }
export interface Suggestion { field: string; column: string; header: string | null }
export interface RawLine { line: number; data: Record<string, string>; problem: string | null }

export type LayoutParse =
  | { kind: 'layout_changed'; header: string[]; missing: string[]; suggestions: Suggestion[] }
  | { kind: 'ok'; rows: ReportRow[]; problems: RowProblem[]; columnMap: Record<string, string>; raw: RawLine[] };

/** Header text compared without case, spaces or punctuation: "POD Date" = "pod_date", "Paid Driver #" = "paid_driver". */
export const headerKey = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, '');

function similarity(a: string, b: string) {
  const grams = (s: string) => new Set(Array.from({ length: Math.max(s.length - 1, 1) }, (_, i) => s.slice(i, i + 2)));
  const A = grams(a), B = grams(b);
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return (2 * inter) / (A.size + B.size);
}

function money(v: string): number | null {
  const s = v.replace(/[$,\s]/g, '');
  if (s === '') return 0;
  try { return toCents(s); } catch { return null; }
}

/**
 * `keyBy` groups the file: `driver_code` (the report names the driver) or `route_code` (the daily list
 * does). `override` maps a layout column id to a header someone confirmed after a layout change.
 */
export function parseWithLayout(text: string, columns: LayoutColumn[], keyBy: 'driver_code' | 'route_code', override: Record<string, string> = {}): LayoutParse {
  const [header = [], ...body] = parseCsv(text);
  const keys = header.map(headerKey);
  const index = new Map<string, number>();
  const used = new Set<number>();
  for (const c of columns) {
    const wanted = override[c.id] != null ? [headerKey(override[c.id]!)] : [c.sourceName, ...c.aliases].map(headerKey);
    const i = keys.findIndex((k, n) => !used.has(n) && wanted.includes(k));
    if (i >= 0) { index.set(c.id, i); used.add(i); }
  }
  const missing = columns.filter((c) => c.required && !index.has(c.id));
  if (missing.length) {
    const unused = header.filter((_, i) => !used.has(i));
    const suggestions = missing.map((c) => {
      const scored = unused.map((h) => ({ h, s: Math.max(...[c.sourceName, ...c.aliases].map((a) => similarity(headerKey(a), headerKey(h)))) }))
        .filter((x) => x.s >= 0.5).sort((a, b) => b.s - a.s);
      return { field: c.id, column: c.sourceName, header: scored[0]?.h ?? null };
    });
    return { kind: 'layout_changed', header, missing: missing.map((c) => c.id), suggestions };
  }

  const get = (r: string[], c: LayoutColumn) => (index.has(c.id) ? (r[index.get(c.id)!] ?? '').trim() : '');
  const one = (m: Meaning) => columns.find((c) => c.meaning === m && index.has(c.id));
  const dateCol = one('work_date');
  const keyCol = one(keyBy);
  const rows: ReportRow[] = [];
  const problems: RowProblem[] = [];
  const raw: RawLine[] = [];
  const seen = new Map<string, ReportRow>();
  body.forEach((r, i) => {
    const line = i + 2;
    if (r.every((v) => v.trim() === '') || r[0]?.trim().startsWith('#')) return;
    const data = Object.fromEntries(header.map((h, n) => [h, r[n] ?? '']));
    const fail = (message: string) => { problems.push({ line, message }); raw.push({ line, data, problem: message }); };
    const date = dateCol ? toIsoDate(get(r, dateCol)) : null;
    if (!date) return fail(`Date "${dateCol ? get(r, dateCol) : ''}" is not a date`);
    const keyText = keyCol ? get(r, keyCol).toUpperCase().replace(/\s+/g, '') : '';
    if (!keyText) return fail(keyBy === 'driver_code' ? 'Driver code is empty' : 'Route is empty');
    const quantities: Record<string, number> = {};
    const otherRevenue: Record<string, number> = {};
    let bonusCents = 0, expectedPayCents: number | null = null, bad: string | null = null;
    for (const c of columns) {
      if (!index.has(c.id)) continue;
      const v = get(r, c);
      if (c.meaning === 'quantity') {
        const n = toCount(v);
        if (n == null) bad ??= `"${v}" in ${c.sourceName} is not a whole number`;
        else quantities[c.id] = n;
      } else if (c.meaning === 'bonus' || c.meaning === 'other_revenue' || c.meaning === 'expected_pay') {
        const cents = money(v);
        if (cents == null) bad ??= `"${v}" in ${c.sourceName} is not an amount`;
        else if (c.meaning === 'bonus') bonusCents += cents;
        else if (c.meaning === 'other_revenue') otherRevenue[c.id] = cents;
        else expectedPayCents = v === '' ? null : cents;
      }
    }
    if (bad) return fail(bad);
    raw.push({ line, data, problem: null });
    const reasonCol = one('other_revenue_reason');
    const nameCol = one('driver_name');
    const key = `${date}|${keyText}`;
    const prev = seen.get(key);
    // The same key twice (a client sometimes splits a route or a day): add the amounts up.
    if (prev) {
      prev.lines.push(line);
      for (const [k, n] of Object.entries(quantities)) prev.quantities[k] = (prev.quantities[k] ?? 0) + n;
      for (const [k, n] of Object.entries(otherRevenue)) prev.otherRevenue[k] = (prev.otherRevenue[k] ?? 0) + n;
      prev.bonusCents += bonusCents;
      if (expectedPayCents != null) prev.expectedPayCents = (prev.expectedPayCents ?? 0) + expectedPayCents;
      return;
    }
    const row: ReportRow = {
      lines: [line], date,
      driverCode: keyBy === 'driver_code' ? keyText : null,
      routeCode: keyBy === 'route_code' ? keyText : null,
      driverName: nameCol ? get(r, nameCol) || null : null,
      quantities, bonusCents, otherRevenue,
      otherRevenueReason: reasonCol ? get(r, reasonCol) || null : null,
      expectedPayCents,
    };
    seen.set(key, row);
    rows.push(row);
  });
  const columnMap = Object.fromEntries(columns.filter((c) => index.has(c.id)).map((c) => [c.sourceName, header[index.get(c.id)!]!]));
  return { kind: 'ok', rows, problems, columnMap, raw };
}
