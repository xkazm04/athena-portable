/**
 * The contract of a depth scene — README section 3.5, ADR 0087 and 0090.
 *
 * A depth scene is a module's contract (model, fixtures, a pure view, an index that knows the
 * stores) with one difference: it is told where in its depth the person is, and how to move. The
 * view is a pure function of `{ model, path, go }`, so the preview harness renders it at any
 * depth with a fixture and nothing else, and a test can drive it.
 *
 * `Live` reads the stores and builds the model with the module's own hook (the selector and the
 * actions are shared with the module's old view, never copied). `preview` takes no store at all.
 * Names for the breadcrumb (an app's host, a chore's title) come from `useLabeller` live and
 * `previewLabeller` for a fixture; both answer `undefined` for a place they do not name, and the
 * stage falls back to the id.
 */
import type { ReactElement } from "react";

import type { Labeller, Path, Root } from "@/depth/model";
import type { FixtureId } from "@/modules/types";

export interface SceneProps {
  /** Where the person is: always under this scene's root. */
  path: Path;
  /** Move to a place. Invalid places are ignored by the reducer, so a scene may offer any link. */
  go: (to: Path) => void;
}

export interface DepthScene {
  root: Root;
  fixtureIds: readonly FixtureId[];
  /** The live scene: stores in, a model out, a view drawn. Starts no store. */
  Live: (props: SceneProps) => ReactElement;
  /** The same view against a fixture, with no store, no IPC and no daemon. */
  preview: (fixture: FixtureId, props: SceneProps) => ReactElement;
  /** A hook: crumb names from the stores. Called on every render of the console, in a fixed order. */
  useLabeller?: () => Labeller;
  /** Crumb names for a fixture. */
  previewLabeller?: (fixture: FixtureId) => Labeller;
  /**
   * The second row of the band in the page shape (the tab strip, the address field), when the
   * scene owns one. Only Apps has a page.
   */
  Band?: () => ReactElement;
}
