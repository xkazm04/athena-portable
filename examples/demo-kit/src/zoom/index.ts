/**
 * `@athena/demo-kit/zoom` — the three-level navigation model, for directions
 * that are 2D first.
 *
 *   L0  the whole population — one glance, "where is the trouble"
 *   L1  one group — the working set, spread so its members compare
 *   L2  one item — the thing you act on, with the evidence and the buttons
 *
 * The model already existed for the WebGL worlds and lives in `../three/nav`. It
 * is pure React with no `three` import, but the only path to it was the
 * `@athena/demo-kit/three` barrel, which does pull `three` and
 * `@react-three/fiber` in behind it. A direction whose L0 is a DOM swimlane or a
 * DOM kanban would have paid for a renderer it never mounts, and would therefore
 * have forked its own reducer — after which "open a group" means something
 * slightly different in every app, which is the one thing the round has to hold
 * still.
 *
 * This entry point is that model and nothing else. No chrome and no stylesheet:
 * the level rail, the breadcrumb and the back affordance are where a direction
 * earns its identity, so each one draws its own and they agree only about state.
 */
export { escapeLeavesLevel, MODAL_SELECTOR, type EscapeEvent } from "./escape";
export {
  emphasis,
  HOME,
  initialNavState,
  navReducer,
  nodeId,
  useStaticNav,
  useWorldNav as useZoomNav,
  type Focus,
  type Level,
  type Nav as ZoomNav,
  type NavAction,
  type NavState,
} from "./nav";
