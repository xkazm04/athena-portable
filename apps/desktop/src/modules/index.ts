/**
 * Every module the panel bar offers, in the order it shows them (README §3.5).
 *
 * The list is here and nowhere else: `app.ts` renders the bar from it and `preview.ts` resolves
 * `?module=` against it, so a module that exists is a module both can reach and a module missing
 * from the preview is impossible rather than merely unlikely.
 */

import type { PanelModule } from "../lib/module.js";
import { browserModule } from "./browser/index.js";
import { chatModule } from "./chat/index.js";
import { settingsModule } from "./settings/index.js";
import { setupModule } from "./setup/index.js";

export const MODULES = [chatModule, browserModule, setupModule, settingsModule] as const;

export type AnyModule = PanelModule<never, never>;

/** The registry as the preview reads it: id → module, types erased. */
export const REGISTRY: readonly AnyModule[] = MODULES as readonly unknown[] as readonly AnyModule[];

export { browserModule, chatModule, settingsModule, setupModule };
