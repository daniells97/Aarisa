// Drizzle schema draft for the Aarisa portal.
// Money is integer cents. Dates of work are `date`; events are `timestamptz`.

import {
  pgSchema, foreignKey, unique, uuid, text, date, timestamp, integer, bigint, boolean, jsonb,
  uniqueIndex, index, check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

const id = (name: string) => uuid(name).primaryKey().defaultRandom();
const cents = (name: string) => bigint(name, { mode: 'number' });
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

// Every table and enum lives in the `core` schema (transactional model); `analytics` holds the star.
export const core = pgSchema('core');

// ---------- enums ----------
export const roleEnum = core.enum('role', ['owner', 'dispatcher', 'finance', 'viewer']);
export const channelEnum = core.enum('channel', ['whatsapp', 'email', 'none']);
export const payCycleEnum = core.enum('pay_cycle', ['weekly', 'biweekly']);
export const unitEnum = core.enum('unit', ['package', 'stop', 'piece', 'job']);
export const rateSideEnum = core.enum('rate_side', ['client', 'payee']);
export const adjustmentClassEnum = core.enum('adjustment_class', ['bonus', 'goal_top_up', 'correction', 'deduction']);
export const adjustmentSourceEnum = core.enum('adjustment_source', ['manual', 'rule', 'goal']);
export const adjustmentStatusEnum = core.enum('adjustment_status', ['proposed', 'confirmed', 'rejected']);
// Where a row came from. `client_report` is any client's report; the operation says which client.
export const sourceEnum = core.enum('source', ['client_report', 'daily_list', 'extra_job', 'manual', 'whatsapp', 'system']);
// Who or what made a change, for the audit log (CLAUDE.md rule 4).
export const auditSourceEnum = core.enum('audit_source', ['portal', 'whatsapp', 'email-import', 'system']);
export const importStatusEnum = core.enum('import_status', [
  'waiting', 'reading', 'layout_changed', 'partial', 'done', 'failed',
]);
export const executionKindEnum = core.enum('execution_kind', ['route', 'extra']);
export const executionStatusEnum = core.enum('execution_status', [
  'proposed', 'confirmed', 'changed', 'waiting', 'no_driver',
]);
export const exceptionTypeEnum = core.enum('exception_type', [
  'no_driver', 'unknown_name', 'no_pieces', 'low_pieces', 'unknown_driver_code', 'missing_rate',
  'negative_margin',
]);
export const exceptionStatusEnum = core.enum('exception_status', ['open', 'resolved']);
export const resolutionEnum = core.enum('resolution', [
  'assigned_driver', 'not_ours', 'pay_as_reported', 'ask_client', 'rate_added', 'accepted', 'pay_other',
]);
// What the client answered to a claim: all of it, part of it, or nothing.
export const claimResponseEnum = core.enum('claim_response', ['accepted', 'partial', 'rejected']);
export const runStatusEnum = core.enum('run_status', ['draft', 'ready', 'approved', 'reopened', 'paid']);
// What a client is expected to pay: Aarisa's weekly invoice, the client's weekly statement, an extra job,
// or a claim. Each contract says which weekly kind it uses.
export const settlementKindEnum = core.enum('settlement_kind', ['invoice', 'weekly_statement', 'extra_job', 'claim_adjustment']);
export const settlementStatusEnum = core.enum('settlement_status', [
  'open', 'paid', 'short', 'late', 'claim_ready', 'claimed',
]);
export const aiStatusEnum = core.enum('ai_status', ['pending', 'applied', 'partially_applied', 'rejected']);

// ---------- people and access ----------
export const users = core.table('users', {
  id: id('user_id'),
  zitadelSub: text('zitadel_sub').notNull().unique(),
  name: text('full_name').notNull(),
  email: text('email').notNull().unique(),
  phone: text('phone_e164'),
  role: roleEnum('user_role').notNull(),
  morningChannel: channelEnum('morning_channel').notNull().default('none'),
  locale: text('locale').notNull().default('en'),
  active: boolean('is_active').notNull().default(true),
  createdAt: createdAt(), updatedAt: updatedAt(),
});

// ---------- master data ----------
// ---------- clients and contracts (docs/db-model.md §2.2) ----------
export const driverSourceEnum = core.enum('driver_source', ['report_code', 'daily_list']);
export const contactRoleEnum = core.enum('contact_role', ['billing', 'claims', 'operations', 'other']);

// The company Aarisa works for. Billing and claims go to its contacts.
export const clients = core.table('clients', {
  id: id('client_id'),
  code: text('client_code').notNull().unique(),
  displayName: text('display_name').notNull(),
  legalName: text('legal_name'),
  taxId: text('tax_id'),
  billingAddress: text('billing_address'),
  currencyCode: text('currency_code').notNull().default('USD'),
  notes: text('notes'),
  active: boolean('is_active').notNull().default(true),
  createdAt: createdAt(), updatedAt: updatedAt(),
});

export const clientContacts = core.table('client_contacts', {
  id: id('client_contact_id'),
  clientId: uuid('client_id').notNull().references(() => clients.id),
  role: contactRoleEnum('contact_role').notNull(),
  fullName: text('full_name'),
  email: text('email'),
  phone: text('phone_e164'),
  isPrimary: boolean('is_primary').notNull().default(false),
  active: boolean('is_active').notNull().default(true),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [
  // At most one primary contact per role and client.
  uniqueIndex('client_contacts_primary').on(t.clientId, t.role).where(sql`${t.isPrimary} and ${t.active}`),
  check('client_contacts_reachable', sql`${t.email} is not null or ${t.phone} is not null`),
]);

// One contract with a client, and how it works: these rules used to be written in code per client.
export const operations = core.table('operations', {
  id: id('operation_id'),
  clientId: uuid('client_id').notNull().references(() => clients.id),
  code: text('operation_code').notNull().unique(), // 'hovership' | 'tforce'
  name: text('operation_name').notNull(),
  // Where the driver of a work row comes from: the client's report (driver code) or Aarisa's daily list.
  driverSource: driverSourceEnum('driver_source').notNull(),
  payCycle: payCycleEnum('pay_cycle').notNull(),
  cycleAnchor: date('cycle_anchor_date').notNull(), // first day of any pay period
  paymentTermsDays: integer('payment_terms_days').notNull(), // hovership ~21, tforce 30
  blocksPayrollOnExceptions: boolean('blocks_payroll_on_exceptions').notNull().default(true), // rule 6
  lowQuantityThresholdBp: integer('low_quantity_threshold_bp').notNull().default(1000), // under 10% of the route median
  weeklySettlementKind: settlementKindEnum('weekly_settlement_kind').notNull().default('weekly_statement'),
  startDate: date('start_date'),
  endDate: date('end_date'),
  active: boolean('is_active').notNull().default(true),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [
  check('operations_threshold', sql`${t.lowQuantityThresholdBp} between 0 and 10000`),
  check('operations_weekly_kind', sql`${t.weeklySettlementKind} in ('invoice', 'weekly_statement')`),
]);

// ---------- payees: everyone Aarisa pays (docs/db-model.md §2.3) ----------
export const payeeTypeEnum = core.enum('payee_type', ['driver', 'contractor']);
export const paymentMethodEnum = core.enum('payment_method', ['ach', 'check', 'zelle', 'cash']);
export const payTriggerEnum = core.enum('pay_trigger', ['payroll', 'on_collection']);
export const payBasisEnum = core.enum('pay_basis', ['per_unit', 'per_route_day', 'fixed']);

// The name, phone and active flag of a driver or a contractor live only here.
export const payees = core.table('payees', {
  id: id('payee_id'),
  payeeType: payeeTypeEnum('payee_type').notNull(),
  displayName: text('display_name').notNull(),
  taxIdMasked: text('tax_id_masked'),
  paymentMethod: paymentMethodEnum('payment_method'),
  email: text('email'),
  phone: text('phone_e164').unique(),
  postalAddress: text('postal_address'),
  active: boolean('is_active').notNull().default(true),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [
  // One active driver per name, one contractor per name (case-insensitive).
  uniqueIndex('payees_active_driver_name').on(t.payeeType, sql`lower(${t.displayName})`).where(sql`${t.payeeType} = 'driver' and ${t.active}`),
  uniqueIndex('payees_contractor_name').on(sql`lower(${t.displayName})`).where(sql`${t.payeeType} = 'contractor'`),
]);

// Companies that own routes. Aarisa itself is the one row with is_own_company: it owns routes but is
// never paid; its drivers are paid one by one. Puma is paid when the client pays (on_collection).
export const contractors = core.table('contractors', {
  id: id('contractor_id'),
  payeeId: uuid('payee_id').notNull().unique().references(() => payees.id),
  legalName: text('legal_name'),
  contactName: text('contact_name'),
  isOwnCompany: boolean('is_own_company').notNull().default(false),
  payTrigger: payTriggerEnum('pay_trigger').notNull().default('payroll'),
  payBasis: payBasisEnum('pay_basis'),
  feeBp: integer('fee_bp'),
  startDate: date('start_date'),
  endDate: date('end_date'),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [uniqueIndex('contractors_one_own_company').on(t.isOwnCompany).where(sql`${t.isOwnCompany}`)]);

export const drivers = core.table('drivers', {
  id: id('driver_id'),
  payeeId: uuid('payee_id').notNull().unique().references(() => payees.id),
  hireDate: date('hire_date'),
  terminationDate: date('termination_date'),
  setupComplete: boolean('is_setup_complete').notNull().default(true),
  createdAt: createdAt(), updatedAt: updatedAt(),
});

// Names people use for a driver on WhatsApp and in the daily list, stored lower-case and trimmed.
export const driverAliases = core.table('driver_aliases', {
  id: id('driver_alias_id'),
  driverId: uuid('driver_id').notNull().references(() => drivers.id),
  aliasText: text('alias_text').notNull().unique(),
});

// The code each client uses for a driver (Hovership: DUB006).
export const driverClientCodes = core.table('driver_client_codes', {
  id: id('driver_client_code_id'),
  driverId: uuid('driver_id').notNull().references(() => drivers.id),
  operationId: uuid('operation_id').notNull().references(() => operations.id),
  driverCode: text('driver_code').notNull(),
  validFrom: date('valid_from').notNull(),
  validTo: date('valid_to'),
}, (t) => [uniqueIndex('driver_client_codes_op_code').on(t.operationId, t.driverCode)]);

// Which company a driver belongs to, with history (Aarisa or a contractor; never empty).
export const driverAffiliations = core.table('driver_affiliations', {
  id: id('driver_affiliation_id'),
  driverId: uuid('driver_id').notNull().references(() => drivers.id),
  contractorId: uuid('contractor_id').notNull().references(() => contractors.id),
  validFrom: date('valid_from').notNull(),
  validTo: date('valid_to'),
}, (t) => [
  index('driver_affiliations_driver').on(t.driverId, t.validFrom),
  check('driver_affiliations_range', sql`${t.validTo} is null or ${t.validTo} >= ${t.validFrom}`),
]);

export const routes = core.table('routes', {
  id: id('route_id'),
  operationId: uuid('operation_id').notNull().references(() => operations.id),
  code: text('route_code').notNull(), // 9000A
  usualDriverId: uuid('usual_driver_id').references(() => drivers.id),
  active: boolean('is_active').notNull().default(true),
}, (t) => [uniqueIndex('routes_op_code').on(t.operationId, t.code)]);

// Who owns a route from a date: Aarisa or a contractor. Never edited; the next row ends the previous one.
export const routeOwnerships = core.table('route_ownerships', {
  id: id('route_ownership_id'),
  routeId: uuid('route_id').notNull().references(() => routes.id),
  contractorId: uuid('contractor_id').notNull().references(() => contractors.id),
  effectiveFrom: date('effective_from').notNull(),
  note: text('note'),
  createdBy: uuid('created_by_user_id').references(() => users.id),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('route_ownerships_route_from').on(t.routeId, t.effectiveFrom)]);

export const serviceTypes = core.table('service_types', {
  id: id('service_type_id'),
  operationId: uuid('operation_id').notNull().references(() => operations.id),
  code: text('service_code').notNull(), // ecommerce, hovership_packages, stat, pharma_pickup, pickup, grainger, recovery_route, other
  name: text('service_name').notNull(),
  unit: unitEnum('unit_type').notNull(),
  fromReport: boolean('is_from_report').notNull(),
  requiresOrderNumber: boolean('requires_order_number').notNull().default(false),
  requiresNote: boolean('requires_note').notNull().default(false),
  nameEs: text('service_name_es'), // Spanish label; falls back to `name`
  active: boolean('is_active').notNull().default(true), // inactive services stay on old records but can't be chosen
}, (t) => [uniqueIndex('service_op_code').on(t.operationId, t.code)]);

// Levels of a service, defined per client (premise 2). Hovership packages: T1–T4, plus the inactive
// "T1-3" that holds pieces imported before tiers were kept apart.
export const serviceTiers = core.table('service_tiers', {
  id: id('service_tier_id'),
  serviceTypeId: uuid('service_type_id').notNull().references(() => serviceTypes.id),
  code: text('tier_code').notNull(),
  name: text('tier_name').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  minQty: integer('min_qty'), // only for volume tiers; client-labelled tiers leave both empty
  maxQty: integer('max_qty'),
  active: boolean('is_active').notNull().default(true),
}, (t) => [uniqueIndex('service_tiers_service_code').on(t.serviceTypeId, t.code)]);

// One negotiation that changes rates from a date, for one side: what the client pays Aarisa, or what
// Aarisa pays the driver or contractor. Never edited; a renegotiation is a new agreement.
export const rateAgreements = core.table('rate_agreements', {
  id: id('rate_agreement_id'),
  operationId: uuid('operation_id').notNull().references(() => operations.id),
  side: rateSideEnum('rate_side').notNull(),
  effectiveFrom: date('effective_from').notNull(),
  reason: text('reason'),
  documentUrl: text('document_url'),
  createdBy: uuid('created_by_user_id').references(() => users.id),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('rate_agreements_key').on(t.id, t.side, t.effectiveFrom)]);

// Rule 2: never update a rate; a change is a new agreement with its own start date. The side and date
// repeat the agreement's (a composite foreign key keeps them equal) so uniqueness can be enforced here.
export const rates = core.table('rates', {
  id: id('rate_id'),
  agreementId: uuid('rate_agreement_id').notNull(),
  side: rateSideEnum('rate_side').notNull(),
  effectiveFrom: date('effective_from').notNull(),
  serviceTypeId: uuid('service_type_id').notNull().references(() => serviceTypes.id),
  tierId: uuid('service_tier_id').references(() => serviceTiers.id),
  payeeId: uuid('payee_id').references(() => payees.id), // a special rate for one driver or contractor
  rateCents: cents('rate_cents').notNull(),
}, (t) => [
  foreignKey({ name: 'rates_agreement_fk', columns: [t.agreementId, t.side, t.effectiveFrom], foreignColumns: [rateAgreements.id, rateAgreements.side, rateAgreements.effectiveFrom] }),
  unique('rates_unique').on(t.serviceTypeId, t.tierId, t.payeeId, t.side, t.effectiveFrom).nullsNotDistinct(),
  index('rates_lookup').on(t.serviceTypeId, t.tierId, t.effectiveFrom),
  check('rates_not_negative', sql`${t.rateCents} >= 0`),
  check('rates_client_general', sql`${t.side} = 'payee' or ${t.payeeId} is null`),
]);

// ---------- inputs ----------
export const reportImports = core.table('report_imports', {
  id: id('report_import_id'),
  operationId: uuid('operation_id').notNull().references(() => operations.id),
  periodStart: date('period_start_date').notNull(),
  periodEnd: date('period_end_date').notNull(),
  channel: text('import_channel').notNull(), // 'email' | 'upload'
  fileName: text('file_name'),
  fileSha256: text('file_sha256'),
  fileUrl: text('file_url'),
  status: importStatusEnum('import_status').notNull().default('waiting'),
  columnMap: jsonb('column_map'), // detected or confirmed mapping
  rowCount: integer('row_count'),
  problems: jsonb('problems'), // unknown codes, renamed columns…
  receivedAt: timestamp('received_at', { withTimezone: true }),
  createdBy: uuid('created_by_user_id').references(() => users.id),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('import_file_once').on(t.operationId, t.fileSha256)]);

// How a client's report is read (premise 1): one active layout per operation, and what each column means.
export const columnMeaningEnum = core.enum('column_meaning', [
  'work_date', 'driver_code', 'driver_name', 'route_code', 'quantity', 'bonus', 'other_revenue', 'other_revenue_reason', 'expected_pay', 'ignore',
]);

export const reportLayouts = core.table('report_layouts', {
  id: id('report_layout_id'),
  operationId: uuid('operation_id').notNull().references(() => operations.id),
  name: text('layout_name').notNull(),
  headerRow: integer('header_row').notNull().default(1),
  active: boolean('is_active').notNull().default(true),
  createdBy: uuid('created_by_user_id').references(() => users.id),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('report_layouts_one_active').on(t.operationId).where(sql`${t.active}`)]);

export const reportLayoutColumns = core.table('report_layout_columns', {
  id: id('report_layout_column_id'),
  layoutId: uuid('report_layout_id').notNull().references(() => reportLayouts.id),
  sourceName: text('source_column_name').notNull(), // as the client writes it: "Tier 1", "Paid Driver #"
  aliases: text('aliases').array().notNull().default(sql`'{}'::text[]`), // other ways the same column has arrived
  meaning: columnMeaningEnum('column_meaning').notNull(),
  serviceTypeId: uuid('service_type_id').references(() => serviceTypes.id),
  tierId: uuid('service_tier_id').references(() => serviceTiers.id),
  revenueTypeId: uuid('revenue_type_id').references(() => revenueTypes.id),
  required: boolean('is_required').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
}, (t) => [
  uniqueIndex('report_layout_columns_name').on(t.layoutId, t.sourceName),
  check('report_layout_columns_quantity', sql`${t.meaning} <> 'quantity' or ${t.serviceTypeId} is not null`),
  check('report_layout_columns_revenue', sql`${t.meaning} <> 'other_revenue' or ${t.revenueTypeId} is not null`),
]);

// Every row of an imported file as it arrived (stage 6b), so a record can be traced to its line.
export const rowStatusEnum = core.enum('row_status', ['ok', 'warning', 'error', 'ignored']);
export const reportImportRows = core.table('report_import_rows', {
  id: id('report_import_row_id'),
  importId: uuid('report_import_id').notNull().references(() => reportImports.id),
  rowNumber: integer('row_number').notNull(),
  rawData: jsonb('raw_data').notNull(),
  status: rowStatusEnum('row_status').notNull().default('ok'),
  problemCode: text('problem_code'),
  problemText: text('problem_text'),
}, (t) => [uniqueIndex('report_import_rows_line').on(t.importId, t.rowNumber)]);

// One payee, one day, one route (or none) for one operation: the "execution" (docs/db-model.md §2.6).
// T-Force executions come from the daily list (one per route and day); Hovership executions from the
// report (one per driver and day, no route); extra jobs hang from an `extra` execution per payee and day,
// which pays without counting as a route day. Work records, extra jobs and exceptions hang from here.
export const routeExecutions = core.table('route_executions', {
  id: id('route_execution_id'),
  operationId: uuid('operation_id').notNull().references(() => operations.id),
  date: date('work_date').notNull(),
  routeId: uuid('route_id').references(() => routes.id),
  kind: executionKindEnum('execution_kind').notNull().default('route'),
  payeeId: uuid('payee_id').references(() => payees.id), // who is paid: the driver, or the contractor on its routes
  driverId: uuid('driver_id').references(() => drivers.id), // who drove, when known
  rawName: text('raw_name'), // what someone wrote when the name wasn't recognised
  status: executionStatusEnum('execution_status').notNull().default('proposed'),
  source: sourceEnum('execution_source').notNull().default('system'),
  importId: uuid('report_import_id').references(() => reportImports.id),
  agreedClientAmountCents: cents('agreed_client_amount_cents'),
  confirmedBy: uuid('confirmed_by_user_id').references(() => users.id),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex('route_executions_route_day').on(t.operationId, t.date, t.routeId).where(sql`${t.kind} = 'route' and ${t.routeId} is not null`),
  uniqueIndex('route_executions_payee_day').on(t.operationId, t.date, t.payeeId).where(sql`${t.kind} = 'route' and ${t.routeId} is null`),
  uniqueIndex('route_executions_extra_day').on(t.operationId, t.date, t.payeeId).where(sql`${t.kind} = 'extra'`),
  index('route_executions_payee').on(t.payeeId, t.date),
  check('route_executions_status_payee', sql`(${t.status} in ('confirmed', 'changed') and ${t.payeeId} is not null) or (${t.status} = 'no_driver' and ${t.payeeId} is null) or ${t.status} in ('proposed', 'waiting')`),
  check('route_executions_confirmed_at', sql`${t.confirmedAt} is null or ${t.status} in ('confirmed', 'changed')`),
  check('route_executions_extra_payee', sql`${t.kind} = 'route' or ${t.payeeId} is not null`),
]);

export const extraJobs = core.table('extra_jobs', {
  id: id('extra_job_id'),
  clientUuid: uuid('client_uuid').notNull().unique(), // generated on the phone; makes offline sync idempotent
  executionId: uuid('route_execution_id').notNull().references(() => routeExecutions.id),
  serviceTypeId: uuid('service_type_id').notNull().references(() => serviceTypes.id),
  nearRouteId: uuid('near_route_id').references(() => routes.id),
  clientAmountCents: cents('client_amount_cents'),
  driverAmountCents: cents('payee_amount_cents'),
  orderNumber: text('order_number'),
  photoUrl: text('photo_url'),
  note: text('note'),
  source: sourceEnum('job_source').notNull(),
  aiSuggestionId: uuid('ai_suggestion_id').references(() => aiSuggestions.id),
  createdBy: uuid('created_by_user_id').references(() => users.id),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [
  index('extra_jobs_execution').on(t.executionId),
  check('extra_jobs_amounts', sql`${t.driverAmountCents} >= 0 and (${t.clientAmountCents} is null or ${t.clientAmountCents} >= 0)`),
]);

// ---------- the unified work record ----------
// What was done in an execution: one row per service and tier (or one per extra job).
export const workRecords = core.table('work_records', {
  id: id('work_record_id'),
  executionId: uuid('route_execution_id').notNull().references(() => routeExecutions.id),
  serviceTypeId: uuid('service_type_id').notNull().references(() => serviceTypes.id),
  tierId: uuid('service_tier_id').references(() => serviceTiers.id),
  pieces: integer('quantity').notNull().default(0),
  // snapshots, filled when the pay period is approved (profit is never stored: revenue − pay)
  clientRateCents: cents('client_rate_cents'),
  driverRateCents: cents('payee_rate_cents'),
  driverPayCents: cents('pay_cents'),
  revenueCents: cents('revenue_cents'),
  source: sourceEnum('record_source').notNull(),
  importId: uuid('report_import_id').references(() => reportImports.id),
  importRowId: uuid('report_import_row_id').references(() => reportImportRows.id),
  extraJobId: uuid('extra_job_id').unique().references(() => extraJobs.id),
  payrollRunId: uuid('payroll_run_id').references(() => payrollRuns.id),
  settlementLineId: uuid('settlement_line_id').references(() => settlementLines.id),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [
  index('work_records_execution').on(t.executionId),
  index('work_records_payroll_run').on(t.payrollRunId),
  index('work_records_settlement_line').on(t.settlementLineId),
  // One row per service and tier in an execution; extra jobs are one row each.
  uniqueIndex('work_records_grain_tier').on(t.executionId, t.serviceTypeId, t.tierId).where(sql`${t.extraJobId} is null and ${t.tierId} is not null`),
  uniqueIndex('work_records_grain').on(t.executionId, t.serviceTypeId).where(sql`${t.extraJobId} is null and ${t.tierId} is null`),
  check('work_records_quantity', sql`${t.pieces} >= 0`),
  check('work_records_snapshot', sql`(${t.driverPayCents} is null) = (${t.revenueCents} is null)`),
]);

// Kinds of pay adjustment. Bonuses are set by Aarisa; corrections fix a closed run in a later period.
export const adjustmentTypes = core.table('adjustment_types', {
  id: id('adjustment_type_id'),
  code: text('adjustment_type_code').notNull().unique(),
  name: text('adjustment_type_name').notNull(),
  nameEs: text('adjustment_type_name_es'),
  adjustmentClass: adjustmentClassEnum('adjustment_class').notNull(),
  active: boolean('is_active').notNull().default(true),
});

// Everything added to or taken from a payee's pay besides quantity × rate (docs/db-model.md §2.6).
// `payPeriodId` is set only when it is paid in a later period than its execution (a correction).
export const payAdjustments = core.table('pay_adjustments', {
  id: id('pay_adjustment_id'),
  payPeriodId: uuid('pay_period_id').references(() => payPeriods.id),
  payeeId: uuid('payee_id').notNull().references(() => payees.id),
  executionId: uuid('route_execution_id').references(() => routeExecutions.id),
  typeId: uuid('adjustment_type_id').notNull().references(() => adjustmentTypes.id),
  amountCents: cents('amount_cents').notNull(),
  reason: text('reason'),
  source: adjustmentSourceEnum('adjustment_source').notNull().default('manual'),
  status: adjustmentStatusEnum('adjustment_status').notNull().default('confirmed'),
  confirmedBy: uuid('confirmed_by_user_id').references(() => users.id),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  createdBy: uuid('created_by_user_id').references(() => users.id),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [
  index('pay_adjustments_execution').on(t.executionId),
  index('pay_adjustments_payee').on(t.payeeId),
  check('pay_adjustments_target', sql`${t.executionId} is not null or ${t.payPeriodId} is not null`),
  check('pay_adjustments_not_zero', sql`${t.amountCents} <> 0`),
]);

// Places, shared by every client (a STEM reason names one). How a zone arrives written is kept in
// zone_aliases, lower-case and trimmed, so "DIablo" and "Diablo" are the same zone.
export const zones = core.table('zones', {
  id: id('zone_id'),
  code: text('zone_code').notNull().unique(),
  name: text('zone_name').notNull(),
  active: boolean('is_active').notNull().default(true),
  createdAt: createdAt(),
});

export const zoneAliases = core.table('zone_aliases', {
  id: id('zone_alias_id'),
  zoneId: uuid('zone_id').notNull().references(() => zones.id),
  aliasText: text('alias_text').notNull().unique(),
});

// Revenue that isn't driver work, per operation (Hovership: STEM). It never enters driver pay or margin.
export const revenueTypes = core.table('revenue_types', {
  id: id('revenue_type_id'),
  operationId: uuid('operation_id').notNull().references(() => operations.id),
  code: text('revenue_type_code').notNull(),
  name: text('revenue_type_name').notNull(),
  countsInPayeeMargin: boolean('counts_in_payee_margin').notNull().default(false),
}, (t) => [uniqueIndex('revenue_types_op_code').on(t.operationId, t.code)]);

export const classificationStatusEnum = core.enum('classification_status', ['classified', 'needs_review', 'lump_adjustment']);

// STEM and other revenue the client pays that isn't paid to a driver (spec §5.2, rule 7). Each row keeps
// the reason as it arrived; an unknown or missing zone, or an unusually large amount, waits for review.
export const otherRevenues = core.table('other_revenues', {
  id: id('other_revenue_id'),
  operationId: uuid('operation_id').notNull().references(() => operations.id),
  date: date('revenue_date').notNull(),
  typeId: uuid('revenue_type_id').notNull().references(() => revenueTypes.id),
  executionId: uuid('route_execution_id').references(() => routeExecutions.id), // the driver-day it came with
  zoneId: uuid('zone_id').references(() => zones.id),
  reason: text('reason_text'), // e.g. "DIablo", as received
  amountCents: cents('amount_cents').notNull(),
  status: classificationStatusEnum('classification_status').notNull().default('classified'),
  reviewNote: text('review_note'),
  importId: uuid('report_import_id').references(() => reportImports.id),
  createdAt: createdAt(),
}, (t) => [
  index('other_revenues_op_date').on(t.operationId, t.date),
  check('other_revenues_zone', sql`${t.status} <> 'classified' or ${t.zoneId} is not null`),
  check('other_revenues_lump_note', sql`${t.status} <> 'lump_adjustment' or ${t.reviewNote} is not null`),
]);

export const exceptions = core.table('exceptions', {
  id: id('exception_id'),
  operationId: uuid('operation_id').notNull().references(() => operations.id),
  periodStart: date('period_start_date').notNull(),
  date: date('work_date').notNull(),
  routeId: uuid('route_id').references(() => routes.id),
  type: exceptionTypeEnum('exception_type').notNull(),
  workRecordId: uuid('work_record_id').references(() => workRecords.id),
  executionId: uuid('route_execution_id').references(() => routeExecutions.id),
  details: jsonb('details'), // pieces, usual range, raw name…
  status: exceptionStatusEnum('exception_status').notNull().default('open'),
  resolution: resolutionEnum('resolution'),
  resolvedBy: uuid('resolved_by_user_id').references(() => users.id),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index('exceptions_open').on(t.operationId, t.periodStart, t.status)]);

// ---------- payroll ----------
export const payPeriods = core.table('pay_periods', {
  id: id('pay_period_id'),
  operationId: uuid('operation_id').notNull().references(() => operations.id),
  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),
}, (t) => [uniqueIndex('period_op_start').on(t.operationId, t.startDate)]);

export const payrollRuns = core.table('payroll_runs', {
  id: id('payroll_run_id'),
  payPeriodId: uuid('pay_period_id').notNull().references(() => payPeriods.id).unique(),
  status: runStatusEnum('run_status').notNull().default('draft'),
  totals: jsonb('totals'), // snapshot at approval
  approvedBy: uuid('approved_by_user_id').references(() => users.id),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  reopenableUntil: timestamp('reopenable_until', { withTimezone: true }),
  exportUrl: text('export_url'),
  paidAt: timestamp('paid_at', { withTimezone: true }),
});

export const payrollLines = core.table('payroll_lines', {
  id: id('payroll_line_id'),
  runId: uuid('payroll_run_id').notNull().references(() => payrollRuns.id),
  payeeId: uuid('payee_id').notNull().references(() => payees.id),
  routeDays: integer('route_day_count').notNull(),
  extraJobs: integer('extra_job_count').notNull().default(0),
  pieces: integer('quantity_total').notNull(),
  stops: integer('stop_count').notNull().default(0), // Hovership stat stops, kept apart from packages
  bonusCents: cents('adjustment_cents').notNull(), // bonuses and other pay adjustments
  payCents: cents('pay_cents').notNull(),
  marginCents: cents('margin_cents').notNull(),
}, (t) => [uniqueIndex('payroll_lines_run_payee').on(t.runId, t.payeeId)]);

// ---------- settlements ----------
export const settlementLines = core.table('settlement_lines', {
  id: id('settlement_line_id'),
  operationId: uuid('operation_id').notNull().references(() => operations.id),
  kind: settlementKindEnum('settlement_kind').notNull(),
  reference: text('reference'), // invoice #, settlement #, order #
  periodStart: date('period_start_date'),
  periodEnd: date('period_end_date'),
  extraJobId: uuid('extra_job_id').references(() => extraJobs.id),
  expectedCents: cents('expected_cents'),
  expectedDate: date('expected_date'),
  status: settlementStatusEnum('settlement_status').notNull().default('open'),
  createdAt: createdAt(), updatedAt: updatedAt(),
});

export const paymentsReceived = core.table('payments_received', {
  id: id('payment_received_id'),
  operationId: uuid('operation_id').notNull().references(() => operations.id),
  receivedOn: date('received_date').notNull(),
  amountCents: cents('amount_cents').notNull(),
  method: text('payment_method'), // ACH…
  reference: text('bank_reference'),
  note: text('note'),
  createdBy: uuid('created_by_user_id').references(() => users.id),
  createdAt: createdAt(),
});

export const paymentAllocations = core.table('payment_allocations', {
  id: id('payment_allocation_id'),
  paymentId: uuid('payment_received_id').notNull().references(() => paymentsReceived.id),
  settlementLineId: uuid('settlement_line_id').notNull().references(() => settlementLines.id),
  amountCents: cents('amount_cents').notNull(),
});

export const claims = core.table('claims', {
  id: id('claim_id'),
  settlementLineId: uuid('settlement_line_id').notNull().references(() => settlementLines.id),
  status: text('claim_status').notNull().default('draft'), // draft | sent | resolved
  sentTo: text('sent_to'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  pdfUrl: text('pdf_url'),
  // A weekly-check exception sent to the client ("Ask T-Force"): what is claimed and why.
  exceptionId: uuid('exception_id').references(() => exceptions.id),
  claimedQuantity: integer('claimed_quantity'),
  claimedCents: cents('claimed_cents'),
  note: text('note'),
  // The client's answer. The owner decides then whether the payee gets anything more (a later correction).
  response: claimResponseEnum('claim_response'),
  acceptedCents: cents('accepted_cents'),
  respondedBy: uuid('responded_by_user_id').references(() => users.id),
  respondedAt: timestamp('responded_at', { withTimezone: true }),
  payAdjustmentId: uuid('pay_adjustment_id').references(() => payAdjustments.id),
  createdBy: uuid('created_by_user_id').references(() => users.id),
  createdAt: createdAt(),
}, (t) => [
  check('claims_response_amount', sql`${t.response} is null or ${t.acceptedCents} is not null`),
]);

// ---------- WhatsApp and AI ----------
export const messages = core.table('messages', {
  id: id('message_id'),
  waMessageId: text('wa_message_id').unique(),
  direction: text('message_direction').notNull(), // in | out
  phone: text('phone_e164').notNull(),
  userId: uuid('user_id').references(() => users.id),
  type: text('message_type').notNull(), // text | audio | interactive | template
  body: text('body'),
  mediaUrl: text('media_url'),
  transcript: text('transcript'),
  relatedDate: date('related_date'),
  createdAt: createdAt(),
});

export const aiSuggestions = core.table('ai_suggestions', {
  id: id('ai_suggestion_id'),
  kind: text('suggestion_kind').notNull(), // daily_changes | extra_job
  messageId: uuid('message_id').references(() => messages.id),
  inputText: text('input_text').notNull(),
  model: text('model_name').notNull(),
  output: jsonb('output_data').notNull(),
  status: aiStatusEnum('suggestion_status').notNull().default('pending'),
  confirmedBy: uuid('confirmed_by_user_id').references(() => users.id),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  createdAt: createdAt(),
});

// ---------- audit ----------
export const auditLog = core.table('audit_log', {
  id: id('audit_log_id'),
  tableName: text('table_name').notNull(),
  recordId: uuid('record_id').notNull(),
  action: text('audit_action').notNull(), // insert | update | delete | approve | reopen | undo
  before: jsonb('before_data'),
  after: jsonb('after_data'),
  userId: uuid('user_id').references(() => users.id),
  source: auditSourceEnum('audit_source').notNull(),
  aiSuggestionId: uuid('ai_suggestion_id').references(() => aiSuggestions.id), // the WhatsApp suggestion behind the change
  at: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('audit_record').on(t.tableName, t.recordId)]);

// ---------- read views (created by migration 0006; Drizzle only reads them) ----------
// Work and extra jobs in the flat shape screens and reports use: the execution's date, operation, route
// and payee (as driver or contractor) next to each row.
export const workView = core.view('v_work_records', {
  id: uuid('work_record_id').notNull(),
  executionId: uuid('route_execution_id').notNull(),
  executionKind: executionKindEnum('execution_kind').notNull(),
  date: date('work_date').notNull(),
  operationId: uuid('operation_id').notNull(),
  routeId: uuid('route_id'),
  payeeId: uuid('payee_id'),
  driverId: uuid('driver_id'),
  contractorId: uuid('contractor_id'),
  serviceTypeId: uuid('service_type_id').notNull(),
  tierId: uuid('service_tier_id'),
  tierCode: text('tier_code'),
  pieces: integer('quantity').notNull(),
  clientRateCents: cents('client_rate_cents'),
  driverRateCents: cents('payee_rate_cents'),
  driverPayCents: cents('pay_cents'),
  revenueCents: cents('revenue_cents'),
  source: sourceEnum('record_source').notNull(),
  importId: uuid('report_import_id'),
  extraJobId: uuid('extra_job_id'),
  payrollRunId: uuid('payroll_run_id'),
  settlementLineId: uuid('settlement_line_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
}).existing();

export const extraJobView = core.view('v_extra_jobs', {
  id: uuid('extra_job_id').notNull(),
  clientUuid: uuid('client_uuid').notNull(),
  executionId: uuid('route_execution_id').notNull(),
  operationId: uuid('operation_id').notNull(),
  date: date('work_date').notNull(),
  serviceTypeId: uuid('service_type_id').notNull(),
  nearRouteId: uuid('near_route_id'),
  payeeId: uuid('payee_id').notNull(),
  driverId: uuid('driver_id'),
  contractorId: uuid('contractor_id'),
  clientAmountCents: cents('client_amount_cents'),
  driverAmountCents: cents('payee_amount_cents'),
  orderNumber: text('order_number'),
  photoUrl: text('photo_url'),
  note: text('note'),
  source: sourceEnum('job_source').notNull(),
  aiSuggestionId: uuid('ai_suggestion_id'),
  createdBy: uuid('created_by_user_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
}).existing();

// Executions with the payee split into driver or contractor, for the daily list and the weekly check.
export const executionView = core.view('v_route_executions', {
  id: uuid('route_execution_id').notNull(),
  operationId: uuid('operation_id').notNull(),
  date: date('work_date').notNull(),
  routeId: uuid('route_id'),
  kind: executionKindEnum('execution_kind').notNull(),
  payeeId: uuid('payee_id'),
  payeeDriverId: uuid('payee_driver_id'),
  payeeContractorId: uuid('payee_contractor_id'),
  driverId: uuid('driver_id'),
  rawName: text('raw_name'),
  status: executionStatusEnum('execution_status').notNull(),
  source: sourceEnum('execution_source').notNull(),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
}).existing();
