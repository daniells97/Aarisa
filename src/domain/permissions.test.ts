import { describe, expect, it } from 'vitest';
import { can, pickRole, type Permission, type Role } from './permissions';

// One row per action in spec §2, in the same order.
const table: [Permission, Record<Role, boolean>][] = [
  ['drivers.confirm_today', { owner: true, dispatcher: true, finance: false, viewer: false }],
  ['extra_jobs.log', { owner: true, dispatcher: true, finance: false, viewer: false }],
  ['exceptions.clear', { owner: true, dispatcher: true, finance: true, viewer: false }],
  ['hovership.enter_bonus', { owner: true, dispatcher: false, finance: true, viewer: false }],
  ['payroll.approve', { owner: true, dispatcher: false, finance: false, viewer: false }],
  ['money.view', { owner: true, dispatcher: false, finance: true, viewer: true }],
  ['settlements.record', { owner: true, dispatcher: false, finance: true, viewer: false }],
  ['setup.edit', { owner: true, dispatcher: false, finance: false, viewer: false }],
  ['team.manage', { owner: true, dispatcher: false, finance: false, viewer: false }],
  // Phase 1 additions (open questions 27 and 29).
  ['hovership.import', { owner: true, dispatcher: false, finance: true, viewer: false }],
  ['payroll.reopen', { owner: true, dispatcher: false, finance: false, viewer: false }],
  ['payroll.view', { owner: true, dispatcher: true, finance: true, viewer: true }],
  ['payroll.export', { owner: true, dispatcher: false, finance: true, viewer: true }],
  ['audit.view', { owner: true, dispatcher: false, finance: true, viewer: true }],
];

describe('permission matrix (spec §2)', () => {
  for (const [perm, expected] of table) {
    for (const [role, allowed] of Object.entries(expected) as [Role, boolean][]) {
      it(`${role} ${allowed ? 'can' : 'cannot'} ${perm}`, () => expect(can(role, perm)).toBe(allowed));
    }
  }
  it('denies everything without a role', () => {
    expect(can(null, 'payroll.view')).toBe(false);
  });
  it('picks the highest role from Zitadel project roles', () => {
    expect(pickRole(['viewer', 'finance'])).toBe('finance');
    expect(pickRole(['dispatcher', 'owner'])).toBe('owner');
    expect(pickRole(['something-else'])).toBeNull();
  });
});
