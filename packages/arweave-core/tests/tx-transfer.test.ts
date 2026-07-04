/**
 * tx-transfer.test.ts — native AR transfer orchestration through the pool.
 *
 * `sendTransfer(pool, params, opts?)` builds a transfer transaction fully
 * offline (anchor + price fetched through the Phase 2 pool), signs it via the
 * T3.3 isolated signer, and posts it through the pool with retry/rotation. It
 * resolves `{ id, reward }`.
 *
 * The order it MUST implement:
 *   0. PRE-FLIGHT origin-only guard over the pool's configured endpoints — a
 *      pathed endpoint surfaces `UnsupportedEndpointError` UNWRAPPED, zero
 *      pool attempts.
 *   1. input validation — jwk via `importKeyfile`, target 43-char base64url,
 *      quantity > 0n — before any pool attempt.
 *   2. anchor + price EACH through `pool.execute`; the price op strictly gates
 *      the returned string with `^\d+$` and throws `InvalidGatewayPriceError`
 *      inside the op on failure → rotation.
 *   2b. fee cap — if `opts.maxRewardWinston` is set and the quote exceeds it,
 *      throw `RewardExceedsCapError` to the caller BEFORE building/signing.
 *   3. build offline via `createTransaction({ target, quantity, last_tx, reward }, jwk)`.
 *   4. sign via the T3.3 signer.
 *   5. post through `pool.execute`; the post op throws `TransferPostFailedError`
 *      for any status outside 200-299 → rotation.
 *   6. resolve `{ id: tx.id, reward }`.
 *
 * Tests use a REAL Phase 2 pool (multi-endpoint, injected instant sleep) plus an
 * injected fake API factory of PLAIN functions — no network, no arweave-js
 * network objects. Explicit vitest imports (no globals contract).
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { inspect } from "node:util";
import Arweave from "arweave";
import type Transaction from "arweave/node/lib/transaction";

import { createGatewayPool } from "../src/gateway/pool.js";
import { GatewayPoolExhaustedError } from "../src/gateway/errors.js";
import { UnsupportedEndpointError } from "../src/endpoints.js";
import { InvalidKeyfileError } from "../src/keys/errors.js";
import { sendTransfer } from "../src/tx/transfer.js";
import {
  InvalidTransferError,
  TransferPostFailedError,
  InvalidGatewayPriceError,
  RewardExceedsCapError,
} from "../src/tx/errors.js";
import type {
  TransferGatewayApi,
  TransferGatewayApiFactory,
  TransferParams,
} from "../src/tx/types.js";
import { TEST_KEYFILE } from "./fixtures/test-keyfile.js";

const instantSleep = async () => {};

/** A never-networked instance for the verify oracle only (verify is local). */
const oracle = Arweave.init({ host: "arweave.net", protocol: "https", port: 443 });

/** A canonical 43-char base64url recipient (sliced to the exact length). */
const TARGET = "9-M4c1zJ2xN7abcdEFGHijkLMNopQRSTuvWXyz012345".slice(0, 43);
const ANCHOR = "abcdEFGHijkLMNopQRSTuvWXyz0123456789_-ABCDEF".slice(0, 43);
const PRICE = "1000000000"; // honest Winston fee quote (decimal string)
const QUANTITY = 500000000000n; // Winston bigint
/** A cap comfortably above the honest PRICE — the fee cap is now REQUIRED, so
 *  every path that reaches the reward check supplies one. */
const CAP = 1000000000000n;

/**
 * A fake per-endpoint gateway API of plain functions. Captures the tx handed to
 * `postTransaction` so the suite can inspect the signed body and run the verify
 * oracle. `postBehavior` decides each endpoint's post outcome by base URL.
 */
interface FakeApiOptions {
  anchor?: string;
  /** Per-endpoint price override; falls back to `PRICE`. */
  priceByEndpoint?: Record<string, string>;
  /**
   * Per-endpoint post behavior. Return a status object (checked by the op) or
   * throw to simulate a network-level failure. Defaults to 200 everywhere.
   */
  postBehavior?: (
    endpoint: string,
    tx: Transaction,
  ) => Promise<{ status: number; statusText?: string }>;
}

function makeFakeFactory(opts: FakeApiOptions = {}): {
  factory: TransferGatewayApiFactory;
  anchorCalls: string[];
  priceCalls: string[];
  postedTxs: Transaction[];
  postEndpoints: string[];
} {
  const anchorCalls: string[] = [];
  const priceCalls: string[] = [];
  const postedTxs: Transaction[] = [];
  const postEndpoints: string[] = [];

  const factory: TransferGatewayApiFactory = (
    endpoint: string,
  ): TransferGatewayApi => ({
    async getAnchor() {
      anchorCalls.push(endpoint);
      return opts.anchor ?? ANCHOR;
    },
    async getPrice(_byteSize: number, _target: string) {
      priceCalls.push(endpoint);
      return opts.priceByEndpoint?.[endpoint] ?? PRICE;
    },
    async postTransaction(tx: Transaction) {
      postEndpoints.push(endpoint);
      postedTxs.push(tx);
      if (opts.postBehavior) return opts.postBehavior(endpoint, tx);
      return { status: 200, statusText: "OK" };
    },
  });

  return { factory, anchorCalls, priceCalls, postedTxs, postEndpoints };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("sendTransfer — happy path through the pool", () => {
  it("builds, signs, and posts a transfer; resolves the signed tx's 43-char id and paid reward", async () => {
    const { factory, postedTxs } = makeFakeFactory();
    const pool = createGatewayPool({
      endpoints: ["https://a.example"],
      sleep: instantSleep,
    });

    const result = await sendTransfer(
      pool,
      { jwk: TEST_KEYFILE, target: TARGET, quantity: QUANTITY, maxRewardWinston: CAP },
      { apiFactory: factory },
    );

    // id is the signed tx's canonical id; reward is the exact paid fee.
    expect(result.id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.reward).toBe(BigInt(PRICE));

    // The posted body carries the correct wire fields.
    expect(postedTxs).toHaveLength(1);
    const posted = postedTxs[0];
    expect(posted.target).toBe(TARGET);
    expect(posted.quantity).toBe(QUANTITY.toString());
    expect(posted.last_tx).toBe(ANCHOR);
    expect(posted.reward).toBe(PRICE);
    expect(posted.owner).toBe(TEST_KEYFILE.n);
    expect(posted.signature.length).toBeGreaterThan(0);
    expect(posted.id).toBe(result.id);
  });
});

describe("sendTransfer — retry/rotation on post failure", () => {
  it("rotates to endpoint B after a non-2xx post on A; same id, exactly one successful post", async () => {
    const { factory, postEndpoints, postedTxs } = makeFakeFactory({
      postBehavior: async (endpoint) => {
        if (endpoint === "https://a.example") return { status: 500 };
        return { status: 200 };
      },
    });
    const pool = createGatewayPool({
      endpoints: ["https://a.example", "https://b.example"],
      sleep: instantSleep,
    });

    const result = await sendTransfer(
      pool,
      { jwk: TEST_KEYFILE, target: TARGET, quantity: QUANTITY, maxRewardWinston: CAP },
      { apiFactory: factory },
    );

    expect(result.id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // A failed (recorded), then B succeeded — both attempts saw the same tx id.
    expect(postEndpoints).toEqual(["https://a.example", "https://b.example"]);
    expect(postedTxs[0].id).toBe(postedTxs[1].id);
    expect(postedTxs[1].id).toBe(result.id);
  });

  it("rotates after a thrown network-level error on the post op too", async () => {
    const { factory } = makeFakeFactory({
      postBehavior: async (endpoint) => {
        if (endpoint === "https://a.example") {
          throw new Error("ECONNRESET — simulated network failure");
        }
        return { status: 200 };
      },
    });
    const pool = createGatewayPool({
      endpoints: ["https://a.example", "https://b.example"],
      sleep: instantSleep,
    });

    const result = await sendTransfer(
      pool,
      { jwk: TEST_KEYFILE, target: TARGET, quantity: QUANTITY, maxRewardWinston: CAP },
      { apiFactory: factory },
    );
    expect(result.id).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("treats 208 (already processed) as success — no rotation", async () => {
    const { factory, postEndpoints } = makeFakeFactory({
      postBehavior: async () => ({ status: 208, statusText: "Already Reported" }),
    });
    const pool = createGatewayPool({
      endpoints: ["https://a.example", "https://b.example"],
      sleep: instantSleep,
    });

    const result = await sendTransfer(
      pool,
      { jwk: TEST_KEYFILE, target: TARGET, quantity: QUANTITY, maxRewardWinston: CAP },
      { apiFactory: factory },
    );
    expect(result.id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // 208 succeeded on the first endpoint — no rotation.
    expect(postEndpoints).toEqual(["https://a.example"]);
  });
});

describe("sendTransfer — pool exhaustion on post", () => {
  it("rejects with GatewayPoolExhaustedError UNWRAPPED whose attempts carry TransferPostFailedError", async () => {
    const { factory } = makeFakeFactory({
      postBehavior: async () => ({ status: 503, statusText: "Service Unavailable" }),
    });
    const pool = createGatewayPool({
      endpoints: ["https://a.example", "https://b.example"],
      maxAttemptsPerEndpoint: 1,
      sleep: instantSleep,
    });

    let thrown: unknown;
    try {
      await sendTransfer(
        pool,
        { jwk: TEST_KEYFILE, target: TARGET, quantity: QUANTITY, maxRewardWinston: CAP },
        { apiFactory: factory },
      );
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(GatewayPoolExhaustedError);
    const attempts = (thrown as GatewayPoolExhaustedError).attempts;
    expect(attempts.map((a) => a.endpoint)).toEqual([
      "https://a.example",
      "https://b.example",
    ]);
    for (const attempt of attempts) {
      expect(attempt.error).toBeInstanceOf(TransferPostFailedError);
      const err = attempt.error as TransferPostFailedError;
      expect(err.status).toBe(503);
      expect(err.endpoint).toBe(attempt.endpoint);
    }
  });
});

describe("sendTransfer — exhaustion on the read path (no post attempted)", () => {
  it("surfaces GatewayPoolExhaustedError from anchor/price with zero post attempts", async () => {
    const postEndpoints: string[] = [];
    const factory: TransferGatewayApiFactory = () => ({
      async getAnchor() {
        throw new Error("anchor endpoint down");
      },
      async getPrice() {
        return PRICE;
      },
      async postTransaction(_tx) {
        postEndpoints.push("posted");
        return { status: 200 };
      },
    });
    const pool = createGatewayPool({
      endpoints: ["https://a.example", "https://b.example"],
      maxAttemptsPerEndpoint: 1,
      sleep: instantSleep,
    });

    await expect(
      sendTransfer(
        pool,
        { jwk: TEST_KEYFILE, target: TARGET, quantity: QUANTITY, maxRewardWinston: CAP },
        { apiFactory: factory },
      ),
    ).rejects.toBeInstanceOf(GatewayPoolExhaustedError);
    // The build never happened, so nothing was posted.
    expect(postEndpoints).toHaveLength(0);
  });
});

describe("sendTransfer — input validation (zero pool attempts)", () => {
  it("throws InvalidTransferError for a malformed target without touching the pool", async () => {
    const { factory, anchorCalls, priceCalls, postedTxs } = makeFakeFactory();
    const pool = createGatewayPool({
      endpoints: ["https://a.example"],
      sleep: instantSleep,
    });

    await expect(
      sendTransfer(
        pool,
        { jwk: TEST_KEYFILE, target: "too-short", quantity: QUANTITY, maxRewardWinston: CAP },
        { apiFactory: factory },
      ),
    ).rejects.toBeInstanceOf(InvalidTransferError);
    expect(anchorCalls).toHaveLength(0);
    expect(priceCalls).toHaveLength(0);
    expect(postedTxs).toHaveLength(0);
  });

  it("throws InvalidTransferError for a zero quantity", async () => {
    const { factory } = makeFakeFactory();
    const pool = createGatewayPool({
      endpoints: ["https://a.example"],
      sleep: instantSleep,
    });
    await expect(
      sendTransfer(
        pool,
        { jwk: TEST_KEYFILE, target: TARGET, quantity: 0n, maxRewardWinston: CAP },
        { apiFactory: factory },
      ),
    ).rejects.toBeInstanceOf(InvalidTransferError);
  });

  it("throws InvalidTransferError for a negative quantity", async () => {
    const { factory } = makeFakeFactory();
    const pool = createGatewayPool({
      endpoints: ["https://a.example"],
      sleep: instantSleep,
    });
    await expect(
      sendTransfer(
        pool,
        { jwk: TEST_KEYFILE, target: TARGET, quantity: -5n, maxRewardWinston: CAP },
        { apiFactory: factory },
      ),
    ).rejects.toBeInstanceOf(InvalidTransferError);
  });

  it("throws InvalidKeyfileError for a malformed jwk without touching the pool", async () => {
    const { factory, anchorCalls, postedTxs } = makeFakeFactory();
    const broken = { ...TEST_KEYFILE } as Record<string, unknown>;
    delete broken.d;
    const pool = createGatewayPool({
      endpoints: ["https://a.example"],
      sleep: instantSleep,
    });

    await expect(
      sendTransfer(
        pool,
        {
          jwk: broken as unknown as typeof TEST_KEYFILE,
          target: TARGET,
          quantity: QUANTITY,
          maxRewardWinston: CAP,
        },
        { apiFactory: factory },
      ),
    ).rejects.toBeInstanceOf(InvalidKeyfileError);
    expect(anchorCalls).toHaveLength(0);
    expect(postedTxs).toHaveLength(0);
  });
});

describe("sendTransfer — signing correctness spot-check", () => {
  it("the tx captured by the fake post verifies true against the arweave-js oracle", async () => {
    const { factory, postedTxs } = makeFakeFactory();
    const pool = createGatewayPool({
      endpoints: ["https://a.example"],
      sleep: instantSleep,
    });

    await sendTransfer(
      pool,
      { jwk: TEST_KEYFILE, target: TARGET, quantity: QUANTITY, maxRewardWinston: CAP },
      { apiFactory: factory },
    );

    // End-to-end composition proof: the posted tx carries a consensus-valid
    // signature (deep-hash + RSA-PSS) the network would accept.
    await expect(oracle.transactions.verify(postedTxs[0])).resolves.toBe(true);
  });
});

describe("sendTransfer — strict price gate rotates on a gate-failing quote", () => {
  it("rejects a gate-failing '1e3' quote on A (InvalidGatewayPriceError inside the op) and rotates to B's honest quote", async () => {
    // "1e3" passes arweave-js's isNaN check but fails the strict ^\d+$ gate; a
    // reward string is embedded in a SIGNED tx, so it must never slip through.
    const { factory, postedTxs } = makeFakeFactory({
      priceByEndpoint: {
        "https://a.example": "1e3",
        "https://b.example": PRICE,
      },
    });
    const pool = createGatewayPool({
      endpoints: ["https://a.example", "https://b.example"],
      sleep: instantSleep,
    });

    const result = await sendTransfer(
      pool,
      { jwk: TEST_KEYFILE, target: TARGET, quantity: QUANTITY, maxRewardWinston: CAP },
      { apiFactory: factory },
    );

    // The honest quote from B is what got signed and paid.
    expect(result.reward).toBe(BigInt(PRICE));
    expect(postedTxs[0].reward).toBe(PRICE);
  });

  it("exhausts with InvalidGatewayPriceError attempts when EVERY endpoint quotes garbage", async () => {
    const { factory } = makeFakeFactory({
      priceByEndpoint: {
        "https://a.example": " 123",
        "https://b.example": "0x10",
      },
    });
    const pool = createGatewayPool({
      endpoints: ["https://a.example", "https://b.example"],
      maxAttemptsPerEndpoint: 1,
      sleep: instantSleep,
    });

    let thrown: unknown;
    try {
      await sendTransfer(
        pool,
        { jwk: TEST_KEYFILE, target: TARGET, quantity: QUANTITY, maxRewardWinston: CAP },
        { apiFactory: factory },
      );
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(GatewayPoolExhaustedError);
    for (const attempt of (thrown as GatewayPoolExhaustedError).attempts) {
      expect(attempt.error).toBeInstanceOf(InvalidGatewayPriceError);
    }
  });
});

describe("sendTransfer — the fee cap is REQUIRED (fund-burn defense)", () => {
  it("throws InvalidTransferError with reason missing-max-reward when no cap is supplied, before ANY pool call", async () => {
    // The reward is quoted by an untrusted rotating gateway and signed/PAID
    // verbatim. Refusing to run without a caller-stated ceiling is the default
    // defense against a compromised/MITM'd gateway inflating the fee.
    const { factory, anchorCalls, priceCalls, postedTxs } = makeFakeFactory();
    const pool = createGatewayPool({
      endpoints: ["https://a.example"],
      sleep: instantSleep,
    });

    let thrown: unknown;
    try {
      await sendTransfer(
        pool,
        // No maxRewardWinston on the params — the cast bypasses the compile-time
        // requirement to exercise the RUNTIME guard that rejects an absent cap.
        {
          jwk: TEST_KEYFILE,
          target: TARGET,
          quantity: QUANTITY,
        } as unknown as TransferParams,
        { apiFactory: factory },
      );
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(InvalidTransferError);
    expect((thrown as InvalidTransferError).reason).toBe("missing-max-reward");
    // Rejected BEFORE any anchor/price/post — zero pool attempts.
    expect(anchorCalls).toHaveLength(0);
    expect(priceCalls).toHaveLength(0);
    expect(postedTxs).toHaveLength(0);
  });

  it("throws RewardExceedsCapError to the caller when the quote exceeds maxRewardWinston; nothing built/signed/posted", async () => {
    const { factory, postedTxs } = makeFakeFactory({
      priceByEndpoint: { "https://a.example": "5000000000000" }, // 5000 AR-ish
    });
    const pool = createGatewayPool({
      endpoints: ["https://a.example"],
      sleep: instantSleep,
    });

    let thrown: unknown;
    try {
      await sendTransfer(
        pool,
        {
          jwk: TEST_KEYFILE,
          target: TARGET,
          quantity: QUANTITY,
          maxRewardWinston: 1000000000n,
        },
        { apiFactory: factory },
      );
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(RewardExceedsCapError);
    const err = thrown as RewardExceedsCapError;
    expect(err.reward).toBe(5000000000000n);
    expect(err.cap).toBe(1000000000n);
    // The cap is enforced BEFORE building/signing/posting.
    expect(postedTxs).toHaveLength(0);
  });

  it("allows a quote exactly at the cap (boundary is inclusive)", async () => {
    const { factory } = makeFakeFactory({
      priceByEndpoint: { "https://a.example": PRICE },
    });
    const pool = createGatewayPool({
      endpoints: ["https://a.example"],
      sleep: instantSleep,
    });

    const result = await sendTransfer(
      pool,
      {
        jwk: TEST_KEYFILE,
        target: TARGET,
        quantity: QUANTITY,
        maxRewardWinston: BigInt(PRICE),
      },
      { apiFactory: factory },
    );
    expect(result.reward).toBe(BigInt(PRICE));
  });
});

describe("sendTransfer — origin-only pre-flight", () => {
  it("surfaces UnsupportedEndpointError UNWRAPPED with ZERO pool attempts for a pathed endpoint", async () => {
    const { factory, anchorCalls, priceCalls, postedTxs } = makeFakeFactory();
    const pool = createGatewayPool({
      endpoints: ["https://gw.example/api"],
      sleep: instantSleep,
    });

    await expect(
      sendTransfer(
        pool,
        { jwk: TEST_KEYFILE, target: TARGET, quantity: QUANTITY, maxRewardWinston: CAP },
        { apiFactory: factory },
      ),
    ).rejects.toBeInstanceOf(UnsupportedEndpointError);
    expect(anchorCalls).toHaveLength(0);
    expect(priceCalls).toHaveLength(0);
    expect(postedTxs).toHaveLength(0);
  });
});

describe("sendTransfer — offline guarantee", () => {
  it("completes the whole happy path with globalThis.fetch stubbed to throw", async () => {
    const throwingFetch = vi.fn(() => {
      throw new Error("network access is forbidden during transfer");
    });
    vi.stubGlobal("fetch", throwingFetch);

    const { factory, postedTxs } = makeFakeFactory();
    const pool = createGatewayPool({
      endpoints: ["https://a.example"],
      sleep: instantSleep,
    });

    const result = await sendTransfer(
      pool,
      { jwk: TEST_KEYFILE, target: TARGET, quantity: QUANTITY, maxRewardWinston: CAP },
      { apiFactory: factory },
    );

    expect(throwingFetch).not.toHaveBeenCalled();
    expect(result.id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await expect(oracle.transactions.verify(postedTxs[0])).resolves.toBe(true);
  });
});

/**
 * Deep-serialize an entire error to a string, walking `.cause` to arbitrary
 * depth AND `GatewayPoolExhaustedError.attempts[].error` (each attempt preserves
 * an underlying error verbatim). `util.inspect(depth: Infinity)` prints the
 * whole `[cause]:` chain and every enumerable field; we additionally expand the
 * attempts array (whose entries are the un-stringified underlying errors) so the
 * no-leak assertion covers what `console.error`/logging would actually print.
 */
function deepSerializeError(err: unknown): string {
  const parts: string[] = [inspect(err, { depth: Infinity })];
  const seen = new Set<unknown>();
  const walk = (e: unknown): void => {
    if (e === null || typeof e !== "object" || seen.has(e)) return;
    seen.add(e);
    parts.push(inspect(e, { depth: Infinity }));
    const cause = (e as { cause?: unknown }).cause;
    if (cause !== undefined) walk(cause);
    const attempts = (e as { attempts?: unknown }).attempts;
    if (Array.isArray(attempts)) {
      for (const a of attempts) {
        walk((a as { error?: unknown }).error);
      }
    }
  };
  walk(err);
  return parts.join("\n");
}

const PRIVATE_JWK_FIELDS = ["d", "p", "q", "dp", "dq", "qi"] as const;

describe("sendTransfer — no key material leaks across the FULL error chain", () => {
  it("InvalidTransferError leaks no JWK private field across its full serialized form", async () => {
    const { factory } = makeFakeFactory();
    const pool = createGatewayPool({
      endpoints: ["https://a.example"],
      sleep: instantSleep,
    });

    let thrown: unknown;
    try {
      await sendTransfer(
        pool,
        { jwk: TEST_KEYFILE, target: "bad-target", quantity: QUANTITY, maxRewardWinston: CAP },
        { apiFactory: factory },
      );
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(InvalidTransferError);
    const serialized = deepSerializeError(thrown);
    for (const field of PRIVATE_JWK_FIELDS) {
      expect(serialized).not.toContain(TEST_KEYFILE[field]);
    }
  });

  it("GatewayPoolExhaustedError leaks no JWK private field through attempts[].error nor any cause chain", async () => {
    // The pool's terminal error preserves the underlying TransferPostFailedError
    // objects verbatim in attempts[].error — util.inspect/console.error would
    // print them. Walk the WHOLE structure (cause + attempts) against every
    // private field, closing the "top-level-only" gap.
    const { factory } = makeFakeFactory({
      postBehavior: async () => ({ status: 502 }),
    });
    const pool = createGatewayPool({
      endpoints: ["https://a.example", "https://b.example"],
      maxAttemptsPerEndpoint: 1,
      sleep: instantSleep,
    });

    let thrown: unknown;
    try {
      await sendTransfer(
        pool,
        { jwk: TEST_KEYFILE, target: TARGET, quantity: QUANTITY, maxRewardWinston: CAP },
        { apiFactory: factory },
      );
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(GatewayPoolExhaustedError);
    // Sanity: the attempts really do carry the underlying post errors we're scanning.
    expect(
      (thrown as GatewayPoolExhaustedError).attempts[0].error,
    ).toBeInstanceOf(TransferPostFailedError);

    const serialized = deepSerializeError(thrown);
    for (const field of PRIVATE_JWK_FIELDS) {
      expect(serialized).not.toContain(TEST_KEYFILE[field]);
    }
  });
});
