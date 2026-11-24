import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useT } from '~/i18n';
import { DriverFile } from './DriverFile';
import { useFormat } from './format';

/**
 * The daily panel's shortcuts on a person: their notes and loans (the driver file) and logging an extra job
 * for them that day. Open notes and what they still owe show on the button so nobody has to open it to know.
 */
export function PersonActions({ driverId, name, date, openNotes = 0, owedCents = 0, canLogExtra }: {
  driverId: string; name: string; date: string; openNotes?: number; owedCents?: number; canLogExtra: boolean;
}) {
  const t = useT();
  const f = useFormat();
  const [open, setOpen] = useState(false);
  const flags = [openNotes > 0 ? t('pa.notes', { count: openNotes }) : null, owedCents > 0 ? t('pa.owes', { amount: f.money(owedCents) }) : null].filter(Boolean);
  return (
    <span className="person-actions">
      <button type="button" className="link-btn" onClick={() => setOpen(true)} aria-label={t('pa.fileFor', { name })}>
        {t('pa.file')}{flags.length > 0 && <span className="person-flags"> · {flags.join(' · ')}</span>}
      </button>
      {canLogExtra && <Link to="/extra-jobs/new" search={{ date, payee: `d:${driverId}` }} className="link-btn" aria-label={t('pa.extraFor', { name })}>{t('pa.extra')}</Link>}
      {open && <DriverFile driverId={driverId} name={name} onClose={() => setOpen(false)} />}
    </span>
  );
}
