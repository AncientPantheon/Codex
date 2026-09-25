/**
 * Ouronet execute-wiring regression suite.
 *
 * Owner directive: "we need to take all the functions that are being
 * executed on Ouronet and test them if their wiring are firing correctly."
 * Direct unit coverage for every package-LOCAL Pact-code builder/reader
 * this session's chain-symbol audits touched — `deployApiKey.ts`,
 * `dualLinkOps.ts`, `linkDualApiKey.ts`, `ouroSelectorReads.ts`,
 * `stoicTagExecOps.ts` (2026-09-26) — asserting
 * the EXACT function name and argument order each one emits, so a future
 * edit that silently reintroduces a wrong name or a dropped argument fails
 * a test instead of hanging/disabling a button in production undetected
 * (which is how every bug in this audit thread actually shipped: nothing
 * here was ever unit-tested before).
 *
 * Async reads use `setPactReader` (the same seam `zbom-debouncer.test.ts`
 * already uses) to capture the exact Pact code string passed to the reader,
 * without a real network call. Sync builders (`build*PactCode`) are called
 * directly — no reader needed.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { setPactReader } from "@stoachain/stoa-core/reads";

import {
  buildDeployApiKeyPactCode,
  getDeployApiKeyInfoOnly,
  getApiKeySelectorData,
  getDualApiKeySelectorData,
  getPythiaPrices,
} from "../src/zbom/pythia/deployApiKey.js";
import {
  buildRenameDualLanePactCode,
  buildRevokeDualLinkPactCode,
  getRenameDualLaneInfoOnly,
  getRevokeDualLinkInfoOnly,
} from "../src/zbom/pythia/dualLinkOps.js";
import { buildLinkDualApiKeyPactCode, getLinkDualApiKeyInfo } from "../src/zbom/pythia/linkDualApiKey.js";
import {
  getAccountSelectorDataLive,
  getStoicTagSelectorDataLive,
  getStoicTagInfoLive,
  getStoaAccountSelectorDataLive,
  getRegisterStoicTagInfoLive,
  getDeployStandardAccountInfoLive,
  getDeployStandardAccountInfoOnlyLive,
  getDeploySmartAccountInfoLive,
  getDeploySmartAccountInfoOnlyLive,
  getWrapperPaymentKeyLive,
  getRotateGuardInfoLive,
  getRotateStoaChainInfoLive,
} from "../src/zbom/ouroSelectorReads.js";
import {
  buildReleaseStoicTagPactCodeLive,
  buildRegisterStoicTagPactCodeLive,
} from "../src/zbom/stoicTagExecOps.js";

afterEach(() => vi.restoreAllMocks());

/** Registers a mock reader and returns it — every read below resolves to a
 *  benign empty-envelope success so callers don't need per-test payloads;
 *  the reader's OWN captured call args are the thing under test. */
function mockReader(response: unknown = { result: { status: "success", data: null } }) {
  const reader = vi.fn().mockResolvedValue(response);
  setPactReader(reader);
  return reader;
}

// ─── zbom/pythia/deployApiKey.ts ────────────────────────────────────────────

describe("deployApiKey.ts — Pact call wiring", () => {
  it("buildDeployApiKeyPactCode: C_DeployApiKey, 4 args in order (patron, ownerAccount, apolloAccount, publicKey)", () => {
    const code = buildDeployApiKeyPactCode({
      patron: "Ѻ.PATRON", ownerAccount: "Ѻ.OWNER", apolloAccount: "₱.APOLLO", publicKey: "PUBKEY",
    });
    expect(code).toBe(`(ouronet-ns.TS01-C4.PYTHIA|C_DeployApiKey "Ѻ.PATRON" "Ѻ.OWNER" "₱.APOLLO" "PUBKEY")`);
  });

  it("getDeployApiKeyInfoOnly: INFO_PYTHIA|DeployApiKey (name-order FIXED — chain-symbol audit)", async () => {
    const reader = mockReader();
    await getDeployApiKeyInfoOnly({ patron: "Ѻ.P", ownerAccount: "Ѻ.O", apolloAccount: "₱.A", publicKey: "PK" });
    const [code] = reader.mock.calls[0];
    expect(code).toContain("ouronet-ns.PYTHIA.INFO_PYTHIA|DeployApiKey");
    expect(code).not.toContain("PYTHIA.PYTHIA|INFO_DeployApiKey");
  });

  it("getApiKeySelectorData: P-UI-ONE.URC_01|ApiKeys (confirmed-deployed follow-up handoff — not the archived DPL-UR.URC_0031)", async () => {
    const reader = mockReader();
    await getApiKeySelectorData(["₱.A", "Π.B"]);
    const [code] = reader.mock.calls[0];
    expect(code).toBe(`(ouronet-ns.P-UI-ONE.URC_01|ApiKeys ["₱.A" "Π.B"])`);
  });

  it("getDualApiKeySelectorData: P-UI-ONE.URC_02|DualLinks (not the archived DPL-UR.URC_0033_DualApiKeyMapper)", async () => {
    const reader = mockReader();
    await getDualApiKeySelectorData(["₱.A|Π.B"]);
    const [code] = reader.mock.calls[0];
    expect(code).toBe(`(ouronet-ns.P-UI-ONE.URC_02|DualLinks ["₱.A|Π.B"])`);
  });

  it("getPythiaPrices: P-UI-ONE.URC_03|Prices (not the archived DPL-UR.URC_0034_PythiaPrices)", async () => {
    const reader = mockReader();
    await getPythiaPrices();
    const [code] = reader.mock.calls[0];
    expect(code).toBe("(ouronet-ns.P-UI-ONE.URC_03|Prices)");
  });
});

// ─── zbom/pythia/dualLinkOps.ts ─────────────────────────────────────────────

describe("dualLinkOps.ts — Pact call wiring (arity fix: patron, executor, executee)", () => {
  it("buildRenameDualLanePactCode: C_UpdateDualConsumerLane, 4 args in order (patron, executor, dualLinkKey, newName)", () => {
    const code = buildRenameDualLanePactCode({
      patron: "Ѻ.PATRON", executor: "Ѻ.EXEC", dualLinkKey: "₱.A|Π.B", newName: "NewLane",
    });
    expect(code).toBe(`(ouronet-ns.TS01-C4.PYTHIA|C_UpdateDualConsumerLane "Ѻ.PATRON" "Ѻ.EXEC" "₱.A|Π.B" "NewLane")`);
  });

  it("buildRevokeDualLinkPactCode: C_RevokeLink, 3 args in order (patron, executor, dualLinkKey)", () => {
    const code = buildRevokeDualLinkPactCode({ patron: "Ѻ.PATRON", executor: "Ѻ.EXEC", dualLinkKey: "₱.A|Π.B" });
    expect(code).toBe(`(ouronet-ns.TS01-C4.PYTHIA|C_RevokeLink "Ѻ.PATRON" "Ѻ.EXEC" "₱.A|Π.B")`);
  });

  it("getRenameDualLaneInfoOnly: INFO_PYTHIA|UpdateDualConsumerLane, UNCHANGED 3-arg shape (verified correct, not part of the arity fix)", async () => {
    const reader = mockReader();
    await getRenameDualLaneInfoOnly({ patron: "Ѻ.P", dualLinkKey: "₱.A|Π.B", newName: "Lane" });
    const [code] = reader.mock.calls[0];
    expect(code).toBe(`(ouronet-ns.PYTHIA.INFO_PYTHIA|UpdateDualConsumerLane "Ѻ.P" "₱.A|Π.B" "Lane")`);
  });
});

// ─── zbom/pythia/linkDualApiKey.ts ──────────────────────────────────────────

describe("linkDualApiKey.ts — Pact call wiring (C_Link's special signature: executor FIRST, no patron)", () => {
  it("buildLinkDualApiKeyPactCode: C_Link, 4 args in order (executor, standardApollo, smartApollo, consumerLane)", () => {
    const code = buildLinkDualApiKeyPactCode({
      executor: "Ѻ.EXEC", standardApollo: "₱.A", smartApollo: "Π.B", consumerLane: "Explorer",
    });
    expect(code).toBe(`(ouronet-ns.TS01-C4.PYTHIA|C_Link "Ѻ.EXEC" "₱.A" "Π.B" "Explorer")`);
    // Load-bearing: executor is the FIRST arg, not a 5th "patron" prepended
    // in front of it — this op takes no patron at all (the handoff's own
    // explicit warning: "do not prepend a patron to it").
    expect(code.indexOf('"Ѻ.EXEC"')).toBeLessThan(code.indexOf('"₱.A"'));
  });
});

// ─── zbom/ouroSelectorReads.ts — DPL-UR → O-UI-SEVEN (4 confirmed-live) ─────

describe("ouroSelectorReads.ts — O-UI-SEVEN reads (confirmed live, replacing archived DPL-UR)", () => {
  it("getAccountSelectorDataLive: O-UI-SEVEN.URC_01|Accounts", async () => {
    const reader = mockReader();
    await getAccountSelectorDataLive(["Ѻ.A"]);
    expect(reader.mock.calls[0][0]).toBe(`(ouronet-ns.O-UI-SEVEN.URC_01|Accounts ["Ѻ.A"])`);
  });

  it("getStoicTagSelectorDataLive: O-UI-SEVEN.URC_03|StoicTags", async () => {
    const reader = mockReader();
    await getStoicTagSelectorDataLive(["Tag1"]);
    expect(reader.mock.calls[0][0]).toBe(`(ouronet-ns.O-UI-SEVEN.URC_03|StoicTags ["Tag1"])`);
  });

  it("getStoicTagInfoLive: O-UI-SEVEN.URC_04|StoicTag", async () => {
    const reader = mockReader();
    await getStoicTagInfoLive("Tag1");
    expect(reader.mock.calls[0][0]).toBe(`(ouronet-ns.O-UI-SEVEN.URC_04|StoicTag "Tag1")`);
  });

  it("getStoaAccountSelectorDataLive: O-UI-SEVEN.URC_05|StoaAccounts", async () => {
    const reader = mockReader();
    await getStoaAccountSelectorDataLive(["k:A"]);
    expect(reader.mock.calls[0][0]).toBe(`(ouronet-ns.O-UI-SEVEN.URC_05|StoaAccounts ["k:A"])`);
  });
});

// ─── ouroSelectorReads.ts — unrelated-to-DPL-UR renames, found testing wiring ─

describe("ouroSelectorReads.ts — RegisterStoicTag / Activate INFO overrides (a DIFFERENT bug: never-fixed @ouronet/ouronet-core renames, not DPL-UR archival)", () => {
  it("getRegisterStoicTagInfoLive: CODEX.INFO_CODEX|RegisterStoicTag + DALOS.UR_AccountStoa, not the external package's still-broken names", async () => {
    const reader = mockReader({ result: { status: "success", data: { info: {}, receivers: [] } } });
    await getRegisterStoicTagInfoLive("Ѻ.PATRON", "MyTag", "Ѻ.ACCOUNT");
    const [code] = reader.mock.calls[0];
    expect(code).toContain("ouronet-ns.CODEX.INFO_CODEX|RegisterStoicTag");
    expect(code).toContain("ouronet-ns.DALOS.UR_AccountStoa");
    expect(code).not.toContain("CODEX.CODEX|INFO_RegisterStoicTag");
    expect(code).not.toContain("UR_AccountKadena");
  });

  it("getDeployStandardAccountInfoLive / …OnlyLive: INFO-ONE.INFO_DALOS|DeployStandardAccount, not the retired INFO-ZERO.DALOS-INFO|URC_*", async () => {
    const reader1 = mockReader({ result: { status: "success", data: { info: {}, receivers: [] } } });
    await getDeployStandardAccountInfoLive("Ѻ.ACCOUNT");
    expect(reader1.mock.calls[0][0]).toContain("ouronet-ns.INFO-ONE.INFO_DALOS|DeployStandardAccount");
    expect(reader1.mock.calls[0][0]).toContain("ouronet-ns.DALOS.UR_AccountStoa");

    const reader2 = mockReader({ result: { status: "success", data: null } });
    await getDeployStandardAccountInfoOnlyLive("Ѻ.ACCOUNT");
    expect(reader2.mock.calls[0][0]).toBe(`(ouronet-ns.INFO-ONE.INFO_DALOS|DeployStandardAccount "Ѻ.ACCOUNT")`);
  });

  it("getDeploySmartAccountInfoLive / …OnlyLive: INFO-ONE.INFO_DALOS|DeploySmartAccount, not the retired INFO-ZERO.DALOS-INFO|URC_*", async () => {
    const reader1 = mockReader({ result: { status: "success", data: { info: {}, receivers: [] } } });
    await getDeploySmartAccountInfoLive("Σ.ACCOUNT");
    expect(reader1.mock.calls[0][0]).toContain("ouronet-ns.INFO-ONE.INFO_DALOS|DeploySmartAccount");
    expect(reader1.mock.calls[0][0]).toContain("ouronet-ns.DALOS.UR_AccountStoa");

    const reader2 = mockReader({ result: { status: "success", data: null } });
    await getDeploySmartAccountInfoOnlyLive("Σ.ACCOUNT");
    expect(reader2.mock.calls[0][0]).toBe(`(ouronet-ns.INFO-ONE.INFO_DALOS|DeploySmartAccount "Σ.ACCOUNT")`);
  });
});

// ─── stoicTagExecOps.ts — the "complete rehaul" round's own bug: the ────────
// ─── StoicTag EXECUTE calls themselves, confirmed via describe-module ──────

describe("stoicTagExecOps.ts — Pact call wiring (2026-09-22 patron/executor canon rehaul)", () => {
  it("buildReleaseStoicTagPactCodeLive: C_ReleaseStoicTag, 3 args in order (patron, executor, tagName) — chain now REJECTS the old 2-arg shape", () => {
    const code = buildReleaseStoicTagPactCodeLive({
      patron: "Ѻ.PATRON", executor: "Ѻ.ACCOUNT", tagName: "MyTag",
    });
    expect(code).toBe(`(ouronet-ns.TS01-C4.CODEX|C_ReleaseStoicTag "Ѻ.PATRON" "Ѻ.ACCOUNT" "MyTag")`);
  });

  it("buildRegisterStoicTagPactCodeLive: C_RegisterStoicTag, 3 args in order (patron, executor, tagName) — executor is 2nd, NOT last", () => {
    const code = buildRegisterStoicTagPactCodeLive({
      patron: "Ѻ.PATRON", executor: "Ѻ.ACCOUNT", tagName: "MyTag",
    });
    expect(code).toBe(`(ouronet-ns.TS01-C4.CODEX|C_RegisterStoicTag "Ѻ.PATRON" "Ѻ.ACCOUNT" "MyTag")`);
    // Load-bearing: executor (the account) is the 2nd arg, BEFORE tag-name —
    // the external builder's old shape put it LAST, which the chain now
    // validates as an invalid tag-name string instead of an account.
    expect(code.indexOf('"Ѻ.ACCOUNT"')).toBeLessThan(code.indexOf('"MyTag"'));
  });
});

// ─── ouroSelectorReads.ts — the "complete rehaul" round's 3 more reads ─────

describe("ouroSelectorReads.ts — getWrapperPaymentKeyLive / RotateGuard / RotateStoa INFO overrides (2026-09-26)", () => {
  it("getWrapperPaymentKeyLive: DALOS.UR_AccountStoa, not the retired DALOS.UR_AccountKadena", async () => {
    const reader = mockReader({ result: { status: "success", data: "k:PAYMENTKEY" } });
    await getWrapperPaymentKeyLive("Ѻ.WRAPPER");
    const [code] = reader.mock.calls[0];
    expect(code).toBe(`(ouronet-ns.DALOS.UR_AccountStoa "Ѻ.WRAPPER")`);
  });

  it("getRotateGuardInfoLive: INFO-ONE.INFO_DALOS|RotateGuard, not the tombstoned INFO-ZERO.DALOS-INFO|URC_RotateGuard", async () => {
    const reader = mockReader();
    await getRotateGuardInfoLive("Ѻ.PATRON", "Ѻ.ACCOUNT");
    const [code] = reader.mock.calls[0];
    expect(code).toBe(`(ouronet-ns.INFO-ONE.INFO_DALOS|RotateGuard "Ѻ.PATRON" "Ѻ.ACCOUNT")`);
  });

  it("getRotateStoaChainInfoLive: INFO-ONE.INFO_DALOS|RotateStoa, not the tombstoned INFO-ZERO.DALOS-INFO|URC_RotateKadena", async () => {
    const reader = mockReader();
    await getRotateStoaChainInfoLive("Ѻ.PATRON", "Ѻ.ACCOUNT");
    const [code] = reader.mock.calls[0];
    expect(code).toBe(`(ouronet-ns.INFO-ONE.INFO_DALOS|RotateStoa "Ѻ.PATRON" "Ѻ.ACCOUNT")`);
  });
});

// ─── dualLinkOps.ts / linkDualApiKey.ts — INFO reads restored (2026-09-26) ──

describe("dualLinkOps.ts / linkDualApiKey.ts — Link/Revoke INFO reads restored (real names confirmed, not the guessed ones removed in 0.12.1)", () => {
  it("getRevokeDualLinkInfoOnly: PYTHIA.INFO_PYTHIA|RevokeLink, not PYTHIA|INFO_UnlinkDualApiKey (confirmed never existed)", async () => {
    const reader = mockReader();
    await getRevokeDualLinkInfoOnly({ patron: "Ѻ.PATRON", dualLinkKey: "₱.A|Π.B" });
    const [code] = reader.mock.calls[0];
    expect(code).toBe(`(ouronet-ns.PYTHIA.INFO_PYTHIA|RevokeLink "Ѻ.PATRON" "₱.A|Π.B")`);
  });

  it("getLinkDualApiKeyInfo: PYTHIA.INFO_PYTHIA|Link, not PYTHIA|INFO_LinkDualApiKey (confirmed never existed)", async () => {
    const reader = mockReader();
    await getLinkDualApiKeyInfo({ executor: "Ѻ.EXEC", standardApollo: "₱.A", smartApollo: "Π.B", consumerLane: "Explorer" });
    const [code] = reader.mock.calls[0];
    expect(code).toBe(`(ouronet-ns.PYTHIA.INFO_PYTHIA|Link "₱.A" "Π.B" "Explorer")`);
    // INFO_PYTHIA|Link does NOT take `executor` — only EXECUTE (C_Link) does.
    expect(code).not.toContain("Ѻ.EXEC");
  });
});
