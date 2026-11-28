import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { WarningDiamond } from './WarningDiamond';

type Variant = 'primary' | 'secondary' | 'danger';
type Size = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** When set, the button is disabled and this reason is shown under it (design rule: disabled buttons explain why). */
  disabledReason?: ReactNode;
}

export function buttonClass(variant: Variant = 'secondary', size: Size = 'md') {
  return ['btn', variant !== 'secondary' && `btn-${variant}`, size !== 'md' && `btn-${size}`].filter(Boolean).join(' ');
}

export function Button({ variant = 'secondary', size = 'md', disabledReason, className, type = 'button', disabled, ...rest }: ButtonProps) {
  const isDisabled = disabled || disabledReason != null;
  const reasonId = rest.id ? `${rest.id}-why` : undefined;
  const button = (
    <button
      type={type}
      className={[buttonClass(variant, size), className].filter(Boolean).join(' ')}
      disabled={isDisabled}
      aria-describedby={disabledReason != null ? reasonId : undefined}
      {...rest}
    />
  );
  if (disabledReason == null) return button;
  return (
    <div>
      {button}
      <p className="btn-why" id={reasonId}><WarningDiamond size={18} />{disabledReason}</p>
    </div>
  );
}
