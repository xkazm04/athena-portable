// Adopting the template is one command (scan-sweep challenge 2026-10-25, demo-kit-template/A).
//
// The template used to be adopted by hand: a README listed seven edits across nine files, and the
// app's identity lived in six literals plus a port picked against the siblings by eye. These pin
// `examples/demo-kit/adopt.ts`, which replaces that procedure: one set of answers, a readiness gate
// whose refusals name their prerequisite, a deterministic mapping a dry run previews exactly, a
// copy staged beside the target and renamed into place only when every file landed, and a stamp
// recording which template (by digest) and which answers made the instance.
//
// Every adoption here goes into a throwaway examples root under the OS temp directory; nothing is
// written beside the real apps.
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

import { IDENTITY_TOKENS, adopt, payloadFiles, templateDigest } from "../adopt.ts";

const KIT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE = join(KIT, "template");

const made: string[] = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** A fresh examples root holding only the siblings named, each with a dev script on its port. */
function examplesRoot(siblings: Record<string, number> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "dk-adopt-"));
  made.push(root);
  for (const [name, port] of Object.entries(siblings)) {
    mkdirSync(join(root, name));
    writeFileSync(
      join(root, name, "package.json"),
      JSON.stringify({ name, scripts: { dev: `next dev --port ${port}` } }, null, 2),
    );
  }
  return root;
}

/** Every file under a directory, as posix relative path -> bytes. */
function tree(dir: string): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  const walk = (at: string) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) walk(path);
      else out.set(relative(dir, path).replaceAll("\\", "/"), readFileSync(path));
    }
  };
  walk(dir);
  return out;
}

const PARCELBAY = { name: "parcelbay", port: 3008, design: "ink" } as const;

test("case 1: adopting parcelbay on 3008 with design ink writes the name, the port, the ids and the variant block", () => {
  const root = examplesRoot({ ledgerbox: 3001 });
  const result = adopt(PARCELBAY, { root });
  assert.ok(result.ok, JSON.stringify(result));
  const app = join(root, "parcelbay");
  const pkg = JSON.parse(readFileSync(join(app, "package.json"), "utf8"));
  assert.equal(pkg.name, "parcelbay");
  assert.match(pkg.scripts.dev, /--port 3008\b/);
  const constants = readFileSync(join(app, "lib", "constants.ts"), "utf8");
  assert.match(constants, /export const APP_ID = "parcelbay";/);
  assert.match(constants, /export const VARIANT = "ink";/);
  const css = readFileSync(join(app, "app", "globals.css"), "utf8");
  assert.ok(css.includes('[data-variant="ink"]'), "globals.css has no block for the design");
  assert.ok(!css.includes('[data-variant="plain"]'), "globals.css still carries the template's design block");
  // The template's act (slot B) rides along untouched: an adoption copies what the template ships.
  for (const file of ["lib/acts.ts", "lib/db.ts", "components/StatusAction.tsx"]) {
    assert.deepEqual(readFileSync(join(app, file)), readFileSync(join(TEMPLATE, file)), `${file} was not carried`);
  }
});

test("case 2: an adopted instance carries none of the template's identity tokens in any file", () => {
  const root = examplesRoot();
  const result = adopt(PARCELBAY, { root });
  assert.ok(result.ok, JSON.stringify(result));
  const hits: string[] = [];
  for (const [file, bytes] of tree(join(root, "parcelbay"))) {
    const text = bytes.toString("utf8");
    for (const token of IDENTITY_TOKENS) if (text.includes(token)) hits.push(`${file}: ${token}`);
  }
  assert.deepEqual(hits, [], "the template's identity leaked into the instance");
  assert.deepEqual([...IDENTITY_TOKENS].sort(), ['"plain"', "Demo app", "copy me", "data-variant=\"plain\"", "demo-app"].sort());
});

test("case 3: a port a sibling holds is refused naming that sibling and the first free port, and nothing is written", () => {
  const root = examplesRoot({ ledgerbox: 3001, hirelane: 3002 });
  const result = adopt({ ...PARCELBAY, port: 3001 }, { root });
  assert.equal(result.ok, false);
  assert.ok(!result.ok);
  assert.equal(result.prerequisite, "port");
  assert.match(result.error, /ledgerbox/);
  assert.match(`${result.error} ${result.remedy}`, /3003/);
  assert.ok(!existsSync(join(root, "parcelbay")), "the target directory exists after a refusal");
  assert.deepEqual(readdirSync(root).sort(), ["hirelane", "ledgerbox"]);
  // The siblings' ports are read from their package.json, not a hand list: move one, the answer moves.
  const moved = examplesRoot({ ledgerbox: 3011 });
  assert.ok(adopt({ ...PARCELBAY, port: 3001 }, { root: moved, dryRun: true }).ok, "a port no sibling holds was refused");
  const held = adopt({ ...PARCELBAY, port: 3011 }, { root: moved, dryRun: true });
  assert.ok(!held.ok && held.prerequisite === "port" && /ledgerbox/.test(held.error));
});

test("case 4: an existing directory and a name that is not a package name are each refused with their own prerequisite", () => {
  const root = examplesRoot({ ledgerbox: 3001 });
  const taken = adopt({ ...PARCELBAY, name: "ledgerbox" }, { root });
  assert.ok(!taken.ok);
  assert.equal(taken.prerequisite, "directory");
  assert.match(taken.error, /ledgerbox/);
  assert.ok(taken.remedy.length > 0);
  const bad = adopt({ ...PARCELBAY, name: "Bad Name" }, { root });
  assert.ok(!bad.ok);
  assert.equal(bad.prerequisite, "name");
  assert.match(bad.error, /Bad Name/);
  assert.ok(bad.remedy.length > 0);
  assert.notEqual(bad.remedy, taken.remedy);
  assert.deepEqual(readdirSync(root), ["ledgerbox"], "a refusal wrote something");
  assert.deepEqual(readFileSync(join(root, "ledgerbox", "package.json"), "utf8").includes("3001"), true);
});

test("case 5: a failure after the third file leaves neither the target nor a staging directory", () => {
  const root = examplesRoot({ ledgerbox: 3001 });
  assert.throws(() => adopt(PARCELBAY, { root, failAfter: 3 }), /after 3 files/);
  assert.deepEqual(readdirSync(root), ["ledgerbox"], "the failed adoption left something under the examples root");
});

test("case 6: the same answers make byte-identical trees, stamped with the template digest and the answers", () => {
  const a = examplesRoot();
  const b = examplesRoot();
  assert.ok(adopt(PARCELBAY, { root: a }).ok);
  assert.ok(adopt(PARCELBAY, { root: b }).ok);
  const ta = tree(join(a, "parcelbay"));
  const tb = tree(join(b, "parcelbay"));
  assert.deepEqual([...ta.keys()].sort(), [...tb.keys()].sort());
  for (const [file, bytes] of ta) assert.ok(bytes.equals(tb.get(file)!), `${file} differs between two adoptions`);

  const stamp = JSON.parse(readFileSync(join(a, "parcelbay", ".template.json"), "utf8"));
  assert.deepEqual(Object.keys(stamp).sort(), ["answers", "digest", "template"]);
  assert.equal(stamp.digest, templateDigest(TEMPLATE));
  assert.match(stamp.digest, /^[0-9a-f]{64}$/);
  assert.equal(stamp.answers.name, "parcelbay");
  assert.equal(stamp.answers.port, 3008);
  assert.equal(stamp.answers.design, "ink");
  // Every template file is in the instance; the stamp is the only file the template does not have.
  assert.deepEqual(
    [...ta.keys()].filter((f) => f !== ".template.json").sort(),
    payloadFiles(TEMPLATE).sort(),
  );

  // Change one template file and the digest changes.
  const copy = mkdtempSync(join(tmpdir(), "dk-adopt-template-"));
  made.push(copy);
  cpSync(TEMPLATE, copy, { recursive: true, filter: (src) => !/[\\/](node_modules|\.next|data)$/.test(src) });
  assert.equal(templateDigest(copy), templateDigest(TEMPLATE), "a faithful copy digests differently");
  writeFileSync(join(copy, "app", "page.tsx"), readFileSync(join(copy, "app", "page.tsx"), "utf8") + "\n");
  assert.notEqual(templateDigest(copy), templateDigest(TEMPLATE));
  const c = examplesRoot();
  assert.ok(adopt(PARCELBAY, { root: c, template: copy }).ok);
  assert.notEqual(JSON.parse(readFileSync(join(c, "parcelbay", ".template.json"), "utf8")).digest, stamp.digest);
});

test("case 7: a dry run returns the edits the real adoption then writes, and writes nothing", () => {
  const root = examplesRoot({ ledgerbox: 3001 });
  const preview = adopt(PARCELBAY, { root, dryRun: true });
  assert.ok(preview.ok, JSON.stringify(preview));
  assert.deepEqual(readdirSync(root), ["ledgerbox"], "the dry run wrote something");
  const files = preview.edits.map((e) => e.file).sort();
  assert.deepEqual(files, ["app/globals.css", "lib/constants.ts", "package.json"]);
  for (const edit of preview.edits) {
    assert.equal(edit.before, readFileSync(join(TEMPLATE, edit.file), "utf8"), `${edit.file}: before is not the template`);
    assert.notEqual(edit.before, edit.after);
  }
  const real = adopt(PARCELBAY, { root });
  assert.ok(real.ok);
  assert.deepEqual(real.edits, preview.edits);
  for (const edit of preview.edits) {
    assert.equal(readFileSync(join(root, "parcelbay", edit.file), "utf8"), edit.after, `${edit.file}: written differs from preview`);
  }
});

test("case 8 (guard): the template's app name has one authority, lib/constants.ts", () => {
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry.name)) {
        const file = relative(TEMPLATE, path).replaceAll("\\", "/");
        if (file !== "lib/constants.ts" && readFileSync(path, "utf8").includes("Demo app")) offenders.push(file);
      }
    }
  };
  walk(TEMPLATE);
  assert.deepEqual(offenders, [], "the app name is typed outside lib/constants.ts");
  const shell = readFileSync(join(TEMPLATE, "components", "Shell.tsx"), "utf8");
  assert.match(shell, /appName=\{APP_NAME\}/);
  assert.match(shell, /tagline=\{TAGLINE\}/);
  assert.match(readFileSync(join(TEMPLATE, "app", "layout.tsx"), "utf8"), /title: APP_NAME/);
});
