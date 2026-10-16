/**
 * What the Mind depth says and shows of the Setup module's facts — README section 3.5, ADR 0029
 * and 0087.
 *
 * The one-line sentences about the engine, the page, the microphone and the voice, the hints for the
 * theme and the text size, and the miniature of the app in a theme. They were the old Setup view's
 * own; the words are the copy the app settled on, except where they said more than the facts (an
 * engine "runs the turns" before the daemon is on it, a voice "not installed" whatever the reason
 * was), and there they are the readiness module's and the voice store's own; the miniature
 * re-scopes the tokens with `data-theme` on its own root. Pure functions of the Setup view-model.
 */
import { engineLabel, probeOf } from "@/lib/engines";
import type { SetupModel } from "@/modules/setup/model";
import { engineFact } from "@/modules/setup/readiness";
import type { ThemeChoice, TypeScale } from "@/stores/settings";

export const THEME_HINTS: Record<ThemeChoice, string> = {
  system: "Follow the operating system, and switch when it does.",
  light: "Always light.",
  dark: "Always dark.",
};

export const TYPE_SCALE_HINTS: Record<TypeScale, string> = {
  comfortable: "Every size under the headings, two pixels larger.",
  compact: "The original sizes, for more on one screen.",
};

/** A miniature of the app in one theme: the tokens re-scoped by `data-theme` on its own root. */
export function ThemePreview({ theme, chosen }: { theme: "light" | "dark"; chosen: boolean }) {
  return (
    <figure className="theme-preview" data-theme={theme} data-chosen={chosen ? "1" : undefined}>
      <div className="theme-preview__bar">
        <span className="theme-preview__mark" />
        <span className="theme-preview__tab theme-preview__tab--on" />
        <span className="theme-preview__tab" />
        <span className="theme-preview__tab" />
      </div>
      <div className="theme-preview__body">
        <span className="theme-preview__title" />
        <span className="theme-preview__line" />
        <div className="theme-preview__cards">
          <span className="theme-preview__card theme-preview__card--done" />
          <span className="theme-preview__card" />
          <span className="theme-preview__card" />
        </div>
      </div>
      <figcaption className="typo-label">{chosen ? `${theme}, chosen` : theme}</figcaption>
    </figure>
  );
}

// -- the sentences ---------------------------------------------------------------------------

export function engineSentence(model: SetupModel): string {
  if (model.probes === null) {
    if (model.startFailure) return model.startFailure.title;
    if (model.checking) return "Checking which engines are installed...";
    return model.problem
      ? "Athena could not check which engines are installed."
      : `${engineLabel(model.engine)} is chosen; Athena has not heard back about it yet.`;
  }
  const chosen = probeOf(model.probes, model.engine);
  if (chosen?.state === "found") {
    // Found is the probe's word; a turn goes to the engine the daemon is on. Until the daemon runs
    // on the chosen one, the sentence is the readiness module's, so the line and the badge agree.
    if (model.daemonHealth === "ready" && model.daemonEngine === model.engine) {
      return `${engineLabel(model.engine)} runs the turns, and is running now.`;
    }
    return `${engineFact(model).summary}.`;
  }
  return `${engineLabel(model.engine)} is chosen and cannot run a turn yet.`;
}

export function pageSentence(model: SetupModel): string {
  if (model.tabs.length === 0) return "No page is open. Athena works inside one.";
  if (model.tabs.length === 1) return `One page is open, on ${model.tabs[0].host}.`;
  return `${model.tabs.length} pages are open.`;
}

export function micSentence(model: SetupModel): string {
  switch (model.mic) {
    case "granted":
      return "The microphone answered. Hold Ctrl+Space in her window to talk.";
    case "denied":
      return "The webview refused the microphone; push-to-talk stays off until it is allowed.";
    case "unsupported":
      return "No microphone was found; every turn can still be typed.";
    default:
      return "Not asked yet. Asking here keeps the prompt out of a turn.";
  }
}

export function voiceSentence(model: SetupModel): string {
  if (model.voiceAvailable) return "Athena can hear you and speak back.";
  if (model.daemonHealth === "starting") return "Athena is still starting, so nothing is known yet.";
  if (model.daemonHealth === "failed") return "Athena could not start, so nothing is known yet.";
  if (model.daemonHealth === "stopped") return "Athena is not running, so nothing is known yet.";
  // The voice store's own reason says which rung failed (switched off, a model missing, a config
  // that could not be read), and the Voice depth one press away is where each is fixed.
  const reason = model.voiceReason.trim().replace(/\.$/, "");
  if (reason === "") return "Voice is not set up yet.";
  return `${reason.charAt(0).toUpperCase()}${reason.slice(1)}.`;
}
