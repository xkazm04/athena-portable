/**
 * The dev inspector's build half — README section 3.1 (surfaces), ADR 0086.
 *
 * Stamps every host JSX element (`<div>`, `<button>`) with `data-loc="src/.../File.tsx:LINE:COL"`
 * so the in-app inspector can map a hovered DOM node back to its source. Components are skipped:
 * an injected prop does not reliably reach their root node, and React 19 removed the Fiber
 * `_debugSource` the old click-to-component tools read. The stamp is read from the DOM instead.
 *
 * It runs as its own Vite plugin (`enforce: "pre"`, `apply: "serve"`) so it sees JSX before the
 * compiler lowers it, and only when `ATHENA_INSPECTOR=1`: a normal dev session pays nothing and a
 * build never carries the attribute.
 */

/** The Babel visitor: one `data-loc` per host element, repo-relative, idempotent. */
function injectSourceLoc({ types: t }) {
  const ATTR = "data-loc";
  return {
    name: "inject-source-loc",
    visitor: {
      JSXOpeningElement(path, state) {
        const name = path.node.name;
        if (name.type !== "JSXIdentifier" || !/^[a-z]/.test(name.name)) return;
        const loc = path.node.loc;
        const filename = state.file.opts.filename;
        if (!loc || !filename) return;
        const norm = filename.replace(/\\/g, "/");
        const at = norm.lastIndexOf("/src/");
        if (at === -1) return;
        const stamped = path.node.attributes.some(
          (a) => a.type === "JSXAttribute" && a.name && a.name.name === ATTR,
        );
        if (stamped) return;
        path.node.attributes.push(
          t.jsxAttribute(
            t.jsxIdentifier(ATTR),
            t.stringLiteral(`${norm.slice(at + 1)}:${loc.start.line}:${loc.start.column + 1}`),
          ),
        );
      },
    },
  };
}

export function devSourceLocPlugin() {
  let enabled = false;
  let babel;
  return {
    name: "athena-dev-source-loc",
    enforce: "pre",
    apply: "serve",
    async configResolved(config) {
      enabled = config.command === "serve" && process.env.ATHENA_INSPECTOR === "1";
      if (enabled) {
        babel = await import("@babel/core");
        config.logger.info("  [dev-source-loc] inspector source mapping ON (Ctrl+Shift+L)");
      }
    },
    async transform(code, id) {
      if (!enabled || !babel) return null;
      const file = id.split("?")[0];
      if (!/\.[jt]sx$/.test(file) || file.includes("/node_modules/")) return null;
      const result = await babel.transformAsync(code, {
        filename: file,
        configFile: false,
        babelrc: false,
        sourceMaps: true,
        // Parse flags only: this plugin is the sole transform, the compiler lowers the rest.
        parserOpts: { plugins: ["jsx", "typescript"] },
        plugins: [injectSourceLoc],
      });
      return result && result.code != null ? { code: result.code, map: result.map ?? null } : null;
    },
  };
}
