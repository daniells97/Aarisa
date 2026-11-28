import { and, asc, eq, gte, inArray, lt, lte, or } from 'drizzle-orm';
import type { Tx } from '~/db/client';
import { driverLoans, driverNotes, executionSortCodes, executionView, extraJobView, routes, serviceTypes, sortCodes, users, workView } from '~/db/schema';
import { rangeTooLong } from '~/domain/history-range';
import { can } from '~/domain/permissions';
import { assertCan, type Actor } from './actor';
import { RuleError } from './errors';
import { listOperations } from './ops';
import { contractorProfiles, driverProfiles } from './people';

// History: who worked which days, on which driver code and routes, with the pieces the client reported.
// Filters: contract, person, T-Force driver code and a date range of up to a year. No money (dispatchers
// see it too).

const MAX_ROWS = 1000;

export async function loadHistory(tx: Tx, actor: Actor, input: { from: string; to: string; operation?: string; driverId?: string; routeId?: string }, today: string, opts: { allRows?: boolean } = {}) {
  assertCan(actor, 'payroll.view');
  if (input.from > input.to) throw new RuleError('invalid_range');
  if (rangeTooLong(input.from, input.to)) throw new RuleError('range_too_long');
  const ops = await listOperations(tx);
  const op = input.operation ? ops.find((o) => o.code === input.operation) : null;
  if (input.operation && !op) throw new RuleError('not_found');

  const where = [
    gte(executionView.date, input.from), lte(executionView.date, input.to), eq(executionView.kind, 'route'),
    op ? eq(executionView.operationId, op.id) : undefined,
    input.driverId ? or(eq(executionView.payeeDriverId, input.driverId), eq(executionView.driverId, input.driverId)) : undefined,
    input.routeId ? eq(executionView.routeId, input.routeId) : undefined,
  ].filter((x) => x !== undefined);
  const all = await tx.select().from(executionView).where(and(...where)).orderBy(asc(executionView.date));
  const ids = all.map((e) => e.id);
  const pieces = new Map<string, number>();
  for (let i = 0; i < ids.length; i += 5000) {
    const chunk = ids.slice(i, i + 5000);
    for (const w of await tx.select({ id: workView.executionId, n: workView.pieces }).from(workView).where(and(inArray(workView.executionId, chunk), eq(workView.source, 'client_report')))) {
      pieces.set(w.id, (pieces.get(w.id) ?? 0) + w.n);
    }
  }
  const ran = new Map<string, string[]>();
  for (let i = 0; i < ids.length; i += 5000) {
    for (const r of await tx.select({ id: executionSortCodes.executionId, code: sortCodes.code }).from(executionSortCodes)
      .innerJoin(sortCodes, eq(sortCodes.id, executionSortCodes.sortCodeId)).where(inArray(executionSortCodes.executionId, ids.slice(i, i + 5000))).orderBy(asc(sortCodes.code))) {
      ran.set(r.id, [...(ran.get(r.id) ?? []), r.code]);
    }
  }
  // Only days somebody worked or something was recorded: a person, pieces or routes. On a contract whose
  // report names the driver (Hovership), a person with no routes and no pieces that day didn't work
  // ("Didn't work today" or covered by someone else), so that day isn't history, as in Daily operations.
  const byReport = new Set(ops.filter((o) => o.driverSource === 'report_code').map((o) => o.id));
  // A day's status for the history: confirmed, to confirm, or didn't run / didn't work (with who it was).
  const dayStatus = (e: (typeof all)[number]): 'confirmed' | 'proposed' | 'off' | 'no_driver' => {
    if (e.status === 'off') return 'off';
    if (byReport.has(e.operationId) && e.payeeId && !pieces.has(e.id) && !ran.has(e.id)) return 'off';
    if (e.status === 'proposed' || e.status === 'waiting') return 'proposed';
    if (e.status === 'no_driver') return 'no_driver';
    return 'confirmed';
  };
  const days = all.filter((e) => pieces.has(e.id) || ran.has(e.id) || !!e.payeeId || (e.status === 'off' && !!e.driverId));

  const people = await driverProfiles(tx, today);
  const companies = await contractorProfiles(tx);
  const routeRows = await tx.select().from(routes);
  const personName = new Map(people.map((p) => [p.id, p.fullName]));
  const companyName = new Map(companies.map((c) => [c.id, c.name]));
  const routeCode = new Map(routeRows.map((r) => [r.id, r.code]));
  const opCode = new Map(ops.map((o) => [o.id, o.code]));
  const who = (e: (typeof all)[number]) => {
    const driver = e.driverId ?? e.payeeDriverId;
    return { driverId: driver, name: driver ? personName.get(driver) ?? '' : e.payeeContractorId ? companyName.get(e.payeeContractorId) ?? '' : null, company: e.payeeContractorId ? companyName.get(e.payeeContractorId) ?? null : null };
  };

  const rows = days.map((e) => ({
    id: e.id, date: e.date, operation: opCode.get(e.operationId) ?? '', driverCode: e.routeId ? routeCode.get(e.routeId) ?? null : null,
    ...who(e), rawName: e.rawName, sortCodes: ran.get(e.id) ?? [], pieces: pieces.get(e.id) ?? null, status: dayStatus(e),
  }));

  const byPerson = new Map<string, { key: string; driverId: string | null; name: string; days: number; pieces: number; driverCodes: Set<string>; sortCodes: Map<string, number> }>();
  for (const r of rows) {
    if (!r.name || r.status === 'off') continue; // days worked only
    const key = r.driverId ?? r.name;
    const p = byPerson.get(key) ?? { key, driverId: r.driverId, name: r.name, days: 0, pieces: 0, driverCodes: new Set(), sortCodes: new Map() };
    p.days++; p.pieces += r.pieces ?? 0;
    if (r.driverCode) p.driverCodes.add(r.driverCode);
    for (const s of r.sortCodes) p.sortCodes.set(s, (p.sortCodes.get(s) ?? 0) + 1);
    byPerson.set(key, p);
  }

  // Everything else about the people in the period: extra jobs, loans and advances, notes (client request,
  // Nov 24 2026). A person filter shows theirs; a driver-code filter, those of the people who drove it.
  const onlyPeople = input.driverId ? [input.driverId] : input.routeId ? [...new Set(rows.map((r) => r.driverId).filter((x): x is string => !!x))] : null;
  const services = new Map((await tx.select().from(serviceTypes)).map((s) => [s.id, s]));
  const jobs = onlyPeople && !onlyPeople.length ? [] : await tx.select().from(extraJobView).where(and(
    gte(extraJobView.date, input.from), lte(extraJobView.date, input.to),
    op ? eq(extraJobView.operationId, op.id) : undefined,
    onlyPeople ? inArray(extraJobView.driverId, onlyPeople) : undefined,
  )).orderBy(asc(extraJobView.date));
  const loans = onlyPeople && !onlyPeople.length ? [] : await tx.select().from(driverLoans).where(and(
    gte(driverLoans.givenOn, input.from), lte(driverLoans.givenOn, input.to), onlyPeople ? inArray(driverLoans.driverId, onlyPeople) : undefined,
  )).orderBy(asc(driverLoans.givenOn));
  const dayAfter = new Date(`${input.to}T00:00:00Z`); dayAfter.setUTCDate(dayAfter.getUTCDate() + 2); // notes are timestamps; LA is behind UTC
  const notes = onlyPeople && !onlyPeople.length ? [] : await tx.select({ n: driverNotes, author: users.name }).from(driverNotes).leftJoin(users, eq(users.id, driverNotes.createdBy)).where(and(
    gte(driverNotes.createdAt, new Date(`${input.from}T00:00:00Z`)), lt(driverNotes.createdAt, dayAfter), onlyPeople ? inArray(driverNotes.driverId, onlyPeople) : undefined,
  )).orderBy(asc(driverNotes.createdAt));
  const money = can(actor.role, 'money.view');
  const laDate = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(d);

  return {
    from: input.from, to: input.to,
    extraJobs: jobs.map((j) => {
      const s = services.get(j.serviceTypeId);
      return {
        id: j.id, date: j.date, operation: opCode.get(j.operationId) ?? '', service: s ? { name: s.name, nameEs: s.nameEs } : { name: '', nameEs: null },
        driverId: j.driverId, name: j.driverId ? personName.get(j.driverId) ?? '' : j.contractorId ? companyName.get(j.contractorId) ?? '' : '',
        nearRoute: j.nearRouteId ? routeCode.get(j.nearRouteId) ?? null : null, orderNumber: j.orderNumber, note: j.note,
        // Amounts only for roles that see money (owner, finance); the rest see what was done.
        driverPay: money && j.driverAmountCents != null ? Number(j.driverAmountCents) : null,
      };
    }),
    loans: loans.map((l) => ({ id: l.id, date: l.givenOn, driverId: l.driverId, name: personName.get(l.driverId) ?? '', kind: l.kind, amount: money ? Number(l.amountCents) : null, note: l.note })),
    notes: notes.map(({ n, author }) => laDate(n.createdAt) >= input.from && laDate(n.createdAt) <= input.to ? { id: n.id, date: laDate(n.createdAt), driverId: n.driverId, name: personName.get(n.driverId) ?? '', body: n.body, author, resolved: !!n.resolvedAt } : null).filter((x) => x !== null),
    totals: { days: rows.filter((r) => r.name).length, people: byPerson.size, pieces: rows.reduce((s, r) => s + (r.pieces ?? 0), 0) },
    byPerson: [...byPerson.values()].map((p) => ({
      key: p.key, driverId: p.driverId, name: p.name, days: p.days, pieces: p.pieces, driverCodes: [...p.driverCodes].sort(),
      sortCodes: [...p.sortCodes].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([code, n]) => ({ code, days: n })),
    })).sort((a, b) => b.days - a.days || a.name.localeCompare(b.name)),
    rows: opts.allRows ? rows.slice().reverse() : rows.slice().reverse().slice(0, MAX_ROWS),
    truncated: !opts.allRows && rows.length > MAX_ROWS,
    options: {
      operations: ops.filter((o) => o.active).map((o) => ({ code: o.code, name: o.name, driverSource: o.driverSource })),
      people: people.map((p) => ({ id: p.id, name: p.fullName, active: p.active })),
      driverCodes: routeRows.filter((r) => ops.find((o) => o.id === r.operationId)?.driverSource === 'daily_list').map((r) => ({ id: r.id, code: r.code })).sort((a, b) => a.code.localeCompare(b.code)),
    },
  };
}
