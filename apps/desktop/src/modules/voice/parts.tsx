/**
 * ADR 0028 (Athena's voice is set up in a studio), README section 3.1 — the pieces both moods share.
 *
 * The studio and the settings page say the same facts in two layouts, so the controls that carry a
 * fact — an install's progress, her voice as a tile you can play, the hold-to-talk button — are
 * written once here and placed by each. All of them are pure functions of what they are handed.
 */
import Button from "@/components/Button";
import StatusDot, { type Tone } from "@/components/StatusDot";
import type { VoiceEngine, VoiceOption } from "@/lib/voice-setup";

import { MANUAL_LINKS, voiceMeta, type InstallView, type PreviewState, type VoiceMeters } from "./model";
import { MicMeter, Waveform } from "./waveform";

export function Kbd({ children }: { children: string }) {
  return <kbd className="vs-kbd">{children}</kbd>;
}

export const ENGINE_TONE: Record<VoiceEngine["state"], Tone> = {
  ready: "success",
  absent: "neutral",
  broken: "error",
};

export const ENGINE_WORD: Record<VoiceEngine["state"], string> = {
  ready: "Installed",
  absent: "Needs install",
  broken: "Broken",
};

/** An engine's standing: the dot, the word, and the daemon's reason when it gave one. */
export function EngineState({ engine }: { engine: VoiceEngine }) {
  return (
    <span className="row row--baseline">
      <StatusDot tone={ENGINE_TONE[engine.state]} />
      <span className="typo-data">{ENGINE_WORD[engine.state]}</span>
      {engine.reason ? (
        <span className="typo-caption" style={{ overflowWrap: "anywhere" }}>
          {engine.reason}
        </span>
      ) : null}
    </span>
  );
}

/**
 * An install, wherever it is shown: the phase in words with a percentage (or the megabytes so far
 * and a pulsing bar when the total is unknown), the failure with Try again, the manual case with
 * the links and Check again.
 */
export function InstallBlock({
  view,
  home,
  sizeMb,
  onInstall,
  onCheck,
  refusal,
  label = "Install now",
}: {
  view: InstallView;
  home: string | null;
  sizeMb: number | null;
  onInstall: () => void;
  onCheck: () => void;
  /** A refused install request (409: another one runs), in the daemon's words. */
  refusal: string | null;
  label?: string;
}) {
  if (view.busy) {
    return (
      <div className="stack" role="status" aria-live="polite">
        <span className="row row--baseline">
          <span className="typo-body">{view.label}</span>
          <span className="typo-data vs-push">{view.figure}</span>
        </span>
        <span className="vs-progress" data-indeterminate={view.percent === null ? "true" : "false"}>
          <span style={{ width: `${view.percent ?? 30}%` }} />
        </span>
      </div>
    );
  }
  if (view.phase === "completed" || view.phase === "not_needed") {
    return (
      <span className="row row--baseline">
        <StatusDot tone="success" />
        <span className="typo-body">{view.label}</span>
      </span>
    );
  }
  if (view.phase === "manual") {
    return (
      <div className="stack">
        {view.error ? <p className="typo-caption">{view.error}</p> : null}
        <ul className="vs-links">
          {MANUAL_LINKS.map((link) => (
            <li key={link.href}>
              <a className="typo-body" href={link.href} target="_blank" rel="noreferrer">
                {link.label}
              </a>
            </li>
          ))}
        </ul>
        {home ? (
          <p className="typo-caption">
            Unpack both under <code className="typo-code vs-home">{home}</code>, then check again.
          </p>
        ) : null}
        <span className="row">
          <Button size="sm" variant="secondary" onClick={onCheck}>
            Check again
          </Button>
        </span>
      </div>
    );
  }
  return (
    <div className="stack">
      {view.phase === "failed" ? (
        <p className="typo-caption vs-error" role="alert">
          {view.error}
        </p>
      ) : null}
      <span className="row">
        <Button size="sm" variant="primary" onClick={onInstall}>
          {view.phase === "failed" ? "Try again" : label}
        </Button>
        {sizeMb ? <span className="typo-caption">about {sizeMb} MB, once</span> : null}
      </span>
      {refusal ? <p className="typo-caption vs-error">{refusal}</p> : null}
    </div>
  );
}

/** Her voice as a take: the name, what it is, Play/Stop and the live waveform. */
export function VoiceTile({
  voice,
  preview,
  picked,
  disabledReason,
  meters,
  onToggle,
  kbd = true,
}: {
  voice: VoiceOption;
  preview: PreviewState;
  picked: boolean;
  disabledReason?: string;
  meters: VoiceMeters;
  onToggle: () => void;
  /** Show the Space chip: the studio's keyboard plays it. */
  kbd?: boolean;
}) {
  const mine = preview.voice === voice.id;
  const playing = mine && preview.phase === "playing";
  const synth = mine && preview.phase === "synth";
  return (
    <div className="vs-take" data-playing={playing ? "true" : "false"} data-picked={picked ? "true" : "false"}>
      <div className="vs-take__head">
        <span className="typo-heading">{voice.name}</span>
        {picked ? <span className="typo-label vs-tag">Her voice</span> : null}
        <span className="typo-caption vs-push">{voiceMeta(voice)}</span>
      </div>
      {voice.blurb ? <p className="typo-caption">{voice.blurb}</p> : null}
      <div className="row">
        <Button
          size="sm"
          variant={playing ? "primary" : "secondary"}
          disabledReason={disabledReason}
          aria-pressed={playing}
          onClick={onToggle}
        >
          {playing ? "Stop" : synth ? "Getting ready..." : "Play"}
        </Button>
        {kbd ? <Kbd>Space</Kbd> : null}
        <Waveform active={playing} read={meters.spectrum} />
      </div>
      {mine && preview.phase === "error" && preview.error ? (
        <p className="typo-caption vs-error" role="alert">
          {preview.error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Hold to talk: pointer down starts the take, up (or leaving, or a cancel) ends it. `keys` lets the
 * button take Space and Enter itself — the settings page; the studio's root owns Space instead.
 */
export function HoldToTalk({
  recording,
  disabledReason,
  meters,
  onStart,
  onStop,
  keys = false,
}: {
  recording: boolean;
  disabledReason?: string;
  meters: VoiceMeters;
  onStart: () => void;
  onStop: () => void;
  keys?: boolean;
}) {
  return (
    <div className="vs-hold">
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
        onKeyDown={(e) => {
          if (!keys || e.repeat) return;
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            onStart();
          }
        }}
        onKeyUp={(e) => {
          if (!keys) return;
          if (e.key === " " || e.key === "Enter") onStop();
        }}
      >
        <span className="vs-hold__dot" aria-hidden="true" />
        {recording ? "Listening — let go to send" : "Hold to talk"}
      </Button>
      <MicMeter active={recording} read={meters.mic} />
      {disabledReason ? <span className="typo-caption">{disabledReason}</span> : null}
    </div>
  );
}
