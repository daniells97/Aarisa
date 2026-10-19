import { readFileSync } from 'node:fs';
import { REPORT_LAYOUTS } from '~/db/seed-data';
import { parseWithLayout, type LayoutColumn } from '~/integrations/layout';

/** The June 2026 Hovership sample read with Hovership's layout, as tier counts per driver-day (spec §9 fixtures). */
export function hovershipSampleRows() {
  const columns: LayoutColumn[] = REPORT_LAYOUTS.hovership!.map((c) => ({
    id: c.sourceName, sourceName: c.sourceName, aliases: c.aliases, meaning: c.meaning, required: c.required,
    serviceTypeId: c.service ?? null, tierId: c.tier ?? null, revenueTypeId: c.revenueType ?? null,
  }));
  const parsed = parseWithLayout(readFileSync(new URL('../../docs/seed/hovership_details_jun2026.csv', import.meta.url), 'utf8'), columns, 'driver_code');
  if (parsed.kind !== 'ok') throw new Error('seed file should parse');
  const raw = new Map(parsed.raw.map((x) => [x.line, x.data]));
  const cents = (v: string | undefined) => Math.round(Number((v ?? '0').replace(/[$,]/g, '') || 0) * 100);
  return parsed.rows.map((r) => ({
    date: r.date, driverCode: r.driverCode!, t1: r.quantities['Tier 1']!, t2: r.quantities['Tier 2']!, t3: r.quantities['Tier 3']!, t4: r.quantities['Tier 4']!,
    stat: r.quantities.Stat!, stemCents: r.otherRevenue.Stem ?? 0, bonusCents: r.bonusCents,
    totalRouteCents: r.expectedPayCents, totalProfitCents: cents(raw.get(r.lines[0]!)?.total_profit),
  }));
}
