# Data model

The draft schema is `db/schema.ts`. This page explains how the pieces fit.

```
operations ─┬─ routes ── daily_assignments ──┐
            ├─ service_types ── rates         │
            ├─ report_imports ── work_records ◄┤── extra_jobs ◄── ai_suggestions ◄── messages
            │                      │           │
            ├─ pay_periods ── payroll_runs ── payroll_lines
            │                      │
            ├─ settlement_lines ◄── payment_allocations ── payments_received
            │        └── claims
            └─ operation_revenue (STEM)

drivers ── contractors        exceptions → work_records / daily_assignments
users (Zitadel sub, role)     audit_log → any table
```

## How each source becomes work records

| Source | Creates | Driver comes from |
|---|---|---|
| Hovership report | one `work_record` per driver per day per tier, plus a stat record; STEM goes to `operation_revenue` | driver code in the report |
| T-Force report | one `work_record` per route per day (`ecommerce`) | `daily_assignments` for that date and route |
| Daily list | `daily_assignments` only (no money) | portal or WhatsApp |
| Extra job | one `work_record` + one `settlement_line` (`extra_job`) | the person who logged it |

## Lifecycles

- `report_imports.status`: waiting → reading → done, or layout_changed / partial / failed.
  Re-importing the same file (same SHA-256) is refused.
- `daily_assignments.status`: proposed (6:29 AM) → confirmed / changed / waiting / no_driver.
- `exceptions.status`: open → resolved (with a resolution).
- `payroll_runs.status`: draft → ready → approved → paid; approved → reopened (24 h, owner).
- `settlement_lines.status`: open → paid / short / late → claim_ready → claimed → paid.

## Calculations (domain layer, pure functions)

```
rateFor(serviceType, tier, payee, date)        → { clientCents, driverCents } | missing
valueWorkRecord(record, rate)                  → { driverPay, revenue, profit }
hovershipWeek(records, stem)                   → totals, per driver, operation profit
crossCheckTForce(reportRows, assignments, history) → matched records + exceptions
payrollRun(period)                             → lines, totals, blockers
settlementStatus(line, allocations, today)     → status, missing amount, days late
```

Each function has unit tests with the June 2026 numbers in `docs/spec.md` §9.

## Audit

Server functions write `audit_log` in the same transaction as the change. Undo in the UI
writes a new change (action `undo`) rather than deleting history.
