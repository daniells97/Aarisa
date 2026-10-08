import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { contractors, rates, serviceTypes, workRecords } from '~/db/schema';
import { TFORCE_CSV, actorAs, clearTforceReports, withRollback } from '../../tests/helpers/db';
import { approveRun, loadRun } from './payroll';
import { importTforce, loadTforceWeek, resolveTforceException } from './tforce';

const RUN = 'tforce-2026-06-15';
const owner = actorAs('owner');

describe('T-Force payroll (server)', () => {
  it('is blocked while the weekly check has open exceptions and while e-commerce rates are missing (rule 6)', () =>
    withRollback(async (tx) => {
      await clearTforceReports(tx);
      await importTforce(tx, owner, { fileName: 't.csv', text: TFORCE_CSV });
      const run = await loadRun(tx, owner, RUN);
      expect(run.status).toBe('draft');
      expect(run.blockers.map((b) => b.kind)).toEqual(['open_exceptions', 'missing_rates']);
      await expect(approveRun(tx, owner, RUN, run.totals.payCents)).rejects.toMatchObject({ code: 'run_not_ready' });
    }));

  it('with exceptions cleared and a rate added, Puma is paid as one party and approval snapshots each route-day', () =>
    withRollback(async (tx) => {
      await clearTforceReports(tx);
      await importTforce(tx, owner, { fileName: 't.csv', text: TFORCE_CSV });
      const week = await loadTforceWeek(tx, owner, '2026-06-15');
      for (const e of week.exceptions.filter((x) => x.status === 'open')) {
        await resolveTforceException(tx, owner, e.id, e.type === 'low_pieces' ? { action: 'pay_as_reported' } : { action: 'not_ours' });
      }
      // Illustrative rate for the test only (open question 4): client $1.50, driver $1.10 per piece.
      const [ecom] = await tx.select().from(serviceTypes).where(eq(serviceTypes.code, 'ecommerce'));
      await tx.insert(rates).values({ serviceTypeId: ecom!.id, clientRateCents: 150, driverRateCents: 110, effectiveFrom: '2026-06-01' });
      const run = await loadRun(tx, owner, RUN);
      expect(run.status).toBe('ready');
      // 4,910 pieces minus the 34 on 9000Z Thursday marked "not our route".
      expect(run.totals).toMatchObject({ packages: 4_876, routeDays: 73, payCents: 4_876 * 110 });
      const [puma] = await tx.select().from(contractors).where(eq(contractors.name, 'Puma'));
      const pumaLine = run.lines.find((l) => l.contractorId === puma!.id)!;
      expect(pumaLine).toMatchObject({ name: 'Puma', contractor: true, routeDays: 10, packages: 685 });
      await approveRun(tx, owner, RUN, run.totals.payCents);
      const recs = await tx.select().from(workRecords).where(eq(workRecords.date, '2026-06-17'));
      expect(recs.filter((r) => r.contractorId === puma!.id).every((r) => r.driverRateCents === 110 && r.driverPayCents === r.pieces * 110)).toBe(true);
      expect((await loadRun(tx, owner, RUN)).status).toBe('approved');
    }));
});
