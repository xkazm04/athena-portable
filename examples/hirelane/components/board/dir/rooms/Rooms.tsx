"use client";

/**
 * `rooms` — place-based navigation. The concept: does a place you RETURN to beat
 * a layer that re-mounts?
 *
 * THE PICTURE. The pipeline as a cutaway set seen from above: five rooms in a
 * row, one per stage, their floors pitched back under one `perspective` so you
 * are looking down into them from the front. Each room's floor holds its open
 * roles as tables, and each table has that role's candidates seated around it as
 * monogram tokens — the strongest at the head, facing you, the rest clockwise.
 * A room that nobody is standing in is still drawn, still lit, still where it
 * was: the whole claim under test is that the reader can SEE where they are
 * about to go and where they have just been.
 *
 * THE MOVE. Opening a group is the camera going down and into that room —
 * `flyTo` the table, one move, on the direction's own clock. There is no echo
 * and there is no re-mount, which is the difference the round is measuring: at
 * L1 the set is still on screen behind the deck, receded by `presenceOf()`, and
 * Escape flies back out of the room rather than rebuilding the board.
 *
 * THE ONE THING THAT IS NOT THE CAMERA'S. The deck at L1 is the same carousel
 * the control variant uses, at its designed size, NOT scaled by the rig: its
 * cards are laid out against a `--card` token and a camera that magnified them
 * would be answering a different question than the one this round asks. So the
 * camera flies into the room and the deck stands up on the table it flew to.
 * Both are true at once, which is the composition this direction is a test of.
 *
 * WHERE THE NUMBERS ARE. `./layout.ts`, all of them, with a `node --test` file
 * beside it. Nothing below computes a position.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  REST_POSE,
  poseToTransform,
  useCameraRig,
  useSemanticZoom,
  type CameraPose,
  type Focus,
} from "@athena/demo-kit/zoom";

import { STAGES } from "@/lib/constants";
import { Carousel } from "../../Carousel";
import { GroupRead } from "../../columns/facts";
import type { DirProps } from "../contract";
import { groupsInStage } from "../contract";
import {
  ROOM_W,
  TABLE_RX,
  TABLE_RY,
  ZOOM_ROOM,
  ZOOM_TABLE,
  roomAt,
  roomDepth,
  roomOrigin,
  roomPose,
  roomsBounds,
  seatPose,
  seatingFor,
  tableAt,
  tablePose,
} from "./layout";

/** The second band is out of reach: L1 → L2 is a click on a card, as everywhere. */
const BAND_ITEM = 99;

export function Rooms(props: DirProps) {
  const { board, groups, nav, flight, focus, lit, onOpenGroup, onOpenItem, presence } = props;
  const level = focus.level;
  const sceneRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<HTMLDivElement | null>(null);

  /** The rooms, in stage order, each with the tables standing on its floor. */
  const rooms = useMemo(
    () =>
      STAGES.map((stage, index) => ({
        stage,
        index,
        label: board.stageLabel[stage],
        tables: groupsInStage(groups, stage),
      })),
    [board.stageLabel, groups],
  );
  const deepest = useMemo(() => rooms.reduce((n, r) => Math.max(n, r.tables.length), 1), [rooms]);

  /* The set's own resting pose, not the kit's: `REST_POSE` is zoom 1 and five
     rooms at zoom 1 do not fit the frame. `roomPose(null, …)` is the one place
     that answer is written. */
  const rest = useMemo(() => roomPose(null, rooms.length), [rooms.length]);

  const rig = useCameraRig({
    initial: { ...REST_POSE, zoom: rest.zoom },
    bounds: roomsBounds(rooms.length, deepest),
    drag: "pan",
    wheel: "zoom",
    /* No inertia and no snap: a set you are reading must stop when you stop. */
    inertia: 0,
    snap: null,
    keyboard: true,
    reducedMotion: "user",
    flyToken: "--bd-dur-4",
  });

  /* The pose onto the scene, without a render. Forty seated tokens re-laid out on
     every animation frame of a fly would be rule 9 failing from the other end. */
  useEffect(
    () =>
      rig.subscribe((pose) => {
        const el = sceneRef.current;
        if (el) el.style.transform = poseToTransform(pose);
      }),
    [rig],
  );

  /** Which table the camera is standing over, as a group id. */
  const resolveGroup = useCallback(
    (pose: CameraPose): string | null => {
      const at = roomAt(pose.pan, rooms.length);
      const room = at === null ? null : rooms[at];
      if (!room || room.tables.length === 0) return null;
      const t = tableAt(pose.pan, room.tables.length);
      return t === null ? null : (room.tables[t]?.id ?? null);
    },
    [rooms],
  );

  const poseFor = useCallback(
    (at: Focus): Partial<CameraPose> => {
      if (at.level === 0 || !at.group) return rest;
      const room = rooms.find((r) => r.tables.some((t) => t.id === at.group));
      if (!room) return rest;
      const table = room.tables.findIndex((t) => t.id === at.group);
      return roomPose(room.index, rooms.length, table, room.tables.length);
    },
    [rest, rooms],
  );

  useSemanticZoom(nav, rig, {
    bands: [ZOOM_ROOM, BAND_ITEM],
    resolveGroup,
    resolveItem: () => null,
    poseFor,
    flight,
  });


  /*
   * FOCUS FOLLOWS THE LEVEL, on the way out.
   *
   * The kit owns L2's focus return (`useOverlayEscape`, rule 5) and owns nothing
   * for L0 ⇄ L1 — round 3's own kit list has that as item 3 and it did not land
   * with the camera. So each direction writes it, and this is the second of the
   * two copies in this app: a reader who Escapes out of a group lands back on the
   * control they opened it with, not on the document.
   *
   * `focus()` and not a click, so `:focus-visible` stays false when the level was
   * changed with a pointer and no ring flashes. A LAYOUT effect for the read and a
   * passive one for the write: the selector has to be built from `from` on the
   * frame the level changes, and the node it names only exists after the paint.
   */
  const restore = useRef<string | null>(null);
  const { from, to } = flight;
  useLayoutEffect(() => {
    if (from === to) return;
    if (from.level === 1 && to.level === 0 && from.group) {
      const esc = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(from.group) : from.group;
      restore.current = `[data-group="${esc}"]`;
      nav.highlight([from.group]);
    } else if (nav.state.highlight.size > 0) {
      nav.highlight([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);
  useEffect(() => {
    const sel = restore.current;
    restore.current = null;
    if (sel) viewRef.current?.querySelector<HTMLElement>(sel)?.focus({ preventScroll: true });
  });

  const openGroup = focus.group;
  const role = groups.find((g) => g.id === openGroup)?.role;
  const column = groups.find((g) => g.id === openGroup)?.column;
  const { ref: rigRef, ...rigProps } = rig.bind;

  return (
    <div className="bd-stage bd-rooms" data-level={level} ref={viewRef}>
      <div className="bd-rooms-view">
        {/* The pitch sits ABOVE the camera, so the rig's pan and zoom are in the
            floor's own units and `roomAt()` is the exact inverse of `roomPose()`.
            Putting the tilt inside the camera would make a pan mean a different
            distance at every zoom. */}
        <div className="bd-rooms-tilt">
          <div
            className="bd-rooms-scene"
            ref={(el) => {
              sceneRef.current = el;
              rigRef(el);
            }}
            {...rigProps}
            aria-label="The pipeline as five rooms. Drag to walk the set, wheel to go into a room."
          >
            {rooms.map((room) => {
              const here = room.tables.reduce((n, t) => n + t.candidates.length, 0);
              return (
                <div
                  key={room.stage}
                  className="bd-room"
                  data-empty={room.tables.length === 0 || undefined}
                  data-open={room.tables.some((t) => t.id === openGroup) || undefined}
                  style={{
                    left: `calc(50% + ${roomOrigin(room.index, rooms.length).x}px)`,
                    inlineSize: `${ROOM_W}px`,
                    blockSize: `${roomDepth(Math.max(1, room.tables.length))}px`,
                  }}
                >
                  <div className="bd-room-plate" aria-hidden />
                  {/* Counter-pitched so the name reads as a sign on the wall
                      rather than as type lying on the floor. */}
                  <div className="bd-room-sign">
                    <span className="bd-room-name">{room.label}</span>
                    <span className="bd-room-count">{here}</span>
                  </div>

                  {room.tables.map((table, i) => {
                    const pose = tablePose(i, room.tables.length);
                    const near = presence(table.id);
                    const seating = seatingFor(table.candidates.length);
                    return (
                      <div
                        key={table.id}
                        className="bd-table"
                        data-lit={lit.has(table.id) ? "true" : undefined}
                        data-open={table.id === openGroup || undefined}
                        style={{
                          transform: `translate(-50%, -50%) translate(${pose.x}px, ${pose.y}px)`,
                          inlineSize: `${TABLE_RX * 2}px`,
                          blockSize: `${TABLE_RY * 2}px`,
                          /* The kit's presence, and the kit's mapping of it: the
                             rooms you are not in recede rather than disappear. */
                          opacity: near.opacity,
                          "--near": String(near.scale),
                        } as React.CSSProperties}
                      >
                        <button
                          type="button"
                          className="bd-table-top"
                          data-group={table.id}
                          onClick={() => onOpenGroup(table.id)}
                          aria-label={`Open ${table.role.title} at ${room.label}, ${table.candidates.length} candidates`}
                        />
                        {/* The role's name stands UP off the table rather than
                            lying on it. A label counter-rotated inside a flat
                            button is flattened with the button; standing it in
                            the room's own 3D context is the only way a pitched
                            plane gives type back. */}
                        <span className="bd-table-sign" aria-hidden>
                          <span className="bd-table-role">{table.role.title}</span>
                          <span className="bd-table-n">{table.candidates.length}</span>
                        </span>

                        {table.candidates.slice(0, seating.seated).map((candidate, s) => {
                          const seat = seatPose(s, seating.seated);
                          return (
                            <span
                              key={candidate.id}
                              className="bd-seat"
                              title={`${candidate.name} — ${candidate.line}`}
                              data-borderline={candidate.borderline}
                              data-unscored={!candidate.scored || undefined}
                              style={{
                                transform: `translate(-50%, -50%) translate(${seat.x}px, ${seat.y}px)`,
                              }}
                            >
                              {/* The monogram, not `Face`. A drawn portrait mark
                                  at 26px across a room is a grey smudge, and the
                                  one thing a seat has to say is WHO. */}
                              <span className="bd-seat-face bd-mono" aria-hidden>
                                {candidate.initials}
                              </span>
                            </span>
                          );
                        })}
                        {seating.hidden > 0 ? (
                          <span className="bd-seat-more">+{seating.hidden}</span>
                        ) : null}

                        <span className="bd-table-read">
                          <GroupRead candidates={table.candidates} />
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/*
       * THE DECK, standing on the table the camera flew to.
       *
       * Its ink waits for the camera: `data-ink="wait"` is the same sequence the
       * carousel already uses on the control variant's echo, on the same
       * `--bd-zoom-half` clock, so the room's name and the group's name are never
       * both shouting in one frame (rule 3).
       */}
      {level >= 1 && role && column ? (
        <div className="bd-layer bd-rooms-deck">
          <Carousel
            key={`${role.id}:${column.id}`}
            role={role}
            column={column}
            focusId={nav.state.hover}
            owns={level === 1}
            onFocus={(id) => nav.hover(id)}
            onOpen={(id) => {
              nav.hover(id);
              onOpenItem(focus.group ?? "", id);
            }}
          />
        </div>
      ) : null}

      {level === 0 ? (
        <p className="bd-cam-hint" aria-hidden>
          drag to walk the set · wheel to go into a room · Esc to come back out
        </p>
      ) : null}
    </div>
  );
}

/** Exported for the test that pins the bands against the layout's own zooms. */
export const ROOMS_BANDS: readonly [number, number] = [ZOOM_ROOM, BAND_ITEM];
export { ZOOM_TABLE };
