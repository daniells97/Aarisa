// Drizzle schema draft for the Aarisa portal.
// Money is integer cents. Dates of work are `date`; events are `timestamptz`.

import {
  pgTable, pgEnum, uuid, text, date, timestamp, integer, bigint, boolean, jsonb,
  uniqueIndex, index, check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

const id = () => uuid('id').primaryKey().defaultRandom();
const cents = (name: string) => bigint(name, { mode: 'number' });
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

// ---------- enums ----------
export const roleEnum = pgEnum('role', ['owner', 'dispatcher', 'finance', 'viewer']);
export const channelEnum = pgEnum('channel', ['whatsapp', 'email', 'none']);
export const payCycleEnum = pgEnum('pay_cycle', ['weekly', 'biweekly']);
export const unitEnum = pgEnum('unit', ['package', 'stop', 'piece', 'job']);
export const tierEnum = pgEnum('tier', ['t1_3', 't4']);
export const sourceEnum = pgEnum('source', [
  'hovership_report', 'tforce_report', 'daily_list', 'extra_job', 'manual', 'whatsapp', 'system',
]);
// Who or what made a change, for the audit log (CLAUDE.md rule 4).
export const auditSourceEnum = pgEnum('audit_source', ['portal', 'whatsapp', 'email-import', 'system']);
export const importStatusEnum = pgEnum('import_status', [
  'waiting', 'reading', 'layout_changed', 'partial', 'done', 'failed',
]);
export const assignmentStatusEnum = pgEnum('assignment_status', [
  'proposed', 'confirmed', 'changed', 'waiting', 'no_driver',
]);
export const exceptionTypeEnum = pgEnum('exception_type', [
  'no_driver', 'unknown_name', 'no_pieces', 'low_pieces', 'unknown_driver_code', 'missing_rate',
  'negative_margin',
]);
export const exceptionStatusEnum = pgEnum('exception_status', ['open', 'resolved']);
export const resolutionEnum = pgEnum('resolution', [
  'assigned_driver', 'not_ours', 'pay_as_reported', 'ask_client', 'rate_added', 'accepted',
]);
export const runStatusEnum = pgEnum('run_status', ['draft', 'ready', 'approved', 'reopened', 'paid']);
export const settlementKindEnum = pgEnum('settlement_kind', [
  'hovership_invoice', 'tforce_weekly', 'extra_job', 'claim_adjustment',
]);
export const settlementStatusEnum = pgEnum('settlement_status', [
  'open', 'paid', 'short', 'late', 'claim_ready', 'claimed',
]);
export const aiStatusEnum = pgEnum('ai_status', ['pending', 'applied', 'partially_applied', 'rejected']);

// ---------- people and access ----------
export const users = pgTable('users', {
  id: id(),
  zitadelSub: text('zitadel_sub').notNull().unique(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  phone: text('phone'),
  role: roleEnum('role').notNull(),
  morningChannel: channelEnum('morning_channel').notNull().default('none'),
  locale: text('locale').notNull().default('en'),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(), updatedAt: updatedAt(),
});

// ---------- master data ----------
export const operations = pgTable('operations', {
  id: id(),
  code: text('code').notNull().unique(), // 'hovership' | 'tforce'
  name: text('name').notNull(),
  payCycle: payCycleEnum('pay_cycle').notNull(),
  cycleAnchor: date('cycle_anchor').notNull(), // first day of any pay period
  paymentTermsDays: integer('payment_terms_days').notNull(), // hovership ~21, tforce 30
});

export const contractors = pgTable('contractors', {
  id: id(),
  name: text('name').notNull().unique(), // e.g. Puma
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(), updatedAt: updatedAt(),
});

export const drivers = pgTable('drivers', {
  id: id(),
  fullName: text('full_name').notNull(),
  contractorId: uuid('contractor_id').references(() => contractors.id), // null = Aarisa's own
  hovershipCode: text('hovership_code').unique(), // e.g. DUB061
  phone: text('phone'),
  aliases: text('aliases').array().notNull().default(sql`'{}'::text[]`), // names used in WhatsApp
  setupComplete: boolean('setup_complete').notNull().default(true),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(), updatedAt: updatedAt(),
});

export const routes = pgTable('routes', {
  id: id(),
  operationId: uuid('operation_id').notNull().references(() => operations.id),
  code: text('code').notNull(), // 9000A
  contractorId: uuid('contractor_id').references(() => contractors.id), // contractor-owned route
  usualDriverId: uuid('usual_driver_id').references(() => drivers.id),
  active: boolean('active').notNull().default(true),
}, (t) => [uniqueIndex('routes_op_code').on(t.operationId, t.code)]);

export const serviceTypes = pgTable('service_types', {
  id: id(),
  operationId: uuid('operation_id').notNull().references(() => operations.id),
  code: text('code').notNull(), // ecommerce, hovership_packages, stat, pharma_pickup, pickup, grainger, recovery_route, other
  name: text('name').notNull(),
  unit: unitEnum('unit').notNull(),
  fromReport: boolean('from_report').notNull(),
  requiresOrderNumber: boolean('requires_order_number').notNull().default(false),
  requiresNote: boolean('requires_note').notNull().default(false),
  nameEs: text('name_es'), // Spanish label; falls back to `name`
  active: boolean('active').notNull().default(true), // inactive services stay on old records but can't be chosen
}, (t) => [uniqueIndex('service_op_code').on(t.operationId, t.code)]);

// Never update a rate; insert a new one with a later effective_from.
export const rates = pgTable('rates', {
  id: id(),
  serviceTypeId: uuid('service_type_id').notNull().references(() => serviceTypes.id),
  tier: tierEnum('tier'),
  driverId: uuid('driver_id').references(() => drivers.id), // optional override
  contractorId: uuid('contractor_id').references(() => contractors.id), // optional override
  clientRateCents: cents('client_rate_cents'),
  driverRateCents: cents('driver_rate_cents'),
  effectiveFrom: date('effective_from').notNull(),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: createdAt(),
}, (t) => [index('rates_lookup').on(t.serviceTypeId, t.tier, t.effectiveFrom)]);

// ---------- inputs ----------
export const reportImports = pgTable('report_imports', {
  id: id(),
  operationId: uuid('operation_id').notNull().references(() => operations.id),
  periodStart: date('period_start').notNull(),
  periodEnd: date('period_end').notNull(),
  channel: text('channel').notNull(), // 'email' | 'upload'
  fileName: text('file_name'),
  fileSha256: text('file_sha256'),
  fileUrl: text('file_url'),
  status: importStatusEnum('status').notNull().default('waiting'),
  columnMap: jsonb('column_map'), // detected or confirmed mapping
  rowCount: integer('row_count'),
  problems: jsonb('problems'), // unknown codes, renamed columns…
  receivedAt: timestamp('received_at', { withTimezone: true }),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('import_file_once').on(t.operationId, t.fileSha256)]);

export const dailyAssignments = pgTable('daily_assignments', {
  id: id(),
  date: date('date').notNull(),
  routeId: uuid('route_id').notNull().references(() => routes.id),
  driverId: uuid('driver_id').references(() => drivers.id),
  contractorId: uuid('contractor_id').references(() => contractors.id),
  rawName: text('raw_name'), // what someone wrote when the name wasn't recognised
  status: assignmentStatusEnum('status').notNull().default('proposed'),
  source: sourceEnum('source').notNull().default('system'),
  confirmedBy: uuid('confirmed_by').references(() => users.id),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('assignment_day_route').on(t.date, t.routeId)]);

export const extraJobs = pgTable('extra_jobs', {
  id: id(),
  clientUuid: uuid('client_uuid').notNull().unique(), // generated on the phone; makes offline sync idempotent
  operationId: uuid('operation_id').notNull().references(() => operations.id),
  serviceTypeId: uuid('service_type_id').notNull().references(() => serviceTypes.id),
  date: date('date').notNull(),
  nearRouteId: uuid('near_route_id').references(() => routes.id),
  driverId: uuid('driver_id').references(() => drivers.id),
  contractorId: uuid('contractor_id').references(() => contractors.id),
  clientAmountCents: cents('client_amount_cents'),
  driverAmountCents: cents('driver_amount_cents'),
  orderNumber: text('order_number'),
  photoUrl: text('photo_url'),
  note: text('note'),
  source: sourceEnum('source').notNull(),
  aiSuggestionId: uuid('ai_suggestion_id'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [check('extra_one_payee', sql`(${t.driverId} is null) <> (${t.contractorId} is null)`)]);

// ---------- the unified work record ----------
export const workRecords = pgTable('work_records', {
  id: id(),
  date: date('date').notNull(),
  operationId: uuid('operation_id').notNull().references(() => operations.id),
  serviceTypeId: uuid('service_type_id').notNull().references(() => serviceTypes.id),
  routeId: uuid('route_id').references(() => routes.id),
  driverId: uuid('driver_id').references(() => drivers.id),
  contractorId: uuid('contractor_id').references(() => contractors.id),
  tier: tierEnum('tier'),
  pieces: integer('pieces').notNull().default(0),
  bonusCents: cents('bonus_cents').notNull().default(0),
  // snapshots, filled when the pay period is approved
  clientRateCents: cents('client_rate_cents'),
  driverRateCents: cents('driver_rate_cents'),
  driverPayCents: cents('driver_pay_cents'),
  revenueCents: cents('revenue_cents'),
  profitCents: cents('profit_cents'),
  source: sourceEnum('source').notNull(),
  importId: uuid('import_id').references(() => reportImports.id),
  assignmentId: uuid('assignment_id').references(() => dailyAssignments.id),
  extraJobId: uuid('extra_job_id').references(() => extraJobs.id),
  payrollRunId: uuid('payroll_run_id'),
  settlementLineId: uuid('settlement_line_id'),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [
  index('work_op_date').on(t.operationId, t.date),
  index('work_driver_date').on(t.driverId, t.date),
]);

// STEM and other revenue Hovership pays that isn't tied to one driver.
export const operationRevenue = pgTable('operation_revenue', {
  id: id(),
  operationId: uuid('operation_id').notNull().references(() => operations.id),
  date: date('date').notNull(),
  kind: text('kind').notNull(), // 'stem'
  reason: text('reason'), // e.g. Benicia, Disco Bay
  amountCents: cents('amount_cents').notNull(),
  importId: uuid('import_id').references(() => reportImports.id),
});

export const exceptions = pgTable('exceptions', {
  id: id(),
  operationId: uuid('operation_id').notNull().references(() => operations.id),
  periodStart: date('period_start').notNull(),
  date: date('date').notNull(),
  routeId: uuid('route_id').references(() => routes.id),
  type: exceptionTypeEnum('type').notNull(),
  workRecordId: uuid('work_record_id').references(() => workRecords.id),
  assignmentId: uuid('assignment_id').references(() => dailyAssignments.id),
  details: jsonb('details'), // pieces, usual range, raw name…
  status: exceptionStatusEnum('status').notNull().default('open'),
  resolution: resolutionEnum('resolution'),
  resolvedBy: uuid('resolved_by').references(() => users.id),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index('exceptions_open').on(t.operationId, t.periodStart, t.status)]);

// ---------- payroll ----------
export const payPeriods = pgTable('pay_periods', {
  id: id(),
  operationId: uuid('operation_id').notNull().references(() => operations.id),
  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),
}, (t) => [uniqueIndex('period_op_start').on(t.operationId, t.startDate)]);

export const payrollRuns = pgTable('payroll_runs', {
  id: id(),
  payPeriodId: uuid('pay_period_id').notNull().references(() => payPeriods.id).unique(),
  status: runStatusEnum('status').notNull().default('draft'),
  totals: jsonb('totals'), // snapshot at approval
  approvedBy: uuid('approved_by').references(() => users.id),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  reopenableUntil: timestamp('reopenable_until', { withTimezone: true }),
  exportUrl: text('export_url'),
  paidAt: timestamp('paid_at', { withTimezone: true }),
});

export const payrollLines = pgTable('payroll_lines', {
  id: id(),
  runId: uuid('run_id').notNull().references(() => payrollRuns.id),
  driverId: uuid('driver_id').references(() => drivers.id),
  contractorId: uuid('contractor_id').references(() => contractors.id),
  routeDays: integer('route_days').notNull(),
  extraJobs: integer('extra_jobs').notNull().default(0),
  pieces: integer('pieces').notNull(),
  stops: integer('stops').notNull().default(0), // Hovership stat stops, kept apart from packages
  bonusCents: cents('bonus_cents').notNull(),
  payCents: cents('pay_cents').notNull(),
  marginCents: cents('margin_cents').notNull(),
});

// ---------- settlements ----------
export const settlementLines = pgTable('settlement_lines', {
  id: id(),
  operationId: uuid('operation_id').notNull().references(() => operations.id),
  kind: settlementKindEnum('kind').notNull(),
  reference: text('reference'), // invoice #, settlement #, order #
  periodStart: date('period_start'),
  periodEnd: date('period_end'),
  extraJobId: uuid('extra_job_id').references(() => extraJobs.id),
  expectedCents: cents('expected_cents'),
  expectedDate: date('expected_date'),
  status: settlementStatusEnum('status').notNull().default('open'),
  createdAt: createdAt(), updatedAt: updatedAt(),
});

export const paymentsReceived = pgTable('payments_received', {
  id: id(),
  operationId: uuid('operation_id').notNull().references(() => operations.id),
  receivedOn: date('received_on').notNull(),
  amountCents: cents('amount_cents').notNull(),
  method: text('method'), // ACH…
  reference: text('reference'),
  note: text('note'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: createdAt(),
});

export const paymentAllocations = pgTable('payment_allocations', {
  id: id(),
  paymentId: uuid('payment_id').notNull().references(() => paymentsReceived.id),
  settlementLineId: uuid('settlement_line_id').notNull().references(() => settlementLines.id),
  amountCents: cents('amount_cents').notNull(),
});

export const claims = pgTable('claims', {
  id: id(),
  settlementLineId: uuid('settlement_line_id').notNull().references(() => settlementLines.id),
  status: text('status').notNull().default('draft'), // draft | sent | resolved
  sentTo: text('sent_to'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  pdfUrl: text('pdf_url'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: createdAt(),
});

// ---------- WhatsApp and AI ----------
export const messages = pgTable('messages', {
  id: id(),
  waMessageId: text('wa_message_id').unique(),
  direction: text('direction').notNull(), // in | out
  phone: text('phone').notNull(),
  userId: uuid('user_id').references(() => users.id),
  type: text('type').notNull(), // text | audio | interactive | template
  body: text('body'),
  mediaUrl: text('media_url'),
  transcript: text('transcript'),
  relatedDate: date('related_date'),
  createdAt: createdAt(),
});

export const aiSuggestions = pgTable('ai_suggestions', {
  id: id(),
  kind: text('kind').notNull(), // daily_changes | extra_job
  messageId: uuid('message_id').references(() => messages.id),
  inputText: text('input_text').notNull(),
  model: text('model').notNull(),
  output: jsonb('output').notNull(),
  status: aiStatusEnum('status').notNull().default('pending'),
  confirmedBy: uuid('confirmed_by').references(() => users.id),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  createdAt: createdAt(),
});

// ---------- audit ----------
export const auditLog = pgTable('audit_log', {
  id: id(),
  tableName: text('table_name').notNull(),
  recordId: uuid('record_id').notNull(),
  action: text('action').notNull(), // insert | update | delete | approve | reopen | undo
  before: jsonb('before'),
  after: jsonb('after'),
  userId: uuid('user_id').references(() => users.id),
  source: auditSourceEnum('source').notNull(),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('audit_record').on(t.tableName, t.recordId)]);
