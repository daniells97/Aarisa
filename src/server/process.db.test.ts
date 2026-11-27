import { and, eq } from 'drizzle-orm';
import { routeExecutions } from '~/db/schema';
import { readFileSync } from 'node:fs';
import { createDriver } from './people';
import { describe, expect, it } from 'vitest';
import { addDays } from '~/domain/dates';
import { actorAs, driverNamed, withRollback } from '../../tests/helpers/db';
import { confirmUsual, loadDay, markOffToday, setAssignment, setSortCodes, undoAssignment } from './daily';
import { confirmUsualHovership, loadHovershipDay } from './hovership-day';
import { createExtraJob } from './extra-jobs';
import { addDriverNote, addLoan, deductLoan, loansForRun } from './driver-ledger';
import { importReport } from './imports';
import { loadTforceWeek, resolveNoPiecesWeek, resolveTforceException, runWeeklyCheck } from './tforce';
import { addRate } from './setup';
import { serviceTypes } from '~/db/schema';
import { loadHovershipWeek } from './hovership';
import { approveRun, exportRun, listRuns, loadRun, markRunPaid } from './payroll';
import { loadSettlements } from './settlements';
import { loadHistory } from './history';
import { loadOverview } from './overview';

// One whole week of work, from the daily list to payroll, settlements, history and the overview, on a
// future week (Mon Mar 29 – Sun Apr 4, 2027; also the first week of a Hovership pay period). The client
// reports are the June 2026 sample files moved to those dates. Everything is rolled back.

const WEEK = '2027-03-29';
const shift = (file: string, from: string, days: number, keep: (date: string) => boolean) => {
  const [head, ...rows] = readFileSync(`docs/seed/${file}`, 'utf8').trim().split('\n');
  const moved = rows.filter((r) => keep(r.slice(0, 10))).map((r) => addDays(r.slice(0, 10), days) + r.slice(10));
  return [head, ...moved].join('\n') + '\n';
};
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

describe('a whole week, end to end', () => {
  it('daily list → extra jobs, notes, loans → reports → weekly check → payroll → settlements → history', () =>
    withRollback(async (tx) => {
      const owner = actorAs('owner');
      const out: Record<string, unknown> = {};

      // 1. Every morning: confirm the usual drivers (T-Force) and the usual routes (Hovership).
      for (let i = 0; i < 6; i++) {
        const date = addDays(WEEK, i);
        await confirmUsual(tx, owner, date);
        await confirmUsualHovership(tx, owner, date);
      }
      const mon = await loadDay(tx, owner, WEEK);
      out.tforceMonday = { rows: mon.rows.length, statuses: [...new Set(mon.rows.map((r) => r.status))] };
      const hovMon = await loadHovershipDay(tx, owner, WEEK);
      out.hovershipMonday = { rows: hovMon.rows.length, statuses: [...new Set(hovMon.rows.map((r) => r.status))] };

      // A change on Tuesday: someone else drives 9000B; routes marked on 9000A.
      const tue = addDays(WEEK, 1);
      const day = await loadDay(tx, owner, tue);
      const b = day.rows.find((r) => r.code === '9000B')!;
      // Someone not on Tuesday's list (a person on another code would be moved: one line per person).
      const other = await createDriver(tx, owner, { fullName: 'Test Tuesday', hovershipCode: null, contractorId: null, phone: null, aliases: [], active: true, setupComplete: true }, tue);
      await setAssignment(tx, owner, { date: tue, routeId: b.routeId, payee: { driverId: other.id } });
      const a = day.rows.find((r) => r.code === '9000A')!;
      await setSortCodes(tx, owner, { date: tue, routeId: a.routeId, sortCodeIds: day.options.sortCodes.slice(0, 2).map((s) => s.id) });

      // 2. During the week: an extra job, a note and a salary advance.
      const robert = await driverNamed(tx, 'Robert Arteaga');
      await createExtraJob(tx, owner, { clientUuid: crypto.randomUUID(), service: 'pickup', date: addDays(WEEK, 2), nearRouteId: null, payee: { driverId: robert.id }, clientAmountCents: 7500, driverAmountCents: 5000, orderNumber: 'P-1', note: null });
      await addDriverNote(tx, owner, { driverId: robert.id, body: 'Owes the uniform' });
      const loan = await addLoan(tx, owner, { driverId: robert.id, kind: 'advance', amountCents: 10_000, givenOn: tue, note: 'Gas' });

      // 3. Monday after: the client reports arrive.
      const tf = await importReport(tx, owner, { operation: 'tforce', fileName: 'tforce.csv', text: shift('tforce_pieces_jun2026.csv', '2026-06-15', daysBetween('2026-06-15', WEEK), (d) => d >= '2026-06-15' && d <= '2026-06-21') });
      const hv = await importReport(tx, owner, { operation: 'hovership', fileName: 'hovership.csv', text: shift('hovership_details_jun2026.csv', '2026-06-08', daysBetween('2026-06-08', WEEK), (d) => d >= '2026-06-08' && d <= '2026-06-21') });
      out.imports = { tforce: tf, hovership: hv };

      // 4. Weekly check (T-Force) and weekly report (Hovership).
      const week = await loadTforceWeek(tx, owner, WEEK);
      out.tforceWeek = week;
      out.hovershipWeek = await loadHovershipWeek(tx, owner, WEEK);

      // T-Force rates aren't in the portal yet (open question 4): test rates, $2.00 from T-Force, $1.50 to the driver.
      const svc = (await tx.select().from(serviceTypes)).find((x) => x.code === 'ecommerce')!;
      await addRate(tx, owner, { serviceTypeId: svc.id, tierId: null, clientRateCents: 200, driverRateCents: 150, effectiveFrom: '2027-01-01' });
      await runWeeklyCheck(tx, owner, 'tforce', WEEK);
      out.exceptionsBefore = (await loadTforceWeek(tx, owner, WEEK)).exceptions.filter((e: { status: string }) => e.status === 'open').length;
      // Monday's review: the days with no pieces were days off (not ours); low days are paid as reported.
      out.closedNoPieces = await resolveNoPiecesWeek(tx, owner, WEEK); // "None of these ran"
      for (const e of (await loadTforceWeek(tx, owner, WEEK)).exceptions.filter((x: { status: string }) => x.status === 'open')) {
        await resolveTforceException(tx, owner, e.id, { action: 'pay_as_reported' });
      }
      out.exceptionsAfter = (await loadTforceWeek(tx, owner, WEEK)).exceptions.filter((e: { status: string }) => e.status === 'open').length;

      // 5. Payroll.
      out.runs = await listRuns(tx, owner);
      const tRun = await loadRun(tx, owner, `tforce-${WEEK}`).catch((e) => ({ error: String(e) }));
      out.tforceRun = tRun;
      out.loansForRun = await loansForRun(tx, owner, `tforce-${WEEK}`, '2027-04-06').catch((e) => String(e));
      out.loanId = loan;
      const run = await loadRun(tx, owner, `tforce-${WEEK}`);
      const robertLine = run.lines.find((l: { name: string }) => l.name === 'Robert Arteaga');
      out.robertBefore = robertLine;
      await deductLoan(tx, owner, { loanId: (loan as { id: string }).id, runId: `tforce-${WEEK}`, amountCents: 5000 });
      const run2 = await loadRun(tx, owner, `tforce-${WEEK}`);
      out.robertAfter = run2.lines.find((l: { name: string }) => l.name === 'Robert Arteaga');
      out.runTotals = { status: run2.status, blockers: run2.blockers, totals: run2.totals };
      await approveRun(tx, owner, `tforce-${WEEK}`, run2.totals.payCents);
      await markRunPaid(tx, owner, `tforce-${WEEK}`);
      const paid = await loadRun(tx, owner, `tforce-${WEEK}`);
      out.paid = { status: paid.status, paidAt: paid.paidAt };
      const file = await exportRun(tx, owner, `tforce-${WEEK}`);
      out.exportHead = file.csv.split('\r\n').slice(0, 3);
      out.exportRobert = file.csv.split('\r\n').find((l: string) => l.includes('Robert Arteaga'));
      // 6. Settlements: what T-Force owes for the week and the extra job.
      const st = await loadSettlements(tx, owner, '2027-04-06');
      out.settlements = JSON.parse(JSON.stringify(st, (_k, v) => (typeof v === 'bigint' ? Number(v) : v)));
      // 7. History and overview.
      const h = await loadHistory(tx, owner, { from: WEEK, to: addDays(WEEK, 6) }, '2027-04-06');
      out.history = { totals: h.totals, extraJobs: h.extraJobs.length, loans: h.loans.length, notes: h.notes.length, tforcePieces: h.rows.filter((r) => r.operation === 'tforce').reduce((x, r) => x + (r.pieces ?? 0), 0), hovPieces: h.rows.filter((r) => r.operation === 'hovership').reduce((x, r) => x + (r.pieces ?? 0), 0) };
      const ov = await loadOverview(tx, owner, '2027-04-06', { week: WEEK });
      out.overview = JSON.parse(JSON.stringify(ov, (_k, v) => (typeof v === 'bigint' ? Number(v) : v)));

      // What the week must add up to.
      expect(out.tforceMonday).toEqual({ rows: 19, statuses: ['confirmed'] });
      expect(tf).toMatchObject({ status: 'done', pieces: 4910, unknownCodes: [] });
      expect(hv).toMatchObject({ status: 'done', weeks: ['2027-03-29', '2027-04-05'], unknownCodes: [] });
      // Confirming every usual driver every day flags the days a driver code didn't run (no pieces).
      expect(out.exceptionsBefore).toBe(42);
      expect(out.closedNoPieces).toBe(40);
      expect(out.exceptionsAfter).toBe(0);
      // Robert: 243 pieces × $1.50 + the $50 extra job; then $50 of the $100 advance is taken back.
      expect(out.robertBefore).toMatchObject({ packages: 243, extraJobs: 1, payCents: 243 * 150 + 5000 });
      expect(out.robertAfter).toMatchObject({ payCents: 243 * 150 });
      expect(out.runTotals).toMatchObject({ status: 'ready', blockers: [], totals: { packages: 4910, payCents: 4910 * 150, revenueCents: 4910 * 200 + 7500 } });
      expect(out.paid).toMatchObject({ status: 'paid' });
      expect(out.exportRobert).toBe('tforce,2027-03-29,2027-04-04,driver,Robert Arteaga,DUB061,6,243,0,0.00,364.50');
      const lines = (out.settlements as { lines: { operation: string; kind: string; periodStart: string; expectedCents: number; expectedDate: string }[] }).lines;
      expect(lines).toContainEqual(expect.objectContaining({ operation: 'tforce', kind: 'weekly_statement', periodStart: WEEK, expectedCents: 4910 * 200, expectedDate: '2027-05-04' }));
      expect(lines).toContainEqual(expect.objectContaining({ operation: 'tforce', kind: 'extra_job', expectedCents: 7500 }));
      expect(out.history).toMatchObject({ tforcePieces: 4910, extraJobs: 1, loans: 1 });
      const runs = (out.runs as { runs: { runId: string; status: string; payCents: number }[] }).runs;
      expect(runs.find((r) => r.runId === `hovership-${WEEK}`)).toMatchObject({ status: 'ready', payCents: 1338900 });
    }), 120_000);
  it('"didn\'t run today" keeps a driver code off that day: no exception, and confirming the usual drivers leaves it', () =>
    withRollback(async (tx) => {
      const owner = actorAs('owner');
      const day = await loadDay(tx, owner, WEEK);
      const g = day.rows.find((r) => r.code === '9000G')!;
      const { previous } = await markOffToday(tx, owner, { date: WEEK, routeId: g.routeId });
      await confirmUsual(tx, owner, WEEK);
      const after = await loadDay(tx, owner, WEEK);
      // "Didn't run" keeps who it was on the line (shown in red), but nobody is the payee: not paid.
      expect(after.rows.find((r) => r.code === '9000G')).toMatchObject({ status: 'off', today: { driverId: g.today.driverId, contractorId: null } });
      expect((await tx.select().from(routeExecutions).where(and(eq(routeExecutions.routeId, g.routeId), eq(routeExecutions.date, WEEK))))[0]!.payeeId).toBeNull();
      expect(after.summary.off).toBe(1);
      // The report has nothing for 9000G that Monday: no "no pieces" exception for it.
      await importReport(tx, owner, { operation: 'tforce', fileName: 'tforce.csv', text: shift('tforce_pieces_jun2026.csv', '2026-06-15', daysBetween('2026-06-15', WEEK), (d) => d >= '2026-06-15' && d <= '2026-06-21') });
      const week = await loadTforceWeek(tx, owner, WEEK);
      expect(week.exceptions.filter((e: { route: string; date: string }) => e.route === '9000G' && e.date === WEEK)).toEqual([]);
      // Undo brings the day back as it was (proposed, not confirmed).
      await undoAssignment(tx, owner, { date: WEEK, routeId: g.routeId, previous });
      expect((await loadDay(tx, owner, WEEK)).rows.find((r) => r.code === '9000G')!.status).toBe('proposed');
    }), 120_000);
});
