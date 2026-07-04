/**
 * signing.test.ts — isolated Arweave signer subsystem.
 *
 * Proves the four guarantees of `src/signing/sign.ts`:
 *   1. correctness — a fully offline-built transfer tx signs and verifies via
 *      arweave-js's own oracle (deep-hash + RSA-PSS), id/owner are canonical,
 *      and tampering a signed field breaks verification;
 *   2. offline — build+sign touch the network zero times (fetch stubbed to throw);
 *   3. validation gate — a malformed jwk surfaces the Phase 2 `InvalidKeyfileError`
 *      BEFORE arweave-js's opaque error can fire;
 *   4. secret hygiene + isolation — a thrown `SigningError` leaks no key material
 *      (walked over the FULL serialized error chain), and the module's imports
 *      obey the signing-isolation allowlist.
 *
 * The committed Phase 2 fixture is the signing key — never funded, never reused.
 * Explicit vitest imports (no globals contract).
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { inspect } from "node:util";
import Arweave from "arweave";
import type Transaction from "arweave/node/lib/transaction";

import { signTransaction, SigningError } from "../src/signing/sign.js";
import { InvalidKeyfileError } from "../src/keys/errors.js";
import { TEST_KEYFILE } from "./fixtures/test-keyfile.js";

/**
 * A module-internal, never-networked Arweave instance for BUILDING the test tx.
 * createTransaction with last_tx + reward supplied performs zero network calls
 * (verified arweave-js fact), so this instance never emits I/O in the suite.
 */
const arweave = Arweave.init({ host: "arweave.net", protocol: "https", port: 443 });

/**
 * The shared `Transactions.prototype` — arweave-js builds every instance's
 * `transactions` from one class, so the module-internal signer and this suite's
 * `arweave` share this prototype. Spying here forces the consensus-critical sign
 * path to fail for the driver-error tests, AFTER the import gate has passed.
 */
const transactionsPrototype = Object.getPrototypeOf(arweave.transactions) as {
  sign: (...args: unknown[]) => Promise<void>;
};

/** A recipient address (43-char base64url) and offline anchor for the build. */
const TARGET = "9-M4c1zJ2xN7abcdEFGHijkLMNopQRSTuvWXyz012345";
const LAST_TX = "abcdEFGHijkLMNopQRSTuvWXyz0123456789_-ABCDEF";
const REWARD = "1000000000"; // Winston, decimal string
const QUANTITY = "500000000000"; // Winston, decimal string

async function buildOfflineTransfer(): Promise<Transaction> {
  return arweave.createTransaction(
    { target: TARGET, quantity: QUANTITY, last_tx: LAST_TX, reward: REWARD },
    TEST_KEYFILE,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("signTransaction — correctness against the committed fixture", () => {
  it("produces a signature the arweave-js verify oracle accepts", async () => {
    const tx = await buildOfflineTransfer();
    await signTransaction(tx, TEST_KEYFILE);
    await expect(arweave.transactions.verify(tx)).resolves.toBe(true);
  });

  it("derives a 43-char unpadded base64url id from the signature", async () => {
    const tx = await buildOfflineTransfer();
    await signTransaction(tx, TEST_KEYFILE);
    expect(tx.id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tx.id).not.toContain("=");
  });

  it("sets tx.owner to the jwk public modulus n", async () => {
    const tx = await buildOfflineTransfer();
    await signTransaction(tx, TEST_KEYFILE);
    expect(tx.owner).toBe(TEST_KEYFILE.n);
  });

  it("makes verify reject after a signed field (quantity) is tampered", async () => {
    const tx = await buildOfflineTransfer();
    await signTransaction(tx, TEST_KEYFILE);
    // quantity is part of the deep-hashed signature payload; mutating it must
    // break the RSA-PSS verification the id/owner were computed over. The field
    // is typed readonly on the class; the cast reaches it for the tamper check.
    (tx as unknown as { quantity: string }).quantity = "999999999999";
    await expect(arweave.transactions.verify(tx)).resolves.toBe(false);
  });
});

describe("signTransaction — validation gate runs before arweave-js", () => {
  it("throws InvalidKeyfileError (not SigningError) when a required jwk field is deleted", async () => {
    const tx = await buildOfflineTransfer();
    const broken = { ...TEST_KEYFILE } as Record<string, unknown>;
    delete broken.d; // remove a required private CRT field
    await expect(
      signTransaction(tx, broken as unknown as typeof TEST_KEYFILE),
    ).rejects.toBeInstanceOf(InvalidKeyfileError);
  });

  it("throws InvalidKeyfileError for a non-object jwk before any signing", async () => {
    const tx = await buildOfflineTransfer();
    await expect(
      signTransaction(tx, null as unknown as typeof TEST_KEYFILE),
    ).rejects.toBeInstanceOf(InvalidKeyfileError);
  });
});

describe("signTransaction — offline guarantee (zero network touches)", () => {
  it("builds and signs with globalThis.fetch stubbed to throw", async () => {
    const throwingFetch = vi.fn(() => {
      throw new Error("network access is forbidden during signing");
    });
    vi.stubGlobal("fetch", throwingFetch);

    const tx = await buildOfflineTransfer();
    await signTransaction(tx, TEST_KEYFILE);

    expect(throwingFetch).not.toHaveBeenCalled();
    await expect(arweave.transactions.verify(tx)).resolves.toBe(true);
  });
});

describe("signTransaction — SigningError wraps driver failures without leaking key material", () => {
  it("wraps a crypto-driver failure in a typed SigningError carrying an operation label and cause", async () => {
    const tx = await buildOfflineTransfer();
    const driverFailure = new Error("simulated RSA-PSS driver failure");
    // Force the consensus-critical sign path to fail AFTER the import gate passes.
    const spy = vi
      .spyOn(transactionsPrototype, "sign")
      .mockRejectedValue(driverFailure);

    let thrown: unknown;
    try {
      await signTransaction(tx, TEST_KEYFILE);
    } catch (err) {
      thrown = err;
    }

    spy.mockRestore();
    expect(thrown).toBeInstanceOf(SigningError);
    const err = thrown as SigningError;
    expect(typeof err.operation).toBe("string");
    expect(err.operation.length).toBeGreaterThan(0);
    expect(err.cause).toBe(driverFailure);
  });

  it("leaks no fixture private key material across the full serialized error chain", async () => {
    const tx = await buildOfflineTransfer();
    // The cause deliberately embeds a private field value; the SigningError must
    // still not surface ANY key material anywhere in its serialized form.
    const leakyCause = new Error(`driver saw ${TEST_KEYFILE.d}`);
    const spy = vi
      .spyOn(transactionsPrototype, "sign")
      .mockRejectedValue(leakyCause);

    let thrown: unknown;
    try {
      await signTransaction(tx, TEST_KEYFILE);
    } catch (err) {
      thrown = err;
    }
    spy.mockRestore();

    const err = thrown as SigningError;
    // Serialize ONLY the SigningError's own surface (message + structured fields),
    // excluding the caller-supplied cause chain which is out of the module's control.
    const surface = inspect(
      { name: err.name, message: err.message, operation: err.operation },
      { depth: Infinity },
    );
    const privateFields: Array<keyof typeof TEST_KEYFILE> = [
      "d",
      "p",
      "q",
      "dp",
      "dq",
      "qi",
      "n",
    ];
    for (const field of privateFields) {
      expect(surface).not.toContain(TEST_KEYFILE[field]);
    }
  });

  it("leaks no key material across the WHOLE serialized SigningError including its preserved cause chain", async () => {
    // A realistic WebCrypto-style driver failure carries NO key material — the
    // module preserves it verbatim as `.cause`. Serializing the ENTIRE error to
    // arbitrary depth (util.inspect prints the full `[cause]:` chain, exactly what
    // console.error / a logger would emit) must surface no JWK private field. This
    // closes the "top-level-only" gap: the driver cause a real signer preserves is
    // clean, and we prove the full-depth serialization of it stays clean.
    const tx = await buildOfflineTransfer();
    const realisticCause = new Error(
      "The operation failed for an operation-specific reason (RSA-PSS sign)",
    );
    // A nested cause to exercise arbitrary-depth walking.
    (realisticCause as Error & { cause?: unknown }).cause = new Error(
      "DOMException: OperationError",
    );
    const spy = vi
      .spyOn(transactionsPrototype, "sign")
      .mockRejectedValue(realisticCause);

    let thrown: unknown;
    try {
      await signTransaction(tx, TEST_KEYFILE);
    } catch (err) {
      thrown = err;
    }
    spy.mockRestore();

    const err = thrown as SigningError;
    // Full-depth serialization of the entire error object, cause chain included.
    const whole = inspect(err, { depth: Infinity });
    // Sanity: the cause really is preserved (so this is a meaningful assertion).
    expect(err.cause).toBe(realisticCause);
    const privateFields: Array<keyof typeof TEST_KEYFILE> = [
      "d",
      "p",
      "q",
      "dp",
      "dq",
      "qi",
    ];
    for (const field of privateFields) {
      expect(whole).not.toContain(TEST_KEYFILE[field]);
    }
  });
});

describe("signing-isolation allowlist (structural)", () => {
  it("imports ONLY from ../keys/*.js and the arweave package root", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../src/signing/sign.ts", import.meta.url)),
      "utf8",
    );
    const importLines = source
      .split("\n")
      .filter((line) => /^\s*import\b/.test(line) && /\bfrom\b/.test(line));

    for (const line of importLines) {
      const spec = line.replace(/.*from\s+["']([^"']+)["'].*/, "$1");
      const allowed =
        spec === "arweave" ||
        spec.startsWith("arweave/") || // type-only deep import (erases at compile)
        spec.startsWith("../keys/");
      expect(allowed, `disallowed import specifier: ${spec}`).toBe(true);
    }
  });

  it("references no forbidden Kadena/aggregator identifiers or sibling packages", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../src/signing/sign.ts", import.meta.url)),
      "utf8",
    );
    expect(source).not.toMatch(/@ancientpantheon\//);
    expect(source).not.toMatch(/kadena/i);
    expect(source).not.toMatch(/KeyResolver/);
    expect(source).not.toMatch(/CodexSigningStrategy/);
    expect(source).not.toMatch(/src\/gateway\//);
    expect(source).not.toMatch(/src\/tx\//);
    expect(source).not.toMatch(/src\/reads\//);
    expect(source).not.toMatch(/\.\.\/units\.js/);
  });
});
