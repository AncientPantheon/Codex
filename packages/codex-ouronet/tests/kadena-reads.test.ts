/**
 * kadena-reads.test.ts — regression lock for `src/kadena/kadenaReads.ts`,
 * the raw Pact-constructor read path against REAL Kadena mainnet.
 *
 * Owner directive, 2026-09-26: "how do i switch to kadena when i have
 * chainweb as selected blockchain... for this we need directly pact
 * constructors, there arent any modules we can call the reading functions
 * from." These tests assert the EXACT Pact-code string and transaction
 * shape every function here builds — in particular that the `networkId` is
 * genuinely `"mainnet01"`, never `"stoa"` (the whole reason this module
 * exists instead of reusing `@stoachain/stoa-core`'s `pactRead`, which
 * hardcodes `networkId: "stoa"` with no override seam — confirmed by
 * reading that package's own source this same round).
 *
 * `createClient` (from `@stoachain/kadena-stoic-legacy/client`) has no
 * injectable test seam the way `pactRead` does (`setPactReader`) — it is
 * mocked here directly, keeping the REAL `Pact` builder so the actual
 * transaction-construction logic (`.setNetworkId`, `.setMeta`, `.createTransaction()`)
 * runs unmocked; only the network call (`dirtyRead`) is intercepted.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

const { dirtyRead, createClient } = vi.hoisted(() => {
  const dirtyRead = vi.fn();
  const createClient = vi.fn(() => ({ dirtyRead }));
  return { dirtyRead, createClient };
});

vi.mock("@stoachain/kadena-stoic-legacy/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@stoachain/kadena-stoic-legacy/client")>();
  return { ...actual, createClient };
});

import {
  getKadenaBalance,
  getKadenaAccountDetails,
  checkKadenaAccountExists,
  getKadenaBalancesBatch,
  getActiveKadenaNodeUrl,
  setActiveKadenaNodeUrl,
  KADENA_MAINNET_NETWORK_ID,
  KADENA_MAINNET_DEFAULT_NODE_URL,
  KADENA_MAINNET_DEFAULT_CHAIN_ID,
  KADENA_CHAINS,
  KADENA_CHAIN_COUNT,
  kadenaPactUrl,
} from "../src/kadena/kadenaReads.js";

afterEach(() => {
  vi.clearAllMocks();
  setActiveKadenaNodeUrl(KADENA_MAINNET_DEFAULT_NODE_URL);
});

function mockSuccess(data: unknown) {
  dirtyRead.mockResolvedValue({ result: { status: "success", data } });
}
function mockFailure(message = "refused") {
  dirtyRead.mockResolvedValue({ result: { status: "failure", error: { message } } });
}

describe("kadenaReads — the mechanism (networkId + host, not stoa-core's pactRead)", () => {
  it("KADENA_MAINNET_NETWORK_ID is 'mainnet01', never 'stoa'", () => {
    expect(KADENA_MAINNET_NETWORK_ID).toBe("mainnet01");
    expect(KADENA_MAINNET_NETWORK_ID).not.toBe("stoa");
  });

  it("kadenaPactUrl builds the exact chainweb Pact base path for a node origin + chain (exported for SendKadenaModal.tsx to reuse)", () => {
    expect(kadenaPactUrl("http://example.com", "7")).toBe(
      "http://example.com/chainweb/0.0/mainnet01/chain/7/pact",
    );
  });

  it("kadenaPactUrl strips a trailing slash from the node URL — no double slash before /chainweb", () => {
    expect(kadenaPactUrl("http://example.com/", "0")).toBe(
      "http://example.com/chainweb/0.0/mainnet01/chain/0/pact",
    );
  });

  it("getKadenaBalance builds a transaction with networkId mainnet01 and posts it to the correct chainweb URL", async () => {
    mockSuccess(0);
    await getKadenaBalance("k:abc");

    expect(createClient).toHaveBeenCalledWith(
      `${KADENA_MAINNET_DEFAULT_NODE_URL}/chainweb/0.0/mainnet01/chain/${KADENA_MAINNET_DEFAULT_CHAIN_ID}/pact`,
    );
    expect(dirtyRead).toHaveBeenCalledTimes(1);
    const [tx] = dirtyRead.mock.calls[0];
    // `Pact.builder...createTransaction()` yields a plain {cmd, hash, sigs}
    // object — `cmd` is the STRINGIFIED command payload, which embeds the
    // real networkId. Parse it back out rather than trusting a mock.
    const cmd = JSON.parse(tx.cmd);
    expect(cmd.networkId).toBe("mainnet01");
    expect(cmd.payload.exec.code).toBe(`(try 0.0 (coin.get-balance "k:abc"))`);
  });

  it("getActiveKadenaNodeUrl/setActiveKadenaNodeUrl: the module-level global every read defaults to", async () => {
    expect(getActiveKadenaNodeUrl()).toBe(KADENA_MAINNET_DEFAULT_NODE_URL);

    setActiveKadenaNodeUrl("https://my-own-kadena-node.example");
    expect(getActiveKadenaNodeUrl()).toBe("https://my-own-kadena-node.example");

    mockSuccess(0);
    await getKadenaBalance("k:abc");
    expect(createClient).toHaveBeenCalledWith(
      expect.stringContaining("https://my-own-kadena-node.example/chainweb/0.0/mainnet01/chain/"),
    );
  });

  it("setActiveKadenaNodeUrl ignores a blank value — falls back to the last good URL, never goes dead", () => {
    setActiveKadenaNodeUrl("https://a-real-node.example");
    setActiveKadenaNodeUrl("   ");
    expect(getActiveKadenaNodeUrl()).toBe("https://a-real-node.example");
  });

  it("an explicit per-call nodeUrl/chainId option overrides the active global", async () => {
    mockSuccess(0);
    await getKadenaBalance("k:abc", { nodeUrl: "https://override.example", chainId: "5" });
    expect(createClient).toHaveBeenCalledWith("https://override.example/chainweb/0.0/mainnet01/chain/5/pact");
  });
});

describe("kadenaReads — raw Pact constructors (owner: 'there arent any modules we can call the reading functions from')", () => {
  it("getKadenaBalance: (try 0.0 (coin.get-balance ...)) — standard coin module only", async () => {
    mockSuccess({ decimal: "12.5" });
    const bal = await getKadenaBalance("k:abc");
    expect(bal).toBe(12.5);
    const cmd = JSON.parse(dirtyRead.mock.calls[0][0].cmd);
    expect(cmd.payload.exec.code).toBe(`(try 0.0 (coin.get-balance "k:abc"))`);
  });

  it("getKadenaAccountDetails: bare (coin.details ...)", async () => {
    mockSuccess({ account: "k:abc", balance: 3, guard: { pred: "keys-all", keys: ["pub"] } });
    const details = await getKadenaAccountDetails("k:abc");
    expect(details).toEqual({ account: "k:abc", balance: 3, guard: { pred: "keys-all", keys: ["pub"] } });
    const cmd = JSON.parse(dirtyRead.mock.calls[0][0].cmd);
    expect(cmd.payload.exec.code).toBe(`(coin.details "k:abc")`);
  });

  it("getKadenaAccountDetails returns null when the account row doesn't exist", async () => {
    mockFailure();
    expect(await getKadenaAccountDetails("k:nope")).toBeNull();
  });

  it("checkKadenaAccountExists: (try false (coin.get-balance ...)) — mirrors ouronet-core's checkCoinAccountExists shape", async () => {
    mockSuccess(false);
    expect(await checkKadenaAccountExists("k:nope")).toBe(false);
    const cmd = JSON.parse(dirtyRead.mock.calls[0][0].cmd);
    expect(cmd.payload.exec.code).toBe(`(try false (coin.get-balance "k:nope"))`);

    dirtyRead.mockClear();
    mockSuccess(1.5);
    expect(await checkKadenaAccountExists("k:real")).toBe(true);
  });

  it("getKadenaBalancesBatch: one map/try batch call over every address, mirrors useStoaChainBalances's own shape", async () => {
    mockSuccess([
      { account: "k:a", balance: 1.5, exists: true },
      { account: "k:b", balance: 0, exists: false },
    ]);
    const rows = await getKadenaBalancesBatch(["k:a", "k:b"]);
    expect(rows).toEqual([
      { account: "k:a", balance: 1.5, exists: true },
      { account: "k:b", balance: 0, exists: false },
    ]);
    const cmd = JSON.parse(dirtyRead.mock.calls[0][0].cmd);
    expect(cmd.payload.exec.code).toBe(
      `(map (lambda (a) (try { "account": a, "balance": 0.0, "exists": false } ` +
        `{ "account": a, "balance": (coin.get-balance a), "exists": true })) ["k:a" "k:b"])`,
    );
  });

  it("getKadenaBalancesBatch short-circuits to [] for an empty address list — no network call at all", async () => {
    const rows = await getKadenaBalancesBatch([]);
    expect(rows).toEqual([]);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("every read returns null (not throws) on a chain-side failure", async () => {
    mockFailure();
    expect(await getKadenaBalance("k:x")).toBeNull();
    expect(await checkKadenaAccountExists("k:x")).toBeNull();
  });

  it("every read returns null (not throws) when dirtyRead itself rejects (network error)", async () => {
    dirtyRead.mockRejectedValue(new Error("network down"));
    expect(await getKadenaBalance("k:x")).toBeNull();
    expect(await getKadenaAccountDetails("k:x")).toBeNull();
    expect(await checkKadenaAccountExists("k:x")).toBeNull();
  });
});

describe("kadenaReads — a swallowed exception is LOGGED, not discarded (2026-09-27 diagnosis)", () => {
  // A DNS failure, a connection timeout, and a genuinely-absent account all used to return
  // the identical `null` -- which is exactly why an unreachable node presented as "can't
  // talk to the node" instead of "can't resolve that host" (the hairpin-NAT bug this
  // session traced). The null/[] CONTRACT for callers stays the same; the reason now
  // reaches the console instead of being discarded.
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  afterEach(() => warnSpy.mockClear());

  it("getKadenaBalance logs the underlying error message on a rejection, still returns null", async () => {
    dirtyRead.mockRejectedValue(new Error("getaddrinfo ENOTFOUND bytales.duckdns.org"));
    expect(await getKadenaBalance("k:x")).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("getaddrinfo ENOTFOUND bytales.duckdns.org"),
    );
  });

  it("getKadenaAccountDetails, getKadenaBalancesBatch, checkKadenaAccountExists each log their own distinct rejection too", async () => {
    dirtyRead.mockRejectedValue(new Error("connect ETIMEDOUT"));
    await getKadenaAccountDetails("k:x");
    await getKadenaBalancesBatch(["k:x"]);
    await checkKadenaAccountExists("k:x");
    const messages = warnSpy.mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes("getKadenaAccountDetails") && m.includes("connect ETIMEDOUT"))).toBe(true);
    expect(messages.some((m) => m.includes("getKadenaBalancesBatch") && m.includes("connect ETIMEDOUT"))).toBe(true);
    expect(messages.some((m) => m.includes("checkKadenaAccountExists") && m.includes("connect ETIMEDOUT"))).toBe(true);
  });

  it("the SAME error message from the SAME function logs only once, not once per call — a 20-chain batch against one dead host does not spam 20 identical lines", async () => {
    dirtyRead.mockRejectedValue(new Error("connect ECONNREFUSED"));
    await getKadenaBalance("k:a");
    await getKadenaBalance("k:b");
    await getKadenaBalance("k:c");
    const matching = warnSpy.mock.calls.filter((c) => String(c[0]).includes("connect ECONNREFUSED"));
    expect(matching.length).toBe(1);
  });

  // CORRECTED (2026-09-28 handoff, bug #2): this test used to assert the
  // OPPOSITE — that a "status: failure" envelope response was NOT logged,
  // reasoning it represented "a genuinely-absent account" and therefore
  // wasn't a real error. That premise was wrong: `getKadenaBalance`'s own
  // Pact code already wraps the read in `(try 0.0 ...)`, so a genuinely
  // absent account resolves via the try's fallback as a SUCCESSFUL envelope
  // (`status: "success", data: 0.0`) — it never reaches this branch at all.
  // A "status: failure" ENVELOPE (as opposed to the inner try-caught
  // failure) is therefore a genuine problem (a malformed request, a node
  // that rejected the call outright, ...) — exactly the class of failure
  // the 2026-09-28 handoff identified as "the single reason this presented
  // as 'can't talk to the node' for so long": it silently returned the SAME
  // null a dead host or a timeout would, discarding the one piece of
  // information (the actual refusal reason) that would have told a caller
  // this was a real chain-side rejection, not a genuine absence.
  it("a 'status: failure' envelope IS now logged (not silently discarded) — it means a real node-side rejection, since a genuinely-absent account already resolves successfully via getKadenaBalance's own (try 0.0 ...) fallback", async () => {
    // A distinct message per test — `logKadenaReadError`'s own dedup is
    // keyed by `${fn}:${message}` and persists at MODULE scope across every
    // test in this file, not just within a describe block (confirmed: an
    // earlier version of this test reused the shared "refused" default and
    // got silently swallowed by an EARLIER, unrelated test's own
    // `mockFailure()` call already having logged that exact key).
    mockFailure("envelope-rejected-balance");
    expect(await getKadenaBalance("k:x")).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("envelope-rejected-balance"));
  });

  it("every OTHER read function ALSO logs its own 'status: failure' envelope, not just getKadenaBalance", async () => {
    mockFailure("envelope-rejected-others");
    await getKadenaAccountDetails("k:x");
    await getKadenaBalancesBatch(["k:x"]);
    await checkKadenaAccountExists("k:x");
    const messages = warnSpy.mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes("getKadenaAccountDetails") && m.includes("envelope-rejected-others"))).toBe(true);
    expect(messages.some((m) => m.includes("getKadenaBalancesBatch") && m.includes("envelope-rejected-others"))).toBe(true);
    expect(messages.some((m) => m.includes("checkKadenaAccountExists") && m.includes("envelope-rejected-others"))).toBe(true);
  });

  it("a 'status: failure' envelope with no error.message falls back to a generic, still-logged message rather than silently swallowing it", async () => {
    dirtyRead.mockResolvedValue({ result: { status: "failure" } }); // no `error` field at all
    expect(await getKadenaBalance("k:x")).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("non-success response envelope"));
  });
});

describe("kadenaReads — bounded by a timeout, never hangs forever", () => {
  // A real, observed failure mode: a connection to a firewalled/dropped host:port can hang
  // with NO rejection and no resolution at all -- `createClient(...).dirtyRead()` has no
  // built-in timeout (confirmed by reading `@stoachain/kadena-stoic-legacy`'s own source: no
  // `timeout`/`AbortController`/`signal` anywhere in its client). Without a bound of our own,
  // a single stuck chain read spins its caller's loading state forever, which is exactly the
  // "spins and spins and nothing is shown" symptom this test exists to prevent.
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("getKadenaBalance resolves to null (not hangs) when dirtyRead never settles", async () => {
    dirtyRead.mockReturnValue(new Promise(() => {})); // never resolves, never rejects
    const promise = getKadenaBalance("k:x");
    await vi.advanceTimersByTimeAsync(15000);
    await expect(promise).resolves.toBeNull();
  });

  it("getKadenaAccountDetails resolves to null (not hangs) when dirtyRead never settles", async () => {
    dirtyRead.mockReturnValue(new Promise(() => {}));
    const promise = getKadenaAccountDetails("k:x");
    await vi.advanceTimersByTimeAsync(15000);
    await expect(promise).resolves.toBeNull();
  });

  it("checkKadenaAccountExists resolves to null (not hangs) when dirtyRead never settles", async () => {
    dirtyRead.mockReturnValue(new Promise(() => {}));
    const promise = checkKadenaAccountExists("k:x");
    await vi.advanceTimersByTimeAsync(15000);
    await expect(promise).resolves.toBeNull();
  });

  it("getKadenaBalancesBatch resolves to [] (not hangs) when dirtyRead never settles", async () => {
    dirtyRead.mockReturnValue(new Promise(() => {}));
    const promise = getKadenaBalancesBatch(["k:a", "k:b"]);
    await vi.advanceTimersByTimeAsync(15000);
    await expect(promise).resolves.toEqual([]);
  });

  it("a read that settles well within the timeout is unaffected — no false-positive timeout", async () => {
    mockSuccess({ decimal: "3.5" });
    const promise = getKadenaBalance("k:fast");
    await vi.advanceTimersByTimeAsync(0);
    await expect(promise).resolves.toBe(3.5);
  });
});

describe("kadenaReads — real Kadena mainnet chain topology (20 chains, not Stoa's 10)", () => {
  it("KADENA_CHAINS is ['0'..'19'], KADENA_CHAIN_COUNT is 20", () => {
    expect(KADENA_CHAIN_COUNT).toBe(20);
    expect(KADENA_CHAINS).toEqual(Array.from({ length: 20 }, (_, i) => String(i)));
  });
});
