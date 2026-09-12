/**
 * @catalog The hue of a state, beside the word that says the same thing.
 *
 * A graphic needs 3:1 rather than 4.5:1, which is the whole reason the hue lives here and not on
 * the label (house style §4). `pending` means "asked and not answered"; `neutral` means there is
 * no state at all, which is not the same as good news.
 */
export type Tone = "success" | "warning" | "error" | "info" | "pending" | "neutral";

export default function StatusDot({ tone = "neutral" }: { tone?: Tone }) {
  return <span className={`status-dot status-dot--${tone}`} aria-hidden="true" />;
}
