/**
 * THE SHARED LANES DRAWING — three variants, one engine.
 *
 * Round 6 left one geometry (four lanes, six columns, twelve nodes). Round 7 mounts it three
 * times with different finishes. The engine lives next to the classic variant because that is
 * the drawing that won; Signal and Editorial import THIS module, never the sibling folder, so
 * the contract's "a variant never imports from a sibling" still holds.
 */
export { default as LanesDrawing } from "./variants/archify-lanes/Drawing";
export { VIEWS, type LanesPreset } from "./variants/archify-lanes/copy";
