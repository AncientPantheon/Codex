/**
 * E2 RED matrix — native AR send: buildSend base-unit + fee cap + post (E-05).
 *
 * SHAPE-DRIVES T12.4. E1 stubbed `buildSend`/`post` to throw
 * `NotImplementedError`, so every FILLED-behavior assertion below FAILS until
 * T12.4 fills them — that is the RED.
 *
 * RESOLVED SHAPES (from the phase DISCUSS-CONTEXT + the PINs):
 *   - `buildSend({ target, amountAr, maxRewardAr })` → a jwk-LESS
 *     `BuiltArweaveSend { target: string, quantity: bigint, maxRewardWinston: bigint }`.
 *     AR→winston is EXACT via arweave-core `arToWinston` (never a float/Number).
 *     No decrypt, no network — preserves the unlock gate.
 *   - `post(built, jwk, opts?)` → `sendTransfer(pool, { jwk, ...built }, opts)`,
 *     POOL-FIRST. The jwk is a PER-CALL TRANSIENT arg, NEVER a constructor dep,
 *     NEVER cached/closed-over (a re-locked codex must not sign with a stale key).
 *   - `TransferResult { id, reward }`.
 *
 * FUNDS-CRITICAL: base-unit correctness (winston bigint via arToWinston ONLY) +
 * the MANDATORY maxRewardWinston fee cap (RewardExceedsCapError over-cap). All
 * tests inject a FAKE apiFactory against a fake pool — zero network, zero funds.
 */

import { describe, it, expect, vi, afterEach } from "vitest";

import * as arweaveCore from "@ancientpantheon/arweave-core";
import {
  arToWinston,
  InvalidAmountError,
  InvalidTransferError,
  RewardExceedsCapError,
  ARWEAVE_ADDRESS_RE,
} from "@ancientpantheon/arweave-core";

import { createArweaveAdapter } from "../src/adapter";
import {
  throwawayJwk,
  CANONICAL_TARGET,
  makeSingleEndpointPool,
  makeFakeApiFactory,
} from "./e2-helpers";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildSend — AR→winston base-unit conversion + validation (E-05, base-unit critical)", () => {
  it("(a) converts amountAr/maxRewardAr to EXACT winston bigint via arToWinston (no float)", async () => {
    const adapter = createArweaveAdapter({ pool: makeSingleEndpointPool() as never });

    const built = (await adapter.buildSend({
      target: CANONICAL_TARGET,
      amountAr: "1.5",
      maxRewardAr: "0.01",
    })) as { target: string; quantity: bigint; maxRewardWinston: bigint };

    // EXACT bigint — a float/Number() path anywhere would drift off these.
    expect(built.quantity).toBe(1_500_000_000_000n);
    expect(built.quantity).toBe(arToWinston("1.5"));
    expect(built.maxRewardWinston).toBe(arToWinston("0.01"));
    expect(typeof built.quantity).toBe("bigint");
    expect(typeof built.maxRewardWinston).toBe("bigint");
    expect(built.target).toBe(CANONICAL_TARGET);
    // buildSend is jwk-LESS — the unlock gate stays meaningful.
    expect(built).not.toHaveProperty("jwk");
  });

  it("(b) REJECTS a malformed amount via InvalidAmountError (never silently coerces)", async () => {
    const adapter = createArweaveAdapter({ pool: makeSingleEndpointPool() as never });

    for (const bad of ["1e3", "0x10", "1.0000000000000", "-1", ""]) {
      await expect(
        adapter.buildSend({ target: CANONICAL_TARGET, amountAr: bad, maxRewardAr: "0.01" }),
      ).rejects.toBeInstanceOf(InvalidAmountError);
    }
  });

  it("(c) REJECTS a non-canonical target BEFORE any network via InvalidTransferError", async () => {
    const { apiFactory, calls } = makeFakeApiFactory();
    const adapter = createArweaveAdapter({ pool: makeSingleEndpointPool() as never });

    await expect(
      adapter.buildSend({
        target: "not-a-canonical-address",
        amountAr: "1.5",
        maxRewardAr: "0.01",
      }),
    ).rejects.toBeInstanceOf(InvalidTransferError);

    // No gateway op ran (build is offline; a bad target fails before post).
    void apiFactory;
    expect(calls.getAnchor).toBe(0);
    expect(calls.getPrice).toBe(0);
    expect(calls.postTransaction).toBe(0);
  });

  it("(d) FEE CAP MANDATORY — an absent max-reward throws with zero network", async () => {
    const adapter = createArweaveAdapter({ pool: makeSingleEndpointPool() as never });

    // No maxRewardAr / maxRewardWinston supplied — the cap is required.
    await expect(
      adapter.buildSend({ target: CANONICAL_TARGET, amountAr: "1.5" } as never),
    ).rejects.toBeInstanceOf(InvalidTransferError);
  });
});

describe("post — send over the pool via arweave-core sendTransfer (E-05)", () => {
  it("(e) FEE-CAP EXCEEDED — an over-cap quote throws RewardExceedsCapError {reward,cap} before build/sign/post", async () => {
    // maxReward cap = 0.01 AR = 10_000_000_000n winston; the fake quotes 20B (> cap).
    const overCapPrice = "20000000000";
    const { apiFactory, calls } = makeFakeApiFactory({ price: overCapPrice });
    const pool = makeSingleEndpointPool();
    const adapter = createArweaveAdapter({ pool: pool as never });

    const built = await adapter.buildSend({
      target: CANONICAL_TARGET,
      amountAr: "1.5",
      maxRewardAr: "0.01",
    });

    const err = await adapter
      .post(built, throwawayJwk, { apiFactory })
      .catch((e: Error) => e);

    expect(err).toBeInstanceOf(RewardExceedsCapError);
    expect((err as RewardExceedsCapError).reward).toBe(BigInt(overCapPrice));
    expect((err as RewardExceedsCapError).cap).toBe(arToWinston("0.01"));

    // The cap fires AFTER anchor+price reads but BEFORE build/sign/post: assert
    // the negative on POST ONLY (getAnchor/getPrice precede the cap and WILL run).
    expect(calls.postTransaction).toBe(0);
  });

  it("(f) a base-unit-correct send REACHES a signed+posted TransferResult {id, reward}", async () => {
    // In-cap price: 5B winston < 10B cap.
    const inCapPrice = "5000000000";
    const { apiFactory, calls } = makeFakeApiFactory({ price: inCapPrice, postStatus: 200 });
    const adapter = createArweaveAdapter({ pool: makeSingleEndpointPool() as never });

    const built = await adapter.buildSend({
      target: CANONICAL_TARGET,
      amountAr: "1.5",
      maxRewardAr: "0.01",
    });
    const result = (await adapter.post(built, throwawayJwk, { apiFactory })) as {
      id: string;
      reward: bigint;
    };

    // The signed tx id is canonical 43-char base64url; the reward equals the quote.
    expect(ARWEAVE_ADDRESS_RE.test(result.id)).toBe(true);
    expect(result.reward).toBe(BigInt(inCapPrice));
    // The post actually ran (the tx was signed before it).
    expect(calls.postTransaction).toBe(1);
    expect(calls.postedTxIds).toContain(result.id);
  });

  it("(g) calls arweave-core sendTransfer POOL-FIRST (pool is arg 1, params carry the merged jwk)", async () => {
    const pool = makeSingleEndpointPool();
    const spy = vi.spyOn(arweaveCore, "sendTransfer");
    const { apiFactory } = makeFakeApiFactory({ price: "5000000000" });
    const adapter = createArweaveAdapter({ pool: pool as never });

    const built = await adapter.buildSend({
      target: CANONICAL_TARGET,
      amountAr: "1.5",
      maxRewardAr: "0.01",
    });
    await adapter.post(built, throwawayJwk, { apiFactory });

    expect(spy).toHaveBeenCalledTimes(1);
    const [arg1, params] = spy.mock.calls[0];
    // Arity guard against the prompt's `sendTransfer(params, options)` mis-shape.
    expect(arg1).toBe(pool);
    expect(params).toMatchObject({
      jwk: throwawayJwk,
      target: CANONICAL_TARGET,
      quantity: 1_500_000_000_000n,
      maxRewardWinston: arToWinston("0.01"),
    });
  });

  it("(h) JWK is CALL-TRANSIENT — adapter carries no jwk; two posts with two jwks each sign with their OWN", async () => {
    // The adapter is constructible WITHOUT any key (deps carry no jwk).
    const adapter = createArweaveAdapter({ pool: makeSingleEndpointPool() as never });
    expect(adapter).not.toHaveProperty("jwk");

    const spy = vi.spyOn(arweaveCore, "sendTransfer");
    const built = await adapter.buildSend({
      target: CANONICAL_TARGET,
      amountAr: "1.5",
      maxRewardAr: "0.01",
    });

    // A second DIFFERENT jwk (flip a public-field char so it is a distinct object).
    const otherJwk = { ...throwawayJwk, kty: "RSA" as const, __tag: "other" } as never;

    const f1 = makeFakeApiFactory({ price: "5000000000" });
    const f2 = makeFakeApiFactory({ price: "5000000000" });
    await adapter.post(built, throwawayJwk, { apiFactory: f1.apiFactory });
    await adapter.post(built, otherJwk, { apiFactory: f2.apiFactory });

    // Each post forwarded ITS OWN jwk — no cached/closed-over key.
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[0][1].jwk).toBe(throwawayJwk);
    expect(spy.mock.calls[1][1].jwk).toBe(otherJwk);
    expect(spy.mock.calls[0][1].jwk).not.toBe(spy.mock.calls[1][1].jwk);
  });
});
