/**
 * @catalog A small labelled pill whose label is `--foreground` in every tone.
 *
 * The hue rides the `StatusDot` it composes rather than the text: a status colour on 12px type is
 * the pair that kept measuring under AA in the first build's light themes (house style §4b).
 */
import StatusDot, { type Tone } from "./StatusDot";

export default function Badge({
  tone,
  children,
  title,
}: {
  tone?: Tone;
  children: string;
  title?: string;
}) {
  return (
    <span className="badge typo-label" title={title}>
      {tone ? <StatusDot tone={tone} /> : null}
      {children}
    </span>
  );
}
