import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";

import App from "@/app";
import "@/styles/app.css";

// The dev inspector (ADR 0086): dropped from a build with the rest of the DEV branch.
const Inspector = import.meta.env.DEV ? lazy(() => import("@/lib/dev/inspector")) : null;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
    {Inspector && (
      <Suspense fallback={null}>
        <Inspector />
      </Suspense>
    )}
  </React.StrictMode>,
);
