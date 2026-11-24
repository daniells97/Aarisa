import type { ReactNode } from 'react';
import { useT } from '~/i18n';
import { Icon } from './icons';

/**
 * A new record typed straight into Today's drivers, like a new line in a spreadsheet: the same columns as
 * the list. It saves by itself as soon as the needed fields are filled (no Save step), and a fresh blank line
 * is ready for the next one. × closes the blank line.
 */
export function NewRecord({ cells, layout, busy, error, onCancel }: {
  cells: ReactNode[]; layout: 'row' | 'card'; busy: boolean; error: string | null; onCancel: () => void;
}) {
  const t = useT();
  const actions = (
    <span className="new-record-actions">
      {busy && <span className="muted" role="status">{t('td.savingRecord')}</span>}
      <button type="button" className="icon-btn" aria-label={t('td.closeRecord')} onClick={onCancel}><Icon name="close" width={18} height={18} /></button>
    </span>
  );
  const err = error ? <p role="alert" className="field-error" style={{ margin: '6px 0 0' }}>{error}</p> : null;
  if (layout === 'card') return <li className="new-record">{cells}{actions}{err}</li>;
  return (
    <tr className="new-record">
      {cells.map((c, i) => <td key={i}>{c}{i === 0 && err}</td>)}
      <td>{actions}</td>
    </tr>
  );
}
