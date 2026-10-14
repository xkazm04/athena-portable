/**
 * Simple markdown for a playbook's `brief` — README section 3.5, ADR 0096.
 *
 * Three things only, so a brief stays a scan and never a page: blocks split on blank lines; a line
 * starting with `- ` is a bullet; `**bold**` inside any line. Everything is text nodes, never HTML,
 * so a brief cannot inject markup.
 */
import { Fragment, type ReactNode } from "react";


export function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
      <strong key={i}>{part.slice(2, -2)}</strong>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

export interface Block {
  kind: "p" | "ul";
  lines: string[];
}

export function blocks(md: string): Block[] {
  const out: Block[] = [];
  for (const chunk of md.replace(/\r\n/g, "\n").split(/\n\s*\n/)) {
    const lines = chunk
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    let para: string[] = [];
    let list: string[] = [];
    const flush = () => {
      if (para.length) out.push({ kind: "p", lines: [para.join(" ")] });
      if (list.length) out.push({ kind: "ul", lines: list });
      para = [];
      list = [];
    };
    for (const line of lines) {
      if (line.startsWith("- ")) {
        if (para.length) flush();
        list.push(line.slice(2));
      } else {
        if (list.length) flush();
        para.push(line);
      }
    }
    flush();
  }
  return out;
}

/** The brief's first paragraph as plain text (no `**`), for a one-line teaser in a ledger row. */
export function lead(md: string): string {
  const first = blocks(md).find((b) => b.kind === "p");
  return (first?.lines[0] ?? "").replace(/\*\*/g, "");
}

export default function Rich({ md, className = "" }: { md: string; className?: string }) {
  if (!md.trim()) return null;
  return (
    <div className={`rich ${className}`.trim()}>
      {blocks(md).map((b, i) =>
        b.kind === "ul" ? (
          <ul key={i}>
            {b.lines.map((l, j) => (
              <li key={j}>{inline(l)}</li>
            ))}
          </ul>
        ) : (
          <p key={i}>{inline(b.lines[0]!)}</p>
        ),
      )}
    </div>
  );
}
