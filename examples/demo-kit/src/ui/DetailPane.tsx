"use client";

/**
 * `DetailPane` - the scaffold's detail view: a title, optional meta rows, actions, body.
 *
 * Real consumer set: `examples/demo-kit/template/app/[id]/page.tsx` only. The four shipped apps
 * each draw their own detail surface.
 */
import type { ReactNode } from "react";
import { clsx } from "clsx";

export interface DetailField {
  label: string;
  value: ReactNode;
}

export interface DetailPaneProps {
  title: ReactNode;
  subtitle?: ReactNode;
  fields?: DetailField[];
  /** Buttons; put GATED actions here so the gate is visible next to the data it touches. */
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}

export function DetailPane({
  title,
  subtitle,
  fields = [],
  actions,
  children,
  className,
}: DetailPaneProps) {
  return (
    <article className={clsx("dk-detail", className)}>
      <header className="dk-detail-head">
        <div>
          <h1 className="dk-detail-title">{title}</h1>
          {subtitle ? <p className="dk-detail-subtitle">{subtitle}</p> : null}
        </div>
        {actions ? <div className="dk-detail-actions">{actions}</div> : null}
      </header>
      {fields.length > 0 ? (
        <dl className="dk-detail-fields">
          {fields.map((f) => (
            <div key={f.label} className="dk-detail-field">
              <dt>{f.label}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {children ? <div className="dk-detail-body">{children}</div> : null}
    </article>
  );
}
