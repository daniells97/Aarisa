import { and, asc, eq } from 'drizzle-orm';
import type { Tx } from '~/db/client';
import { clientContacts, clients, operations } from '~/db/schema';
import { can } from '~/domain/permissions';
import { assertCan, type Actor } from './actor';
import { audit } from './audit';
import { RuleError } from './errors';
import { refreshWeeklyLines } from './settlements';

// Clients, their contacts and the rules of each contract (stage 6a of the redesign, docs/db-model.md §2.2).
// Anyone signed in reads them; only the owner edits. Where the driver comes from is fixed once a contract
// has work, so it is shown but not edited here.

export async function loadClients(tx: Tx, actor: Actor) {
  assertCan(actor, 'payroll.view');
  const rows = await tx.select().from(clients).orderBy(asc(clients.displayName));
  const contacts = await tx.select().from(clientContacts).where(eq(clientContacts.active, true)).orderBy(asc(clientContacts.role));
  const ops = await tx.select().from(operations).orderBy(asc(operations.name));
  return {
    canEdit: can(actor.role, 'setup.edit'),
    clients: rows.map((c) => ({
      id: c.id, code: c.code, displayName: c.displayName, legalName: c.legalName, taxId: c.taxId, billingAddress: c.billingAddress,
      notes: c.notes, active: c.active,
      contacts: contacts.filter((x) => x.clientId === c.id).map((x) => ({ id: x.id, role: x.role, fullName: x.fullName, email: x.email, phone: x.phone, isPrimary: x.isPrimary })),
      contracts: ops.filter((o) => o.clientId === c.id).map((o) => ({
        id: o.id, code: o.code, name: o.name, driverSource: o.driverSource, payCycle: o.payCycle, paymentTermsDays: o.paymentTermsDays,
        blocksPayrollOnExceptions: o.blocksPayrollOnExceptions, lowQuantityThresholdBp: o.lowQuantityThresholdBp, active: o.active,
      })),
    })),
  };
}

export interface ClientInput { displayName: string; legalName: string | null; taxId: string | null; billingAddress: string | null; notes: string | null }

const blank = (v: string | null) => v?.trim() || null;

export async function updateClient(tx: Tx, actor: Actor, id: string, input: ClientInput) {
  assertCan(actor, 'setup.edit');
  const [before] = await tx.select().from(clients).where(eq(clients.id, id));
  if (!before) throw new RuleError('not_found');
  const displayName = input.displayName.trim();
  if (!displayName) throw new RuleError('name_required');
  const [after] = await tx.update(clients).set({
    displayName, legalName: blank(input.legalName), taxId: blank(input.taxId), billingAddress: blank(input.billingAddress), notes: blank(input.notes), updatedAt: new Date(),
  }).where(eq(clients.id, id)).returning();
  await audit(tx, { table: 'clients', recordId: id, action: 'update', before, after, userId: actor.userId, source: actor.source });
  return after!;
}

export interface ContactInput {
  clientId: string; role: 'billing' | 'claims' | 'operations' | 'other';
  fullName: string | null; email: string | null; phone: string | null; isPrimary: boolean;
}

/** Adds or edits a contact. Making one primary for its role takes that place from the previous primary. */
export async function saveContact(tx: Tx, actor: Actor, id: string | null, input: ContactInput) {
  assertCan(actor, 'setup.edit');
  const email = blank(input.email)?.toLowerCase() ?? null;
  const phone = blank(input.phone);
  if (!email && !phone) throw new RuleError('contact_unreachable');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new RuleError('invalid_email');
  const [client] = await tx.select({ id: clients.id }).from(clients).where(eq(clients.id, input.clientId));
  if (!client) throw new RuleError('not_found');
  if (input.isPrimary) {
    const previous = await tx.update(clientContacts).set({ isPrimary: false, updatedAt: new Date() })
      .where(and(eq(clientContacts.clientId, input.clientId), eq(clientContacts.role, input.role), eq(clientContacts.isPrimary, true))).returning();
    for (const p of previous) if (p.id !== id) await audit(tx, { table: 'client_contacts', recordId: p.id, action: 'update', after: p, userId: actor.userId, source: actor.source });
  }
  const values = { clientId: input.clientId, role: input.role, fullName: blank(input.fullName), email, phone, isPrimary: input.isPrimary, updatedAt: new Date() };
  if (id) {
    const [before] = await tx.select().from(clientContacts).where(eq(clientContacts.id, id));
    if (!before) throw new RuleError('not_found');
    const [after] = await tx.update(clientContacts).set(values).where(eq(clientContacts.id, id)).returning();
    await audit(tx, { table: 'client_contacts', recordId: id, action: 'update', before, after, userId: actor.userId, source: actor.source });
    return after!;
  }
  const [row] = await tx.insert(clientContacts).values(values).returning();
  await audit(tx, { table: 'client_contacts', recordId: row!.id, action: 'insert', after: row, userId: actor.userId, source: actor.source });
  return row!;
}

/** Contacts are never deleted (claims point at them); removing one makes it inactive. */
export async function removeContact(tx: Tx, actor: Actor, id: string) {
  assertCan(actor, 'setup.edit');
  const [before] = await tx.select().from(clientContacts).where(eq(clientContacts.id, id));
  if (!before) throw new RuleError('not_found');
  const [after] = await tx.update(clientContacts).set({ active: false, isPrimary: false, updatedAt: new Date() }).where(eq(clientContacts.id, id)).returning();
  await audit(tx, { table: 'client_contacts', recordId: id, action: 'update', before, after, userId: actor.userId, source: actor.source });
  return after!;
}

export interface ContractRules { paymentTermsDays: number; blocksPayrollOnExceptions: boolean; lowQuantityThresholdBp: number }

/** The rules of a contract that used to be written in code. Audited; they apply from the next calculation. */
export async function updateContractRules(tx: Tx, actor: Actor, id: string, input: ContractRules) {
  assertCan(actor, 'setup.edit');
  const [before] = await tx.select().from(operations).where(eq(operations.id, id));
  if (!before) throw new RuleError('not_found');
  if (!Number.isInteger(input.paymentTermsDays) || input.paymentTermsDays < 0 || input.paymentTermsDays > 365) throw new RuleError('invalid_terms');
  if (!Number.isInteger(input.lowQuantityThresholdBp) || input.lowQuantityThresholdBp < 0 || input.lowQuantityThresholdBp > 10_000) throw new RuleError('invalid_threshold');
  const [after] = await tx.update(operations).set({ ...input, updatedAt: new Date() }).where(eq(operations.id, id)).returning();
  await audit(tx, { table: 'operations', recordId: id, action: 'update', before, after, userId: actor.userId, source: actor.source });
  // New terms move the expected date of what the client hasn't paid yet.
  if (before.paymentTermsDays !== input.paymentTermsDays) await refreshWeeklyLines(tx, actor, before.code as 'hovership' | 'tforce');
  return after!;
}
