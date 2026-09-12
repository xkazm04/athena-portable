/**
 * What a panel module is (README §3.5: "module-first window from the start").
 *
 * The first build put seven surfaces in a 380 px column and they grew into each other, because
 * nothing said what a surface *was*. Here a module is three things and no more:
 *
 * - a **view-model**: a plain object, everything the view needs and nothing it has to fetch;
 * - **fixtures**: named view-models covering the states worth looking at, including the empty one
 *   and the failing one;
 * - a **pure view**: `(model, actions) => HTMLElement`, no I/O, no store, no clock.
 *
 * The payoff is the automation seam the first build did not have. `preview.html?module=&fixture=`
 * renders any module in any of its states in a plain browser tab with no Tauri, no daemon and no
 * network — so a module can be looked at, and a fixture is a bug report anyone can reproduce.
 *
 * Actions are a separate argument rather than methods on the model, so a fixture is data. A
 * fixture that had to carry callbacks would be a fixture nobody writes by hand.
 */

export interface PanelModule<TModel, TActions = Record<string, never>> {
  /** The id in the module bar and in `preview.html?module=`. */
  readonly id: string;
  /** What the bar shows a person. */
  readonly title: string;
  /** One glyph for the bar; the column is too narrow for a word per module. */
  readonly glyph: string;
  /** Named states worth looking at. Every module has at least `empty`. */
  readonly fixtures: Readonly<Record<string, TModel>>;
  /** Pure: a model in, an element out. */
  view(model: TModel, actions: TActions): HTMLElement;
}

/** The no-op actions a preview hands a view, so a fixture needs no wiring to render. */
export function inertActions<TActions>(): TActions {
  return new Proxy(
    {},
    {
      get: () => () => undefined,
    },
  ) as TActions;
}

/** Find a module by id among those registered, or fail by name rather than by `undefined`. */
export function moduleById(
  modules: readonly PanelModule<never, never>[],
  id: string,
): PanelModule<never, never> {
  const found = modules.find((module) => module.id === id);
  if (!found) {
    throw new Error(`unknown module ${id}; registered: ${modules.map((m) => m.id).join(", ")}`);
  }
  return found;
}
