/**
 * @catalog One item on an overview grid, opening its layer: emblem, name, standing, one line (ADR 0029).
 *
 * The whole tile is one button, because the only act an overview keeps is navigation. The
 * emblem dominates, the name sits under it, the standing is a small pill in the top right, and
 * the line is one sentence. `figure` is an optional headline number for an item whose worth is a
 * number (a playbook's value); it sits between the name and the line and is the tile's loudest
 * text, so a grid of them compares at a glance.
 */
import type { ReactNode } from "react";

export default function Tile({
  emblem,
  eyebrow,
  title,
  pill,
  figure,
  figureNote,
  line,
  foot,
  accent = false,
  onOpen,
}: {
  emblem?: ReactNode;
  eyebrow?: string;
  title: string;
  pill?: ReactNode;
  figure?: string;
  figureNote?: string;
  line?: string;
  foot?: ReactNode;
  /** The chosen one on a grid: a raised rung and the accent edge. */
  accent?: boolean;
  onOpen: () => void;
}) {
  return (
    <button type="button" className={`tile focus-ring${accent ? " tile--accent" : ""}`} onClick={onOpen}>
      <span className="tile__top">
        {emblem ? <span className="tile__emblem">{emblem}</span> : null}
        {eyebrow && !emblem ? <span className="typo-label tile__eyebrow">{eyebrow}</span> : null}
        {pill ? <span className="tile__pill">{pill}</span> : null}
      </span>
      {eyebrow && emblem ? <span className="typo-label tile__eyebrow">{eyebrow}</span> : null}
      <span className="typo-heading tile__title">{title}</span>
      {figure ? (
        <span className="tile__figure">
          <span className="tile__figure-n">{figure}</span>
          {figureNote ? <span className="typo-caption">{figureNote}</span> : null}
        </span>
      ) : null}
      {line ? <span className="typo-body tile__line">{line}</span> : null}
      {foot ? <span className="tile__foot">{foot}</span> : null}
    </button>
  );
}
