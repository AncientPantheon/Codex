// @vitest-environment node
/**
 * E4 RED matrix — the REAL BUNDLE-EMIT tree-shake gate (E-12 / N-08 — FIX-2 /
 * F-002 / F-3 / F-4 — the acceptance-gated packaging gate).
 *
 * THE TURBO ASSERTIONS WERE INVERTED (browser-safe-release, 2026-11). They are
 * kept, not deleted, because the specifier's absence is now the contract:
 *
 *   - `@ardrive/turbo-sdk` = GONE FROM THE GRAPH, every entry, light AND heavy.
 *     It used to be asserted PRESENT on the panel entry (old assertion (d)) to
 *     demonstrate the light/heavy split — a dynamic-import boundary in
 *     `panel/lazyDeps.ts` (`loadTurbo`) that nothing ever called. That proof
 *     was the entire cause of the 1.6.0 consumer break: a dynamic `import()`
 *     defers EXECUTION but does not remove the specifier, so a browser bundler
 *     still had to resolve `@ardrive/turbo-sdk` and emit a chunk for it
 *     (Turbopack: `the chunking context does not support external modules
 *     (request: node:stream/promises)`). The real upload path is arbundles
 *     ANS-104 via arweave-core, which has zero Turbo references. `loadTurbo`,
 *     `TurboSdkModule`, the re-export and the dependency were all deleted, so
 *     these assertions now pin ABSENCE EVERYWHERE — they are the regression
 *     guard that stops the specifier coming back under any import form.
 *   - `arweave` = a STATIC arweave-core edge (sign.ts:31 / transfer.ts:37),
 *     dropped from a light bundle ONLY by a real bundler tree-shaking
 *     arweave-core's `sideEffects:false` barrel. UNCHANGED — this is now the
 *     sole mechanism the light/heavy split is demonstrated with, and
 *     assertion (c)'s negative control is what keeps it non-vacuous.
 *
 * SCOPE NOTE: this gate measures TREE-SHAKING at `platform:"node"`, so it can
 * never see `node:*` leakage from a dependency. Browser-safety is a different
 * question with a different tool:
 * `packages/codex/scripts/browser-safety-guard.mjs`.
 *
 * The gate is a REAL esbuild emit (`treeShaking:true` + `metafile:true`), NOT a
 * `src`-lexer walk (which would false-FAIL on the static `arweave` edge). It runs
 * over the EMITTED/BUNDLED light entry, NOT raw src.
 *
 * METRIC = RETAINED OUTPUT, not the crawl (measurement-bug correction, E4):
 * `emitBundle` returns the modules that ACTUALLY SURVIVED tree-shaking into the
 * emitted bundle (derived from `metafile.outputs[out].inputs` filtered to
 * `bytesInOutput > 0`), NOT `Object.keys(metafile.inputs)`. `metafile.inputs`
 * records every module esbuild PARSES/CRAWLS — a module re-exported by a
 * `sideEffects:false` barrel stays in `metafile.inputs` even when the tree-shaker
 * drops all its bytes, so the crawl-based metric would false-report `arweave`/
 * `turbo` present on the LIGHT entry (this was proven, and is the bug this gate
 * now corrects). Retained-output is what "bundled" actually means and what
 * reflects the tree-shake. The helper also externalizes node builtins + the
 * uninstalled optional Turbo signer peers so the heavy fixtures can emit at all —
 * an external is BY DEFINITION not bundled, the correct gate semantics.
 *
 * PINNED CONTRACT (so T14.11's `scripts/treeshake-bundle.mjs` matches):
 *   - helper path: `../scripts/treeshake-bundle.mjs`
 *   - `emitBundle(entryAbsPath: string): Promise<{ inputKeys: string[] }>`
 *     — runs esbuild `build({ entryPoints:[entry], bundle:true, treeShaking:true,
 *       metafile:true, write:false, format:"esm" })` with node-builtin +
 *       unresolvable-peer externalization, and returns the RETAINED-OUTPUT module
 *       paths (POSIX-normalized). `inputKeys` is kept as the array name for
 *       continuity; its members are retained-output modules, not the raw crawl.
 *
 * F-4: the `arweave` package is matched as a PATH SEGMENT (`node_modules/arweave/`),
 * NOT a bare `.includes("arweave")` substring — `@ancientpantheon/arweave-core` is
 * legitimately in the light bundle and a substring match would false-FAIL.
 *
 * `// @vitest-environment node` (FIX-9): esbuild emit is node-only.
 *
 * GREEN owner: T14.11 (`scripts/treeshake-bundle.mjs` retained-output helper +
 * the light `src/index.ts` root). The panel subpath statically reaches the heavy
 * boundary, so its emitted bundle retains the static arweave edge — that is what
 * makes assertion (d) the real light/heavy split, not a global drop.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// RED: the bundle-emit helper does not exist yet (T14.11 GREEN).
import { emitBundle } from "../scripts/treeshake-bundle.mjs";

const THIS_FILE = fileURLToPath(import.meta.url);
const HERE = dirname(THIS_FILE);

const LIGHT_FIXTURE = join(HERE, "fixtures", "treeshake", "light-consumer.fixture.ts");
const HEAVY_FIXTURE = join(HERE, "fixtures", "treeshake", "heavy-consumer.fixture.ts");
const PANEL_ENTRY = join(HERE, "..", "src", "panel", "index.ts");

/** Turbo is matched by its package specifier. It must now be absent from EVERY
 *  bundle: the package was removed from the graph entirely, so no reached path —
 *  static, or an inlined dynamic `import()` — can contribute its bytes anywhere.
 *  `inputKeys` is already POSIX-normalized by the helper, but we re-normalize
 *  defensively. */
const hasTurbo = (inputKeys: string[]): boolean =>
  inputKeys.some((k) => k.replace(/\\/g, "/").includes("@ardrive/turbo-sdk"));

/** F-4: match the bare `arweave` package as a PATH SEGMENT, never a substring —
 *  `@ancientpantheon/arweave-core` is legitimately present and must NOT trip this. */
const hasBareArweave = (inputKeys: string[]): boolean =>
  inputKeys.some((k) => k.replace(/\\/g, "/").includes("node_modules/arweave/"));

describe("tree-shake gate — the file carries the node-env pragma (FIX-9)", () => {
  it("has `// @vitest-environment node` on line 1 (esbuild emit is node-only)", () => {
    const src = readFileSync(THIS_FILE, "utf8");
    expect(src.split("\n")[0].trim()).toBe("// @vitest-environment node");
  });
});

describe("REAL bundle-emit tree-shake gate (E-12/N-08, FIX-2)", () => {
  it("(a) the LIGHT-only consumer bundle excludes BOTH @ardrive/turbo-sdk AND the bare arweave package", async () => {
    const { inputKeys } = await emitBundle(LIGHT_FIXTURE);

    // Turbo is absent — now for the stronger reason that the specifier no
    // longer exists anywhere in the package, not because a lazy boundary went
    // unreached. See (d) for the inversion and why it was made.
    expect(hasTurbo(inputKeys)).toBe(false);
    // The static arweave edge is tree-shaken OUT of the emitted bundle — the
    // sideEffects:false barrel's unused heavy re-exports contribute zero bytes.
    expect(hasBareArweave(inputKeys)).toBe(false);
    // Sanity: the light bundle DID retain arweave-core's own light modules (proves
    // the emit actually ran + the F-4 path-segment match is meaningful, not vacuous).
    expect(
      inputKeys.some((k) => k.replace(/\\/g, "/").includes("arweave-core")),
    ).toBe(true);
  });

  it("(c) NEGATIVE CONTROL (F-3, REQUIRED): the heavy-consumer fixture (static createArweaveAdapter) MUST make the absence assertion FAIL — proving the gate is non-vacuous", async () => {
    const { inputKeys } = await emitBundle(HEAVY_FIXTURE);

    // A consumer importing createArweaveAdapter LEGITIMATELY RETAINS the static
    // arweave edge in its emitted bundle. If this did NOT retain arweave, the gate
    // would be vacuous (it would "pass" on the light fixture for the wrong reason
    // — e.g. if the metric silently dropped ALL packages). So the negative control
    // asserts arweave IS retained here — the same absence assertion (a) uses would
    // FAIL against this bundle.
    expect(hasBareArweave(inputKeys)).toBe(true);
  });

  it("(d) the PANEL entry retains the static arweave edge (the split is real, not a global drop) and — INVERTED, browser-safe-release — NO LONGER retains @ardrive/turbo-sdk anywhere", async () => {
    const { inputKeys } = await emitBundle(PANEL_ENTRY);

    // UNCHANGED half: the panel subpath is the HEAVY entry — it statically
    // reaches `lazyDeps.ts`'s default runtime, so its emitted bundle RETAINS the
    // static arweave edge that runtime composes (send/upload). Retained here,
    // absent on the light entry — the split is real, not a global drop. This
    // single mechanism now carries the whole light/heavy claim.
    expect(hasBareArweave(inputKeys)).toBe(true);

    // INVERTED half (was `.toBe(true)`), kept rather than deleted so the reason
    // stays pinned to the assertion: Turbo being RETAINED on the heavy entry was
    // the demonstration that caused the 1.6.0 break. `loadTurbo()` existed only
    // to prove "Turbo is reachable exclusively behind a dynamic import()", and
    // this assertion pinned that proof in place — but a dynamic `import()` is
    // not an escape hatch. The consumer's bundler still had to RESOLVE
    // `@ardrive/turbo-sdk` and emit a browser chunk for turbo's Node build
    // (`node:stream/promises`, `fs`, `node:stream`). Nothing ever called
    // `loadTurbo`; the real upload path is arbundles ANS-104 via arweave-core.
    // The whole specifier was deleted, so the heavy entry must now be as free of
    // it as the light one. If this ever flips back to `true`, the exact bug that
    // shipped in 1.6.0 (and, for arbundles, in 1.5.2) has returned.
    expect(hasTurbo(inputKeys)).toBe(false);
  });

  it("(b) @ardrive/turbo-sdk is absent from EVERY entry — light, heavy fixture and panel alike — because the specifier was deleted, not merely deferred", async () => {
    // Was: "the two mechanisms are distinct — Turbo absence from the LIGHT bundle
    // is the dynamic-import exclusion". There is no second mechanism any more, so
    // this case was repurposed (not deleted) into the broadest statement of the
    // new contract: the package name appears in no bundle this package can emit.
    // Checking all three entries is what makes it a real guard — the old version
    // checked only the light fixture, where Turbo was absent anyway, which is
    // precisely why its heavy-entry presence went unquestioned for two releases.
    for (const entry of [LIGHT_FIXTURE, HEAVY_FIXTURE, PANEL_ENTRY]) {
      const { inputKeys } = await emitBundle(entry);
      expect(hasTurbo(inputKeys)).toBe(false);
    }
  });
});
