/**
 * SUBPATH-RESOLUTION + CROSS-PACKAGE RUNTIME-SMOKE guard.
 *
 * Two forward-carried CI invariants converge here:
 *
 *   CI-001 (build-verification pillar): the package PUBLIC surface — the 12
 *   importable JS modules declared in package.json exports plus the produced
 *   ui.css static file — must actually RESOLVE from the BUILT dist, not from
 *   src. The vitest config aliases every codex-ouronet subpath specifier back
 *   onto src (source-resolution for the behavioural suites), so importing by
 *   package specifier here would prove nothing about the build. This guard
 *   therefore imports each module by its EXPLICIT built dist/NAME/index.js
 *   path — the one form the src-aliases cannot shadow — so a green run is genuine
 *   evidence the T4.1 build emitted a resolvable artifact for every export key.
 *
 *   CI-002 (cross-package runtime smoke): the chain primitives (the stoachain
 *   scope) were dropped as source aliases in the lift out of stoa-js; they now
 *   resolve from the registry dist under node_modules/@stoachain/NAME/dist via
 *   each package own exports map. Loading the POPULATED codex-ouronet dist
 *   barrels (which transitively import a wide stoachain subpath surface —
 *   stoa-core crypto/reads/signing/wallet/constants/guard/pact, ouronet-core
 *   codex/pact/constants/interactions, dalos-crypto registry/gen, and
 *   kadena-stoic-legacy hd-wallet/cryptography-utils) forces every one of those
 *   subpaths to resolve at RUNTIME. A subpath with a types export but no runtime
 *   export surfaces HERE as a module-resolution throw. This proves Vite/vitest
 *   exports-aware resolution of the built dist against the registry — honest
 *   runtime evidence, not a type-only check.
 *
 * SCOPE (CI-004 honesty): this guard asserts RESOLUTION only. It does NOT assert
 * hook shapes, store invariants, or codec behaviour — those belong to sibling
 * guards. It authors NO src change: a resolution failure here is a build defect
 * (T4.1) or a cross-package registry-dist export gap (escalate upstream), never a
 * defect to patch in relocated source.
 */

import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";

const testDir = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(testDir, "..");
const distDir = resolve(pkgRoot, "dist");

// Explicit built path for a subpath's JS entry. Deliberately NOT the package
// specifier: the vitest src-aliases rewrite `@ancientpantheon/codex-ouronet/<x>`
// to `src/`, so only this relative-to-dist form verifies the BUILD.
const distEntry = (subdir: string): string => resolve(distDir, subdir, "index.js");
const distRootEntry = resolve(distDir, "index.js");

// The 12 importable JS modules = bare root + the 11 JS subpaths from the exports
// map. `./ui.css` is excluded (it is a static file, asserted separately).
const JS_SUBPATHS = [
  "adapters",
  "provider",
  "hooks",
  "components",
  "resolver",
  "errors",
  "codex-identity",
  "ui",
  "types",
  "google-drive",
  "zbom",
] as const;

// Root and /google-drive are byte-faithful `export {};` stubs (google-drive is a
// Phase-6 placeholder). They RESOLVE to a module object but carry ZERO own exports
// BY DESIGN — requiring exports here would false-fail or pressure corrupting the
// lift. Every OTHER JS module must carry ≥1 own export.
const EMPTY_BARREL_SUBPATHS = new Set<string>(["google-drive"]);

const ownExportCount = (mod: Record<string, unknown>): number =>
  Object.keys(mod).filter((k) => k !== "default" || mod.default !== undefined).length;

// The populated barrels (provider, hooks, state) pull a large cross-package graph
// (the Zustand store + the full @stoachain/* crypto/interactions surface + React
// 19) whose FIRST cold Vite transform legitimately exceeds vitest's 5s default.
// This is transform latency for real work, not a hang — a generous ceiling lets
// the genuine resolution complete instead of false-failing on a timer.
const RESOLVE_TIMEOUT_MS = 60_000;

describe("T4.1 build precondition", () => {
  it("HALTS if the built dist/ is absent (build-verification cannot run against src)", () => {
    // Fail-visible precondition: every downstream assertion imports from dist. If
    // the build never ran, say so loudly rather than silently resolving src.
    expect(
      existsSync(distDir),
      "T4.1 build precondition unmet: packages/codex-ouronet/dist/ is missing — run the T4.1 build first",
    ).toBe(true);
    expect(
      existsSync(distRootEntry),
      "T4.1 build precondition unmet: dist/index.js is missing",
    ).toBe(true);
  });
});

describe("CI-001 · 12 importable modules resolve from the BUILT dist", () => {
  it("resolves the bare root (`.`) as a module object — empty `export {};` barrel, exports NOT required", async () => {
    // The root is an intentional byte-faithful stub. Prove it resolves without a
    // module-resolution throw; do NOT demand exports (that would false-fail).
    expect(existsSync(distRootEntry), "dist/index.js missing").toBe(true);
    const mod = await import(/* @vite-ignore */ distRootEntry);
    expect(mod, "root dist/index.js did not resolve to a module object").toBeTypeOf("object");
  }, RESOLVE_TIMEOUT_MS);

  it.each(JS_SUBPATHS)(
    "resolves `./%s` from its dist/index.js to a module object",
    async (subpath) => {
      const entry = distEntry(subpath);
      expect(existsSync(entry), `dist/${subpath}/index.js is MISSING (unresolvable subpath)`).toBe(true);
      const mod = await import(/* @vite-ignore */ entry);
      expect(mod, `./${subpath} did not resolve to a module object`).toBeTypeOf("object");
    },
    RESOLVE_TIMEOUT_MS,
  );

  it.each(JS_SUBPATHS.filter((s) => !EMPTY_BARREL_SUBPATHS.has(s)))(
    "yields ≥1 own export from `./%s` (populated barrel — empty would mean a lost re-export)",
    async (subpath) => {
      const mod = await import(/* @vite-ignore */ distEntry(subpath));
      expect(
        ownExportCount(mod as Record<string, unknown>),
        `./${subpath} resolved but exposed ZERO own exports — a populated barrel must re-export at least one symbol`,
      ).toBeGreaterThanOrEqual(1);
    },
    RESOLVE_TIMEOUT_MS,
  );

  it("treats `./google-drive` as an empty `export {};` barrel (resolves, exports NOT required)", async () => {
    // Phase-6 placeholder: byte-faithful empty stub. Resolution proves the export
    // key is wired; demanding exports would false-fail the intentional stub.
    const mod = await import(/* @vite-ignore */ distEntry("google-drive"));
    expect(mod, "./google-drive did not resolve to a module object").toBeTypeOf("object");
  }, RESOLVE_TIMEOUT_MS);
});

describe("CI-001 · ./ui.css is a produced STATIC FILE (not an ES module)", () => {
  const exportsMap = JSON.parse(
    readFileSync(resolve(pkgRoot, "package.json"), "utf8"),
  ).exports as Record<string, unknown>;

  it("maps exports['./ui.css'] to ./dist/ui.css (a static path string, not a conditions object)", () => {
    // CSS is not an ES module — a WRONG guard would `import("...ui.css")`. Proof is
    // the export key present as a plain path plus the emitted static file existing.
    expect(exportsMap["./ui.css"], "exports['./ui.css'] must map to the built static file").toBe(
      "./dist/ui.css",
    );
  });

  it("emits the static dist/ui.css file", () => {
    expect(
      existsSync(resolve(distDir, "ui.css")),
      "dist/ui.css static file was not produced by the build",
    ).toBe(true);
  });
});

describe("CI-001 · /state is a PUBLIC type-only contract (D5 store-seam)", () => {
  const exportsMap = JSON.parse(
    readFileSync(resolve(pkgRoot, "package.json"), "utf8"),
  ).exports as Record<string, { types?: string; import?: string }>;

  it("has a './state' key resolving to the built state dist", () => {
    // D5's store-seam contract (conductor Option A): codex-ui pins its injected
    // `createStore` seam to the CALLABLE `CodexStore` type exported from
    // `@ancientpantheon/codex-ouronet/state`. That requires `./state` to be a
    // PUBLIC export so a downstream/isolated tsc can resolve the type contract.
    // The RUNTIME store is still injected (consumers go through hooks); this key
    // exists for the type-only seam + the ported state/guard/resolver test tree.
    expect("./state" in exportsMap, "'./state' must be a public export key").toBe(true);
    const entry = exportsMap["./state"];
    expect(entry?.types).toBe("./dist/state/index.d.ts");
    expect(entry?.import).toBe("./dist/state/index.js");
  });
});

describe("CI-002 · cross-package runtime smoke — @stoachain/* resolves from the registry dist", () => {
  // These POPULATED subpath dist barrels transitively import the widest
  // `@stoachain/*` subpath surface. Importing the empty root would prove nothing;
  // these force stoa-core/ouronet-core/dalos-crypto/kadena-stoic-legacy subpaths to
  // resolve at RUNTIME. A registry-dist export gap (types-only subpath, missing
  // runtime entry) surfaces here as a module-resolution throw.
  const POPULATED_STOACHAIN_CARRIERS = [
    "resolver",
    "provider",
    "codex-identity",
    "zbom",
    "hooks",
  ] as const;

  it.each(POPULATED_STOACHAIN_CARRIERS)(
    "loads dist/%s/index.js WITHOUT a cross-package resolution error (forces @stoachain/* runtime resolution)",
    async (subpath) => {
      const mod = await import(/* @vite-ignore */ distEntry(subpath));
      expect(
        mod,
        `./${subpath} failed to load — a transitive @stoachain/* subpath did not resolve from the registry dist`,
      ).toBeTypeOf("object");
      expect(
        ownExportCount(mod as Record<string, unknown>),
        `./${subpath} loaded but re-exported nothing — its @stoachain/*-backed surface is empty`,
      ).toBeGreaterThanOrEqual(1);
    },
    RESOLVE_TIMEOUT_MS,
  );

  it("exercises the PRIVATE state module via its EXPLICIT dist path (never the exports map)", async () => {
    // `@ancientpantheon/codex-ouronet/state` would throw ERR_PACKAGE_PATH_NOT_EXPORTED
    // (it is intentionally not public). The private state store carries the widest
    // @stoachain/* surface (crypto keygen, guard, interactions), so loading it by
    // explicit built path is the strongest cross-package runtime smoke available.
    const stateEntry = distEntry("state");
    expect(existsSync(stateEntry), "dist/state/index.js missing — private state module not built").toBe(true);
    const mod = await import(/* @vite-ignore */ stateEntry);
    expect(mod, "private state module failed to load — a @stoachain/* subpath did not resolve").toBeTypeOf(
      "object",
    );
    expect(
      ownExportCount(mod as Record<string, unknown>),
      "private state module loaded but exposed no exports",
    ).toBeGreaterThanOrEqual(1);
  }, RESOLVE_TIMEOUT_MS);
});
