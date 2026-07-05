/**
 * E2 RED matrix — the sibling RSA signer (E-04).
 *
 * SHAPE-DRIVES T12.3. The adapter's `sign(tx, jwk)` is a THIN DELEGATE to
 * arweave-core `signTransaction` (RSA-PSS + deep-hash, in-place, LOCAL). E1
 * stubbed `sign` to throw `NotImplementedError`, so every FILLED-behavior
 * assertion below FAILS until T12.3 fills the stub — that is the RED.
 *
 * The rows prove: (a) delegation to arweave-core's `signTransaction` is the SOLE
 * sign call and the tx is signed IN PLACE; (b) a malformed JWK surfaces
 * `InvalidKeyfileError` naming the field, not echoing the value; (c) a
 * corrupt-but-valid-length modulus surfaces `SigningError` (operation/cause, no
 * key value); (d) NO private JWK field VALUE appears anywhere across the sign
 * path.
 *
 * FUNDS-CRITICAL: the JWK IS the private key. No `d`/`p`/`q`/`dp`/`dq`/`qi` value
 * may leak into any thrown error, log, or serialized output.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import Arweave from "arweave";

import * as arweaveCore from "@ancientpantheon/arweave-core";
import {
  InvalidKeyfileError,
  SigningError,
  type ArweaveJwk,
} from "@ancientpantheon/arweave-core";

import { createArweaveAdapter } from "../src/adapter";
import { throwawayJwk, KNOWN_ADDRESS } from "./e2-helpers";

/** An arweave-js instance used ONLY to build an unsigned tx for the sign rows.
 *  `createTransaction` with a supplied `reward`/`last_tx` issues no network. */
const builder = Arweave.init({ host: "arweave.net", protocol: "https", port: 443 });

/** Build an unsigned transfer tx (offline — reward + last_tx supplied). */
async function buildUnsignedTx() {
  return builder.createTransaction(
    {
      target: KNOWN_ADDRESS,
      quantity: "1000",
      last_tx: "anchor",
      reward: "1000",
    },
    throwawayJwk,
  );
}

/** Every private JWK field whose VALUE must never leak. */
const PRIVATE_FIELDS = ["d", "p", "q", "dp", "dq", "qi"] as const;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("adapter.sign — the sibling RSA signer delegates to arweave-core (E-04)", () => {
  it("delegates to arweave-core signTransaction as the SOLE sign call and signs the SAME tx in place", async () => {
    const spy = vi.spyOn(arweaveCore, "signTransaction");
    const adapter = createArweaveAdapter();
    const tx = await buildUnsignedTx();

    const signed = await adapter.sign(tx, throwawayJwk);

    // Delegation: arweave-core's signTransaction is the one and only sign call.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(tx, throwawayJwk);

    // In-place: the returned tx IS the same instance, now carrying a signature.
    expect(signed).toBe(tx);
    expect(typeof (signed as { id: string }).id).toBe("string");
    expect((signed as { id: string }).id.length).toBeGreaterThan(0);
    expect((signed as { signature: string }).signature).not.toBe("");
  });

  it("surfaces InvalidKeyfileError NAMING the offending field but NEVER echoing a private value (malformed JWK)", async () => {
    const adapter = createArweaveAdapter();
    const tx = await buildUnsignedTx();

    // Wrong kty — arweave-core's importKeyfile rejects before signing.
    await expect(
      adapter.sign(tx, { ...throwawayJwk, kty: "EC" } as unknown as ArweaveJwk),
    ).rejects.toBeInstanceOf(InvalidKeyfileError);

    // Missing `d` — the error names `d`, never the (removed) value; and no OTHER
    // private field value leaks either.
    const { d: _d, ...noD } = throwawayJwk;
    const err = await adapter
      .sign(tx, noD as unknown as ArweaveJwk)
      .catch((e: Error) => e);
    expect(err).toBeInstanceOf(InvalidKeyfileError);
    const msg = (err as Error).message;
    for (const field of ["p", "q", "dp", "dq", "qi"] as const) {
      expect(msg).not.toContain(throwawayJwk[field]);
    }
  });

  it("surfaces SigningError (operation/cause, no key value) when the driver rejects a corrupt-but-valid-length modulus", async () => {
    const adapter = createArweaveAdapter();
    const tx = await buildUnsignedTx();

    // An all-"A" modulus decodes to 512 zero bytes: alphabet-valid and the exact
    // canonical decoded length, so the structural importKeyfile gate PASSES — but
    // a zero modulus is mathematically invalid, so the WebCrypto driver is the
    // layer that rejects it (the residual-risk class caught only at sign time).
    const corruptModulus = "A".repeat(throwawayJwk.n.length);

    const err = await adapter
      .sign(tx, { ...throwawayJwk, n: corruptModulus })
      .catch((e: Error) => e);

    expect(err).toBeInstanceOf(SigningError);
    expect((err as SigningError).operation).toBe("rsa-pss-deephash-sign");
    expect((err as SigningError).cause).toBeDefined();
    // The wrapper's OWN message carries no key material.
    for (const field of PRIVATE_FIELDS) {
      expect((err as Error).message).not.toContain(throwawayJwk[field]);
    }
    expect((err as Error).message).not.toContain(corruptModulus);
  });

  it("leaks NO private JWK field VALUE across the whole sign path (malformed + corrupt + serialized error chain)", async () => {
    const adapter = createArweaveAdapter();
    const tx = await buildUnsignedTx();

    const attempts: ArweaveJwk[] = [
      { ...throwawayJwk, kty: "EC" } as unknown as ArweaveJwk,
      { ...throwawayJwk, n: throwawayJwk.n.slice(0, 100) },
      // A correct-length but mathematically-invalid (all-zero) modulus: passes the
      // structural gate, rejected by the crypto driver → SigningError path.
      { ...throwawayJwk, n: "A".repeat(throwawayJwk.n.length) },
    ];

    for (const jwk of attempts) {
      const err = await adapter.sign(tx, jwk).catch((e: Error) => e);
      // Serialize the full error chain (message + own-enumerable fields) and
      // assert no private field value appears anywhere.
      const serialized =
        (err as Error).message + " " + JSON.stringify(err, Object.getOwnPropertyNames(err));
      for (const field of PRIVATE_FIELDS) {
        expect(serialized).not.toContain(throwawayJwk[field]);
      }
    }
  });
});
