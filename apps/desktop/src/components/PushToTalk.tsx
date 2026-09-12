/**
 * @catalog Push-to-talk: the hold-to-talk control in the module bar.
 *
 * A control, not a store: it takes the phase, whether the key has anywhere to go, a reason when
 * it does not, and two callbacks. Down is `press`, up is `release`, and both the pointer and the
 * keyboard (Space or Enter, held) drive them, so the one gesture the demo depends on works with
 * either hand. A disabled key is never silent: its title says why (plan c32, README section 3.1).
 *
 * The label is the phase in one or two words, because the bar is 36 px and the control sits
 * beside the window buttons; the fuller sentence is the tooltip.
 */
import type { VoicePhase } from "@/stores/voice";

const LABEL: Record<VoicePhase, string> = {
  off: "Voice off",
  idle: "Hold to talk",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
  error: "Voice stopped",
};

const TITLE: Record<VoicePhase, string> = {
  off: "Voice is not available",
  idle: "Hold to talk to Athena (or hold Ctrl+Space)",
  listening: "Release to send",
  thinking: "Athena is working on it",
  speaking: "Athena is speaking — hold to interrupt",
  error: "The last utterance stopped",
};

export default function PushToTalk({
  phase,
  available,
  reason,
  partial,
  onPress,
  onRelease,
}: {
  phase: VoicePhase;
  available: boolean;
  reason: string;
  partial: string;
  onPress: () => void;
  onRelease: () => void;
}) {
  const disabled = !available;
  const title = disabled ? reason || TITLE.off : reason && phase === "error" ? reason : TITLE[phase];
  const held = phase === "listening";

  return (
    <button
      type="button"
      className="ptt typo-label focus-ring"
      data-phase={phase}
      aria-pressed={held}
      aria-disabled={disabled}
      title={title}
      aria-label={title}
      onPointerDown={(e) => {
        if (disabled) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        onPress();
      }}
      onPointerUp={() => {
        if (!disabled) onRelease();
      }}
      onPointerCancel={() => {
        if (!disabled) onRelease();
      }}
      onKeyDown={(e) => {
        if (disabled || e.repeat) return;
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          onPress();
        }
      }}
      onKeyUp={(e) => {
        if (disabled) return;
        if (e.key === " " || e.key === "Enter") onRelease();
      }}
    >
      <span className="ptt__dot" aria-hidden="true" />
      <span className="ptt__label">{partial && held ? partial : LABEL[phase]}</span>
    </button>
  );
}
