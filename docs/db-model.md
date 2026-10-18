# Aarisa database model (redesign, Oct 2026)

Target model after the review in `docs/db-redesign.md`. Two schemas in the same database:

- `core`: the transactional model the app reads and writes (normalised, 3NF).
- `analytics`: the Kimball star schema for reports and Power BI, rebuilt from `core`.

Nothing here is migrated yet. Sections marked **provisional** wait for the client (open questions #38–#43).

## 1. Naming conventions

### Both schemas

| Item | Rule | Example |
|---|---|---|
| Names | `snake_case`, English, no abbreviations except `qty`, `bp` | `payment_terms_days` |
| Money in `core` | integer cents, `bigint`, suffix `_cents` | `pay_cents` |
| Money in `analytics` | dollars, `numeric(12,2)`, suffix `_amount` | `pay_amount` |
| Percentages | basis points, `integer`, suffix `_bp` (10 % = 1000) | `fee_bp` |
| Calendar dates | `date`, suffix `_date` | `work_date` |
| Moments | `timestamptz`, suffix `_at` | `approved_at` |
| Booleans | prefix `is_` / `has_` / `requires_` | `is_active` |
| Codes people type | suffix `_code`, unique in their scope | `route_code` |
| Closed lists | Postgres enum, suffix `_status`, `_type`, `_kind`, `_side`, `_source` | `execution_status` |
| Versioned rows | `effective_from` only; the end is the next row's start | `rates` |
| Rules with an end | `valid_from`, `valid_to` (null = open) | `bonus_rules` |

### `core` keys

| Item | Rule | Example |
|---|---|---|
| Table | plural noun | `drivers` |
| Primary key | `<singular>_id`, `uuid`, default `gen_random_uuid()` | `drivers.driver_id` |
| Foreign key | same name as the key it points to | `route_executions.driver_id` |
| Role-playing foreign key | `<role>_<key>` when one table points twice to the same table or the role isn't obvious | `usual_driver_id`, `approved_by_user_id` |
| Audit columns | `created_at`, `created_by_user_id`, `updated_at`, `updated_by_user_id` where rows change | |

### `analytics` keys (Kimball)

| Item | Rule | Example |
|---|---|---|
| Dimension | `dim_<singular>` | `dim_payee` |
| Fact | `fact_<grain>` | `fact_work` |
| Bridge | `bridge_<a>_<b>` | (none needed yet) |
| Surrogate key | `<dim>_key`, `integer`, meaningless | `payee_key` |
| Date key | `date_key`, `integer` `YYYYMMDD`; role-playing as `<role>_date_key` | `due_date_key` |
| Natural (durable) key | the `core` id, kept as `<singular>_id` | `dim_payee.payee_id` |
| Degenerate dimension | an id or number kept on the fact with no dimension | `order_number` |
| Unknown member | key `-1` in every dimension ("Unknown", "No route", "No driver") | |
| SCD type 2 columns | `row_effective_date`, `row_expiration_date` (`9999-12-31` when current), `is_current_row` | `dim_payee` |

## 2. `core`: transactional model

### 2.1 Control

**users**: people who sign in to the portal.
`user_id` PK · `zitadel_sub` U · `full_name` · `email` U · `phone_e164` · `user_role` (owner, dispatcher, finance, viewer) · `morning_channel` (whatsapp, email, none) · `locale` (en, es) · `is_active` · `created_at` · `updated_at`

**audit_log**: every write, in the same transaction.
`audit_log_id` PK · `table_name` · `record_id` (any table, so no FK) · `audit_action` (insert, update, delete, approve, reopen, undo, confirm) · `before_data` jsonb · `after_data` jsonb · `user_id` FK · `audit_source` (portal, whatsapp, email_import, system) · `ai_suggestion_id` FK (the WhatsApp suggestion that caused the change) · `occurred_at`
Index (`table_name`, `record_id`), (`occurred_at`), (`user_id`).

### 2.2 Clients and contracts

**clients**: the company Aarisa works for.
`client_id` PK · `client_code` U · `display_name` · `legal_name` · `tax_id` · `billing_address` · `currency_code` (USD) · `notes` · `is_active` · `created_at` · `updated_at`

**client_contacts**: people at the client.
`client_contact_id` PK · `client_id` FK · `contact_role` (billing, claims, operations, other) · `full_name` · `email` · `phone_e164` · `is_primary` · `is_active` · `created_at` · `updated_at`
At most one primary contact per (`client_id`, `contact_role`).

**operations**: one contract with a client, and how it works.
`operation_id` PK · `client_id` FK · `operation_code` U · `operation_name` · `driver_source` (report_code, daily_list) · `pay_cycle` (weekly, biweekly) · `cycle_anchor_date` · `payment_terms_days` · `blocks_payroll_on_exceptions` · `low_quantity_threshold_bp` · `start_date` · `end_date` · `is_active` · `created_at` · `updated_at`

**report_layouts**: how a client's report is read (premise 1).
`report_layout_id` PK · `operation_id` FK · `layout_name` · `sheet_name` · `header_row` · `date_format` · `is_active` · `created_at` · `created_by_user_id`

**report_layout_columns**: what each column of the report means.
`report_layout_column_id` PK · `report_layout_id` FK · `source_column_name` · `column_meaning` (work_date, driver_code, route_code, quantity, other_revenue, other_revenue_reason, ignore) · `service_type_id` FK · `service_tier_id` FK · `revenue_type_id` FK
Unique (`report_layout_id`, `source_column_name`). A `quantity` column needs a service; an `other_revenue` column needs a revenue type.

### 2.3 Payees, drivers and contractors

**payees**: everyone Aarisa pays (and Aarisa itself as the own company, never paid).
`payee_id` PK · `payee_type` (driver, contractor) · `display_name` · `tax_id_masked` · `payment_method` (ach, check, zelle, cash) · `email` · `phone_e164` U · `postal_address` · `is_active` · `created_at` · `updated_at`
The name lives only here.

**drivers**: what is specific to a person who drives.
`driver_id` PK · `payee_id` FK U (payee_type = driver) · `hire_date` · `termination_date` · `is_setup_complete` · `created_at` · `updated_at`

**driver_aliases**: names people use for the driver on WhatsApp.
`driver_alias_id` PK · `driver_id` FK · `alias_text` (lower-case, trimmed) U

**driver_client_codes**: the code each client uses for the driver (e.g. Hovership `DUB006`).
`driver_client_code_id` PK · `driver_id` FK · `operation_id` FK · `driver_code` · `valid_from` · `valid_to`
Unique (`operation_id`, `driver_code`).

**contractors**: companies that own routes, Aarisa included.
`contractor_id` PK · `payee_id` FK U (payee_type = contractor) · `legal_name` · `contact_name` · `is_own_company` · `pay_trigger` (payroll, on_collection) · `pay_basis` (per_unit, per_route_day, fixed) · `fee_bp` · `start_date` · `end_date` · `created_at` · `updated_at`
Exactly one row with `is_own_company` (Aarisa). Puma: `pay_trigger = on_collection`.

**driver_affiliations**: which company a driver belongs to, with history.
`driver_affiliation_id` PK · `driver_id` FK · `contractor_id` FK · `valid_from` · `valid_to`

### 2.4 Routes, services and rates

**routes**
`route_id` PK · `operation_id` FK · `route_code` · `usual_driver_id` FK → drivers · `is_active` · `created_at` · `updated_at`
Unique (`operation_id`, `route_code`).

**route_ownerships**: who owns a route from a date (Aarisa or a contractor).
`route_ownership_id` PK · `route_id` FK · `contractor_id` FK · `effective_from` · `note` · `created_at` · `created_by_user_id`
Unique (`route_id`, `effective_from`).

**route_types** (kept ready, open question #41)
`route_type_id` PK · `operation_id` FK · `route_type_code` · `route_type_name` · `is_active`
Unique (`operation_id`, `route_type_code`).

**route_type_assignments**: a route's type from a date.
`route_type_assignment_id` PK · `route_id` FK · `route_type_id` FK · `effective_from`
Unique (`route_id`, `effective_from`).

**service_types**
`service_type_id` PK · `operation_id` FK · `service_code` · `service_name` · `service_name_es` · `unit_type` (package, stop, piece, job) · `is_from_report` · `requires_order_number` · `requires_note` · `is_active`
Unique (`operation_id`, `service_code`).

**service_tiers**: levels defined per service (premise 2).
`service_tier_id` PK · `service_type_id` FK · `tier_code` · `tier_name` · `sort_order` · `min_qty` · `max_qty` · `is_active`
Unique (`service_type_id`, `tier_code`). `min_qty`/`max_qty` stay empty for client-labelled tiers.

**rate_agreements**: one negotiation that changes rates from a date.
`rate_agreement_id` PK · `operation_id` FK · `rate_side` (client, payee) · `effective_from` · `reason` · `document_url` · `created_at` · `created_by_user_id`
Unique (`rate_agreement_id`, `rate_side`, `effective_from`) so `rates` can point to all three.

**rates**: never updated; a change is a new agreement.
`rate_id` PK · `rate_agreement_id` FK · `rate_side` · `effective_from` · `service_type_id` FK · `service_tier_id` FK · `route_type_id` FK · `payee_id` FK · `rate_cents` ≥ 0
FK (`rate_agreement_id`, `rate_side`, `effective_from`) → rate_agreements: the copy can't drift.
Unique (`service_type_id`, `service_tier_id`, `route_type_id`, `payee_id`, `rate_side`, `effective_from`) nulls not distinct.
Lookup on a work date: payee → route type → general.

**zones**: places, shared by every client.
`zone_id` PK · `zone_code` U · `zone_name` · `is_active` · `created_at`

**zone_aliases**: how a zone arrives written.
`zone_alias_id` PK · `zone_id` FK · `alias_text` (lower-case, trimmed) U

**revenue_types**: revenue that isn't driver work (STEM).
`revenue_type_id` PK · `operation_id` FK · `revenue_type_code` · `revenue_type_name` · `counts_in_payee_margin` (false for STEM)
Unique (`operation_id`, `revenue_type_code`).

**adjustment_types**: kinds of pay adjustment.
`adjustment_type_id` PK · `adjustment_type_code` U · `adjustment_type_name` · `adjustment_type_name_es` · `adjustment_class` (bonus, goal_top_up, correction, deduction) · `is_active`
Seed: one type per class plus the owner's bonus types (hard route, weekend…).

**bonus_rules**: standing bonuses (premise 4). Each proposes a `pay_adjustments` row.
`bonus_rule_id` PK · `adjustment_type_id` FK (class bonus) · `operation_id` FK · `payee_id` FK · `route_id` FK · `weekdays` smallint[] · `on_date` · `amount_cents` > 0 · `valid_from` · `valid_to` · `created_at` · `created_by_user_id`
`weekdays` and `on_date` never both set. Never edited.

**daily_goals**: expected result of a day (kept ready).
`daily_goal_id` PK · `operation_id` FK · `payee_id` FK · `route_id` FK · `weekdays` smallint[] · `goal_metric` (pay, quantity) · `service_type_id` FK · `target_value` · `goal_action` (track, top_up) · `valid_from` · `valid_to` · `created_at` · `created_by_user_id`

### 2.5 Inputs

**report_imports**
`report_import_id` PK (header only; rows below) · `operation_id` FK · `report_layout_id` FK · `pay_period_id` FK · `period_start_date` · `period_end_date` · `import_channel` (email, upload) · `file_name` · `file_sha256` · `file_url` · `import_status` (waiting, reading, layout_changed, partial, done, failed) · `row_count` · `problems` jsonb · `received_at` · `created_at` · `created_by_user_id`
Unique (`operation_id`, `file_sha256`).

**report_import_rows**: each row of the file exactly as it arrived.
`report_import_row_id` PK · `report_import_id` FK · `row_number` · `raw_data` jsonb · `row_status` (ok, warning, error, ignored) · `problem_code` · `problem_text`
Unique (`report_import_id`, `row_number`). Lets the import screen show which row failed and reprocess it.

**messages**: WhatsApp in and out.
`message_id` PK · `wa_message_id` U · `message_direction` (inbound, outbound) · `phone_e164` · `user_id` FK · `payee_id` FK · `message_type` (text, audio, interactive, template) · `body` · `media_url` · `transcript` · `related_date` · `created_at`

**ai_suggestions**: never final data until a person confirms.
`ai_suggestion_id` PK · `suggestion_kind` (daily_changes, extra_job) · `message_id` FK · `input_text` (only when there is no message) · `model_name` · `output_data` jsonb · `suggestion_status` (pending, applied, partially_applied, rejected) · `confirmed_by_user_id` · `confirmed_at` · `created_at`

### 2.6 Work

**route_executions**: one payee, one day, one route (or none), one operation.
`route_execution_id` PK · `operation_id` FK · `work_date` · `route_id` FK · `execution_kind` (route, extra) · `payee_id` FK · `driver_id` FK (who drove) · `raw_name` · `execution_status` (proposed, confirmed, changed, waiting, no_driver) · `execution_source` (client_report, daily_list, whatsapp, manual, system) · `report_import_id` FK · `agreed_client_amount_cents` · `confirmed_by_user_id` · `confirmed_at` · `created_at` · `updated_at`
Unique (`operation_id`, `work_date`, `route_id`) where `execution_kind = route` and `route_id` is set.
Unique (`operation_id`, `work_date`, `payee_id`) where `execution_kind = route` and `route_id` is null.
`confirmed` and `changed` need a payee; `no_driver` has none; `confirmed_at` only when confirmed or changed. The own company is never the payee.

**extra_jobs**: work agreed by phone.
`extra_job_id` PK · `client_uuid` U · `route_execution_id` FK (kind = extra) · `service_type_id` FK · `near_route_id` FK → routes · `client_amount_cents` · `payee_amount_cents` · `order_number` · `photo_url` · `note` · `ai_suggestion_id` FK · `created_at` · `created_by_user_id` · `updated_at`

**work_records**: what was done in an execution.
`work_record_id` PK · `route_execution_id` FK · `service_type_id` FK · `service_tier_id` FK · `quantity` ≥ 0 · `report_import_id` FK · `report_import_row_id` FK · `extra_job_id` FK U · `client_rate_cents` · `payee_rate_cents` · `revenue_cents` · `pay_cents` · `payroll_line_id` FK · `created_at` · `updated_at`
Unique (`route_execution_id`, `service_type_id`, `service_tier_id`) nulls not distinct, where `extra_job_id` is null.
The four money columns are all set (frozen at approval) or all null. Profit is never stored.

**pay_adjustments**: everything added to or taken from a payee's pay besides quantity × rate.
`pay_adjustment_id` PK · `pay_period_id` FK (the period it is paid in) · `payee_id` FK · `route_execution_id` FK (the day it refers to; for a correction, the original day) · `adjustment_type_id` FK · `bonus_rule_id` FK · `daily_goal_id` FK · `amount_cents` · `reason` · `adjustment_source` (manual, rule, goal) · `adjustment_status` (proposed, confirmed, rejected) · `confirmed_by_user_id` · `confirmed_at` · `created_at` · `created_by_user_id`
Bonus and goal top-up are > 0; correction can be either sign; deduction is < 0. A manual row or a changed amount needs a reason.
Unique (`route_execution_id`, `bonus_rule_id`) and (`route_execution_id`, `daily_goal_id`).
Payee and period must match the execution's operation; `payee_id` repeats the execution's payee except for corrections and deductions that have no execution.
**Closing rule**: an approved run locks its executions, work records and adjustments. Owner reopen within 24 h stays; after that a fix is a `correction` in the next open period of the same operation, pointing to the original execution.

**other_revenues** (was `operation_revenue`): STEM and similar.
`other_revenue_id` PK · `operation_id` FK · `revenue_date` · `revenue_type_id` FK · `route_execution_id` FK · `zone_id` FK · `reason_text` (as received) · `amount_cents` · `classification_status` (classified, needs_review, lump_adjustment) · `report_import_id` FK · `created_at`

**exceptions**: what the weekly check found.
`exception_id` PK · `pay_period_id` FK · `route_execution_id` FK · `work_record_id` FK · `exception_type` (no_driver, unknown_name, no_quantity, low_quantity, unknown_driver_code, missing_rate, negative_margin, two_routes_same_day, payee_not_route_owner) · `details` jsonb · `exception_status` (open, resolved) · `resolution` · `resolved_by_user_id` · `resolved_at` · `created_at`

### 2.7 Payroll

**pay_periods**
`pay_period_id` PK · `operation_id` FK · `start_date` · `end_date` · `created_at`
Unique (`operation_id`, `start_date`); `end_date` follows the pay cycle.

**payroll_runs**
`payroll_run_id` PK · `pay_period_id` FK U · `run_status` (draft, ready, approved, reopened, paid) · `approved_by_user_id` · `approved_at` · `reopenable_until` · `export_url` · `paid_at` · `created_at` · `updated_at`

**payroll_lines**: what one payee is paid in one run (frozen at approval).
`payroll_line_id` PK · `payroll_run_id` FK · `payee_id` FK · `route_day_count` · `extra_job_count` · `quantity_total` · `adjustment_cents` · `pay_cents` · `revenue_cents` · `created_at`
Unique (`payroll_run_id`, `payee_id`). Contractors with `pay_trigger = on_collection` are not in the weekly run.

### 2.8 Receivables (provisional, open questions #38–#40)

**receivables**: one document Aarisa expects to be paid on.
`receivable_id` PK · `client_id` FK · `operation_id` FK · `receivable_kind` (invoice, weekly_statement, manual_adjustment, claim) · `reference` · `period_start_date` · `period_end_date` · `issue_date` · `due_date` · `receivable_status` (issued, disputed, written_off) · `created_at` · `updated_at`

**receivable_items**: what each document covers, line by line.
`receivable_item_id` PK · `receivable_id` FK · `work_record_id` FK · `other_revenue_id` FK · `route_execution_id` FK (agreed amount) · `order_number` · `description` · `expected_cents`
Exactly one source per item; a work record is billed once.

**payments_received**
`payment_received_id` PK · `client_id` FK · `received_date` · `amount_cents` > 0 · `payment_method` · `bank_reference` · `note` · `created_at` · `created_by_user_id`

**remittance_lines**: what the client says it paid.
`remittance_line_id` PK · `payment_received_id` FK · `order_number` · `route_code` · `line_date` · `amount_cents` · `receivable_item_id` FK (once matched)

**payment_allocations**
`payment_allocation_id` PK · `payment_received_id` FK · `receivable_item_id` FK · `amount_cents` > 0
Unique (`payment_received_id`, `receivable_item_id`).

**claims**
`claim_id` PK · `client_id` FK · `client_contact_id` FK · `claim_status` (draft, sent, accepted, rejected, adjusted, written_off) · `adjusted_order_number` · `sent_at` · `pdf_url` · `created_at` · `created_by_user_id` · `updated_at`

**claim_items**
`claim_item_id` PK · `claim_id` FK · `receivable_item_id` FK · `claimed_cents`
Unique (`claim_id`, `receivable_item_id`).

**partner_transfers**: money passed to an on-collection partner (Puma).
`partner_transfer_id` PK · `contractor_id` FK · `payment_received_id` FK · `amount_cents` · `fee_cents` · `transferred_date` · `bank_reference` · `created_at` · `created_by_user_id`

### 2.9 Calculated views (no tables)

- `v_rate_timeline`: each rate with its end date (next `effective_from`).
- `v_route_owner_on_date`, `v_driver_affiliation_on_date`.
- `v_execution_totals`: per execution, revenue, pay, adjustments, other revenue, profit.
- `v_receivable_item_status`: expected, received, outstanding, days late, paid to payee, status.
- `v_period_checklist`: report imported, daily list complete, open exceptions, extra jobs, run approved, settlement checked.

### 2.10 Relationships

```
clients 1─< client_contacts
clients 1─< operations 1─< routes 1─< route_ownerships >─1 contractors
                       │          1─< route_type_assignments >─1 route_types
                       1─< service_types 1─< service_tiers
                       1─< rate_agreements 1─< rates
                       1─< report_layouts 1─< report_layout_columns
                       1─< pay_periods 1─1 payroll_runs 1─< payroll_lines >─1 payees
payees 1─1 drivers 1─< driver_client_codes, driver_aliases, driver_affiliations >─1 contractors
payees 1─1 contractors
route_executions >─1 operations, routes, payees, drivers
route_executions 1─< work_records >─1 service_types, service_tiers
                 1─< pay_adjustments >─1 adjustment_types, bonus_rules, daily_goals, pay_periods
                 1─< other_revenues >─1 revenue_types, zones
                 1─< extra_jobs
work_records >─1 payroll_lines
receivables 1─< receivable_items >─1 work_records | other_revenues | route_executions
payments_received 1─< payment_allocations >─1 receivable_items
payments_received 1─< remittance_lines
claims 1─< claim_items >─1 receivable_items
```

## 3. `analytics`: Kimball star schema

Rebuilt from `core` every night and when a payroll run is approved. Read-only for people.

### 3.1 Dimensions

| Dimension | Grain | Natural key | Main attributes | Type |
|---|---|---|---|---|
| `dim_date` | one calendar day | `full_date` | `date_key` YYYYMMDD, day name EN/ES, ISO week, week start, month, quarter, year, `is_weekend` | static |
| `dim_operation` | one contract | `operation_id` | operation code and name, client code and name, pay cycle, payment terms, driver source | SCD 1 |
| `dim_payee` | one payee version | `payee_id` | name, payee type, company (Aarisa / Puma…), `is_own_company`, pay trigger, client codes | SCD 2 on company |
| `dim_route` | one route version | `route_id` | route code, operation, owner, `owner_is_own_company`, route type | SCD 2 on owner and type |
| `dim_service` | one service + tier | `service_type_id`, `service_tier_id` | service code and name EN/ES, unit, tier code and name, `is_from_report` | SCD 1 |
| `dim_pay_period` | one pay period | `pay_period_id` | operation, start, end, run status | SCD 1 |
| `dim_zone` | one zone | `zone_id` | zone code and name | SCD 1 |
| `dim_adjustment_type` | one adjustment type | `adjustment_type_id` | code, name EN/ES, class | SCD 1 |
| `dim_revenue_type` | one revenue type | `revenue_type_id` | code, name, counts in payee margin | SCD 1 |
| `dim_execution_profile` | one combination (junk) | — | execution kind, status, source | static |
| `dim_exception_type` | one type + resolution (junk) | — | exception type, resolution | static |

`dim_payee` plays two roles on facts: `payee_key` (who is paid) and `driver_key` (who drove).

### 3.2 Facts

| Fact | Type | Grain | Dimension keys | Degenerate | Measures |
|---|---|---|---|---|---|
| `fact_work` | transaction | one work record | `date_key`, `operation_key`, `payee_key`, `driver_key`, `route_key`, `service_key`, `pay_period_key`, `execution_profile_key` | `route_execution_id`, `order_number` | `quantity`, `revenue_amount`, `pay_amount` |
| `fact_route_execution` | transaction | one execution | `date_key`, `operation_key`, `payee_key`, `driver_key`, `route_key`, `pay_period_key`, `execution_profile_key` | `route_execution_id` | `route_day_count`, `quantity_total`, `revenue_amount`, `pay_amount`, `adjustment_amount`, `other_revenue_amount`, `profit_amount`, `goal_target`, `goal_attainment_bp` |
| `fact_pay_adjustment` | transaction | one pay adjustment | `date_key` (day it refers to), `paid_period_key`, `operation_key`, `payee_key`, `route_key`, `adjustment_type_key` | `pay_adjustment_id`, `bonus_rule_id` | `adjustment_amount` |
| `fact_other_revenue` | transaction | one STEM or similar | `date_key`, `operation_key`, `payee_key`, `zone_key`, `revenue_type_key` | `other_revenue_id` | `revenue_amount` |
| `fact_payroll_line` | periodic snapshot | one payee in one approved run | `pay_period_key`, `operation_key`, `payee_key`, `approved_date_key` | `payroll_run_id` | `route_day_count`, `extra_job_count`, `quantity_total`, `adjustment_amount`, `pay_amount`, `revenue_amount` |
| `fact_exception` | accumulating snapshot | one exception | `created_date_key`, `resolved_date_key`, `operation_key`, `route_key`, `payee_key`, `exception_type_key` | `exception_id` | `exception_count`, `days_open` |
| `fact_receivable_item` (provisional) | accumulating snapshot | one receivable item | `issue_date_key`, `due_date_key`, `paid_date_key`, `payee_paid_date_key`, `operation_key`, `payee_key`, `route_key`, `service_key` | `receivable_id`, `order_number` | `expected_amount`, `received_amount`, `outstanding_amount`, `days_late`, `paid_to_payee_not_collected_amount` |

Every fact uses `-1` for a missing dimension (no route, no driver, no zone).

### 3.3 Star diagram

```
                       dim_date
                          │
 dim_operation ── fact_route_execution ── dim_payee (payee, driver)
                          │
                       dim_route ── dim_pay_period ── dim_execution_profile

 fact_work            → dim_date, dim_operation, dim_payee, dim_route, dim_service, dim_pay_period
 fact_pay_adjustment  → dim_date, dim_pay_period, dim_operation, dim_payee, dim_route, dim_adjustment_type
 fact_other_revenue   → dim_date, dim_operation, dim_payee, dim_zone, dim_revenue_type
 fact_payroll_line    → dim_pay_period, dim_operation, dim_payee, dim_date (approved)
 fact_exception       → dim_date (created, resolved), dim_operation, dim_route, dim_payee, dim_exception_type
 fact_receivable_item → dim_date (issue, due, paid, payee paid), dim_operation, dim_payee, dim_route, dim_service
```

Shared (conformed) dimensions: `dim_date`, `dim_operation`, `dim_payee`, `dim_route`, so payroll, work and
receivables can be compared in one report.
