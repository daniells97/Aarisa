import { parseCsv } from './csv';
import { toCents } from '~/domain/money';

// Hovership weekly report (spec §5.2). Columns: POD Date, DriverCode, DriverNameCode, Tier 1–4,
// Stat, Stem, Stem Reason, Bonus, Total Route, Total Profit. The seed file uses snake_case names.

export const REQUIRED = ['pod_date', 'driver_code', 'tier1', 'tier2', 'tier3', 'tier4', 'stat', 'stem', 'bonus'] as const;
export const OPTIONAL = ['driver_name', 'stem_reason', 'total_route', 'total_profit'] as const;
export type Field = (typeof REQUIRED)[number] | (typeof OPTIONAL)[number];

const ALIASES: Record<Field, string[]> = {
  pod_date: ['pod date', 'pod_date', 'date', 'service date'],
  driver_code: ['drivercode', 'driver code', 'driver_code', 'code'],
  driver_name: ['drivernamecode', 'driver name', 'driver_name', 'name'],
  tier1: ['tier 1', 'tier1', 't1'],
  tier2: ['tier 2', 'tier2', 't2'],
  tier3: ['tier 3', 'tier3', 't3'],
  tier4: ['tier 4', 'tier4', 't4'],
  stat: ['stat', 'stats', 'stat stops'],
  stem: ['stem'],
  stem_reason: ['stem reason', 'stem_reason'],
  bonus: ['bonus'],
  total_route: ['total route', 'total_route'],
  total_profit: ['total profit', 'total_profit'],
};

const norm = (h: string) => h.trim().toLowerCase().replace(/[_\s]+/g, ' ');

export type ColumnMap = Partial<Record<Field, number>>;

export interface Suggestion { field: Field; header: string | null }

/** Maps headers to fields. `override` lets a person confirm a renamed column (layout changed state). */
export function mapColumns(header: string[], override: Partial<Record<Field, string>> = {}) {
  const map: ColumnMap = {};
  const used = new Set<number>();
  const normalized = header.map(norm);
  for (const field of [...REQUIRED, ...OPTIONAL]) {
    const wanted = override[field] != null ? [norm(override[field]!)] : ALIASES[field].map(norm);
    const idx = normalized.findIndex((h, i) => !used.has(i) && wanted.includes(h));
    if (idx >= 0) { map[field] = idx; used.add(idx); }
  }
  const missing = REQUIRED.filter((f) => map[f] == null);
  const unused = header.filter((_, i) => !used.has(i));
  const suggestions: Suggestion[] = missing.map((field) => ({ field, header: closest(field, unused) }));
  return { map, missing, suggestions };
}

/** The unused header that looks most like the missing field (shared words or letters). */
function closest(field: Field, candidates: string[]): string | null {
  let best: { h: string; score: number } | null = null;
  for (const h of candidates) {
    const score = Math.max(...ALIASES[field].map((a) => similarity(norm(a), norm(h))));
    if (score >= 0.5 && (!best || score > best.score)) best = { h, score };
  }
  return best?.h ?? null;
}

function similarity(a: string, b: string) {
  const grams = (s: string) => new Set(Array.from({ length: Math.max(s.length - 1, 1) }, (_, i) => s.slice(i, i + 2)));
  const A = grams(a), B = grams(b);
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return (2 * inter) / (A.size + B.size);
}

export interface HovershipRow {
  line: number;
  date: string;
  driverCode: string;
  driverName: string;
  t1: number; t2: number; t3: number; t4: number; stat: number;
  stemCents: number;
  stemReason: string | null;
  bonusCents: number;
  totalRouteCents: number | null;
  totalProfitCents: number | null;
}

export interface RowProblem { line: number; message: string }

export type ParseResult =
  | { kind: 'layout_changed'; header: string[]; missing: Field[]; suggestions: Suggestion[] }
  | { kind: 'ok'; rows: HovershipRow[]; problems: RowProblem[]; columnMap: Record<string, string> };

function toDate(v: string): string | null {
  const s = v.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s); // US format from Excel exports
  if (m) {
    const year = m[3]!.length === 2 ? `20${m[3]}` : m[3]!;
    return `${year}-${m[1]!.padStart(2, '0')}-${m[2]!.padStart(2, '0')}`;
  }
  return null;
}

function toInt(v: string): number | null {
  const s = v.trim();
  if (s === '') return 0;
  return /^\d+$/.test(s) ? Number(s) : null;
}

function money(v: string): number | null {
  try { return toCents(v.replace(/[$,]/g, '')); } catch { return null; }
}

export function parseHovership(text: string, override: Partial<Record<Field, string>> = {}): ParseResult {
  const [header = [], ...body] = parseCsv(text);
  const { map, missing, suggestions } = mapColumns(header, override);
  if (missing.length) return { kind: 'layout_changed', header, missing: [...missing], suggestions };
  const get = (r: string[], f: Field) => (map[f] != null ? (r[map[f]!] ?? '').trim() : '');
  const rows: HovershipRow[] = [];
  const problems: RowProblem[] = [];
  body.forEach((r, i) => {
    const line = i + 2;
    const date = toDate(get(r, 'pod_date'));
    const code = get(r, 'driver_code').toUpperCase();
    const nums = (['tier1', 'tier2', 'tier3', 'tier4', 'stat'] as const).map((f) => toInt(get(r, f)));
    const stem = money(get(r, 'stem') || '0');
    const bonus = money(get(r, 'bonus') || '0');
    if (!date) return problems.push({ line, message: `Date "${get(r, 'pod_date')}" is not a date` });
    if (!code) return problems.push({ line, message: 'Driver code is empty' });
    if (nums.some((n) => n == null) || stem == null || bonus == null) return problems.push({ line, message: 'A count or amount is not a number' });
    const tr = get(r, 'total_route'), tp = get(r, 'total_profit');
    rows.push({
      line, date, driverCode: code, driverName: get(r, 'driver_name'),
      t1: nums[0]!, t2: nums[1]!, t3: nums[2]!, t4: nums[3]!, stat: nums[4]!,
      stemCents: stem, stemReason: get(r, 'stem_reason') || null, bonusCents: bonus,
      totalRouteCents: tr ? money(tr) : null, totalProfitCents: tp ? money(tp) : null,
    });
  });
  const columnMap = Object.fromEntries(Object.entries(map).map(([f, i]) => [f, header[i!]!]));
  return { kind: 'ok', rows, problems, columnMap };
}
