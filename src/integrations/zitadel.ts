import type { Role } from '~/domain/permissions';

// Zitadel management calls for Team access. Needs a service user's token with
// permission on the Aarisa project (open question 23). Without it, invites and role
// changes are disabled in the UI and the portal says why.

export interface ZitadelAdminConfig { issuer: string; token: string; projectId: string; orgId?: string }

export function zitadelAdminConfig(): ZitadelAdminConfig | null {
  const issuer = process.env.ZITADEL_ISSUER;
  const token = process.env.ZITADEL_SERVICE_TOKEN;
  const projectId = process.env.ZITADEL_PROJECT_ID;
  if (!issuer || !token || !projectId) return null;
  return { issuer: issuer.replace(/\/$/, ''), token, projectId, orgId: process.env.ZITADEL_ORG_ID };
}

async function call<T>(cfg: ZitadelAdminConfig, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${cfg.issuer}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${cfg.token}`,
      'content-type': 'application/json',
      ...(cfg.orgId ? { 'x-zitadel-orgid': cfg.orgId } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Zitadel ${method} ${path} failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

/** Creates a human user who gets an email to set a password, and grants one project role. */
export async function inviteUser(cfg: ZitadelAdminConfig, p: { email: string; givenName: string; familyName: string; role: Role; locale: 'en' | 'es' }) {
  const created = await call<{ userId: string }>(cfg, 'POST', '/v2/users/human', {
    profile: { givenName: p.givenName, familyName: p.familyName, preferredLanguage: p.locale },
    email: { email: p.email, sendCode: {} },
  });
  await call(cfg, 'POST', `/management/v1/users/${created.userId}/grants`, { projectId: cfg.projectId, roleKeys: [p.role] });
  return created.userId;
}

/** Replaces the user's project roles with one role. */
export async function setUserRole(cfg: ZitadelAdminConfig, userId: string, role: Role) {
  const grants = await call<{ result?: { id: string; projectId: string }[] }>(cfg, 'POST', '/management/v1/users/grants/_search', {
    queries: [{ userIdQuery: { userId } }, { projectIdQuery: { projectId: cfg.projectId } }],
  });
  const grant = grants.result?.find((g) => g.projectId === cfg.projectId);
  if (grant) await call(cfg, 'PUT', `/management/v1/users/${userId}/grants/${grant.id}`, { roleKeys: [role] });
  else await call(cfg, 'POST', `/management/v1/users/${userId}/grants`, { projectId: cfg.projectId, roleKeys: [role] });
}
