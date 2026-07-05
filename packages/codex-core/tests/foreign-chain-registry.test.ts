/**
 * RED contract tests for the ForeignChainAdapter registry seam.
 *
 * The ForeignChainAdapter is a GREENFIELD injection seam (it has no ancestor in
 * the ouronet-codex source): a per-chain driver exposing the operations a
 * foreign (non-Kadena) chain needs — key lifecycle (`generateKey`/`importKey`/
 * `addressOf`), balance/send (`getBalance`/`buildSend`), signing/broadcast
 * (`sign`/`post`), and an OPTIONAL `upload?`. `upload?` is optional because it
 * is the Arweave-specific data-write operation (E12/E13); a native-send-only
 * chain conforms WITHOUT it.
 *
 * The registry (`createForeignChainRegistry()`) is the dispatch surface that
 * lets a SECOND chain register with zero change to generic code (N-05): it maps
 * `adapter.id` → adapter behind `register`/`get`/`list`.
 *
 * PINNED behaviours this file drives T7.6's GREEN to satisfy (E1/E4/E5 depend
 * on these):
 *   - The registry is INSTANCE-SCOPED — `createForeignChainRegistry()` is a
 *     factory returning a fresh, empty registry. There is NO global mutable
 *     singleton, so two `it` blocks cannot leak state into each other.
 *   - `get(unknownId)` THROWS a typed `ForeignChainError` that NAMES the missing
 *     id (chosen over returning `undefined`: a lookup miss is a programmer error
 *     — a caller dispatching on an unregistered chain must fail loudly, and the
 *     named id makes the failure diagnosable). It never echoes key material.
 *   - A DUPLICATE-id `register` THROWS a typed `ForeignChainError` naming the id
 *     (chosen over last-wins: silently replacing a live chain adapter would let
 *     one chain hijack another's dispatch; failing closed forces an explicit
 *     re-registration decision).
 *
 * RED: this file imports from the `../src/chains` SUBPATH barrel, which does not
 * exist yet — the whole suite fails at import resolution until T7.6 lands the
 * seam. This is the intended RED signal.
 */

import { describe, it, expect } from "vitest";
import {
  createForeignChainRegistry,
  ForeignChainError,
  type ForeignChainAdapter,
} from "../src/chains/index.js";

/**
 * A conforming stub adapter WITHOUT `upload` — proves `upload?` is optional
 * (the "upload is Arweave-optional" seam). Because it is typed as
 * `ForeignChainAdapter`, this assignment only compiles if a no-upload adapter
 * still satisfies the contract.
 */
const stubWithoutUpload: ForeignChainAdapter = {
  id: "stub",
  generateKey: async () => ({ address: "stub-addr", secret: "REDACTED-KEY" }),
  importKey: async (material: string) => ({ address: `imported:${material.length}` }),
  addressOf: (key: unknown) => `addr-of:${String((key as { address?: string })?.address)}`,
  getBalance: async (address: string) => `bal:${address}`,
  buildSend: async (to: string, amount: string) => ({ to, amount, raw: "unsigned-tx" }),
  sign: async (tx: unknown) => ({ signed: tx }),
  post: async (signedTx: unknown) => ({ txId: "posted", signedTx }),
};

/**
 * A second conforming stub that DOES supply `upload?` — proves the optional
 * method is part of the contract when a chain (e.g. Arweave) provides it, and
 * gives the "second adapter registers without touching generic code" test a
 * distinct id.
 */
const stubWithUpload: ForeignChainAdapter = {
  id: "stub2",
  generateKey: async () => ({ address: "stub2-addr", secret: "REDACTED-KEY-2" }),
  importKey: async () => ({ address: "stub2-imported" }),
  addressOf: () => "stub2-addr",
  getBalance: async () => "0",
  buildSend: async (to: string, amount: string) => ({ to, amount, raw: "unsigned-tx-2" }),
  sign: async (tx: unknown) => ({ signed: tx }),
  post: async () => ({ txId: "posted-2" }),
  upload: async (data: Uint8Array) => ({ dataTxId: `uploaded:${data.length}` }),
};

describe("ForeignChainAdapter contract", () => {
  it("accepts a stub adapter that omits upload? — upload is the Arweave-optional seam, so a native-send-only chain still conforms", () => {
    // Compiles (typechecks) only because `upload?` is optional; assert the
    // required surface is all present and callable at the value level.
    expect(stubWithoutUpload.id).toBe("stub");
    expect(typeof stubWithoutUpload.generateKey).toBe("function");
    expect(typeof stubWithoutUpload.importKey).toBe("function");
    expect(typeof stubWithoutUpload.addressOf).toBe("function");
    expect(typeof stubWithoutUpload.getBalance).toBe("function");
    expect(typeof stubWithoutUpload.buildSend).toBe("function");
    expect(typeof stubWithoutUpload.sign).toBe("function");
    expect(typeof stubWithoutUpload.post).toBe("function");
    expect("upload" in stubWithoutUpload).toBe(false);
  });

  it("accepts a stub adapter that supplies upload? — the optional method is part of the contract when a chain provides it", () => {
    expect(typeof stubWithUpload.upload).toBe("function");
  });
});

describe("createForeignChainRegistry", () => {
  it("returns a fresh empty registry — instance-scoped with no global singleton, so list() starts empty", () => {
    const registry = createForeignChainRegistry();
    expect(registry.list()).toEqual([]);
  });

  it("register then get returns the SAME adapter instance keyed by its id", () => {
    const registry = createForeignChainRegistry();
    registry.register(stubWithoutUpload);
    expect(registry.get("stub")).toBe(stubWithoutUpload);
  });

  it("get(unknownId) throws a typed ForeignChainError that NAMES the missing id and never echoes key material", () => {
    const registry = createForeignChainRegistry();
    registry.register(stubWithoutUpload);

    let caught: unknown;
    try {
      registry.get("does-not-exist");
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ForeignChainError);
    expect((caught as Error).message).toContain("does-not-exist");
    // Secret hygiene: the error must not leak any adapter's key material.
    expect((caught as Error).message).not.toContain("REDACTED-KEY");
  });

  it("registering a SECOND adapter does not disturb the first, and list() returns both ids (N-05: a second chain registers without touching generic code)", () => {
    const registry = createForeignChainRegistry();
    registry.register(stubWithoutUpload);
    registry.register(stubWithUpload);

    // First registration is untouched by the second.
    expect(registry.get("stub")).toBe(stubWithoutUpload);
    expect(registry.get("stub2")).toBe(stubWithUpload);
    expect(registry.list().sort()).toEqual(["stub", "stub2"]);
  });

  it("registering a DUPLICATE id throws a typed ForeignChainError naming the id (fail-closed, not last-wins) and leaves the original registered", () => {
    const registry = createForeignChainRegistry();
    registry.register(stubWithoutUpload);

    const collidingId: ForeignChainAdapter = { ...stubWithUpload, id: "stub" };

    let caught: unknown;
    try {
      registry.register(collidingId);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ForeignChainError);
    expect((caught as Error).message).toContain("stub");
    // The original adapter is still the one registered under the id.
    expect(registry.get("stub")).toBe(stubWithoutUpload);
  });

  it("two registries are isolated — registering in one does not leak into another fresh registry (no global mutable state)", () => {
    const first = createForeignChainRegistry();
    first.register(stubWithoutUpload);

    const second = createForeignChainRegistry();
    expect(second.list()).toEqual([]);
    expect(() => second.get("stub")).toThrow(ForeignChainError);
  });
});
