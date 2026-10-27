/**
 * The little markdown her words carry, drawn rather than shown as marks.
 *
 * Inline: `**bold**` and `` `code` ``. Blocks: a heading (`#` to `######`) is one bold line, a run
 * of `-`, `*`, `•` or `1.` lines is a list, blank lines part paragraphs, and a `---` rule is
 * dropped. The model writes all of these - bold for the one thing to notice, a heading over a
 * longer answer, backticks for a name such as `connector.setup.overlay_status` - and the rail used
 * to print them as typed.
 *
 * Deliberately small. Each inline mark stays inside one line, so a stray `*` in ordinary text
 * ("2 * 3") is never read as markup, and everything is a text node: no HTML is ever built from
 * what she said, so a message cannot inject markup into her window.
 */
import { Fragment, type ReactNode } from "react";

const MARKS = /(\*\*[^*\n]+?\*\*|`[^`\n]+`)/g;
// Anchored with one open run, so it reads a line in linear time; the old `(.+?)\s*#*\s*$` tail
// backtracked cubically over a run of spaces (4,000 of them took seconds) and ate the # of "C#".
const HEADING = /^#{1,6}[ \t]+(.*)$/;
const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;

const CODE = /(`[^`\n]+`)/g;

/** Text with its `code` spans drawn; text nodes only. */
function withCode(text: string): ReactNode[] {
  return text.split(CODE).map((part, i) => (i % 2 === 1 ? <code key={i}>{part.slice(1, -1)}</code> : <Fragment key={i}>{part}</Fragment>));
}

/** Her words with `**bold**` as <strong> and `` `code` `` as <code>; everything else as typed. */
export function richText(text: string): ReactNode[] {
  // `split` with one capture group puts each match at an odd index; only those are marks.
  return text.split(MARKS).map((part, i) => {
    if (i % 2 === 1 && part.startsWith("**")) return <strong key={i}>{withCode(part.slice(2, -2))}</strong>;
    if (i % 2 === 1) return <code key={i}>{part.slice(1, -1)}</code>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

/**
 * Her words with the marks taken out, for a one-line caption (the tape, the face): the same
 * reading as {@link RichMessage}, with headings, items and paragraphs run together.
 */
export function plainOf(text: string): string {
  return blocksOf(text)
    .flatMap((block): string[] => ("items" in block ? block.items : [block.text]))
    .map((part) => part.replace(MARKS, (mark: string) => (mark.startsWith("**") ? mark.slice(2, -2) : mark.slice(1, -1))))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** A heading's words: a closing run of `#` goes only when a space stands before it (CommonMark). */
function headingText(rest: string): string {
  const t = rest.trimEnd();
  let end = t.length;
  while (end > 0 && t[end - 1] === "#") end--;
  const words = end > 0 && /[ \t]/.test(t[end - 1]!) ? t.slice(0, end).trimEnd() : end === t.length ? t : "";
  return words || t;
}

type Block = { kind: "p" | "h"; text: string } | { kind: "ul" | "ol"; items: string[] };

/** Her message as blocks: headings, lists and paragraphs, in the order she wrote them. */
export function blocksOf(text: string): Block[] {
  const out: Block[] = [];
  let para: string[] = [];
  const close = () => {
    if (para.length) out.push({ kind: "p", text: para.join("\n") });
    para = [];
  };
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    const found = HEADING.exec(line);
    const heading = found && found[1]!.trim() ? [line, headingText(found[1]!)] : null;
    const item = BULLET.exec(line) ?? NUMBERED.exec(line);
    if (!line.trim() || RULE.test(line)) {
      close();
    } else if (heading) {
      close();
      out.push({ kind: "h", text: heading[1]! });
    } else if (item) {
      close();
      const kind = BULLET.test(line) ? "ul" : "ol";
      const last = out[out.length - 1];
      if (last && last.kind === kind) last.items.push(item[1]!);
      else out.push({ kind, items: [item[1]!] });
    } else {
      para.push(line);
    }
  }
  close();
  return out;
}

/** Her message drawn: {@link blocksOf}, each block's words through {@link richText}. */
export function RichMessage({ text }: { text: string }) {
  return <>{blocksOf(text).map(drawBlock)}</>;
}

function drawBlock(block: Block, i: number): ReactNode {
  switch (block.kind) {
    case "p":
      return <p key={i}>{richText(block.text)}</p>;
    case "h":
      return (
        <p key={i} className="md-h">
          {richText(block.text)}
        </p>
      );
    case "ul":
      return <ul key={i}>{block.items.map(drawItem)}</ul>;
    case "ol":
      return <ol key={i}>{block.items.map(drawItem)}</ol>;
  }
}

function drawItem(item: string, j: number): ReactNode {
  return <li key={j}>{richText(item)}</li>;
}
