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
`no-reply@aarisaconsulting.com` through Microsoft Graph (`src/integrations/mail.ts`). Without the `MAIL_*`
values the invite dialog shows the link for the owner to share by hand; the "Forgot your password?" page
sends nothing.

Microsoft 365 setup (Aarisa's tenant):

1. Shared mailbox `no-reply@aarisaconsulting.com` (no licence needed).
2. Entra admin center → App registrations → New: "Aarisa portal mail", single tenant, no redirect URI.
   Note the Application (client) ID, the Directory (tenant) ID and the enterprise application's Object ID.
   Certificates & secrets → New client secret. No Graph permission is added here.
3. Exchange Online PowerShell (RBAC for Applications), so the app can send only as that mailbox:
   ```powershell
   Connect-ExchangeOnline
   New-ServicePrincipal -AppId <client id> -ObjectId <enterprise app object id> -DisplayName "Aarisa portal mail"
   New-ManagementScope -Name "Aarisa no-reply" -RecipientRestrictionFilter "PrimarySmtpAddress -eq 'no-reply@aarisaconsulting.com'"
   New-ManagementRoleAssignment -App <client id> -Role "Application Mail.Send" -CustomResourceScope "Aarisa no-reply"
   Test-ServicePrincipalAuthorization -Identity <client id> -Resource no-reply@aarisaconsulting.com   # InScope: True
   ```
4. In `/docker/aarisa/.env`: `MAIL_TENANT_ID`, `MAIL_CLIENT_ID`, `MAIL_CLIENT_SECRET`, `MAIL_FROM`; then
   `docker compose up -d aarisa`.
5. In the Zitadel console, organization Aarisa → Settings → Login behavior: hide "Forgot password", which
   would try Zitadel's own mail. The portal's sign-in page has its own link.
