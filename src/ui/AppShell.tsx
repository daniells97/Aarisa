import type { ReactNode } from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import { useT, type MessageKey } from '~/i18n';
import { can, type Role } from '~/domain/permissions';
import { Icon, type IconName } from './icons';
import { BrandLogo } from './BrandLogo';
import { Badge } from './Pill';

export interface ShellUser { name: string; role: Role }

interface NavItem { to: string; label: MessageKey; icon: IconName; show?: (r: Role) => boolean; badge?: number; op?: string }
interface NavGroup { label?: MessageKey; title?: string; items: NavItem[] }
export interface ShellOperation { code: string; name: string; driverSource: 'report_code' | 'daily_list' }

/**
 * One menu group per contract, with the screens its driver source needs (stage 6c): the daily list and
 * weekly check when Aarisa's list names the driver, the weekly report when the client's report does.
 * The first contract of each kind keeps the plain address; others add ?op=<code>.
 */
function operationGroups(ops: ShellOperation[]): NavGroup[] {
  const firstOf = (src: ShellOperation['driverSource']) => ops.find((o) => o.driverSource === src)?.code;
  return ops.map((o) => {
    const op = o.code === firstOf(o.driverSource) ? undefined : o.code;
    return {
      title: o.name,
      items: o.driverSource === 'daily_list'
        ? [{ to: '/tforce/today', label: 'nav.todayDrivers' as const, icon: 'calendar' as const, op }, { to: '/tforce/week', label: 'nav.weeklyCheck' as const, icon: 'swap' as const, op }]
        : [{ to: '/hovership', label: 'nav.weeklyReport' as const, icon: 'file' as const, op }],
    };
  });
}

const fixedGroups: NavGroup[] = [
  { label: 'nav.group.money', items: [
    { to: '/payroll', label: 'nav.payroll', icon: 'cash' },
    { to: '/settlements', label: 'nav.settlements', icon: 'receipt', show: (r) => can(r, 'money.view') },
  ] },
  { label: 'nav.group.settings', items: [
    { to: '/settings/rates', label: 'nav.driversRates', icon: 'sliders' },
    { to: '/settings/team', label: 'nav.team', icon: 'team', show: (r) => can(r, 'team.manage') },
    { to: '/settings/audit', label: 'nav.audit', icon: 'file', show: (r) => can(r, 'audit.view') },
  ] },
];

const tabs: NavItem[] = [
  { to: '/tforce/today', label: 'tab.today', icon: 'calendar' },
  { to: '/extra-jobs', label: 'tab.extraJobs', icon: 'plus' },
  { to: '/exceptions', label: 'tab.exceptions', icon: 'diamond' },
  { to: '/week', label: 'tab.week', icon: 'chart' },
];

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');
}

function isActive(path: string, to: string) {
  return to === '/' ? path === '/' : path === to || path.startsWith(`${to}/`);
}

export function AppShell({ user, children, badges = {}, operations = [] }: { user: ShellUser; children: ReactNode; badges?: Record<string, number>; operations?: ShellOperation[] }) {
  const t = useT();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const currentOp = useRouterState({ select: (s) => (s.location.search as { op?: string }).op });
  const groups: NavGroup[] = [{ items: [{ to: '/', label: 'nav.overview', icon: 'home' }] }, ...operationGroups(operations), ...fixedGroups];
  const active = (i: NavItem) => isActive(path, i.to) && (i.op ?? undefined) === (currentOp ?? undefined);
  return (
    <div className="shell">
      <aside className="side">
        <Link to="/" className="side-brand" aria-label={t('nav.overview')}><BrandLogo height={58} /></Link>
        <nav aria-label={t('nav.main')}>
          {groups.map((g, gi) => {
            const items = g.items.filter((i) => !i.show || i.show(user.role));
            if (!items.length) return null;
            return (
              <div key={gi} style={{ display: 'contents' }}>
                {(g.label || g.title) && <div className="side-group">{g.title ?? t(g.label!)}</div>}
                {items.map((i) => (
                  <Link key={`${i.to}${i.op ?? ''}`} to={i.to} search={(i.op ? { op: i.op } : {}) as never} aria-current={active(i) ? 'page' : undefined}>
                    <Icon name={i.icon} />{t(i.label)}
                    <Badge count={badges[i.to] ?? 0} label={String(badges[i.to] ?? 0)} />
                  </Link>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="side-user">
          <span className="avatar" aria-hidden="true">{initials(user.name)}</span>
          <span style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontWeight: 600, fontSize: 14.5 }}>{user.name}</span>
            <span className="muted" style={{ fontSize: 13 }}>{t(`role.${user.role}`)}</span>
          </span>
          <a href="/auth/logout" className="btn btn-sm" aria-label={t('nav.signOut')} style={{ width: 44, padding: 0 }}>
            <Icon name="signOut" width={19} height={19} />
          </a>
        </div>
      </aside>
      <main className="content" id="main">
        <div className="phone-brand"><BrandLogo variant="horizontal" height={34} /></div>
        {children}
      </main>
      <nav className="tabbar" aria-label={t('nav.main')}>
        {tabs.map((i) => (
          <Link key={i.to} to={i.to} aria-current={isActive(path, i.to) ? 'page' : undefined}>
            <Icon name={i.icon} />{t(i.label)}
          </Link>
        ))}
      </nav>
    </div>
  );
}

export function PageHead({ title, lead, actions }: { title: ReactNode; lead?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-head">
      <div><h1>{title}</h1>{lead && <p>{lead}</p>}</div>
      {actions}
    </header>
  );
}
