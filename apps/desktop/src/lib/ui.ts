/**
 * Which Main UI is on — README section 3.5, ADR 0087.
 *
 * Until the depth console replaces the module bar (the cutover phase of `docs/redesign/fathom.md`)
 * both ship, and the console is opt-in: `VITE_ATHENA_UI=console` at dev or build time
 * (`pnpm tauri:console`), or `athena.ui = console` in the webview's local storage. The cutover
 * deletes this file along with the module bar.
 */
export function isConsoleUi(env: string | undefined, stored: string | null): boolean {
  return env === "console" || stored === "console";
}

/** Read the two sources the running window has. A blocked storage reads as "not chosen". */
export function consoleUiOn(): boolean {
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem("athena.ui");
  } catch {
    /* storage can be blocked; the env flag still works */
  }
  return isConsoleUi(import.meta.env.VITE_ATHENA_UI as string | undefined, stored);
}
