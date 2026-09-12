/**
 * @catalog Every module's outer frame: one width, one gutter, one rhythm.
 *
 * House style §3.1: a module never writes `mx-auto`, a max width, a gutter or a scroll. The width
 * is 120rem, which on any window under 1920px is the window — wide is right *because* a page here
 * carries rows, figures and controls rather than paragraphs, and every column pushed off the fold
 * is a scroll the user pays for.
 *
 * `fill` is for the one module whose body is a viewport-height workspace; it resolves against a
 * definite height, which is why the preview harness gives its body one.
 */
import type { ReactNode } from "react";

export default function PageShell({
  fill = false,
  children,
}: {
  fill?: boolean;
  children: ReactNode;
}) {
  return <div className={fill ? "page-shell page-shell--fill" : "page-shell"}>{children}</div>;
}
