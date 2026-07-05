import { defineConfig } from "vitest/config";
import { alias, dedupe } from "./resolve.shared";

export default defineConfig({
  resolve: {
    // Same single-React dedupe + workspace-source aliases as vite.config so the
    // .tsx React tests run under jsdom with one React instance and the codex-ouronet
    // `/adapters` subpath (concrete CodexSnapshot) resolves identically to dev.
    dedupe,
    alias,
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx", "src/**/*.test.ts", "src/**/*.test.tsx"],
    server: {
      deps: {
        // Force these node_modules deps through Vite's transform pipeline so the
        // react/react-dom aliases in resolve.shared apply to THEIR bare `react`
        // imports too. Externalized (default) node_modules deps are resolved by
        // Node's resolver — a dep at ROOT node_modules pulls the ROOT React 18.3.1
        // (nearest copy) while the renderer runs on the app's React 19 copy.
        //   - zustand → its useSyncExternalStore reads a null dispatcher (the
        //     provider-mount crash).
        //   - lucide-react → the shell's tab icons (<Atom>, <Sprout>, …) are
        //     React-18 elements handed to the React-19 reconciler, which throws
        //     "A React Element from an older version of React was rendered".
        // Inlining routes each dep's `react`/`jsx-runtime` import through the
        // single-copy alias so every module renders on ONE React instance.
        inline: ["zustand", "lucide-react"],
      },
    },
  },
});
