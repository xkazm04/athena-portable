import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @athena/demo-kit ships TypeScript source rather than a build; Next compiles it with the app.
  // This is why the kit needs no build step and edits to it hot-reload in every app.
  transpilePackages: ["@athena/demo-kit"],
  // Next 16 writes AGENTS.md / CLAUDE.md into the app directory on first dev run. The repository
  // has its own, so keep it off.
  agentRules: false,
  // The dev overlay's badge is fixed to the bottom-left corner, which is where this app's
  // breadcrumb is. Three of these apps are recorded side by side as one studio's tabs, and a
  // framework badge sitting on top of the pipeline crumb is in every frame of it.
  devIndicators: false,
};

export default nextConfig;
