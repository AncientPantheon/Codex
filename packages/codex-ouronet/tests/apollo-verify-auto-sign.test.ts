/**
 * autoSignApolloChallenge — round-trip proof (docs/HANDOFF-pythia-autonomous-connector.md §7).
 *
 * Proves, locally, that a signature `autoSignApolloChallenge` produces is
 * byte-format-compatible with Pythia's `apolloVerify()` (a different repo):
 * same canonical message (`buildApolloOwnershipMessage`), same curve
 * (`dalos-apollo` Schnorr v2). We can't import Pythia's code from here, so we
 * independently verify the signature via `Apollo.verify` against the exact
 * message + public key an RP would use — a passing assertion is the
 * strongest same-repo evidence that the two sides agree on format.
 */

import { describe, it, expect } from "vitest";
import { Apollo } from "@ouronet/dalos-crypto/registry";
import { encryptStringV2 } from "@stoachain/stoa-core/crypto";
import { autoSignApolloChallenge, buildApolloOwnershipMessage } from "@ancientpantheon/codex-ouronet/apollo-verify";
import type { IOuroAccount } from "@ancientpantheon/codex-ouronet/types";

const WORDS = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel"];
const PASSWORD = "correct horse battery staple";

async function buildAccount(): Promise<{ account: IOuroAccount; publicKey: string }> {
  const full = Apollo.generateFromSeedWords(WORDS);
  const secret = await encryptStringV2(full.privateKey.bitString, PASSWORD);
  const account: IOuroAccount = {
    id: "test-apollo-account",
    version: "1.0",
    isSmart: false,
    address: full.standardAddress,
    guard: null,
    stoaChainLedger: null,
    publicKey: full.keyPair.publ,
    secret,
    backup: "",
    originMode: "bitString",
    originCurve: "apollo",
  };
  return { account, publicKey: full.keyPair.publ };
}

describe("autoSignApolloChallenge", () => {
  it("produces a signature that verifies via Apollo.verify against the canonical message + curve", async () => {
    const { account, publicKey } = await buildAccount();
    const snapshot = { ouroAccounts: [account] };
    const nonce = "test-nonce-123";
    const rp = "pythia.ancientholdings.eu";

    const proof = await autoSignApolloChallenge(snapshot, PASSWORD, account.address, nonce, rp);

    expect(proof.apollo).toBe(account.address);
    const message = buildApolloOwnershipMessage(account.address, nonce, rp);
    expect(Apollo.verify?.(proof.sig, message, publicKey)).toBe(true);

    // A tampered message (any of the 3 challenge fields) must NOT verify — this
    // is the exact failure mode the handoff calls "the #1 integration bug."
    const tampered = buildApolloOwnershipMessage(account.address, "different-nonce", rp);
    expect(Apollo.verify?.(proof.sig, tampered, publicKey)).toBe(false);
  });

  it("throws a clear, named error — not a silent no-op — when the account isn't in the snapshot", async () => {
    await expect(
      autoSignApolloChallenge({ ouroAccounts: [] }, PASSWORD, "₱.doesnotexist", "n", "rp"),
    ).rejects.toThrow(/₱\.doesnotexist/);
  });

  it("treats a missing ouroAccounts array as empty (never throws a TypeError on the snapshot shape)", async () => {
    await expect(
      autoSignApolloChallenge({}, PASSWORD, "₱.doesnotexist", "n", "rp"),
    ).rejects.toThrow(/₱\.doesnotexist/);
  });

  it("throws — never silently signs with garbage — on a wrong codex password", async () => {
    const { account } = await buildAccount();
    const snapshot = { ouroAccounts: [account] };
    await expect(
      autoSignApolloChallenge(snapshot, "totally the wrong password", account.address, "n", "rp"),
    ).rejects.toThrow();
  });
});
