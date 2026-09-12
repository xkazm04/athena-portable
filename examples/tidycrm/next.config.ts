import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @athena/demo-kit ships TypeScript source rather than a build; Next compiles it with the app.
  // This is why the kit needs no build step and edits to it hot-reload in every app.
  transpilePackages: ["@athena/demo-kit"],
  // Next 16 writes AGENTS.md / CLAUDE.md into the app directory on first dev run. The repository
  // has its own, so keep it off.
  agentRules: false,
};

export default nextConfig;
