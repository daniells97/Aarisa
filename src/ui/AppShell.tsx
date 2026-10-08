import type { ReactNode } from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import { useT, type MessageKey } from '~/i18n';
import { can, type Role } from '~/domain/permissions';
import { Icon, type IconName } from './icons';
import { RoutePlate } from './RoutePlate';
import { Badge } from './Pill';

export interface ShellUser { name: string; role: Role }

interface NavItem { to: string; label: MessageKey; icon: IconName; show?: (r: Role) => boolean; badge?: number }
interface NavGroup { label?: MessageKey; items: NavItem[] }

const groups: NavGroup[] = [
  { items: [{ to: '/', label: 'nav.overview', icon: 'home' }] },
  { label: 'nav.group.tforce', items: [
    { to: '/tforce/today', label: 'nav.todayDrivers', icon: 'calendar' },
    { to: '/tforce/week', label: 'nav.weeklyCheck', icon: 'swap' },
  ] },
  { label: 'nav.group.hovership', items: [{ to: '/hovership', label: 'nav.weeklyReport', icon: 'file' }] },
  { label: 'nav.group.money', items: [
    { to: '/payroll', label: 'nav.payroll', icon: 'cash' },
    { to: '/settlements', label: 'nav.settlements', icon: 'receipt', show: (r) => can(r, 'money.view') },
  ] },
  { label: 'nav.group.settings', items: [
    { to: '/settings/rates', label: 'nav.driversRates', icon: 'sliders' },
    { to: '/settings/team', label: 'nav.team', icon: 'team', show: (r) => can(r, 'team.manage') },
  ] },
];

const tabs: NavItem[] = [
  { to: '/tforce/today', label: 'tab.today', icon: 'calendar' },
  { to: '/extra-jobs/new', label: 'tab.extraJobs', icon: 'plus' },
  { to: '/exceptions', label: 'tab.exceptions', icon: 'diamond' },
  { to: '/week', label: 'tab.week', icon: 'chart' },
];

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');
}

function isActive(path: string, to: string) {
  return to === '/' ? path === '/' : path === to || path.startsWith(`${to}/`);
}

export function AppShell({ user, children, badges = {} }: { user: ShellUser; children: ReactNode; badges?: Record<string, number> }) {
  const t = useT();
  const path = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div className="shell">
      <aside className="side">
        <div className="side-brand"><RoutePlate code="A" size="lg" />{t('app.name')}</div>
        <nav aria-label={t('nav.main')}>
          {groups.map((g, gi) => {
            const items = g.items.filter((i) => !i.show || i.show(user.role));
            if (!items.length) return null;
            return (
              <div key={gi} style={{ display: 'contents' }}>
                {g.label && <div className="side-group">{t(g.label)}</div>}
                {items.map((i) => (
                  <Link key={i.to} to={i.to} aria-current={isActive(path, i.to) ? 'page' : undefined}>
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
      <main className="content" id="main">{children}</main>
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
