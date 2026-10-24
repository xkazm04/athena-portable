/**
 * The preview harness — README section 3.5, "no automation seam for the panel"; ADR 0087.
 *
 * Renders **any scene, any fixture, either theme** in a plain browser:
 *
 * ```
 * pnpm --filter athena-desktop dev
 * http://127.0.0.1:1431/preview.html?scene=apps&fixture=heavy&theme=light
 * http://127.0.0.1:1431/preview.html?scene=mind&at=%23/mind/look&picker=1
 * ```
 *
 * `scene` is the surface, the first act or any of the five depths (see `console/preview.tsx`), or
 * `stage`, `bell` or `console` for the pieces they are built from and the whole thing on the live
 * stores, or `avatar` for her face driven by a scripted signal (`avatar/preview.tsx`, ADR 0120);
 * `?surface=athena` is her own window. No Tauri, no IPC, no daemon — that is the point, not
 * a limitation. Only one shell can run at a time (a WebView2 profile belongs to one process), so
 * this is how a surface is checked against every fixture in both themes while somebody else has the
 * window. It works for one reason: a view is a pure function of its view-model and a fixture is a
 * view-model with inert actions, so there is nothing here to stub. If a view ever needs a stub, the
 * view is wrong.
 *
 * `&skin=loop-tide` paints any of them in a skin (ADR 0142); the default is her own teal.
 *
 * `?picker=1` draws a bar to change the scene, the fixture and the theme; the default is no bar,
 * which is the shape a screenshot of a design and the performance gate are taken in.
 */
import ReactDOM from "react-dom/client";

import AvatarPreview from "@/avatar/preview";
import BellPreview from "@/bell/preview";
import AthenaPreview from "@/companion/preview";
import { ScenePreview, isSceneName } from "@/console/preview";
import ConsoleRoot from "@/console/root";
import StagePreview from "@/stage/preview";
import { DEFAULT_SKIN, applySkin, isSkin, useShell } from "@/stores/shell";

import "@/styles/app.css";
import "@/companion/companion.css";
import "@/styles/skins/loop-tide.css";

const params = new URLSearchParams(window.location.search);
const surface = params.get("surface");
const scene = params.get("scene") ?? "surface";
const skinParam = params.get("skin");
const skin = isSkin(skinParam) ? skinParam : DEFAULT_SKIN;
applySkin(skin);
useShell.setState({ skin });

function Preview() {
  if (surface === "athena") return <AthenaPreview />;
  if (scene === "console") return <ConsoleRoot />;
  if (scene === "stage") return <StagePreview />;
  if (scene === "bell") return <BellPreview />;
  if (scene === "avatar") return <AvatarPreview />;
  // An unknown name is the surface, so no query can blank the page.
  return <ScenePreview name={isSceneName(scene) ? scene : "surface"} />;
}

// No `StrictMode` here, deliberately: the harness exists to look at a render, and a
// double-invoked render of a pure component is noise in a screenshot rather than a signal.
ReactDOM.createRoot(document.getElementById("root")!).render(<Preview />);
