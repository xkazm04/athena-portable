"use client";

/**
 * The Blocks — the whole sheet, and the only stateful component in the
 * direction.
 *
 * It owns the level, through the kit's shared L0/L1/L2 model, so "open a group"
 * means here exactly what it means everywhere else in this repo. Everything else
 * is a pure child handed props.
 *
 * There is no `motion` in this direction, deliberately. the `law` direction set the motion
 * signature for this app — the pencil draws, as `stroke-dashoffset` running to
 * zero on inline SVG — and a spring-based shared-layout morph would be a second
 * grammar sitting on top of it. The level change here is a redraw: the box edges
 * lay themselves down, and everything else is press feedback.
 */
import { useState } from "react";
import { useZoomNav } from "@athena/demo-kit/zoom";

import { Cube3D } from "./Cube3D";
import { Dossier } from "./Dossier";
import { Field } from "./Field";
import { BlocksTools } from "./tools";
import { useArrival } from "./useArrival";
import { SheetFoot } from "./sheet/Foot";
import { SheetHead } from "./sheet/Head";
import { tableOf, zoneOf, type BkSheet } from "./model";
import "./style/index.css";

export function Blocks({ sheet }: { sheet: BkSheet }) {
  const nav = useZoomNav();
  // The plate is the only thing on screen at L0, so the sheet head carries the
  // frontier. Keeping it open is the reader's choice, not a default.
  const [showKinds, setShowKinds] = useState(false);

  const { opening, phase, openFromPlate, openZone, flattened } = useArrival(nav);

  const level = nav.state.focus.level;
  const zone = zoneOf(sheet, nav.state.focus.group);
  const table = tableOf(sheet, nav.state.focus.item);

  return (
    <div className="bk-root" data-variant="blocks" data-level={level}>
      {/* The ingest layer: this direction's three levels, offered to an agent
          beside the page on `document.modelContext`. It opens a zone through
          `openFromPlate`, the same path a click on a quadrant takes, so the
          cube actually flattens rather than the level being swapped under it.
          Renders nothing, and no tool it registers writes. */}
      <BlocksTools
        sheet={sheet}
        nav={nav}
        onOpenZone={openFromPlate}
        showKinds={showKinds}
        setShowKinds={setShowKinds}
      />

      <div className="bk-sheet">
        <SheetHead sheet={sheet} />


        {/*
          * Both can be mounted at once, stacked in one cell. That overlap is
          * the transition: the cube is still there, flattened, while the cells
          * arrive on top of it wearing its geometry.
          */}
        <div className="bk-stage">
          {level === 0 || opening ? (
            <div className="bk-cube-hold" data-out={level >= 1} aria-hidden={level >= 1}>
              <Cube3D
                sheet={sheet}
                opening={opening}
                onOpen={openFromPlate}
                onFlattened={flattened}
              />
            </div>
          ) : null}

          {level >= 1 && zone ? (
            <Field
              sheet={sheet}
              zone={zone}
              phase={phase}
              onOpenTable={(ident) => nav.openItem(zone.id, ident)}
              onOpenZone={openZone}
            />
          ) : null}
        </div>

        <SheetFoot sheet={sheet} zone={zone} table={table} level={level} showKinds={showKinds} nav={nav} />
      </div>

      {/* Keyed by the block, so a change of block is a new card and not the same
          card holding a different block. The dossier carries two pieces of
          state a reader armed against what was in front of them — the armed
          act and the pair being adjudicated — and an agent may call open_item
          while it is mounted. Unkeyed, the armed merge or delete survives the
          swap and points at a block nobody armed it for, with no undo behind
          it. */}
      {level === 2 && table ? (
        <Dossier key={table.ident} table={table} onClose={nav.up} />
      ) : null}
    </div>
  );
}
