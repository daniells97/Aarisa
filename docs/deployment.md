# Deployment

Target: the Dimetrics VPS (Hostinger KVM, Ubuntu 24.04) that already runs PostgreSQL 16,
PgBouncer, Zitadel, Infisical, Traefik with Let's Encrypt, and n8n.
Which of the two VPS hosts Aarisa is still to confirm (see open questions).

## Services

| Service | How |
|---|---|
| App | Docker image `aarisa-portal`, Node 22, multi-stage build; start the server entry produced by `pnpm build` (same setup as the Alexyah portal) |
| URL | `aarisa.dimetrics.com.co` (or a domain Aarisa owns), routed by Traefik labels on the `web` network |
| Database | New database `aarisa_db` and role `aarisa_app` on the existing PostgreSQL, through PgBouncer |
| Auth | New Zitadel organization "Aarisa", project "Aarisa portal", PKCE web app, project roles `owner`, `dispatcher`, `finance`, `viewer` |
| Secrets | New Infisical project `aarisa`, environments `dev` and `prod`; injected at container start |
| Files | Report files and photos in a private volume or S3-compatible bucket (to decide) |
| Backups | Nightly `pg_dump` of `aarisa_db`, kept 30 days, copied off the server |

## Environment variables (names only, values in Infisical)

```
DATABASE_URL
ZITADEL_ISSUER
ZITADEL_CLIENT_ID
SESSION_SECRET
N8N_SERVICE_TOKEN
AI_MODEL
AI_API_KEY
STT_API_KEY
WHATSAPP_PHONE_NUMBER_ID
WHATSAPP_TOKEN
WHATSAPP_APP_SECRET
FILE_STORAGE_URL
APP_BASE_URL
TZ=America/Los_Angeles
```

## CI/CD (GitHub Actions)

- On pull request: install, typecheck, lint, unit tests, Playwright against a throwaway Postgres.
- On merge to `main`: build image, push to GitHub Container Registry, then SSH to the VPS
  (deploy key stored as a GitHub secret) and run `docker compose pull && docker compose up -d`,
  followed by `pnpm db:migrate` inside the container.
- Migrations are forward-only and reviewed in the PR.

## First-time setup steps (run from Claude Code on Daniel's computer, which has SSH access)

1. Create database and role in PostgreSQL; add the PgBouncer entry.
2. Create the Zitadel organization, project, roles and PKCE app; save IDs to Infisical.
3. Create the Infisical project and secrets.
4. Add the `aarisa` service to the compose file with Traefik labels and the DNS record.
5. Add the deploy key and GHCR token to the GitHub repository secrets.
6. Import the n8n workflows from `n8n/` (created in Phase 2) and set their credentials.
