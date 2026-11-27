import { and, asc, eq, inArray, isNull, lte, or, gte, sql } from 'drizzle-orm';
import type { Tx } from '~/db/client';
import {
  contractors, driverAffiliations, driverAliases, driverClientCodes, drivers, operations, payees, routeOwnerships, routes,
} from '~/db/schema';
import { addDays } from '~/domain/dates';
import type { Actor } from './actor';
import { audit } from './audit';
import { RuleError } from './errors';

// Drivers, contractors and route owners after the payee redesign (docs/db-model.md §2.3, §2.4).
// A driver's name, phone and active flag live in `payees`; the company in `driver_affiliations`;
// the Hovership code in `driver_client_codes`; WhatsApp names in `driver_aliases`. These helpers put
// a driver back together as one profile, so screens and rules read one shape.
// `contractorId` in a profile is null for Aarisa's own drivers and routes, as before.

/** History rows start here when nothing older is known (first client data is June 2026). */
export const HISTORY_START = '2026-01-01';

export interface DriverProfile {
  id: string;
  payeeId: string;
  fullName: string;
  contractorId: string | null;
  hovershipCode: string | null;
  phone: string | null;
  aliases: string[];
  active: boolean;
  setupComplete: boolean;
  worksTforce: boolean;
  worksHovership: boolean;
  email: string | null;
  address: string | null;
  licenseNumber: string | null;
  emergencyName: string | null;
  emergencyPhone: string | null;
}

export interface ContractorProfile {
  id: string;
  payeeId: string;
  name: string;
  active: boolean;
  isOwnCompany: boolean;
  payTrigger: 'payroll' | 'on_collection';
}

const validOn = (from: typeof driverAffiliations.validFrom, to: typeof driverAffiliations.validTo, on: string) =>
  and(lte(from, on), or(isNull(to), gte(to, on)));

/** The one contractor row that stands for Aarisa itself. */
export async function ownCompanyId(tx: Tx): Promise<string> {
  const [own] = await tx.select({ id: contractors.id }).from(contractors).where(eq(contractors.isOwnCompany, true));
  if (!own) throw new Error('Aarisa is missing from contractors (is_own_company)');
  return own.id;
}

async function hovershipOperationId(tx: Tx): Promise<string | null> {
  const [op] = await tx.select({ id: operations.id }).from(operations).where(eq(operations.code, 'hovership'));
  return op?.id ?? null;
}

/** Every driver (or the given ones) as one profile, as of `on`. Sorted by name. */
export async function driverProfiles(tx: Tx, on: string, ids?: string[]): Promise<DriverProfile[]> {
  if (ids && ids.length === 0) return [];
  const rows = await tx.select({ d: drivers, p: payees }).from(drivers).innerJoin(payees, eq(payees.id, drivers.payeeId))
    .where(ids ? inArray(drivers.id, ids) : undefined).orderBy(asc(payees.displayName));
  if (!rows.length) return [];
  const driverIds = rows.map((r) => r.d.id);
  const own = await ownCompanyId(tx);
  const hov = await hovershipOperationId(tx);
  const affs = await tx.select().from(driverAffiliations)
    .where(and(inArray(driverAffiliations.driverId, driverIds), validOn(driverAffiliations.validFrom, driverAffiliations.validTo, on)));
  const codes = hov ? await tx.select().from(driverClientCodes)
    .where(and(inArray(driverClientCodes.driverId, driverIds), eq(driverClientCodes.operationId, hov), isNull(driverClientCodes.validTo))) : [];
  const aliases = await tx.select().from(driverAliases).where(inArray(driverAliases.driverId, driverIds)).orderBy(asc(driverAliases.aliasText));
  const aff = new Map(affs.map((a) => [a.driverId, a.contractorId]));
  const code = new Map(codes.map((c) => [c.driverId, c.driverCode]));
  return rows.map(({ d, p }) => {
    const c = aff.get(d.id) ?? own;
    return {
      id: d.id, payeeId: p.id, fullName: p.displayName, contractorId: c === own ? null : c,
      hovershipCode: code.get(d.id) ?? null, phone: p.phone,
      aliases: aliases.filter((a) => a.driverId === d.id).map((a) => a.aliasText),
      active: p.active, setupComplete: d.setupComplete, worksTforce: d.worksTforce, worksHovership: d.worksHovership,
      email: p.email, address: p.postalAddress, licenseNumber: d.licenseNumber,
      emergencyName: d.emergencyContactName, emergencyPhone: d.emergencyContactPhone,
    };
  });
}

export async function driverProfile(tx: Tx, id: string, on: string): Promise<DriverProfile | null> {
  return (await driverProfiles(tx, on, [id]))[0] ?? null;
}

/** Contractors as one profile each. Aarisa itself is left out unless asked for. */
export async function contractorProfiles(tx: Tx, opts: { includeOwn?: boolean; ids?: string[] } = {}): Promise<ContractorProfile[]> {
  if (opts.ids && opts.ids.length === 0) return [];
  const rows = await tx.select({ c: contractors, p: payees }).from(contractors).innerJoin(payees, eq(payees.id, contractors.payeeId))
    .where(and(opts.includeOwn ? undefined : eq(contractors.isOwnCompany, false), opts.ids ? inArray(contractors.id, opts.ids) : undefined))
    .orderBy(asc(payees.displayName));
  return rows.map(({ c, p }) => ({ id: c.id, payeeId: p.id, name: p.displayName, active: p.active, isOwnCompany: c.isOwnCompany, payTrigger: c.payTrigger }));
}

/** Driver id for a client's driver code (Hovership DriverCode), current codes only. */
export async function driverIdsByCode(tx: Tx, operationId: string): Promise<Map<string, string>> {
  const rows = await tx.select().from(driverClientCodes).where(and(eq(driverClientCodes.operationId, operationId), isNull(driverClientCodes.validTo)));
  return new Map(rows.map((r) => [r.driverCode, r.driverId]));
}

/** Owner of each route on `on`: the contractor id, or null when Aarisa owns it. */
export async function routeOwners(tx: Tx, on: string, routeIds?: string[]): Promise<Map<string, string | null>> {
  if (routeIds && routeIds.length === 0) return new Map();
  const own = await ownCompanyId(tx);
  const rows = await tx.select().from(routeOwnerships)
    .where(and(lte(routeOwnerships.effectiveFrom, on), routeIds ? inArray(routeOwnerships.routeId, routeIds) : undefined))
    .orderBy(asc(routeOwnerships.effectiveFrom));
  const owner = new Map<string, string | null>();
  for (const r of rows) owner.set(r.routeId, r.contractorId === own ? null : r.contractorId); // later rows win
  return owner;
}

const cleanAlias = (a: string) => a.trim().replace(/\s+/g, ' ').toLowerCase();

export interface DriverInput {
  fullName: string;
  hovershipCode: string | null;
  contractorId: string | null;
  phone: string | null;
  aliases: string[];
  active: boolean;
  /** Platforms the person works on. Left out: kept on edit; on create, Hovership when there is a Hovership code, else T-Force. */
  worksTforce?: boolean;
  worksHovership?: boolean;
  /** Contact details. Left out on edit: kept as they were. */
  email?: string | null;
  address?: string | null;
  licenseNumber?: string | null;
  emergencyName?: string | null;
  emergencyPhone?: string | null;
}

/**
 * One way to write a phone, so the same number can't be saved twice in different shapes:
 * "+1 (415) 555-0101", "415 555 0101" and "+14155550101" are all +14155550101 (10 digits = US/Canada).
 */
export function normalizePhone(p: string | null | undefined): string | null {
  const raw = p?.trim();
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  if (raw.startsWith('+')) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return `+${digits}`;
}

/** A name compared without case, extra spaces or accents: "José  Pérez" is "jose perez". */
const nameKey = (col: unknown) => sql`lower(regexp_replace(translate(${col}, 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN'), '[[:space:]]+', ' ', 'g'))`;
const plainName = (n: string) => n.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

const opt = (v: string | null | undefined) => (v === undefined ? undefined : v?.trim().replace(/\s+/g, ' ') || null);

function clean(input: DriverInput) {
  // undefined = not sent (keep), null = cleared.
  const email = opt(input.email) && opt(input.email)!.toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new RuleError('email_invalid');
  const license = opt(input.licenseNumber);
  return {
    email, address: opt(input.address), licenseNumber: license && license.toUpperCase(),
    emergencyName: opt(input.emergencyName), emergencyPhone: opt(input.emergencyPhone),
    fullName: input.fullName.trim().replace(/\s+/g, ' '),
    hovershipCode: input.hovershipCode?.trim().toUpperCase() || null,
    contractorId: input.contractorId || null,
    phone: normalizePhone(input.phone),
    aliases: [...new Set(input.aliases.map(cleanAlias).filter(Boolean))],
    active: input.active,
  };
}

async function assertContractor(tx: Tx, id: string | null) {
  if (!id) return;
  const [c] = await tx.select({ own: contractors.isOwnCompany }).from(contractors).where(eq(contractors.id, id));
  if (!c) throw new RuleError('not_found');
}

async function assertNameFree(tx: Tx, name: string, exceptPayeeId?: string) {
  const [same] = await tx.select({ id: payees.id }).from(payees)
    .where(and(eq(payees.payeeType, 'driver'), eq(payees.active, true), sql`${nameKey(payees.displayName)} = ${plainName(name)}`));
  if (same && same.id !== exceptPayeeId) throw new RuleError('driver_exists');
}

async function assertCodeFree(tx: Tx, operationId: string, code: string | null, exceptDriverId?: string) {
  if (!code) return;
  const [other] = await tx.select({ driverId: driverClientCodes.driverId }).from(driverClientCodes)
    .where(and(eq(driverClientCodes.operationId, operationId), eq(driverClientCodes.driverCode, code)));
  if (other && other.driverId !== exceptDriverId) throw new RuleError('code_taken');
}

async function assertAliasesFree(tx: Tx, aliases: string[], exceptDriverId?: string) {
  if (!aliases.length) return;
  const taken = await tx.select().from(driverAliases).where(inArray(driverAliases.aliasText, aliases));
  if (taken.some((t) => t.driverId !== exceptDriverId)) throw new RuleError('alias_taken');
}

async function assertEmailFree(tx: Tx, email: string | null | undefined, exceptPayeeId?: string) {
  if (!email) return;
  const [other] = await tx.select({ id: payees.id }).from(payees).where(and(eq(payees.payeeType, 'driver'), sql`lower(${payees.email}) = ${email}`));
  if (other && other.id !== exceptPayeeId) throw new RuleError('driver_email_taken');
}

async function assertLicenseFree(tx: Tx, license: string | null | undefined, exceptDriverId?: string) {
  if (!license) return;
  const [other] = await tx.select({ id: drivers.id }).from(drivers).where(sql`upper(${drivers.licenseNumber}) = ${license}`);
  if (other && other.id !== exceptDriverId) throw new RuleError('license_taken');
}

async function assertPhoneFree(tx: Tx, phone: string | null, exceptPayeeId?: string) {
  if (!phone) return;
  const [other] = await tx.select({ id: payees.id }).from(payees).where(eq(payees.phone, phone));
  if (other && other.id !== exceptPayeeId) throw new RuleError('phone_taken');
}

/** Creates the payee, the driver, the company link, the Hovership code and the aliases in one go. */
export async function createDriver(tx: Tx, actor: Actor, input: DriverInput & { setupComplete: boolean }, today: string) {
  const v = clean(input);
  if (!v.fullName) throw new RuleError('name_required');
  await assertNameFree(tx, v.fullName);
  await assertContractor(tx, v.contractorId);
  const hov = await hovershipOperationId(tx);
  if (hov) await assertCodeFree(tx, hov, v.hovershipCode);
  await assertAliasesFree(tx, v.aliases);
  await assertPhoneFree(tx, v.phone);
  await assertEmailFree(tx, v.email);
  await assertLicenseFree(tx, v.licenseNumber);
  const [payee] = await tx.insert(payees).values({
    payeeType: 'driver', displayName: v.fullName, phone: v.phone, active: v.active, email: v.email ?? null, postalAddress: v.address ?? null,
  }).returning();
  const [driver] = await tx.insert(drivers).values({
    payeeId: payee!.id, setupComplete: input.setupComplete,
    licenseNumber: v.licenseNumber ?? null, emergencyContactName: v.emergencyName ?? null, emergencyContactPhone: v.emergencyPhone ?? null,
    worksTforce: input.worksTforce ?? !v.hovershipCode, worksHovership: input.worksHovership ?? !!v.hovershipCode,
  }).returning();
  const id = driver!.id;
  await tx.insert(driverAffiliations).values({ driverId: id, contractorId: v.contractorId ?? (await ownCompanyId(tx)), validFrom: HISTORY_START });
  if (hov && v.hovershipCode) await tx.insert(driverClientCodes).values({ driverId: id, operationId: hov, driverCode: v.hovershipCode, validFrom: HISTORY_START });
  if (v.aliases.length) await tx.insert(driverAliases).values(v.aliases.map((aliasText) => ({ driverId: id, aliasText })));
  const after = (await driverProfile(tx, id, today))!;
  await audit(tx, { table: 'drivers', recordId: id, action: 'insert', after, userId: actor.userId, source: actor.source });
  return after;
}

/**
 * Edits a driver. A change of company closes the current link yesterday and opens a new one today,
 * so past weeks keep the company they had; a new Hovership code replaces the current one the same way.
 */
export async function updateDriverProfile(tx: Tx, actor: Actor, id: string, input: DriverInput & { setupComplete?: boolean }, today: string) {
  const before = await driverProfile(tx, id, today);
  if (!before) throw new RuleError('not_found');
  const v = clean(input);
  if (!v.fullName) throw new RuleError('name_required');
  if (v.active) await assertNameFree(tx, v.fullName, before.payeeId);
  await assertContractor(tx, v.contractorId);
  const hov = await hovershipOperationId(tx);
  if (hov) await assertCodeFree(tx, hov, v.hovershipCode, id);
  await assertAliasesFree(tx, v.aliases, id);
  await assertPhoneFree(tx, v.phone, before.payeeId);
  await assertEmailFree(tx, v.email, before.payeeId);
  await assertLicenseFree(tx, v.licenseNumber, id);

  await tx.update(payees).set({
    displayName: v.fullName, phone: v.phone, active: v.active, updatedAt: new Date(), email: v.email, postalAddress: v.address,
  }).where(eq(payees.id, before.payeeId));
  await tx.update(drivers).set({
    licenseNumber: v.licenseNumber, emergencyContactName: v.emergencyName, emergencyContactPhone: v.emergencyPhone,
    setupComplete: input.setupComplete ?? before.setupComplete, updatedAt: new Date(),
    worksTforce: input.worksTforce ?? before.worksTforce, worksHovership: input.worksHovership ?? before.worksHovership,
  }).where(eq(drivers.id, id));
  if (v.contractorId !== before.contractorId) {
    const target = v.contractorId ?? (await ownCompanyId(tx));
    await tx.update(driverAffiliations).set({ validTo: addDays(today, -1) })
      .where(and(eq(driverAffiliations.driverId, id), isNull(driverAffiliations.validTo), lte(driverAffiliations.validFrom, addDays(today, -1))));
    // A link that started today is replaced rather than closed before it began.
    await tx.delete(driverAffiliations).where(and(eq(driverAffiliations.driverId, id), isNull(driverAffiliations.validTo), gte(driverAffiliations.validFrom, today)));
    await tx.insert(driverAffiliations).values({ driverId: id, contractorId: target, validFrom: today });
  }
  if (hov && v.hovershipCode !== before.hovershipCode) {
    // Codes are unique per client for good, so the old one is removed rather than closed when it is reused.
    await tx.delete(driverClientCodes).where(and(eq(driverClientCodes.driverId, id), eq(driverClientCodes.operationId, hov), isNull(driverClientCodes.validTo)));
    if (v.hovershipCode) await tx.insert(driverClientCodes).values({ driverId: id, operationId: hov, driverCode: v.hovershipCode, validFrom: HISTORY_START });
  }
  await tx.delete(driverAliases).where(eq(driverAliases.driverId, id));
  if (v.aliases.length) await tx.insert(driverAliases).values(v.aliases.map((aliasText) => ({ driverId: id, aliasText })));
  const after = (await driverProfile(tx, id, today))!;
  await audit(tx, { table: 'drivers', recordId: id, action: 'update', before, after, userId: actor.userId, source: actor.source });
  return after;
}

/** Sets only the Hovership code (a report code matched to an existing driver). */
export async function setHovershipCode(tx: Tx, actor: Actor, id: string, code: string, today: string) {
  const before = await driverProfile(tx, id, today);
  if (!before) throw new RuleError('not_found');
  return updateDriverProfile(tx, actor, id, { ...before, hovershipCode: code }, today);
}

export async function createContractor(tx: Tx, actor: Actor, name: string) {
  const trimmed = name.trim().replace(/\s+/g, ' ');
  if (!trimmed) throw new RuleError('name_required');
  const [existing] = await tx.select({ id: payees.id }).from(payees)
    .where(and(eq(payees.payeeType, 'contractor'), sql`lower(${payees.displayName}) = lower(${trimmed})`));
  if (existing) throw new RuleError('name_taken');
  const [payee] = await tx.insert(payees).values({ payeeType: 'contractor', displayName: trimmed }).returning();
  const [row] = await tx.insert(contractors).values({ payeeId: payee!.id }).returning();
  const after = (await contractorProfiles(tx, { ids: [row!.id] }))[0]!;
  await audit(tx, { table: 'contractors', recordId: row!.id, action: 'insert', after, userId: actor.userId, source: actor.source });
  return after;
}

/** Creates a route owned by `contractorId` (null = Aarisa) from the start of the history. */
export async function createRoute(tx: Tx, actor: Actor, input: { operationId: string; code: string; contractorId: string | null; usualDriverId: string | null }) {
  const [route] = await tx.insert(routes).values({ operationId: input.operationId, code: input.code, usualDriverId: input.usualDriverId }).returning();
  const [owner] = await tx.insert(routeOwnerships).values({
    routeId: route!.id, contractorId: input.contractorId ?? (await ownCompanyId(tx)), effectiveFrom: HISTORY_START, createdBy: actor.userId ?? null,
  }).returning();
  await audit(tx, [
    { table: 'routes', recordId: route!.id, action: 'insert', after: route, userId: actor.userId, source: actor.source },
    { table: 'route_ownerships', recordId: owner!.id, action: 'insert', after: owner, userId: actor.userId, source: actor.source },
  ]);
  return { ...route!, contractorId: input.contractorId };
}

/** Names of every driver and contractor, active or not, for labelling past records. */
export async function payeeNameMaps(tx: Tx) {
  const d = await tx.select({ id: drivers.id, name: payees.displayName }).from(drivers).innerJoin(payees, eq(payees.id, drivers.payeeId));
  const c = await tx.select({ id: contractors.id, name: payees.displayName }).from(contractors).innerJoin(payees, eq(payees.id, contractors.payeeId));
  return { driver: new Map(d.map((x) => [x.id, x.name])), contractor: new Map(c.map((x) => [x.id, x.name])) };
}
