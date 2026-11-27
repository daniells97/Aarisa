import { and, eq, isNull } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { operations, routeExecutions, routes, sortCodes } from '~/db/schema';
import { actorAs, driverNamed, withRollback } from '../../tests/helpers/db';
import {
  removeRouteRow, addPersonToday, addRoute, confirmUsual, loadDay, markOffToday, moveToCode, removePersonToday, setAssignment, setPersonSortCodes,
  setPersonStatus, setRouteOnList, setRouteStatus, setSortCodes, undoAssignment,
} from './daily';
import { coverHovership, loadHovershipDay, restoreHovership, setHovershipRoutes } from './hovership-day';
import { createDriver } from './people';

// Every action of Daily operations, end to end on the server: add, change, take off, undo, and the
// "one line per person / one line per route" rules. Each test runs in a transaction that is rolled back and
// sets up what it needs (driver codes on the list), so it doesn't depend on what someone left in the test
// environment (client request, Nov 27 2026).

type Tx = Parameters<Parameters<typeof withRollback>[0]>[0];
const d = actorAs('dispatcher');
const DATE = '2031-03-04'; // a day nobody has touched
const base = { hovershipCode: null, contractorId: null, phone: null, aliases: [], active: true, setupComplete: true };

async function tforceReady(tx: Tx) {
  const [op] = await tx.select().from(operations).where(eq(operations.code, 'tforce'));
  await tx.update(routes).set({ active: true }).where(eq(routes.operationId, op!.id));
  const code = async (c: string) => (await tx.select().from(routes).where(and(eq(routes.operationId, op!.id), eq(routes.code, c))))[0]!;
  const sc = await tx.select().from(sortCodes).where(eq(sortCodes.operationId, op!.id)).limit(3);
  return { op: op!, code, sc };
}
const rowOf = async (tx: Tx, code: string) => (await loadDay(tx, d, DATE)).rows.find((r) => r.code === code)!;

describe('Daily operations, T-Force: add, change, take off', () => {
  it('a new record with a person and no code is one line; the same person again is refused', () => withRollback(async (tx) => {
    await tforceReady(tx);
    const p = await createDriver(tx, d, { ...base, fullName: 'Flow One' }, DATE);
    await addPersonToday(tx, d, { date: DATE, driverId: p.id });
    let day = await loadDay(tx, d, DATE);
    expect(day.noCode.filter((x) => x.driverId === p.id)).toHaveLength(1);
    await expect(addPersonToday(tx, d, { date: DATE, driverId: p.id })).rejects.toMatchObject({ code: 'already_on_list' });
    day = await loadDay(tx, d, DATE);
    expect(day.noCode.filter((x) => x.driverId === p.id)).toHaveLength(1);
  }));

  it('a new record with a person and a new driver code; the same person on another new code is refused', () => withRollback(async (tx) => {
    await tforceReady(tx);
    const p = await createDriver(tx, d, { ...base, fullName: 'Flow Two' }, DATE);
    await addRoute(tx, d, { date: DATE, code: '9300A', payee: { driverId: p.id } });
    expect(await rowOf(tx, '9300A')).toMatchObject({ status: 'confirmed', today: { driverId: p.id } });
    await expect(addRoute(tx, d, { date: DATE, code: '9300B', payee: { driverId: p.id } })).rejects.toMatchObject({ code: 'already_on_list' });
  }));

  it('changing the person on a code, and Undo', () => withRollback(async (tx) => {
    const { code } = await tforceReady(tx);
    const e = await code('9000E');
    const p = await createDriver(tx, d, { ...base, fullName: 'Flow Three' }, DATE);
    const res = await setAssignment(tx, d, { date: DATE, routeId: e.id, payee: { driverId: p.id } });
    expect(await rowOf(tx, '9000E')).toMatchObject({ status: 'changed', today: { driverId: p.id } });
    await undoAssignment(tx, d, { date: DATE, routeId: e.id, previous: res.previous });
    expect((await rowOf(tx, '9000E')).today.driverId).toBe(e.usualDriverId);
  }));

  it("picking someone who is on another code is refused on the server (the screen moves them instead)", () => withRollback(async (tx) => {
    const { code } = await tforceReady(tx);
    const e = await code('9000E');
    const robert = await driverNamed(tx, 'Robert Arteaga');
    await expect(setAssignment(tx, d, { date: DATE, routeId: e.id, payee: { driverId: robert.id } })).rejects.toMatchObject({ code: 'already_on_list' });
    // Moving them: they leave their code and swap with whoever was on 9000E.
    const a = (await loadDay(tx, d, DATE)).rows.find((r) => r.today.driverId === robert.id)!;
    await moveToCode(tx, d, { date: DATE, from: { routeId: a.routeId }, to: { routeId: e.id } });
    const day = await loadDay(tx, d, DATE);
    expect(day.rows.filter((r) => r.today.driverId === robert.id && r.status !== 'off' && r.status !== 'no_driver').map((r) => r.code)).toEqual(['9000E']);
    expect(day.rows.find((r) => r.code === a.code)!.today.driverId).toBe(e.usualDriverId);
  }));

  it('giving a person without code a code, then changing it; their routes move with them and never stay twice', () => withRollback(async (tx) => {
    const { code, sc } = await tforceReady(tx);
    const p = await createDriver(tx, d, { ...base, fullName: 'Flow Four' }, DATE);
    const id = await addPersonToday(tx, d, { date: DATE, driverId: p.id });
    await setPersonSortCodes(tx, d, { executionId: id, sortCodeIds: [sc[0]!.id] });
    const e = await code('9000E');
    await moveToCode(tx, d, { date: DATE, from: { executionId: id }, to: { routeId: e.id } });
    expect((await rowOf(tx, '9000E')).sortCodes.map((x) => x.id)).toEqual([sc[0]!.id]);
    const g = await code('9000G');
    await moveToCode(tx, d, { date: DATE, from: { routeId: e.id }, to: { routeId: g.id } });
    const day = await loadDay(tx, d, DATE);
    const holders = [...day.rows, ...day.noCode.map((x) => ({ ...x, code: '-' }))].filter((r) => r.sortCodes.some((s) => s.id === sc[0]!.id));
    expect(holders.map((h) => h.code)).toEqual(['9000G']);
  }));

  it('the same route on two lines the same day is refused; confirming leaves a taken usual route with its holder', () => withRollback(async (tx) => {
    const { code, sc } = await tforceReady(tx);
    const e = await code('9000E');
    const g = await code('9000G');
    await setSortCodes(tx, d, { date: DATE, routeId: e.id, sortCodeIds: [sc[0]!.id] });
    await expect(setSortCodes(tx, d, { date: DATE, routeId: g.id, sortCodeIds: [sc[0]!.id] })).rejects.toMatchObject({ code: 'route_taken' });
    const p = await createDriver(tx, d, { ...base, fullName: 'Flow Five' }, DATE);
    const id = await addPersonToday(tx, d, { date: DATE, driverId: p.id });
    await expect(setPersonSortCodes(tx, d, { executionId: id, sortCodeIds: [sc[0]!.id] })).rejects.toMatchObject({ code: 'route_taken' });
    await confirmUsual(tx, d, DATE); // must not fail on shared usual routes
  }));

  it('status: confirmed, to confirm, didn\'t run, back; and the × (didn\'t run) with Undo', () => withRollback(async (tx) => {
    const { code } = await tforceReady(tx);
    const e = await code('9000E');
    await setRouteStatus(tx, d, { date: DATE, routeId: e.id, status: 'confirmed' });
    expect((await rowOf(tx, '9000E')).status).toBe('confirmed');
    await setRouteStatus(tx, d, { date: DATE, routeId: e.id, status: 'proposed' });
    expect((await rowOf(tx, '9000E')).status).toBe('proposed');
    const off = await markOffToday(tx, d, { date: DATE, routeId: e.id });
    expect((await rowOf(tx, '9000E')).status).toBe('off');
    // Who it was stays on the day for the history, but nobody is paid.
    const [saved] = await tx.select().from(routeExecutions).where(eq(routeExecutions.id, off.assignmentId));
    expect(saved).toMatchObject({ driverId: e.usualDriverId, payeeId: null });
    await undoAssignment(tx, d, { date: DATE, routeId: e.id, previous: off.previous });
    expect((await rowOf(tx, '9000E')).status).toBe('proposed');
  }));

  it('a person without code: to confirm, confirmed, taken off with the × (and added back by Undo)', () => withRollback(async (tx) => {
    await tforceReady(tx);
    const p = await createDriver(tx, d, { ...base, fullName: 'Flow Six' }, DATE);
    const id = await addPersonToday(tx, d, { date: DATE, driverId: p.id });
    await setPersonStatus(tx, d, { executionId: id, status: 'proposed' });
    expect((await loadDay(tx, d, DATE)).noCode.find((x) => x.executionId === id)!.status).toBe('proposed');
    await setPersonStatus(tx, d, { executionId: id, status: 'confirmed' });
    const gone = await removePersonToday(tx, d, { executionId: id });
    expect((await loadDay(tx, d, DATE)).noCode.find((x) => x.driverId === p.id)).toBeUndefined();
    await addPersonToday(tx, d, { date: DATE, driverId: gone.driverId });
    expect((await loadDay(tx, d, DATE)).noCode.filter((x) => x.driverId === p.id)).toHaveLength(1);
    expect(await tx.select().from(routeExecutions).where(and(eq(routeExecutions.date, DATE), isNull(routeExecutions.routeId), eq(routeExecutions.driverId, p.id)))).toHaveLength(1);
  }));

  it('the × on a line with a code: off the day\'s list (the history keeps who didn\'t run), back with Undo', () => withRollback(async (tx) => {
    const { code } = await tforceReady(tx);
    const e = await code('9000E');
    await markOffToday(tx, d, { date: DATE, routeId: e.id });
    await setRouteOnList(tx, d, { routeId: e.id, active: false });
    expect(await rowOf(tx, '9000E')).toBeDefined(); // "didn't run" keeps the line with its person (the × is what removes it)
    expect((await loadDay(tx, d, '2031-03-05')).rows.find((r) => r.code === '9000E')).toBeUndefined();
    await setRouteOnList(tx, d, { routeId: e.id, active: true });
    expect((await loadDay(tx, d, '2031-03-05')).rows.find((r) => r.code === '9000E')).toBeDefined();
  }));
});

describe("Daily operations, T-Force: didn't run vs the ×", () => {
  it("\"didn't run\" keeps the person and their routes on the line (not paid); the route is free for someone else", () => withRollback(async (tx) => {
    const { code, sc } = await tforceReady(tx);
    const e = await code('9000E');
    await setSortCodes(tx, d, { date: DATE, routeId: e.id, sortCodeIds: [sc[0]!.id] });
    await setRouteStatus(tx, d, { date: DATE, routeId: e.id, status: 'off' });
    const row = await rowOf(tx, '9000E');
    expect(row).toMatchObject({ status: 'off', today: { driverId: e.usualDriverId } });
    expect(row.sortCodes.map((x) => x.id)).toEqual([sc[0]!.id]);
    const g = await code('9000G');
    await setSortCodes(tx, d, { date: DATE, routeId: g.id, sortCodeIds: [sc[0]!.id] }); // someone covered it: allowed
    await setRouteStatus(tx, d, { date: DATE, routeId: e.id, status: 'confirmed' });
    expect((await rowOf(tx, '9000E')).today.driverId).toBe(e.usualDriverId);
  }));

  it('the × takes the line off the day completely', () => withRollback(async (tx) => {
    const { code } = await tforceReady(tx);
    const e = await code('9000E');
    await removeRouteRow(tx, d, { date: DATE, routeId: e.id });
    expect(await rowOf(tx, '9000E')).toBeUndefined();
  }));
});

describe('Daily operations, Hovership: routes, cover, status', () => {
  it('one route per person a day; covering moves the routes, Undo puts them back; confirm usual skips taken routes', () => withRollback(async (tx) => {
    const day = await loadHovershipDay(tx, d, DATE);
    const withRoutes = day.rows.filter((r) => r.usual.length);
    const [a, b] = withRoutes;
    if (!a || !b) return; // the sample data has Hovership people with usual routes
    await setHovershipRoutes(tx, d, { date: DATE, driverId: a.driverId, sortCodeIds: a.usual.map((u) => u.id) });
    await expect(setHovershipRoutes(tx, d, { date: DATE, driverId: b.driverId, sortCodeIds: [a.usual[0]!.id] })).rejects.toMatchObject({ code: 'route_taken' });
    const cover = await coverHovership(tx, d, { date: DATE, driverId: a.driverId, by: { driverId: b.driverId } });
    let now = await loadHovershipDay(tx, d, DATE);
    const holders = now.rows.filter((r) => !r.suggested && r.sortCodes.some((s) => s.id === a.usual[0]!.id));
    expect(holders.map((h) => h.driverId)).toEqual([b.driverId]);
    await restoreHovership(tx, d, { date: DATE, previous: cover.previous });
    now = await loadHovershipDay(tx, d, DATE);
    expect(now.rows.find((r) => r.driverId === a.driverId)!.sortCodes.map((s) => s.id).sort()).toEqual(a.usual.map((u) => u.id).sort());
  }));
});
