/**
 * No-value-chain-edge proof for the D5 MOVE-set relocated into codex-ui.
 *
 * The carve's load-bearing invariant (D-09, N-08, the T9.9 graph guard): NO file
 * under codex-ui/src carries a VALUE `@stoachain/*`, `../zbom/*`, or Ouronet
 * `state/store` import. `import type` from either is fine — it is erased at
 * compile under verbatimModuleSyntax and creates no runtime/bundle edge. This
 * suite greps every moved source file and asserts the value edge is absent, and
 * that the tokens.css stylesheet relocated as the `ui.css` artifact source is
 * present + wired to T9.2's build copy step.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const SRC = resolve(__dirname, "../src");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = resolve(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

// Every moved .ts/.tsx under src (the relocated MOVE-set + the slot shells +
// the barrels). Test files live under tests/, so they are not scanned here.
const movedFiles = existsSync(SRC) ? walk(SRC) : [];

// A VALUE import = an `import ... from "<mod>"` line that is NOT `import type`.
// `import type { X } from "@stoachain/..."` is erased and permitted.
const valueImportFrom = (mod: string) =>
  new RegExp(String.raw`^\s*import\s+(?!type\b)[^;]*from\s+["'][^"']*${mod}`, "m");

describe("codex-ui MOVE-set — no VALUE @stoachain/zbom/store edge", () => {
  it("scans at least the relocated leaf set (guards against an empty glob)", () => {
    // If this collapses to ~0 the walk broke and the edge checks would vacuously
    // pass — pin a floor so the suite fails loud instead.
    expect(movedFiles.length).toBeGreaterThanOrEqual(25);
  });

  it("no moved file has a VALUE @stoachain import", () => {
    const offenders = movedFiles.filter((f) =>
      valueImportFrom("@stoachain").test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("no moved file has a VALUE zbom import", () => {
    const offenders = movedFiles.filter((f) =>
      valueImportFrom("zbom").test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("no moved file value-imports the Ouronet Zustand store or InternalCodexResolver", () => {
    const offenders = movedFiles.filter((f) => {
      const src = readFileSync(f, "utf8");
      return (
        /from\s+["'][^"']*state\/store/.test(src) ||
        /from\s+["'][^"']*resolver\/InternalCodexResolver/.test(src)
      );
    });
    expect(offenders).toEqual([]);
  });

  it("no moved file value-imports the STAY encryptionState helper (transitive @stoachain edge)", () => {
    // encryptionState.ts value-imports @stoachain/stoa-core/crypto and STAYS
    // Ouronet-side, so CodexInfoCard/EncryptionCard (its only consumers) were NOT
    // relocated. Assert nothing under codex-ui pulls it back in.
    const offenders = movedFiles.filter((f) =>
      /from\s+["'][^"']*encryptionState/.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("any @ancientpantheon/codex-ouronet reference is TYPE-ONLY (erased, no runtime edge)", () => {
    const valueOuronet = valueImportFrom("@ancientpantheon/codex-ouronet");
    const offenders = movedFiles.filter((f) => valueOuronet.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});

describe("tokens.css → ui.css artifact source", () => {
  it("tokens.css relocated into codex-ui/src/ui carrying the --codex-* contract", () => {
    const tokens = resolve(SRC, "ui/tokens.css");
    expect(existsSync(tokens)).toBe(true);
    const css = readFileSync(tokens, "utf8");
    expect(css).toContain("--codex-bg");
    expect(css).toContain("--codex-accent");
    expect(css).toContain(".codex-ui");
    expect(css).toContain(":root");
  });

  it("is compiled into the self-contained dist/ui.css by the build:css step (tokens + Tailwind utilities)", () => {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf8"));
    // Variant B: `build:css` runs Tailwind over tw-utilities.css and prepends
    // tokens.css → a self-contained dist/ui.css (no Tailwind needed downstream).
    expect(pkg.scripts["build:css"]).toContain("tw-utilities.css");
    expect(pkg.scripts["build:css"]).toContain("tokens.css");
    expect(pkg.scripts.build).toContain("build:css");
    expect(pkg.exports["./ui.css"]).toBe("./dist/ui.css");
  });
});
