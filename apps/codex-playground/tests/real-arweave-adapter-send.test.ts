/**
 * Regression: real-mode `sendFrom` must forward the winston quantity under
 * the key `buildSend` actually reads.
 *
 * Bug report (verbatim): clicking Send AR with a valid amount and a fee
 * quote that comfortably covers it ("Recipient receives: ~0.189... AR")
 * still failed with "Invalid transfer: quantity must be a positive Winston
 * bigint" — arweave-core's own non-positive-quantity rejection, even though
 * the UI's computed quantity was positive.
 *
 * Root cause: `buildRealPanelDeps`'s `sendFrom` (realArweaveAdapter.ts) built
 * its `buildSend` call with a `quantity` field:
 *
 *   resolvedAdapter.buildSend({ target, quantity: req.quantity, maxRewardWinston })
 *
 * but `BuildSendParams` (packages/codex-arweave/src/adapter/arweaveAdapter.ts)
 * has no `quantity` field — only `amountAr`/`quantityWinston`. `ForeignChainAdapter`
 * (codex-core) declares `buildSend(...args: unknown[]): Promise<unknown>`
 * DELIBERATELY loosely (it spans multiple chains with different call shapes),
 * so this key-name mismatch compiled clean and only broke at runtime: the
 * real `buildSend` read `params.quantityWinston` (undefined, since the caller
 * sent `quantity` instead), fell through to `undefined`, and threw the
 * "non-positive-quantity" `InvalidTransferError` — exactly the reported
 * message — regardless of what amount the user actually typed.
 *
 * This test drives `buildRealPanelDeps`'s real `sendFrom` closure (not a
 * hand-rolled copy) against an INJECTED fake `ForeignChainAdapter`, so a
 * regression back to the wrong key is caught even though the generic
 * `ForeignChainAdapter` interface can never catch it at compile time.
 */
import { describe, it, expect, vi } from "vitest";
import { encryptStringV2 } from "@stoachain/stoa-core/crypto";
import type { ForeignChainAdapter, ForeignKeyEntry } from "@ancientpantheon/codex-core";
import { ARWEAVE_CHAIN_ID } from "@ancientpantheon/codex-arweave/address-book";
import { buildRealPanelDeps } from "../src/realArweaveAdapter";

const TEST_PASSWORD = "correct horse battery staple";
/** Not a real Arweave JWK — the fake adapter never inspects its shape, only
 *  that decrypt round-trips it back to SOMETHING to hand to `post`. */
const FAKE_JWK = { kty: "RSA", n: "fake", e: "AQAB" };

async function makeEntry(): Promise<ForeignKeyEntry> {
  const encryptedKeyfile = await encryptStringV2(JSON.stringify(FAKE_JWK), TEST_PASSWORD);
  return {
    id: "test-arweave-address",
    chainId: ARWEAVE_CHAIN_ID,
    encryptedKeyfile,
    address: "test-arweave-address",
  };
}

describe("buildRealPanelDeps().sendFrom — buildSend param wiring", () => {
  it("forwards the request's winston quantity as buildSend's `quantityWinston`, not `quantity`", async () => {
    const buildSendMock = vi.fn(async (params: unknown) => ({
      target: (params as { target: string }).target,
      // Echo back whatever buildSend actually resolved as `quantity` — this
      // is what a real `buildSend` would compute from `quantityWinston`, so
      // a wrong caller-side key surfaces here as `undefined`, not a thrown
      // error (that assertion happens separately below to also pin the
      // real-world failure mode verbatim).
      quantity: (params as { quantityWinston?: bigint }).quantityWinston,
      maxRewardWinston: (params as { maxRewardWinston: bigint }).maxRewardWinston,
    }));
    const postMock = vi.fn(async () => ({ id: "fake-tx-id", reward: 1_000_000n }));

    const fakeAdapter = {
      id: ARWEAVE_CHAIN_ID,
      generateKey: vi.fn(),
      importKey: vi.fn(),
      addressOf: vi.fn(),
      getBalance: vi.fn(async () => 0n),
      buildSend: buildSendMock,
      post: postMock,
    } as unknown as ForeignChainAdapter;

    const entry = await makeEntry();
    const deps = buildRealPanelDeps({
      gatewayUrl: "https://arweave.example.invalid",
      adapter: fakeAdapter,
      getPassword: () => TEST_PASSWORD,
    });

    const quantity = 189_037_091_749n; // matches the reported bug's "Recipient receives" figure
    const maxRewardWinston = 311_000_000_000n;

    const result = await deps.sendFrom(entry, {
      target: "5r5K0YRFIOpygvQE3ucYBgz5zYaMvff54pc5vxZGyJ8",
      quantity,
      maxRewardWinston,
    });

    expect(buildSendMock).toHaveBeenCalledTimes(1);
    const [params] = buildSendMock.mock.calls[0]!;
    // The actual regression assertion: `quantityWinston`, not `quantity`.
    expect((params as { quantityWinston?: bigint }).quantityWinston).toBe(quantity);
    expect((params as Record<string, unknown>).quantity).toBeUndefined();
    expect(result).toEqual({ id: "fake-tx-id", reward: 1_000_000n });
  });

  it("end-to-end through the REAL codex-arweave buildSend: a positive quantity never throws non-positive-quantity", async () => {
    // No `adapter` override — this constructs the REAL `createArweaveAdapter`
    // (codex-arweave), so `buildSend`'s actual `BuildSendParams` validation
    // runs for real. Only `post` needs a live network, so this stops just
    // short of it by asserting build succeeded via a spy `post`... but
    // `buildRealPanelDeps` doesn't expose build separately, so instead we
    // inject a fake adapter whose `buildSend` IS the real one and whose
    // `post` is a stub — exercising the exact call this bug broke.
    const { createArweaveAdapter } = await import("@ancientpantheon/codex-arweave");
    const realAdapter = createArweaveAdapter({});
    const postMock = vi.fn(async () => ({ id: "fake-tx-id-2", reward: 1_000_000n }));
    const fakeAdapter = {
      ...realAdapter,
      post: postMock,
    } as unknown as ForeignChainAdapter;

    const entry = await makeEntry();
    const deps = buildRealPanelDeps({
      gatewayUrl: "https://arweave.example.invalid",
      adapter: fakeAdapter,
      getPassword: () => TEST_PASSWORD,
    });

    await expect(
      deps.sendFrom(entry, {
        target: "5r5K0YRFIOpygvQE3ucYBgz5zYaMvff54pc5vxZGyJ8",
        quantity: 189_037_091_749n,
        maxRewardWinston: 311_000_000_000n,
      }),
    ).resolves.toEqual({ id: "fake-tx-id-2", reward: 1_000_000n });
    expect(postMock).toHaveBeenCalledTimes(1);
  });
});
