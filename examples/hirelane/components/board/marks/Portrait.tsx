"use client";

/**
 * A drawn mark, in SVG, from an id.
 *
 * This file only draws. What to draw is decided in `recipe.ts`, in one pass,
 * as plain data — see its header for why that separation is load-bearing
 * rather than tidy.
 */

import { describe, hasPortrait, type Layer } from "./recipe";

export { hasPortrait };

function Shape({ layer, index }: { layer: Layer; index: number }) {
  switch (layer.kind) {
    case "disc":
      return <circle cx={layer.cx} cy={layer.cy} r={layer.r} fill={layer.colour} opacity={0.9} />;
    case "ring":
      return (
        <circle
          cx={layer.cx}
          cy={layer.cy}
          r={layer.r}
          fill="none"
          stroke={layer.colour}
          strokeWidth={layer.width}
          opacity={0.85}
        />
      );
    case "band":
      return (
        <rect
          x={-20}
          y={50 - layer.height / 2 + layer.y}
          width={140}
          height={layer.height}
          fill={layer.colour}
          opacity={0.75}
          transform={`rotate(${layer.angle} 50 50)`}
        />
      );
    case "dots":
      return (
        <g>
          {layer.points.map((p, i) => (
            <circle key={`${index}-${i}`} cx={p.x} cy={p.y} r={p.r} fill={layer.colour} opacity={0.9} />
          ))}
        </g>
      );
  }
}

export function Portrait({ id, initials }: { id: string; initials: string }) {
  const mark = describe(id);
  const clip = `portrait-${id}`;

  return (
    <svg viewBox="0 0 100 100" role="img" focusable="false">
      <title>{initials}</title>
      <g transform={`rotate(${mark.rotation} 50 50)`}>
        {mark.roundGround ? (
          <circle cx={50} cy={50} r={48} fill={mark.ground} opacity={0.5} />
        ) : (
          <rect x={4} y={4} width={92} height={92} rx={18} fill={mark.ground} opacity={0.5} />
        )}
      </g>
      <clipPath id={clip}>
        {mark.roundGround ? (
          <circle cx={50} cy={50} r={48} />
        ) : (
          <rect x={4} y={4} width={92} height={92} rx={18} />
        )}
      </clipPath>
      <g clipPath={`url(#${clip})`}>
        {mark.layers.map((layer, i) => (
          <Shape key={i} layer={layer} index={i} />
        ))}
      </g>
    </svg>
  );
}
