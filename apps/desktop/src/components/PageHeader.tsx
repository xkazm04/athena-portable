/**
 * @catalog The sticky title band: eyebrow · title · caption · meta · action.
 *
 * House style §2.1 budgets, enforced by the tiers rather than by a comment: the title is a name
 * of two to five words (it wraps, it never elides), the caption is one sentence of twelve words
 * or fewer, and anything longer than that does not belong on the page at all.
 *
 * It renders outside every conditional in a module, because it is what tells you which page you
 * are on — a frame that disappears when a route answers 501 reads as a crash. Loading, empty,
 * degraded and refused are states of the *body*.
 */
import type { ReactNode } from "react";

export default function PageHeader({
  eyebrow,
  title,
  caption,
  meta,
  action,
}: {
  eyebrow?: string;
  title: string;
  caption?: string;
  meta?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="page-header__titles">
        {eyebrow ? <span className="typo-label page-header__eyebrow">{eyebrow}</span> : null}
        <h1 className="typo-heading-lg">{title}</h1>
        {caption ? <p className="typo-caption">{caption}</p> : null}
      </div>
      {meta || action ? (
        <div className="page-header__meta">
          {meta}
          {action}
        </div>
      ) : null}
    </header>
  );
}
