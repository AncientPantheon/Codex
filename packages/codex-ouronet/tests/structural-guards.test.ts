/**
 * structural-guards.test.ts — the D5 post-carve REGRESSION + DEPENDENCY-GRAPH
 * guard (the RED author half of T9.9 that lives Ouronet-side).
 *
 * Two concerns, one file (both re-asserted from the PACKAGE BOUNDARY after the
 * codex-ui carve + codex-ouronet rewire):
 *
 *   A. THE FOUR SINGULAR STRUCTURAL INVARIANTS (N-09) — the C4 guards must still
 *      throw after the store STAYS Ouronet-side and is injected into codex-ui's
 *      provider. Driven through PUBLIC store/identity actions (kickstart, add*,
 *      delete*, rename*, rotate*, getCodexIdentity) — never internal pokes.
 *      These may go GREEN early (the store already exists at author time); that
 *      is fine — they exist to catch a REGRESSION the carve/rewire could cause.
 *
 *   B. THE THREE-PACKAGE DEPENDENCY GRAPH (D-09/N-08) — a static import-scan over
 *      the three `src/` trees that distinguishes `import type` (erased, OK) from
 *      a VALUE `import` (a runtime/bundle edge, FORBIDDEN across the carve
 *      boundary). This is RED-FIRST for the "codex-ui carries no VALUE
 *      @stoachain/Ouronet import" assertion in the sense that it is authored to
 *      pass VACUOUSLY now (codex-ui/src is `export {}`) and to KEEP passing as
 *      T9.3-T9.6 land files — a value edge sneaking in during the carve fails it.
 *
 * The load-bearing rule the graph guard encodes: NOT "zero imports of any kind"
 * from @stoachain/codex-ouronet — a type-only `import type { IStoaChainKeypair }
 * from "@stoachain/…"` is PERMITTED (erased under verbatimModuleSyntax). Only a
 * VALUE `import { X } from "@stoachain/…"` is a violation.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

import { createCodexStore } from "@ancientpantheon/codex-ouronet/state";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import type { CodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import {
  CodexPrimeProtectedError,
  CodexPrimeSeedProtectedError,
  CodexGuardError,
} from "@ancientpantheon/codex-ouronet/errors";
import type {
  KickstartArgsV3,
  KickstartResultV3,
} from "@ancientpantheon/codex-ouronet/codex-identity";

// ─────────────────────────────────────────────────────────────────────────────
// A. THE FOUR SINGULAR STRUCTURAL INVARIANTS (N-09) — survive carve + rewire
// ─────────────────────────────────────────────────────────────────────────────

const PW = "structural-guards-password";
// encryptStringV2 (PBKDF2-SHA512/600k) runs several times per kickstart.
const T = { timeout: 120_000 };

const WORDS_12 =
  "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima";
const KADENA_MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon " +
  "abandon abandon abandon abandon abandon abandon abandon abandon " +
  "abandon abandon abandon abandon abandon abandon abandon art";

function kickstartArgs(): KickstartArgsV3 {
  return {
    codexIdSeed: { mode: "words", value: WORDS_12 },
    codexPrimeSeed: { source: "reuse-codexid-whole" },
    duoPrime: { mode: "kadena-seed", seedType: "koala", mnemonic: KADENA_MNEMONIC },
  };
}

let adapter: CodexAdapter;
let store: ReturnType<typeof createCodexStore>;

async function freshKickstartedStore(): Promise<KickstartResultV3> {
  adapter = new MemoryCodexAdapter("dev");
  store = createCodexStore();
  await store.getState().actions.init(adapter, "dev");
  store.getState().actions.authenticate(PW, 60);
  const r = await store.getState().actions.kickstartCodex(kickstartArgs());
  return r as KickstartResultV3;
}

describe("post-carve invariants — the four structural guards still throw (N-09)", () => {
  let kick: KickstartResultV3;
  beforeEach(async () => {
    kick = await freshKickstartedStore();
  }, T.timeout);

  it("(a) the Prime Codex Seed stays structurally undeletable after the carve", T, async () => {
    const primeId = kick.primeCodexSeed!.id;
    await expect(
      store.getState().actions.deleteStoaChainSeed(primeId),
    ).rejects.toBeInstanceOf(CodexPrimeSeedProtectedError);
    expect(store.getState().kadenaSeeds.some((s) => s.id === primeId)).toBe(true);
  });

  it("(b) the CodexPrime ouro account stays undeletable after the carve", T, async () => {
    const primeId = kick.codexPrime.id;
    await expect(
      store.getState().actions.deleteOuroAccount(primeId),
    ).rejects.toBeInstanceOf(CodexPrimeProtectedError);
    expect(store.getState().ouroAccounts.some((a) => a.id === primeId)).toBe(true);
  });

  it("(c) the active CodexGuard stays LABEL-LOCKED and UNDELETABLE after the carve", T, async () => {
    await expect(
      store.getState().actions.renamePureKeypair(kick.codexGuard.id, "MyGuard"),
    ).rejects.toMatchObject({ name: "CodexGuardError", reason: "rename-rejected" });
    await expect(
      store.getState().actions.deletePureKeypair(kick.codexGuard.id),
    ).rejects.toBeInstanceOf(CodexGuardError);
    // Neither the rejected rename nor the rejected delete mutated the guard.
    const guard = store
      .getState()
      .pureKeypairs.find((k) => k.id === kick.codexGuard.id);
    expect(guard!.label).toBe("CodexGuard");
  });

  it("(c') CodexGuard rotation transfers the active flag AND keeps history forever", T, async () => {
    const oldGuardId = kick.codexGuard.id;
    const { newGuard, retired } = await store.getState().actions.rotateCodexGuard();

    expect(newGuard.isCodexGuard).toBe(true);
    expect(newGuard.id).not.toBe(oldGuardId);
    expect(retired.id).toBe(oldGuardId);
    expect(retired.wasCodexGuard).toBe(true);

    const active = store
      .getState()
      .pureKeypairs.filter((k) => k.isCodexGuard === true && k.wasCodexGuard !== true);
    expect(active).toHaveLength(1);
    expect(active[0]!.id).toBe(newGuard.id);
    // The retired key is demoted, not purged — history is kept.
    expect(
      store.getState().pureKeypairs.some((k) => k.id === oldGuardId),
    ).toBe(true);
  });

  it("(d) the double-Apollo identity is immutable — no public setter + re-kickstart rejected", T, async () => {
    const before = store.getState().actions.getCodexIdentity();
    expect(before).not.toBeNull();

    const actionNames = Object.keys(store.getState().actions);
    expect(actionNames).not.toContain("setCodexIdentity");
    expect(actionNames).not.toContain("updateCodexIdentity");

    await expect(
      store.getState().actions.kickstartCodex(kickstartArgs()),
    ).rejects.toMatchObject({
      name: "CodexKickstartError",
      reason: "already-kickstarted",
    });
    // The original identity object is untouched — same reference.
    expect(store.getState().actions.getCodexIdentity()).toBe(before);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B. THE THREE-PACKAGE DEPENDENCY GRAPH (D-09/N-08) — the import-type-aware scan
// ─────────────────────────────────────────────────────────────────────────────

const REPO_PACKAGES = resolve(__dirname, "../..");
const CORE_SRC = join(REPO_PACKAGES, "codex-core", "src");
const UI_SRC = join(REPO_PACKAGES, "codex-ui", "src");
const OURONET_SRC = join(REPO_PACKAGES, "codex-ouronet", "src");
const UI_PKG_JSON = join(REPO_PACKAGES, "codex-ui", "package.json");

/** Every `.ts`/`.tsx` file under a src tree (skips test files + non-source). */
function sourceFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry)) continue;
      if (/\.test\.tsx?$/.test(entry) || /\.d\.ts$/.test(entry)) continue;
      out.push(full);
    }
  };
  walk(root);
  return out;
}

/**
 * Every import/export-from STATEMENT in a source string, normalized to a single
 * line (multi-line specifier blocks collapsed), paired with its target module.
 * Returns `{ raw, module }` per statement whose target matches `moduleTest`.
 */
function importStatements(
  src: string,
  moduleTest: (mod: string) => boolean,
): Array<{ raw: string; module: string }> {
  // Collapse newlines inside brace-blocks so `import {\n a,\n b\n} from "x"`
  // is analyzed as one statement. A coarse but sufficient normalization for a
  // guard: join the whole file, then match import/export...from statements.
  const flat = src.replace(/\r?\n/g, " ");
  const re =
    /\b(?:import|export)\b[\s\S]*?\bfrom\s*["']([^"']+)["']/g;
  const out: Array<{ raw: string; module: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(flat)) !== null) {
    const module = m[1]!;
    if (moduleTest(module)) out.push({ raw: m[0]!, module });
  }
  return out;
}

/**
 * TRUE when an import statement carries a VALUE/RUNTIME edge (a real bundle
 * dependency), FALSE when it is fully type-only (erased at compile).
 *
 * Rules:
 *   - `import type … from "x"` / `export type … from "x"` → type-only (erased).
 *   - `import "x"` (side-effect only, no bindings) → VALUE (runtime edge).
 *   - `import { type A, type B } from "x"` (EVERY named specifier prefixed
 *     `type`) → type-only.
 *   - any other binding (default, namespace, or a non-`type` named specifier)
 *     → VALUE.
 */
function isValueImport(raw: string): boolean {
  // `import type` / `export type` — whole statement is erased.
  if (/^\s*(?:import|export)\s+type\b/.test(raw)) return false;

  const braceMatch = raw.match(/\{([\s\S]*)\}/);
  const hasNamespace = /\*\s+as\s+/.test(raw);
  // A default/namespace binding before the brace (or a bare namespace import)
  // is always a value binding.
  const beforeBrace = raw.slice(0, braceMatch ? raw.indexOf("{") : raw.length);
  const hasDefaultOrNs =
    hasNamespace || /\bimport\s+[A-Za-z_$][\w$]*\s*(?:,|from)/.test(beforeBrace);
  if (hasDefaultOrNs) return true;

  if (braceMatch) {
    const specifiers = braceMatch[1]!
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (specifiers.length === 0) return false; // `import {} from "x"` — no edge
    // Value if ANY specifier is not `type`-prefixed.
    return specifiers.some((s) => !/^type\s+/.test(s));
  }

  // No braces, not `import type`, no default/namespace binding → a bare
  // side-effect import `import "x"` (a runtime edge) — unless it is a
  // re-export `export … from` with no bindings captured above.
  return /\bimport\s+["']/.test(raw);
}

/** VALUE imports from any module matching `moduleTest`, across a src tree. */
function valueImportsFrom(
  root: string,
  moduleTest: (mod: string) => boolean,
): Array<{ file: string; module: string; raw: string }> {
  const hits: Array<{ file: string; module: string; raw: string }> = [];
  for (const file of sourceFiles(root)) {
    const src = readFileSync(file, "utf8");
    for (const stmt of importStatements(src, moduleTest)) {
      if (isValueImport(stmt.raw)) {
        hits.push({ file, module: stmt.module, raw: stmt.raw.trim() });
      }
    }
  }
  return hits;
}

const isStoachain = (mod: string): boolean => mod.startsWith("@stoachain/");
const isCodexOuronet = (mod: string): boolean =>
  mod === "@ancientpantheon/codex-ouronet" ||
  mod.startsWith("@ancientpantheon/codex-ouronet/");
const isCodexUi = (mod: string): boolean =>
  mod === "@ancientpantheon/codex-ui" ||
  mod.startsWith("@ancientpantheon/codex-ui/");
const isReactOrDom = (mod: string): boolean =>
  mod === "react" ||
  mod === "react-dom" ||
  mod.startsWith("react/") ||
  mod.startsWith("react-dom/");

describe("dependency graph — no reverse edges (core ← ui ← ouronet)", () => {
  it("codex-core/src imports NOTHING (value or type) from codex-ui or codex-ouronet", () => {
    // Core is the headless base — it must not reach UP the graph at all. Both a
    // value AND a type edge would invert the layering, so here we flag ANY
    // import statement (not just value ones).
    const offenders = sourceFiles(CORE_SRC).flatMap((file) => {
      const src = readFileSync(file, "utf8");
      return importStatements(src, (m) => isCodexUi(m) || isCodexOuronet(m)).map(
        (s) => ({ file, module: s.module }),
      );
    });
    expect(offenders).toEqual([]);
  });

  it("codex-core/src stays React/DOM-free and @stoachain-free (no runtime regression)", () => {
    const offenders = valueImportsFrom(
      CORE_SRC,
      (m) => isReactOrDom(m) || isStoachain(m),
    );
    expect(offenders).toEqual([]);
  });

  it("codex-ui/src has NO reverse VALUE edge into codex-ouronet", () => {
    // codex-ui may `import type` entity Views from codex-ouronet (erased) but
    // must carry NO value/runtime import from it (that would be a downward edge
    // pulling Ouronet into the generic shell).
    const offenders = valueImportsFrom(UI_SRC, isCodexOuronet);
    expect(offenders).toEqual([]);
  });
});

describe("dependency graph — codex-ui carries no VALUE @stoachain / Ouronet edge (import type OK)", () => {
  it("codex-ui/src has NO VALUE @stoachain import (type-only is permitted)", () => {
    // The load-bearing distinction: `import type { X } from "@stoachain/…"` is
    // fine (erased); a value `import { X } from "@stoachain/…"` is a real bundle
    // edge that defeats the chain-generic-shell purpose. Only value edges fail.
    const offenders = valueImportsFrom(UI_SRC, isStoachain);
    expect(offenders).toEqual([]);
  });

  it("the scan actually DISTINGUISHES import type from value import (self-check)", () => {
    // A meta-assertion so the guard cannot silently degrade into "no imports at
    // all". Prove the classifier lets a type-only @stoachain import pass and
    // flags a value one — otherwise a broken classifier would pass vacuously.
    expect(
      isValueImport('import type { IKadenaKeypair as IStoaChainKeypair } from "@stoachain/stoa-core/signing"'),
    ).toBe(false);
    expect(
      isValueImport('import { type A, type B } from "@stoachain/stoa-core"'),
    ).toBe(false);
    expect(
      isValueImport('import { signTx } from "@stoachain/stoa-core/signing"'),
    ).toBe(true);
    expect(
      isValueImport('import { type A, signTx } from "@stoachain/stoa-core"'),
    ).toBe(true);
    expect(
      isValueImport('import "@stoachain/stoa-core/side-effect"'),
    ).toBe(true);
    expect(
      isValueImport('import * as Stoa from "@stoachain/stoa-core"'),
    ).toBe(true);
  });
});

describe("dependency graph — allowed direction + frozen-package fence", () => {
  it("codex-ouronet/src does NOT re-import the frozen @stoachain/ouronet-codex (N-02)", () => {
    // The Ouronet package MAY consume @stoachain/{stoa-core,ouronet-core,…} from
    // the registry (allowed @ancientpantheon → @stoachain direction), but the
    // frozen live wallet package must never be pulled back in.
    const offenders = sourceFiles(OURONET_SRC).flatMap((file) => {
      const src = readFileSync(file, "utf8");
      return importStatements(
        src,
        (m) => m === "@stoachain/ouronet-codex" || m.startsWith("@stoachain/ouronet-codex/"),
      ).map((s) => ({ file, module: s.module }));
    });
    expect(offenders).toEqual([]);
  });
});

describe("dependency graph — codex-ui package.json dependency shape (FIX-7)", () => {
  const pkg = JSON.parse(readFileSync(UI_PKG_JSON, "utf8")) as {
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    sideEffects?: unknown;
    exports?: Record<string, unknown>;
    files?: string[];
  };

  it("has NO react / react-dom in `dependencies` (they are peerDeps — duplicate-React breaks hooks)", () => {
    const deps = pkg.dependencies ?? {};
    expect(deps).not.toHaveProperty("react");
    expect(deps).not.toHaveProperty("react-dom");
  });

  it("declares react + react-dom as peerDependencies", () => {
    const peers = pkg.peerDependencies ?? {};
    expect(peers).toHaveProperty("react");
    expect(peers).toHaveProperty("react-dom");
  });

  it("keeps `zustand` as a real dependency (the provider mounts a store)", () => {
    const deps = pkg.dependencies ?? {};
    expect(deps).toHaveProperty("zustand");
  });

  it("has NO @stoachain/* nor codex-ouronet in `dependencies` (type-only devDep only)", () => {
    const deps = pkg.dependencies ?? {};
    const stray = Object.keys(deps).filter(
      (name) => isStoachain(name) || isCodexOuronet(name),
    );
    expect(stray).toEqual([]);
  });

  it("exposes the ./ui.css bare-string export and lists dist/ui.css in `files`", () => {
    const exportsMap = pkg.exports ?? {};
    expect(exportsMap["./ui.css"]).toBe("./dist/ui.css");
    expect(pkg.files ?? []).toContain("dist/ui.css");
  });

  it("sets sideEffects to preserve ui.css from tree-shaking (['**/*.css'])", () => {
    // T9.2 chose CSS-preserving sideEffects so ui.css is never dropped. Pin the
    // chosen value so a regression to `false` (which would tree-shake the sheet)
    // fails here.
    expect(pkg.sideEffects).toEqual(["**/*.css"]);
  });
});
