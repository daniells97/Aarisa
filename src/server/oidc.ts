import { createHash, randomBytes } from 'node:crypto';
import { pickRole, type Role } from '~/domain/permissions';

// OIDC authorization code flow with PKCE against Zitadel (public client, no secret).

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

export function pkceChallenge(verifier: string) {
  return createHash('sha256').update(verifier).digest('base64url');
}

export interface OidcConfig { issuer: string; clientId: string; redirectUri: string }

export function oidcConfig(): OidcConfig | null {
  const issuer = process.env.ZITADEL_ISSUER;
  const clientId = process.env.ZITADEL_CLIENT_ID;
  const base = process.env.APP_BASE_URL;
  if (!issuer || !clientId || !base) return null;
  return { issuer: issuer.replace(/\/$/, ''), clientId, redirectUri: `${base.replace(/\/$/, '')}/auth/callback` };
}

interface Discovery { authorization_endpoint: string; token_endpoint: string; userinfo_endpoint: string; end_session_endpoint?: string }
let discovery: { issuer: string; doc: Discovery } | undefined;

export async function discover(cfg: OidcConfig): Promise<Discovery> {
  if (discovery?.issuer === cfg.issuer) return discovery.doc;
  const res = await fetch(`${cfg.issuer}/.well-known/openid-configuration`);
  if (!res.ok) throw new Error(`OIDC discovery failed: ${res.status}`);
  const doc = (await res.json()) as Discovery;
  discovery = { issuer: cfg.issuer, doc };
  return doc;
}

export const SCOPES = 'openid profile email urn:zitadel:iam:org:project:roles';

export function authorizeUrl(endpoint: string, cfg: OidcConfig, p: { state: string; nonce: string; verifier: string; locale?: string }) {
  const url = new URL(endpoint);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    scope: SCOPES,
    state: p.state,
    nonce: p.nonce,
    code_challenge: pkceChallenge(p.verifier),
    code_challenge_method: 'S256',
    ...(p.locale ? { ui_locales: p.locale } : {}),
  }).toString();
  return url.toString();
}

export async function exchangeCode(cfg: OidcConfig, code: string, verifier: string) {
  const doc = await discover(cfg);
  const res = await fetch(doc.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: cfg.redirectUri, client_id: cfg.clientId, code_verifier: verifier }),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status}`);
  return (await res.json()) as { access_token: string; id_token?: string };
}

export interface ZitadelUserInfo {
  sub: string;
  name?: string;
  email?: string;
  locale?: string;
  [claim: string]: unknown;
}

/** The userinfo endpoint is called over TLS with the access token, so its claims are trusted without verifying a JWT. */
export async function fetchUserInfo(cfg: OidcConfig, accessToken: string): Promise<ZitadelUserInfo> {
  const doc = await discover(cfg);
  const res = await fetch(doc.userinfo_endpoint, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Userinfo failed: ${res.status}`);
  return (await res.json()) as ZitadelUserInfo;
}

/**
 * Zitadel puts project roles in `urn:zitadel:iam:org:project:roles` (and a project-scoped copy
 * `urn:zitadel:iam:org:project:<id>:roles`) as `{ role: { orgId: domain } }`.
 */
export function rolesFromClaims(claims: Record<string, unknown>): string[] {
  const roles = new Set<string>();
  for (const [key, value] of Object.entries(claims)) {
    if (/^urn:zitadel:iam:org:project:(\d+:)?roles$/.test(key) && value && typeof value === 'object') {
      for (const role of Object.keys(value)) roles.add(role);
    }
  }
  return [...roles];
}

export function roleFromClaims(claims: Record<string, unknown>): Role | null {
  return pickRole(rolesFromClaims(claims));
}

/** Only same-site relative paths, to avoid open redirects. */
export function safeReturnTo(value: string | null | undefined): string {
  return value && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\') ? value : '/';
}
