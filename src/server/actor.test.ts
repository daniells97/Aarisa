import { describe, expect, it } from 'vitest';
import { ForbiddenError, UnauthorizedError, assertCan, type Actor } from './actor';

const actor = (role: Actor['role']): Actor => ({ userId: 'u', role, name: role, locale: 'en', source: 'portal' });

describe('assertCan', () => {
  it('throws 401 without a session', () => {
    expect(() => assertCan(null, 'payroll.view')).toThrow(UnauthorizedError);
  });
  it('throws 403 when the role lacks the permission', () => {
    expect(() => assertCan(actor('dispatcher'), 'money.view')).toThrow(ForbiddenError);
    expect(() => assertCan(actor('finance'), 'payroll.approve')).toThrow(ForbiddenError);
  });
  it('passes when allowed', () => {
    expect(() => assertCan(actor('owner'), 'payroll.approve')).not.toThrow();
  });
});
