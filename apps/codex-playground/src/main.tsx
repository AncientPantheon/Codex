import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

// The codex-ui stylesheet — an EXPLICIT bare `./ui.css` export (NOT auto-injected
// by any JS import, and codex-ouronet does NOT re-export it). This entry is the
// SINGLE place it is imported so the `.codex-ui` token scope binds once for the
// whole mounted dashboard. codex-ui's `sideEffects` lists `dist/ui.css`, so the
// import survives `vite build`'s tree-shaking and emits a real css asset.
import "@ancientpantheon/codex-ui/ui.css";

import { App } from "./App";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found in index.html");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
