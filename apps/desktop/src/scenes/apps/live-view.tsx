/**
 * The Apps depth's lazy chunk in the running app — README section 3.5, ADR 0089 and 0225.
 *
 * The view, with the one source the first frame does not carry: the person's Projects, for an
 * app's "In projects" and "Add to project" (the spaces store's list, and `update` with the whole
 * new set of origins, as the daemon's patch takes it). `live.tsx` draws in the first frame with the
 * crumbs and the band, and the spaces store is not first-frame weight (`stores/spaces-glance.ts`),
 * so the store is read here, where the depth has already been entered.
 */
import { useMemo } from "react";

import { useSpaces } from "@/stores/spaces";

import type { AppSpaces } from "./model";
import AppsView, { type AppsViewProps } from "./view";

export default function LiveAppsView({ model, path, go }: AppsViewProps) {
  const list = useSpaces((s) => s.spaces);
  const update = useSpaces((s) => s.update);
  const spaces = useMemo<AppSpaces>(
    () => ({
      list,
      addApp: async (spaceId, origin) => {
        const space = list.find((s) => s.id === spaceId);
        if (!space || space.apps.includes(origin)) return;
        await update(spaceId, { apps: [...space.apps, origin] });
      },
    }),
    [list, update],
  );
  const joined = useMemo(() => ({ ...model, spaces }), [model, spaces]);
  return <AppsView model={joined} path={path} go={go} />;
}
