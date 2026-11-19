/**
 * mockup-local-dry-run-failover-client.test.ts — `createLocalDryRunFailoverClient`,
 * the shippable (production, not test-only) local/no-op StoaChain/Kadena
 * transaction client `legacy-prime-migration-mockup` T2 builds for the
 * mockup wizard run.
 *
 * Mirrors `packages/arweave-core/tests/local-dry-run-gateway.test.ts`'s own
 * proof convention for "no real network": stub `globalThis.fetch` to THROW,
 * and — the chain-specific half of that same convention, matching this
 * package's own `tests/kadena-reads.test.ts` — mock
 * `@stoachain/kadena-stoic-legacy/client`'s `createClient` export with a
 * `vi.fn` that throws if ever invoked, then assert zero calls across a full
 * `dirtyRead` + `submit` sequence. A passing "stub throws on call, zero
 * calls recorded" assertion means nothing in the exercised code path ever
 * reached the network.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { createClient } = vi.hoisted(() => {
  const createClient = vi.fn(() => {
    throw new Error("network access is forbidden in local-dry-run-failover-client tests");
  });
  return { createClient };
});

vi.mock("@stoachain/kadena-stoic-legacy/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@stoachain/kadena-stoic-legacy/client")>();
  return { ...actual, createClient };
});

import { createLocalDryRunFailoverClient } from "../src/mockup/localDryRunFailoverClient.js";
import type { IUnsignedCommand, ICommand } from "@stoachain/kadena-stoic-legacy/client";

/**
 * A plain object shaped like the slice of a real `IUnsignedCommand`/
 * `ICommand` this module actually reads (`cmd`/`hash`/`sigs`) — deliberately
 * NOT a real signed Pact transaction (no real signing needed; this client
 * never verifies a signature), cast through the same real
 * `IUnsignedCommand`/`ICommand` types every production caller passes.
 */
function makeUnsignedTx(hash: string): IUnsignedCommand {
  return {
    cmd: `(coin.transfer "alice" "bob" 1.0) /* ${hash} */`,
    hash,
    sigs: [{ pubKey: "alice-pubkey" }],
  };
}

function makeSignedTx(hash: string): ICommand {
  return {
    cmd: `(coin.transfer "alice" "bob" 1.0) /* ${hash} */`,
    hash,
    sigs: [{ pubKey: "alice-pubkey", sig: "fake-sig-for-mockup-only" }],
  };
}

describe("createLocalDryRunFailoverClient — dirtyRead realism", () => {
  it("resolves without throwing for a well-formed transaction, with result.status === 'success'", async () => {
    const { dirtyRead } = createLocalDryRunFailoverClient();

    const outcome = await dirtyRead(makeUnsignedTx("dirty-read-hash-A"));

    expect(outcome.result.status).toBe("success");
    expect(typeof outcome.gas).toBe("number");
  });
});

describe("createLocalDryRunFailoverClient — submit capture + round-trip", () => {
  it("records the exact transaction object passed to submit, retrievable via getSubmittedTransactions", async () => {
    const { submit, getSubmittedTransactions } = createLocalDryRunFailoverClient();

    const tx = makeSignedTx("submit-hash-A");
    const { requestKey } = await submit(tx);

    const log = getSubmittedTransactions();
    expect(log).toHaveLength(1);
    expect(log[0].requestKey).toBe(requestKey);
    // Verbatim — the SAME object reference, not a clone/rebuild.
    expect(log[0].transaction).toBe(tx);
  });

  it("gives each of several submit calls its own distinct synthetic requestKey", async () => {
    const { submit } = createLocalDryRunFailoverClient();

    const first = await submit(makeSignedTx("submit-hash-B"));
    const second = await submit(makeSignedTx("submit-hash-C"));
    const third = await submit(makeSignedTx("submit-hash-D"));

    const keys = [first.requestKey, second.requestKey, third.requestKey];
    expect(new Set(keys).size).toBe(3);
  });
});

describe("createLocalDryRunFailoverClient — zero network reachability", () => {
  let realFetch: typeof globalThis.fetch;

  beforeEach(() => {
    // Mirrors `packages/arweave-core/tests/local-dry-run-gateway.test.ts`'s
    // own convention: stub `fetch` to THROW so any accidental network touch
    // fails loudly rather than silently succeeding against a real endpoint.
    realFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(() => {
      throw new Error("network access is forbidden in local-dry-run-failover-client tests");
    }) as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    createClient.mockClear();
  });

  it("never calls fetch or createClient across a dirtyRead + submit call", async () => {
    const { dirtyRead, submit } = createLocalDryRunFailoverClient();

    await dirtyRead(makeUnsignedTx("reachability-hash-A"));
    await submit(makeSignedTx("reachability-hash-B"));

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
  });
});
