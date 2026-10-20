// Column mapping shared by the client report parsers. Finds each field by its known names and,
// when a required column is missing, suggests the unused header that looks most like it
// (the "layout changed" import state, spec 6.12).

export const norm = (h: string) => h.trim().toLowerCase().replace(/[_\s]+/g, ' ');

export interface Suggestion<F extends string> { field: F; header: string | null }

export function mapColumns<F extends string>(
  header: string[],
  spec: { required: readonly F[]; optional: readonly F[]; aliases: Record<F, string[]> },
  override: Partial<Record<F, string>> = {},
) {
  const map: Partial<Record<F, number>> = {};
  const used = new Set<number>();
  const normalized = header.map(norm);
  for (const field of [...spec.required, ...spec.optional]) {
    const wanted = override[field] != null ? [norm(override[field]!)] : spec.aliases[field].map(norm);
    const idx = normalized.findIndex((h, i) => !used.has(i) && wanted.includes(h));
    if (idx >= 0) { map[field] = idx; used.add(idx); }
  }
  const missing = spec.required.filter((f) => map[f] == null);
  const unused = header.filter((_, i) => !used.has(i));
  const suggestions: Suggestion<F>[] = missing.map((field) => ({ field, header: closest(spec.aliases[field], unused) }));
  return { map, missing, suggestions };
}

function closest(aliases: string[], candidates: string[]): string | null {
  let best: { h: string; score: number } | null = null;
  for (const h of candidates) {
    const score = Math.max(...aliases.map((a) => similarity(norm(a), norm(h))));
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

/** Dates as YYYY-MM-DD, or US M/D/YYYY from Excel exports. */
export function toIsoDate(v: string): string | null {
  const s = v.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s);
  if (m) return `${m[3]!.length === 2 ? `20${m[3]}` : m[3]}-${m[1]!.padStart(2, '0')}-${m[2]!.padStart(2, '0')}`;
  return null;
}

/** Whole non-negative number; blank counts as 0. */
export function toCount(v: string): number | null {
  const s = v.trim().replace(/,/g, '');
  if (s === '') return 0;
  return /^\d+$/.test(s) ? Number(s) : null;
}
