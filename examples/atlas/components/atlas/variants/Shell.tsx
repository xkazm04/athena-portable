"use client";

/**
 * THE SHELL — one app, three variants, one model underneath all of them.
 *
 * ROUND 5 ASKS A QUESTION ROUNDS 1–4 COULD NOT: *is the blueprint the right drawing?* The only
 * honest way to ask it is to build the alternatives on the same data, the same nav, the same lens
 * and the same L2 pane, and let a reader switch between them in one keystroke — so that what
 * differs between two variants is the DESIGN and never the model, the level semantics or the
 * plumbing. That is this file's whole job.
 *
 * WHAT THE SHELL OWNS, and a variant therefore never invents:
 *
 *   the nav        `useZoomNav` — three levels, Escape, the group and the item.
 *   the flight     `useLevelFlight` — "a move is in flight", so rule 6's abort is one rule.
 *   the lens       the chosen claim, the three sets it lights, and `nav.highlight`.
 *   the `lit` set  the flat set of ids the lens lights, so a block cannot be lit in one variant
 *                  and dark in another (`highlightIds`, one derivation in `@/data`).
 *   reduced motion resolved once, handed down as a boolean.
 *   the L2 pane    ONE details destination for the whole app (archify study §7.13). A variant
 *                  renders the `pane` node where its stage wants it and reports the screen box the
 *                  open part occupies, so the pane grows out of it (rule 3, rule 11).
 *   the choice     `?variant=`, remembered, and the segmented switcher in the mast.
 *
 * WHAT A VARIANT OWNS: everything inside its stage. Layout, camera, bands, views, legend, story.
 *
 * HOW A SIBLING MOUNTS. Drop a `variants/<slug>/index.tsx` whose default export takes
 * `VariantProps` and — optionally — export `const meta: VariantMeta`. Nothing else: the import is
 * lazy, so a folder that does not exist yet costs nothing, and the boundary below turns a missing
 * module, a throwing module and a module with the wrong shape into the same small honest card
 * rather than a blank screen. The shell is built and shipped before its siblings exist, which is
 * exactly the condition it has to survive.
 *
 * THE BOUNDARY IS A CLASS, and it is the one class component in `examples/`. React has no hook for
 * `componentDidCatch` and a lazy import that throws during render cannot be caught any other way;
 * an error boundary is the sanctioned shape and pretending otherwise would mean a try/catch that
 * does not catch.
 */
import {
  Component,
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { MotionConfig } from "motion/react";
import { useLevelFlight, useZoomNav, type Focus } from "@athena/demo-kit/zoom";

import { COUNTS, componentById, highlightIds, lensFor, type Lens } from "@/data";

import { Mast } from "../Mast";
import { useAtlasMotion } from "../motion";
import { Claims } from "../chrome/Claims";
import { Pane } from "../pane/Pane";
import { AtlasTools } from "../tools/AtlasTools";

import { VARIANTS, type VariantProps, type VariantSlug } from "./contract";
import { useChoice } from "./useChoice";
import { useVariantViews } from "./viewBus";

/* ------------------------------------- mounting a variant ------------------------------------- */

/**
 * THE IMPORT SPECIFIER IS A TEMPLATE, AND THAT IS THE WHOLE TRICK.
 *
 * `import("./archify/index")` with the folder absent is a BUILD error: the bundler resolves a
 * static specifier eagerly and a missing module fails the compile — which would mean the shell
 * could not be built until its siblings were, and the shell is the thing they mount through.
 * A TEMPLATE specifier compiles to a context over every `<slug>/index` under this folder instead,
 * resolved at RUNTIME, so a folder that does not exist yet rejects a promise the boundary below
 * catches and the app keeps running. The moment a sibling writes its `index.tsx`, the context has
 * it, and the shell needs no edit — which is the condition the round is being built under.
 *
 * The cache is mutable so that "try again" can mean it: `lazy()` remembers a rejection for the
 * life of the component, so retrying a variant that has since appeared needs a NEW lazy.
 */
const load = (slug: VariantSlug): Promise<{ default: ComponentType<VariantProps> }> =>
  import(`./${slug}/index`) as Promise<{ default: ComponentType<VariantProps> }>;

type Mounts = Record<VariantSlug, ComponentType<VariantProps>>;

/**
 * The three lazies, created OUTSIDE a render.
 *
 * `lazy()` makes a new component type, and a component type made during a render is a new type
 * every render — React would unmount and remount the whole variant on every keystroke. So they are
 * made once here, kept in state, and "try again" replaces exactly one of them from an event
 * handler, which is the only other place a component may be created.
 */
function makeMounts(): Mounts {
  const out = {} as Mounts;
  for (const v of VARIANTS) out[v.slug] = lazy(() => load(v.slug));
  return out;
}

function Placeholder({
  slug,
  why,
  retry,
}: {
  slug: VariantSlug;
  why: string;
  retry?: () => void;
}) {
  const meta = VARIANTS.find((v) => v.slug === slug);
  return (
    <div className="at-missing" role="status">
      <p className="at-missing-head">
        <b>{meta?.label ?? slug}</b> &mdash; not built yet
      </p>
      <p className="at-label">{meta?.blurb}</p>
      <p className="at-cite">
        <span>
          components/atlas/variants/{slug}/index.tsx &mdash; {why}
        </span>
      </p>
      {retry ? (
        <button type="button" className="at-missing-retry" onClick={retry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

class VariantBoundary extends Component<
  { slug: VariantSlug; retry: () => void; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidUpdate(prev: { slug: VariantSlug }) {
    /* A reader switching away from a variant that threw must not be stuck looking at its card. */
    if (prev.slug !== this.props.slug && this.state.failed) this.setState({ failed: false });
  }

  render() {
    if (this.state.failed) {
      return (
        <Placeholder
          slug={this.props.slug}
          why="the module is missing, or it threw while loading"
          retry={this.props.retry}
        />
      );
    }
    return this.props.children;
  }
}

/* -------------------------------------------- the shell -------------------------------------------- */

const SLUGS = VARIANTS.map((v) => v.slug);

export function Shell() {
  const nav = useZoomNav();
  const m = useAtlasMotion();
  /* The flight is handed to each variant, which gives it to its own semantic zoom if it has one —
     so "a move is in flight" is one fact about the app, true for a wheel exactly as for a click. */
  const flight = useLevelFlight(nav, { fallbackToken: "--at-dur-move" });

  const [variant, setVariant] = useChoice<VariantSlug>({
    param: "variant",
    storage: "atlas:variant",
    values: SLUGS,
    fallback: "blueprint",
  });

  /* ------------------------------------- the lens ------------------------------------- */

  const [lensId, setLensId] = useState<string | null>(null);
  const lens: Lens = useMemo(() => lensFor(lensId), [lensId]);
  const lit = useMemo<ReadonlySet<string>>(() => new Set(highlightIds(lens)), [lens]);
  const setLens = useCallback((id: string | null) => {
    setLensId((current) => (current === id ? null : id));
  }, []);
  /* The variant hands back a `Lens | null`, so `onLens` takes the same shape the contract does. */
  const onLens = useCallback((next: Lens | null) => setLens(next?.concept?.id ?? null), [setLens]);

  /* `nav.highlight` is rebuilt on every nav state change, so it is read through a ref: this effect
     must run when the LENS changes and not when the nav does. (KIT-GAPS round 2 #6, still open.) */
  const highlight = useRef(nav.highlight);
  useEffect(() => {
    highlight.current = nav.highlight;
  });
  useEffect(() => {
    highlight.current(highlightIds(lensFor(lensId)));
  }, [lensId]);

  /* ------------------------------------- the views ------------------------------------- */

  const views = useVariantViews();
  const [mounts, setMounts] = useState<Mounts>(makeMounts);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setMounts((prev) => ({ ...prev, [variant]: lazy(() => load(variant)) }));
    setAttempt((n) => n + 1);
  }, [variant]);

  /* `VariantMeta.views` — the STATIC half of the second axis, read straight off the module so the
     tool's enum is right even before the variant has rendered once. The live half is the bus. */
  const [metaViews, setMetaViews] = useState<{ slug: VariantSlug; views: readonly string[] }>({
    slug: variant,
    views: [],
  });
  useEffect(() => {
    let live = true;
    load(variant)
      .then((mod) => {
        const asked = (mod as { meta?: { views?: readonly string[] } }).meta?.views;
        if (live) setMetaViews({ slug: variant, views: Array.isArray(asked) ? asked : [] });
      })
      .catch(() => {
        if (live) setMetaViews({ slug: variant, views: [] });
      });
    return () => {
      live = false;
    };
  }, [variant, attempt]);
  /* Derived, never cleared in an effect: a stale answer is one whose slug is not the current one. */
  const toolViews = metaViews.slug === variant ? metaViews.views : [];

  /* -------------------------------------- the pane -------------------------------------- */

  const focus: Focus = nav.state.focus;
  const open = componentById(focus.item);

  /**
   * Where the open part is on screen, so the pane can rise out of it.
   *
   * The variant reports the box through `reportOrigin` — a ref write from an event, never state,
   * because turning a measurement into `setState` inside an effect is the cascading-render shape
   * the compiler correctly refuses. A variant that reports nothing still gets an honest grow: the
   * fallback asks the DOM for `[data-component]`, which every variant marks its parts with.
   */
  const originBox = useRef<DOMRect | null>(null);
  const reportOrigin = useCallback((rect: DOMRect | null) => {
    originBox.current = rect;
  }, []);
  const measureOrigin = useCallback((): { x: number; y: number } | null => {
    const reported = originBox.current;
    if (reported && (reported.width > 0 || reported.height > 0)) {
      return { x: reported.left + reported.width / 2, y: reported.top + reported.height / 2 };
    }
    const id = nav.state.focus.item;
    if (!id) return null;
    const el = document.querySelector<HTMLElement>(`[data-component="${id}"]`);
    if (!el) return null;
    const box = el.getBoundingClientRect();
    if (box.width === 0 && box.height === 0) return null;
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  }, [nav]);

  const pane = open ? (
    <Pane component={open} nav={nav} lens={lens} setLens={setLens} origin={measureOrigin} />
  ) : null;

  /* ------------------------------------- the mount ------------------------------------- */

  const Variant = mounts[variant];
  const props: VariantProps = {
    nav,
    flight,
    focus,
    level: focus.level,
    lens: lens.concept ? lens : null,
    lit,
    onLens,
    reduced: m.reduced,
    pane,
    reportOrigin,
  };

  return (
    <MotionConfig reducedMotion="user">
      <AtlasTools
        nav={nav}
        lens={lens}
        lensId={lensId}
        setLens={setLens}
        variant={variant}
        setVariant={setVariant}
        metaViews={toolViews}
      />
      <div
        className="at-app"
        data-level={focus.level}
        data-atlas-variant={variant}
        data-atlas-view={views.current ?? undefined}
        data-reduced={m.reduced ? "" : undefined}
      >
        <Mast
          nav={nav}
          lens={lens}
          setLens={setLens}
          counts={COUNTS}
          variant={variant}
          setVariant={setVariant}
          views={views}
        />

        <div className="at-body">
          <Claims lens={lens} setLens={setLens} />

          <main className="at-stage">
            <VariantBoundary key={`${variant}:${attempt}`} slug={variant} retry={retry}>
              <Suspense fallback={<Placeholder slug={variant} why="loading" />}>
                <Variant {...props} />
              </Suspense>
            </VariantBoundary>
          </main>
        </div>
      </div>
    </MotionConfig>
  );
}
