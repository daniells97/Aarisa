import { afterEach, describe, expect, it, vi } from 'vitest';
import { throughPortal, withLoginRequest } from './invite-link';
import { toPublicLogin } from './oidc';

afterEach(() => vi.unstubAllEnvs());

describe('invite links land in the portal', () => {
  it('wraps the sign-in link in the portal', () => {
    vi.stubEnv('APP_BASE_URL', 'https://portal.test/');
    expect(throughPortal('https://auth.test/ui/v2/login/verify?userId=u&code=c')).toBe('https://portal.test/auth/continue?to=https%3A%2F%2Fauth.test%2Fui%2Fv2%2Flogin%2Fverify%3FuserId%3Du%26code%3Dc');
  });
  it('adds the login request so setting the password ends signed in', () => {
    expect(withLoginRequest('https://auth.test/ui/v2/login/verify?userId=u&code=c&invite=true', 'https://auth.test/ui/v2/login/login?authRequest=V2_123'))
      .toBe('https://auth.test/ui/v2/login/verify?userId=u&code=c&invite=true&requestId=oidc_V2_123');
    expect(withLoginRequest('https://auth.test/x', null)).toBe('https://auth.test/x');
    expect(withLoginRequest('https://auth.test/x', 'https://auth.test/ui/v2/login/login?authRequest=bad%20id')).toBe('https://auth.test/x');
  });
  it('moves sign-in page links to Aarisa\'s address, and nothing else', () => {
    vi.stubEnv('ZITADEL_LOGIN_BASE', 'https://auth.portal.test/ui/v2/login');
    expect(toPublicLogin('https://idp.test/ui/v2/login/login?authRequest=V2_1', 'https://idp.test')).toBe('https://auth.portal.test/ui/v2/login/login?authRequest=V2_1');
    expect(toPublicLogin('https://idp.test/oauth/v2/authorize?x=1', 'https://idp.test')).toBe('https://idp.test/oauth/v2/authorize?x=1');
    vi.stubEnv('ZITADEL_LOGIN_BASE', '');
    expect(toPublicLogin('https://idp.test/ui/v2/login/login?a=1', 'https://idp.test')).toBe('https://idp.test/ui/v2/login/login?a=1');
  });
});
