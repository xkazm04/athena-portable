/**
 * @catalog A titled band inside a page: a heading, an optional note, a hairline, content flush.
 *
 * Not a card. House style §3.2: a page of eight cards is a page of eight borders and sixteen
 * paddings — reach for `SectionCard` only when the content has to read as one object.
 */
import type { ReactNode } from "react";

export default function PageSection({
  title,
  note,
  action,
  children,
}: {
  title: string;
  note?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="page-section">
      <div className="page-section__head">
        <h2 className="typo-title">{title}</h2>
        {note ? <span className="typo-caption">{note}</span> : null}
        {action ? <span style={{ marginLeft: "auto" }}>{action}</span> : null}
      </div>
      {children}
    </section>
  );
}
