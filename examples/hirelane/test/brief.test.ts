/**
 * The binding brief, checked against the tree it is binding on.
 *
 * `DESIGN-LAW.md` §6 makes a brief the thing an agent may not begin generating without, so a brief
 * that names a file which is not there is worse than no brief: it reads as a specification and
 * resolves to nothing. §5 drifted exactly that way - it kept scoring the direction against
 * `/v/caliper`, whose route and component tree were reviewed out, and kept a `board` column written
 * before the dark rework inverted the ground and replaced the type pairing. Nothing in this repo
 * read a markdown brief against code; this does, for the two claims a machine can decide.
 *
 *   node --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const from = (path: string): string => fileURLToPath(new URL(`../${path}`, import.meta.url));
const read = (path: string): string => readFileSync(from(path), "utf8");

const BRIEF = "design/board-brief.md";
/** A backticked repo-relative path: `lib/constants.ts`, `components/board/`, `app/v/board/layout.tsx:25`. */
const PATH_IN_PROSE = /`((?:app|lib|components|design|test)\/[A-Za-z0-9_./-]*)`/g;

const cited = (file: string): string[] => [
  ...new Set([...read(file).matchAll(PATH_IN_PROSE)].map((m) => m[1]!.replace(/:\d+$/, ""))),
];

test("every file the binding brief names exists", () => {
  const named = cited(BRIEF);
  assert.ok(named.length > 5, "the brief cites the tree, or this asserts nothing");
  const missing = named.filter((p) => !existsSync(from(p)));
  assert.deepEqual(missing, [], `named in ${BRIEF} with no file behind it`);
});

/**
 * The README is this app's front door and one of its two declared entry points, so a structural
 * claim in it is worth more than the same claim anywhere else - and it went stale hardest, naming
 * four routes, a `components/prime/` design and a `lib/surface.ts` that no longer exist. It carries
 * no status marker and never should: unlike the reviewed-out briefs it is not a record, it is the
 * description of what is here now.
 */
test("every file the README names exists", () => {
  const named = cited("README.md");
  assert.ok(named.length > 5, "the README cites the tree, or this asserts nothing");
  const missing = named.filter((p) => !existsSync(from(p)));
  assert.deepEqual(missing, [], "named in README.md with no file behind it");
});

test("every route the README names is served by a page", () => {
  // A bare `/` counts. It did not, and it became the only route this app has the day the board
  // moved to the root - so the check that every documented route exists stopped checking the one
  // route there is.
  const routes = [
    ...new Set([...read("README.md").matchAll(/`(\/[a-z0-9/<>_-]*)`/g)].map((m) => m[1]!)),
  ].filter((r) => !r.includes("<"));
  assert.ok(routes.length > 0, "the README names routes, or this asserts nothing");
  const missing = routes.filter(
    (r) => !existsSync(from(r === "/" ? "app/page.tsx" : `app${r}/page.tsx`)),
  );
  assert.deepEqual(missing, [], "documented in README.md with no page.tsx behind it");
});

/**
 * `design/` is four reviewed-out briefs and one live one. That is a defensible thing to keep - the
 * law mandates brief-before-code, so the record of the process has value - but an agent told to
 * read `design/` has to be able to tell the live spec from the dead ones in one glance. A brief
 * that names a tree which is not there says so at the top, or it names only trees that are there.
 */
const MARKER = /REVIEWED OUT|NOT WIRED|SUPERSEDED/;

test("a brief that specifies software which is not here says so at the top", () => {
  const briefs = readdirSync(from("design")).filter((f) => f.endsWith(".md") && f !== "board-brief.md");
  assert.ok(briefs.length > 0, "there are other briefs, or this asserts nothing");
  for (const file of briefs) {
    const source = read(`design/${file}`);
    const named = [
      ...new Set([...source.matchAll(PATH_IN_PROSE)].map((m) => m[1]!.replace(/:\d+$/, ""))),
    ];
    const dead = named.filter((p) => !existsSync(from(p)));
    if (dead.length === 0) continue;
    assert.match(
      source.split("\n").slice(0, 30).join("\n"),
      MARKER,
      `design/${file} specifies ${dead.join(", ")}, none of which exists, and opens as a live spec`,
    );
  }
});

/**
 * The faces app/layout.tsx loads: the names it imports from `next/font/google`, read with the
 * comments out. A substring test over the whole file was satisfied by the sentence recording a
 * face's removal, which is the matcher-on-prose failure a source-scanning check has to strip for.
 */
const LOADED = ((): string[] => {
  const code = read("app/layout.tsx")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const names = /import\s*\{([^}]*)\}\s*from\s*["']next\/font\/google["']/.exec(code)?.[1] ?? "";
  return names
    .split(",")
    .map((n) => n.trim().replace(/_/g, " "))
    .filter(Boolean);
})();
const layoutLoads = (face: string): boolean => LOADED.includes(face);

test("the type voice the brief claims is the type the route loads, no more and no fewer", () => {
  const row = /\| Type voice \| ([^|]+)\|/.exec(read(BRIEF).split("## 5b.")[1] ?? "");
  assert.ok(row, "§5b states a type voice");
  assert.ok(LOADED.length > 0, "app/layout.tsx imports its faces from next/font/google, or this asserts nothing");
  const known = new Set([
    ...LOADED,
    ...["Caveat", "Fraunces", "Manrope", "Space Mono", "Archivo", "Literata", "Martian Mono"],
  ]);
  const faces = [...known].filter((face) => new RegExp(`\\b${face}\\b`).test(row[1]!));
  assert.ok(faces.length > 0, "and names faces");
  for (const face of faces) {
    assert.ok(layoutLoads(face), `${face} is loaded by app/layout.tsx, not just claimed in the brief`);
  }
  for (const face of LOADED) {
    assert.ok(faces.includes(face), `${face} is loaded by app/layout.tsx and missing from the brief's type voice`);
  }
});

test("a face the layout names only in a comment is not a face it loads", () => {
  // `Caveat` was retired, and app/layout.tsx says so in prose. A brief that claimed it again must
  // fail the check above, not pass it on the strength of the sentence recording its removal.
  assert.equal(layoutLoads("Caveat"), false, "the retired face reads as loaded");
});
