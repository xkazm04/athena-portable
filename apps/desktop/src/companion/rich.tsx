/**
 * The little markdown her words carry, drawn rather than shown as marks: `**bold**` and `` `code` ``.
 *
 * The model writes both often - bold for the one thing to notice, backticks for a name such as
 * `connector.setup.overlay_status` - and the rail used to print the asterisks and the backticks as
 * typed. Two forms only, inside one line each, so a stray `*` in ordinary text ("2 * 3") is never
 * read as markup, and everything is a text node: no HTML is ever built from what she said, so a
 * message cannot inject markup into her window.
 */
import { Fragment, type ReactNode } from "react";

const MARKS = /(\*\*[^*\n]+?\*\*|`[^`\n]+`)/g;

/** Her words with `**bold**` as <strong> and `` `code` `` as <code>; everything else as typed. */
export function richText(text: string): ReactNode[] {
  // `split` with one capture group puts each match at an odd index; only those are marks.
  return text.split(MARKS).map((part, i) => {
    if (i % 2 === 1 && part.startsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (i % 2 === 1) return <code key={i}>{part.slice(1, -1)}</code>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}
