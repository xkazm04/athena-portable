/**
 * The app root — README section 3.1 (surfaces) and 3.5 (module-first window).
 *
 * It is two things and nothing else: **the module bar**, and **the selected module**. The window
 * is not a browser with surfaces bolted to the side of it; it is a bar and one module at full
 * width, and the browser is one module among them.
 *
 * **App-wide stores are started here.** That is the day-zero rule from README section 3.5: the
 * first build's tray count lived in one page and froze the moment the user left it. A store that
 * must stay true while the user is looking at something else is started by this root and by
 * nothing else — a module's `Live` may read a store, never start one.
 *
 * The window buttons live here because the decorations are off: this document is also the
 * titlebar. Everything in the bar that is not a control carries `data-tauri-drag-region`, which
 * is self-only in Tauri v2 — a bare `<div>` in the path swallows the drag rather than passing it
 * up.
 */
import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import ModuleBar from "@/components/ModuleBar";
import { hasShell } from "@/lib/ipc";
import { MODULE_ENTRIES, moduleFor } from "@/modules/registry";
import { startDaemon } from "@/stores/daemon";
import { startShell, useShell } from "@/stores/shell";
import { startTabs } from "@/stores/tabs";

export default function App() {
  const module = useShell((s) => s.module);
  const select = useShell((s) => s.select);
  const theme = useShell((s) => s.theme);
  const setTheme = useShell((s) => s.setTheme);

  useEffect(() => {
    void startShell();
    void startTabs();
    void startDaemon();
  }, []);

  const active = moduleFor(module);
  const Live = active.Live;

  return (
    <div className="app-root">
      <ModuleBar
        items={MODULE_ENTRIES.map((m) => ({ id: m.id, label: m.label }))}
        active={active.id}
        onSelect={(id) => void select(id)}
        trailing={
          <>
            {/* The Settings module takes the theme over in c21 and writes it to the store table;
                until then this is how both halves of the token contract are reachable. */}
            <button
              type="button"
              className="window-btn typo-label focus-ring"
              title="Theme"
              aria-label={`Theme: ${theme}`}
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              {theme === "dark" ? "◗" : "◖"}
            </button>
            <WindowButtons />
          </>
        }
      />
      <main className="app-body">
        <Live />
      </main>
    </div>
  );
}

function WindowButtons() {
  if (!hasShell()) return null;
  const win = getCurrentWindow();
  return (
    <span className="window-buttons">
      <button
        type="button"
        className="window-btn focus-ring"
        title="Minimise"
        aria-label="Minimise"
        onClick={() => void win.minimize()}
      >
        –
      </button>
      <button
        type="button"
        className="window-btn focus-ring"
        title="Maximise"
        aria-label="Maximise"
        onClick={() => void win.toggleMaximize()}
      >
        □
      </button>
      <button
        type="button"
        className="window-btn window-btn--close focus-ring"
        title="Close"
        aria-label="Close window"
        onClick={() => void win.close()}
      >
        ×
      </button>
    </span>
  );
}
