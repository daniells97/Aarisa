import type { ReactNode } from 'react';

export function Panel({ title, aside, children, id }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; id?: string }) {
  const headingId = id ? `${id}-h` : undefined;
  return (
    <section className="panel" aria-labelledby={title ? headingId : undefined}>
      {title != null && (
        <div className="panel-head">
          <h2 id={headingId}>{title}</h2>
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

/** Figures inside one panel, split by soft rules instead of separate cards. */
export function Figures({ items }: { items: { label: ReactNode; value: ReactNode; note?: ReactNode }[] }) {
  return (
    <dl className="figures" style={{ margin: 0 }}>
      {items.map((f, i) => (
        <div className="figure" key={i}>
          <dt className="figure-label">{f.label}</dt>
          <dd className="figure-value" style={{ margin: 0 }}>{f.value}</dd>
          {f.note != null && <dd className="muted" style={{ margin: 0, fontSize: 13.5 }}>{f.note}</dd>}
        </div>
      ))}
    </dl>
  );
}
