"use client";

/**
 * The level rail and the filters, on one row.
 *
 * `bd-toolbar`, not `bd-bar`. A criterion bar inside a carousel card is also a
 * `.bd-bar`, and its `display: grid` won the cascade — so this row had been a
 * two-row grid at every width since the rework, costing fifty pixels of the
 * board and separating the level rail from the filters it belongs beside.
 */
import type { BdBoard } from "../model";

const LEVELS = ["The board", "One group", "One candidate"] as const;

export function BoardToolbar({
  board,
  level,
  totals,
  roleFilter,
  setRoleFilter,
  onlyBorderline,
  setOnlyBorderline,
  nav,
}: {
  board: BdBoard;
  level: number;
  totals: { roles: number; applicants: number; scored: number; borderline: number };
  roleFilter: string;
  setRoleFilter: (next: string) => void;
  onlyBorderline: boolean;
  setOnlyBorderline: (next: boolean | ((v: boolean) => boolean)) => void;
  nav: { home: () => void; up: () => void };
}) {
  return (
    <div className="bd-toolbar">
      <div className="bd-rail" role="group" aria-label="Zoom level">
        {LEVELS.map((name, index) => (
          <button
            key={name}
            type="button"
            className="bd-rung"
            data-on={index <= level}
            data-here={index === level}
            disabled={index >= level}
            onClick={() => (index === 0 ? nav.home() : nav.up())}
          >
            <span className="bd-fig">{["I", "II", "III"][index]}</span>
            <span>{name}</span>
          </button>
        ))}
      </div>
      <div className="bd-tools">
        <div className="bd-roles" role="group" aria-label="Which role">
          <button
            type="button"
            aria-pressed={roleFilter === "all"}
            onClick={() => setRoleFilter("all")}
          >
            Both roles
          </button>
          {board.roles.map((r) => (
            <button
              key={r.id}
              type="button"
              aria-pressed={roleFilter === r.id}
              onClick={() => setRoleFilter(r.id)}
            >
              {r.title}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="bd-chip"
          aria-pressed={onlyBorderline}
          onClick={() => setOnlyBorderline((v) => !v)}
        >
          {onlyBorderline ? "Showing the arguable" : "Only the arguable"}
        </button>
        <span className="bd-count">
          <span className="bd-fig">{totals.scored}</span> of{" "}
          <span className="bd-fig">{totals.applicants}</span> scored ·{" "}
          <span className="bd-fig">{totals.borderline}</span> arguable
        </span>
      </div>
    </div>
  );
}
