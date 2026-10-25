// A test pins the shipped rule, or it pins nothing.
//
// Two of the kit's tests once carried a hand-kept copy of the rule they claimed to pin: abort.test.ts
// re-implemented nav.ts's Escape listener as `escapeMeans`, and template-navigate.test.ts kept a
// `viewFor` "in step" with the template that had already drifted to the prefix rule the template
// rejects. A copy is green whatever the shipped code does, so mutating the shipped code left both
// files green. This file closes the class with the TypeScript compiler API, not text matching:
//
//   - no file under test/ declares, at top level, a name a module under src/ or template/lib/
//     exports (with a negative control proving the scanner can go red);
//   - nav.ts's window keydown handler routes through `escapeIntent` and dispatches its answer, at
//     call level, so abort.test.ts's cases reach the listener and not a copy of it;
//   - the kit's tsconfig includes the tests, so `typecheck` checks the suite's own code.

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parse(name: string, text: string): ts.SourceFile {
  const kind = name.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(name, text, ts.ScriptTarget.ES2022, true, kind);
}

function hasExportModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

function boundNames(name: ts.BindingName, into: string[]): void {
  if (ts.isIdentifier(name)) into.push(name.text);
  else for (const el of name.elements) if (!ts.isOmittedExpression(el)) boundNames(el.name, into);
}

/** The value names a module exports: exported functions, classes, variables and `export { a as b }`. */
function exportedValueNames(sf: ts.SourceFile): string[] {
  const names: string[] = [];
  for (const st of sf.statements) {
    if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && st.name && hasExportModifier(st)) {
      names.push(st.name.text);
    } else if (ts.isVariableStatement(st) && hasExportModifier(st)) {
      for (const d of st.declarationList.declarations) boundNames(d.name, names);
    } else if (ts.isExportDeclaration(st) && !st.isTypeOnly && st.exportClause && ts.isNamedExports(st.exportClause)) {
      for (const el of st.exportClause.elements) if (!el.isTypeOnly) names.push(el.name.text);
    }
  }
  return names;
}

/** `import(...)` or `await import(...)`: the dynamic form the suite uses after `registerHooks`. */
function isDynamicImport(init: ts.Expression | undefined): boolean {
  let e = init;
  while (e && (ts.isAwaitExpression(e) || ts.isParenthesizedExpression(e))) e = e.expression;
  return e !== undefined && ts.isCallExpression(e) && e.expression.kind === ts.SyntaxKind.ImportKeyword;
}

/**
 * The top-level functions, classes and variables a source declares whose name is in `shipped`.
 * An import is not a declaration - static, or `const { f } = await import(...)` - so importing
 * the shipped function is never reported.
 */
function shadowedExports(text: string, shipped: ReadonlySet<string>, name = "probe.ts"): string[] {
  const sf = parse(name, text);
  const declared: string[] = [];
  for (const st of sf.statements) {
    if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && st.name) declared.push(st.name.text);
    else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) if (!isDynamicImport(d.initializer)) boundNames(d.name, declared);
    }
  }
  return declared.filter((n) => shipped.has(n));
}

function walkTs(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walkTs(p, out);
    else if (/\.tsx?$/.test(e.name) && !e.name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

function shippedExports(): Map<string, string> {
  const where = new Map<string, string>();
  const files = [
    ...walkTs(join(KIT, "src")),
    ...readdirSync(join(KIT, "template", "lib"))
      .filter((f) => f.endsWith(".ts"))
      .map((f) => join(KIT, "template", "lib", f)),
  ];
  for (const file of files) {
    for (const n of exportedValueNames(parse(file, readFileSync(file, "utf8")))) {
      if (!where.has(n)) where.set(n, relative(KIT, file).replaceAll("\\", "/"));
    }
  }
  return where;
}

/**
 * What is wrong with the window keydown handler inside `useWorldNav`, at call level: it must call
 * `escapeIntent` exactly once, neither predicate directly, and dispatch the value it returned.
 */
function navListenerProblems(text: string): string[] {
  const sf = parse("nav.ts", text);
  const hook = sf.statements.find(
    (s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === "useWorldNav",
  );
  if (!hook?.body) return ["no useWorldNav"];

  let handlerName: string | undefined;
  const locals = new Map<string, ts.Expression>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      locals.set(node.name.text, node.initializer);
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.getText(sf) === "window.addEventListener" &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[0].text === "keydown" &&
      node.arguments[1] &&
      ts.isIdentifier(node.arguments[1])
    ) {
      handlerName = node.arguments[1].text;
    }
    ts.forEachChild(node, visit);
  };
  visit(hook.body);
  if (!handlerName) return ["no window keydown listener in useWorldNav"];
  const handler = locals.get(handlerName);
  if (!handler || !(ts.isArrowFunction(handler) || ts.isFunctionExpression(handler))) {
    return [`keydown handler ${handlerName} is not a local function`];
  }

  const calls = new Map<string, ts.CallExpression[]>();
  const bound = new Map<string, ts.Expression>();
  const inHandler = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const list = calls.get(node.expression.text) ?? [];
      list.push(node);
      calls.set(node.expression.text, list);
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      bound.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, inHandler);
  };
  inHandler(handler.body);

  const problems: string[] = [];
  const count = (n: string) => calls.get(n)?.length ?? 0;
  if (count("escapeIntent") !== 1) problems.push(`escapeIntent called ${count("escapeIntent")} times, not once`);
  for (const n of ["escapeLeavesLevel", "escapeAbortsFlight"]) {
    if (count(n) > 0) problems.push(`${n} called directly`);
  }
  const dispatches = calls.get("dispatch") ?? [];
  if (dispatches.length !== 1) {
    problems.push(`dispatch called ${dispatches.length} times, not once`);
    return problems;
  }
  const arg = dispatches[0]!.arguments[0];
  const typeProp =
    arg && ts.isObjectLiteralExpression(arg)
      ? arg.properties.find((p) => p.name && ts.isIdentifier(p.name) && p.name.text === "type")
      : undefined;
  let typeIdent: string | undefined;
  if (typeProp && ts.isShorthandPropertyAssignment(typeProp)) typeIdent = typeProp.name.text;
  else if (typeProp && ts.isPropertyAssignment(typeProp) && ts.isIdentifier(typeProp.initializer)) {
    typeIdent = typeProp.initializer.text;
  }
  const source = typeIdent ? bound.get(typeIdent) : undefined;
  const fromIntent =
    source !== undefined &&
    ts.isCallExpression(source) &&
    ts.isIdentifier(source.expression) &&
    source.expression.text === "escapeIntent";
  if (!fromIntent) problems.push("the dispatched type is not the value escapeIntent returned");
  return problems;
}

test("nav.ts's keydown handler calls escapeIntent once, neither predicate, and dispatches its answer", () => {
  const text = readFileSync(join(KIT, "src", "zoom", "nav.ts"), "utf8");
  assert.deepEqual(navListenerProblems(text), []);
});

test("negative control: the two-predicate listener shape is reported", () => {
  const before = `
    export function useWorldNav() {
      useEffect(() => {
        const onKey = (e) => {
          if (!escapeLeavesLevel(e, level.current, holds.current)) return;
          e.preventDefault();
          dispatch({ type: escapeAbortsFlight(e, moving.current, level.current) ? "abort" : "up" });
        };
        window.addEventListener("keydown", onKey);
      }, []);
    }`;
  const problems = navListenerProblems(before);
  assert.ok(problems.includes("escapeIntent called 0 times, not once"), problems.join("; "));
  assert.ok(problems.includes("escapeLeavesLevel called directly"));
  assert.ok(problems.includes("escapeAbortsFlight called directly"));
  assert.ok(problems.includes("the dispatched type is not the value escapeIntent returned"));
});

test("no test file declares a top-level name a shipped module under src/ or template/lib/ exports", () => {
  const shipped = shippedExports();
  assert.ok(shipped.has("viewFor") && shipped.has("escapeIntent"), "the scanner sees the shipped exports");
  const found: string[] = [];
  for (const file of walkTs(join(KIT, "test"))) {
    const rel = relative(KIT, file).replaceAll("\\", "/");
    for (const n of shadowedExports(readFileSync(file, "utf8"), new Set(shipped.keys()), file)) {
      found.push(`${rel} declares ${n}, exported by ${shipped.get(n)}`);
    }
  }
  assert.deepEqual(found, [], "import the shipped function instead of keeping a copy");
});

test("negative control: the scanner reports a declared copy and not an import", () => {
  const shipped = new Set(["viewFor"]);
  assert.deepEqual(shadowedExports("function viewFor(p: string) { return p; }", shipped), ["viewFor"]);
  assert.deepEqual(shadowedExports("const viewFor = (p: string) => p;", shipped), ["viewFor"]);
  assert.deepEqual(shadowedExports("import { viewFor } from '../template/lib/constants.ts';", shipped), []);
  assert.deepEqual(shadowedExports('const { viewFor } = await import("../template/lib/constants.ts");', shipped), []);
});

test("the kit's tsconfig includes every test file, so typecheck checks the suite's own code", () => {
  const path = join(KIT, "tsconfig.json");
  const read = ts.readConfigFile(path, ts.sys.readFile);
  assert.equal(read.error, undefined);
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, KIT, undefined, path);
  const included = new Set(parsed.fileNames.map((f) => resolve(f)));
  const tests = readdirSync(join(KIT, "test")).filter((f) => f.endsWith(".test.ts"));
  assert.ok(tests.length > 0);
  const missing = tests.filter((f) => !included.has(resolve(KIT, "test", f)));
  assert.deepEqual(missing, []);
});
