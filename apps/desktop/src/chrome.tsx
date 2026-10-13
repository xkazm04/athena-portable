import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";

import App from "@/app";
import { consoleUiOn } from "@/lib/ui";
import "@/styles/app.css";

// The dev inspector (ADR 0086): dropped from a build with the rest of the DEV branch.
const Inspector = import.meta.env.DEV ? lazy(() => import("@/lib/dev/inspector")) : null;

// The depth console (ADR 0087) is opt-in until the cutover; the module bar is the default.
const ConsoleRoot = lazy(() => import("@/console/root"));
const Root = consoleUiOn() ? (
  <Suspense fallback={null}>
    <ConsoleRoot />
  </Suspense>
) : (
  <App />
);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {Root}
    {Inspector && (
      <Suspense fallback={null}>
        <Inspector />
      </Suspense>
    )}
  </React.StrictMode>,
);
