import { createHmac, timingSafeEqual } from 'node:crypto';

// Stateless signed cookies: base64url(JSON payload) + "." + HMAC-SHA256. Never encrypted, so no secrets inside.

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters');
  return s;
}

function sign(data: string, key = secret()) {
  return createHmac('sha256', key).update(data).digest('base64url');
}

export function seal<T extends object>(payload: T, ttlSeconds: number, key?: string): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString('base64url');
  return `${body}.${sign(body, key)}`;
}

export function unseal<T>(token: string | undefined, key?: string): T | null {
  if (!token) return null;
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const expected = Buffer.from(sign(body, key));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T & { exp: number };
    return payload.exp > Date.now() / 1000 ? payload : null;
  } catch {
    return null;
  }
}

export const SESSION_COOKIE = 'aarisa_session';
export const LOGIN_COOKIE = 'aarisa_login';
export const SESSION_TTL = 60 * 60 * 12; // 12 hours

export interface SessionPayload { uid: string }
export interface LoginPayload { state: string; verifier: string; nonce: string; returnTo: string }

export function cookieOptions(maxAge: number) {
  return { httpOnly: true, sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production', path: '/', maxAge };
}
