import type { Role } from '~/domain/permissions';
import { RuleError } from '~/server/errors';
import { loginPagesBase } from '~/server/oidc';

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
  if (res.status === 409) throw new RuleError('email_taken'); // a user with that email already exists in Zitadel
  if (!res.ok) throw new Error(`Zitadel ${method} ${path} failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

/** Zitadel's own login pages, where an invite or reset code is used to set a password. */
const loginPage = (cfg: ZitadelAdminConfig, page: 'verify' | 'password/set', q: Record<string, string>) =>
  `${loginPagesBase(cfg.issuer)}/${page}?${new URLSearchParams({ ...q, ...(cfg.orgId ? { organization: cfg.orgId } : {}) })}`;

async function userByEmail(cfg: ZitadelAdminConfig, email: string) {
  const found = await call<{ result?: { userId: string; state?: string }[] }>(cfg, 'POST', '/v2/users', {
    queries: [{ emailQuery: { emailAddress: email } }, ...(cfg.orgId ? [{ organizationIdQuery: { organizationId: cfg.orgId } }] : [])],
  });
  return found.result?.find((u) => u.state !== 'USER_STATE_INACTIVE') ?? null;
}

/**
 * Creates a human user (or finds one invited before), grants one project role and returns the link
 * where they set a password. Zitadel sends nothing: the portal emails the link from Aarisa's mailbox.
 */
export async function inviteUser(cfg: ZitadelAdminConfig, p: { email: string; givenName: string; familyName: string; role: Role; locale: 'en' | 'es' }) {
  let userId: string;
  try {
    userId = (await call<{ userId: string }>(cfg, 'POST', '/v2/users/human', {
      profile: { givenName: p.givenName, familyName: p.familyName, preferredLanguage: p.locale },
      email: { email: p.email, returnCode: {} },
    })).userId;
  } catch (e) {
    // Invited before and never finished: send a new invite instead of failing.
    const taken = e instanceof RuleError && e.code === 'email_taken';
    const existing = taken ? await userByEmail(cfg, p.email) : null;
    // The login service is shared: the email can belong to an account outside Aarisa, which the portal can't take over.
    if (!existing) throw taken ? new RuleError('email_other_account') : e;
    userId = existing.userId;
  }
  await setUserRole(cfg, userId, p.role);
  try {
    const { inviteCode } = await call<{ inviteCode: string }>(cfg, 'POST', `/v2/users/${userId}/invite_code`, { returnCode: {} });
    return { userId, link: loginPage(cfg, 'verify', { userId, code: inviteCode, invite: 'true' }) as string | null };
  } catch (e) {
    // They already set a password (an earlier invite was used): nothing to set up, they just sign in.
    if (e instanceof Error && e.message.includes('COMMAND-EF34g')) return { userId, link: null };
    throw e;
  }
}

/** A link to set a new password for the user with this email, or null when there is no such user. */
export async function passwordResetLink(cfg: ZitadelAdminConfig, email: string) {
  const user = await userByEmail(cfg, email);
  if (!user) return null;
  const { verificationCode } = await call<{ verificationCode: string }>(cfg, 'POST', `/v2/users/${user.userId}/password_reset`, { returnCode: {} });
  return loginPage(cfg, 'password/set', { userId: user.userId, code: verificationCode });
}

/** Replaces the user's project roles with one role. */
export async function setUserRole(cfg: ZitadelAdminConfig, userId: string, role: Role) {
  const grants = await call<{ result?: { id: string; projectId: string; roleKeys?: string[] }[] }>(cfg, 'POST', '/management/v1/users/grants/_search', {
    queries: [{ userIdQuery: { userId } }, { projectIdQuery: { projectId: cfg.projectId } }],
  });
  const grant = grants.result?.find((g) => g.projectId === cfg.projectId);
  // Invited again with the same role (e.g. the first invite was never used): nothing to change.
  if (grant && grant.roleKeys?.length === 1 && grant.roleKeys[0] === role) return;
  if (grant) {
    try {
      await call(cfg, 'PUT', `/management/v1/users/${userId}/grants/${grant.id}`, { roleKeys: [role] });
    } catch (e) {
      if (!(e instanceof Error && e.message.includes('COMMAND-Rs8fy'))) throw e; // "user grant has not been changed"
    }
  } else await call(cfg, 'POST', `/management/v1/users/${userId}/grants`, { projectId: cfg.projectId, roleKeys: [role] });
}
