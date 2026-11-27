import { Icon } from './icons';

/** The × on a row of the daily list: takes it off quickly (the page shows Undo). */
export function RowRemove({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="row-x" onClick={onClick} aria-label={label} title={label}>
      <Icon name="close" width={18} height={18} />
    </button>
  );
}
