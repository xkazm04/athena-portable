/**
 * The Shadowrunr console in a real Chromium, with Athena's bridge in it — README section 3.4
 * tier 1. The mechanics are app-agnostic and live in `../../support/webmcp-page.ts`; what is
 * Shadowrunr's here is the URL (`?daemon=`) and the console's opt-in,
 * `localStorage["shadowrunr.athena.drive"] = "1"` (apps/console/src/kit/athenaDrive.ts), set
 * before the console's scripts run so the catalog registers on first load.
 */
import type { Browser } from "playwright-core";

import { openAppPage, type AppPage } from "../../support/webmcp-page";

export { INJECT_PATH, launchBrowser, type CallAnswer, type ListAnswer, type PageIdentity } from "../../support/webmcp-page";

export const DRIVE_KEY = "shadowrunr.athena.drive";

/** The console's page: the generic one, opened with `?daemon=`. */
export type ConsolePage = AppPage;

/** Open the console at `origin` against the daemon at `daemonUrl`, with the bridge installed. */
export async function openConsole(browser: Browser, origin: string, daemonUrl: string): Promise<ConsolePage> {
  return openAppPage(browser, `${origin}/?daemon=${encodeURIComponent(daemonUrl)}`, { storage: { [DRIVE_KEY]: "1" } });
}
