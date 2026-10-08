/**
 * The Setup module's surface — a pure function of `SetupModel`, in two moods.
 *
 * **Onboarding** is a short letter in one column: what Athena is, in three sentences, then the
 * two things the first turn needs — an engine that answered, a page to work beside — and one
 * button. The microphone is one optional line under them. Nothing is numbered, because these are
 * not a sequence: a person who cannot install an engine can still open a page.
 *
 * **Settings** is the same facts for a returning person, in two layers (ADR 0029): an overview of
 * large emblem tiles that reads, each opening a layer where its fact is changed, tested and — for
 * the theme — previewed.
 *
 * Neither mood claims anything the machine has not said. Readiness is derived at render; a
 * restart is offered only when a running daemon disagrees with the stored row; a probe's words
 * are printed as the probe's words.
 */
import { useState } from "react";
import type { ReactNode } from "react";

import Badge from "@/components/Badge";
import Button from "@/components/Button";
import Emblem from "@/components/Emblem";
import Layer, { LayerColumns } from "@/components/Layer";
import PageHeader from "@/components/PageHeader";
import PageSection from "@/components/PageSection";
import PageShell from "@/components/PageShell";
import PillGroup from "@/components/PillGroup";
import ProblemNote from "@/components/ProblemNote";
import StatusDot from "@/components/StatusDot";
import Tile from "@/components/Tile";
import { TextInput } from "@/components/FormField";
import { engineLabel, probeOf, remedyFor, usable } from "@/lib/engines";
import { normaliseUrl } from "@/lib/url";
import { THEME_CHOICES, type ThemeChoice } from "@/stores/settings";

import { GLYPHS, HeroIllustration, type GlyphName } from "./glyphs";
import type { SetupModel } from "./model";
import {
  STANDING_TONE,
  WHAT_ATHENA_IS,
  type Fact,
  type Standing,
  brainFact,
  engineFact,
  engineLead,
  isReady,
  micFact,
  notReadyBecause,
  pageFact,
  restartNotice,
  voiceFact,
} from "./readiness";

import "./setup.css";

const THEME_HINTS: Record<ThemeChoice, string> = {
  system: "Follow the operating system, and switch when it does.",
  light: "Always light.",
  dark: "Always dark.",
};

export default function SetupView({
  model,
  initialOpen = null,
}: {
  model: SetupModel;
  /** Preview only: open this fact's layer on first render. */
  initialOpen?: Topic | null;
}) {
  return model.mode === "onboarding" ? (
    <Onboarding model={model} />
  ) : (
    <Settings model={model} initialOpen={initialOpen} />
  );
}

// -- onboarding: the letter --------------------------------------------------------------------

function Onboarding({ model }: { model: SetupModel }) {
  const ready = isReady(model);
  const because = notReadyBecause(model);
  return (
    <PageShell>
      <div className="setup-letter">
        <header className="setup-letter__head">
          <HeroIllustration />
          <h1 className="typo-heading-lg">Athena is on this machine.</h1>
          <p className="typo-body">
            She works inside the apps you already have open, and asks before anything that cannot
            be undone.
          </p>
        </header>

        <ul className="setup-claims">
          {WHAT_ATHENA_IS.map((claim) => (
            <li key={claim.title} className="typo-body">
              <span className="typo-title">{claim.title}.</span> {claim.body}
            </li>
          ))}
        </ul>

        <Passage glyph="engine" title="Choose the engine" fact={engineFact(model)}>
          <EngineChoice model={model} />
          <EngineDetail model={model} />
          <EngineCheck model={model} />
        </Passage>

        <Passage glyph="page" title="Open the first app" fact={pageFact(model)}>
          <OpenPage model={model} />
        </Passage>

        <Passage
          glyph="microphone"
          title="A microphone, if you want to talk"
          fact={micFact(model)}
          optional
        >
          <MicControl model={model} />
        </Passage>

        <div className="setup-letter__foot">
          <Button
            variant={ready ? "primary" : "secondary"}
            onClick={model.actions.finish}
            disabledReason={ready ? undefined : because}
          >
            Start using Athena
          </Button>
          <span className="typo-caption">
            {ready
              ? "Athena opens on the page you left open."
              : "Setup stays in the bar; nothing has to be finished in one sitting."}
          </span>
          {!ready ? (
            <Button variant="ghost" size="sm" onClick={model.actions.finish}>
              Skip for now
            </Button>
          ) : null}
        </div>
      </div>
    </PageShell>
  );
}

/**
 * One thing the machine needs, with its glyph at the left and its standing beside the title.
 * Not a step: a passage. The glyph takes the primary hue only when the fact stands done, so the
 * letter's colour is the machine's standing and nothing else.
 */
function Passage({
  glyph,
  title,
  fact,
  optional = false,
  children,
}: {
  glyph: GlyphName;
  title: string;
  fact: Fact;
  optional?: boolean;
  children: ReactNode;
}) {
  const Drawing = GLYPHS[glyph];
  return (
    <section className="setup-passage" data-standing={fact.standing}>
      <span className="setup-passage__glyph">
        <Drawing size={48} />
      </span>
      <div className="setup-passage__body">
        <div className="setup-passage__head">
          <h2 className="typo-heading">{title}</h2>
          <span className="typo-caption">
            {optional ? "optional — " : ""}
            {fact.summary}
          </span>
        </div>
        {children}
      </div>
    </section>
  );
}

// -- settings: the list ----------------------------------------------------------------------

type Topic = "engine" | "page" | "theme" | "brain" | "microphone" | "voice" | "data";

const STANDING_WORD: Record<Standing, string> = {
  done: "set",
  todo: "not yet",
  missing: "needs you",
  unknown: "checking",
};

/**
 * The returning person's Setup (ADR 0029): an overview of large emblem tiles, one per fact, that
 * reads — and a layer for each, where the fact is changed, tested and previewed. The restart
 * notice stays on the overview because it is the one thing here that asks to be done now.
 */
function Settings({ model, initialOpen = null }: { model: SetupModel; initialOpen?: Topic | null }) {
  const [open, setOpen] = useState<Topic | null>(initialOpen);
  const notice = restartNotice(model);
  const engine = engineFact(model);
  const page = pageFact(model);
  const brain = brainFact(model);
  const mic = micFact(model);
  const voice = voiceFact(model);
  const tiles: { topic: Topic; label: string; standing: Standing | null; line: string }[] = [
    { topic: "engine", label: "Engine", standing: engine.standing, line: engineSentence(model) },
    { topic: "page", label: "Page", standing: page.standing, line: pageSentence(model) },
    { topic: "theme", label: "Theme", standing: null, line: THEME_HINTS[model.theme] },
    {
      topic: "brain",
      label: "Brain",
      standing: brain.standing,
      line: model.brainPath
        ? "Episodes, facts and playbooks are written here."
        : "Episodes go to Athena's own folder.",
    },
    { topic: "microphone", label: "Microphone", standing: mic.standing, line: micSentence(model) },
    { topic: "voice", label: "Voice", standing: voice.standing, line: voiceSentence(model) },
    { topic: "data", label: "Data", standing: null, line: "One SQLite file holds this machine's Athena." },
  ];
  const current = tiles.find((t) => t.topic === open) ?? null;
  return (
    <PageShell>
      <PageHeader
        eyebrow="Setup"
        title="How Athena is set up"
        caption="The engine, the page, the brain, the voice — and where it all lives."
        action={
          <Button variant="ghost" size="sm" onClick={model.actions.reopenOnboarding}>
            Show the welcome again
          </Button>
        }
      />

      {model.problem ? (
        <ProblemNote
          title="Athena could not check which engines are installed."
          reason={model.problem}
          detail="The names below are all this page can say until a check goes through. Press Check again."
        />
      ) : null}

      {notice ? (
        <div className="setup-notice setup-notice--banner" role="status">
          <div className="stack" style={{ gap: 2 }}>
            <p className="typo-body">{notice.title}</p>
            <p className="typo-caption">{notice.detail}</p>
          </div>
          <Button variant="primary" size="sm" onClick={model.actions.restart}>
            {notice.actionLabel}
          </Button>
        </div>
      ) : null}

      <div className="setup-tiles">
        {tiles.map((t) => {
          const Drawing = GLYPHS[t.topic];
          return (
            <Tile
              key={t.topic}
              emblem={
                <Emblem
                  art={<Drawing size={24} />}
                  done={t.standing ? t.standing === "done" : t.topic !== "data" || Boolean(model.storePath)}
                  size={64}
                />
              }
              title={t.label}
              pill={
                t.standing ? (
                  <Badge tone={STANDING_TONE[t.standing]}>{STANDING_WORD[t.standing]}</Badge>
                ) : undefined
              }
              line={t.line}
              onOpen={() => setOpen(t.topic)}
            />
          );
        })}
      </div>

      {current ? (
        <Layer
          eyebrow="Setup"
          title={current.label}
          size={current.topic === "engine" || current.topic === "theme" ? "lg" : "md"}
          onClose={() => setOpen(null)}
          actions={
            current.standing ? (
              <Badge tone={STANDING_TONE[current.standing]}>{STANDING_WORD[current.standing]}</Badge>
            ) : undefined
          }
        >
          <SettingsLayer topic={current.topic} line={current.line} model={model} />
        </Layer>
      ) : null}
    </PageShell>
  );
}

function SettingsLayer({ topic, line, model }: { topic: Topic; line: string; model: SetupModel }) {
  const lead = <p className="typo-body setup-layer__lead">{line}</p>;
  switch (topic) {
    case "engine":
      return (
        <LayerColumns
          left={
            <>
              {lead}
              <PageSection title="Which engine runs her turns">
                <EngineChoice model={model} />
              </PageSection>
            </>
          }
          right={
            <PageSection title="What this machine has" note="The probe's own words.">
              <EngineDetail model={model} />
              <EngineCheck model={model} />
            </PageSection>
          }
        />
      );
    case "page":
      return (
        <>
          {lead}
          <OpenPage model={model} />
        </>
      );
    case "theme":
      return (
        <LayerColumns
          left={
            <>
              {lead}
              <PageSection title="Theme">
                <PillGroup
                  ariaLabel="Theme"
                  value={model.theme}
                  onChange={model.actions.setTheme}
                  options={THEME_CHOICES.map((choice) => ({
                    value: choice,
                    label: choice,
                    hint: THEME_HINTS[choice],
                  }))}
                />
              </PageSection>
            </>
          }
          right={
            <PageSection title="What each one looks like">
              <div className="theme-previews">
                <ThemePreview theme="light" chosen={model.theme === "light"} />
                <ThemePreview theme="dark" chosen={model.theme === "dark"} />
              </div>
              <p className="typo-caption">
                System follows the operating system and switches when it does.
              </p>
            </PageSection>
          }
        />
      );
    case "brain":
      return (
        <>
          {lead}
          <BrainField model={model} />
          <p className="typo-caption">
            Memory is markdown on disk; copy the folder and her memory goes with it.
          </p>
        </>
      );
    case "microphone":
      return (
        <>
          {lead}
          <MicControl model={model} />
        </>
      );
    case "voice":
      return (
        <>
          {lead}
          <p className="typo-body">{voiceFact(model).summary}</p>
          <p className="typo-caption">The Voice module sets up how she hears and speaks.</p>
        </>
      );
    case "data":
      return (
        <>
          <p className="typo-body setup-layer__lead">
            One SQLite file: settings, origins, projects, activity and captures. Copy it to move
            this machine&apos;s Athena.
          </p>
          <code className="typo-code setup-path">
            {model.storePath ?? "the shell has not answered store_path yet"}
          </code>
        </>
      );
  }
}

/** A miniature of the app in one theme: the tokens re-scoped by `data-theme` on its own root. */
function ThemePreview({ theme, chosen }: { theme: "light" | "dark"; chosen: boolean }) {
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

// -- the sentences -------------------------------------------------------------------------------

function engineSentence(model: SetupModel): string {
  if (model.probes === null) {
    if (model.checking) return "Checking which engines are installed...";
    return model.problem
      ? "Athena could not check which engines are installed."
      : `${engineLabel(model.engine)} is chosen; Athena has not heard back about it yet.`;
  }
  const chosen = probeOf(model.probes, model.engine);
  if (chosen?.state === "found") {
    return `${engineLabel(model.engine)} runs the turns${
      model.daemonHealth === "ready" && model.daemonEngine === model.engine ? ", and is running now" : ""
    }.`;
  }
  return `${engineLabel(model.engine)} is chosen and cannot run a turn yet.`;
}

function pageSentence(model: SetupModel): string {
  if (model.tabs.length === 0) return "No page is open. Athena works inside one.";
  if (model.tabs.length === 1) return `One page is open, on ${model.tabs[0].host}.`;
  return `${model.tabs.length} pages are open.`;
}

function micSentence(model: SetupModel): string {
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

function voiceSentence(model: SetupModel): string {
  if (model.voiceAvailable) return "Athena can hear you and speak back.";
  if (model.daemonHealth !== "ready") return "Athena is still starting, so nothing is known yet.";
  return "Voice is not installed with this copy of Athena.";
}

// -- the controls ----------------------------------------------------------------------------------

function EngineChoice({ model }: { model: SetupModel }) {
  return (
    <PillGroup
      ariaLabel="Engine"
      value={model.engine}
      onChange={model.actions.chooseEngine}
      disabled={!model.hydrated}
      options={model.engines.map((e) => ({
        value: e.id,
        label: e.label,
        hint: e.probe?.state === "found" ? e.probe.detail : undefined,
        // A signed-out engine is still choosable: the row is a preference, and the remedy belongs
        // beside it rather than in place of it.
        ...(e.probe?.state === "not_found" ? { disabledReason: e.disabledReason } : {}),
      }))}
    />
  );
}

/** Ask again without restarting anything: the one button that answers "I installed it". */
function EngineCheck({ model }: { model: SetupModel }) {
  return (
    <span className="row">
      <Button
        size="sm"
        variant="secondary"
        disabledReason={model.checking ? "Already checking." : undefined}
        onClick={model.actions.checkEngines}
      >
        {model.checking ? "Checking..." : "Check again"}
      </Button>
    </span>
  );
}

/** What the engine check found, and the one thing to do about it. and the one thing to do about it. */
function EngineDetail({ model, compact = false }: { model: SetupModel; compact?: boolean }) {
  const { probes } = model;
  if (probes === null) {
    return compact ? null : (
      <p className="typo-caption">
        {model.checking
          ? "Checking which engines are installed..."
          : model.problem
            ? `Athena could not check which engines are installed: ${model.problem}`
            : "Athena has not heard back about the engines yet."}
      </p>
    );
  }
  const chosen = probeOf(probes, model.engine);
  const shown = compact ? probes.filter((p) => p.state !== "found" || p.id === model.engine) : probes;
  return (
    <div className="stack" style={{ gap: 4 }}>
      {compact ? null : <p className="typo-caption">{engineLead(usable(probes).length, probes.length)}</p>}
      {shown.map((probe) => (
        <div key={probe.id} className="setup-probe">
          <span className="row row--baseline">
            <StatusDot
              tone={
                probe.state === "found"
                  ? "success"
                  : probe.state === "not_logged_in"
                    ? "warning"
                    : "neutral"
              }
            />
            <span className="typo-data">{engineLabel(probe.id)}</span>
            {/* The version is worth showing for an engine that works; for one that does not, the
                remedy below is the answer and the raw reason is only a hover. */}
            {probe.state === "found" ? (
              <span className="typo-caption" style={{ overflowWrap: "anywhere" }}>
                {probe.detail}
              </span>
            ) : (
              <span className="typo-caption" title={probe.detail}>
                {probe.state === "not_logged_in" ? "not signed in" : "not installed"}
              </span>
            )}
          </span>
          {probe.state !== "found" ? <span className="typo-caption">{remedyFor(probe)}</span> : null}
        </div>
      ))}
      {chosen && chosen.state !== "found" && !compact ? (
        <p className="typo-caption">{engineLabel(chosen.id)} is chosen and cannot run a turn yet.</p>
      ) : null}
    </div>
  );
}

function OpenPage({ model, compact = false }: { model: SetupModel; compact?: boolean }) {
  const [typed, setTyped] = useState("");
  const open = (raw: string) => {
    const url = normaliseUrl(raw);
    if (!url) return;
    model.actions.openPage(url);
    setTyped("");
  };
  return (
    <div className="stack" style={{ gap: 6 }}>
      <span className="row">
        <TextInput
          value={typed}
          placeholder={compact ? "Open another" : "invoicing.example.test"}
          aria-label="Address of an app to open"
          style={{ flex: "1 1 14rem" }}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") open(typed);
          }}
        />
        <Button
          variant={compact ? "secondary" : "primary"}
          size="sm"
          disabledReason={typed.trim() ? undefined : "Type an address first."}
          onClick={() => open(typed)}
        >
          Open
        </Button>
      </span>
      {model.tabs.length ? (
        <ul className="setup-tabs">
          {model.tabs.map((tab) => (
            <li key={tab.id} className="row row--baseline">
              <StatusDot tone="success" />
              <span className="typo-body truncate" style={{ maxWidth: "22rem" }}>
                {tab.title}
              </span>
              <span className="typo-caption">{tab.host}</span>
            </li>
          ))}
        </ul>
      ) : compact ? null : (
        <p className="typo-caption">
          Any site. A page that offers no tools of its own can be read by Athena but not acted on yet.
        </p>
      )}
    </div>
  );
}

function MicControl({ model, compact = false }: { model: SetupModel; compact?: boolean }) {
  return (
    <span className="row">
      <Button
        size="sm"
        variant={model.mic === "granted" ? "secondary" : compact ? "secondary" : "primary"}
        onClick={model.actions.checkMic}
      >
        {model.mic === "unknown" ? "Check the microphone" : "Check again"}
      </Button>
      {model.micDetail ? (
        <span className="typo-caption" style={{ overflowWrap: "anywhere" }}>
          {model.micDetail}
        </span>
      ) : null}
    </span>
  );
}

/**
 * A path, committed on Enter or the button. The field is a draft until it is committed, so a
 * half-typed directory is never written: the store is read by the daemon at start-up, and a path
 * that exists for three keystrokes is a path Athena would have tried to use.
 */
function BrainField({ model }: { model: SetupModel }) {
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? model.brainPath;
  const dirty = draft !== null && draft !== model.brainPath;
  return (
    <span className="row">
      <TextInput
        value={value}
        placeholder="Athena's own folder"
        aria-label="Brain directory"
        style={{ flex: "1 1 16rem" }}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") model.actions.setBrainPath(value.trim());
          if (e.key === "Escape") setDraft(null);
        }}
      />
      <Button
        size="sm"
        variant={dirty ? "primary" : "secondary"}
        disabledReason={dirty ? undefined : "Nothing has been typed that is not stored."}
        onClick={() => model.actions.setBrainPath(value.trim())}
      >
        Use this
      </Button>
    </span>
  );
}
