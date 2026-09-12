/**
 * The Browser module's surface — a pure function of `BrowserModel`.
 *
 * **Its first 40px are a contract.** The window has two shapes (`src-tauri/src/layout.rs`): when
 * this module is selected and a tab is open, the chrome webview is clipped to the module bar plus
 * `--strip-height` and a page webview fills everything under it, so the only part of this view
 * the user sees is the tab strip. With no tab open there is no page webview, the chrome webview
 * gets the whole window, and the ledger of apps is what fills it. The preview harness always
 * shows all of it.
 *
 * The ledger is the page. There is no illustration: the way in is one field at the size of a
 * title at the top of the ledger, because registering an app is the whole of what a person does
 * on this surface when nothing is open, and under it every origin Athena has been told about,
 * one row each, with where it stands right now. The rows are the quieter, longer-lived part.
 */
import { useState } from "react";

import Badge from "@/components/Badge";
import Button from "@/components/Button";
import PageHeader from "@/components/PageHeader";
import PageShell from "@/components/PageShell";
import SectionCard from "@/components/SectionCard";
import StatusDot, { type Tone } from "@/components/StatusDot";
import { normaliseUrl } from "@/lib/url";

import "./browser.css";
import {
  NEW_TAB_URL,
  type AppStanding,
  type BrowserModel,
  type BrowserTab,
  type BrowserTools,
  type RegisteredApp,
} from "./model";

export default function BrowserView({ model }: { model: BrowserModel }) {
  const { actions, apps, appsLoaded, appsProblem, focused, problem, tabs, tools } = model;

  const go = (typed: string) => {
    const url = normaliseUrl(typed);
    if (!url) return;
    if (focused) actions.navigate(focused.id, url);
    else actions.open(url);
  };

  return (
    <div className="module-browser">
      <div className="tab-strip" data-tauri-drag-region>
        <TabStrip tabs={tabs} onFocus={actions.focus} onClose={actions.close} />
        {/* Outside the rail on purpose: with twenty tabs open, the way to open a twenty-first
            must not itself be something you have to scroll to. */}
        <Button size="sm" variant="ghost" title="New tab" onClick={() => actions.open(NEW_TAB_URL)}>
          +
        </Button>
        <UrlField key={`${focused?.id ?? "none"}:${focused?.url ?? ""}`} url={focused?.url ?? ""} onGo={go} />
        {/* The strip is the only band of this view a page does not cover, so the one fact about
            the page that is worth a permanent 6rem lives here: does the relay see anything. */}
        <ToolCount tools={tools} />
      </div>

      <div className="module-browser__body">
        <PageShell fill>
          <PageHeader
            eyebrow="Browser"
            title="The apps Athena works in"
            caption="Open one, and she reads what it offers."
            meta={
              <>
                <Badge tone={problem ? "error" : tabs.length ? "success" : "neutral"}>
                  {problem ? "unread" : `${tabs.length} open`}
                </Badge>
                {focused ? <Badge tone="info">{focused.host}</Badge> : null}
              </>
            }
          />

          {problem ? (
            <SectionCard title="The tab list could not be read" posture="flat">
              {/* Verbatim, never paraphrased: a reason we cannot explain is still a reason. */}
              <p className="well">{problem}</p>
              <p className="typo-caption">The shell answers once the window has finished starting.</p>
            </SectionCard>
          ) : null}

          <Ledger
            apps={apps}
            loaded={appsLoaded}
            problem={appsProblem}
            focusedTab={focused?.id ?? null}
            onOpen={actions.openApp}
            onEnable={actions.setEnabled}
            onForget={actions.forget}
            onRegister={actions.register}
          />

          {focused ? (
            <div className="page-stand-in">
              <p className="typo-title">The page draws here</p>
              <p className="typo-caption">{focused.url}</p>
              {/* Tier 1, in the one place there is room to spell it out (README section 3.4). */}
              <p className="typo-caption">{describe(tools)}</p>
            </div>
          ) : null}
        </PageShell>
      </div>
    </div>
  );
}

// -- the ledger ----------------------------------------------------------------------------------

const STANDING_TONE: Record<AppStanding, Tone> = {
  closed: "neutral",
  reading: "pending",
  ready: "success",
  hands: "info",
  disabled: "warning",
};

const STANDING_WORD: Record<AppStanding, string> = {
  closed: "not opened",
  reading: "reading",
  ready: "ready",
  hands: "hands",
  disabled: "off",
};

/**
 * Every origin Athena has been told about, and where each stands now, with the way in at the
 * top. A row is a fact about the tabs and the relay at this render, never a stored word; the
 * standing beside the host is the same one the strip's pill shows when that page is on screen.
 */
function Ledger({
  apps,
  loaded,
  problem,
  focusedTab,
  onOpen,
  onEnable,
  onForget,
  onRegister,
}: {
  apps: readonly RegisteredApp[];
  loaded: boolean;
  problem: string | null;
  focusedTab: number | null;
  onOpen: (origin: string) => void;
  onEnable: (origin: string, enabled: boolean) => void;
  onForget: (origin: string) => void;
  onRegister: (url: string) => void;
}) {
  const none = loaded && !problem && apps.length === 0;
  return (
    <section className="ledger" aria-labelledby="ledger-title">
      <header className="ledger__head">
        <h2 id="ledger-title" className="typo-heading">
          Registered apps
        </h2>
        <Badge tone={problem ? "error" : loaded ? (apps.length ? "success" : "neutral") : "pending"}>
          {problem ? "could not be read" : loaded ? `${apps.length} registered` : "reading the table"}
        </Badge>
      </header>

      <div className="ledger__lead">
        <RegisterField lead={none} onRegister={onRegister} />
      </div>

      {problem ? (
        <div className="ledger__foot">
          {/* Verbatim, never paraphrased: a reason we cannot explain is still a reason. */}
          <p className="well">{problem}</p>
          <p className="typo-caption">
            The origins table did not answer. Apps still open; their standing is not shown.
          </p>
        </div>
      ) : (
        <ol className="ledger__rows">
          {apps.map((app) => (
            <AppRow
              key={app.origin}
              app={app}
              onScreen={app.tabId !== null && app.tabId === focusedTab}
              onOpen={onOpen}
              onEnable={onEnable}
              onForget={onForget}
            />
          ))}
        </ol>
      )}

      {none ? (
        <p className="ledger__foot typo-caption">
          No app is registered yet. Register one above, or open a page and switch it on.
        </p>
      ) : !loaded && !problem ? (
        <p className="ledger__foot typo-caption">The origins table has not answered yet.</p>
      ) : null}
    </section>
  );
}

/**
 * One app. The tile carries the host's first letter and lights in the primary hue when the page
 * has answered with tools; the acts stay quiet until the row is hovered or holds focus, and
 * "Forget" asks once more before it deletes, because a forgotten origin is a first sight again.
 */
function AppRow({
  app,
  onScreen,
  onOpen,
  onEnable,
  onForget,
}: {
  app: RegisteredApp;
  onScreen: boolean;
  onOpen: (origin: string) => void;
  onEnable: (origin: string, enabled: boolean) => void;
  onForget: (origin: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const classes = ["app-row", `app-row--${app.standing}`];
  if (onScreen) classes.push("app-row--focused");
  return (
    <li className={classes.join(" ")}>
      <div className="app-row__id">
        <span className="app-row__tile" aria-hidden="true">
          {app.monogram}
        </span>
        <span className="app-row__name">
          <button
            type="button"
            className="app-row__host focus-ring typo-title"
            title={app.tabId === null ? `Open ${app.host}` : `Show ${app.host}`}
            onClick={() => onOpen(app.origin)}
          >
            {app.host}
          </button>
          <span className="app-row__origin typo-caption" title={app.origin}>
            {app.origin}
          </span>
        </span>
      </div>

      <div className="app-row__standing">
        <span className="app-row__standing-word typo-data">
          <StatusDot tone={STANDING_TONE[app.standing]} />
          {STANDING_WORD[app.standing]}
        </span>
        {app.summary !== STANDING_WORD[app.standing] ? (
          <span className="typo-caption">{app.summary}</span>
        ) : null}
      </div>

      <div className="app-row__cell">
        <span className="typo-data">
          {app.tools ? `${app.tools.count} tool${app.tools.count === 1 ? "" : "s"}` : "—"}
        </span>
        <span className="typo-caption">
          {app.tools
            ? (app.tools.transport ?? "no transport")
            : app.overrides
              ? `${app.overrides} pinned`
              : ""}
        </span>
      </div>

      <div className="app-row__cell">
        <span className="typo-caption">{whenSeen(app.lastSeen)}</span>
      </div>

      <div className="app-row__acts" data-open={confirming ? "true" : undefined}>
        {confirming ? (
          <>
            <Button size="sm" variant="primary" onClick={() => onForget(app.origin)}>
              Yes, forget
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Keep
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="ghost" onClick={() => onOpen(app.origin)}>
              {app.tabId === null ? "Open" : "Show"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onEnable(app.origin, !app.enabled)}>
              {app.enabled ? "Switch off" : "Switch on"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Forget ${app.host}`}
              onClick={() => setConfirming(true)}
            >
              Forget
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

/**
 * The way in. Registering writes the origin row *and* opens a tab, in that order, so Athena
 * reads a page she is already allowed to act on. `lead` is the empty ledger: the field is then
 * the largest thing on the surface, because it is the only act there is.
 */
function RegisterField({ lead, onRegister }: { lead: boolean; onRegister: (url: string) => void }) {
  const [typed, setTyped] = useState("");
  const register = () => {
    const url = normaliseUrl(typed);
    if (!url) return;
    setTyped("");
    onRegister(url);
  };
  return (
    <div className={lead ? "register register--lead" : "register"}>
      <div className="register__row">
        <input
          className="input register__field focus-ring"
          value={typed}
          placeholder="invoicing.example.test"
          aria-label="Address of the app to register"
          spellCheck={false}
          autoFocus={lead}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") register();
          }}
        />
        <Button
          variant="primary"
          disabledReason={typed.trim() ? undefined : "Type an address first."}
          onClick={register}
        >
          Register and open
        </Button>
      </div>
      <p className="typo-caption">
        Any site. Registering switches the origin on and opens it, so Athena can read what it
        offers; nothing runs there until you say so.
      </p>
    </div>
  );
}

/** A timestamp as a person says it. Verbatim date when it cannot be parsed. */
function whenSeen(iso: string): string {
  if (!iso) return "never";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  const minutes = Math.round((Date.now() - at.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d ago`;
  return at.toISOString().slice(0, 10);
}

// -- the strip -----------------------------------------------------------------------------------

/** The same three facts as a sentence, for the one place there is room for one. */
function describe(tools: BrowserTools | null): string {
  if (!tools || tools.asking) return "Asking the page what it has registered…";
  if (tools.problem) return `No bridge on this page: ${tools.problem}. The generic hands are how it is operated.`;
  if (!tools.count) return `No tools registered — ${tools.transport ?? "no transport"}.`;
  return `${tools.count} tool${tools.count === 1 ? "" : "s"} registered, over ${tools.transport ?? "no transport"}.`;
}

/**
 * The focused page's tier-1 surface in one pill, and it is three facts rather than a number.
 * `pending` is nobody has asked yet; `warning` is the relay could not read the page, with the
 * reason verbatim in the title; and a count is a count, where zero is the ordinary answer for
 * every site that never heard of WebMCP — which is what the nine hands exist for (c24).
 */
function ToolCount({ tools }: { tools: BrowserTools | null }) {
  if (!tools) return null;
  if (tools.asking) {
    return (
      <Badge tone="pending" title="Asking the page what it has registered">
        tools
      </Badge>
    );
  }
  if (tools.problem) {
    return (
      <Badge tone="warning" title={`The page did not answer: ${tools.problem}`}>
        no bridge
      </Badge>
    );
  }
  return (
    <Badge
      tone={tools.count ? "success" : "neutral"}
      title={`${tools.count} tool(s) over ${tools.transport ?? "no transport"}`}
    >
      {`${tools.count} tools`}
    </Badge>
  );
}

/**
 * The tabs, scrolling rather than squeezing. A chip has a minimum readable width, so a row that
 * divides itself between however many tabs are open stops being a tab strip at about eight of
 * them: the labels go, then the close buttons overlap, then the newest tab is simply not drawn.
 */
function TabStrip({
  tabs,
  onFocus,
  onClose,
}: {
  tabs: readonly BrowserTab[];
  onFocus: (id: number) => void;
  onClose: (id: number) => void;
}) {
  return (
    <div className="tab-rail" data-tauri-drag-region>
      {tabs.map((tab) => (
        <span
          key={tab.id}
          className={tab.focused ? "tab-chip tab-chip--focused typo-caption" : "tab-chip typo-caption"}
        >
          <button
            type="button"
            className="tab-chip__label focus-ring"
            title={tab.url}
            onClick={() => onFocus(tab.id)}
          >
            {tab.title}
          </button>
          <button
            type="button"
            className="tab-chip__close focus-ring"
            title="Close tab"
            aria-label={`Close ${tab.title}`}
            onClick={() => onClose(tab.id)}
          >
            ×
          </button>
        </span>
      ))}
    </div>
  );
}

/**
 * The address field. `edit` is null until the user types and the displayed value falls back to
 * the tab's own URL, so a navigation the page performed shows up with no syncing effect. The
 * draft outlives Enter until the navigation resolves: Rust rejects anything `Url::parse` refuses
 * — a typed phrase with a space, which is what a user produces the moment they treat this as a
 * search box — and clearing the draft first made that failure invisible.
 */
function UrlField({ url, onGo }: { url: string; onGo: (typed: string) => void }) {
  const [edit, setEdit] = useState<string | null>(null);
  const value = edit ?? url;
  return (
    <input
      className="input url-field focus-ring typo-body"
      value={value}
      spellCheck={false}
      placeholder="Address"
      aria-label="Address"
      onChange={(e) => setEdit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onGo(value);
        if (e.key === "Escape") setEdit(null);
      }}
    />
  );
}
