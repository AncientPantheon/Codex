/**
 * preZbomFillMap.ts — canon rule 7 ("fill every parameter you can, and
 * prove it", `@ouronet/talos-registry@2.2.0`'s `TOOLTIP-CANON.md`).
 *
 * Two things are proven here:
 *   1. `ouronetAccountFillValues`/`resolvePatronFillValue` produce exactly
 *      the aliases/values this module's own doc comment promises.
 *   2. THE CHECK ITSELF: for every one of the 11 real launchers this round
 *      fixed (confirmed live via `tooltipModel(key).slots` before the fix —
 *      see `preZbomFillMap.ts`'s own module doc comment for the exact bug),
 *      applying this fill map makes `unfilledFillable(model)` empty. This
 *      is the "conformant consumer asserts this is empty for every button
 *      it renders" requirement, applied to the class of launchers this
 *      shared helper actually covers — not a claim about every launcher in
 *      the app (StoaAccountsTab.tsx's Send launcher has a genuinely
 *      launcher-time-unknowable `receiver`, documented separately below,
 *      not filled by this map at all).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { tooltipModel, unfilledFillable, paramRole } from "@ouronet/talos-registry";
import { ouronetAccountFillValues, resolvePatronFillValue } from "../src/zbom/cfm/preZbomFillMap.js";
import { DEPLOY_API_KEY_KEY } from "../src/zbom/pythia/deployApiKey.js";
import { LINK_DUAL_API_KEY_KEY } from "../src/zbom/pythia/linkDualApiKey.js";
import { RENAME_DUAL_LANE_KEY, REVOKE_DUAL_LINK_KEY } from "../src/zbom/pythia/dualLinkOps.js";

const SRC = resolve(__dirname, "../src");

const SELF = "Σ.selfaccount";
const PRIME = "Σ.primeaccount";

describe("ouronetAccountFillValues", () => {
  it("fills every confirmed 'this account' alias with the same value", () => {
    expect(ouronetAccountFillValues(SELF)).toEqual({
      executor: SELF,
      account: SELF,
      "owner-account": SELF,
      "apollo-account": SELF,
    });
  });

  it("every EXECUTION-side alias it emits (not owner-account, a preview-only name) is classified 'ouronet-account' by the registry", () => {
    // `owner-account` is deliberately excluded from this check: it is
    // `C_DeployApiKey`'s own PREVIEW parameter name (never an execution
    // slot for anything this map covers), so the registry's own
    // `paramRole` — confirmed live — does not classify it under any role at
    // all. It is still a correct, deliberate inclusion here (rule 2: values
    // merge by name against BOTH the execution's and the preview's lists),
    // just not one this particular cross-check can assert on.
    for (const name of Object.keys(ouronetAccountFillValues(SELF))) {
      if (name === "owner-account") continue;
      expect(paramRole(name), `paramRole(${name})`).toBe("ouronet-account");
    }
  });
});

describe("resolvePatronFillValue", () => {
  it("'resident' mode always resolves to self, regardless of a prime address being available", () => {
    expect(resolvePatronFillValue("resident", SELF, PRIME)).toBe(SELF);
    expect(resolvePatronFillValue("resident", SELF, undefined)).toBe(SELF);
  });

  it("'prime' mode resolves to the prime address, never self", () => {
    expect(resolvePatronFillValue("prime", SELF, PRIME)).toBe(PRIME);
  });

  it("'custom' mode (never returned by usePatronSelectionDefaults itself, but part of the wider PatronMode type) also falls back to prime, not self — prime is the closest real account, not a guess at the actual custom pick", () => {
    expect(resolvePatronFillValue("custom", SELF, PRIME)).toBe(PRIME);
  });

  it("never falls back to self when a non-resident patron has no prime address to resolve to — an honest gap, not a plausible-but-wrong substitution", () => {
    expect(resolvePatronFillValue("prime", SELF, undefined)).toBeUndefined();
  });
});

describe("rule 7's own check — unfilledFillable(model) is empty for every launcher this fill map covers", () => {
  const withPatron = { ...ouronetAccountFillValues(SELF), patron: PRIME };

  it.each([
    ["TS01-C1.DALOS|C_RotateStoa", withPatron],
    ["TS01-C1.DALOS|C_RotateGuard", withPatron],
    ["TS01-C4.CODEX|C_ReleaseStoicTag", { ...withPatron, "tag-name": "SomeTag" }],
    ["TS01-C4.CODEX|C_RegisterStoicTag", { ...withPatron, "tag-name": "NewTag", "account-address": SELF }],
    ["TS01-C1.DALOS|C_RotateSovereign", withPatron],
    ["TS01-C1.DALOS|C_RotateGovernor", withPatron],
    [DEPLOY_API_KEY_KEY, withPatron],
  ])("%s — with patron+executor filled", (key, values) => {
    const model = tooltipModel(key, values);
    expect(unfilledFillable(model)).toEqual([]);
  });

  // DeploySmartAccount/DeployStandardAccount have no `patron` exec param at
  // all (confirmed live) — only `accountFillValues` applies.
  it.each([
    "TS01-C1.DALOS|C_DeploySmartAccount",
    "TS01-C1.DALOS|C_DeployStandardAccount",
  ])("%s — with executor filled, no patron slot to fill", (key) => {
    const model = tooltipModel(key, ouronetAccountFillValues(SELF));
    expect(unfilledFillable(model)).toEqual([]);
  });

  it("LINK_DUAL_API_KEY_KEY — with standard-apollo, smart-apollo, and executor (the Standard half's owner) filled", () => {
    const model = tooltipModel(LINK_DUAL_API_KEY_KEY, {
      "standard-apollo": SELF,
      "smart-apollo": "Σ.smarthalf",
      executor: "Σ.standardowner",
    });
    expect(unfilledFillable(model)).toEqual([]);
  });

  it.each([
    [RENAME_DUAL_LANE_KEY, { patron: SELF, executor: SELF, "dual-link-key": "std~smt", "new-name": "NewName" }],
    [REVOKE_DUAL_LINK_KEY, { patron: SELF, executor: SELF, "dual-link-key": "std~smt" }],
  ])("%s — with patron+executor (the pair's Standard-half owner) filled", (key, values) => {
    const model = tooltipModel(key, values);
    expect(unfilledFillable(model)).toEqual([]);
  });
});

describe("the OLD broken pattern never reappears — source-text guard", () => {
  it("OuronetAccountsTab.tsx never again passes values={{ account: account.address }} — the exact silent no-op this round's fix closed (patron/executor were the real exec param names, 'account' matched neither)", () => {
    const source = readFileSync(resolve(SRC, "ui/tabs/OuronetAccountsTab.tsx"), "utf8");
    expect(source).not.toMatch(/values=\{\{\s*account:\s*account\.address\s*\}\}/);
  });

  it("every PreZbomHint call site in OuronetAccountsTab.tsx that fills an account uses one of the shared fill-map results (withPatron / accountFillValues), never a hand-rolled object", () => {
    const source = readFileSync(resolve(SRC, "ui/tabs/OuronetAccountsTab.tsx"), "utf8");
    const preZbomHintBlocks = source.match(/<PreZbomHint[\s\S]*?values=\{[\s\S]*?\}/g) ?? [];
    expect(preZbomHintBlocks.length).toBeGreaterThan(0);
    for (const block of preZbomHintBlocks) {
      expect(block, block).toMatch(/withPatron|accountFillValues/);
    }
  });

  it("SingleApiPanel.tsx and DualApiPanel.tsx both import and actually call ouronetAccountFillValues — not a hand-rolled { executor: x } / { patron: x, executor: x } object bypassing the shared map", () => {
    for (const rel of ["ui/tabs/SingleApiPanel.tsx", "ui/tabs/DualApiPanel.tsx"]) {
      const source = readFileSync(resolve(SRC, rel), "utf8");
      expect(source, `${rel}: missing the import`).toMatch(/import\s*\{[^}]*ouronetAccountFillValues[^}]*\}\s*from\s*["']\.\.\/\.\.\/zbom\/cfm\/preZbomFillMap\.js["']/);
      expect(source, `${rel}: imported but never called`).toMatch(/ouronetAccountFillValues\(/);
    }
  });
});

describe("the ONE documented exemption — a Send-shaped launcher's receiver is genuinely launcher-time-unknowable, not a gap this fill map should paper over", () => {
  it("coin.C_Transfer's receiver stays unfilled even with sender filled — the whole point of Send is to let the user choose a receiver the launcher's own context does not have", () => {
    const model = tooltipModel("coin.C_Transfer", { sender: SELF });
    const gaps = unfilledFillable(model).map((s) => s.name);
    expect(gaps).toEqual(["receiver"]);
  });
});
