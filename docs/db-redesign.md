# Database redesign (Oct 2026)

Decision log for the review of every table before real data goes in. Nothing here is migrated yet;
the changes ship together as one set of migrations once the review is finished.
Goal: a clean transactional model (OLTP) plus a star schema in an `analytics` schema fed from it.

## Classification

- **Master data**: operations, contractors, drivers, routes, service_types, rates (versioned by date), users.
- **Transactional**: report_imports, daily_assignments, extra_jobs, work_records, operation_revenue,
  exceptions, pay_periods, payroll_runs, payroll_lines, settlement_lines, payments_received,
  payment_allocations, claims, messages, ai_suggestions.
- **Log**: audit_log (outside the star).

## Decided

### Any number of clients (approved Oct 18, 2026)
A new client must be configuration, not code, unless its report format is truly new.
- New `clients` table (company, billing contact, billing and claims email). `operations` becomes the
  contract with a client (`client_id`).
- Client rules move to `operations`: `driver_source` (`report_code` | `daily_list`),
  `block_payroll_on_exceptions`, plus the existing pay cycle and payment terms.
- `driver_client_codes (driver_id, operation_id, code, valid_from, valid_to)`, unique
  `(operation_id, code)`, replaces `drivers.hovership_code`.
- Generic enums: `source` → `client_report | daily_list | extra_job | manual | whatsapp | system`;
  `settlement_kind` → `invoice | weekly_statement | extra_job | claim_adjustment`.
- `rate_tiers` per service type replaces the fixed `tier` enum (`t1_3`, `t4`).
- `report_layouts` per operation stores the column map as a template.

### payees (approved Oct 18, 2026)
- New parent table `payees` = everyone Aarisa pays: `kind` (`driver` | `contractor`), display name,
  tax id (masked), payment method, email, phone, address, active, timestamps.
- `drivers.payee_id` and `contractors.payee_id` (1:1). The person or company details stay there.
- `work_records`, `daily_assignments`, `extra_jobs`, `rates` and `payroll_lines` replace
  `driver_id` + `contractor_id` with one `payee_id`; the five "one payee" checks go away.
- Star: `payees` becomes `dim_payee`.

### Owner premises (Oct 18, 2026)
1. **No client name is hard-coded** (Hovership is just the first well-structured report).
   `report_layouts (operation_id, name, sheet, header_row, date_format, active)` and
   `report_layout_columns (layout_id, column_name, meaning, service_type_id, tier_id)`, where
   meaning is `date | driver_code | route_code | quantity | bonus | other_revenue | ignore`.
2. **Rate tiers are defined per client.** `service_tiers (service_type_id, code, name, sort_order,
   active)`, unique `(service_type_id, code)`. `rates.tier_id` and `work_records.tier_id` point to it;
   the tier must belong to the record's service. Pieces are stored per tier as the client sends them
   (no more summing T1–T3); equal rates are just equal rate rows.
   - **Rate history (owner, Oct 18, 2026):** T1–T3 share a rate and T4 has its own today, but the
     user must be able to change any tier's rate later (renegotiations) and keep the full history.
     Rates are never updated: a change inserts a new row with its effective date. Proposed:
     `rate_agreements` (operation_id, side `client | payee`, effective_from, reason, document_url,
     created_by) groups the rate rows changed together in one renegotiation; client and payee rates
     become separate rows (`side`) so changing one doesn't copy the other; unique
     `(service_type_id, tier_id, side, payee_id, effective_from)` with nulls not distinct; the end of
     a rate is derived (next effective_from), not stored. Back-dated changes only touch periods not
     yet approved. `addRate` today hard-codes `hovership_packages` as the only tiered service.
   - **STEM (owner, Oct 18, 2026):** revenue for Aarisa only: it counts in operation profit, never in
     driver pay or per-driver margin. `operation_revenue` becomes generic other revenue:
     `revenue_types (operation_id, code, name, counts_in_driver_margin = false)`; rows keep
     `execution_id` (optional) so we still know which driver-day it came from, plus reason, amount,
     import_id and created_at.
3. **Bonuses are set by Aarisa** and vary by driver, by route and by each day's execution.
   - `bonus_types (code, name, name_es, active)`.
   - `bonuses (execution_id, bonus_type_id, bonus_rule_id?, amount_cents, reason, source
     manual | rule, status proposed | confirmed | rejected, created_by, created_at)`. The client
     report never carries a bonus.
4. **Standing bonuses (approved Oct 18, 2026):** the owner sets a bonus once and the system proposes
   it on every execution that matches; a person confirms, changes (with a reason) or removes it.
   `bonus_rules (bonus_type_id, operation_id, payee_id?, route_id?, weekdays smallint[]?, on_date?,
   amount_cents > 0, valid_from, valid_to, created_by, created_at)`; empty = any; weekdays and
   on_date don't combine; never edited (close with valid_to and add a new one). Within one bonus type
   the most specific rule wins (payee+route+day > payee+route > payee+day > route+day > payee >
   route > day > general); different types add up. Payroll shows which rule made each bonus and which
   were set aside. Empty table = only manual bonuses.
   - `work_records.bonus_cents` goes away. Driver pay = Σ quantity × tier rate + Σ bonuses.
- **Real Hovership report (owner, Oct 18, 2026):** POD Date, DriverCode, DriverNameCode,
  Tier 1, Tier 2, Tier 3, Tier 4, Stat, Stem, Stem Reason. No route and no bonus. Bonus, Total Route
  and Total Profit in the seed CSV were added in Aarisa's own workbook, yet the current importer
  requires `bonus`, so it must become optional. Tiers come labelled by the client, which fits
  `service_tiers`. The bonus is added by Aarisa to a driver on a given date (answers open question
  #19: bonuses start at zero). For Hovership an execution is driver × day with no route, so a
  bonus is per driver per day; per-route bonuses only apply to clients whose executions carry a route.
- **Details NEW check (319 rows, Jun 1 – Jul 10, 2026):** one row per (date, driver code), no
  duplicates, every row has work, no negative or fractional counts, Mon–Fri only, 6–16 drivers a day,
  31 codes. Fits one execution per driver per day. Rates fit all 319 rows exactly (client T1–3 $3.00,
  T4 $2.00, Stat $10.00; driver $2.50, $1.75, $5.00); `total_route` = driver pay incl. bonus and
  `total_route + total_profit` = revenue incl. STEM. Data issues: DUB088 also appears as "(blank)";
  codes mix widths (DUB014, DUB26, DUB9); Stem Reason is dirty (Diablo/DIABLO/DIablo, Pitsburg,
  Pittrsburg Martinez…, 2 STEM rows with no reason) → a `zones` catalog with aliases. Bonus vs STEM:
  equal on 59 days, higher on 32, lower on 8, bonus without STEM on 51, STEM without bonus on 57
  (open question #3). 43 driver-days have negative profit.
  - Owner, Oct 18, 2026: the bonus is **not** tied to STEM (no "equal to STEM" rule); it stays a free
    amount. The UI may show that day's STEM next to the bonus as a reference only.
  - **Zones catalog (approved Oct 18, 2026, option A):** global `zones (code, name, active,
    created_at)` and `zone_aliases (zone_id, alias)` with the alias stored lower-case and trimmed,
    unique. Seed: Benicia, Diablo, Discovery Bay ("Disco Bay"), Orinda, Pittsburg, Livermore, Sunol,
    Alamo, Alameda, Antioch, Martinez, Castro Valley, Crockett, Dublin Hills, Richmond, plus the
    combined zones "Pittsburg + Martinez" and "Richmond + Crockett" as zones of their own (no
    double counting). `operation_revenue.zone_id` is optional and `reason` keeps the original text.
    An unknown zone is flagged on import and mapped once (the alias is saved). A STEM with no
    reason or far above normal is flagged for review (Details NEW has $1,075 and $102 with no reason).
  - Owner, Oct 18, 2026: a Hovership driver does **not** always work one zone a day, so the zone is not
    the execution's route. Hovership executions have no route; `zones` (with aliases) only classifies
    the STEM reason on each `operation_revenue` row.
- **Real T-Force report (owner, Oct 18, 2026):** Order Date, Paid Driver # (the route code, e.g.
  9000E, not the driver), Pieces. Matches the seed CSV and the current importer. Layout: date,
  route_code, quantity → e-commerce (no tiers). The execution comes from the daily list
  (`driver_source = daily_list`) and the report row joins it on (date, route).
  One row per executed route and day (already summed). A second row for the same (date, route) is an
  import problem, not a silent sum.
- **Daily goals (owner, Oct 18, 2026):** no guaranteed minimum exists today, but a daily goal is
  wanted. Proposed `daily_goals (operation_id, payee_id?, route_id?, weekdays?, metric pay | quantity,
  service_type_id?, target, action track | top_up, valid_from, valid_to, created_by, created_at)`.
  `track` only measures (goal met or not, % reached); `top_up` also proposes a bonus of type
  "goal top-up" for the gap, which a person confirms. Most specific goal wins, like bonus rules.
- **Unclassified STEM (owner, Oct 18, 2026):** nobody knows what the $1,075 was; the app must
  standardise this. An `other_revenue` row with no zone, or far above the usual amount, keeps its import
  in `partial` until someone classifies it (pick a zone, or mark it as a lump adjustment with a note).
  It never blocks payroll, since STEM is not driver pay.
- **Route executions (proposed):** `route_executions (operation_id, date, route_id?, payee_id,
  driver_id, status, source, confirmed_by, confirmed_at)`, unique `(operation_id, date, route_id,
  payee_id)`, replaces `daily_assignments` for every client. `work_records` and `bonuses` hang from
  it, so date, payee, route and operation stop repeating on every work row.

### Aarisa as its own contractor (approved Oct 18, 2026)
- `contractors.is_own`; Aarisa is a row with `is_own = true`, Puma `false`. Every driver always has an
  affiliation (no more "null means Aarisa"). Aarisa can never be a payee: own drivers are paid one by
  one, a contractor's routes are paid to the contractor.

### Where each amount lives (approved Oct 18, 2026)
- Client rate and payee rate: `rates` by side, with history; copied to `work_records.client_rate_cents`
  and `payee_rate_cents` at approval. Extra jobs use the agreed amounts instead of the rate table.
- `work_records.revenue_cents` = quantity × client rate; `pay_cents` = quantity × payee rate.
- Bonus: `bonuses` per execution. STEM: `operation_revenue`.
- Total to pay = Σ pay + Σ bonuses; per payee per run in `payroll_lines.pay_cents`.
- Profit = revenue + STEM − total to pay. Calculated, never stored per record (`profit_cents` goes).
- Before approval everything is calculated live from the rate valid on the work date; approval freezes.
- Checked against Details NEW, DUB006 on Jun 1: revenue $150, pay $125 + bonus $20 = $145, STEM $20,
  profit $25 (matches `total_route` and `total_profit`).

### Route ownership (owner, Oct 18, 2026)
- Principle: not every route is paid to a driver; some are paid to a contractor. The database must
  always tell which routes belong to which contractor, on any date.
- `route_ownership (route_id, contractor_id, effective_from, note, created_by, created_at)`, unique
  `(route_id, effective_from)`, never edited; the end is the next row's start. Replaces
  `routes.contractor_id` (and its "null means Aarisa").
- The owner on the execution date suggests the payee: Aarisa → the assigned driver; a contractor →
  the contractor, with `driver_id` optional. An execution whose payee differs from the owner needs
  confirmation and is flagged in the weekly check.
- The payee for a contractor route is the contractor, so pay uses the contractor's rate and the
  payroll shows one line for the contractor. A contractor statement view (routes, executions, quantity,
  pay, revenue, margin) can be exported. In the star, `dim_route` keeps the owner by date.
- Open: can an Aarisa driver cover a Puma route, and who is paid then? Puma only in T-Force? Puma's
  pay basis (open question #5).

### T-Force manual weekly process (owner's notes, Oct 18, 2026)
Steps: added pay from notes → "ADDED PAY" tab; e-com routes with an agreed payment above the system
are listed; T-Force sends daily e-com package counts; counts and WhatsApp names go to a tab per date;
everything joins in a DATA tab with added pay; payroll runs weekly from a summary; the settlement is
weekly but paid 30 days later, so missing pay is logged by **settlement order number**, checked with
T-Force management, and turned green once the adjusted order number appears; payment can take 5–6
weeks but drivers are still paid weekly. A **partner** runs under Aarisa: his numbers are not paid
weekly; Aarisa only checks his part of the settlement is paid, then transfers it to him.
Design impact:
- Agreed higher e-com pay for a route-day: an execution-level agreed amount that creates an expected
  adjustment on the receivable (like recovery routes), not a new rate.
- The T-Force settlement is itemised by order number: receivable items and claims carry the order
  number; claim states include "confirmed adjusted" (green) with the adjusted order number.
- Contractors get `pay_trigger`: `payroll` (paid with the weekly run) or `on_collection` (paid only
  when the client's payment for those routes arrives, a pass-through). Partner routes on collection
  never block or enter the weekly driver run.
- "Contractor drivers" in the notes are the 1099 drivers, not Puma.
- Owner, Oct 18, 2026: the partner is normally Puma, so Puma is `pay_trigger = on_collection`.
  Open: does Aarisa keep a percentage or fixed fee before transferring?
- **Route types (kept ready, Oct 18, 2026):** `route_types (operation_id, code, name, active)`,
  `route_type_history (route_id, route_type_id, effective_from)` and an optional `rates.route_type_id`.
  Rate lookup: payee → route type → general (service + tier). Empty until the client confirms (#41).
- **Period checklist:** a calculated view per operation and period (report imported, daily list
  complete, open exceptions, extra jobs, run approved, settlement checked) so staff can run the week.
- Still open with the client: receivables reconciliation (#38–#40), route types (#41), Puma's fee (#42).

### Daily list rules (owner, Oct 18, 2026)
- A route can be driven by a different driver on different days (normal: the usual driver only
  suggests). On one day a route has **one** execution and one payee: unique (operation, date, route).
  No splitting a route between two drivers on the same day.
- One driver on two routes the same day: no real evidence (the 5 cases come from the illustrative
  daily list sample). Allowed, but raised as a weekly-check exception to review (open question #43).

### contractors (pending answers)
- Add legal name, EIN, contact, email, address, `pay_basis`, relationship start and end.
- Open: how Puma is paid (open question #5); whether to record which Puma driver drove each day.

### drivers
- One person = one row, never duplicated. A driver can work for several clients; the client lives on
  each work record, and each client's payroll pays its own work.
- Who gets paid is decided per work record (contractor routes pay the contractor), not by the driver.
- `drivers.contractor_id` → `driver_affiliations (driver_id, contractor_id null = Aarisa, valid_from,
  valid_to)` for history. Pending: can a driver work for Aarisa and Puma in the same week?
- Phone unique, stored as E.164. Name unique (case-insensitive) among active drivers.

### work_records (proposed, no objection)
- FKs: `payroll_run_id` → payroll_runs, `settlement_line_id` → settlement_lines, both indexed.
- Payee: at most one of driver/contractor; payroll approval blocked while any row has none.
- Origin check: extra_job needs `extra_job_id`; daily-list clients need `import_id` + `assignment_id`;
  report-code clients need `import_id`.
- Unique grain: (import, date, service, route, payee, tier); extra jobs unique by `extra_job_id`.
- Non-negative pieces, bonus and rates; the five snapshot columns are all set or all null;
  `profit = revenue - driver_pay`.
- Index (route_id, date).
- Star: becomes `fact_work`.

### Review follow-ups (approved Oct 18, 2026)
- `bonuses` becomes `pay_adjustments` with `adjustment_types` (class bonus, goal_top_up, correction,
  deduction). After the 24-hour reopen window, a fix is a `correction` in the next open period that
  points to the original execution.
- `report_import_rows` keeps every raw row (jsonb) with its status; `work_records.report_import_row_id`.
- `audit_log.ai_suggestion_id` links a change to the WhatsApp suggestion that caused it.
- Not adopted: `route_executions.pay_period_id` (derivable from date, would be redundant) and frozen
  rate ids on work records (optional, left out for now).

## Rollout log
| Stage | What | Commit | Production |
|---|---|---|---|
| 0 | Hovership importer reads the client report without bonus or totals | ae1edde | Oct 18, 2026 |
| 1 | All 23 tables and 16 enums moved to `core`; columns and constraints renamed to the convention | see git log | Oct 19, 2026, backup `aarisa_db-20261019T034513Z-before-stage1.dump` |

Backups before each stage: `/docker/aarisa/backups/` (root only). Restore: `pg_restore --clean -d <url> <file>`.
