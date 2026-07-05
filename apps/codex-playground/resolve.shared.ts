import { resolve } from "node:path";

// Shared resolve config for BOTH vite.config.ts (dev/build) and vitest.config.ts
// (jsdom harness). Keeping a single source means the dev server and the tests see
// an identical module graph — same single React instance, same workspace-source
// aliases — so a component that renders in `vite dev` renders identically under test.

// Forward-slash (POSIX) form so Vite's alias replacement is stable on Windows;
// backslash replacements can survive to the resolver and fail to match.
const toPosix = (p: string): string => p.replace(/\\/g, "/");

const packages = toPosix(resolve(__dirname, "../../packages"));

const codexCoreSrc = `${packages}/codex-core/src`;
const codexUiSrc = `${packages}/codex-ui/src`;
const codexUiSrcIndex = `${codexUiSrc}/index.ts`;
const codexOuronetSrc = `${packages}/codex-ouronet/src`;

// The app's OWN React 19.2.7 copy — the canonical single instance every module
// (the aliased package sources, zustand, @testing-library/react, the shell
// components) must resolve to. See the react/react-dom aliases below for WHY.
const reactDir = toPosix(resolve(__dirname, "node_modules/react"));
const reactDomDir = toPosix(resolve(__dirname, "node_modules/react-dom"));

// lucide-react (the shell's tab/row icons) ships both a CJS `main` and an ESM
// `module` entry but NO `exports` map. Node's resolver prefers `main` (CJS), and
// a CJS icon module built its `React.forwardRef` elements against whatever `react`
// its own `require("react")` found — the ROOT React 18.3.1 — while the app renders
// on React 19. Handing a React-18 forwardRef element to the React-19 reconciler
// throws "A React Element from an older version of React was rendered" the moment
// a <CodexTabs> icon (<Atom>, <Sprout>, …) mounts. Pinning the ESM build routes
// lucide through Vite's transform so its bare `react` import hits the alias above,
// collapsing its icons onto the single React copy.
const lucideEsm = toPosix(
  resolve(__dirname, "../../node_modules/lucide-react/dist/esm/lucide-react.js"),
);

// A single React instance across zustand, @testing-library/react, and the shell
// components. Two physical copies (e.g. root react pulled via zustand alongside a
// nested copy) give a null hooks dispatcher and the classic "Invalid hook call".
export const dedupe = ["react", "react-dom"];

export const alias = [
  // SINGLE React copy — FORCE every `react`/`react-dom` specifier onto the app's
  // own 19.2.7 tree. `resolve.dedupe` alone is NOT enough here: this npm-workspaces
  // (hoisting, not pnpm) tree has FOUR physical react dirs — the ROOT is React
  // 18.3.1 while the app + codex-ui + codex-ouronet each carry React 19.2.7. Under
  // the Vitest transform pipeline the aliased package SOURCES (packages/*/src) would
  // otherwise resolve their bare `react` import against their own nested copy while
  // @testing-library/react renders on a different one — mixing a React-18 module
  // with a React-19 renderer yields a NULL internal dispatcher and the crash
  // `Cannot read properties of null (reading 'useSyncExternalStore')` the moment
  // the mounted <CodexProvider> (zustand's useSyncExternalStore) runs under jsdom.
  // Aliasing the bare specifier + every subpath (jsx-runtime, react-dom/client, …)
  // to ONE dir collapses all four onto the app's 19.2.7 copy. These MUST precede the
  // workspace-source aliases so `react`/`react-dom` never fall through to a nested copy.
  { find: /^react$/, replacement: `${reactDir}/index.js` },
  { find: /^react\/(.*)$/, replacement: `${reactDir}/$1` },
  { find: /^react-dom$/, replacement: `${reactDomDir}/index.js` },
  { find: /^react-dom\/(.*)$/, replacement: `${reactDomDir}/$1` },

  // Force lucide-react to its ESM build (see lucideEsm above) so it transforms
  // through Vite and its `react` import collapses onto the single React copy.
  { find: /^lucide-react$/, replacement: lucideEsm },

  // Cross-package workspace-source aliases so edits in the packages hot-reload in
  // the playground without a rebuild step. Order matters: more-specific matches
  // (subpath / regex) precede the bare-root match.

  // codex-core: prefix alias — any subpath resolves against its own src tree.
  { find: /^@ancientpantheon\/codex-core\/(.*)$/, replacement: `${codexCoreSrc}/$1/index.ts` },
  { find: /^@ancientpantheon\/codex-core$/, replacement: `${codexCoreSrc}/index.ts` },

  // codex-ouronet: PREFIX alias so `/adapters` falls through to
  // src/adapters/index.ts (where the concrete CodexSnapshot type + MemoryCodexAdapter
  // live). The file-upload adapter imports the snapshot type from this subpath.
  { find: /^@ancientpantheon\/codex-ouronet\/(.*)$/, replacement: `${codexOuronetSrc}/$1/index.ts` },
  { find: /^@ancientpantheon\/codex-ouronet$/, replacement: `${codexOuronetSrc}/index.ts` },

  // codex-ui JS SUBPATH barrels → src (single codex-ui module copy + single React).
  // WHY (T10.4 blocker): codex-ouronet's src re-exports from `@ancientpantheon/codex-ui/hooks`
  // + `/provider`; without this, those subpaths fall through to node → codex-ui `dist`,
  // loading codex-ui TWICE (src via the bare alias + dist via the subpath). Two copies =
  // two `CodexStoreContext` identities + two React copies → `useSyncExternalStore` null /
  // "Invalid hook call" when the provider mounts under the jsdom harness (FIX-5 class).
  // The `$`-anchored group matches ONLY the four JS barrels — `/ui` matches, `/ui.css`
  // does NOT (so the stylesheet still falls through to node resolution below).
  {
    find: /^@ancientpantheon\/codex-ui\/(hooks|provider|components|ui)$/,
    replacement: `${codexUiSrc}/$1/index.ts`,
  },

  // codex-ui: EXACT-MATCH ONLY for the bare specifier. A prefix alias would also capture
  // the bare `@ancientpantheon/codex-ui/ui.css` subpath and redirect it into src/, breaking
  // the stylesheet import. Matching only the bare specifier (+ the JS-barrel group above)
  // lets `/ui.css` fall through to node resolution against codex-ui's `./ui.css` export.
  { find: /^@ancientpantheon\/codex-ui$/, replacement: codexUiSrcIndex },
];
