/**
 * @catalog The title bar's right end: the theme flip and the window buttons, with a close that asks first when a decision waits.
 *
 * Implements README section 3.1 and 3.5 (the decorations are off, so this document is also the
 * title bar) and ADR 0026 (closing Main closes both windows, and says so). The depth stage draws it
 * at the right end of its bar.
 *
 * The theme button flips to the opposite of what is *painted* and writes a definite choice, because
 * "the opposite of system" is not a theme. The window buttons draw only with a shell. The close
 * confirm leaves its own Escape to itself: it marks the key handled, so a stage listening for
 * Escape to rise a level does not also rise.
 */
import { useEffect, useId, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { hasShell } from "@/lib/ipc";
import { useSettings } from "@/stores/settings";
import { useShell } from "@/stores/shell";

/** A 24x24 stroked path, in the title bar's one icon style. */
function BarIcon({ d }: { d: string }) {
  return (
    <svg className="window-btn__icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

const ICON_SUN =
  "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5.3 5.3 7 7M17 17l1.7 1.7M5.3 18.7 7 17M17 7l1.7-1.7";
const ICON_MOON = "M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z";

export default function WindowControls({ waiting }: { waiting: boolean }) {
  const theme = useShell((s) => s.theme);
  const themeChoice = useSettings((s) => s.theme);
  const setTheme = useSettings((s) => s.setTheme);
  return (
    <>
      {/* The Setup module owns the three-way choice (system / light / dark) and this is its
          shortcut: one press flips to the opposite of what is *painted*. Both go through the same
          `settings` row, so the bar and the module can never disagree. */}
      <button
        type="button"
        className="window-btn focus-ring"
        title={`Theme: ${themeChoice}`}
        aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
        onClick={() => void setTheme(theme === "dark" ? "light" : "dark")}
      >
        <BarIcon d={theme === "dark" ? ICON_SUN : ICON_MOON} />
      </button>
      <WindowButtons waiting={waiting} />
    </>
  );
}

function WindowButtons({ waiting }: { waiting: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const keep = useRef<HTMLButtonElement>(null);
  const closer = useRef<HTMLButtonElement>(null);
  const asked = useRef(false);
  // An alert dialog's question is its description: without it a reader hears "Keep" and not why.
  const question = useId();
  // The confirm takes focus when it opens and gives it back to the close button when Keep or
  // Escape puts it away; otherwise the focused button unmounts and focus falls to the document.
  useEffect(() => {
    if (confirming) keep.current?.focus();
    else if (asked.current) closer.current?.focus();
    asked.current = confirming;
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
          aria-describedby={question}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault(); // handled here: not also a request to rise a level
              setConfirming(false);
            }
          }}
        >
          <span id={question} className="close-confirm__text typo-caption">A decision is waiting. Close anyway?</span>
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
          ref={closer}
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
