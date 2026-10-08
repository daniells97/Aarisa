# Aarisa portal: product spec

Status: v1, October 2026. Source: discovery meeting with Aaron Fitzpatrick (Levantamiento
Proceso Nómina), the client files `Hovership_Payroll_Aarisa_Consulting.xlsx` and
`TFORCE_info.xlsx`, the agreed automation flow, and the approved design canvas.

---

## 1. Problem and goal

Today Aarisa builds payroll in Excel from three kinds of input that arrive at different times
and in different shapes:

- a structured weekly report from each client;
- a hand-kept daily list of which driver drove each T-Force route;
- jobs agreed by phone (pickups, Grainger, recovery routes) that never appear in any report.

Data is copied two or three times, one tab per week, and the owner is the only person who can
run the process. Aarisa also pays drivers before clients pay Aarisa, so missing client
adjustments turn into lost money.

**Goal:** one database for both operations, where reports are read automatically, the daily
driver list and extra jobs are captured from the phone, payroll is calculated per operation and
pay cycle, and what each client owes is tracked until it's paid.

Out of scope for v1: paying drivers (the portal produces the payroll file), accounting
ledger, Teams integration (phase 4 candidate), Power BI.

## 2. Users and roles

| Role | Who | Main device | Can |
|---|---|---|---|
| Owner | Aaron | Phone, sometimes desktop | Everything |
| Dispatcher | Team member | Phone | Confirm today's drivers, log extra jobs, clear exceptions |
| Finance | Office | Desktop | Clear exceptions, enter Hovership bonuses, record client payments, send claims, see money |
| Viewer | Leanova support, accountant | Desktop | Read only, including money |

Permission matrix (enforced server side):

| Action | Owner | Dispatcher | Finance | Viewer |
|---|:-:|:-:|:-:|:-:|
| Confirm today's drivers | ✓ | ✓ | | |
| Log extra jobs | ✓ | ✓ | | |
| Clear weekly exceptions | ✓ | ✓ | ✓ | |
| Enter Hovership bonuses | ✓ | | ✓ | |
| Approve payroll | ✓ | | | |
| See client rates, revenue, profit | ✓ | | ✓ | ✓ |
| Record payments, send claims | ✓ | | ✓ | |
| Edit drivers, services, rates | ✓ | | | |
| Invite people, change roles | ✓ | | | |

Dispatchers see driver pay but never client rates, revenue or profit.

## 3. Glossary

- **Operation**: a client contract. `hovership`, `tforce`.
- **Route letter**: T-Force route code such as `9000A`. Shown in the UI as a green plate.
- **Driver**: a person who drives. Belongs to Aarisa or to a **contractor**.
- **Contractor**: an outside company (today: Puma) that owns some routes. Paid as one party.
- **Service type**: closed list. `ecommerce`, `hovership_packages`, `stat`, `pharma_pickup`,
  `pickup`, `grainger`, `recovery_route`, `other`.
- **Work record**: one unit of paid work for one driver or contractor on one day (§4).
- **Rate**: what the client pays and what the driver gets for one unit of a service, from a date.
- **Payroll run**: all work records of one operation in one pay period, approved once.
- **Settlement**: what a client is expected to pay for a period or a job, and what arrived.
- **Exception**: a work record the system can't pay with confidence. Blocks payroll.

## 4. The unified work record

Every source ends as rows with this shape (from the discovery document):

| Field | Notes |
|---|---|
| date | service date |
| operation | hovership / tforce |
| service_type | closed list |
| route_code | e.g. `9000A`; nullable for Hovership |
| driver_id / contractor_id | exactly one is set |
| pieces | packages or pieces; split by tier for Hovership |
| tier | Hovership only: `t1_3`, `t4` |
| client_rate_cents, driver_rate_cents | copied from the rate valid on `date` (snapshot) |
| bonus_cents | Hovership, typed by a person |
| driver_pay_cents | pieces × driver rate + bonus |
| revenue_cents | pieces × client rate |
| profit_cents | revenue − driver pay |
| source | `hovership_report`, `tforce_report`, `daily_list`, `extra_job`, `manual` |
| pay_period_id, payroll_run_id | assigned when the period closes |
| settlement_id | which expected payment covers it |

Settlement fields (expected, received, difference, status) live on the settlement, not on the row.

## 5. Business rules

### 5.1 Rates
- Rates are keyed by operation + service type + tier, with `effective_from`. Optional
  per-driver or per-contractor override.
- A new rate never edits an old one. Work is valued with the rate valid on its date, and the
  value is snapshotted on the work record when the period is approved.
- Missing rate → the record becomes an exception of type `missing_rate`.
- Rates derived from the June 2026 Hovership file (exact on all 319 rows; confirm with Aaron):

  | Service | Client pays | Driver gets |
  |---|---|---|
  | Tier 1–3 package | $3.00 | $2.50 |
  | Tier 4 package | $2.00 | $1.75 |
  | Stat stop | $10.00 | $5.00 |
  | Pharma pickup | $50.00 | to confirm |

- T-Force e-commerce rates: not yet provided (open question).

### 5.2 Hovership
- Weekly report arrives by email. Columns: POD Date, DriverCode, DriverNameCode, Tier 1–4,
  Stat, Stem, Stem Reason, Bonus, Total Route, Total Profit.
- Driver code identifies the driver. Unknown code → exception `unknown_driver_code`.
- **STEM is not part of any driver's pay or margin** (agreed). It's recorded at operation
  level as `stem_revenue` for the week, because Hovership does pay it and it appears on the
  invoice.
- Bonus is typed by Finance/Owner per driver per day in the portal. It is a driver cost.
- Driver pay = T1–3 × rate + T4 × rate + Stat × rate + bonus.
- Per-driver margin = package and stat revenue − driver pay (STEM excluded).
- Operation profit for a period = package and stat revenue + STEM revenue − driver pay.
- Pay cycle: every two weeks (two weekly reports per run).
- Collection: weekly invoice, paid by ACH about three weeks later.

### 5.3 T-Force
- Weekly report (Monday or Tuesday) has: order date, paid driver # (route letter), pieces.
  It does **not** identify Aarisa's driver.
- Daily driver list (§6.3) records who drove each route each day.
- Weekly check joins report rows to daily list by (date, route_code):

  | Case | Result |
  |---|---|
  | Report row, list has a known driver or contractor | matched |
  | Report row, list has no driver | exception `no_driver` |
  | Report row, list has an unrecognised name | exception `unknown_name` |
  | List has a driver, no report row | exception `no_pieces` |
  | Pieces < 10% of the route's median over the last 4 weeks (or the current week if less history) | exception `low_pieces` (threshold configurable) |

- Exception resolutions: assign driver, mark not ours, pay as reported, or ask the client
  (creates a settlement claim line). Each resolution is audited.
- Contractor routes (Puma: 9000R, 9000S) are paid to the contractor, not to a person.
- Pay cycle: weekly. **The run can't be approved while exceptions are open.**
- Collection: net 30; corrections can push it to about six weeks.

### 5.4 Extra jobs (T-Force non e-commerce)
- Pickups, Grainger, recovery routes and others agreed by phone.
- Required: service type, date, driver or contractor, client amount, driver amount.
  Order number is required for `recovery_route` and strongly asked for the rest.
- Captured from the phone form, or from WhatsApp (voice or text), where AI pre-fills the
  form and a person saves it (§7).
- Each extra job creates an expected settlement line, because the client pays it as a manual
  adjustment.

### 5.5 Payroll runs
- One run per operation per pay period. Status: `draft → ready → approved → paid`, or
  `reopened` (owner only, within 24 hours of approval).
- `ready` requires: all expected reports imported, no open exceptions, no missing rates.
- Approval shows a final summary (§6.8) and records who approved and when.
- Output: payroll file (CSV now; format to confirm) per run.

### 5.6 Settlements and claims
- Expected lines come from: invoices (Hovership weekly), T-Force weekly e-commerce totals,
  and each extra job.
- Received payments are entered by Finance (or imported later) and matched to lines.
- Status per line: `open`, `paid`, `short`, `late` (past expected date), `claim_ready`, `claimed`.
- Late = today is past the expected date. Expected date = invoice date + client terms.
- Claim for a missing adjustment includes order number, date, route, who did it, agreed amount,
  amount paid out, and the phone agreement log. Exportable as PDF and email.

## 6. Screens

The approved designs are in `design/screens/` and on the canvas. Desktop screens are fluid
pages; mobile screens are the same routes at phone width (one responsive app, installable as PWA).

| # | Screen | Route | Device focus |
|---|---|---|---|
| 6.1 | Sign in | `/login` | both |
| 6.2 | Overview | `/` | desktop; `/week` on phone |
| 6.3 | Today's drivers (T-Force) | `/tforce/today` | phone first |
| 6.4 | Weekly check (T-Force) | `/tforce/week/:weekId` | desktop; exceptions on phone |
| 6.5 | Hovership weekly report | `/hovership/week/:weekId` | desktop |
| 6.6 | Extra job | `/extra-jobs/new` (sheet on phone) | phone first |
| 6.7 | Payroll | `/payroll`, `/payroll/:runId` | desktop |
| 6.8 | Approve payroll dialog | modal on `/payroll/:runId` | desktop |
| 6.9 | Settlements | `/settlements` | desktop |
| 6.10 | Drivers and rates | `/settings/rates`, `/drivers`, `/services` | desktop |
| 6.11 | Team access | `/settings/team` | desktop |
| 6.12 | Import states | inline on 6.4 and 6.5 | both |

Key behaviour per screen:

- **6.2 Overview**: a list of what needs the user, most urgent first: open exceptions blocking
  payroll, late payments, routes waiting for a driver, negative margins. Below it, the week's
  figures: packages, route-days, owed to drivers, profit with change vs last week.
  Packages by day split by operation. One block per operation with its pay cycle.
- **6.3 Today's drivers**: one row per active route with the usual driver pre-filled. Inline
  driver select. Status: confirmed, changed, waiting, contractor, no driver. Side panel with
  the WhatsApp thread, what the AI understood (applied vs needs you), and today's change log.
  Every change shows a toast with Undo (10 seconds).
- **6.4 Weekly check**: summary (pieces, matched, contractor route-days, exceptions), a
  route × day grid with exception cells highlighted, and an exceptions list with actions.
  The approve button stays disabled with the reason written under it.
- **6.5 Hovership**: import result, one row per driver with the bonus input, per-driver margin
  and a "lost money" panel for negative days, rates used.
- **6.6 Extra job**: service as 4 large toggles, date (native picker), route nearby, who,
  client amount, driver amount, order number, optional photo. Fields pre-filled by AI are
  tinted green with a note saying where they came from.
- **6.7 Payroll**: runs list grouped open/paid, run detail with totals and per-driver rows.
- **6.8 Approve**: total to pay, checks passed, things worth a look (new drivers vs last
  run, negative margins), what approving does, button labelled with the exact amount.
- **6.9 Settlements**: summary (expected, late, paid-to-driver-not-by-client, received),
  ledger table, claim panel with checklist.
- **6.12 Import states**: waiting (report not arrived), reading (step progress), layout changed
  (column renamed; suggest mapping; nothing saved), partly read (unknown codes to resolve).

Mobile tab bar: Today, Extra jobs, Exceptions, Week. Offline: extra jobs are saved on the
device and sent when back online; other actions say they need a connection.

## 7. WhatsApp and AI

- One WhatsApp Business number for Aarisa (Cloud API), handled by n8n.
- **Morning list** (approved template, 6:30 AM, configurable): routes with usual drivers and two
  quick replies, `All good` and `Change a route`. Free-text replies are interpreted by AI into
  route → driver changes. Known names are applied; unknown names are asked back.
- **Extra job**: the user sends text or a voice note. Audio is transcribed; AI extracts the
  fields; the bot replies with a summary and a `Review and save` link that opens 6.6 pre-filled.
  Nothing is saved until the person taps Save.
- First reply wins: once a day is confirmed from any channel, others show it as confirmed.
- All AI suggestions are stored with original text, model, extracted JSON and who confirmed.

## 8. Phases and acceptance criteria

### Phase 1 (weeks 1–4): foundation and Hovership
- Scaffold app, Zitadel login, roles, i18n EN/ES, design tokens and shared components.
- Drivers, contractors, services, rates with effective dates.
- Hovership report import (upload first; email in phase 2) with all four import states.
- Bonus entry, per-driver pay and margin, biweekly payroll run, approve dialog, CSV export.
- Overview with Hovership data. Audit log.
- **Done when:** importing the June 2026 file reproduces the totals in §9, approval locks the
  run, and roles are enforced in server tests.

### Phase 2 (weeks 5–8): T-Force and WhatsApp
- Today's drivers (desktop and phone), daily list with history and undo.
- T-Force report import and weekly check with all exception types.
- WhatsApp morning list and replies through n8n; AI interpretation with confirmation.
- Extra jobs from the phone form and from WhatsApp (pre-filled link).
- Email ingestion of both reports.
- **Done when:** the June 15–20 T-Force file matches §9, the three sample exceptions appear,
  and a WhatsApp change updates the day within 10 seconds.

### Phase 3 (weeks 9–12): settlements and hardening
- Settlements ledger, received payments, late detection, claims (PDF and email).
- Offline extra jobs (PWA), notifications, remaining states.
- Playwright coverage of the main flows; Lighthouse accessibility ≥ 95.
- Usability test with 3 to 5 users (owner, dispatcher, finance): SUS ≥ 80.

## 9. Test fixtures (June 2026 sample files)

Hovership, week of June 15 to 21 (51 rows, 17 drivers):

| Measure | Value |
|---|---|
| Tier 1–3 packages | 2,496 |
| Tier 4 packages | 57 |
| Stat stops | 19 |
| Bonuses | $909.75 |
| Driver pay (incl. bonus) | $7,344.50 |
| Package and stat revenue | $7,792.00 |
| STEM revenue (operation level) | $775.00 |
| Operation profit (rule 5.2) | $1,222.50 |
| Sum of per-driver margins, STEM excluded | $447.50 |

Hovership payroll run June 8 to 21: 90 rows, 20 drivers, 4,525 tier 1–3, 101 tier 4,
43 stat, bonuses $1,684.75, driver pay $13,389.00, package and stat revenue $14,207.00,
STEM $1,495.00, operation profit $2,313.00.

> Note for Aaron: the old sheet spreads STEM into each driver's profit. With STEM kept at
> operation level, per-driver margins drop and several drivers whose bonus equals their STEM
> show negative margins. The operation total doesn't change. The current design screens still
> show the old per-driver profit; update them when this rule is confirmed.

T-Force, June 15 to 20: 74 route-days, 19 routes, 4,910 pieces. Daily totals: Mon 1,112,
Tue 870, Wed 774, Thu 796, Fri 740, Sat 618. Expected exceptions with the sample daily list:
9000Z Thu (`unknown_name`: "the new guy from Puma", 34 pieces), 9000W Thu (`low_pieces`, 1), 9000Z Fri (`low_pieces`, 1). Use `docs/seed/tforce_daily_list_sample.csv` as the daily list.

Seed files: `docs/seed/`.
