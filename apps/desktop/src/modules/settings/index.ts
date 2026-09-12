/** The settings module (README §5 phase P4). */

import type { PanelModule } from "../../lib/module.js";
import { fixtures, type SettingsActions, type SettingsModel } from "./model.js";
import { view } from "./view.js";

export const settingsModule: PanelModule<SettingsModel, SettingsActions> = {
  id: "settings",
  title: "Settings",
  glyph: "⚙",
  fixtures,
  view,
};

export type { SettingsActions, SettingsModel };
export { fixtures };
