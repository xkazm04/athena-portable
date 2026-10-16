// ESLint 9 flat config. eslint-config-next 16 exports flat config arrays directly, so there is no
// FlatCompat / .eslintrc shim here. `data/` is linted like the rest: it is the model every surface
// and every tool reads, and it is TypeScript like them.
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const config = [
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts"] },
  ...nextCoreWebVitals,
  ...nextTypescript,
];

export default config;
