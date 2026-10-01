/**
 * The app root — README section 3.1 (surfaces) and 3.5 (module-first window); ADR 0026 (Main is
 * the workhorse beside her).
 *
 * It is two things and nothing else: **the module bar**, and **the selected module**. The window
 * is not a browser with surfaces bolted to the side of it; it is a bar and one module at full
 * width, and the browser is one module among three. The conversation, the cards and the voice key
 * live in Athena's own window; the bar keeps a presence pill that summons her.
 *
 * **App-wide stores are started here.** That is the day-zero rule from README section 3.5: the
 * first build's tray count lived in one page and froze the moment the user left it. A store that
 * must stay true while the user is looking at something else is started by this root and by
 * nothing else — a module's `Live` may read a store, never start one. Main starts what Main
 * needs (shell, tabs, tools, daemon, settings, origins, connectors, her status); the run and
 * voice stores belong to her window (ADR 0026, "Who runs which store").
 *
 * The window buttons live here because the decorations are off: this document is also the
 * titlebar. Everything in the bar that is not a control carries `data-tauri-drag-region`, which
 * is self-only in Tauri v2 — a bare `<div>` in the path swallows the drag rather than passing it
 * up.
 */
import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import ModuleBar, { BarIcon, type Presence } from "@/components/ModuleBar";
import { athenaShow } from "@/lib/companion";
import { hasShell } from "@/lib/ipc";
import { MODULE_ENTRIES, moduleFor } from "@/modules/registry";
import { isResting, pillText, startAthena, useAthena } from "@/stores/athena";
import { startConnectors } from "@/stores/connectors";
import { startDaemon } from "@/stores/daemon";
import { startEngines } from "@/stores/engines";
import { startOrigins } from "@/stores/origins";
import { startSettings, useSettings } from "@/stores/settings";
import { startShell, useShell } from "@/stores/shell";
import { startTabs } from "@/stores/tabs";
import { startTools } from "@/stores/tools";

const ICON_SUN =
  "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5.3 5.3 7 7M17 17l1.7 1.7M5.3 18.7 7 17M17 7l1.7-1.7";
const ICON_MOON = "M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z";

export default function App() {
  const module = useShell((s) => s.module);
  const select = useShell((s) => s.select);
  const theme = useShell((s) => s.theme);
  const themeChoice = useSettings((s) => s.theme);
  const setTheme = useSettings((s) => s.setTheme);
  const athena = useAthena();

  useEffect(() => {
    void startShell();
    void startTabs();
    void startTools();
    void startDaemon();
    // c21: the settings rows and the origins table. Both are read here and nowhere else — a
    // store a *view* starts stops being true the moment the user leaves that view.
    void startSettings();
    void startOrigins();
    void startConnectors();
    void startEngines();
    void startAthena();
  }, []);

  const active = moduleFor(module);
  const Live = active.Live;

  const presence: Presence = {
    tone: athena.cards > 0 ? "human" : isResting(athena.state, athena.line) ? "idle" : "work",
    text: pillText(athena),
  };

  return (
    <div className="app-root">
      <ModuleBar
        items={MODULE_ENTRIES.map((m) => ({ id: m.id, label: m.label }))}
        active={active.id}
        onSelect={(id) => void select(id)}
        presence={presence}
        onSummon={() => void athenaShow()}
        trailing={
          <>
            {/* The Setup module owns the three-way choice (system / light / dark) and this
                is its shortcut: one press flips to the opposite of what is *painted*, and the
                choice it writes is a definite one, because "the opposite of system" is not a
                theme. Both go through the same `settings` row, so the bar and the module can
                never disagree. */}
            <button
              type="button"
              className="window-btn focus-ring"
              title={`Theme: ${themeChoice}`}
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
              onClick={() => void setTheme(theme === "dark" ? "light" : "dark")}
            >
              <BarIcon d={theme === "dark" ? ICON_SUN : ICON_MOON} />
            </button>
            <WindowButtons waiting={athena.cards > 0} />
          </>
        }
      />
      <main className="app-body">
        <Live />
      </main>
    </div>
  );
}

function WindowButtons({ waiting }: { waiting: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const keep = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirming) keep.current?.focus();
  }, [confirming]);
  if (!hasShell()) return null;
  const win = getCurrentWindow();
  // Closing Main closes the whole app, Athena's window with it (ADR 0026), and says so.
  const close = () => void win.close();
  return (
    <span className="window-buttons">
      <button
        type="button"
        className="window-btn focus-ring"
        title="Minimise"
        aria-label="Minimise"
        onClick={() => void win.minimize()}
      >
        <BarIcon d="M6 12h12" />
      </button>
      <button
        type="button"
        className="window-btn focus-ring"
        title="Maximise"
        aria-label="Maximise"
        onClick={() => void win.toggleMaximize()}
      >
        <BarIcon d="M7 6h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z" />
      </button>
      {confirming ? (
        <span
          className="close-confirm"
          role="alertdialog"
          aria-label="Confirm close"
          onKeyDown={(e) => {
            if (e.key === "Escape") setConfirming(false);
          }}
        >
          <span className="close-confirm__text typo-caption">A decision is waiting. Close anyway?</span>
          <button type="button" className="close-confirm__btn focus-ring" onClick={close}>
            Close
          </button>
          <button
            ref={keep}
            type="button"
            className="close-confirm__btn focus-ring"
            onClick={() => setConfirming(false)}
          >
            Keep
          </button>
        </span>
      ) : (
        <button
          type="button"
          className="window-btn window-btn--close focus-ring"
          title="Closes Athena: both windows"
          aria-label="Close Athena"
          onClick={() => (waiting ? setConfirming(true) : close())}
        >
          <BarIcon d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
        </button>
      )}
    </span>
  );
}
