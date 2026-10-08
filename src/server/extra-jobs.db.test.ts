import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { contractors, drivers, rates, routes, serviceTypes, settlementLines, workRecords } from '~/db/schema';
import { TFORCE_CSV, actorAs, clearTforceReports, withRollback } from '../../tests/helpers/db';
import { ForbiddenError } from './actor';
import { completeExtraJob, createExtraJob, listExtraJobs } from './extra-jobs';
import { loadRun } from './payroll';
import { importTforce, loadTforceWeek, resolveTforceException } from './tforce';

type T = Parameters<Parameters<typeof withRollback>[0]>[0];
const puma = async (tx: T) => (await tx.select().from(contractors).where(eq(contractors.name, 'Puma')))[0]!;
const route = async (tx: T, code: string) => (await tx.select().from(routes).where(eq(routes.code, code)))[0]!;

describe('extra jobs (server)', () => {
  it('a recovery route needs its order number; the job makes a work record and an expected settlement line', () =>
    withRollback(async (tx) => {
      const owner = actorAs('owner');
      const base = { service: 'recovery_route' as const, date: '2026-06-18', nearRouteId: (await route(tx, '9000R')).id, payee: { contractorId: (await puma(tx)).id }, clientAmountCents: 180_00, driverAmountCents: 120_00, note: null };
      await expect(createExtraJob(tx, owner, { ...base, clientUuid: randomUUID(), orderNumber: null })).rejects.toMatchObject({ code: 'order_number_required' });
      const { job, created } = await createExtraJob(tx, owner, { ...base, clientUuid: randomUUID(), orderNumber: 'TF-55821' });
      expect(created).toBe(true);
      const [w] = await tx.select().from(workRecords).where(eq(workRecords.extraJobId, job.id));
      expect(w).toMatchObject({ source: 'extra_job', pieces: 1, clientRateCents: 180_00, driverRateCents: 120_00 });
      const [line] = await tx.select().from(settlementLines).where(eq(settlementLines.extraJobId, job.id));
      expect(line).toMatchObject({ kind: 'extra_job', expectedCents: 180_00, expectedDate: '2026-07-18', reference: 'TF-55821', status: 'open' });
    }));

  it('sending the same job twice (offline retry) creates it once', () =>
    withRollback(async (tx) => {
      const id = randomUUID();
      const [robert] = await tx.select().from(drivers).where(eq(drivers.fullName, 'Robert Arteaga'));
      const input = { clientUuid: id, service: 'grainger' as const, date: '2026-06-18', nearRouteId: null, payee: { driverId: robert!.id }, clientAmountCents: null, driverAmountCents: 40_00, orderNumber: null, note: null };
      const a = await createExtraJob(tx, actorAs('dispatcher'), input);
      const b = await createExtraJob(tx, actorAs('dispatcher'), input);
      expect(b).toMatchObject({ created: false, job: { id: a.job.id } });
    }));

  it('dispatchers log jobs without what T-Force pays; finance adds it later (rule 9)', () =>
    withRollback(async (tx) => {
      const [robert] = await tx.select().from(drivers).where(eq(drivers.fullName, 'Robert Arteaga'));
      const input = { clientUuid: randomUUID(), service: 'pickup' as const, date: '2026-06-19', nearRouteId: null, payee: { driverId: robert!.id }, driverAmountCents: 35_00, orderNumber: null, note: null };
      await expect(createExtraJob(tx, actorAs('dispatcher'), { ...input, clientAmountCents: 50_00 })).rejects.toMatchObject({ code: 'client_amount_not_allowed' });
      const { job } = await createExtraJob(tx, actorAs('dispatcher'), { ...input, clientAmountCents: null });
      let list = await listExtraJobs(tx, actorAs('dispatcher'), '2026-06-19', '2026-06-19');
      expect(list.jobs.find((j) => j.id === job.id)).toMatchObject({ clientAmountCents: null, missing: ['client_amount', 'order_number'] });
      await expect(completeExtraJob(tx, actorAs('dispatcher'), job.id, { clientAmountCents: 50_00 })).rejects.toMatchObject({ code: 'client_amount_not_allowed' });
      await completeExtraJob(tx, actorAs('dispatcher'), job.id, { orderNumber: 'TF-1' });
      await expect(completeExtraJob(tx, actorAs('viewer'), job.id, { clientAmountCents: 50_00 })).rejects.toBeInstanceOf(ForbiddenError);
      await expect(completeExtraJob(tx, actorAs('finance'), job.id, { orderNumber: 'X' })).rejects.toBeInstanceOf(ForbiddenError);
      await completeExtraJob(tx, actorAs('finance'), job.id, { clientAmountCents: 50_00 });
      list = await listExtraJobs(tx, actorAs('finance'), '2026-06-19', '2026-06-19');
      expect(list.jobs.find((j) => j.id === job.id)).toMatchObject({ clientAmountCents: 50_00, missing: [] });
      const [line] = await tx.select().from(settlementLines).where(eq(settlementLines.extraJobId, job.id));
      expect(line).toMatchObject({ expectedCents: 50_00, reference: 'TF-1' });
    }));

  it('finance and viewers cannot log jobs', () =>
    withRollback(async (tx) => {
      for (const role of ['finance', 'viewer'] as const) {
        await expect(createExtraJob(tx, actorAs(role), { clientUuid: randomUUID(), service: 'other', date: '2026-06-18', nearRouteId: null, payee: { contractorId: (await puma(tx)).id }, clientAmountCents: null, driverAmountCents: 1, orderNumber: null, note: 'x' }))
          .rejects.toBeInstanceOf(ForbiddenError);
      }
    }));

  it("joins the week's T-Force payroll at the agreed amount, not as a route-day", () =>
    withRollback(async (tx) => {
      const owner = actorAs('owner');
      await clearTforceReports(tx);
      await importTforce(tx, owner, { fileName: 't.csv', text: TFORCE_CSV });
      for (const e of (await loadTforceWeek(tx, owner, '2026-06-15')).exceptions.filter((x) => x.status === 'open')) {
        await resolveTforceException(tx, owner, e.id, e.type === 'low_pieces' ? { action: 'pay_as_reported' } : { action: 'not_ours' });
      }
      const [ecom] = await tx.select().from(serviceTypes).where(eq(serviceTypes.code, 'ecommerce'));
      await tx.insert(rates).values({ serviceTypeId: ecom!.id, clientRateCents: 150, driverRateCents: 110, effectiveFrom: '2026-06-01' });
      const before = await loadRun(tx, owner, 'tforce-2026-06-15');
      await createExtraJob(tx, owner, { clientUuid: randomUUID(), service: 'recovery_route', date: '2026-06-18', nearRouteId: null, payee: { contractorId: (await puma(tx)).id }, clientAmountCents: 180_00, driverAmountCents: 120_00, orderNumber: 'TF-55821', note: null });
      const after = await loadRun(tx, owner, 'tforce-2026-06-15');
      expect(after.totals.payCents - before.totals.payCents).toBe(120_00);
      expect(after.totals.routeDays).toBe(before.totals.routeDays);
      expect(after.totals.extraJobs).toBe(1);
      expect(after.lines.find((l) => l.contractor)).toMatchObject({ routeDays: 10, extraJobs: 1 });
    }));
});
