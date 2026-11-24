import { afterEach, describe, expect, it, vi } from 'vitest';
import { throughPortal, withLoginRequest } from './invite-link';

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
});
