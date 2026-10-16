/**
 * The Voice scene's shared pieces — README section 3.1, ADR 0028 and 0087.
 *
 * What both places draw: the gate (every state that is not "the config answered with engines"),
 * the hold-to-talk button without its own meter (the scene has one frame loop at a time, so the
 * studio's hero waveform is the microphone's meter), the hero waveform read from the microphone's
 * level, and the key chip. All are pure functions of what they are handed; the one hook is the rule
 * both places keep about a take (it ends with the window's focus and with the place).
 */
import { useEffect, useMemo, useRef, type ReactNode } from "react";

import Button from "@/components/Button";
import EmptyState from "@/components/EmptyState";
import ProblemNote from "@/components/ProblemNote";
import type { VoiceMeters, VoiceModel } from "@/modules/voice/model";
import { Kbd } from "@/modules/voice/parts";
import { Waveform } from "@/modules/voice/waveform";

/** The chord that talks to her from anywhere (hotkeys.rs). Said in the same words everywhere. */
export const HOTKEY = "Ctrl+Shift+Space";

export type GateKind = "offline" | "starting" | "problem" | "loading" | "empty";

/** Which gate stands in front of the voice setup, or `null` when the config answered with engines. */
export function gateKind(model: VoiceModel): GateKind | null {
  if (model.daemon === "offline") return "offline";
  if (model.daemon === "starting") return "starting";
  if (model.problem && model.config === null) return "problem";
  if (model.loading || model.config === null) return "loading";
  if (model.empty) return "empty";
  return null;
}

/** The plain sentence for a gate, verbatim from the module's view: the owner's words stay. */
export function Gate({ kind, model }: { kind: GateKind; model: VoiceModel }): ReactNode {
  switch (kind) {
    case "offline":
      return (
        <ProblemNote
          title="Athena's daemon is not running, so her voice cannot be set up yet."
          reason={model.problem ?? "daemon_offline"}
          detail="Voice is chosen, installed and tested through the daemon. This page fills in when it answers."
        />
      );
    case "starting":
      return <p className="typo-body vsc-wait">Athena is starting. Her voice setup appears when the daemon answers.</p>;
    case "problem":
      return (
        <ProblemNote
          title="Athena could not read her voice setup."
          reason={model.problem ?? "unknown"}
          onRetry={model.actions.refresh}
        />
      );
    case "loading":
      return <p className="typo-body vsc-wait">Reading her voice setup...</p>;
    case "empty":
      return (
        <EmptyState
          glyph="~"
          title="No voice engines were offered"
          line="The daemon answered with none. A daemon built with voice lists Kokoro, Whisper and OpenAI here."
          action={
            <span>
              <Button size="sm" variant="secondary" onClick={model.actions.refresh}>
                Check again
              </Button>
            </span>
          }
        />
      );
  }
}

/**
 * A take must not outlive the window's focus or the place it was started in: a key let go in
 * another window never comes back as a keyup, and a place left by Escape or the dock takes its
 * button with it, so either would leave the microphone open. Both places that record use this.
 */
export function useTakeEndsWithPlace(model: VoiceModel): void {
  const latest = useRef(model);
  useEffect(() => {
    latest.current = model;
  });
  useEffect(() => {
    const lost = () => {
      if (latest.current.hear.recording) latest.current.actions.recordStop();
    };
    window.addEventListener("blur", lost);
    return () => {
      window.removeEventListener("blur", lost);
      lost();
    };
  }, []);
}

/** A key and what it does, as a button: the dock shows the keys for this moment and no others. */
export function Chip({
  k,
  label,
  onPress,
  primary = false,
  disabledReason,
}: {
  k: string;
  label: string;
  onPress: () => void;
  primary?: boolean;
  disabledReason?: string;
}) {
  return (
    <Button variant={primary ? "primary" : "secondary"} size="sm" disabledReason={disabledReason} onClick={onPress}>
      <Kbd>{k}</Kbd>
      {label}
    </Button>
  );
}

/**
 * Hold to talk: pointer down starts the take, up (or a cancel) ends it, and Space or Enter held on
 * the focused button does the same (the studio's document keys hold Space everywhere else). It has
 * no meter of its own.
 */
export function HoldButton({
  recording,
  disabledReason,
  onStart,
  onStop,
}: {
  recording: boolean;
  disabledReason?: string;
  onStart: () => void;
  onStop: () => void;
}) {
  return (
    <Button
      variant={recording ? "primary" : "secondary"}
      disabledReason={disabledReason}
      aria-pressed={recording}
      title="Hold to talk; let go to send"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture?.(e.pointerId);
        onStart();
      }}
      onPointerUp={() => {
        if (recording) onStop();
      }}
      onPointerCancel={() => {
        if (recording) onStop();
      }}
      // A focused button keeps its own Space and Enter (the studio's document keys give way to it),
      // and a mouse take leaves this one focused: held from the keyboard it holds, as the module's
      // HoldToTalk does, or the Space it shows does nothing.
      onKeyDown={(e) => {
        if (e.repeat || (e.key !== " " && e.key !== "Enter")) return;
        e.preventDefault();
        if (!recording) onStart();
      }}
      onKeyUp={(e) => {
        if (e.key !== " " && e.key !== "Enter") return;
        if (recording) onStop();
      }}
    >
      <span className="vs-hold__dot" aria-hidden="true" />
      {recording ? "Listening — let go to send" : "Hold to talk"}
      <Kbd>Space</Kbd>
    </Button>
  );
}

const BINS = 48;
/** A fixed spectral envelope: speech has most of its weight low, so the bars read like a voice. */
const ENVELOPE = Array.from({ length: BINS }, (_, i) => 0.35 + 0.65 * Math.exp(-i / 14));

/**
 * The bins a microphone's level is drawn as: the level times a fixed envelope. Not a spectrum, and
 * the scene says so beside it. Returns a reader that fills one reused buffer, so the waveform's
 * existing frame loop is the only thing that calls it.
 */
export function micBins(level: () => number): () => Uint8Array {
  const bins = new Uint8Array(BINS);
  return () => {
    const v = Math.max(0, Math.min(1, level()));
    for (let i = 0; i < BINS; i += 1) {
      bins[i] = Math.round(255 * Math.min(1, v * 1.5 * ENVELOPE[i]! * (0.82 + 0.18 * Math.sin(i * 1.7 + v * 9))));
    }
    return bins;
  };
}

/** The hero waveform. `source` says which meter feeds it, so the caption can be honest about it. */
export function Hero({
  source,
  active,
  meters,
  idle,
}: {
  source: "voice" | "mic";
  active: boolean;
  meters: VoiceMeters;
  /** What the quiet line means, said inside the box while nothing moves. */
  idle: string;
}) {
  const mic = useMemo(() => micBins(meters.mic), [meters.mic]);
  return (
    <div className="vsc-wave" data-source={source} data-active={active ? "true" : "false"}>
      <span className="vsc-wave__idle" aria-hidden="true">
        {idle}
      </span>
      <Waveform active={active} read={source === "voice" ? meters.spectrum : mic} bars={56} />
    </div>
  );
}
