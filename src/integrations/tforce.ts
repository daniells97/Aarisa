import { parseCsv } from './csv';
import { mapColumns, toCount, toIsoDate, type Suggestion } from './columns';

// T-Force weekly report (spec §5.3): order date, paid driver # (the route letter, e.g. 9000A),
// pieces. It does not say which Aarisa driver drove the route.

export const REQUIRED = ['order_date', 'route', 'pieces'] as const;
export const OPTIONAL = [] as const;
export type Field = (typeof REQUIRED)[number];

const ALIASES: Record<Field, string[]> = {
  order_date: ['order date', 'order_date', 'date'],
  route: ['paid driver #', 'paid driver', 'paid_driver', 'paid driver number', 'route'],
  pieces: ['pieces', 'pcs', 'piece count'],
};

export interface TforceRow { line: number; date: string; route: string; pieces: number }

export type ParseResult =
  | { kind: 'layout_changed'; header: string[]; missing: Field[]; suggestions: Suggestion<Field>[] }
  | { kind: 'ok'; rows: TforceRow[]; problems: { line: number; message: string }[]; columnMap: Record<string, string> };

export function parseTforce(text: string, override: Partial<Record<Field, string>> = {}): ParseResult {
  const [header = [], ...body] = parseCsv(text);
  const { map, missing, suggestions } = mapColumns(header, { required: REQUIRED, optional: OPTIONAL, aliases: ALIASES }, override);
  if (missing.length) return { kind: 'layout_changed', header, missing: [...missing], suggestions };
  const get = (r: string[], f: Field) => (r[map[f]!] ?? '').trim();
  const rows: TforceRow[] = [];
  const problems: { line: number; message: string }[] = [];
  const seen = new Map<string, number>();
  body.forEach((r, i) => {
    const line = i + 2;
    const date = toIsoDate(get(r, 'order_date'));
    const route = get(r, 'route').toUpperCase().replace(/\s+/g, '');
    const pieces = toCount(get(r, 'pieces'));
    if (!date) return problems.push({ line, message: `Date "${get(r, 'order_date')}" is not a date` });
    if (!route) return problems.push({ line, message: 'Route is empty' });
    if (pieces == null) return problems.push({ line, message: `Pieces "${get(r, 'pieces')}" is not a number` });
    const key = `${date}|${route}`;
    // The same route and day twice: add the pieces up (T-Force sometimes splits a route).
    if (seen.has(key)) { rows[seen.get(key)!]!.pieces += pieces; return; }
    seen.set(key, rows.length);
    rows.push({ line, date, route, pieces });
  });
  const columnMap = Object.fromEntries(Object.entries(map).map(([f, i]) => [f, header[i as number]!]));
  return { kind: 'ok', rows, problems, columnMap };
}
