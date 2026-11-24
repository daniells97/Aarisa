import { useEffect, useRef, type ReactNode } from 'react';
import { useT } from '~/i18n';
import { Icon } from './icons';

/**
 * A new record typed straight into Today's drivers, like a new line in a spreadsheet: the same columns as
 * the list. It saves by itself as soon as the needed fields are filled (no Save step), and a fresh blank line
 * is ready for the next one. × closes the blank line.
 */
export function NewRecord({ cells, layout, busy, error, onCancel, focus }: {
  cells: ReactNode[]; layout: 'row' | 'card'; busy: boolean; error: string | null; onCancel: () => void;
  /** Opened by a tap on "Add record": bring the line into view (it sits at the end of a long list on a phone) and focus it. */
  focus?: boolean;
}) {
  const t = useT();
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!focus || !el || el.offsetParent === null) return; // only the visible layout (table or cards)
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
  }, [focus]);
  const actions = (
    <span className="new-record-actions">
      {busy && <span className="muted" role="status">{t('td.savingRecord')}</span>}
      <button type="button" className="icon-btn" aria-label={t('td.closeRecord')} onClick={onCancel}><Icon name="close" width={18} height={18} /></button>
    </span>
  );
  const err = error ? <p role="alert" className="field-error" style={{ margin: '6px 0 0' }}>{error}</p> : null;
  if (layout === 'card') return (
    <li className="new-record" ref={(el) => { ref.current = el; }}>
      <div className="new-record-head"><strong>{t('td.newRecord')}</strong>{actions}</div>
      {cells}{err}
    </li>
  );
  return (
    <tr className="new-record" ref={(el) => { ref.current = el; }}>
      {cells.map((c, i) => <td key={i}>{c}{i === 0 && err}</td>)}
      <td>{actions}</td>
    </tr>
  );
}
