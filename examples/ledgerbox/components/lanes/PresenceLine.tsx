"use client";

/**
 * The presence line, as a component the other two surfaces can copy whole.
 *
 * THE READING LIVES IN `presence.ts`; this file only draws it. `useAthenaPresence` is the source
 * of truth for whether a bridge is actually in the page — this component takes the answer as
 * three plain props so that Hirelane's Board and TidyCRM's Blocks can render the identical line
 * from their own manifests without importing Ledgerbox's model.
 *
 * THE SHAPE IS A STATUS, NOT A PARAGRAPH. A dot carrying the state colour, one short sentence at
 * a reading size, and the register underneath it as a quieter second line. It used to be a single
 * 12px mono paragraph wrapping to three lines behind a hollow dot, which is a caption; the one
 * element on the surface that turns on when an agent attaches has to read as an instrument.
 *
 * Grey is the shipped state and must not look like a warning: "registered and waiting" is what
 * every one of these apps does until a bridge arrives.
 */

export interface PresenceLineProps {
  /** A bridge is in this page — an agent is actually beside it. */
  connected: boolean;
  /** How many capabilities the page registers. */
  offered: number;
  /** How many of those ask a person first. */
  gated: number;
}

export function PresenceLine({ connected, offered, gated }: PresenceLineProps) {
  return (
    <div className="ln-presence" data-on={connected} role="status">
      <span className="ln-presence-dot" aria-hidden />
      <span className="ln-presence-lines">
        <span className="ln-presence-say">
          {connected ? "Athena is connected." : "Athena is not connected."}
        </span>
        <span className="ln-presence-count">
          {offered} capabilities offered · {gated} gated
        </span>
      </span>
    </div>
  );
}
