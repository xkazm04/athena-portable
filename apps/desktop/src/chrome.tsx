/**
 * The chrome webview's entry — README section 3.1 and 3.5, ADR 0087.
 *
 * Main is one scene with depths: the console (`console/root.tsx`) mounts the stage on the stores.
 * The dev inspector (ADR 0086) is dropped from a build with the rest of the DEV branch.
 */
import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";

import ConsoleRoot from "@/console/root";
import "@/styles/app.css";
import "@/styles/skins/loop-tide.css";

const Inspector = import.meta.env.DEV ? lazy(() => import("@/lib/dev/inspector")) : null;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConsoleRoot />
    {Inspector && (
      <Suspense fallback={null}>
        <Inspector />
      </Suspense>
    )}
  </React.StrictMode>,
);
