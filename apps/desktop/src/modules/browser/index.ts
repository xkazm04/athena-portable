/** The browser module (README §5 phase P4). */

import type { PanelModule } from "../../lib/module.js";
import { fixtures, type BrowserActions, type BrowserModel } from "./model.js";
import { view } from "./view.js";

export const browserModule: PanelModule<BrowserModel, BrowserActions> = {
  id: "browser",
  title: "Pages",
  glyph: "▤",
  fixtures,
  view,
};

export type { BrowserActions, BrowserModel };
export { fixtures };
