# Prompts for Claude Code

Paste one prompt per session. Each phase ends with a pull request you review.

## Phase 1: foundation and Hovership

```
Read CLAUDE.md, docs/spec.md, docs/data-model.md, docs/design-system.md and look at
design/screens/. Then build Phase 1 from docs/spec.md §8 on a branch `phase-1`:

1. Scaffold TanStack Start + TypeScript strict + Drizzle + Vitest + Playwright with pnpm.
   Add the scripts listed in CLAUDE.md.
2. Move db/schema.ts to src/db/schema.ts, generate the first migration, and write a seed that
   loads operations, service types, the Hovership rates from spec §5.1, drivers from
   docs/seed/hovership_details_jun2026.csv, and Puma as a contractor.
3. Zitadel OIDC + PKCE login (reuse the pattern from the Alexyah portal), roles from project
   roles, server-side permission checks per spec §2, i18n EN/ES.
4. tokens.css and shared components from docs/design-system.md (RoutePlate, WarningDiamond,
   Pill, Button, Panel, Toast, Sheet, sidebar layout, phone tab bar).
5. Drivers and rates screens (6.10), Team access (6.11).
6. Hovership import by upload with the four states of 6.12, bonus entry, per-driver pay and
   margin, operation profit with STEM at operation level (spec §5.2).
7. Payroll runs, approve dialog (6.8), lock and 24-hour reopen, CSV export.
8. Overview (6.2) with Hovership data.
9. Audit log on every write.
10. Unit tests that reproduce every Hovership number in spec §9 from the seed file, and
    permission tests per role.

Put anything you can't decide into docs/open-questions.md. Open a PR with screenshots.
```

## Phase 2: T-Force and WhatsApp

```
Read CLAUDE.md, docs/spec.md §5.3, §5.4, §6.3, §6.4, §6.6, §7 and docs/integrations.md.
Build Phase 2 on a branch `phase-2`:

1. Routes with usual driver; daily assignments; Today's drivers screen for desktop and phone
   with inline change, Undo toast and change log.
2. T-Force report import (docs/seed/tforce_pieces_jun2026.csv) and the weekly check with all
   exception types and resolutions; payroll blocked while exceptions are open.
3. Extra jobs: phone sheet form with offline-safe client UUID; settlement line per job.
4. Integration API from docs/integrations.md with service-token auth.
5. n8n workflow JSON files in n8n/ for: report ingest, morning list, WhatsApp inbound,
   reminders. AI calls return JSON validated with zod; nothing is applied below the
   confidence rule.
6. Tests: the June 15–20 T-Force fixture reproduces spec §9 totals and the three exceptions.
```

## Phase 3: settlements and hardening

```
Build Phase 3 on a branch `phase-3`: Settlements (6.9) with expected lines, payments received,
allocations, late detection and claims (PDF + email); PWA install and offline queue for extra
jobs; remaining empty and error states; Playwright coverage of: confirm a day, log an extra job
offline then sync, clear exceptions and approve T-Force payroll, record a payment.
Run Lighthouse and fix accessibility to ≥ 95.
```

## Deploy (run on Daniel's computer, where SSH to the VPS works)

```
Read docs/deployment.md. Set up aarisa_db, the Zitadel organization and app, the Infisical
project, the compose service with Traefik labels, and the GitHub Actions workflow. Ask me
before running anything that changes existing services on the VPS.
```
