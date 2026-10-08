// Permission matrix from docs/spec.md §2. Enforced on the server; the UI only mirrors it.
export type Role = 'owner' | 'dispatcher' | 'finance' | 'viewer';
export const ROLES: Role[] = ['owner', 'dispatcher', 'finance', 'viewer'];

export type Permission =
  | 'drivers.confirm_today'
  | 'extra_jobs.log'
  | 'exceptions.clear'
  | 'hovership.enter_bonus'
  | 'hovership.import'
  | 'payroll.approve'
  | 'payroll.reopen'
  | 'payroll.view'
  | 'payroll.export'
  | 'money.view' // client rates, revenue, profit
  | 'settlements.record'
  | 'setup.edit' // drivers, contractors, services, rates
  | 'team.manage';

const matrix: Record<Permission, Role[]> = {
  'drivers.confirm_today': ['owner', 'dispatcher'],
  'extra_jobs.log': ['owner', 'dispatcher'],
  'exceptions.clear': ['owner', 'dispatcher', 'finance'],
  'hovership.enter_bonus': ['owner', 'finance'],
  // Uploading a report is the same trust level as entering bonuses (open question: confirm).
  'hovership.import': ['owner', 'finance'],
  'payroll.approve': ['owner'],
  'payroll.reopen': ['owner'],
  // Dispatchers see driver pay but never client rates, revenue or profit.
  'payroll.view': ['owner', 'dispatcher', 'finance', 'viewer'],
  // The payroll file goes to whoever pays drivers (open question 6); viewers can download it read-only.
  'payroll.export': ['owner', 'finance', 'viewer'],
  'money.view': ['owner', 'finance', 'viewer'],
  'settlements.record': ['owner', 'finance'],
  'setup.edit': ['owner'],
  'team.manage': ['owner'],
};

export function can(role: Role | null | undefined, permission: Permission): boolean {
  return role != null && matrix[permission].includes(role);
}

export function isRole(v: unknown): v is Role {
  return typeof v === 'string' && (ROLES as string[]).includes(v);
}

/** Highest-privilege role from a list of Zitadel project roles. */
export function pickRole(roles: Iterable<string>): Role | null {
  const set = new Set(roles);
  return ROLES.find((r) => set.has(r)) ?? null;
}
