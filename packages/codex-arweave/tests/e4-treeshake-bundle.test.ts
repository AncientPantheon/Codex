// @vitest-environment node
/**
 * E4 RED matrix — the REAL BUNDLE-EMIT tree-shake gate (E-12 / N-08 — FIX-2 /
 * F-002 / F-3 / F-4 — the acceptance-gated packaging gate).
 *
 * TWO distinct heavy deps with TWO distinct exclusion mechanisms:
 *   - `@ardrive/turbo-sdk` = dynamic-import boundary (`await import` at
 *     arweave-core upload.ts:89) — the LOAD-BEARING, strongest-provable claim.
 *   - `arweave` = a STATIC arweave-core edge (sign.ts:31 / transfer.ts:37),
 *     dropped from a light bundle ONLY by a real bundler tree-shaking
 *     arweave-core's `sideEffects:false` barrel.
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
 * `src/panel/lazyDeps.ts` dynamic-import boundary + the light `src/index.ts` root).
 * The panel subpath statically reaches the lazy heavy boundary, so its emitted
 * bundle retains the (inlined dynamic) Turbo + the static arweave edge — that is
 * what makes assertion (d) the real light/heavy split, not a global drop.
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

/** Turbo is matched by its package specifier; it is RETAINED in the emitted
 *  bundle only when a reached path (static or an inlined dynamic `import()`)
 *  actually contributes its bytes. `inputKeys` is already POSIX-normalized by
 *  the helper, but we re-normalize defensively. */
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

    // The load-bearing assertion: the light consumer's emitted bundle does NOT
    // RETAIN Turbo (its lazy boundary is never reached from the light surface).
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

  it("(d) the PANEL entry bundle DOES include the heavy deps — the light/heavy split is real, not a global drop", async () => {
    const { inputKeys } = await emitBundle(PANEL_ENTRY);

    // The panel subpath is the HEAVY entry — it statically reaches the lazy heavy
    // boundary (`lazyDeps.ts`), so its emitted bundle RETAINS the heavy runtime:
    // the inlined dynamic Turbo import AND the static arweave edge the default
    // runtime composes (send/upload). Both retained here; both absent on the light
    // entry — the split is real, not a global drop.
    expect(hasBareArweave(inputKeys)).toBe(true);
    expect(hasTurbo(inputKeys)).toBe(true);
  });

  it("(b) the two mechanisms are distinct: the load-bearing claim is @ardrive/turbo-sdk ABSENCE from the light bundle (dynamic-import excluded); arweave absence is the tree-shaken static edge", async () => {
    const { inputKeys } = await emitBundle(LIGHT_FIXTURE);
    // Restated as the pinned mechanism split: Turbo (dynamic) MUST be absent; this
    // is the strongest provable claim and the one the gate rests on.
    expect(hasTurbo(inputKeys)).toBe(false);
  });
});
