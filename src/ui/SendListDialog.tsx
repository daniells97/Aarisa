import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useT } from '~/i18n';
import { Button } from './Button';
import { Sheet } from './Dialog';

/**
 * "Send list": before anything goes out, who will get it, how many people it has, and whether it's the first send
 * of the day or an update (which says what changed). With nobody marked, it says where to mark them.
 */
export function SendListDialog({ recipients, people, withoutCode, sentAt, changed, canManageTeam, onSend, onClose }: {
  recipients: { name: string; email: string }[];
  people: number; withoutCode: number;
  sentAt: string | null; changed: boolean; canManageTeam: boolean;
  onSend: () => Promise<void>; onClose: () => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const time = sentAt ? new Intl.DateTimeFormat(undefined, { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' }).format(new Date(sentAt)) : '';
  return (
    <Sheet open onClose={onClose} title={t(sentAt ? 'send.titleAgain' : 'send.title')}
      footer={<>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="primary" disabled={busy || !recipients.length} onClick={async () => { setBusy(true); try { await onSend(); onClose(); } finally { setBusy(false); } }}>
          {t(recipients.length === 1 ? 'send.toOne' : 'send.toMany', { count: recipients.length })}
        </Button>
      </>}>
      <div className="stack" style={{ gap: 14 }}>
        <p style={{ margin: 0 }}>{t('send.what', { count: people })}{withoutCode > 0 && <> {t('send.withoutCode', { count: withoutCode })}</>}</p>
        {sentAt && <p className="notice notice-info" style={{ margin: 0 }}>{t(changed ? 'send.update' : 'send.sameAgain', { time })}</p>}
        <div>
          <h3 style={{ margin: '0 0 6px', fontSize: 15 }}>{t('send.to')}</h3>
          {recipients.length ? (
            <ul className="send-to">
              {recipients.map((r) => <li key={r.email}><strong>{r.name}</strong><span className="muted">{r.email}</span></li>)}
            </ul>
          ) : (
            <p className="notice" style={{ margin: 0 }}>
              {t('send.nobody')}{' '}
              {canManageTeam && <Link to="/settings/team">{t('send.markInTeam')}</Link>}
            </p>
          )}
        </div>
      </div>
    </Sheet>
  );
}
