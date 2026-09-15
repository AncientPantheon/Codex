/**
 * tx-gas-meta-surface.test.ts — SHAPE/invariant lock for every signed-and-submitted
 * transaction-building site in this package.
 *
 * WHY THIS EXISTS
 * Chainweb rejects (or silently under-prices) a command whose `meta.gasPrice` is
 * below the live Yin Engine floor. Historically all 14 build sites here omitted
 * `gasPrice` entirely, so Pact's client default (1e-8) went out on the wire.
 *
 * `CodexSigningStrategy.execute()` (@stoachain/stoa-core >= 4.4.0) now performs ONE
 * clock read per execute() — `stoaGasMeta()` — and injects the resulting
 * `gasPrice` + `creationTime` into every `build(ctx)` callback, alongside the
 * `gasLimit` it already injected. The canonical fix for a site that builds through
 * the strategy is therefore to ACCEPT those fields from ctx and spread them into
 * `.setMeta({...})` — NOT to call `stoaGasMeta()` (or `safeCreationTime()`) again
 * inside the closure.
 *
 * The single-clock-read rule is load-bearing, not stylistic: the strategy invokes
 * `build()` TWICE (a simulation pass to measure gas, then the real pass). A fresh
 * `safeCreationTime()` per invocation yields a DIFFERENT `creationTime` between the
 * two, which changes the command hash / request key — the exact failure the
 * strategy's injected, memoised values exist to prevent.
 *
 * WHAT IS LOCKED (source-text scan, so it holds for sites a unit test can't easily
 * reach — these closures live inside heavy React modals):
 *   (a) inventory — exactly the 14 known `.setMeta(` sites exist. A NEW transaction
 *       site fails here until it is added below AND satisfies (b)-(d), so the gas
 *       contract can't be forgotten by a future modal.
 *   (b) every `.setMeta({...})` passes `gasPrice`.
 *   (c) every `.setMeta({...})` passes `creationTime`.
 *   (d) NO site re-reads the clock inside the build closure (`safeCreationTime` must
 *       not appear in these files at all) and no site hand-rolls `stoaGasMeta()`
 *       locally — both must come from the injected ctx.
 *   (e) each `build(` closure actually destructures `gasPrice` + `creationTime`.
 *
 * NOT LOCKED HERE: the two DELEGATING modals (zbom/modals/RotateGuardModal.tsx and
 * RotatePaymentKeyModal.tsx) build no command of their own — they call
 * `rotateGuard()` / `rotateKadenaPaymentKey()` in @ouronet/ouronet-core, which
 * applies `...stoaGasMeta(...)` itself. They legitimately have zero `.setMeta(`,
 * and the negative inventory assertion in (a) keeps them out.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

// `__dirname` (not import.meta.url) — matches structural-guards.test.ts; this
// package's vitest transform does not hand these specs a file: URL.
const SRC = resolve(__dirname, "../src");

/** The 14 confirmed signed/submitted transaction-building sites. Three operations
 *  (RotateSovereign, RotateGuard, RotatePaymentKey) exist as TWO independent copies
 *  across `components/` and `zbom/modals/` — they share no code, so both copies are
 *  listed and both must satisfy the gas contract. */
const EXPECTED_TX_SITES = [
  "components/RotateGuardModal.tsx",
  "components/RotatePaymentKeyModal.tsx",
  "components/RotateSovereignModal.tsx",
  "zbom/modals/ActivateApolloPythiaKeyModal.tsx",
  "zbom/modals/ActivateSmartAccountModal.tsx",
  "zbom/modals/ActivateStandardAccountModal.tsx",
  "zbom/modals/LinkDualApiKeyModal.tsx",
  "zbom/modals/RegisterStoicTagModal.tsx",
  "zbom/modals/ReleaseStoicTagModal.tsx",
  "zbom/modals/RenameDualLaneModal.tsx",
  "zbom/modals/RevokeDualLinkModal.tsx",
  "zbom/modals/RotateGovernorModal.tsx",
  "zbom/modals/RotateSovereignModal.tsx",
  "ui/internal/SendStoaModal.tsx",
].sort();

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

/** Extract the object-literal text of each `.setMeta({ ... })` call. Flat literals
 *  only (all sites are), matched by brace-depth from the opening `{`. */
function setMetaBodies(source: string): string[] {
  const bodies: string[] = [];
  const needle = ".setMeta(";
  let i = source.indexOf(needle);
  while (i !== -1) {
    const open = source.indexOf("{", i);
    if (open !== -1) {
      let depth = 0;
      for (let j = open; j < source.length; j++) {
        if (source[j] === "{") depth++;
        else if (source[j] === "}") {
          depth--;
          if (depth === 0) { bodies.push(source.slice(open, j + 1)); break; }
        }
      }
    }
    i = source.indexOf(needle, i + needle.length);
  }
  return bodies;
}

const files = walk(SRC);
const txSites = files
  .filter((f) => readFileSync(f, "utf8").includes(".setMeta("))
  .map((f) => relative(SRC, f).split("\\").join("/"))
  .sort();

describe("transaction gas-meta surface", () => {
  it("(a) locks the exact inventory of transaction-building sites", () => {
    // A new `.setMeta(` site must be added here deliberately — and then satisfy
    // the gasPrice/creationTime assertions below.
    expect(txSites).toEqual(EXPECTED_TX_SITES);
  });

  it.each(EXPECTED_TX_SITES)("%s passes gasPrice + creationTime into setMeta", (rel) => {
    const source = readFileSync(join(SRC, rel), "utf8");
    const bodies = setMetaBodies(source);
    expect(bodies.length).toBeGreaterThan(0);

    for (const body of bodies) {
      // (b) the live Yin floor must be on the wire, not Pact's 1e-8 default.
      expect(body, `${rel}: setMeta omits gasPrice`).toMatch(/\bgasPrice\b/);
      // (c) creationTime must be set explicitly.
      expect(body, `${rel}: setMeta omits creationTime`).toMatch(/\bcreationTime\b/);
    }
  });

  it.each(EXPECTED_TX_SITES)("%s takes gas fields from the injected ctx, not a local clock read", (rel) => {
    const source = readFileSync(join(SRC, rel), "utf8");

    // (d) re-reading the clock inside build() breaks the sim/real hash parity that
    //     the strategy's single stoaGasMeta() read guarantees.
    expect(source, `${rel}: must not re-read the clock — use ctx.creationTime`)
      .not.toMatch(/\bsafeCreationTime\b/);
    expect(source, `${rel}: must not call stoaGasMeta() locally — use ctx.gasPrice`)
      .not.toMatch(/\bstoaGasMeta\s*\(/);

    // (e) the build closure must actually accept the injected fields.
    const build = /build:\s*\(\{([^}]*)\}/.exec(source);
    expect(build, `${rel}: no build({...}) closure found`).not.toBeNull();
    expect(build![1], `${rel}: build ctx does not destructure gasPrice`).toMatch(/\bgasPrice\b/);
    expect(build![1], `${rel}: build ctx does not destructure creationTime`).toMatch(/\bcreationTime\b/);
  });
});
