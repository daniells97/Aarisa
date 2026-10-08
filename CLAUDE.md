# Aarisa portal — instructions for Claude Code

Read this file first, then `docs/spec.md`. Every feature must trace back to a rule in the spec.
If the spec and the screens in `design/screens/` disagree, the spec wins; flag the gap.
If something isn't covered, add it to `docs/open-questions.md` instead of guessing.

## What this is

A web app (PWA) that replaces Aarisa's Excel-based payroll and settlement process.
Aarisa is a last-mile delivery subcontractor in the San Francisco Bay Area with two clients:

- **Hovership**: weekly report already names the driver; drivers paid every two weeks.
- **T-Force**: weekly report has pieces per route letter (9000A…) but **not** the driver;
  Aarisa keeps a daily driver list; drivers paid weekly; client pays net 30.

One database is the single source of truth for both operations. Users are the owner,
a dispatcher, finance and read-only viewers. The owner works mostly from his phone.

## Stack (do not change without asking)

| Layer | Choice |
|---|---|
| App | TanStack Start (React, TypeScript strict), file-based routes |
| Data | PostgreSQL 16 via PgBouncer, Drizzle ORM + drizzle-kit migrations |
| Auth | Zitadel (OIDC + PKCE). Roles come from Zitadel project roles |
| Secrets | Infisical (never commit `.env`; `.env.example` lists names only) |
| Automation | n8n (self-hosted) for email ingestion, WhatsApp Cloud API webhooks, AI calls |
| Styling | Plain CSS with design tokens from `docs/design-system.md`. No Tailwind, no UI kit |
| Fonts | Barlow + Barlow Condensed (Google Fonts) |
| Tests | Vitest for domain logic, Playwright for the main flows |
| Deploy | Docker image behind Traefik on the Dimetrics VPS, see `docs/deployment.md` |

Same stack as the Alexyah accounting portal; reuse its patterns for Zitadel and Drizzle.

## Commands

```bash
pnpm install
pnpm dev                 # local app
pnpm db:generate         # drizzle-kit generate
pnpm db:migrate          # apply migrations
pnpm db:seed             # load seed data from docs/seed (sample June 2026 data)
pnpm test                # vitest
pnpm test:e2e            # playwright
pnpm build && pnpm start
```

Create these scripts in `package.json` when scaffolding.

## Code layout

```
src/
  routes/            # TanStack Start routes, one folder per screen in docs/spec.md
  domain/            # pure business logic: rates, payroll, cross-check, settlements
  db/schema.ts       # Drizzle schema (start from db/schema.ts at repo root)
  server/            # server functions; every write goes through here
  integrations/      # parsers for Hovership and T-Force reports, WhatsApp payloads
  ui/                # shared components: Plate, WarningDiamond, Pill, Toast, Sheet…
  styles/tokens.css  # design tokens
```

## Rules that matter

1. **Money is integer cents** (`bigint`), never floats. Format only at the edge.
2. **Rates have effective dates.** A payroll run always uses the rate valid on the work date.
   Never update a rate in place; insert a new one.
3. **Approved payroll runs are locked.** Reopen is allowed for 24 hours by the owner only,
   and is written to the audit log.
4. **Every write is audited**: table, record id, before, after, user, source
   (`portal`, `whatsapp`, `email-import`, `system`), timestamp.
5. **AI never writes final data on its own.** AI output is stored as a *suggestion* with
   the original text; a person confirms it (button tap counts) before it becomes a record.
6. **T-Force payroll is blocked** while the weekly check has open exceptions.
7. **STEM fields from Hovership are ignored** (agreed with the client). Bonuses are kept.
8. Two pay cycles: never assume one cycle for every operation.
9. Roles are enforced on the server, not only hidden in the UI. Dispatchers never see
   client rates, revenue or profit.
10. Mobile first for: Today's drivers, Extra jobs, Exceptions, This week. Touch targets ≥ 44 px.
11. UI copy in English and Spanish (i18n from day one). Sentence case. Buttons say what they do.
12. Accessibility: WCAG 2.2 AA, visible focus ring, real buttons and labels.

## Working style

- Work in the phase order of `docs/spec.md` §8. Finish a phase with tests before starting the next.
- Small PRs, one feature each, with a short description and screenshots of the UI.
- Domain logic gets unit tests with the June 2026 sample numbers in `docs/spec.md` §9.
- Ask before adding a dependency over ~50 kB or any paid service.
