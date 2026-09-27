/**
 * `dualLinkOps.ts` — talos-registry migration regression suite.
 *
 * `docs/work/talos-registry-pythia-ops` (T1): the EXECUTE builders
 * (`buildRenameDualLanePactCode`, `buildRevokeDualLinkPactCode`) and the new
 * preview builders (`buildRenameDualLanePreview`, `buildRevokeDualLinkPreview`)
 * must go through `@ouronet/talos-registry`'s `buildCall`/`buildPreviewCall`
 * instead of a hand-built template literal, so a future contract-surface
 * change (renamed function, reordered/renamed param) fails loudly here
 * instead of silently mis-calling the chain (the whole point of the
 * registry migration per `docs/work/talos-registry-migration/design.md`).
 *
 * `RENAME_DUAL_LANE_KEY` / `REVOKE_DUAL_LINK_KEY` are asserted to resolve
 * via `tryGetEntrypoint` (imported directly from the registry package, not
 * re-exported) — this is what `talos-registry-surfacing-verification`
 * (the next topic) will walk every exported key through, so a key typo here
 * would otherwise go undetected until that later suite exists.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { setPactReader } from "@stoachain/stoa-core/reads";
import { tryGetEntrypoint, buildCall, buildPreviewCall, namespace } from "@ouronet/talos-registry";

import {
  buildRenameDualLanePactCode,
  buildRevokeDualLinkPactCode,
  buildRenameDualLanePreview,
  buildRevokeDualLinkPreview,
  RENAME_DUAL_LANE_KEY,
  REVOKE_DUAL_LINK_KEY,
  getRenameDualLaneInfoOnly,
  getRevokeDualLinkInfoOnly,
  getRenameDualLaneInfo,
} from "../src/zbom/pythia/dualLinkOps.js";

afterEach(() => vi.restoreAllMocks());

function mockReader(response: unknown = { result: { status: "success", data: null } }) {
  const reader = vi.fn().mockResolvedValue(response);
  setPactReader(reader);
  return reader;
}

describe("dualLinkOps.ts — RENAME_DUAL_LANE_KEY / REVOKE_DUAL_LINK_KEY resolve against the live registry", () => {
  it("RENAME_DUAL_LANE_KEY resolves to TS01-C4.PYTHIA|C_UpdateDualConsumerLane, with the exact live param order and the preview at PYTHIA.INFO_PYTHIA|UpdateDualConsumerLane", () => {
    const ep = tryGetEntrypoint(RENAME_DUAL_LANE_KEY);
    expect(ep).toBeTruthy();
    expect(ep?.params.map((p) => p.name)).toEqual(["patron", "executor", "dual-link-key", "new-name"]);
    expect(ep?.preview).toBe("PYTHIA.INFO_PYTHIA|UpdateDualConsumerLane");
  });

  it("REVOKE_DUAL_LINK_KEY resolves to TS01-C4.PYTHIA|C_RevokeLink, with the exact live param order and the preview at PYTHIA.INFO_PYTHIA|RevokeLink", () => {
    const ep = tryGetEntrypoint(REVOKE_DUAL_LINK_KEY);
    expect(ep).toBeTruthy();
    expect(ep?.params.map((p) => p.name)).toEqual(["patron", "executor", "dual-link-key"]);
    expect(ep?.preview).toBe("PYTHIA.INFO_PYTHIA|RevokeLink");
  });
});

describe("dualLinkOps.ts — EXECUTE builders render exactly what buildCall renders for the same params", () => {
  it("buildRenameDualLanePactCode matches buildCall(RENAME_DUAL_LANE_KEY, ...) verbatim — same param names/order the chain declares", () => {
    const params = { patron: "Ѻ.PATRON", executor: "Ѻ.EXEC", dualLinkKey: "₱.A|Π.B", newName: "NewLane" };
    const code = buildRenameDualLanePactCode(params);
    const expected = buildCall(RENAME_DUAL_LANE_KEY, {
      patron: params.patron,
      executor: params.executor,
      "dual-link-key": params.dualLinkKey,
      "new-name": params.newName,
    });
    expect(code).toBe(expected);
    expect(code).toBe(`(ouronet-ns.TS01-C4.PYTHIA|C_UpdateDualConsumerLane "Ѻ.PATRON" "Ѻ.EXEC" "₱.A|Π.B" "NewLane")`);
  });

  it("buildRevokeDualLinkPactCode matches buildCall(REVOKE_DUAL_LINK_KEY, ...) verbatim — same param names/order the chain declares", () => {
    const params = { patron: "Ѻ.PATRON", executor: "Ѻ.EXEC", dualLinkKey: "₱.A|Π.B" };
    const code = buildRevokeDualLinkPactCode(params);
    const expected = buildCall(REVOKE_DUAL_LINK_KEY, {
      patron: params.patron,
      executor: params.executor,
      "dual-link-key": params.dualLinkKey,
    });
    expect(code).toBe(expected);
    expect(code).toBe(`(ouronet-ns.TS01-C4.PYTHIA|C_RevokeLink "Ѻ.PATRON" "Ѻ.EXEC" "₱.A|Π.B")`);
  });
});

describe("dualLinkOps.ts — new buildXPreview exports render the registry's preview shape (no `executor`)", () => {
  it("buildRenameDualLanePreview matches buildPreviewCall(RENAME_DUAL_LANE_KEY, ...) — 3 args, no executor", () => {
    const params = { patron: "Ѻ.P", dualLinkKey: "₱.A|Π.B", newName: "Lane" };
    const rendered = buildRenameDualLanePreview(params);
    const expected = buildPreviewCall(RENAME_DUAL_LANE_KEY, {
      patron: params.patron,
      "dual-link-key": params.dualLinkKey,
      "new-name": params.newName,
    });
    expect(rendered).toBe(expected);
    expect(rendered).toBe(`(ouronet-ns.PYTHIA.INFO_PYTHIA|UpdateDualConsumerLane "Ѻ.P" "₱.A|Π.B" "Lane")`);
  });

  it("buildRevokeDualLinkPreview matches buildPreviewCall(REVOKE_DUAL_LINK_KEY, ...) — 2 args, no executor", () => {
    const params = { patron: "Ѻ.P", dualLinkKey: "₱.A|Π.B" };
    const rendered = buildRevokeDualLinkPreview(params);
    const expected = buildPreviewCall(REVOKE_DUAL_LINK_KEY, {
      patron: params.patron,
      "dual-link-key": params.dualLinkKey,
    });
    expect(rendered).toBe(expected);
    expect(rendered).toBe(`(ouronet-ns.PYTHIA.INFO_PYTHIA|RevokeLink "Ѻ.P" "₱.A|Π.B")`);
  });

  it("getRenameDualLaneInfoOnly's pactCode is exactly what buildRenameDualLanePreview renders for the same params", async () => {
    const reader = mockReader();
    const params = { patron: "Ѻ.P", dualLinkKey: "₱.A|Π.B", newName: "Lane" };
    await getRenameDualLaneInfoOnly(params);
    const [code] = reader.mock.calls[0];
    expect(code).toBe(buildRenameDualLanePreview(params));
  });

  it("getRevokeDualLinkInfoOnly's pactCode is exactly what buildRevokeDualLinkPreview renders for the same params", async () => {
    const reader = mockReader();
    const params = { patron: "Ѻ.P", dualLinkKey: "₱.A|Π.B" };
    await getRevokeDualLinkInfoOnly(params);
    const [code] = reader.mock.calls[0];
    expect(code).toBe(buildRevokeDualLinkPreview(params));
  });
});

describe("dualLinkOps.ts — the exec/preview param-name distinction is load-bearing, not a guess", () => {
  it("buildCall(RENAME_DUAL_LANE_KEY, ...) throws if fed the preview's 3-key shape (no executor) — proves the EXECUTE call actually needs executor, it isn't silently optional", () => {
    expect(() =>
      buildCall(RENAME_DUAL_LANE_KEY, {
        patron: "Ѻ.PATRON",
        "dual-link-key": "₱.A|Π.B",
        "new-name": "NewLane",
      }),
    ).toThrow(/missing: executor/);
  });

  it("buildCall(REVOKE_DUAL_LINK_KEY, ...) throws if fed the preview's 2-key shape (no executor) — same trap, same proof", () => {
    expect(() =>
      buildCall(REVOKE_DUAL_LINK_KEY, {
        patron: "Ѻ.PATRON",
        "dual-link-key": "₱.A|Π.B",
      }),
    ).toThrow(/missing: executor/);
  });
});

describe("dualLinkOps.ts — getRenameDualLaneInfo's let*/map composite embeds the registry-rendered preview correctly", () => {
  it("splices buildRenameDualLanePreview's exact output into the let* wrapper, and resolves DALOS.UR_AccountStoa off the registry's own namespace export", async () => {
    const reader = mockReader({
      result: { status: "success", data: { info: { kadena: { "kadena-targets": ["k:a"] } }, receivers: ["k:a"] } },
    });
    const params = { patron: "Ѻ.P", dualLinkKey: "₱.A|Π.B", newName: "Lane" };
    const result = await getRenameDualLaneInfo(params);

    const [code] = reader.mock.calls[0];
    const expectedInfoCall = buildRenameDualLanePreview(params);
    expect(code).toContain(`(let*`);
    expect(code).toContain(`(info ${expectedInfoCall})`);
    expect(code).toContain(`(${namespace}.DALOS.UR_AccountStoa)`);
    expect(code).toContain(`(at "kadena-targets" (at "kadena" info))`);
    expect(result).toEqual({ info: { kadena: { "kadena-targets": ["k:a"] } }, receivers: ["k:a"] });
  });

  it("returns null when required params are missing, without calling the reader", async () => {
    const reader = mockReader();
    const result = await getRenameDualLaneInfo({ patron: "", dualLinkKey: "₱.A|Π.B", newName: "Lane" });
    expect(result).toBeNull();
    expect(reader).not.toHaveBeenCalled();
  });
});
