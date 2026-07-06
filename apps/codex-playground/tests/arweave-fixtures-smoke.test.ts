/**
 * E5 Arweave fixtures — import-smoke + funds-critical shape guards.
 *
 * The fixtures are static committed test data (TDD-exempt infrastructure), but
 * the block↔bare-array asymmetry between the on-wire `foreignKeys` BLOCK and the
 * restored bare-array store slice is the top funds-loss vector E1 T11.6 flagged.
 * These assertions pin that the two F-001 reference constants encode DIFFERENT
 * shapes and that `arweaveBackupJson` deserializes to the exact "1.3"+foreignKeys
 * envelope the post-E1 `useCodexBackup` restores — so a drift in the fixture that
 * would make T15.5's round-trip vacuously pass fails HERE instead.
 */

import { describe, it, expect } from "vitest";
import { deserializeCodex } from "@ancientpantheon/codex-core";
import {
  arweaveBackupJson,
  arweaveBackupPassword,
  expectedForeignKeysArray,
  expectedForeignKeysBlock,
  arweaveBackupPureKeypairs,
  throwawayArweaveKeyfile,
  THROWAWAY_ARWEAVE_ADDRESS,
  // D6 fixtures must still be exported (GREP+ADD never dropped them).
  backupJson,
  backupPassword,
} from "../fixtures/index.js";

describe("E5 Arweave fixtures — module loads and D6 fixtures survive", () => {
  it("keeps the D6 '1.2' no-foreignKeys backup as the reader-before-writer guard", () => {
    // The old "1.2" backup still restores through the rewired reader with
    // foreignKeys naturally absent — the regression guard T15.5 exercises.
    const parsed = deserializeCodex(backupJson) as unknown as Record<string, unknown>;
    expect(parsed.version).toBe("1.2");
    expect(parsed.foreignKeys).toBeUndefined();
    expect(backupPassword).toBe("throwaway-dev-password-not-real");
  });
});

describe("E5 arweaveBackupJson — the '1.3'+{foreignKeys, pureKeypairs} envelope", () => {
  it("deserializes to a '1.3' envelope carrying the foreignKeys BLOCK and pureKeypairs bare array", () => {
    const parsed = deserializeCodex(arweaveBackupJson) as unknown as Record<string, unknown>;
    // The ACTUAL post-E1 wire version — a "1.2" fixture would silently fail the
    // foreignKeys round-trip the playground must prove.
    expect(parsed.version).toBe("1.3");
    // foreignKeys travels as a {schemaVersion, keys} BLOCK...
    expect(parsed.foreignKeys).toEqual(expectedForeignKeysBlock);
    // ...while pureKeypairs travels as a BARE ARRAY (different wire shape).
    expect(parsed.pureKeypairs).toEqual(arweaveBackupPureKeypairs);
    expect(arweaveBackupPassword).toBe("throwaway-arweave-dev-password-not-real");
  });

  it("carries at least one arweave-chain foreign key whose keyfile is an encrypted blob, never plaintext", () => {
    // Funds/secret hygiene: the on-wire key material must be a ciphertext-looking
    // blob, not the plaintext JWK modulus — asserting the throwaway blob is NOT
    // the real key's `n` catches an accidental plaintext-key commit.
    const key = expectedForeignKeysArray[0];
    expect(key.chainId).toBe("arweave");
    expect(key.encryptedKeyfile).not.toContain(throwawayArweaveKeyfile.n);
    expect(key.encryptedKeyfile).toMatch(/^THROWAWAY-enc::/);
  });
});

describe("E5 F-001 reference constants — block vs bare-array asymmetry", () => {
  it("exports the BARE ForeignKeyEntry[] (in-memory slice) distinct from the on-wire BLOCK", () => {
    // The restored/in-memory shape is a BARE ARRAY the store slice adopts via
    // `deserialized.foreignKeys?.keys ?? []`; the on-wire shape is the BLOCK. A
    // consumer that deep-equals the store against the block (or vice-versa) is
    // the funds-loss bug — these two constants must NOT be interchangeable.
    expect(Array.isArray(expectedForeignKeysArray)).toBe(true);
    expect(Array.isArray(expectedForeignKeysBlock)).toBe(false);
    // The block WRAPS the bare array under `.keys`.
    expect(expectedForeignKeysBlock.keys).toBe(expectedForeignKeysArray);
    expect(expectedForeignKeysBlock.schemaVersion).toBe(1);
  });
});

describe("E5 throwawayArweaveKeyfile — the real-toggle plaintext import fixture", () => {
  it("is a canonical 9-field RSA JWK with the documented throwaway address anchor", () => {
    // The real-toggle import path derives THROWAWAY_ARWEAVE_ADDRESS from this
    // JWK; a missing private field would break the derive at T15.6.
    expect(throwawayArweaveKeyfile.kty).toBe("RSA");
    expect(throwawayArweaveKeyfile.e).toBe("AQAB");
    for (const f of ["n", "d", "p", "q", "dp", "dq", "qi"] as const) {
      expect(typeof throwawayArweaveKeyfile[f]).toBe("string");
      expect(throwawayArweaveKeyfile[f].length).toBeGreaterThan(0);
    }
    expect(THROWAWAY_ARWEAVE_ADDRESS).toHaveLength(43);
  });
});
