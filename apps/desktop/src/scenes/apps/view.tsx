/**
 * The Apps depth — README section 3.4 and 3.5, ADR 0063, 0087 and 0088.
 *
 * Three levels of one scene. The **field** is the apps Athena has been told about, each a window of
 * light whose standing is a shape and a word; the one under attention takes the centre in display
 * type. The **app** is one of them composed on its own: what it is, how it stands, whether she may
 * act there, Open, and Forget (which asks twice, because a forgotten origin is a first sight
 * again). The **tool** is one tool its open page registered, as the page said it. The page itself
 * is not drawn here: at `apps/<app>/page` the stage is only a band over a native webview
 * (ADR 0088).
 *
 * A pure function of `{ model, path, go }`, as every scene is. Its own state is only what is
 * hovered, what is typed and whether Forget has been pressed once. Every word the old module said
 * that was a fact or a promise is kept verbatim.
 */
import { useEffect, useRef, useState } from "react";

import Badge from "@/components/Badge";
import Button from "@/components/Button";
import Facts, { Fact } from "@/components/Facts";
import PillGroup from "@/components/PillGroup";
import ProblemNote from "@/components/ProblemNote";
import StatusDot, { type Tone } from "@/components/StatusDot";
import type { Path } from "@/depth/model";
import { whenAgo } from "@/lib/time";
import { normaliseUrl } from "@/lib/url";
import { originOf, type AppStanding, type RegisteredApp } from "@/modules/browser/model";

import type { AppsModel, PageEntry, ToolView } from "./model";
import { appFor, appPath, pageFor, pagePath, toolPath } from "./model";
import AppOrb from "./orb";
import "./apps.css";

const STANDING_TONE: Record<AppStanding, Tone> = {
  closed: "neutral",
  reading: "pending",
  ready: "success",
  readonly: "info",
  disabled: "warning",
};

const STANDING_WORD: Record<AppStanding, string> = {
  closed: "not opened",
  reading: "reading",
  ready: "ready",
  readonly: "read only",
  disabled: "not acting",
};

export interface AppsViewProps {
  model: AppsModel;
  path: Path;
  go: (to: Path) => void;
}

export default function AppsView({ model, path, go }: AppsViewProps) {
  if (path.item === undefined) return <Field model={model} go={go} />;
  const item = path.item;
  if (path.sub?.kind === "tool") return <ToolLevel model={model} item={item} name={path.sub.arg ?? ""} go={go} />;
  if (path.sub?.kind === "page") return <div className="apps apps--page" aria-hidden="true" />;
  return <AppLevel model={model} item={item} go={go} />;
}

// -- the field -----------------------------------------------------------------------------------

function Field({ model, go }: { model: AppsModel; go: (to: Path) => void }) {
  const { browser, pages } = model;
  const { actions, apps, appsLoaded, appsProblem, problem, firstRun } = browser;
  const [focused, setFocused] = useState<string | null>(null);
  const hovered = apps.find((a) => a.origin === focused) ?? null;
  const none = appsLoaded && !appsProblem && apps.length === 0;

  // A pressed close leaves with its chip once the tab is gone, so focus would fall to the document.
  // It goes to the close now in that place, or the last one, or the register box once none is
  // open; never when the person has moved on in the meantime.
  const field = useRef<HTMLDivElement>(null);
  const closed = useRef<{ tabId: number; at: number } | null>(null);
  useEffect(() => {
    if (closed.current === null || pages.some((p) => p.tabId === closed.current!.tabId)) return;
    const { at } = closed.current;
    closed.current = null;
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    const closes = field.current?.querySelectorAll<HTMLButtonElement>(".apps__chip-close") ?? [];
    const next = closes.length ? closes[Math.min(at, closes.length - 1)] : field.current?.querySelector("input");
    next?.focus();
  }, [pages]);

  return (
    <div className="apps apps--field" ref={field}>
      <header className="apps__head">
        <p className="apps__eyebrow">{hovered ? STANDING_WORD[hovered.standing] : "Apps"}</p>
        <h1 className="apps__marquee">{hovered ? hovered.host : "The apps Athena works in"}</h1>
        <p className="apps__line" aria-live="polite">
          {hovered ? hovered.summary : "Open one, and she reads what it offers."}
        </p>
        <div className="apps__badges">
          <Badge tone={appsProblem ? "error" : appsLoaded ? (apps.length ? "success" : "neutral") : "pending"}>
            {appsProblem ? "could not be read" : appsLoaded ? `${apps.length} registered` : "reading the table"}
          </Badge>
          <Badge tone={problem ? "error" : pages.length ? "success" : "neutral"}>
            {problem ? "unread" : `${pages.length} open`}
          </Badge>
        </div>
      </header>

      {problem ? (
        <ProblemNote title="The tab list could not be read" reason={problem} />
      ) : null}

      {appsProblem ? (
        <div className="apps__problem">
          {/* Verbatim, never paraphrased: a reason we cannot explain is still a reason. */}
          <p className="well">{appsProblem}</p>
          <p className="typo-caption">The origins table did not answer. Apps still open; their standing is not shown.</p>
        </div>
      ) : (
        <ol className="apps__orbs" aria-label="Registered apps">
          {apps.map((app) => (
            <li key={app.origin}>
              <button
                type="button"
                className="apps__orb focus-ring"
                data-standing={app.standing}
                onMouseEnter={() => setFocused(app.origin)}
                onMouseLeave={() => setFocused((f) => (f === app.origin ? null : f))}
                onFocus={() => setFocused(app.origin)}
                onBlur={() => setFocused((f) => (f === app.origin ? null : f))}
                onClick={() => go(appPath(app.origin))}
                aria-label={`${app.host}, ${STANDING_WORD[app.standing]}. Open its layer.`}
              >
                <AppOrb monogram={app.monogram} standing={app.standing} size={112} />
                <span className="apps__orb-host">{app.host}</span>
                <span className="apps__orb-standing">
                  <StatusDot tone={STANDING_TONE[app.standing]} />
                  {STANDING_WORD[app.standing]}
                </span>
                <span className="apps__orb-tools">
                  {app.tools
                    ? `${app.tools.count} tool${app.tools.count === 1 ? "" : "s"}`
                    : app.overrides
                      ? `${app.overrides} pinned`
                      : "no tools yet"}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}

      {none ? (
        <p className="typo-caption">No app is registered yet. Register one, or open a page and switch it on.</p>
      ) : !appsLoaded && !appsProblem ? (
        <p className="typo-caption">The origins table has not answered yet.</p>
      ) : null}

      <Register
        lead={none}
        firstRun={none ? firstRun : null}
        onRegister={(url) => actions.register(url)}
      />

      {pages.length > 0 && (
        <section className="apps__pages" aria-label="Open pages">
          <h2 className="apps__pages-title">Open pages</h2>
          <ul>
            {pages.map((page, i) => (
              <PageChip
                key={page.tabId}
                page={page}
                onShow={() => {
                  actions.focus(page.tabId);
                  go(pagePath(page.item));
                }}
                onClose={() => {
                  closed.current = { tabId: page.tabId, at: i };
                  actions.close(page.tabId);
                }}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function PageChip({ page, onShow, onClose }: { page: PageEntry; onShow: () => void; onClose: () => void }) {
  return (
    <li className="apps__chip" data-focused={page.focused}>
      <button type="button" className="apps__chip-main focus-ring" title={page.url} aria-current={page.focused ? "true" : undefined} onClick={onShow}>
        {page.title}
      </button>
      <button
        type="button"
        className="apps__chip-close focus-ring"
        title="Close tab"
        aria-label={`Close ${page.title}`}
        onClick={onClose}
      >
        ×
      </button>
    </li>
  );
}

/**
 * The way in. Registering writes the origin row *and* opens a tab, in that order, so Athena reads a
 * page she is already allowed to act on. `lead` is the empty field: this is then the largest thing
 * on the surface, because it is the only act there is.
 */
function Register({
  lead,
  firstRun,
  onRegister,
}: {
  lead: boolean;
  firstRun: AppsModel["browser"]["firstRun"];
  onRegister: (url: string) => void;
}) {
  const [typed, setTyped] = useState("");
  // The module registers an origin, and drops a URL that has none without a word (a phrase with a
  // space, `about:blank`): such an address is refused here, with the reason, and stays in the box.
  const url = normaliseUrl(typed);
  const origin = url ? originOf(url) : "";
  const placeable = origin !== "" && origin !== "null";
  const register = () => {
    if (!url || !placeable) return;
    setTyped("");
    onRegister(url);
  };
  return (
    <section className={lead ? "apps__register apps__register--lead" : "apps__register"} aria-labelledby="apps-register">
      <h2 id="apps-register" className="apps__register-title">
        Register an app
      </h2>
      <div className="apps__register-row">
        <input
          className="apps__input focus-ring"
          value={typed}
          placeholder={firstRun ? "Address of an app" : "invoicing.example.test"}
          aria-label="Address of the app to register"
          aria-describedby={firstRun ? "apps-register-first" : undefined}
          spellCheck={false}
          autoFocus={lead}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") register();
            // The field's own Escape: the first drops what was typed, the next lets go, so the
            // one after that is the stage's and rises (the stage never takes a field's Escape).
            if (e.key === "Escape") {
              if (typed !== "") setTyped("");
              else e.currentTarget.blur();
            }
          }}
        />
        <Button
          variant="primary"
          disabledReason={
            !typed.trim() ? "Type an address first." : placeable ? undefined : "That is not an address an app can live at."
          }
          onClick={register}
        >
          Register and open
        </Button>
      </div>
      {firstRun ? (
        <div id="apps-register-first" className="apps__first">
          <p className="typo-body">Type the address of an app you use, for example your invoicing tool.</p>
          <p className="typo-caption">
            Press Enter to open it. For example: <span className="apps__example">invoicing.example.test</span>
          </p>
          <p className="typo-caption">Setup: {firstRun.engineLine}</p>
        </div>
      ) : null}
      <p className="typo-caption">
        Any site. Registering switches the origin on and opens it, so Athena can read what it offers;
        nothing is done there until you approve it.
      </p>
    </section>
  );
}

// -- one app -------------------------------------------------------------------------------------

function AppLevel({ model, item, go }: { model: AppsModel; item: string; go: (to: Path) => void }) {
  const app = appFor(model, item);
  const page = pageFor(model, item);
  const tools = model.tools[item];
  if (!app && !page) return <NotFound item={item} go={go} />;
  const { actions } = model.browser;

  // A page that is open on an origin nobody registered still has a layer: what it is, its tools,
  // and the one way to make it an app.
  const host = app?.host ?? page!.host;
  const origin = app?.origin ?? page!.url;
  const standing: AppStanding | null = app?.standing ?? null;
  const open = app ? app.tabId !== null : true;

  return (
    <div className="apps apps--app">
      <div className="apps__art">
        <AppOrb monogram={(app?.monogram ?? host.charAt(0).toUpperCase()) || "?"} standing={standing ?? "closed"} size={240} />
        <p className="apps__stylised">Stylised drawing, not the app.</p>
      </div>

      <div className="apps__detail">
        <p className="apps__eyebrow">{app ? "Registered app" : "Open page, not registered"}</p>
        <h1 className="apps__marquee apps__marquee--app">{host}</h1>
        <p className="apps__line">{app ? app.summary : "Athena has not been told about this app. Register it to let her read and propose here."}</p>
        <div className="apps__badges">
          {standing && <Badge tone={STANDING_TONE[standing]}>{STANDING_WORD[standing]}</Badge>}
          <span className="apps__origin" title={origin}>
            {origin}
          </span>
        </div>

        <div className="apps__acts">
          <Button
            variant="primary"
            onClick={() => {
              if (app) actions.openApp(app.origin);
              else {
                actions.focus(page!.tabId);
                go(pagePath(item));
              }
            }}
          >
            {open ? "Show the page" : "Open the page"}
          </Button>
          {!app && (
            <Button variant="secondary" onClick={() => actions.register(page!.url)}>
              Register this app
            </Button>
          )}
        </div>

        {app && (
          <>
            <Facts>
              <Fact label="Tools">
                {app.tools ? `${app.tools.count} over ${app.tools.transport ?? "no transport"}` : "none answered yet"}
              </Fact>
              <Fact label="Pinned classes">{app.overrides ? String(app.overrides) : "none"}</Fact>
              <Fact label="Last seen">{whenAgo(app.lastSeen) || "never"}</Fact>
            </Facts>

            <section className="apps__section" aria-labelledby="apps-act">
              <h2 id="apps-act" className="apps__section-title">
                Athena may act here
              </h2>
              <p className="typo-caption">Off, every call on this app is refused by the gate.</p>
              <PillGroup
                ariaLabel={`Athena may act on ${app.host}`}
                value={app.enabled ? "on" : "off"}
                onChange={(next) => actions.setEnabled(app.origin, next === "on")}
                options={[
                  { value: "on", label: "on", hint: "Athena may read and propose here; every act is still a card." },
                  { value: "off", label: "off", hint: "She may not act on this app." },
                ]}
              />
            </section>

            <Forget app={app} onForget={() => { actions.forget(app.origin); go({ root: "apps" }); }} />
          </>
        )}

        <ToolList item={item} tools={tools} go={go} open={open} />
      </div>
    </div>
  );
}

/** Forget asks once more: a forgotten origin, its switch and its pinned classes are a first sight again. */
function Forget({ app, onForget }: { app: RegisteredApp; onForget: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const section = useRef<HTMLElement>(null);
  const moved = useRef(false);
  // The pressed button is replaced by the question, so focus would fall to the document: the safe
  // answer (Keep) takes it, and the way in takes it back when the question is withdrawn.
  useEffect(() => {
    if (!moved.current) return;
    const buttons = section.current?.querySelectorAll("button");
    (confirming ? buttons?.[buttons.length - 1] : buttons?.[0])?.focus();
  }, [confirming]);
  const ask = (next: boolean) => {
    moved.current = true;
    setConfirming(next);
  };
  return (
    <section ref={section} className="apps__section" aria-labelledby="apps-forget">
      <h2 id="apps-forget" className="apps__section-title">
        Forget
      </h2>
      <p className="typo-caption">The origin, its switch and its pinned classes go.</p>
      {confirming ? (
        <span className="apps__row">
          <span className="typo-caption">Forget {app.host}? It is a first sight again.</span>
          <Button size="sm" variant="primary" onClick={onForget}>
            Yes, forget
          </Button>
          <Button size="sm" variant="ghost" onClick={() => ask(false)}>
            Keep
          </Button>
        </span>
      ) : (
        <Button size="sm" variant="ghost" aria-label={`Forget ${app.host}`} onClick={() => ask(true)}>
          Forget this app
        </Button>
      )}
    </section>
  );
}

function ToolList({
  item,
  tools,
  open,
  go,
}: {
  item: string;
  tools: AppsModel["tools"][string] | undefined;
  open: boolean;
  go: (to: Path) => void;
}) {
  return (
    <section className="apps__section" aria-labelledby="apps-tools">
      <h2 id="apps-tools" className="apps__section-title">
        What the page offers
      </h2>
      {!open || !tools ? (
        <p className="typo-caption">Open the page and Athena asks it what it has registered.</p>
      ) : !tools.answered ? (
        <p className="typo-caption">Asking the page what it has registered…</p>
      ) : tools.tools.length === 0 ? (
        <p className="typo-caption">
          This page offers no tools of its own; Athena reaches it through her generic hands, gated on first sight.
        </p>
      ) : (
        <ul className="apps__tools">
          {tools.tools.map((t) => (
            <li key={t.name}>
              <button type="button" className="apps__tool focus-ring" onClick={() => go(toolPath(item, t.name))}>
                <span className="apps__tool-name">{t.title || t.name}</span>
                {t.pinned && <Badge tone="warning">{`pinned ${t.pinned}`}</Badge>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// -- one tool ------------------------------------------------------------------------------------

function ToolLevel({ model, item, name, go }: { model: AppsModel; item: string; name: string; go: (to: Path) => void }) {
  const app = appFor(model, item);
  const page = pageFor(model, item);
  if (!app && !page) return <NotFound item={item} go={go} />;
  const tool: ToolView | undefined = model.tools[item]?.tools.find((t) => t.name === name);
  const host = app?.host ?? page!.host;

  if (!tool) {
    return (
      <div className="apps apps--tool">
        <div className="apps__detail">
          <p className="apps__eyebrow">{host}</p>
          <h1 className="apps__marquee apps__marquee--app">{name}</h1>
          <p className="apps__line">
            This page is not offering that tool right now. Its page may be closed, or it may have changed what it registers.
          </p>
          <Button variant="secondary" onClick={() => go(appPath(item))}>
            Back to {host}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="apps apps--tool">
      <div className="apps__detail">
        <p className="apps__eyebrow">A tool of {host}</p>
        <h1 className="apps__marquee apps__marquee--app">{tool.title || tool.name}</h1>
        {tool.title && <p className="apps__origin">{tool.name}</p>}
        <p className="apps__line">{tool.description || "The page gave no description."}</p>
        <Facts>
          <Fact label="Reads only">{tool.readOnly === null ? "the page did not say" : tool.readOnly ? "yes" : "no"}</Fact>
          <Fact label="Reversible">{tool.reversible === null ? "the page did not say" : tool.reversible ? "yes" : "no"}</Fact>
          <Fact label="Side effects">{tool.sideEffects || "the page did not say"}</Fact>
          <Fact label="Pinned class">{tool.pinned ?? "none: the class its flags imply"}</Fact>
        </Facts>
        <p className="typo-caption">
          These are what the page said about itself: claims, never permissions. Whether Athena may run this
          without asking is the gate's answer, and a pin can only make it ask more.
        </p>
      </div>
    </div>
  );
}

function NotFound({ item, go }: { item: string; go: (to: Path) => void }) {
  return (
    <div className="apps apps--tool">
      <div className="apps__detail">
        <p className="apps__eyebrow">Apps</p>
        <h1 className="apps__marquee apps__marquee--app">No such app</h1>
        <p className="apps__line">Athena has no app or open page called {item}. It may have been forgotten, or its tab closed.</p>
        <Button variant="secondary" onClick={() => go({ root: "apps" })}>
          Back to the apps
        </Button>
      </div>
    </div>
  );
}
