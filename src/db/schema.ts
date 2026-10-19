// Drizzle schema draft for the Aarisa portal.
// Money is integer cents. Dates of work are `date`; events are `timestamptz`.

import {
  pgSchema, uuid, text, date, timestamp, integer, bigint, boolean, jsonb,
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
export const tierEnum = core.enum('tier', ['t1_3', 't4']);
export const sourceEnum = core.enum('source', [
  'hovership_report', 'tforce_report', 'daily_list', 'extra_job', 'manual', 'whatsapp', 'system',
]);
// Who or what made a change, for the audit log (CLAUDE.md rule 4).
export const auditSourceEnum = core.enum('audit_source', ['portal', 'whatsapp', 'email-import', 'system']);
export const importStatusEnum = core.enum('import_status', [
  'waiting', 'reading', 'layout_changed', 'partial', 'done', 'failed',
]);
export const assignmentStatusEnum = core.enum('assignment_status', [
  'proposed', 'confirmed', 'changed', 'waiting', 'no_driver',
]);
export const exceptionTypeEnum = core.enum('exception_type', [
  'no_driver', 'unknown_name', 'no_pieces', 'low_pieces', 'unknown_driver_code', 'missing_rate',
  'negative_margin',
]);
export const exceptionStatusEnum = core.enum('exception_status', ['open', 'resolved']);
export const resolutionEnum = core.enum('resolution', [
  'assigned_driver', 'not_ours', 'pay_as_reported', 'ask_client', 'rate_added', 'accepted',
]);
export const runStatusEnum = core.enum('run_status', ['draft', 'ready', 'approved', 'reopened', 'paid']);
export const settlementKindEnum = core.enum('settlement_kind', [
  'hovership_invoice', 'tforce_weekly', 'extra_job', 'claim_adjustment',
]);
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
export const operations = core.table('operations', {
  id: id('operation_id'),
  code: text('operation_code').notNull().unique(), // 'hovership' | 'tforce'
  name: text('operation_name').notNull(),
  payCycle: payCycleEnum('pay_cycle').notNull(),
  cycleAnchor: date('cycle_anchor_date').notNull(), // first day of any pay period
  paymentTermsDays: integer('payment_terms_days').notNull(), // hovership ~21, tforce 30
});

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

// Never update a rate; insert a new one with a later effective_from.
export const rates = core.table('rates', {
  id: id('rate_id'),
  serviceTypeId: uuid('service_type_id').notNull().references(() => serviceTypes.id),
  tier: tierEnum('tier'),
  driverId: uuid('driver_id').references(() => drivers.id), // optional override
  contractorId: uuid('contractor_id').references(() => contractors.id), // optional override
  clientRateCents: cents('client_rate_cents'),
  driverRateCents: cents('payee_rate_cents'),
  effectiveFrom: date('effective_from').notNull(),
  createdBy: uuid('created_by_user_id').references(() => users.id),
  createdAt: createdAt(),
}, (t) => [index('rates_lookup').on(t.serviceTypeId, t.tier, t.effectiveFrom)]);

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

export const dailyAssignments = core.table('daily_assignments', {
  id: id('daily_assignment_id'),
  date: date('work_date').notNull(),
  routeId: uuid('route_id').notNull().references(() => routes.id),
  driverId: uuid('driver_id').references(() => drivers.id),
  contractorId: uuid('contractor_id').references(() => contractors.id),
  rawName: text('raw_name'), // what someone wrote when the name wasn't recognised
  status: assignmentStatusEnum('assignment_status').notNull().default('proposed'),
  source: sourceEnum('assignment_source').notNull().default('system'),
  confirmedBy: uuid('confirmed_by_user_id').references(() => users.id),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('assignment_day_route').on(t.date, t.routeId)]);

export const extraJobs = core.table('extra_jobs', {
  id: id('extra_job_id'),
  clientUuid: uuid('client_uuid').notNull().unique(), // generated on the phone; makes offline sync idempotent
  operationId: uuid('operation_id').notNull().references(() => operations.id),
  serviceTypeId: uuid('service_type_id').notNull().references(() => serviceTypes.id),
  date: date('work_date').notNull(),
  nearRouteId: uuid('near_route_id').references(() => routes.id),
  driverId: uuid('driver_id').references(() => drivers.id),
  contractorId: uuid('contractor_id').references(() => contractors.id),
  clientAmountCents: cents('client_amount_cents'),
  driverAmountCents: cents('payee_amount_cents'),
  orderNumber: text('order_number'),
  photoUrl: text('photo_url'),
  note: text('note'),
  source: sourceEnum('job_source').notNull(),
  aiSuggestionId: uuid('ai_suggestion_id'),
  createdBy: uuid('created_by_user_id').references(() => users.id),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [check('extra_one_payee', sql`(${t.driverId} is null) <> (${t.contractorId} is null)`)]);

// ---------- the unified work record ----------
export const workRecords = core.table('work_records', {
  id: id('work_record_id'),
  date: date('work_date').notNull(),
  operationId: uuid('operation_id').notNull().references(() => operations.id),
  serviceTypeId: uuid('service_type_id').notNull().references(() => serviceTypes.id),
  routeId: uuid('route_id').references(() => routes.id),
  driverId: uuid('driver_id').references(() => drivers.id),
  contractorId: uuid('contractor_id').references(() => contractors.id),
  tier: tierEnum('tier'),
  pieces: integer('quantity').notNull().default(0),
  bonusCents: cents('bonus_cents').notNull().default(0),
  // snapshots, filled when the pay period is approved
  clientRateCents: cents('client_rate_cents'),
  driverRateCents: cents('payee_rate_cents'),
  driverPayCents: cents('pay_cents'),
  revenueCents: cents('revenue_cents'),
  profitCents: cents('profit_cents'),
  source: sourceEnum('record_source').notNull(),
  importId: uuid('report_import_id').references(() => reportImports.id),
  assignmentId: uuid('daily_assignment_id').references(() => dailyAssignments.id),
  extraJobId: uuid('extra_job_id').references(() => extraJobs.id),
  payrollRunId: uuid('payroll_run_id'),
  settlementLineId: uuid('settlement_line_id'),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [
  index('work_op_date').on(t.operationId, t.date),
  index('work_driver_date').on(t.driverId, t.date),
]);

// STEM and other revenue Hovership pays that isn't tied to one driver.
export const operationRevenue = core.table('operation_revenue', {
  id: id('operation_revenue_id'),
  operationId: uuid('operation_id').notNull().references(() => operations.id),
  date: date('revenue_date').notNull(),
  kind: text('revenue_kind').notNull(), // 'stem'
  reason: text('reason_text'), // e.g. Benicia, Disco Bay
  amountCents: cents('amount_cents').notNull(),
  importId: uuid('report_import_id').references(() => reportImports.id),
});

export const exceptions = core.table('exceptions', {
  id: id('exception_id'),
  operationId: uuid('operation_id').notNull().references(() => operations.id),
  periodStart: date('period_start_date').notNull(),
  date: date('work_date').notNull(),
  routeId: uuid('route_id').references(() => routes.id),
  type: exceptionTypeEnum('exception_type').notNull(),
  workRecordId: uuid('work_record_id').references(() => workRecords.id),
  assignmentId: uuid('daily_assignment_id').references(() => dailyAssignments.id),
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
  driverId: uuid('driver_id').references(() => drivers.id),
  contractorId: uuid('contractor_id').references(() => contractors.id),
  routeDays: integer('route_day_count').notNull(),
  extraJobs: integer('extra_job_count').notNull().default(0),
  pieces: integer('quantity_total').notNull(),
  stops: integer('stop_count').notNull().default(0), // Hovership stat stops, kept apart from packages
  bonusCents: cents('bonus_cents').notNull(),
  payCents: cents('pay_cents').notNull(),
  marginCents: cents('margin_cents').notNull(),
});

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
  createdBy: uuid('created_by_user_id').references(() => users.id),
  createdAt: createdAt(),
});

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
  at: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('audit_record').on(t.tableName, t.recordId)]);
