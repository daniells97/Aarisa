import { describe, expect, it } from 'vitest';
import { authorizeUrl, pkceChallenge, roleFromClaims, rolesFromClaims, safeReturnTo } from './oidc';
import { seal, unseal } from './session';

describe('PKCE', () => {
  it('matches the RFC 7636 example', () => {
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
  it('builds an authorize URL with S256 and project roles scope', () => {
    const url = new URL(authorizeUrl('https://auth.example/oauth/v2/authorize',
      { issuer: 'https://auth.example', clientId: 'c1', redirectUri: 'http://127.0.0.1:3100/auth/callback' },
      { state: 's', nonce: 'n', verifier: 'v', locale: 'es' }));
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toContain('urn:zitadel:iam:org:project:roles');
    expect(url.searchParams.get('ui_locales')).toBe('es');
  });
});

describe('Zitadel roles', () => {
  it('reads generic and project-scoped role claims', () => {
    const claims = {
      sub: '1',
      'urn:zitadel:iam:org:project:roles': { finance: { '123': 'aarisa' } },
      'urn:zitadel:iam:org:project:987:roles': { viewer: { '123': 'aarisa' } },
    };
    expect(rolesFromClaims(claims).sort()).toEqual(['finance', 'viewer']);
    expect(roleFromClaims(claims)).toBe('finance');
  });
  it('gives no role when the claim is missing', () => {
    expect(roleFromClaims({ sub: '1' })).toBeNull();
  });
});

describe('return path', () => {
  it('refuses open redirects', () => {
    expect(safeReturnTo('/payroll')).toBe('/payroll');
    expect(safeReturnTo('//evil.example')).toBe('/');
    expect(safeReturnTo('https://evil.example')).toBe('/');
    expect(safeReturnTo(null)).toBe('/');
  });
});

describe('signed cookies', () => {
  const key = 'k'.repeat(32);
  it('round-trips and rejects tampering or expiry', () => {
    const token = seal({ uid: 'u1' }, 60, key);
    expect(unseal<{ uid: string }>(token, key)?.uid).toBe('u1');
    expect(unseal(token.replace(/^./, 'x'), key)).toBeNull();
    expect(unseal(token, 'other'.repeat(8))).toBeNull();
    expect(unseal(seal({ uid: 'u1' }, -1, key), key)).toBeNull();
  });
});
