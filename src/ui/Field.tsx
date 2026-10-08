import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';

interface FieldProps { label: ReactNode; hint?: ReactNode; error?: ReactNode }

/** Labelled input with hint and error wired to aria-describedby. */
export function TextField({ label, hint, error, className, ...rest }: FieldProps & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  const describedBy = [hint && `${id}-hint`, error && `${id}-err`].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} className={['input', className].filter(Boolean).join(' ')} aria-invalid={error ? true : undefined} aria-describedby={describedBy} {...rest} />
      {hint && <span id={`${id}-hint`} className="muted" style={{ fontSize: 13.5 }}>{hint}</span>}
      {error && <span id={`${id}-err`} className="field-error">{error}</span>}
    </div>
  );
}

export function SelectField({ label, hint, error, children, className, ...rest }: FieldProps & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId();
  const describedBy = [hint && `${id}-hint`, error && `${id}-err`].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} className={['input', className].filter(Boolean).join(' ')} aria-invalid={error ? true : undefined} aria-describedby={describedBy} {...rest}>{children}</select>
      {hint && <span id={`${id}-hint`} className="muted" style={{ fontSize: 13.5 }}>{hint}</span>}
      {error && <span id={`${id}-err`} className="field-error">{error}</span>}
    </div>
  );
}

export function CheckField({ label, ...rest }: { label: ReactNode } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 44 }}>
      <input id={id} type="checkbox" style={{ width: 22, height: 22, accentColor: 'var(--green)' }} {...rest} />
      <label htmlFor={id}>{label}</label>
    </div>
  );
}

/** Form-level error shown above the buttons, announced to screen readers. */
export function FormError({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return <p role="alert" className="field-error" style={{ margin: 0 }}>{children}</p>;
}
