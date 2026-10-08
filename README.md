# Aarisa portal

Payroll and client settlements for Aarisa's Hovership and T-Force operations, in one place.
Built by Dimetrics for Leanova Consulting.

## What's in this repository today

This is the hand-off package: everything needed to build the app with Claude Code.
No application code yet.

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
