import { afterEach, describe, expect, it, vi } from 'vitest';
import { inviteEmail, resetEmail } from '~/server/emails';
import { sendMail } from './mail';
import { inviteUser, passwordResetLink } from './zitadel';

const cfg = { apiKey: 're_test', from: 'no-reply@aarisaconsulting.com' };
const zitadel = { issuer: 'https://auth.test', token: 't', projectId: 'p1', orgId: 'org1' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('sign-in emails', () => {
  it('sends from the Aarisa address through Resend', async () => {
    const calls: [string, RequestInit][] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push([url, init]);
      return json({ id: 'email-1' });
    }));
    const mail = inviteEmail('es', 'ana@test.com', 'https://auth.test/ui/v2/login/verify?code=1', 'Ana', 'Despachador');
    expect(await sendMail(mail, cfg)).toBe(true);
    expect(calls[0]![0]).toBe('https://api.resend.com/emails');
    expect(new Headers(calls[0]![1].headers).get('authorization')).toBe('Bearer re_test');
    const body = JSON.parse(String(calls[0]![1].body));
    expect(body).toMatchObject({ from: 'Aarisa Consulting <no-reply@aarisaconsulting.com>', to: ['ana@test.com'], subject: 'Tu acceso al portal de Aarisa' });
    expect(body.html).toContain('Hola Ana, te invitaron al portal de Aarisa como Despachador.');
  });

  it('says no instead of throwing when mail is not set up or Resend refuses', async () => {
    expect(await sendMail(resetEmail('en', 'a@test.com', 'https://x'), null)).toBe(false);
    vi.stubGlobal('fetch', vi.fn(async () => json({ message: 'domain not verified' }, 403)));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await sendMail(resetEmail('en', 'a@test.com', 'https://x'), cfg)).toBe(false);
  });

  it('escapes names in the email', () => {
    expect(inviteEmail('en', 'a@test.com', 'https://x', '<b>Ann</b>', 'Owner').html).toContain('&lt;b&gt;Ann&lt;/b&gt;');
  });
});

describe('Zitadel codes instead of Zitadel emails', () => {
  it('an invite asks Zitadel for the code and returns the set-password link; a second invite reuses the user', async () => {
    const paths: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      const path = url.replace(zitadel.issuer, '');
      paths.push(`${init.method} ${path}`);
      if (path === '/v2/users/human') return json({}, 409);
      if (path === '/v2/users') return json({ result: [{ userId: 'u1', state: 'USER_STATE_ACTIVE' }] });
      if (path.includes('grants/_search')) return json({ result: [] });
      if (path.endsWith('/invite_code')) {
        expect(JSON.parse(String(init.body))).toEqual({ returnCode: {} });
        return json({ inviteCode: 'C0DE' });
      }
      return json({});
    }));
    const r = await inviteUser(zitadel, { email: 'ana@test.com', givenName: 'Ana', familyName: 'P', role: 'dispatcher', locale: 'es' });
    expect(r).toEqual({ userId: 'u1', link: 'https://auth.test/ui/v2/login/verify?userId=u1&code=C0DE&invite=true&organization=org1' });
    expect(paths).toContain('POST /management/v1/users/u1/grants');
  });

  it('a reset link only for a known email', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      url.endsWith('/v2/users') ? json({ result: [] }) : json({ verificationCode: 'R' })));
    expect(await passwordResetLink(zitadel, 'nobody@test.com')).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      url.endsWith('/v2/users') ? json({ result: [{ userId: 'u2' }] }) : json({ verificationCode: 'R' })));
    expect(await passwordResetLink(zitadel, 'ana@test.com')).toBe('https://auth.test/ui/v2/login/password/set?userId=u2&code=R&organization=org1');
  });
});
