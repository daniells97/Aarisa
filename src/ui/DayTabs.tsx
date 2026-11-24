import { Link } from '@tanstack/react-router';
import { useT } from '~/i18n';
import { useClientName } from './ClientNames';

/** Today's drivers has one tab per contract: T-Force (driver codes) and Hovership (people and routes). */
export function DayTabs({ current, date }: { current: 'tforce' | 'hovership'; date: string }) {
  const t = useT();
  const clientName = useClientName();
  return (
    <nav className="tabs tabs-contract" aria-label={t('td.tabs')}>
      <Link to="/tforce/today" search={{ date }} aria-current={current === 'tforce' ? 'page' : undefined}>{clientName('tforce')}</Link>
      <Link to="/hovership/today" search={{ date }} aria-current={current === 'hovership' ? 'page' : undefined}>{clientName('hovership')}</Link>
    </nav>
  );
}
