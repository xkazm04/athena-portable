/**
 * @catalog "Nothing here yet": a framed glyph, a title, one line, an optional action.
 *
 * House style §2.3: an empty state is an answer, not an apology. The one line says what would put
 * something here; "nothing yet" with no next step is the failure mode. And it is not the same
 * component as a route that failed — "nothing here" and "could not be read" are different facts,
 * and rendering a failed route as an empty list is how a broken surface looks fine.
 */
import type { ReactNode } from "react";

export default function EmptyState({
  glyph = "·",
  title,
  line,
  action,
}: {
  glyph?: string;
  title: string;
  line: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-state__glyph typo-heading" aria-hidden="true">
        {glyph}
      </span>
      <p className="typo-title">{title}</p>
      <p className="typo-caption">{line}</p>
      {action}
    </div>
  );
}
