/**
 * ADR 0028 (Athena's voice is set up in a studio), README section 3.1 — the pieces both moods share.
 *
 * The studio and the settings page say the same facts in two layouts, so the controls that carry a
 * fact — an install's progress, the hold-to-talk button — are
 * written once here and placed by each. All of them are pure functions of what they are handed.
 */
import Button from "@/components/Button";
import StatusDot, { type Tone } from "@/components/StatusDot";
import type { VoiceEngine } from "@/lib/voice-setup";

import { MANUAL_LINKS, type InstallView, type VoiceMeters } from "./model";
import { MicMeter } from "./waveform";

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
  /**
   * A refused install request (409: another one runs), or a refused poll of a running one, in the
   * daemon's words.
   */
  refusal: string | null;
  label?: string;
}) {
  if (view.busy && refusal) {
    // The poll was refused, so the last figure is stale: a still bar would claim progress nobody
    // has seen. Say so, and let Check again ask where the install stands.
    return (
      <div className="stack">
        <p className="typo-caption vs-error" role="alert">
          Lost track of the install: {refusal}
        </p>
        <span className="row">
          <Button size="sm" variant="secondary" onClick={onCheck}>
            Check again
          </Button>
        </span>
      </div>
    );
  }
  if (view.busy) {
    return (
      <div className="stack">
        {/* Only the phase is live: the figure moves on every 250 ms poll and would be read out each
         * time. The bar carries the value for whoever asks. */}
        <span className="row row--baseline">
          <span className="typo-body" role="status" aria-live="polite">
            {view.label}
          </span>
          <span className="typo-data vs-push">{view.figure}</span>
        </span>
        <span
          className="vs-progress"
          data-indeterminate={view.percent === null ? "true" : "false"}
          role="progressbar"
          aria-label={view.label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={view.percent ?? undefined}
        >
          <span
            style={view.percent === null ? undefined : { transform: `scaleX(${Math.min(1, Math.max(0, view.percent / 100))})` }}
          />
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
