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

## Current state (October 9, 2026)

Running as a preview on the Dimetrics VPS (`srv1986534.hstgr.cloud`, 2.25.229.44), built from branch `phase-3`.

| Piece | Where |
|---|---|
| URL | `https://portal.aarisaconsulting.com` (A record at Namecheap DNS; `APP_BASE_URL` and the Zitadel redirect URIs). `https://aarisa.dimetrics.com.co` and `https://aarisa.srv1986534.hstgr.cloud` still serve the portal and send the login to the main domain |
| Compose | `/docker/aarisa/docker-compose.yml`, project `aarisa`, container `aarisa-portal`, networks `app` (Traefik) and `data` (Postgres) |
| Image | `aarisa-portal:<commit>` built on the server from `Dockerfile`; migrations run on start |
| Database | `aarisa_db`, role `aarisa_app`, direct to `dmx-postgres` like the other apps (no PgBouncer entry yet) |
| Secrets | `/docker/aarisa/.env` (root only). Move to Infisical project `aarisa` when it exists |
| Files | Docker volume `aarisa_aarisa-storage` mounted at `/data/storage` |
| Zitadel | Org **Aarisa**, project **Aarisa portal** (roles owner, dispatcher, finance, viewer; role assertion and role check on), PKCE app **Aarisa portal web**. Service user `aarisa-portal` (ORG_OWNER of Aarisa only) for Team access |
| Data | June 2026 sample data loaded for review. Start from a clean `aarisa_db` before real use |

Redeploy after a change: `docker build -t aarisa-portal:$(git rev-parse --short HEAD) -t aarisa-portal:latest .` in the repo, then `docker compose up -d` in `/docker/aarisa`.
Not done yet: GitHub Actions deploy, GHCR, Infisical, nightly backups.

## Email (invites and password resets)

Zitadel is shared with other Dimetrics clients and its SMTP settings are instance-wide, so Aarisa doesn't use
them. The portal asks Zitadel for the invite or reset code (`returnCode`) and sends the email itself from
`no-reply@aarisaconsulting.com` through Resend (`src/integrations/mail.ts`). Without `RESEND_API_KEY` the
invite dialog shows the link for the owner to share by hand; the "Forgot your password?" page sends nothing.

Setup:

1. Resend account → Domains → add `aarisaconsulting.com`. Resend lists a DKIM TXT record
   (`resend._domainkey`) and, on the `send` subdomain, an MX and an SPF TXT record. Add them in Namecheap
   (Advanced DNS). They don't touch the root MX/SPF records of Aarisa's Outlook mail.
2. Resend → API keys → create one with "Sending access" limited to `aarisaconsulting.com`.
3. In `/docker/aarisa/.env`: `RESEND_API_KEY` and `MAIL_FROM=no-reply@aarisaconsulting.com`; then
   `docker compose up -d aarisa`.
4. In the Zitadel console, organization Aarisa → Settings → Login behavior: hide "Forgot password", which
   would try Zitadel's own mail. The portal's sign-in page has its own link.

## Sign-in address (auth.aarisaconsulting.com) — Nov 24, 2026

- The sign-in pages are the shared Zitadel login (`dmx-zitadel-login`). Aarisa shows them under
  `auth.aarisaconsulting.com` through its own pass-through, `aarisa-auth-proxy` (nginx, in `/docker/aarisa`,
  config in `/docker/aarisa/auth-proxy/nginx.conf`). Only `/ui/v2/login` is passed; the proxy presents itself
  with the shared service's own host name and rewrites its redirects back to Aarisa's address.
- The shared service always redirects to its own address (instance-wide login URL), so `/auth/login` asks for
  the login request on the server and sends the browser to the same page under `ZITADEL_LOGIN_BASE`.
  Invite and reset links use the same base. Unset `ZITADEL_LOGIN_BASE` to go back to the shared address.
- DNS: `auth` A record → 2.25.229.44 (Namecheap). Certificate from Traefik's `letsencrypt` resolver.
- The sign-in scope names Aarisa's organization, so the pages use its branding (label policy, set Nov 24)
  and accept only its users.
- The proxy also serves Aarisa's own branding files (`/assets/v1/<Aarisa org id>/policy/label/`) and rewrites
  logo links in the pages to this address: the pages only allow images from their own address. Sign-up
  (`/ui/v2/login/register`) is blocked there too; registration is also off in Aarisa's login policy.
- After changing branding or login settings, the shared login container keeps the old ones in memory until it
  restarts (`docker restart dmx-zitadel-login`, a few seconds without sign-in for every client: ask first).

## Daily database backup — Nov 24, 2026

- Service `aarisa-backup` (postgres:16-alpine, in `/docker/aarisa`, script `/docker/aarisa/backup/run.sh`) makes a
  `pg_dump -Fc` of aarisa_db every day at ~03:00 Los Angeles time into `/docker/aarisa/backups/daily/`, mode 600,
  and deletes daily copies older than 30 days. Deploy copies (`backups/aarisa_db-<date>-before-<change>.dump`)
  are separate and kept.
- Check: `docker logs aarisa-backup` shows `backup ok <file>` each night.
- Restore (stop the portal first): `pg_restore --clean --if-exists -d "$DATABASE_URL" <file>` from a
  postgres:16-alpine container on the `data` network.
- These copies live on the same server; an off-server copy is still an open item.

## Test environment (aarisa.dimetrics.com.co)

A second copy of the portal for trying things without touching the real operation (client request, Nov 27 2026).

- Service `aarisa-staging` in `/docker/aarisa/docker-compose.yml`, image `aarisa-portal:staging`.
- Database: `aarisa_dev` (the development database, with the June 2026 sample data). Never `aarisa_db`.
- `/docker/aarisa/staging.env` (mode 600) overrides `.env`: `DATABASE_URL` (aarisa_dev), `APP_BASE_URL=https://aarisa.dimetrics.com.co`,
  `APP_ENV=staging`, its own `SESSION_SECRET`. Files go to its own volume `aarisa-staging-storage`.
- Sign-in is the same Zitadel login (the callback for this domain was already registered); a person signing in for the
  first time gets a user in `aarisa_dev` with their Zitadel role.
- `APP_ENV=staging` shows an orange "test environment" band on every screen and prefixes emails with `[PRUEBAS]`.
- The end-to-end tests also run against `aarisa_dev`; they only remove rows they created (E2E prefixes).

Release flow: build once and tag it for both, try it on staging, then production.

```bash
docker build -t aarisa-portal:$SHA -t aarisa-portal:staging .
cd /docker/aarisa && docker compose up -d aarisa-staging          # try it on aarisa.dimetrics.com.co
docker tag aarisa-portal:$SHA aarisa-portal:latest && docker compose up -d aarisa   # after the prod backup
```
