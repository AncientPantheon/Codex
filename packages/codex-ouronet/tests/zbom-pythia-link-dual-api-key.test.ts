/**
 * zbom-pythia-link-dual-api-key.test.ts — registry-backed render lock for
 * `src/zbom/pythia/linkDualApiKey.ts`'s EXEC + preview builders.
 *
 * Guards the exact trap this migration exists to close (Trap ①, per
 * `docs/work/talos-registry-pythia-ops/design.md`): `C_Link`'s live EXEC
 * signature is `(executor standard-apollo smart-apollo consumer-lane)` — 4
 * args — but its preview `INFO_PYTHIA|Link` is `(standard-apollo
 * smart-apollo consumer-lane)` — 3 args, no `executor`. A positional or
 * name-guessed merge between the two would silently shift every preview
 * arg by one. This test pins both signatures against the installed
 * `@ouronet/talos-registry` snapshot so a future contract-surface change
 * fails HERE, not at a live panel.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { setPactReader } from "@stoachain/stoa-core/reads";
import { tryGetEntrypoint, buildCall } from "@ouronet/talos-registry";
import {
  LINK_DUAL_API_KEY_KEY,
  buildLinkDualApiKeyPactCode,
  buildLinkDualApiKeyPreview,
  getLinkDualApiKeyInfo,
} from "../src/zbom/pythia/linkDualApiKey.js";

afterEach(() => vi.restoreAllMocks());

describe("linkDualApiKey — registry-backed builders", () => {
  it("LINK_DUAL_API_KEY_KEY resolves against the installed @ouronet/talos-registry to the live 4-arg EXEC whose .preview is the 3-arg INFO_PYTHIA|Link", () => {
    const ep = tryGetEntrypoint(LINK_DUAL_API_KEY_KEY);
    expect(ep).toBeDefined();
    expect(ep?.params.map((p) => p.name)).toEqual([
      "executor",
      "standard-apollo",
      "smart-apollo",
      "consumer-lane",
    ]);
    expect(ep?.preview).toBe("PYTHIA.INFO_PYTHIA|Link");
  });

  it("buildLinkDualApiKeyPactCode renders the EXEC call with the live (executor, standard-apollo, smart-apollo, consumer-lane) order", () => {
    const code = buildLinkDualApiKeyPactCode({
      executor: "Ѻ.EXEC",
      standardApollo: "₱.A",
      smartApollo: "Π.B",
      consumerLane: "Explorer",
    });
    expect(code).toBe(`(ouronet-ns.TS01-C4.PYTHIA|C_Link "Ѻ.EXEC" "₱.A" "Π.B" "Explorer")`);
  });

  it("buildLinkDualApiKeyPreview renders the INFO_ call with the live (standard-apollo, smart-apollo, consumer-lane) order and drops executor entirely", () => {
    const code = buildLinkDualApiKeyPreview({
      standardApollo: "₱.A",
      smartApollo: "Π.B",
      consumerLane: "Explorer",
    });
    expect(code).toBe(`(ouronet-ns.PYTHIA.INFO_PYTHIA|Link "₱.A" "Π.B" "Explorer")`);
  });

  it("getLinkDualApiKeyInfo reads the exact buildPreviewCall-rendered string (no executor leaks into the preview read)", async () => {
    const reader = vi.fn().mockResolvedValue({ result: { status: "success", data: null } });
    setPactReader(reader);
    await getLinkDualApiKeyInfo({
      executor: "Ѻ.EXEC",
      standardApollo: "₱.A",
      smartApollo: "Π.B",
      consumerLane: "Explorer",
    });
    const [code] = reader.mock.calls[0];
    expect(code).toBe(`(ouronet-ns.PYTHIA.INFO_PYTHIA|Link "₱.A" "Π.B" "Explorer")`);
    expect(code).not.toContain("Ѻ.EXEC");
  });

  it("the registry throws loudly if the preview's 3-key shape is used for the EXEC call instead of the 4-key shape with `executor` — proves the mapping in buildLinkDualApiKeyPactCode is load-bearing, not a guess", () => {
    expect(() =>
      buildCall(LINK_DUAL_API_KEY_KEY, {
        "standard-apollo": "₱.A",
        "smart-apollo": "Π.B",
        "consumer-lane": "Explorer",
      }),
    ).toThrow(/missing: executor/);
  });
});
