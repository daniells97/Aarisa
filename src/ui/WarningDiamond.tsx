/** Amber warning diamond. Only for exceptions, late money and blockers. The text beside it carries the meaning. */
export function WarningDiamond({ size = 26 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" width={size} height={size} className="diamond">
      <path d="M12 1.5 22.5 12 12 22.5 1.5 12z" fill="var(--amber)" stroke="var(--ink)" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M12 7.5v5.5M12 16v.4" stroke="var(--ink)" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}
