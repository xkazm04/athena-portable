/**
 * The Browser module's surface — a pure function of `BrowserModel`.
 *
 * **Its first 40px are a contract.** The window has two shapes (`src-tauri/src/layout.rs`): when
 * this module is selected and a tab is open, the chrome webview is clipped to the module bar plus
 * `--strip-height` and a page webview fills everything under it, so the only part of this view
 * the user sees is the tab strip. With no tab open there is no page webview, the chrome webview
 * gets the whole window, and the rest of this view — the doorway and the ledger of apps — is
 * what fills it. The preview harness always shows all of it.
 *
 * The doorway is the one bold thing here: a drawing of the window this module is, and the
 * address at the size of a title, because opening an app is the whole of what a person does on
 * this surface when nothing is open. The ledger under it is the quieter, longer-lived part —
 * every origin Athena has been told about, where each stands right now, and a field to tell her
 * about another.
 */
import { useState } from "react";

import Badge from "@/components/Badge";
import Button from "@/components/Button";
import PageHeader from "@/components/PageHeader";
import PageShell from "@/components/PageShell";
import SectionCard from "@/components/SectionCard";
import type { Tone } from "@/components/StatusDot";
import Table from "@/components/Table";
import type { Column } from "@/components/Table";
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
          ) : focused ? (
            <div className="page-stand-in">
              <p className="typo-title">The page draws here</p>
              <p className="typo-caption">{focused.url}</p>
              {/* Tier 1, in the one place there is room to spell it out (README section 3.4). */}
              <p className="typo-caption">{describe(tools)}</p>
            </div>
          ) : (
            <Doorway onOpen={(url) => actions.open(url)} />
          )}

          <Ledger
            apps={apps}
            loaded={appsLoaded}
            problem={appsProblem}
            onOpen={actions.openApp}
            onEnable={actions.setEnabled}
            onForget={actions.forget}
            onRegister={actions.register}
          />
        </PageShell>
      </div>
    </div>
  );
}

// -- the doorway ---------------------------------------------------------------------------------

/**
 * What a person sees when nothing is open: the window this module is, drawn, and the address at
 * the size of a title. The drawing is the one illustration in the app, and it is of the thing
 * itself — a bar, two tabs, one lit page — rather than a metaphor for it.
 */
function Doorway({ onOpen }: { onOpen: (url: string) => void }) {
  const [typed, setTyped] = useState("");
  const open = () => {
    const url = normaliseUrl(typed);
    if (!url) return;
    setTyped("");
    onOpen(url);
  };
  return (
    <section className="doorway" aria-labelledby="doorway-title">
      <WindowArt />
      <div className="doorway__body">
        <h2 id="doorway-title" className="doorway__title">
          Open an app
        </h2>
        <div className="doorway__row">
          <input
            className="input doorway__field focus-ring"
            value={typed}
            placeholder="invoicing.example.test"
            aria-label="Address of the app to open"
            spellCheck={false}
            autoFocus
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") open();
            }}
          />
          <Button variant="primary" disabledReason={typed.trim() ? undefined : "Type an address first."} onClick={open}>
            Open
          </Button>
        </div>
        <p className="typo-caption">
          Any site works. A page that registers tools shows them in the strip; one that registers
          nothing is operated by the generic hands. Nothing runs there until you say so.
        </p>
      </div>
    </section>
  );
}

/** A window with two tabs and one lit page, in the current text colour and the primary hue. */
function WindowArt() {
  return (
    <svg
      className="doorway__art"
      viewBox="0 0 320 220"
      role="img"
      aria-label="A window with two tabs; the open page is lit"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect className="paper" x="12" y="14" width="296" height="192" rx="12" />
      <path d="M12 46h296" />
      <rect x="26" y="24" width="72" height="16" rx="5" />
      <rect className="lit" x="106" y="24" width="72" height="16" rx="5" />
      <circle cx="288" cy="32" r="3" fill="currentColor" />
      <circle cx="276" cy="32" r="3" fill="currentColor" />
      <g className="lit">
        <rect x="32" y="66" width="120" height="10" rx="3" />
        <rect x="32" y="88" width="256" height="1" />
        <rect x="32" y="104" width="92" height="8" rx="3" />
        <rect x="140" y="104" width="148" height="8" rx="3" />
        <rect x="32" y="122" width="72" height="8" rx="3" />
        <rect x="140" y="122" width="108" height="8" rx="3" />
        <rect x="32" y="140" width="112" height="8" rx="3" />
        <rect x="140" y="140" width="80" height="8" rx="3" />
        <rect x="200" y="164" width="88" height="22" rx="6" />
      </g>
      <path d="M212 175h64" className="lit" strokeDasharray="3 4" />
    </svg>
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
  closed: "closed",
  reading: "reading",
  ready: "ready",
  hands: "hands",
  disabled: "off",
};

/**
 * Every origin Athena has been told about, and where each stands now. A row is a fact about the
 * tabs and the relay at this render, never a stored word; the standing beside the host is the
 * same one the strip's pill shows when that page is on screen.
 */
function Ledger({
  apps,
  loaded,
  problem,
  onOpen,
  onEnable,
  onForget,
  onRegister,
}: {
  apps: readonly RegisteredApp[];
  loaded: boolean;
  problem: string | null;
  onOpen: (origin: string) => void;
  onEnable: (origin: string, enabled: boolean) => void;
  onForget: (origin: string) => void;
  onRegister: (url: string) => void;
}) {
  const columns: readonly Column<RegisteredApp>[] = [
    {
      key: "app",
      head: "App",
      render: (app) => (
        <span className="app-cell">
          <button type="button" className="tab-chip__label focus-ring typo-title" onClick={() => onOpen(app.origin)}>
            {app.host}
          </button>
          <span className="typo-caption app-cell__origin">{app.origin}</span>
        </span>
      ),
    },
    {
      key: "standing",
      head: "Standing",
      render: (app) => (
        <span className="app-cell">
          <Badge tone={STANDING_TONE[app.standing]}>{STANDING_WORD[app.standing]}</Badge>
          <span className="typo-caption">{app.summary}</span>
        </span>
      ),
    },
    {
      key: "overrides",
      head: "Pinned",
      render: (app) => (
        <span className="typo-data">{app.overrides ? `${app.overrides} tool${app.overrides === 1 ? "" : "s"}` : "—"}</span>
      ),
    },
    {
      key: "seen",
      head: "Last seen",
      render: (app) => <span className="typo-caption">{whenSeen(app.lastSeen)}</span>,
    },
    {
      key: "actions",
      head: "",
      align: "right",
      render: (app) => (
        <span className="app-actions">
          <Button size="sm" variant="secondary" onClick={() => onOpen(app.origin)}>
            {app.tabId === null ? "Open" : "Show"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onEnable(app.origin, !app.enabled)}>
            {app.enabled ? "Switch off" : "Switch on"}
          </Button>
          <Button size="sm" variant="ghost" aria-label={`Forget ${app.host}`} onClick={() => onForget(app.origin)}>
            Forget
          </Button>
        </span>
      ),
    },
  ];

  return (
    <SectionCard
      title="Registered apps"
      note={problem ? "could not be read" : loaded ? `${apps.length} registered` : "reading the table"}
      padded={false}
    >
      {problem ? (
        <div style={{ padding: "var(--density-pad-sm)" }}>
          <p className="well">{problem}</p>
          <p className="typo-caption">
            The origins table did not answer. Apps still open; their standing is not shown.
          </p>
        </div>
      ) : (
        <Table
          columns={columns}
          rows={apps}
          rowKey={(app) => app.origin}
          empty={
            loaded
              ? "No app is registered yet. Register one below, or open a page and switch it on."
              : "The origins table has not answered yet."
          }
        />
      )}
      <div style={{ padding: "var(--density-pad-sm)", borderTop: "1px solid var(--border-subtle)" }}>
        <RegisterField onRegister={onRegister} />
      </div>
    </SectionCard>
  );
}

/** The way to tell Athena about an app before it is open: the row is written and a tab opens. */
function RegisterField({ onRegister }: { onRegister: (url: string) => void }) {
  const [typed, setTyped] = useState("");
  const register = () => {
    const url = normaliseUrl(typed);
    if (!url) return;
    setTyped("");
    onRegister(url);
  };
  return (
    <div className="register">
      <input
        className="input register__field focus-ring typo-body"
        value={typed}
        placeholder="Register an app by its address"
        aria-label="Address of the app to register"
        spellCheck={false}
        onChange={(e) => setTyped(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") register();
        }}
      />
      <Button variant="secondary" size="sm" disabledReason={typed.trim() ? undefined : "Type an address first."} onClick={register}>
        Register and open
      </Button>
      <span className="typo-caption">Registering switches the origin on and opens it, so Athena can read what it offers.</span>
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
