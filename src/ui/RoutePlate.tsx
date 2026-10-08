/** Freeway-green route plate for every T-Force route code. Amber when the route needs a driver. */
export function RoutePlate({ code, size = 'md', needsDriver = false }: { code: string; size?: 'sm' | 'md' | 'lg'; needsDriver?: boolean }) {
  const cls = ['plate', size !== 'md' && `plate-${size}`, needsDriver && 'plate-amber'].filter(Boolean).join(' ');
  return <span className={cls}>{code}</span>;
}
