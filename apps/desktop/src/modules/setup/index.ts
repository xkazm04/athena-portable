/** The setup module (README §5 phase P4, act 1). */

import type { PanelModule } from "../../lib/module.js";
import { fixtures, type SetupActions, type SetupModel } from "./model.js";
import { view } from "./view.js";

export const setupModule: PanelModule<SetupModel, SetupActions> = {
  id: "setup",
  title: "Setup",
  glyph: "◎",
  fixtures,
  view,
};

export type { SetupActions, SetupModel };
export { fixtures };
