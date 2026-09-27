/**
 * zbom-pythia-deploy-api-key.test.ts — registry-backed render lock for
 * `src/zbom/pythia/deployApiKey.ts`'s EXEC + preview builders.
 *
 * Guards the exact trap this migration exists to close: `C_DeployApiKey`'s
 * live EXEC param is named `executor`, but its preview param for the SAME
 * account slot is named `owner-account` — a positional/name-guessed merge
 * would silently pass the wrong value or throw only by luck. This test
 * pins both signatures against the installed `@ouronet/talos-registry`
 * snapshot so a future contract rename fails HERE, not at a live panel.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { setPactReader } from "@stoachain/stoa-core/reads";
import { tryGetEntrypoint, buildCall, namespace } from "@ouronet/talos-registry";
import {
  DEPLOY_API_KEY_KEY,
  buildDeployApiKeyPactCode,
  buildDeployApiKeyPreview,
  getDeployApiKeyInfoOnly,
  getDeployApiKeyInfo,
} from "../src/zbom/pythia/deployApiKey.js";

afterEach(() => vi.restoreAllMocks());

function mockReader(response: unknown = { result: { status: "success", data: null } }) {
  const reader = vi.fn().mockResolvedValue(response);
  setPactReader(reader);
  return reader;
}

describe("deployApiKey — registry-backed builders", () => {
  it("DEPLOY_API_KEY_KEY resolves against the installed @ouronet/talos-registry, with the exact live param names/order and preview key pinned", () => {
    const ep = tryGetEntrypoint(DEPLOY_API_KEY_KEY);
    expect(ep).toBeDefined();
    expect(ep?.params.map((p) => p.name)).toEqual(["patron", "executor", "apollo-account", "public"]);
    expect(ep?.preview).toBe("PYTHIA.INFO_PYTHIA|DeployApiKey");
  });

  it("buildDeployApiKeyPactCode renders the EXEC call with the live (patron, executor, apollo-account, public) order", () => {
    const code = buildDeployApiKeyPactCode({
      patron: "PATRON-ACC",
      ownerAccount: "OWNER-ACC",
      apolloAccount: "APOLLO-ACC",
      publicKey: "PUB-KEY",
    });
    expect(code).toBe(
      '(ouronet-ns.TS01-C4.PYTHIA|C_DeployApiKey "PATRON-ACC" "OWNER-ACC" "APOLLO-ACC" "PUB-KEY")',
    );
  });

  it("buildDeployApiKeyPreview renders the INFO_ call with the live (patron, owner-account, apollo-account, public) order", () => {
    const code = buildDeployApiKeyPreview({
      patron: "PATRON-ACC",
      ownerAccount: "OWNER-ACC",
      apolloAccount: "APOLLO-ACC",
      publicKey: "PUB-KEY",
    });
    expect(code).toBe(
      '(ouronet-ns.PYTHIA.INFO_PYTHIA|DeployApiKey "PATRON-ACC" "OWNER-ACC" "APOLLO-ACC" "PUB-KEY")',
    );
  });

  it("the registry throws loudly if `owner-account` (the preview's name) is used for the EXEC call instead of `executor` — proves the mapping in buildDeployApiKeyPactCode is load-bearing, not a guess", () => {
    expect(() =>
      buildCall(DEPLOY_API_KEY_KEY, {
        patron: "PATRON-ACC",
        "owner-account": "OWNER-ACC",
        "apollo-account": "APOLLO-ACC",
        public: "PUB-KEY",
      }),
    ).toThrow(/missing: executor/);
  });

  it("getDeployApiKeyInfoOnly's pactCode is exactly what buildDeployApiKeyPreview renders for the same params", async () => {
    const reader = mockReader();
    const params = { patron: "PATRON-ACC", ownerAccount: "OWNER-ACC", apolloAccount: "APOLLO-ACC", publicKey: "PUB-KEY" };
    await getDeployApiKeyInfoOnly(params);
    const [code] = reader.mock.calls[0];
    expect(code).toBe(buildDeployApiKeyPreview(params));
  });

  it("getDeployApiKeyInfo's let*/map composite embeds the registry-rendered preview correctly, resolving DALOS.UR_AccountStoa off the registry's own namespace export", async () => {
    const reader = mockReader({
      result: { status: "success", data: { info: { kadena: { "kadena-targets": ["k:a"] } }, receivers: ["k:a"] } },
    });
    const params = { patron: "PATRON-ACC", ownerAccount: "OWNER-ACC", apolloAccount: "APOLLO-ACC", publicKey: "PUB-KEY" };
    const result = await getDeployApiKeyInfo(params);

    const [code] = reader.mock.calls[0];
    const expectedInfoCall = buildDeployApiKeyPreview(params);
    expect(code).toContain(`(let*`);
    expect(code).toContain(`(info ${expectedInfoCall})`);
    expect(code).toContain(`(${namespace}.DALOS.UR_AccountStoa)`);
    expect(code).toContain(`(at "kadena-targets" (at "kadena" info))`);
    expect(result).toEqual({ info: { kadena: { "kadena-targets": ["k:a"] } }, receivers: ["k:a"] });
  });

  it("getDeployApiKeyInfo returns null when required params are missing, without calling the reader", async () => {
    const reader = mockReader();
    const result = await getDeployApiKeyInfo({ patron: "", ownerAccount: "OWNER-ACC", apolloAccount: "APOLLO-ACC", publicKey: "PUB-KEY" });
    expect(result).toBeNull();
    expect(reader).not.toHaveBeenCalled();
  });
});
