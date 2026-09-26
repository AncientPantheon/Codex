/**
 * tx-gas-meta-surface.test.ts — SHAPE/invariant lock for every signed-and-submitted
 * (or, as of 2026-09-26, dirty-read-only) transaction-building site in this package.
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
 *   (a) inventory — exactly the 15 known `.setMeta(` sites exist. A NEW transaction
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
 * `rotateGuard()` (still @ouronet/ouronet-core) / `rotateStoaChainPaymentKeyLive()`
 * (LOCAL, see below), both of which apply `...stoaGasMeta(...)` themselves. They
 * legitimately have zero `.setMeta(`, and the negative inventory assertion in (a)
 * keeps them out.
 *
 * `zbom/rotatePaymentKeyLive.ts` (added 2026-09-26, SELF_CONTAINED_TX_SITES below)
 * is the LOCAL replacement for `@ouronet/ouronet-core`'s `rotateKadenaPaymentKey`
 * (see that file's own header — `C_RotateKadena` no longer exists on mainnet).
 * It is a byte-for-byte mirror of the external function's OWN self-contained
 * dirtyRead→sign→submit pipeline, which predates and is independent of
 * `CodexSigningStrategy.execute()`'s ctx-injection contract — exactly like the
 * external file it replaces (never itself subject to this scan, being outside
 * `src/`). It still satisfies (a)-(c) — inventoried, `gasPrice` +
 * `creationTime` ARE on the wire — but is correctly exempt from (d)-(e), which
 * assume the `build(ctx)` shape only sites going through `execute()` have.
 *
 * `kadena/kadenaReads.ts` (added 2026-09-26, READ_ONLY_TX_SITES below) is
 * categorically DIFFERENT from every other site here: it is a DIRTY READ
 * (`createClient(url).dirtyRead(tx)`, `preflight: false, signatureVerification:
 * false`) against real Kadena mainnet — never signed, never submitted, never
 * touches consensus. This test's whole reason for existing ("Chainweb rejects
 * ... a command whose `meta.gasPrice` is below the live Yin Engine floor")
 * does not apply to a transaction that is never charged or network-validated
 * for its price — so unlike every other site, this one is exempt from BOTH
 * the (b)/(c) gasPrice+creationTime checks AND the (d)/(e) ctx-injection
 * checks. It is inventoried (a) purely so a future NEW `.setMeta(` site in
 * this file doesn't get silently miscategorized here by copy-paste.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

// `__dirname` (not import.meta.url) — matches structural-guards.test.ts; this
// package's vitest transform does not hand these specs a file: URL.
const SRC = resolve(__dirname, "../src");

/** The 16 confirmed transaction-building sites. Three operations
 *  (RotateSovereign, RotateGuard, RotatePaymentKey) exist as TWO independent copies
 *  across `components/` and `zbom/modals/` — they share no code, so both copies are
 *  listed and both must satisfy the gas contract. The 15th,
 *  `zbom/rotatePaymentKeyLive.ts`, is the self-contained delegate the ZBOM
 *  `RotatePaymentKeyModal.tsx` calls — see `SELF_CONTAINED_TX_SITES` below. The
 *  16th, `kadena/kadenaReads.ts`, is a dirty-read-only site — see
 *  `READ_ONLY_TX_SITES` below. */
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
  "zbom/rotatePaymentKeyLive.ts",
  "kadena/kadenaReads.ts",
].sort();

/** Self-contained delegate implementations (mirror an external package's OWN
 *  dirtyRead→sign→submit pipeline, predating `execute()`'s ctx-injection
 *  contract) — inventoried and checked for (b)/(c), but exempt from (d)/(e)'s
 *  ctx-shape assertions. See the module doc comment above. */
const SELF_CONTAINED_TX_SITES = new Set(["zbom/rotatePaymentKeyLive.ts"]);

/** Dirty-read-only sites — never signed, never submitted, so the gasPrice/
 *  creationTime contract this whole file exists to enforce genuinely does
 *  not apply. Exempt from (b)-(e) entirely; see the module doc comment
 *  above for the full reasoning. */
const READ_ONLY_TX_SITES = new Set(["kadena/kadenaReads.ts"]);

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

  it.each(EXPECTED_TX_SITES.filter((rel) => !SELF_CONTAINED_TX_SITES.has(rel) && !READ_ONLY_TX_SITES.has(rel)))(
    "%s passes gasPrice + creationTime into setMeta",
    (rel) => {
      const source = readFileSync(join(SRC, rel), "utf8");
      const bodies = setMetaBodies(source);
      expect(bodies.length).toBeGreaterThan(0);

      for (const body of bodies) {
        // (b) the live Yin floor must be on the wire, not Pact's 1e-8 default.
        expect(body, `${rel}: setMeta omits gasPrice`).toMatch(/\bgasPrice\b/);
        // (c) creationTime must be set explicitly.
        expect(body, `${rel}: setMeta omits creationTime`).toMatch(/\bcreationTime\b/);
      }
    },
  );

  it.each([...SELF_CONTAINED_TX_SITES])(
    "%s (self-contained delegate) spreads stoaGasMeta(...) into setMeta",
    (rel) => {
      // The self-contained equivalent of (b)/(c): `...stoaGasMeta(safeCreationTime())`
      // spread into the object literal puts both `gasPrice` and `creationTime`
      // on the wire at runtime, but neither identifier appears LITERALLY in the
      // setMeta body text the way a destructured-ctx site's does — asserted by
      // this category's own dedicated clock-read test below instead.
      const source = readFileSync(join(SRC, rel), "utf8");
      const bodies = setMetaBodies(source);
      expect(bodies.length).toBeGreaterThan(0);
      for (const body of bodies) {
        expect(body, `${rel}: setMeta does not spread stoaGasMeta(...)`)
          .toMatch(/\.\.\.\s*stoaGasMeta\s*\(/);
      }
    },
  );

  it.each(EXPECTED_TX_SITES.filter((rel) => !SELF_CONTAINED_TX_SITES.has(rel) && !READ_ONLY_TX_SITES.has(rel)))(
    "%s takes gas fields from the injected ctx, not a local clock read",
    (rel) => {
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
    },
  );

  it.each([...SELF_CONTAINED_TX_SITES])(
    "%s (self-contained delegate) reads the clock itself and still puts gasPrice + creationTime on the wire",
    (rel) => {
      const source = readFileSync(join(SRC, rel), "utf8");
      // The inverse of (d) for this category: a self-contained delegate MUST
      // read the clock itself (it has no injected ctx to take it from) via
      // the canonical single-read helper, not a hand-rolled substitute.
      expect(source, `${rel}: expected a single stoaGasMeta(safeCreationTime()) read`)
        .toMatch(/stoaGasMeta\s*\(\s*safeCreationTime\s*\(\s*\)\s*\)/);
    },
  );

  it.each([...READ_ONLY_TX_SITES])(
    "%s (read-only) never signs or submits — dirtyRead only, so the gasPrice contract genuinely does not apply",
    (rel) => {
      const source = readFileSync(join(SRC, rel), "utf8");
      expect(source, `${rel}: expected a dirtyRead call — this category's whole exemption rests on never submitting`)
        .toMatch(/\bdirtyRead\s*\(/);
      expect(source, `${rel}: a read-only site must never call submit/send — that would make it a real tx-building site subject to the full (b)-(e) contract`)
        .not.toMatch(/\.(submit|send)\s*\(/);
    },
  );
});
