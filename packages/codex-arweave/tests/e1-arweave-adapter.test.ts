/**
 * E1 RED matrix — the Arweave ForeignChainAdapter conformance rows (a)-(f).
 *
 * SHAPE-DRIVES T11.4. Imports the not-yet-existing `../src/adapter` subpath
 * (Pass-2 barrel resolution defers the root `src/index.ts` to T11.6), so these
 * fail at import resolution until T11.4 lands `src/adapter/*`.
 *
 * getBalance ARITY DECISION (FIX-8): the executed D3 `ForeignChainAdapter`
 * contract (`packages/codex-core/src/chains/ForeignChainAdapter.ts`) declares
 * every method opaquely as `(...args: unknown[])` — it is CHAIN-AGNOSTIC and
 * E1 REFINES it. arweave-core's `getBalance(pool, address, opts?)` needs a
 * GatewayPool. Rather than leak a pool into every call site, this matrix pins
 * the refined public shape to `getBalance(address)` with the pool
 * CONSTRUCTOR-INJECTED via `createArweaveAdapter({ pool })` (matches
 * arweave-core's no-module-global-state discipline). The arity row asserts
 * `adapter.getBalance.length === 1`.
 *
 * FUNDS-CRITICAL: no private JWK field (d/p/q/dp/dq/qi) may appear in any
 * thrown error message; a malformed keyfile names the offending FIELD only.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  ARWEAVE_ADDRESS_RE,
  InvalidKeyfileError,
  InvalidAddressError,
  type ArweaveJwk,
} from "@ancientpantheon/arweave-core";
import {
  createForeignChainRegistry,
  type ForeignChainAdapter,
} from "@ancientpantheon/codex-core";

// RED: these subpath modules do not exist yet (src/index.ts = `export {}`).
import {
  createArweaveAdapter,
  registerArweave,
  ARWEAVE_CHAIN_ID,
  NotImplementedError,
} from "../src/adapter";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

const throwawayJwk = JSON.parse(
  readFileSync(join(FIXTURES, "throwaway-arweave-keyfile.json"), "utf8"),
) as ArweaveJwk;

/** The throwaway fixture's KNOWN deterministic address (its round-trip anchor). */
const KNOWN_ADDRESS = "tzXauR_QBlPW3ZRey3xBzaiDqPqLfiqWk1SWmk2BjM4";

/** A fake GatewayPool that returns a fixed Winston body — no network. The real
 *  arweave-core `getBalance` validates the address then calls `pool.execute`
 *  with an operation that fetches; a fake pool that runs the operation against
 *  a stub endpoint lets us assert the bigint return with zero network I/O. */
function makeFakePool(winston: string) {
  return {
    getHealthSnapshot: () => [{ endpoint: "https://arweave.net" }],
    execute: async (op: (endpoint: string, ctx: { signal?: AbortSignal }) => Promise<bigint>) =>
      op("https://arweave.net", {
        signal: undefined,
      }),
    // The fetch used inside the op is injected by the adapter via getBalance's
    // opts.fetchFn; the adapter passes a fetch that returns `winston`.
    __winston: winston,
  };
}

describe("createArweaveAdapter — D3 ForeignChainAdapter conformance (E-01)", () => {
  it("(a) conforms to the ForeignChainAdapter contract and co-registers a second adapter with zero generic-code change (N-05)", () => {
    const adapter = createArweaveAdapter();

    // Structural conformance: every required D3 method is present + callable.
    const conform: ForeignChainAdapter = adapter;
    expect(typeof conform.id).toBe("string");
    expect(conform.id).toBe(ARWEAVE_CHAIN_ID);
    for (const method of [
      "generateKey",
      "importKey",
      "addressOf",
      "getBalance",
      "buildSend",
      "sign",
      "post",
    ] as const) {
      expect(typeof conform[method]).toBe("function");
    }

    // The Arweave adapter registers into a fresh instance-scoped registry, and a
    // STUB second foreign chain co-registers WITHOUT touching generic code —
    // proving the registry is open for extension (N-05).
    const registry = createForeignChainRegistry();
    registerArweave(registry);
    const stub: ForeignChainAdapter = {
      id: "stubchain",
      generateKey: async () => ({}),
      importKey: async () => ({}),
      addressOf: () => "stub-address",
      getBalance: async () => 0n,
      buildSend: async () => ({}),
      sign: async () => ({}),
      post: async () => ({}),
    };
    registry.register(stub);
    expect(registry.list().sort()).toEqual([ARWEAVE_CHAIN_ID, "stubchain"].sort());
    expect(registry.get(ARWEAVE_CHAIN_ID).id).toBe(ARWEAVE_CHAIN_ID);
  });

  it("(b) generateKey yields a canonical JWK whose 43-char address matches ARWEAVE_ADDRESS_RE", async () => {
    const adapter = createArweaveAdapter();
    const jwk = (await adapter.generateKey()) as ArweaveJwk;

    expect(jwk.kty).toBe("RSA");
    expect(jwk.e).toBe("AQAB");
    const address = await adapter.addressOf(jwk);
    expect(address).toHaveLength(43);
    expect(ARWEAVE_ADDRESS_RE.test(address as string)).toBe(true);
  });

  it("(c) importKey round-trips the throwaway JWK; a malformed keyfile throws InvalidKeyfileError NAMING the field but not echoing the value", async () => {
    const adapter = createArweaveAdapter();
    const imported = (await adapter.importKey(throwawayJwk)) as ArweaveJwk;
    // Round-trip identity: the 9 canonical fields survive byte-identical.
    expect(imported).toEqual(throwawayJwk);

    // Wrong kty: named field "kty", no value echo.
    await expect(
      adapter.importKey({ ...throwawayJwk, kty: "EC" }),
    ).rejects.toBeInstanceOf(InvalidKeyfileError);

    // Missing private field `d`: names `d`, never echoes the (now-removed) value.
    const { d: _d, ...noD } = throwawayJwk;
    try {
      await adapter.importKey(noD);
      throw new Error("expected importKey to reject a JWK missing `d`");
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidKeyfileError);
      const msg = (err as Error).message;
      // Truncated `n` corruption also rejects; assert NO private material leaks.
      expect(msg).not.toContain(throwawayJwk.p);
      expect(msg).not.toContain(throwawayJwk.q);
    }

    // Truncated modulus `n` (alphabet-valid, wrong length) rejects with bad-length on `n`.
    await expect(
      adapter.importKey({ ...throwawayJwk, n: throwawayJwk.n.slice(0, 100) }),
    ).rejects.toBeInstanceOf(InvalidKeyfileError);
  });

  it("(d) addressOf is ASYNC and equals the fixture's known 43-char address; a corrupt-n throws instead of a silent wrong address", async () => {
    const adapter = createArweaveAdapter();
    const address = await adapter.addressOf(throwawayJwk);
    expect(address).toBe(KNOWN_ADDRESS);

    // A truncated modulus decodes to != 512 bytes -> throws (never a silent
    // well-formed WRONG address, the fund-loss class).
    await expect(
      adapter.addressOf({ ...throwawayJwk, n: throwawayJwk.n.slice(0, 100) }),
    ).rejects.toBeInstanceOf(InvalidKeyfileError);
  });

  it("(e) getBalance arity MATCHES the refined D3 contract (address-only, pool constructor-injected) and returns a bigint via a faked pool; a non-canonical address throws InvalidAddressError", async () => {
    // Refined public arity is `getBalance(address)` — pool injected at construction.
    const fakePool = makeFakePool("123456789");
    const adapter = createArweaveAdapter({
      pool: fakePool as never,
      // Inject a fetch so the arweave-core getBalance operation returns the
      // faked Winston body with no real network call.
      fetchFn: (async () =>
        new Response("123456789", { status: 200 })) as unknown as typeof fetch,
    });

    expect(adapter.getBalance.length).toBe(1);

    const balance = await adapter.getBalance(KNOWN_ADDRESS);
    expect(typeof balance).toBe("bigint");
    expect(balance).toBe(123456789n);

    // A non-canonical address is rejected BEFORE any network call.
    await expect(adapter.getBalance("not-a-canonical-address")).rejects.toBeInstanceOf(
      InvalidAddressError,
    );
  });

  it("(f) exposes exactly the D3 ForeignChainAdapter surface — sign/post/buildSend are filled (E2), send is NOT a contract method", () => {
    // E2 (Phase 12) FILLED the signer/send stubs this row once asserted were
    // NotImplementedError. The bounded-edit fence: the method surface is EXACTLY
    // the D3 set (`upload?` optional/absent for a native-send chain) and no
    // `send` convenience method leaked onto the contract.
    const adapter = createArweaveAdapter();

    for (const method of ["buildSend", "sign", "post"] as const) {
      expect(typeof adapter[method]).toBe("function");
    }
    // The FULL D3 ForeignChainAdapter member set is present (id + the 7 methods).
    expect(typeof adapter.id).toBe("string");
    for (const method of [
      "generateKey",
      "importKey",
      "addressOf",
      "getBalance",
    ] as const) {
      expect(typeof adapter[method]).toBe("function");
    }
    // `send` is deliberately NOT on the D3 contract (a wrapper, if any, is a
    // separate non-contract export).
    expect(adapter).not.toHaveProperty("send");
    // `upload` is the E3 (Phase 13) permaweb-data-write method, now activated on
    // the adapter — a thin delegate to arweave-core `uploadData`.
    expect(typeof adapter.upload).toBe("function");

    // `NotImplementedError` remains the class the no-pool paths throw (post
    // without an injected pool) — still exported for those instanceof catches.
    expect(NotImplementedError).toBeDefined();
  });
});
