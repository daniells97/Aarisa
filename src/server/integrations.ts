import { timingSafeEqual } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Tx } from '~/db/client';
import { aiSuggestions, contractors, drivers, extraJobs, messages, routes, serviceTypes, users } from '~/db/schema';
import { can, isRole } from '~/domain/permissions';
import { isLocale } from '~/i18n';
import type { Actor } from './actor';
import { assertCan } from './actor';
import { audit } from './audit';
import { confirmUsual, loadDay, setAssignment, setUnknownName } from './daily';
import { RuleError } from './errors';
import { EXTRA_SERVICES } from './extra-jobs';
import { getOperation } from './ops';
import { seal, unseal } from './session';
import { recheckForDate } from './tforce';

// Integration API for n8n (docs/integrations.md). n8n moves messages and calls the AI; the portal owns
// the data and the rules. Every call is idempotent on its natural key and audited as whatsapp/email-import.

export const MIN_CONFIDENCE = 0.85;

/** Bearer token check against N8N_SERVICE_TOKEN, in constant time. */
export function serviceTokenValid(header: string | null | undefined, token = process.env.N8N_SERVICE_TOKEN) {
  if (!token || token.length < 32 || !header?.startsWith('Bearer ')) return false;
  const a = Buffer.from(header.slice(7));
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const normalizePhone = (p: string) => p.replace(/[^\d+]/g, '').replace(/^(?!\+)/, '+');

/** The portal user behind a WhatsApp number, acting with their own role (rule 9 applies to WhatsApp too). */
export async function actorForPhone(tx: Tx, phone: string): Promise<Actor | null> {
  const wanted = normalizePhone(phone);
  const rows = await tx.select().from(users).where(eq(users.active, true));
  const u = rows.find((r) => r.phone && normalizePhone(r.phone) === wanted);
  if (!u || !isRole(u.role)) return null;
  return { userId: u.id, role: u.role, name: u.name, locale: isLocale(u.locale) ? u.locale : 'en', source: 'whatsapp' };
}

export const messageInput = z.object({
  waMessageId: z.string().max(200).nullable().optional(),
  direction: z.enum(['in', 'out']),
  phone: z.string().min(5).max(30),
  type: z.enum(['text', 'audio', 'interactive', 'template']),
  body: z.string().max(10_000).nullable().optional(),
  mediaUrl: z.string().url().max(1000).nullable().optional(),
  transcript: z.string().max(10_000).nullable().optional(),
  relatedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

/** Logs a WhatsApp message once per WhatsApp message id. */
export async function logMessage(tx: Tx, input: z.infer<typeof messageInput>) {
  if (input.waMessageId) {
    const [existing] = await tx.select().from(messages).where(eq(messages.waMessageId, input.waMessageId));
    if (existing) return existing;
  }
  const sender = input.direction === 'in' ? await actorForPhone(tx, input.phone) : null;
  const [row] = await tx.insert(messages).values({
    waMessageId: input.waMessageId ?? null, direction: input.direction, phone: normalizePhone(input.phone), userId: sender?.userId ?? null,
    type: input.type, body: input.body ?? null, mediaUrl: input.mediaUrl ?? null, transcript: input.transcript ?? null, relatedDate: input.relatedDate ?? null,
  }).returning();
  await audit(tx, { table: 'messages', recordId: row!.id, action: 'insert', after: row, userId: sender?.userId ?? null, source: 'whatsapp' });
  return row!;
}

/** Routes with the proposed (or already set) payee for a date, for the 6:30 AM template. No money. */
export async function morningList(tx: Tx, date: string) {
  const day = await loadDay(tx, { userId: null, role: 'viewer', name: 'n8n', locale: 'en', source: 'whatsapp' }, date);
  return {
    date,
    routes: day.rows.map((r) => ({ route: r.code, driver: r.today.name, usual: r.usual.name, status: r.status, contractorRoute: r.contractorRoute })),
    recipients: (await tx.select({ name: users.name, phone: users.phone, locale: users.locale, role: users.role }).from(users)
      .where(and(eq(users.active, true), eq(users.morningChannel, 'whatsapp'))))
      .filter((u) => u.phone && (u.role === 'owner' || u.role === 'dispatcher')),
  };
}

// --- AI output contracts (validated here; invalid output is treated as "needs you", never applied) ---

export const dailyChangesOutput = z.object({
  confirm_all: z.boolean().optional(),
  changes: z.array(z.object({
    route: z.string().min(1).max(20),
    driver_name: z.string().max(120).nullable(),
    matched_driver_id: z.string().uuid().nullable().optional(),
    matched_contractor_id: z.string().uuid().nullable().optional(),
    contractor_hint: z.string().max(120).nullable().optional(),
    confidence: z.number().min(0).max(1).optional(),
  })).max(60).default([]),
});

export const dailyChangesInput = z.object({
  phone: z.string().min(5).max(30),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  messageId: z.string().uuid().nullable().optional(),
  inputText: z.string().min(1).max(10_000),
  model: z.string().min(1).max(100),
  output: z.unknown(),
});

type Unresolved = { route: string; name: string | null; reason: 'unknown_route' | 'unknown_name' | 'low_confidence' | 'invalid_output' };

/** Applies what the AI read from a WhatsApp reply. Known people with high confidence are applied; the rest is asked back. */
export async function applyDailyChanges(tx: Tx, input: z.infer<typeof dailyChangesInput>) {
  const actor = await actorForPhone(tx, input.phone);
  if (!actor) throw new RuleError('unknown_phone');
  assertCan(actor, 'drivers.confirm_today');
  const parsed = dailyChangesOutput.safeParse(input.output);
  const [suggestion] = await tx.insert(aiSuggestions).values({
    kind: 'daily_changes', messageId: input.messageId ?? null, inputText: input.inputText, model: input.model,
    output: (input.output ?? {}) as object, status: 'pending',
  }).returning();
  await audit(tx, { table: 'ai_suggestions', recordId: suggestion!.id, action: 'insert', after: suggestion, userId: actor.userId, source: 'whatsapp' });
  if (!parsed.success) {
    return { suggestionId: suggestion!.id, confirmedAll: 0, applied: [], unresolved: [{ route: '', name: null, reason: 'invalid_output' as const }] };
  }

  const op = await getOperation(tx, 'tforce');
  const routeRows = await tx.select().from(routes).where(eq(routes.operationId, op.id));
  const driverIds = new Set((await tx.select({ id: drivers.id }).from(drivers).where(eq(drivers.active, true))).map((d) => d.id));
  const contractorIds = new Set((await tx.select({ id: contractors.id }).from(contractors)).map((c) => c.id));
  const applied: { route: string; name: string | null }[] = [];
  const unresolved: Unresolved[] = [];

  let confirmedAll = 0;
  for (const c of parsed.data.changes) {
    const route = routeRows.find((r) => r.code.toUpperCase() === c.route.toUpperCase() || r.code.toUpperCase().endsWith(c.route.toUpperCase()));
    if (!route) { unresolved.push({ route: c.route, name: c.driver_name, reason: 'unknown_route' }); continue; }
    const confident = (c.confidence ?? 0) >= MIN_CONFIDENCE;
    const payee = c.matched_driver_id && driverIds.has(c.matched_driver_id) ? { driverId: c.matched_driver_id }
      : c.matched_contractor_id && contractorIds.has(c.matched_contractor_id) ? { contractorId: c.matched_contractor_id } : null;
    if (payee && confident) {
      await setAssignment(tx, actor, { date: input.date, routeId: route.id, payee });
      applied.push({ route: route.code, name: c.driver_name });
    } else if (!payee && c.driver_name) {
      // Unknown name: record it on the route so Today's drivers asks "who drove it?".
      await setUnknownName(tx, actor, { date: input.date, routeId: route.id, rawName: c.driver_name });
      unresolved.push({ route: route.code, name: c.driver_name, reason: 'unknown_name' });
    } else {
      unresolved.push({ route: route.code, name: c.driver_name, reason: 'low_confidence' });
    }
  }
  // "All good" confirms everything still on its usual driver, after the specific changes.
  if (parsed.data.confirm_all) confirmedAll = await confirmUsual(tx, actor, input.date);
  await recheckForDate(tx, actor, input.date);

  const status = unresolved.length === 0 ? 'applied' : applied.length || confirmedAll ? 'partially_applied' : 'pending';
  const [after] = await tx.update(aiSuggestions).set({ status, confirmedBy: actor.userId, confirmedAt: new Date() }).where(eq(aiSuggestions.id, suggestion!.id)).returning();
  await audit(tx, { table: 'ai_suggestions', recordId: suggestion!.id, action: 'update', before: suggestion, after, userId: actor.userId, source: 'whatsapp' });
  return { suggestionId: suggestion!.id, confirmedAll, applied, unresolved };
}

export const extraJobOutput = z.object({
  service: z.enum(EXTRA_SERVICES).nullable(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  near_route: z.string().max(20).nullable().optional(),
  driver_id: z.string().uuid().nullable().optional(),
  contractor_id: z.string().uuid().nullable().optional(),
  payee_name: z.string().max(120).nullable().optional(),
  client_amount: z.number().nonnegative().nullable().optional(), // dollars, as said; never guessed
  driver_amount: z.number().nonnegative().nullable().optional(),
  order_number: z.string().max(60).nullable().optional(),
  note: z.string().max(500).nullable().optional(),
  missing: z.array(z.string()).default([]),
});

export const extraJobDraftInput = z.object({
  phone: z.string().min(5).max(30),
  messageId: z.string().uuid().nullable().optional(),
  inputText: z.string().min(1).max(10_000),
  model: z.string().min(1).max(100),
  output: z.unknown(),
});

export const DRAFT_TTL = 60 * 60 * 24; // the "Review and save" link works for 24 hours

/** Stores an AI draft of an extra job and returns the signed link that opens the pre-filled form. Nothing is saved as a job. */
export async function createExtraJobDraft(tx: Tx, input: z.infer<typeof extraJobDraftInput>, baseUrl = process.env.APP_BASE_URL ?? '') {
  const actor = await actorForPhone(tx, input.phone);
  if (!actor) throw new RuleError('unknown_phone');
  assertCan(actor, 'extra_jobs.log');
  const parsed = extraJobOutput.safeParse(input.output);
  const [s] = await tx.insert(aiSuggestions).values({
    kind: 'extra_job', messageId: input.messageId ?? null, inputText: input.inputText, model: input.model,
    output: (parsed.success ? parsed.data : { invalid: true, raw: input.output ?? null }) as object, status: 'pending',
  }).returning();
  await audit(tx, { table: 'ai_suggestions', recordId: s!.id, action: 'insert', after: s, userId: actor.userId, source: 'whatsapp' });
  const token = seal({ sid: s!.id, uid: actor.userId }, DRAFT_TTL);
  return { suggestionId: s!.id, valid: parsed.success, missing: parsed.success ? parsed.data.missing : ['everything'], link: `${baseUrl.replace(/\/$/, '')}/extra-jobs/new?draft=${encodeURIComponent(token)}` };
}

/** Opens a draft for the signed-in person who received the link. Returns the fields to pre-fill (green in the form). */
export async function loadExtraJobDraft(tx: Tx, actor: Actor, token: string) {
  assertCan(actor, 'extra_jobs.log');
  const payload = unseal<{ sid: string; uid: string | null }>(token);
  if (!payload) throw new RuleError('draft_expired');
  const [s] = await tx.select().from(aiSuggestions).where(eq(aiSuggestions.id, payload.sid));
  if (!s || s.kind !== 'extra_job') throw new RuleError('not_found');
  if (s.status !== 'pending') throw new RuleError('draft_used');
  const out = extraJobOutput.safeParse(s.output);
  const msg = s.messageId ? (await tx.select().from(messages).where(eq(messages.id, s.messageId)))[0] : undefined;
  const op = await getOperation(tx, 'tforce');
  const route = out.success && out.data.near_route
    ? (await tx.select().from(routes).where(eq(routes.operationId, op.id))).find((r) => r.code.toUpperCase().endsWith(out.data.near_route!.toUpperCase()))
    : undefined;
  const showMoney = can(actor.role, 'money.view');
  const d = out.success ? out.data : null;
  return {
    suggestionId: s.id,
    fromVoice: msg?.type === 'audio',
    at: (msg?.createdAt ?? s.createdAt).toISOString(),
    fields: {
      service: d?.service ?? null,
      date: d?.date ?? null,
      nearRouteId: route?.id ?? null,
      payee: d?.driver_id ? `d:${d.driver_id}` : d?.contractor_id ? `c:${d.contractor_id}` : null,
      clientAmountCents: showMoney && d?.client_amount != null ? Math.round(d.client_amount * 100) : null,
      driverAmountCents: d?.driver_amount != null ? Math.round(d.driver_amount * 100) : null,
      orderNumber: d?.order_number ?? null,
      note: d?.note ?? null,
    },
    missing: d?.missing ?? [],
  };
}

/** Marks a draft as confirmed by the person who tapped Save (rule 5). */
export async function confirmExtraJobDraft(tx: Tx, actor: Actor, suggestionId: string) {
  const [before] = await tx.select().from(aiSuggestions).where(eq(aiSuggestions.id, suggestionId));
  if (!before || before.status !== 'pending') throw new RuleError('draft_used');
  const [after] = await tx.update(aiSuggestions).set({ status: 'applied', confirmedBy: actor.userId, confirmedAt: new Date() }).where(eq(aiSuggestions.id, suggestionId)).returning();
  await audit(tx, { table: 'ai_suggestions', recordId: suggestionId, action: 'update', before, after, userId: actor.userId, source: actor.source });
}

/** What the AI needs to match names: routes, people with aliases, contractors, services. No money. */
export async function aiContext(tx: Tx, date: string) {
  const op = await getOperation(tx, 'tforce');
  const day = await morningList(tx, date);
  const people = await tx.select({ id: drivers.id, name: drivers.fullName, aliases: drivers.aliases, contractorId: drivers.contractorId }).from(drivers).where(eq(drivers.active, true));
  const companies = await tx.select({ id: contractors.id, name: contractors.name }).from(contractors).where(eq(contractors.active, true));
  return {
    date,
    routes: day.routes,
    drivers: people.map((p) => ({ id: p.id, name: p.name, aliases: p.aliases, contractor: companies.find((c) => c.id === p.contractorId)?.name ?? null })),
    contractors: companies,
    services: [...EXTRA_SERVICES],
    operation: op.code,
  };
}

/** 7 PM reminder: extra jobs saved on `date` without an order number, grouped by the phone of who saved them. */
export async function orderNumberReminders(tx: Tx, date: string) {
  const rows = await tx.select({ id: extraJobs.id, orderNumber: extraJobs.orderNumber, service: serviceTypes.name, phone: users.phone, name: users.name, locale: users.locale })
    .from(extraJobs).innerJoin(serviceTypes, eq(serviceTypes.id, extraJobs.serviceTypeId)).leftJoin(users, eq(users.id, extraJobs.createdBy))
    .where(eq(extraJobs.date, date));
  const byPhone = new Map<string, { phone: string; name: string; locale: string; jobs: { id: string; service: string }[] }>();
  for (const r of rows) {
    if (r.orderNumber || !r.phone) continue;
    const entry = byPhone.get(r.phone) ?? { phone: r.phone, name: r.name ?? '', locale: r.locale ?? 'en', jobs: [] };
    entry.jobs.push({ id: r.id, service: r.service });
    byPhone.set(r.phone, entry);
  }
  return { date, recipients: [...byPhone.values()] };
}
