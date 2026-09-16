"use client";

/**
 * WHICH ARRANGEMENT IS ON THE SHEET — `?view=`, remembered, and shareable.
 *
 * Four rounds of the formula carried "URL sync (still nowhere)" as an open item. It landed in
 * round 4 in the smallest honest form — the view in the query string, so a link to the trust view
 * is a link to the trust view — and round 5 keeps it and moves the machinery one level up, to
 * `variants/useChoice.ts`, because the shell needs exactly the same hook for `?variant=`.
 *
 * WHICH IS THE POINT, AND THE MEASUREMENT. Round 3's kit gap 4 named `useChoice(key, param,
 * values)` as a hook that "exists in three copies"; round 4's copy of it was the fourth; the shell
 * needed a fifth and instead generalised the fourth. So the app now has ONE, the kit still has
 * none, and the gap is logged for the third round running — the difference being that the count of
 * copies is now one instead of five, which is what an app can do about a missing primitive without
 * pretending it is not missing.
 */
import { useChoice } from "../useChoice";
import { VIEWS, type ViewId } from "./plan";

export function useView(): [ViewId, (next: ViewId) => void] {
  return useChoice<ViewId>({
    param: "view",
    storage: "atlas:view",
    values: VIEWS,
    fallback: "layers",
  });
}

export { VIEWS };
