import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useT } from '~/i18n';
import { Icon } from './icons';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Bottom sheet on phones (radius 24, grab handle); centred dialog on desktop. */
  sheet?: boolean;
}

/** Modal built on native <dialog>: focus trap, Escape and inert background come from the browser. */
export function Dialog({ open, onClose, title, children, footer, sheet = false }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const t = useT();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  return (
    <dialog ref={ref} className={sheet ? 'dialog sheet' : 'dialog'} aria-labelledby={titleId} onClose={onClose}>
      <div className="dialog-head">
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="close-btn" onClick={onClose} aria-label={t('common.close')}>
          <Icon name="close" width={20} height={20} />
        </button>
      </div>
      <div className="dialog-body">{children}</div>
      {footer && <div className="dialog-foot">{footer}</div>}
    </dialog>
  );
}

export function Sheet(props: Omit<DialogProps, 'sheet'>) {
  return <Dialog {...props} sheet />;
}
