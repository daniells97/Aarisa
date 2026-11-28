import { useEffect, useRef, useState } from 'react';
import { useT } from '~/i18n';
import { Button } from './Button';
import { Dialog } from './Dialog';
import { DriverFile } from './DriverFile';
import { PersonPicker } from './PersonPicker';

/**
 * "Notes and loans" at the top of Today's drivers, next to Add record and Log extra job: a loan or a note
 * can happen on a day the person drove no route, so it can't depend on their row being on the list.
 * Pick the person, then their file (notes and loans) opens.
 */
export function NotesLoansButton({ drivers }: { drivers: { id: string; name: string; contractor?: string | null }[] }) {
  const t = useT();
  const [picking, setPicking] = useState(false);
  const [who, setWho] = useState<{ id: string; name: string } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  // Straight to typing the name (the dialog would otherwise focus its close button).
  useEffect(() => { if (picking) setTimeout(() => box.current?.querySelector('input')?.focus(), 0); }, [picking]);
  return (
    <>
      <Button onClick={() => setPicking(true)}>{t('pa.file')}</Button>
      {picking && (
        <Dialog open onClose={() => setPicking(false)} title={t('pa.file')}>
          <div ref={box}><PersonPicker value="" options={{ drivers, contractors: [] }} label={t('pa.fileWho')} placeholder={t('pa.fileSearch')} allowNone={false}
            onPick={(v) => {
              const d = drivers.find((x) => `d:${x.id}` === v);
              if (!d) return;
              setPicking(false);
              setWho({ id: d.id, name: d.name });
            }} /></div>
        </Dialog>
      )}
      {who && <DriverFile driverId={who.id} name={who.name} onClose={() => setWho(null)} />}
    </>
  );
}
