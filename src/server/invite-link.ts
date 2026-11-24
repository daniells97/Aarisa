/** The portal link that wraps a sign-in page link (invite or reset); see routes/auth/continue. */
export function throughPortal(link: string) {
  const base = process.env.APP_BASE_URL?.replace(/\/$/, '');
  return base ? `${base}/auth/continue?${new URLSearchParams({ to: link })}` : link;
}

/** Adds the login request (from the authorize redirect, `...login?authRequest=V2_x`) to a sign-in page link. */
export function withLoginRequest(link: string, authorizeLocation: string | null) {
  if (!authorizeLocation) return link;
  let id: string | null = null;
  try { id = new URL(authorizeLocation).searchParams.get('authRequest'); } catch { return link; }
  if (!id || !/^[\w-]+$/.test(id)) return link;
  const u = new URL(link);
  u.searchParams.set('requestId', `oidc_${id}`);
  return u.toString();
}
