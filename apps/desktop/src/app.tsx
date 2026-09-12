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

import mark from "@/assets/athena-mark.png";
import ModuleBar from "@/components/ModuleBar";
import PushToTalk from "@/components/PushToTalk";
import { hasShell } from "@/lib/ipc";
import { MODULE_ENTRIES, moduleFor } from "@/modules/registry";
import { startDaemon } from "@/stores/daemon";
import { startOrigins } from "@/stores/origins";
import { startSettings, useSettings } from "@/stores/settings";
import { startShell, useShell } from "@/stores/shell";
import { startTabs } from "@/stores/tabs";
import { startTools } from "@/stores/tools";
import { startVoice, useVoice } from "@/stores/voice";

export default function App() {
  const module = useShell((s) => s.module);
  const select = useShell((s) => s.select);
  const theme = useShell((s) => s.theme);
  const themeChoice = useSettings((s) => s.theme);
  const setTheme = useSettings((s) => s.setTheme);

  useEffect(() => {
    void startShell();
    void startTabs();
    void startTools();
    void startDaemon();
    // c21: the settings rows and the origins table. Both are read here and nowhere else — a
    // store a *view* starts stops being true the moment the user leaves that view.
    void startSettings();
    void startOrigins();
    // c32: push-to-talk watches the daemon for `/voice` and owns the Ctrl+Space hotkey. Started
    // here for the same reason as the rest: the key is in the bar on every module.
    void startVoice();
  }, []);

  const active = moduleFor(module);
  const Live = active.Live;

  return (
    <div className="app-root">
      <ModuleBar
        items={MODULE_ENTRIES.map((m) => ({ id: m.id, label: m.label }))}
        active={active.id}
        onSelect={(id) => void select(id)}
        leading={
          // The same mark the window and the taskbar carry, so the bar names the app the way
          // the operating system does. Decorative here: the bar's label is the module list.
          <img className="module-bar__mark" src={mark} alt="" aria-hidden="true" draggable={false} />
        }
        trailing={
          <>
            <PushToTalkLive />
            {/* The Setup module owns the three-way choice (system / light / dark) and this
                is its shortcut: one press flips to the opposite of what is *painted*, and the
                choice it writes is a definite one, because "the opposite of system" is not a
                theme. Both go through the same `settings` row, so the bar and the module can
                never disagree. */}
            <button
              type="button"
              className="window-btn typo-label focus-ring"
              title={`Theme: ${themeChoice}`}
              aria-label={`Theme: ${themeChoice}`}
              onClick={() => void setTheme(theme === "dark" ? "light" : "dark")}
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

/** The bar's hold-to-talk key, bound to the voice store. Renders nothing of its own state. */
function PushToTalkLive() {
  const phase = useVoice((s) => s.phase);
  const available = useVoice((s) => s.available);
  const reason = useVoice((s) => s.reason);
  const partial = useVoice((s) => s.partial);
  const press = useVoice((s) => s.press);
  const release = useVoice((s) => s.release);
  return (
    <PushToTalk
      phase={phase}
      available={available}
      reason={reason}
      partial={partial}
      onPress={() => void press()}
      onRelease={release}
    />
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
