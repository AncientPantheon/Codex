import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

// The SELF-CONTAINED Codex stylesheet (variant B): codex-ouronet's build runs
// Tailwind once over all the assembled-UI packages and ships dist/ui.css =
// `--codex-*` tokens + a scoped `.codex-ui` reset + every utility class the
// components use. Importing this ONE file styles the entire dashboard (settings
// cards, the ZBOM modal, the Arweave panel) with NO Tailwind needed downstream.
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
