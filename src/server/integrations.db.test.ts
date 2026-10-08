import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { aiSuggestions, contractors, drivers, users } from '~/db/schema';
import { actorAs, withRollback } from '../../tests/helpers/db';
import { ForbiddenError } from './actor';
import { loadDay } from './daily';
import { createExtraJob } from './extra-jobs';
import { applyDailyChanges, confirmExtraJobDraft, createExtraJobDraft, loadExtraJobDraft, logMessage, morningList, serviceTokenValid } from './integrations';

type T = Parameters<Parameters<typeof withRollback>[0]>[0];
async function person(tx: T, role: 'owner' | 'dispatcher' | 'viewer', phone: string) {
  const [u] = await tx.insert(users).values({ zitadelSub: `test:${phone}`, name: `${role} ${phone}`, email: `${phone}@test`, role, phone, morningChannel: 'whatsapp' }).returning();
  return u!;
}

describe('integration API (server)', () => {
  it('accepts only the exact service token', () => {
    const token = 'x'.repeat(40);
    expect(serviceTokenValid(`Bearer ${token}`, token)).toBe(true);
    expect(serviceTokenValid(`Bearer ${token}y`, token)).toBe(false);
    expect(serviceTokenValid(null, token)).toBe(false);
    expect(serviceTokenValid(`Bearer short`, 'short')).toBe(false); // tokens under 32 chars are refused
  });

  it('"E is Norwin today. Z the new guy from Puma": applies the known name and asks about the other', () =>
    withRollback(async (tx) => {
      await person(tx, 'dispatcher', '+1 925 555 0101');
      const [norwin] = await tx.select().from(drivers).where(eq(drivers.fullName, 'Norwin Saloman'));
      const res = await applyDailyChanges(tx, {
        phone: '+19255550101', date: '2026-09-03', inputText: 'E is Norwin today. Z the new guy from Puma', model: 'test-model',
        output: { changes: [
          { route: '9000E', driver_name: 'Norwin Saloman', matched_driver_id: norwin!.id, confidence: 0.94 },
          { route: '9000Z', driver_name: 'the new guy from Puma', matched_driver_id: null, contractor_hint: 'Puma' },
          { route: '9000A', driver_name: 'Robert', matched_driver_id: norwin!.id, confidence: 0.6 },
        ] },
      });
      expect(res.applied).toEqual([{ route: '9000E', name: 'Norwin Saloman' }]);
      expect(res.unresolved.map((u) => [u.route, u.reason])).toEqual([['9000Z', 'unknown_name'], ['9000A', 'low_confidence']]);
      const day = await loadDay(tx, actorAs('owner'), '2026-09-03');
      expect(day.rows.find((r) => r.code === '9000E')).toMatchObject({ status: 'changed', source: 'whatsapp', today: { name: 'Norwin Saloman' } });
      expect(day.rows.find((r) => r.code === '9000Z')).toMatchObject({ status: 'no_driver', rawName: 'the new guy from Puma' });
      expect(day.rows.find((r) => r.code === '9000A')!.status).toBe('proposed'); // below 0.85: not applied
      const [s] = await tx.select().from(aiSuggestions).where(eq(aiSuggestions.id, res.suggestionId));
      expect(s).toMatchObject({ kind: 'daily_changes', status: 'partially_applied', inputText: 'E is Norwin today. Z the new guy from Puma', model: 'test-model' });
    }));

  it('"All good" confirms the usual drivers; invalid AI output changes nothing', () =>
    withRollback(async (tx) => {
      await person(tx, 'owner', '+19255550102');
      const bad = await applyDailyChanges(tx, { phone: '+19255550102', date: '2026-09-04', inputText: '???', model: 'm', output: { changes: 'nope' } });
      expect(bad.unresolved[0]!.reason).toBe('invalid_output');
      expect((await loadDay(tx, actorAs('owner'), '2026-09-04')).summary.confirmed).toBe(0);
      const ok = await applyDailyChanges(tx, { phone: '+19255550102', date: '2026-09-04', inputText: 'All good', model: 'm', output: { confirm_all: true, changes: [] } });
      expect(ok.confirmedAll).toBeGreaterThan(0);
      expect((await loadDay(tx, actorAs('owner'), '2026-09-04')).summary.proposed).toBe(0);
    }));

  it('a viewer phone cannot change the list; an unknown phone is refused', () =>
    withRollback(async (tx) => {
      await person(tx, 'viewer', '+19255550103');
      await expect(applyDailyChanges(tx, { phone: '+19255550103', date: '2026-09-03', inputText: 'x', model: 'm', output: { changes: [] } })).rejects.toBeInstanceOf(ForbiddenError);
      await expect(applyDailyChanges(tx, { phone: '+10000000000', date: '2026-09-03', inputText: 'x', model: 'm', output: { changes: [] } })).rejects.toMatchObject({ code: 'unknown_phone' });
    }));

  it('an extra-job draft is only a suggestion until the person saves it from the link (rule 5)', () =>
    withRollback(async (tx) => {
      const u = await person(tx, 'dispatcher', '+19255550104');
      const [puma] = await tx.select().from(contractors).where(eq(contractors.name, 'Puma'));
      const msg = await logMessage(tx, { waMessageId: 'wamid.TEST1', direction: 'in', phone: '+19255550104', type: 'audio', transcript: 'Recovery near R for Puma, T-Force pays 180, Puma gets 120, order TF-55821' });
      expect((await logMessage(tx, { waMessageId: 'wamid.TEST1', direction: 'in', phone: '+19255550104', type: 'audio' })).id).toBe(msg.id);
      const draft = await createExtraJobDraft(tx, {
        phone: '+19255550104', messageId: msg.id, inputText: msg.transcript!, model: 'm',
        output: { service: 'recovery_route', date: '2026-06-18', near_route: 'R', contractor_id: puma!.id, client_amount: 180, driver_amount: 120, order_number: 'TF-55821', missing: [] },
      }, 'https://aarisa.example');
      expect(draft.link).toMatch(/^https:\/\/aarisa\.example\/extra-jobs\/new\?draft=/);
      const token = decodeURIComponent(draft.link.split('draft=')[1]!);
      const me = actorAs('dispatcher', u.id);
      const loaded = await loadExtraJobDraft(tx, me, token);
      expect(loaded).toMatchObject({ fromVoice: true, fields: { service: 'recovery_route', payee: `c:${puma!.id}`, driverAmountCents: 120_00, orderNumber: 'TF-55821', clientAmountCents: null } });
      expect(loaded.fields.nearRouteId).toBeTruthy();
      expect((await loadExtraJobDraft(tx, actorAs('owner'), token)).fields.clientAmountCents).toBe(180_00);
      const [pending] = await tx.select().from(aiSuggestions).where(eq(aiSuggestions.id, draft.suggestionId));
      expect(pending!.status).toBe('pending');
      await createExtraJob(tx, me, { clientUuid: crypto.randomUUID(), service: 'recovery_route', date: '2026-06-18', nearRouteId: loaded.fields.nearRouteId, payee: { contractorId: puma!.id }, clientAmountCents: null, driverAmountCents: 120_00, orderNumber: 'TF-55821', note: null, aiSuggestionId: draft.suggestionId });
      await confirmExtraJobDraft(tx, me, draft.suggestionId);
      const [done] = await tx.select().from(aiSuggestions).where(eq(aiSuggestions.id, draft.suggestionId));
      expect(done).toMatchObject({ status: 'applied', confirmedBy: u.id });
      await expect(loadExtraJobDraft(tx, me, token)).rejects.toMatchObject({ code: 'draft_used' });
    }));

  it('the morning list has routes and WhatsApp recipients with dispatch roles, and no money', () =>
    withRollback(async (tx) => {
      await person(tx, 'dispatcher', '+19255550105');
      await person(tx, 'viewer', '+19255550106');
      const list = await morningList(tx, '2026-06-18');
      expect(list.routes).toHaveLength(19);
      expect(list.recipients.map((r) => r.phone)).toContain('+19255550105');
      expect(list.recipients.map((r) => r.phone)).not.toContain('+19255550106');
      expect(JSON.stringify(list)).not.toMatch(/Cents/);
    }));
});

describe('AI context and reminders (server)', () => {
  it('context lists routes, drivers with aliases and contractors, and no money', () =>
    withRollback(async (tx) => {
      const { aiContext } = await import('./integrations');
      const ctx = await aiContext(tx, '2026-06-18');
      expect(ctx.routes).toHaveLength(19);
      expect(ctx.contractors.map((c) => c.name)).toContain('Puma');
      expect(ctx.drivers.find((d) => d.name === 'Norwin Saloman')).toBeTruthy();
      expect(JSON.stringify(ctx)).not.toMatch(/Cents|rate/i);
    }));

  it('7 PM reminder groups jobs without an order number by who saved them', () =>
    withRollback(async (tx) => {
      const { orderNumberReminders } = await import('./integrations');
      const u = await person(tx, 'dispatcher', '+19255550107');
      const [robert] = await tx.select().from(drivers).where(eq(drivers.fullName, 'Robert Arteaga'));
      await createExtraJob(tx, actorAs('dispatcher', u.id), { clientUuid: crypto.randomUUID(), service: 'pickup', date: '2026-09-05', nearRouteId: null, payee: { driverId: robert!.id }, clientAmountCents: null, driverAmountCents: 30_00, orderNumber: null, note: null });
      await createExtraJob(tx, actorAs('dispatcher', u.id), { clientUuid: crypto.randomUUID(), service: 'pickup', date: '2026-09-05', nearRouteId: null, payee: { driverId: robert!.id }, clientAmountCents: null, driverAmountCents: 30_00, orderNumber: 'TF-9', note: null });
      const r = await orderNumberReminders(tx, '2026-09-05');
      expect(r.recipients).toEqual([expect.objectContaining({ phone: '+19255550107', jobs: [expect.objectContaining({ service: 'Pickup' })] })]);
    }));
});
