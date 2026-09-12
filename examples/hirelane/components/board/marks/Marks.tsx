/**
 * The domain marks. DESIGN-LAW §4.3: every domain concept gets a mark drawn for
 * this app, and `lucide-react` is for utility glyphs only. This direction uses
 * no library glyph at all — these two are the whole inventory.
 *
 * There was a third, `GateMark`: a two-stroke bracket that closed when the
 * irreversible control armed. It is gone. It rendered as `[ ]` in front of the
 * gated band's sentence, which reads as an unchecked checkbox — a control — in
 * front of the one region on the surface whose whole point is that it is NOT a
 * control until you arm it. The class band carries its state in words and in
 * the surface it is drawn on, which is what §7.1 actually asks for.
 *
 * Server- and client-safe: pure SVG, no state.
 */

/**
 * The gap — a ruled line broken in the middle.
 *
 * Drawn under the criterion an application carries no evidence for. A broken
 * rule rather than a warning triangle because the fact is an absence, not a
 * fault: nobody did anything wrong, the sentences simply are not there.
 */
export function GapMark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 48 4"
      preserveAspectRatio="none"
      aria-hidden
      focusable="false"
    >
      <path d="M0 2h17M31 2h17" stroke="currentColor" strokeWidth="2" fill="none" />
    </svg>
  );
}

/**
 * The stage ladder — five rungs, the reached ones inked.
 *
 * Sits beside a candidate so how far they have come is readable without
 * counting columns, and stays legible at the size a card tab allows.
 */
export function LadderMark({
  reached,
  total,
  className,
}: {
  reached: number;
  total: number;
  className?: string;
}) {
  const step = 14 / Math.max(1, total);
  return (
    <svg
      className={className}
      viewBox="0 0 8 14"
      width="8"
      height="14"
      aria-hidden
      focusable="false"
    >
      {Array.from({ length: total }, (_, i) => (
        <line
          key={i}
          x1="0.5"
          x2="7.5"
          y1={13 - i * step}
          y2={13 - i * step}
          stroke="currentColor"
          strokeWidth={i < reached ? 2 : 1}
          opacity={i < reached ? 1 : 0.32}
        />
      ))}
    </svg>
  );
}
