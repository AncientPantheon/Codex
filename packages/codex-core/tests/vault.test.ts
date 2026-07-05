/**
 * RED contract tests for the CK-wrapping vault + injectable crypto seam.
 *
 * codex-core owns the vault CONTRACT, never the crypto. The real KDF/cipher
 * (`encryptStringV2` / `smartDecrypt` from `@stoachain/stoa-core/crypto`) is
 * injected by the consumer (D5/E1) — core stays dependency-light (D7) and holds
 * NO password. These tests pin four contracts that T7.7's GREEN must satisfy:
 *
 *   1. The injectable `CryptoSeam` ({ encrypt(plaintext, key), decrypt(ciphertext, key) }):
 *      a FAKE seam round-trips a secret through the vault, proving core delegates
 *      to the injected crypto and never stores the CK/password.
 *   2. The CK-wrapping discipline: every secret is encrypted at the CK via the
 *      seam BEFORE storage — the vault's wrap path produces ciphertext, unwrap
 *      recovers the plaintext, and the CK is never retained on the vault.
 *   3. The ABSOLUTE-window unlock model (`PasswordCacheEntry` + `makePasswordCache` /
 *      `isUnlocked`): an unlock is valid until an absolute epoch-ms expiry; a read
 *      before expiry does NOT extend it (not a sliding window); `expiresAt <= now`
 *      locks; a null/absent cache is locked. The clock is injected (`now`) — no
 *      real `Date` in the assertions.
 *   4. Secret-free errors: a vault error on a bad decrypt NAMES the operation but
 *      the message never contains the plaintext secret or the CK substring, and
 *      the error is an `instanceof CodexError` (D2's single catch-all base).
 *
 * RED: the vault subpath barrel `../src/vault` does not exist yet, so this whole
 * file fails to import until T7.7 lands it.
 */

import { describe, it, expect } from "vitest";
import {
  makeVault,
  makePasswordCache,
  isUnlocked,
  VaultCryptoError,
  type CryptoSeam,
  type PasswordCacheEntry,
} from "../src/vault/index.js";
import { CodexError } from "../src/codex/errors.js";

/**
 * A test-only seam that "encrypts" by reversing the string and prefixing the
 * key — enough to prove the vault delegates to the injected crypto and does NOT
 * re-implement a cipher. `decrypt` inverts it and rejects anything that was not
 * produced under the same key (so a bad-key/bad-ciphertext path can be exercised).
 */
function makeFakeSeam(): CryptoSeam {
  const marker = "fake:";
  return {
    encrypt(plaintext: string, key: string): string {
      return `${marker}${key}:${[...plaintext].reverse().join("")}`;
    },
    decrypt(ciphertext: string, key: string): string {
      const prefix = `${marker}${key}:`;
      if (!ciphertext.startsWith(prefix)) {
        throw new Error("fake seam: ciphertext not produced under this key");
      }
      return [...ciphertext.slice(prefix.length)].reverse().join("");
    },
  };
}

describe("CryptoSeam injection — vault delegates, holds no crypto and no password", () => {
  it("round-trips a secret through an INJECTED fake seam (core re-implements no cipher)", async () => {
    const seam = makeFakeSeam();
    const vault = makeVault(seam);
    const plaintext = "the twelve mnemonic words go here";
    const ck = "codex-password-CK";

    const ciphertext = await vault.wrap(plaintext, ck);
    // The ciphertext is whatever the INJECTED seam produced — not a core cipher.
    expect(ciphertext).toBe(seam.encrypt(plaintext, ck));
    // Unwrapping with the same CK recovers exactly the original plaintext.
    await expect(vault.unwrap(ciphertext, ck)).resolves.toBe(plaintext);
  });

  it("stores ciphertext only — wrap output is NOT the plaintext (CK-wrapping before storage)", async () => {
    const vault = makeVault(makeFakeSeam());
    const plaintext = "encrypted-mnemonic-at-codex-password";

    const ciphertext = await vault.wrap(plaintext, "CK");
    // The wrap path must transform: what a codec/adapter persists is ciphertext,
    // never the raw secret.
    expect(ciphertext).not.toBe(plaintext);
    expect(ciphertext).not.toContain(plaintext);
  });

  it("retains NEITHER the CK nor the plaintext on the vault object after wrapping", async () => {
    const vault = makeVault(makeFakeSeam());
    const ck = "super-secret-codex-key";
    const plaintext = "leak-me-if-you-can";

    await vault.wrap(plaintext, ck);

    // The vault is a caller-bound seam holder — no field may retain the password
    // or the plaintext (module holds no password, per the D7 injection model).
    const serialized = JSON.stringify(Object.values(vault));
    expect(serialized).not.toContain(ck);
    expect(serialized).not.toContain(plaintext);
  });

  it("uses the CK the CALLER passes per-call — different CKs yield different ciphertext", async () => {
    const vault = makeVault(makeFakeSeam());
    const plaintext = "same-secret";

    const underKeyA = await vault.wrap(plaintext, "key-A");
    const underKeyB = await vault.wrap(plaintext, "key-B");
    // The CK is caller-bound at the call site, not baked into the vault, so the
    // same plaintext under two CKs must differ.
    expect(underKeyA).not.toBe(underKeyB);
  });
});

describe("makePasswordCache / isUnlocked — ABSOLUTE-window unlock (not sliding)", () => {
  it("makePasswordCache sets expiresAt to an ABSOLUTE now + ttl (epoch ms), preserving the value", () => {
    const now = 1_000_000;
    const cache = makePasswordCache("pw", 60_000, now);
    // Absolute expiry computed once at unlock: now + ttl. This is the source's
    // `Date.now() + ttl*60_000` reproduced with an injected clock.
    expect(cache.expiresAt).toBe(now + 60_000);
    expect(cache.value).toBe("pw");
  });

  it("isUnlocked is true strictly BEFORE the absolute expiry", () => {
    const cache = makePasswordCache("pw", 60_000, 1_000_000);
    // A read at t < expiry is unlocked.
    expect(isUnlocked(cache, 1_000_000 + 59_999)).toBe(true);
  });

  it("isUnlocked is FALSE exactly AT expiry (expiresAt <= now locks — the boundary is closed)", () => {
    const cache = makePasswordCache("pw", 60_000, 1_000_000);
    // Mirrors the source `cache.expiresAt <= now` — the expiry instant itself is
    // already locked.
    expect(isUnlocked(cache, cache.expiresAt)).toBe(false);
  });

  it("does NOT slide: reading before expiry never extends the window", () => {
    const cache = makePasswordCache("pw", 60_000, 1_000_000);
    // An in-window read at t=1_030_000 must not push expiresAt forward; a later
    // read past the ORIGINAL expiry is still locked.
    expect(isUnlocked(cache, 1_030_000)).toBe(true);
    expect(isUnlocked(cache, 1_060_001)).toBe(false);
  });

  it("treats a null/absent cache as locked", () => {
    // No cache at all is the locked state (the source's `!cache` branch).
    expect(isUnlocked(null, 1_000_000)).toBe(false);
    expect(isUnlocked(undefined as unknown as PasswordCacheEntry | null, 1_000_000)).toBe(false);
  });
});

describe("secret hygiene — vault errors name the operation, never the secret", () => {
  it("throws a VaultCryptoError that is an instanceof CodexError on a bad decrypt", async () => {
    const vault = makeVault(makeFakeSeam());
    // Ciphertext that was never produced under this CK — decrypt must fail.
    await expect(vault.unwrap("not-a-valid-ciphertext", "CK")).rejects.toBeInstanceOf(
      VaultCryptoError,
    );
    await expect(vault.unwrap("not-a-valid-ciphertext", "CK")).rejects.toBeInstanceOf(CodexError);
  });

  it("names the failing operation but leaks NEITHER the CK nor the plaintext in the message", async () => {
    const vault = makeVault(makeFakeSeam());
    const ck = "codex-password-that-must-not-leak";
    const plaintext = "plaintext-that-must-not-leak";
    // Encrypt so a valid ciphertext exists, then attempt to decrypt it under a
    // WRONG CK — the failure message must name the operation, not the secrets.
    const ciphertext = await vault.wrap(plaintext, ck);

    let caught: unknown;
    try {
      await vault.unwrap(ciphertext, "wrong-CK");
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(VaultCryptoError);
    const message = (caught as Error).message;
    // Operation named for observability...
    expect(message.toLowerCase()).toContain("decrypt");
    // ...but the CK and plaintext values never appear in the thrown message.
    expect(message).not.toContain(ck);
    expect(message).not.toContain(plaintext);
    expect(message).not.toContain(ciphertext);
  });
});
