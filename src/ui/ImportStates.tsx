import { useEffect, useState, type ReactNode } from 'react';
import { useT } from '~/i18n';
import { Panel } from './Panel';
import { WarningDiamond } from './WarningDiamond';

// Shared pieces of the four import states (spec 6.12), used by Hovership now and T-Force in Phase 2.

export function ImportNotice({ tone = 'warn', title, children, actions }: { tone?: 'warn' | 'info' | 'ok'; title: ReactNode; children?: ReactNode; actions?: ReactNode }) {
  return (
    <Panel>
      <div className="panel-body stack" style={{ paddingTop: 20 }} role={tone === 'warn' ? 'alert' : undefined}>
        <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
          {tone === 'warn' ? <WarningDiamond /> : <span aria-hidden="true" className={tone === 'ok' ? 'dot dot-ok' : 'dot dot-info'} />}
          <div className="stack" style={{ gap: 6, flex: 1 }}>
            <h2 style={{ fontSize: 24 }}>{title}</h2>
            {children}
          </div>
        </div>
        {actions && <div className="row">{actions}</div>}
      </div>
    </Panel>
  );
}

const STEPS = ['imp.stepReceived', 'imp.stepColumns', 'imp.stepDrivers', 'imp.stepRates'] as const;

/** Reading state: step progress while the server reads the file. */
export function ReadingSteps({ fileName }: { fileName: string }) {
  const t = useT();
  const [step, setStep] = useState(1);
  useEffect(() => {
    const timer = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 600);
    return () => clearInterval(timer);
  }, []);
  return (
    <ImportNotice tone="info" title={t('imp.readingTitle', { file: fileName })}>
      <ol className="steps" aria-live="polite">
        {STEPS.map((k, i) => (
          <li key={k} data-state={i < step ? 'done' : i === step ? 'now' : 'later'} aria-current={i === step ? 'step' : undefined}>{t(k)}</li>
        ))}
      </ol>
    </ImportNotice>
  );
}
