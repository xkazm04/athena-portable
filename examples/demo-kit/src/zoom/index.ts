/**
 * `@athena/demo-kit/zoom` — the three-level navigation model, and the layered-UI formula's
 * primitives, for directions that are 2D first.
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
 * still. NOTHING HERE MAY IMPORT `three`.
 *
 * No chrome and no stylesheet: the level rail, the breadcrumb and the back affordance are where
 * a direction earns its identity, so each one draws its own and they agree only about state.
 *
 * WHAT THE CONSOLIDATION ROUND ADDED, and why. Round 1 built the same five things in three apps
 * (`docs/layered-ui-formula.md` §2, "Wanted shared"): a level-flight derivation, a presence
 * mapper, a one-claimant `layoutId` helper, a token reader, and an overlay's Escape-and-focus
 * return — plus the half of the Escape rule the kit did not have, "a move to level N is in
 * flight and may be abandoned". They are here now, each with the round-1 evidence in its own
 * file, so a fourth app starts on the formula rather than rediscovering it.
 *
 * Every rule that can be wrong is a pure module with a `node --test` file beside it; the hooks
 * are thin.
 */

/* The model: state, actions, reducer — and the hook that owns the Escape key. */
export { escapeAbortsFlight, escapeLeavesLevel, MODAL_SELECTOR, type EscapeEvent } from "./escape";
export {
  HOME,
  initialNavState,
  navReducer,
  nodeId,
  sameFocus,
  type Focus,
  type Level,
  type NavAction,
  type NavState,
} from "./state";
export { useStaticNav, useWorldNav as useZoomNav, type Nav as ZoomNav } from "./nav";

/* Rule 1 + 6: a level change is a move you can follow, and abandon. */
export {
  ARMING_FLIGHT,
  FLIGHT_FALLBACK_MS,
  advanceFlight,
  initialFlight,
  isMoving,
  settleFlight,
  type FlightState,
} from "./flight";
export {
  useLevelFlight,
  type FlightNav,
  type LevelFlight,
  type LevelFlightOptions,
} from "./useLevelFlight";

/* Rule 7: presence comes from the model, and so does what it looks like. */
export {
  PRESENCE_DEPTH,
  emphasis,
  presenceOf,
  presenceStyle,
  type Presence,
  type PresenceOpacity,
  type PresenceOptions,
} from "./presence";

/* Rule 2: one claimant per shared id, and the id must exist at mount. */
export { UNCLAIMED, sharedIdentity, type SharedIdentity } from "./identity";
export { useSharedIdentity } from "./useSharedIdentity";

/* Rule 4: one clock per level change, read out of the cascade. */
export {
  cssEase,
  cssMs,
  parseBezier,
  parseEase,
  parseMs,
  readTokens,
  secs,
  styleOf,
  tokenValue,
  type StyleSource,
  type TokenValue,
} from "./tokens";
export { useTokens } from "./useTokens";

/* Rule 5: an overlay owns its Escape and returns focus to its opener. */
export {
  escapeClosesOverlay,
  focusReturnTarget,
  isOpener,
  type FocusCandidate,
  type FocusPreference,
} from "./overlay";
export {
  useOverlayEscape,
  type OverlayEscape,
  type OverlayEscapeOptions,
} from "./useOverlayEscape";

/* Rule 3 of the round-3 list: focus follows every level change, not only L2. */
export { ROVING_KEYS, isRovingKey, rovingIndex, type RovingKey } from "./roving";
export { useRoving, type Roving, type RovingOptions } from "./useRoving";

/*
 * THE CAMERA, round 3 — `docs/kit-camera-contract.md`.
 *
 * Four numbers and the two ways a surface consumes them. NOTHING BELOW IMPORTS `three`, and it
 * never will: `poseToTransform` is for a DOM stage, and a WebGL stage reads `rig.get()` in its
 * own `useFrame` and moves its own camera. The kit has no renderer, which is the only reason one
 * camera can serve a swimlane, a kanban, a cube and a map.
 */
export {
  FLY_EASE,
  FLY_MS,
  FRAME_MS,
  NEGLIGIBLE,
  ORBIT_SENSITIVITY,
  REST_POSE,
  SNAP_WEIGHTS,
  ZERO_VELOCITY,
  angleDelta,
  clampPose,
  easeFromCss,
  isNegligible,
  lerpPose,
  mergePose,
  nearestSnap,
  orbitDelta,
  panDelta,
  poseDistance,
  poseToTransform,
  samePose,
  stepInertia,
  zoomAt,
  type CameraBounds,
  type CameraFrame,
  type CameraPose,
  type CameraVelocity,
} from "./camera";
export {
  KEY_ORBIT,
  KEY_PAN,
  KEY_ZOOM,
  SNAP_IDLE_MS,
  WHEEL_SENSITIVITY,
  useCameraRig,
  type CameraBind,
  type CameraRig,
  type CameraRigOptions,
} from "./useCameraRig";

/* §3: camera distance is the level. */
export { SEMANTIC_HYSTERESIS, bandProgress, levelForZoom } from "./semantic";
export {
  useSemanticZoom,
  type SemanticNav,
  type SemanticZoom,
  type SemanticZoomOptions,
} from "./useSemanticZoom";

/* §4: the echo container — rule 1, at last, as a primitive rather than thirty lines per app. */
export {
  echoDirection,
  echoKey,
  echoOrigin,
  echoOriginVars,
  echoStages,
  levelChanged,
  type EchoDirection,
  type EchoOriginUnit,
  type RectLike,
} from "./echo-rule";
export { useEcho, type EchoHandle, type EchoOptions, type EchoState } from "./useEcho";
// The <Echo> component lives at "@athena/demo-kit/zoom/echo": a .tsx file in this barrel would
// make every consumer's `node --test` that imports the barrel fail on the JSX.
