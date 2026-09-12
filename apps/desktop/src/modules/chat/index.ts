/** The chat module: the run loop's surface (README §5 phase P5). */

import type { PanelModule } from "../../lib/module.js";
import { fixtures, type ChatActions, type ChatModel } from "./model.js";
import { view } from "./view.js";

export const chatModule: PanelModule<ChatModel, ChatActions> = {
  id: "chat",
  title: "Athena",
  glyph: "◆",
  fixtures,
  view,
};

export type { ChatActions, ChatModel };
export { fixtures };
