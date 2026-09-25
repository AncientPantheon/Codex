/**
 * pact-signatures.test.ts — regression lock + drift guard for
 * `src/constants/pactSignatures.generated.ts`, the manifest `ExecutionTooltip.tsx`
 * reads to show a button's real on-chain API before it's pressed.
 *
 * Two concerns:
 *   (a) REGRESSION LOCK — every function this "complete rehaul" audit round
 *       (2026-09-26) hand-verified against `describe-module` is asserted here too,
 *       so the SAME facts are checked two ways: once by hand against the live
 *       chain (this session), and forever after by this file against the
 *       generated manifest. If the manifest's own generator ever mis-parses a
 *       signature, this is what catches it.
 *   (b) DRIFT GUARD — regenerates the manifest fresh (via
 *       `scripts/generate-pact-signatures.py`) and diffs it against the
 *       committed file, the same contract this whole audit's other generated
 *       artifacts are held to (see `check-call-sites.py`'s own doc comment).
 *       SKIPPED, not failed, when the sibling `.pact` source tree isn't present
 *       on disk (e.g. a CI runner without the OuroborosNetwork workspace
 *       checked out next to this one) — a missing source tree is an
 *       environment fact, not a code defect.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { signatureOf, PACT_SIGNATURES } from "../src/constants/pactSignatures.generated.js";

const PKG = resolve(__dirname, "..");

describe("pactSignatures.generated.ts — regression lock (facts this audit round confirmed live)", () => {
  it("StoicTag EXECUTE calls: 3-arg (patron, executor, tag-name) — the 2026-09-22 rehaul", () => {
    expect(signatureOf("TS01-C4.CODEX|C_ReleaseStoicTag")).toEqual(["patron", "executor", "tag-name"]);
    expect(signatureOf("TS01-C4.CODEX|C_RegisterStoicTag")).toEqual(["patron", "executor", "tag-name"]);
  });

  it("the OLD, broken StoicTag shapes are not in the manifest under any other key", () => {
    // There is no 2-arg Release or (patron, tag-name, account) Register variant —
    // the manifest has exactly one signature per qualified name, and it's the
    // 3-arg (patron, executor, tag-name) shape above.
    expect(Object.keys(PACT_SIGNATURES).filter((k) => k.endsWith("C_ReleaseStoicTag")).length).toBe(1);
    expect(Object.keys(PACT_SIGNATURES).filter((k) => k.endsWith("C_RegisterStoicTag")).length).toBe(1);
  });

  it("C_RotateStoa exists; C_RotateKadena (renamed away) does not", () => {
    expect(signatureOf("TS01-C1.DALOS|C_RotateStoa")).toEqual(["patron", "executor", "stoa"]);
    expect(signatureOf("TS01-C1.DALOS|C_RotateKadena")).toBeNull();
  });

  it("DALOS.UR_AccountStoa exists in the FULL manifest; DALOS.UR_AccountKadena (renamed away) does not", () => {
    // Not `|C_`/`INFO_`-shaped, so the BUNDLED map (what `signatureOf` reads)
    // deliberately excludes it — see the generator's own trim comment. The
    // full JSON (what `check-call-sites.py` reads) is the one this rename
    // actually needs checked against.
    const full = JSON.parse(readFileSync(join(PKG, "scripts/pact-signatures.full.json"), "utf8"));
    expect(full["DALOS.UR_AccountStoa"]).toEqual(["account"]);
    expect(full["DALOS.UR_AccountKadena"]).toBeUndefined();
  });

  it("INFO-ONE.INFO_DALOS|RotateGuard / RotateStoa exist (INFO-ZERO's tombstone equivalents do not)", () => {
    expect(signatureOf("INFO-ONE.INFO_DALOS|RotateGuard")).toEqual(["patron", "account"]);
    expect(signatureOf("INFO-ONE.INFO_DALOS|RotateStoa")).toEqual(["patron", "account"]);
  });

  it("PYTHIA.INFO_PYTHIA|Link / RevokeLink exist under their SHORT names — the LinkDualApiKey/UnlinkDualApiKey forms genuinely do not", () => {
    // This is the one place this round's OWN findings contradicted an
    // incoming handoff (which claimed these two "have no counterpart under
    // either naming, do not invent a name"). Confirmed twice independently
    // — live describe-module AND this static manifest agree.
    expect(signatureOf("PYTHIA.INFO_PYTHIA|Link")).toEqual(["standard-apollo", "smart-apollo", "consumer-lane"]);
    expect(signatureOf("PYTHIA.INFO_PYTHIA|RevokeLink")).toEqual(["patron", "dual-link-key"]);
    expect(signatureOf("PYTHIA.INFO_PYTHIA|LinkDualApiKey")).toBeNull();
    expect(signatureOf("PYTHIA.PYTHIA|INFO_LinkDualApiKey")).toBeNull();
    expect(signatureOf("PYTHIA.PYTHIA|INFO_UnlinkDualApiKey")).toBeNull();
    expect(signatureOf("PYTHIA.INFO_PYTHIA|UnlinkDualApiKey")).toBeNull();
  });

  it("signatureOf returns null, not throws, for a name the contract never defined", () => {
    expect(signatureOf("NOT-A-REAL.MODULE|not_a_real_fn")).toBeNull();
  });
});

describe("pactSignatures.generated.ts — drift guard", () => {
  const GENERATOR = join(PKG, "scripts/generate-pact-signatures.py");
  const COMMITTED = join(PKG, "src/constants/pactSignatures.generated.ts");
  const FULL_JSON = join(PKG, "scripts/pact-signatures.full.json");

  // Mirrors the generator's own default resolution (sibling-repo layout) —
  // see generate-pact-signatures.py's DEFAULT_PACT for the derivation.
  const DEFAULT_PACT = resolve(PKG, "../../../../../OuroborosNetwork/_onchain/Ouronet");

  it("a fresh run reproduces the committed file byte-for-byte", () => {
    if (!existsSync(DEFAULT_PACT)) {
      // Environment fact, not a code defect — see this file's own doc comment.
      return;
    }
    // Snapshot BOTH generated artifacts before mutating them — the generator
    // writes in place, so this test must restore the working tree exactly,
    // pass or fail, rather than leaving a regenerated file sitting uncommitted.
    const beforeTs = readFileSync(COMMITTED, "utf8");
    const beforeJson = existsSync(FULL_JSON) ? readFileSync(FULL_JSON, "utf8") : null;
    try {
      execFileSync("python3", [GENERATOR, DEFAULT_PACT], { cwd: PKG, stdio: "pipe" });
      const afterTs = readFileSync(COMMITTED, "utf8");
      expect(afterTs).toBe(beforeTs);
    } finally {
      writeFileSync(COMMITTED, beforeTs, "utf8");
      if (beforeJson !== null) writeFileSync(FULL_JSON, beforeJson, "utf8");
    }
  });
});
