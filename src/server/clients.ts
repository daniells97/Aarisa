import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Tx } from '~/db/client';
import { clientContacts, clients, operations, reportLayoutColumns, reportLayouts, revenueTypes, serviceTiers, serviceTypes } from '~/db/schema';
import { can } from '~/domain/permissions';
import { assertCan, type Actor } from './actor';
import { audit, type AuditEntry } from './audit';
import { RuleError } from './errors';
import { refreshWeeklyLines } from './settlements';
import { serviceCode } from './setup';

// Clients, their contacts and the rules of each contract (stage 6a of the redesign, docs/db-model.md §2.2).
// Anyone signed in reads them; only the owner edits. Where the driver comes from is fixed once a contract
// has work, so it is shown but not edited here.

export async function loadClients(tx: Tx, actor: Actor) {
  assertCan(actor, 'payroll.view');
  const rows = await tx.select().from(clients).orderBy(asc(clients.displayName));
  const contacts = await tx.select().from(clientContacts).where(eq(clientContacts.active, true)).orderBy(asc(clientContacts.role));
  const ops = await tx.select().from(operations).orderBy(asc(operations.name));
  const layouts = await tx.select().from(reportLayouts).where(eq(reportLayouts.active, true));
  const layoutCols = layouts.length ? await tx.select().from(reportLayoutColumns).where(inArray(reportLayoutColumns.layoutId, layouts.map((l) => l.id))).orderBy(asc(reportLayoutColumns.sortOrder)) : [];
  const services = await tx.select().from(serviceTypes).where(eq(serviceTypes.fromReport, true));
  const tiers = services.length ? await tx.select().from(serviceTiers).where(inArray(serviceTiers.serviceTypeId, services.map((x) => x.id))) : [];
  const revenue = await tx.select().from(revenueTypes);
  return {
    canEdit: can(actor.role, 'setup.edit'),
    clients: rows.map((c) => ({
      id: c.id, code: c.code, displayName: c.displayName, legalName: c.legalName, taxId: c.taxId, billingAddress: c.billingAddress,
      notes: c.notes, active: c.active,
      contacts: contacts.filter((x) => x.clientId === c.id).map((x) => ({ id: x.id, role: x.role, fullName: x.fullName, email: x.email, phone: x.phone, isPrimary: x.isPrimary })),
      contracts: ops.filter((o) => o.clientId === c.id).map((o) => ({
        id: o.id, code: o.code, name: o.name, driverSource: o.driverSource, payCycle: o.payCycle, paymentTermsDays: o.paymentTermsDays,
        blocksPayrollOnExceptions: o.blocksPayrollOnExceptions, lowQuantityThresholdBp: o.lowQuantityThresholdBp, active: o.active,
        weeklySettlementKind: o.weeklySettlementKind,
        // How its report is read, and the report services a quantity column can count for.
        layout: layoutCols.filter((col) => layouts.find((l) => l.id === col.layoutId)?.operationId === o.id).map((col) => ({
          sourceName: col.sourceName, meaning: col.meaning, required: col.required, serviceTypeId: col.serviceTypeId,
          service: services.find((x) => x.id === col.serviceTypeId)?.name ?? null,
          tierCode: tiers.find((x) => x.id === col.tierId)?.code ?? null,
          revenueName: revenue.find((x) => x.id === col.revenueTypeId)?.name ?? null,
        })),
        services: services.filter((x) => x.operationId === o.id).map((x) => ({ id: x.id, name: x.name, unit: x.unit })),
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
  if (before.paymentTermsDays !== input.paymentTermsDays) await refreshWeeklyLines(tx, actor, before.code);
  return after!;
}

// ---------- a new client, end to end (stage 6c: a client is configuration, not code) ----------

export interface NewClientInput {
  clientName: string;
  contractName: string;
  driverSource: 'report_code' | 'daily_list';
  payCycle: 'weekly' | 'biweekly';
  cycleAnchor: string; // first day of any pay period
  paymentTermsDays: number;
  weeklySettlementKind: 'invoice' | 'weekly_statement';
}

/** Code from a name: "Bay Parcel Ecom" → "bay_parcel_ecom". Codes never change once made. */
export const codeFrom = (name: string) => name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);

/** Creates the client and its contract with the rules it runs with. Its report layout comes next. */
export async function createClientWithContract(tx: Tx, actor: Actor, input: NewClientInput) {
  assertCan(actor, 'setup.edit');
  const clientName = input.clientName.trim(), contractName = input.contractName.trim() || clientName;
  if (!clientName) throw new RuleError('name_required');
  const clientCode = codeFrom(clientName), opCode = codeFrom(contractName);
  if (!clientCode || !opCode) throw new RuleError('name_required');
  if ((await tx.select({ id: clients.id }).from(clients).where(eq(clients.code, clientCode))).length) throw new RuleError('name_taken');
  if ((await tx.select({ id: operations.id }).from(operations).where(eq(operations.code, opCode))).length) throw new RuleError('name_taken');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.cycleAnchor)) throw new RuleError('invalid_date');
  if (!Number.isInteger(input.paymentTermsDays) || input.paymentTermsDays < 0 || input.paymentTermsDays > 365) throw new RuleError('invalid_terms');
  const [client] = await tx.insert(clients).values({ code: clientCode, displayName: clientName }).returning();
  const [op] = await tx.insert(operations).values({
    clientId: client!.id, code: opCode, name: contractName, driverSource: input.driverSource, payCycle: input.payCycle,
    cycleAnchor: input.cycleAnchor, paymentTermsDays: input.paymentTermsDays, weeklySettlementKind: input.weeklySettlementKind,
  }).returning();
  await audit(tx, [
    { table: 'clients', recordId: client!.id, action: 'insert', after: client, userId: actor.userId, source: actor.source },
    { table: 'operations', recordId: op!.id, action: 'insert', after: op, userId: actor.userId, source: actor.source },
  ]);
  return { clientId: client!.id, operationId: op!.id, operation: op!.code };
}

export type Meaning = typeof reportLayoutColumns.$inferInsert.meaning;

export interface LayoutColumnInput {
  sourceName: string;
  meaning: Meaning;
  required: boolean;
  /** For a quantity: an existing report service, or a new one to create. */
  serviceTypeId?: string | null;
  newService?: { name: string; unit: 'package' | 'stop' | 'piece' } | null;
  /** For a quantity: the tier of the service this column counts (created when new). */
  tierCode?: string | null;
  /** For other revenue: its name (STEM, fuel surcharge…); created for the contract when new. */
  revenueName?: string | null;
}

/**
 * Saves how a contract's report is read: the previous layout is kept but retired, the new one becomes
 * active. Services, tiers and revenue types a column names are created on the way. Audited.
 */
export async function saveLayout(tx: Tx, actor: Actor, operationId: string, columns: LayoutColumnInput[]) {
  assertCan(actor, 'setup.edit');
  const [op] = await tx.select().from(operations).where(eq(operations.id, operationId));
  if (!op) throw new RuleError('not_found');
  const used = columns.filter((c) => c.meaning !== 'ignore');
  const has = (m: Meaning) => used.some((c) => c.meaning === m);
  if (!has('work_date')) throw new RuleError('layout_needs_date');
  if (!has(op.driverSource === 'report_code' ? 'driver_code' : 'route_code')) throw new RuleError(op.driverSource === 'report_code' ? 'layout_needs_driver_code' : 'layout_needs_route');
  if (!has('quantity')) throw new RuleError('layout_needs_quantity');
  if (new Set(columns.map((c) => c.sourceName.trim().toLowerCase())).size !== columns.length) throw new RuleError('layout_duplicate_column');

  const trail: AuditEntry[] = [];
  const log = (table: string, row: { id: string }) => trail.push({ table, recordId: row.id, action: 'insert', after: row, userId: actor.userId, source: actor.source });
  const retired = await tx.update(reportLayouts).set({ active: false }).where(and(eq(reportLayouts.operationId, op.id), eq(reportLayouts.active, true))).returning();
  for (const r of retired) trail.push({ table: 'report_layouts', recordId: r.id, action: 'update', after: r, userId: actor.userId, source: actor.source });
  const [layout] = await tx.insert(reportLayouts).values({ operationId: op.id, name: `${op.name} report`, createdBy: actor.userId }).returning();
  log('report_layouts', layout!);

  for (const [i, c] of columns.entries()) {
    let serviceTypeId: string | null = null, tierId: string | null = null, revenueTypeId: string | null = null;
    if (c.meaning === 'quantity') {
      if (c.newService) {
        const name = c.newService.name.trim();
        if (!name) throw new RuleError('name_required');
        const code = serviceCode(name);
        const [existing] = await tx.select().from(serviceTypes).where(and(eq(serviceTypes.operationId, op.id), eq(serviceTypes.code, code)));
        const [svc] = existing ? [existing] : await tx.insert(serviceTypes).values({ operationId: op.id, code, name, unit: c.newService.unit, fromReport: true }).returning();
        if (!existing) log('service_types', svc!);
        serviceTypeId = svc!.id;
      } else {
        const [svc] = c.serviceTypeId ? await tx.select().from(serviceTypes).where(and(eq(serviceTypes.id, c.serviceTypeId), eq(serviceTypes.operationId, op.id))) : [];
        if (!svc) throw new RuleError('layout_needs_service');
        serviceTypeId = svc.id;
      }
      const tierCode = c.tierCode?.trim().toUpperCase();
      if (tierCode) {
        const [existing] = await tx.select().from(serviceTiers).where(and(eq(serviceTiers.serviceTypeId, serviceTypeId), eq(serviceTiers.code, tierCode)));
        const count = (await tx.select({ id: serviceTiers.id }).from(serviceTiers).where(eq(serviceTiers.serviceTypeId, serviceTypeId))).length;
        const [tier] = existing ? [existing] : await tx.insert(serviceTiers).values({ serviceTypeId, code: tierCode, name: c.tierCode!.trim(), sortOrder: count + 1 }).returning();
        if (!existing) log('service_tiers', tier!);
        tierId = tier!.id;
      }
    }
    if (c.meaning === 'other_revenue') {
      const name = c.revenueName?.trim() || c.sourceName.trim();
      const code = serviceCode(name);
      const [existing] = await tx.select().from(revenueTypes).where(and(eq(revenueTypes.operationId, op.id), eq(revenueTypes.code, code)));
      const [rt] = existing ? [existing] : await tx.insert(revenueTypes).values({ operationId: op.id, code, name }).returning();
      if (!existing) log('revenue_types', rt!);
      revenueTypeId = rt!.id;
    }
    const [col] = await tx.insert(reportLayoutColumns).values({
      layoutId: layout!.id, sourceName: c.sourceName.trim(), meaning: c.meaning, required: c.meaning !== 'ignore' && c.required, sortOrder: i,
      serviceTypeId, tierId, revenueTypeId,
    }).returning();
    log('report_layout_columns', col!);
  }
  await audit(tx, trail);
  return layout!;
}
