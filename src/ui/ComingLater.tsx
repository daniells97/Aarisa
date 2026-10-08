import type { MessageKey } from '~/i18n';
import { useT } from '~/i18n';
import { PageHead } from './AppShell';
import { Panel } from './Panel';

/** Placeholder for screens built in Phase 2 or 3, so navigation works from day one. */
export function ComingLater({ title }: { title: MessageKey }) {
  const t = useT();
  return (
    <>
      <PageHead title={t(title)} />
      <Panel><p className="panel-body" style={{ paddingTop: 20, margin: 0 }}>{t('common.comingLater')}</p></Panel>
    </>
  );
}
