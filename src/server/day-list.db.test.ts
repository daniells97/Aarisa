import { and, eq, isNull } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { dayListSends, routeExecutions, routes, sortCodes, users } from '~/db/schema';
import type { Mail } from '~/integrations/mail';
import { actorAs, driverNamed, withRollback } from '../../tests/helpers/db';
import { addPersonToday, loadDay, moveToCode, removePersonToday, sendDayList, setAssignment, setPersonSortCodes, setSortCodes } from './daily';
import { createDriver } from './people';

const sent: Mail[] = [];
vi.mock('~/integrations/mail', () => ({ sendMail: vi.fn(async (m: Mail) => { sent.push(m); return true; }) }));

type Tx = Parameters<Parameters<typeof withRollback>[0]>[0];
const route = async (tx: Tx, code: string) => (await tx.select().from(routes).where(eq(routes.code, code)))[0]!;
const date = '2026-09-03'; // a day with no list yet: every code starts on its usual driver, proposed
const d = actorAs('dispatcher');
const base = { hovershipCode: null, contractorId: null, phone: null, aliases: [], active: true, setupComplete: true };

// Person first (Nov 2026): the operator confirms who works and sends the list; the admin sets driver codes and routes.
describe('daily list, person first', () => {
  it('lists people by name, then the codes nobody drives', () => withRollback(async (tx) => {
    const day = await loadDay(tx, d, date);
    const named = day.rows.filter((r) => r.today.name && r.status !== 'no_driver' && r.status !== 'off').map((r) => r.today.name!);
    expect(named).toEqual([...named].sort((a, b) => a.localeCompare(b)));
    const firstEmpty = day.rows.findIndex((r) => r.status === 'no_driver');
    if (firstEmpty >= 0) expect(day.rows.slice(firstEmpty).every((r) => r.status === 'no_driver' || r.status === 'off' || !r.today.name)).toBe(true);
  }));

  it('a person can be on the list without a driver code, with routes, and is never added twice', () => withRollback(async (tx) => {
    const p = await createDriver(tx, d, { ...base, fullName: 'Test No Code' }, date);
    const id = await addPersonToday(tx, d, { date, driverId: p.id });
    const [sc] = await tx.select().from(sortCodes).limit(1);
    await setPersonSortCodes(tx, d, { executionId: id, sortCodeIds: [sc!.id] });
    const day = await loadDay(tx, d, date);
    expect(day.noCode).toEqual([expect.objectContaining({ executionId: id, name: 'Test No Code', sortCodes: [{ id: sc!.id, code: sc!.code }] })]);
    expect(day.summary.noCode).toBe(1);
    await expect(addPersonToday(tx, d, { date, driverId: p.id })).rejects.toMatchObject({ code: 'already_on_list' });
    // Someone still proposed on their usual code is already on the list too.
    const e = await route(tx, '9000E');
    await expect(addPersonToday(tx, d, { date, driverId: e.usualDriverId! })).rejects.toMatchObject({ code: 'already_on_list' });
    const gone = await removePersonToday(tx, d, { executionId: id });
    expect(gone).toMatchObject({ driverId: p.id, sortCodeIds: [sc!.id] });
    expect((await loadDay(tx, d, date)).noCode).toHaveLength(0);
  }));

  it('giving a code to a person without one moves them and their routes there; a confirmed person on it keeps working without code', () => withRollback(async (tx) => {
    const p = await createDriver(tx, d, { ...base, fullName: 'Test New Code' }, date);
    const e = await route(tx, '9000E');
    await setAssignment(tx, d, { date, routeId: e.id, payee: { driverId: e.usualDriverId! } }); // confirmed
    const id = await addPersonToday(tx, d, { date, driverId: p.id });
    const [sc] = await tx.select().from(sortCodes).limit(1);
    await setPersonSortCodes(tx, d, { executionId: id, sortCodeIds: [sc!.id] });
    expect(await moveToCode(tx, actorAs('owner'), { date, from: { executionId: id }, to: { routeId: e.id } })).toEqual({ code: '9000E' });
    const day = await loadDay(tx, d, date);
    const row = day.rows.find((r) => r.code === '9000E')!;
    expect(row).toMatchObject({ status: 'changed', today: { driverId: p.id }, sortCodes: [{ id: sc!.id, code: sc!.code }], sortCodesSuggested: false });
    expect(day.noCode.map((x) => x.driverId)).toEqual([e.usualDriverId]);
    // The person's row without code is gone (no duplicate day for them).
    expect(await tx.select().from(routeExecutions).where(and(eq(routeExecutions.date, date), isNull(routeExecutions.routeId), eq(routeExecutions.driverId, p.id)))).toHaveLength(0);
  }));

  it('changing a code swaps the two people; a typed new code is created', () => withRollback(async (tx) => {
    const e = await route(tx, '9000E');
    const robert = await driverNamed(tx, 'Robert Arteaga');
    const a = (await tx.select().from(routes).where(eq(routes.usualDriverId, robert.id)))[0]!;
    await moveToCode(tx, d, { date, from: { routeId: a.id }, to: { routeId: e.id } });
    let day = await loadDay(tx, d, date);
    expect(day.rows.find((r) => r.code === '9000E')!.today.driverId).toBe(robert.id);
    expect(day.rows.find((r) => r.code === a.code)!.today.driverId).toBe(e.usualDriverId);
    await moveToCode(tx, d, { date, from: { routeId: e.id }, to: { newCode: ' 9100x ' } });
    day = await loadDay(tx, d, date);
    expect(day.rows.find((r) => r.code === '9100X')).toMatchObject({ today: { driverId: robert.id } });
    expect(day.rows.find((r) => r.code === '9000E')).toMatchObject({ status: 'no_driver' });
  }));

  it('"Confirm and send list" confirms the usual drivers and emails the people marked for it', () => withRollback(async (tx) => {
    sent.length = 0;
    await tx.update(users).set({ receivesDayList: false });
    await tx.insert(users).values([
      { zitadelSub: 'test:dl1', name: 'Admin', email: 'admin@test.com', role: 'owner', receivesDayList: true, locale: 'es' },
      { zitadelSub: 'test:dl2', name: 'Off', email: 'off@test.com', role: 'owner', receivesDayList: true, active: false },
      { zitadelSub: 'test:dl3', name: 'No', email: 'no@test.com', role: 'finance' },
    ]);
    const p = await createDriver(tx, d, { ...base, fullName: 'Test Mail Person' }, date);
    await addPersonToday(tx, d, { date, driverId: p.id });
    const res = await sendDayList(tx, d, date);
    expect(res.confirmed).toBeGreaterThan(0);
    expect(res).toMatchObject({ recipients: 1, sent: 1 });
    expect(sent[0]!.to).toBe('admin@test.com');
    expect(sent[0]!.subject).toMatch(/^Conductores de .+ confirmados para el jueves, 3 de septiembre/);
    expect(sent[0]!.html).toContain('Sin code driver: Test Mail Person.');
    expect(sent[0]!.html).toContain('9000E');
    const day = await loadDay(tx, d, date);
    expect(day.summary.proposed).toBe(0);
    expect(day.sent).toMatchObject({ recipients: 1 });
    expect(await tx.select().from(dayListSends).where(eq(dayListSends.date, date))).toHaveLength(1);
    await expect(sendDayList(tx, actorAs('finance'), date)).rejects.toThrow();
  }));

  it('someone without code who is then picked on a code is one line, not two, with their routes', () => withRollback(async (tx) => {
    const p = await createDriver(tx, d, { ...base, fullName: 'Test Merge' }, date);
    const id = await addPersonToday(tx, d, { date, driverId: p.id });
    const [sc] = await tx.select().from(sortCodes).limit(1);
    await setPersonSortCodes(tx, d, { executionId: id, sortCodeIds: [sc!.id] });
    const e = await route(tx, '9000E');
    await setSortCodes(tx, d, { date, routeId: e.id, sortCodeIds: [] }); // the code had its routes set to none
    await setAssignment(tx, d, { date, routeId: e.id, payee: { driverId: p.id } });
    const day = await loadDay(tx, d, date);
    expect(day.noCode).toHaveLength(0);
    expect(day.rows.filter((r) => r.today.driverId === p.id)).toHaveLength(1);
  }));

  it('warns when one driver is on two driver codes the same day', () => withRollback(async (tx) => {
    const e = await route(tx, '9000E');
    const robert = await driverNamed(tx, 'Robert Arteaga');
    await setAssignment(tx, d, { date, routeId: e.id, payee: { driverId: robert.id } });
    expect((await loadDay(tx, d, date)).doubles).toEqual([expect.objectContaining({ name: 'Robert Arteaga', codes: expect.arrayContaining(['9000E']) })]);
  }));

  it("the day's changes keep someone without code who was taken off (the row is gone, the history isn't)", () => withRollback(async (tx) => {
    const p = await createDriver(tx, d, { ...base, fullName: 'Test Trace' }, date);
    const id = await addPersonToday(tx, d, { date, driverId: p.id });
    await removePersonToday(tx, d, { executionId: id });
    const changes = (await loadDay(tx, d, date)).changes;
    expect(changes.find((c) => c.left && c.from === 'Test Trace')).toBeDefined();
    expect(changes.find((c) => !c.route && c.to === 'Test Trace' && c.action === 'insert')).toBeDefined();
  }));
});
