/**
 * The module contract — plan §10 ("module directory"), README section 3.5, ADR 0087 and 0090.
 *
 * A module is a directory that owns a capability's behaviour and nothing about anything else:
 *
 * ```
 * src/modules/<name>/
 *   model.ts      the one view-model type, and a pure selector that builds it from the stores
 *   fixtures.ts   view-models for preview: at minimum `empty`, `typical`, `heavy`, `degraded`
 *   index.ts      the hook that subscribes to the stores and returns the model
 * ```
 *
 * The module is not drawn here. A depth scene (`src/scenes/<depth>/`) draws it, and its view is a
 * pure function of the view-model: it fetches nothing, subscribes to nothing and imports no store,
 * which is what lets `preview.html?scene=&fixture=&theme=` render it in a plain browser with no
 * Tauri, and what makes several people editing one depth a survivable arrangement.
 *
 * Callbacks are part of the view-model, not an exception to that rule. A surface that cannot act
 * is not the surface being designed, so every model carries an `actions` object: the selector
 * wires it to the stores and a fixture wires it to nothing. A view calls an action and never
 * reaches past it.
 *
 * `ModuleEntry` is the erased face of the two scenes that are not depths (the surface and the
 * first act): the one shape the console and the harness can hold without knowing every view-model
 * type. A depth scene is a `DepthScene` (`src/scenes/types.ts`).
 */
import type { ReactElement } from "react";

/** What a scene's `view.tsx` default-exports. */
export type View<M> = (props: { model: M }) => ReactElement;

/**
 * The four every module ships, plus any others it finds worth having.
 *
 * `degraded` means what it means in *this* app and never "some fields are empty": the daemon
 * offline, a route answering 501, an origin that is not enabled, a page with no bridge, a shell
 * that has not answered. Every surface can be asked to render in that state, so every surface has
 * to answer.
 */
export type FixtureId = "empty" | "typical" | "heavy" | "degraded" | (string & {});

export interface ModuleEntry {
  id: string;
  /** What the harness calls it. */
  label: string;
  /** One line: what this module is for. Shown in the harness, not in the app. */
  blurb: string;
  /** The fixtures this module ships, in the order the harness offers them. */
  fixtureIds: readonly FixtureId[];
  /**
   * Render this module against one fixture. No store, no IPC, no daemon — the whole of what the
   * preview harness calls.
   */
  preview: (fixture: FixtureId) => ReactElement;
  /** The live module: subscribes to the stores, builds the view-model, renders the view. */
  Live: () => ReactElement;
}
