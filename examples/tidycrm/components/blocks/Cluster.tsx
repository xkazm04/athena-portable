"use client";

/**
 * One block's records, in the arrangement the cube left them in.
 *
 * The sub-grid side is `ceil(sqrt(n))` and the fill is row-major, which is what
 * `positionsOf` in the scene uses — the two have to agree or the hand-off is a
 * jump. The vertical order is flipped because the scene's y grows upward and
 * SVG's grows down.
 *
 * Dot centres span the FULL viewBox here, and in the scene they span
 * `cellWidth * CLUSTER_FILL`. That is deliberate: it makes the ratio between
 * the two drawings independent of how many records a block has, so one scale
 * factor lands every cluster at once.
 *
 * It lives on its own because three levels draw it — the cell, the dossier's
 * head, and the canvas it was handed from.
 */
import type { RecordMark } from "./model";

export function Cluster({ marks }: { marks: RecordMark[] }) {
  const n = Math.max(1, marks.length);
  const side = Math.max(1, Math.ceil(Math.sqrt(n)));
  const step = 100 / side;
  const r = step * 0.26;

  return (
    <svg className="bk-cluster" viewBox="0 0 100 100" aria-hidden focusable="false">
      {marks.map((mark, i) => {
        const ix = i % side;
        const iy = Math.floor(i / side);
        return (
          <circle
            key={i}
            className="bk-cluster-dot"
            data-mark={mark}
            cx={((ix + 0.5) * step).toFixed(2)}
            cy={(100 - (iy + 0.5) * step).toFixed(2)}
            r={r.toFixed(2)}
          />
        );
      })}
    </svg>
  );
}
