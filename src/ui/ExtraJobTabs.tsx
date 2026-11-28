import { Link } from '@tanstack/react-router';
import { useT } from '~/i18n';

/** Extra jobs have one tab per contract with extra-job services (T-Force, Hovership), like Today's drivers. */
export function ExtraJobTabs({ to, contracts, current, date, payee, from }: {
  to: '/extra-jobs' | '/extra-jobs/new'; contracts: { code: string; name: string }[]; current: string; date: string; payee?: string; from?: 'today';
}) {
  const t = useT();
  if (contracts.length < 2) return null;
  return (
    <nav className="tabs tabs-contract" aria-label={t('xj.tabs')}>
      {contracts.map((c) => (
        <Link key={c.code} to={to} search={to === '/extra-jobs' ? { date, op: c.code } : { date, op: c.code, payee, from }} aria-current={c.code === current ? 'page' : undefined}>{c.name}</Link>
      ))}
    </nav>
  );
}
