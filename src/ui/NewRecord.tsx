import type { ReactNode } from 'react';
import { useT } from '~/i18n';
import { Button } from './Button';
import { Icon } from './icons';

/**
 * A new record typed straight into Today's drivers, like a new line in a spreadsheet: the same columns as
 * the list, "Save" at the end. After saving, a fresh blank line is ready for the next one.
 * `cells` are the editable fields (driver, person, routes); the row adds Save and Cancel.
 */
export function NewRecord({ cells, layout, canSave, busy, error, onSave, onCancel }: {
  cells: ReactNode[]; layout: 'row' | 'card'; canSave: boolean; busy: boolean; error: string | null;
  onSave: () => void; onCancel: () => void;
}) {
  const t = useT();
  const actions = (
    <span className="new-record-actions">
      <Button variant="primary" size="sm" disabled={!canSave || busy} onClick={onSave}>{t('td.saveRecord')}</Button>
      <button type="button" className="icon-btn" aria-label={t('common.cancel')} onClick={onCancel}><Icon name="close" width={18} height={18} /></button>
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
