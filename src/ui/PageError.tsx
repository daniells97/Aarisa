import { useT } from '~/i18n';
import { PageHead } from './AppShell';
import { Panel } from './Panel';
import { WarningDiamond } from './WarningDiamond';

/** Error shown inside the app shell; a 403 from the server reads as "no access", not as a crash. */
export function PageError({ error }: { error: unknown }) {
  const t = useT();
  const message = error instanceof Error ? error.message : String(error);
  const forbidden = /Not allowed|Sign in required/.test(message);
  return (
    <>
      <PageHead title={t(forbidden ? 'error.forbiddenTitle' : 'error.pageTitle')} />
      <Panel>
        <div className="panel-body row" style={{ paddingTop: 20 }}>
          <WarningDiamond />
          <p style={{ margin: 0, flex: 1 }}>{t(forbidden ? 'error.forbiddenBody' : 'error.pageBody')}</p>
          {!forbidden && <button type="button" className="btn" onClick={() => window.location.reload()}>{t('error.reload')}</button>}
        </div>
      </Panel>
    </>
  );
}
