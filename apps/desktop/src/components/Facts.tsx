/**
 * @catalog A term and its value, a few at a time — the `<dl>` the app would otherwise hand-roll.
 *
 * For the four-or-five standing facts a surface states rather than lists: where the store file
 * is, which engine is running, what the probe said. A `Table` for five rows of two columns is a
 * header band and a hairline for nothing; a stack of `<p><strong>` is a `<dl>` with the semantics
 * removed.
 *
 * `value="code"` sets the value in the mono tier, which is for a *machine's own spelling* — a
 * path, a version, an id — and never for prose.
 */
import type { ReactNode } from "react";

export default function Facts({
  layout = "rows",
  children,
}: {
  /** `rows` stacks term over value; `inline` runs them along a line for a header's meta slot. */
  layout?: "rows" | "inline";
  children: ReactNode;
}) {
  return <dl className={`facts facts--${layout}`}>{children}</dl>;
}

export function Fact({
  label,
  value = "text",
  children,
}: {
  label: string;
  value?: "text" | "code";
  children: ReactNode;
}) {
  return (
    <div className="fact">
      <dt className="typo-label muted">{label}</dt>
      <dd className={value === "code" ? "typo-code fact__value" : "typo-data fact__value"}>
        {children}
      </dd>
    </div>
  );
}
