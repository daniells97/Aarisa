# Aarisa portal

Payroll and client settlements for Aarisa's Hovership and T-Force operations, in one place.
Built by Dimetrics for Leanova Consulting.

## What's in this repository today

Phase 1 (foundation and Hovership) is built. The hand-off documents below still drive the next phases.

| Path | What it is |
|---|---|
| `CLAUDE.md` | Instructions Claude Code reads first: stack, rules, layout |
| `docs/spec.md` | Product spec: users, screens, business rules, phases, acceptance criteria |
| `docs/data-model.md` | Tables and how they relate |
| `db/schema.ts` | Drizzle schema draft to start from |
| `docs/design-system.md` | Colors, type, components (route plate, warning diamond, pills…) |
| `docs/integrations.md` | Email report import, WhatsApp, AI, n8n flows |
| `docs/deployment.md` | Docker, Traefik, Zitadel, Infisical, CI/CD on the Dimetrics VPS |
| `docs/open-questions.md` | Decisions still needed from Aarisa |
| `docs/phase-prompts.md` | The prompts to give Claude Code for each phase |
| `docs/seed/` | June 2026 sample data from the client files, for tests |
| `design/screens/` | The approved screens from the design canvas (HTML) |

## How to build it

1. Open this repository in Claude Code.
2. Paste the Phase 1 prompt from `docs/phase-prompts.md`.
3. Review the pull request, test it, merge.
4. Repeat for Phase 2 and 3.

Design canvas: [Portal Aarisa](https://claude.ai/artifact/YHRUwyMjLV3t4jDmrD7u2y)

## Run it locally

Needs Node 22, pnpm and a PostgreSQL 16 database.

```bash
pnpm install
cp .env.example .env        # fill DATABASE_URL and SESSION_SECRET (32+ chars); DEV_LOGIN=1 for local sign-in by role
pnpm db:migrate
pnpm db:seed                # operations, services, rates, drivers, Puma, and the June 2026 Hovership sample
pnpm dev                    # http://127.0.0.1:3100
pnpm test                   # unit and database tests (each database test rolls back)
pnpm test:e2e               # Playwright; or scripts/e2e-docker.sh on a host without browser libraries
```

Without Zitadel configured, `/login` shows a development sign-in (only when `DEV_LOGIN=1` and not in production).
`pnpm db:restore-sample` puts the sample bonuses back if a manual test changed them.
