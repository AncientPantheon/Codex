/**
 * The canonical master display names, pinned.
 *
 * These strings are user-facing product vocabulary that several packages
 * render, so they get asserted literally here - a silent change to one of
 * them is a product change, and should have to break a test to happen.
 */

import { describe, it, expect } from "vitest";
import {
  OURONET_CODEX_MASTER,
  MASTER_CHAINWEB_SEED,
  MASTER_ARWEAVE_SEED,
  CODEX_MASTER_SEED,
  CODEX_STOIC_IDENTITY,
  FORMER_OURONET_CODEX_MASTER,
  FORMER_MASTER_ARWEAVE_SEED,
  masterOuronetAccountName,
  masterOuronetAccountParts,
  masterChainwebSeedName,
} from "../src/codex/masterNames.js";

describe("master display names", () => {
  it("are exactly the owner-approved strings", () => {
    expect(OURONET_CODEX_MASTER).toBe("Codex Ouronet Master");
    expect(MASTER_CHAINWEB_SEED).toBe("Master Chainweb Seed");
    expect(CODEX_MASTER_SEED).toBe("Codex Master Seed");
    expect(CODEX_STOIC_IDENTITY).toBe("Codex Stoic Identity");
  });

  it('spells the ArWeave seed with the deliberate intercapital W', () => {
    // Owner-confirmed: "ar" for ARCHIVE + "weave". Not a typo, and not to be
    // auto-corrected to the network's own spelling.
    expect(MASTER_ARWEAVE_SEED).toBe("Master ArWeave Seed");
    expect(MASTER_ARWEAVE_SEED).not.toBe("Master Arweave Seed");
  });
});

describe("the FORMER master designations", () => {
  it("are exactly the owner-approved strings", () => {
    // Owner: "the one that isn't anymore would be designated Former Master
    // Arweave Seed. Same for Initial Seed on Ouronet Account - it was Ouronet
    // Codex Master before, and would become after apply Former Codex Ouronet
    // Master."
    expect(FORMER_OURONET_CODEX_MASTER).toBe("Former Codex Ouronet Master");
    expect(FORMER_MASTER_ARWEAVE_SEED).toBe("Former Master Arweave Seed");
  });
});

describe("masterOuronetAccountName", () => {
  it("names position 0 the master, IGNORING the legacy stored name", () => {
    // Every codex still stores "CodexPrime" as the account name; the display
    // name is resolved positionally so old and new codices read identically.
    expect(masterOuronetAccountName(0, "CodexPrime")).toBe(OURONET_CODEX_MASTER);
    expect(masterOuronetAccountName(0, undefined)).toBe(OURONET_CODEX_MASTER);
    expect(masterOuronetAccountName(0, "literally anything")).toBe(OURONET_CODEX_MASTER);
  });

  it("uses the stored name for any other position", () => {
    expect(masterOuronetAccountName(3, "AncientHodler")).toBe("AncientHodler");
  });

  it("falls back to a numbered label when a non-master account is unnamed", () => {
    expect(masterOuronetAccountName(3, undefined)).toBe("Account #4");
    expect(masterOuronetAccountName(3, "")).toBe("Account #4");
  });

  it("lets an explicit override outrank both rules", () => {
    expect(masterOuronetAccountName(0, "CodexPrime", "GuardOfCodexID")).toBe("GuardOfCodexID");
  });

  it("ignores a null/empty override rather than rendering it", () => {
    expect(masterOuronetAccountName(0, "CodexPrime", null)).toBe(OURONET_CODEX_MASTER);
    expect(masterOuronetAccountName(2, "Mnemosyne", "")).toBe("Mnemosyne");
  });
});

describe("masterOuronetAccountName with a settled master", () => {
  it("keeps the positional rule when the opts object carries no settled master", () => {
    // Regression guard: merely THREADING opts (which every call site will now
    // do, from a `codexMasterSeed` that may be absent) must not by itself
    // change a single name. A codex that never ran the eligibility wizard has
    // no settled master and must read exactly as it does today.
    expect(masterOuronetAccountName(0, "CodexPrime", null, { accountId: "a0" })).toBe(
      OURONET_CODEX_MASTER
    );
    expect(
      masterOuronetAccountName(0, "CodexPrime", null, {
        accountId: "a0",
        settledMasterAccountId: null,
      })
    ).toBe(OURONET_CODEX_MASTER);
    expect(
      masterOuronetAccountName(0, "CodexPrime", null, {
        accountId: "a0",
        settledMasterAccountId: "",
      })
    ).toBe(OURONET_CODEX_MASTER);
    expect(
      masterOuronetAccountName(2, "Mnemosyne", null, {
        accountId: "a2",
        settledMasterAccountId: null,
      })
    ).toBe("Mnemosyne");
  });

  it("moves the master name onto the settled account, whatever its position", () => {
    // The wizard settled AncientHodler at index 2; it must stop reading as
    // "AncientHodler" everywhere, which is defect 1 of the design.
    expect(
      masterOuronetAccountName(2, "AncientHodler", null, {
        accountId: "a2",
        settledMasterAccountId: "a2",
      })
    ).toBe(OURONET_CODEX_MASTER);
  });

  it("takes the master name OFF the account that held it positionally", () => {
    // Without this, index 0 and the settled account would BOTH render as
    // "Codex Ouronet Master" at the same time - two accounts, one identity.
    expect(
      masterOuronetAccountName(0, "CodexPrime", null, {
        accountId: "a0",
        settledMasterAccountId: "a2",
      })
    ).toBe("CodexPrime");
    // ...and an index-0 account with no stored name of its own falls all the
    // way through to the numbered label rather than clinging to the master.
    expect(
      masterOuronetAccountName(0, undefined, null, {
        accountId: "a0",
        settledMasterAccountId: "a2",
      })
    ).toBe("Account #1");
  });

  it("gives the master name to NOBODY when the settled id matches no account", () => {
    // A stale `codexMasterSeed.ouroAccountId` (account deleted, codex
    // restored from an older backup) must not silently hand the identity back
    // to whoever sits at index 0 - that would misreport the settled master.
    const settled = { settledMasterAccountId: "ghost" };
    expect(masterOuronetAccountName(0, "CodexPrime", null, { ...settled, accountId: "a0" })).toBe(
      "CodexPrime"
    );
    expect(masterOuronetAccountName(1, "AncientHodler", null, { ...settled, accountId: "a1" })).toBe(
      "AncientHodler"
    );
    // Also when the opts carry no accountId at all to compare against.
    expect(masterOuronetAccountName(0, "CodexPrime", null, settled)).toBe("CodexPrime");
  });

  it("still lets an explicit override outrank a settled master", () => {
    // `OuronetAccountsTab` passes the APOLLO CodexID-prime label here; if a
    // settled master started overriding it we would trade one naming bug for
    // another.
    expect(
      masterOuronetAccountName(2, "AncientHodler", "GuardOfCodexID", {
        accountId: "a2",
        settledMasterAccountId: "a2",
      })
    ).toBe("GuardOfCodexID");
  });
});

describe("masterOuronetAccountParts", () => {
  it("exposes the displaced stored name as the settled master's former name", () => {
    // The owner's requirement: "It must not appear as AncientHodler any more
    // but as Codex Ouronet Master (beneath it its former name)."
    expect(
      masterOuronetAccountParts(2, "AncientHodler", null, {
        accountId: "a2",
        settledMasterAccountId: "a2",
      })
    ).toEqual({ name: OURONET_CODEX_MASTER, formerName: "AncientHodler" });
  });

  it("reports no former name for a master that never had one", () => {
    // Design: "An account with no prior name of its own simply shows Codex
    // Ouronet Master with nothing beneath." A caller renders the second line
    // only when `formerName` is set, so an empty stored name must not become
    // an empty line.
    expect(
      masterOuronetAccountParts(2, undefined, null, {
        accountId: "a2",
        settledMasterAccountId: "a2",
      }).formerName
    ).toBeUndefined();
    expect(
      masterOuronetAccountParts(2, "", null, {
        accountId: "a2",
        settledMasterAccountId: "a2",
      }).formerName
    ).toBeUndefined();
  });

  it("reports no former name for an account that still reads under its own name", () => {
    // Nothing was displaced here, so there is nothing to demote beneath it.
    expect(masterOuronetAccountParts(3, "AncientHodler").formerName).toBeUndefined();
    expect(masterOuronetAccountParts(3, undefined).formerName).toBeUndefined();
    expect(
      masterOuronetAccountParts(0, "CodexPrime", null, {
        accountId: "a0",
        settledMasterAccountId: "a2",
      }).formerName
    ).toBeUndefined();
  });

  it("reports the stored name an explicit override displaced", () => {
    expect(
      masterOuronetAccountParts(2, "AncientHodler", "GuardOfCodexID", {
        accountId: "a2",
        settledMasterAccountId: "a2",
      })
    ).toEqual({ name: "GuardOfCodexID", formerName: "AncientHodler" });
  });

  it("agrees with masterOuronetAccountName on every branch of the rule", () => {
    // The two are one rule with two faces; a second copy of the precedence
    // would drift. Any divergence introduced in either is caught here.
    const cases: Array<Parameters<typeof masterOuronetAccountParts>> = [
      [0, "CodexPrime"],
      [0, undefined],
      [2, "AncientHodler"],
      [2, undefined],
      [2, ""],
      [0, "CodexPrime", "GuardOfCodexID"],
      [2, "AncientHodler", "GuardOfCodexID"],
      [0, "CodexPrime", null, { accountId: "a0" }],
      [0, "CodexPrime", null, { accountId: "a0", settledMasterAccountId: "a2" }],
      [2, "AncientHodler", null, { accountId: "a2", settledMasterAccountId: "a2" }],
      [2, undefined, null, { accountId: "a2", settledMasterAccountId: "a2" }],
      [1, "Mnemosyne", null, { accountId: "a1", settledMasterAccountId: "ghost" }],
      [2, "AncientHodler", "GuardOfCodexID", { accountId: "a2", settledMasterAccountId: "a2" }],
    ];
    for (const args of cases) {
      expect(masterOuronetAccountParts(...args).name).toBe(masterOuronetAccountName(...args));
    }
  });
});

describe("masterChainwebSeedName", () => {
  it("names an explicitly-prime seed the master seed at any position", () => {
    expect(masterChainwebSeedName(4, true, "Initial Seed")).toBe(MASTER_CHAINWEB_SEED);
  });

  it("also names position 0 the master seed when the flag was never set", () => {
    // Mirrors the seeds UI rule (`seed.isPrime === true || index === 0`) -
    // the owner's real codex has seeds whose flag predates the concept.
    expect(masterChainwebSeedName(0, undefined, "Initial Seed")).toBe(MASTER_CHAINWEB_SEED);
  });

  it("uses the stored name for a non-prime seed", () => {
    expect(masterChainwebSeedName(2, false, "Ouronet Dispenser")).toBe("Ouronet Dispenser");
  });

  it("falls back to a numbered label when a non-prime seed is unnamed", () => {
    expect(masterChainwebSeedName(2, false, undefined)).toBe("Seed #3");
  });
});
