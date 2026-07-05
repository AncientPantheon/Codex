/**
 * Unit tests for the seedless foreignKeys model guard.
 *
 * `isForeignKeyEntry` is the structural gate T6.2's deserializeCodex uses to
 * validate each entry WITHOUT decrypting. It must accept a labelless entry
 * (E1's Arweave keys need not carry a human label) and reject anything whose
 * required string fields (id / chainId / encryptedKeyfile) are missing or the
 * wrong type — a malformed entry that slipped through would let a corrupt or
 * truncated foreign-key blob into a restore, permanently losing the key.
 */

import { describe, it, expect } from "vitest";
import { isForeignKeyEntry } from "../src/codex/foreignKeys.js";

describe("isForeignKeyEntry", () => {
  it("accepts a fully-populated entry (id, label, chainId, encryptedKeyfile all strings)", () => {
    const entry = { id: "fk-1", label: "Arweave main", chainId: "arweave:mainnet", encryptedKeyfile: "enc:blob" };
    expect(isForeignKeyEntry(entry)).toBe(true);
  });

  it("accepts a labelless entry — label is OPTIONAL so E1's labelless Arweave keys are not rejected", () => {
    const entry = { id: "fk-nolabel", chainId: "arweave:mainnet", encryptedKeyfile: "enc:blob" };
    expect(isForeignKeyEntry(entry)).toBe(true);
  });

  it("rejects an entry whose label is present but not a string (a non-string label is malformed)", () => {
    const entry = { id: "fk-1", label: 42, chainId: "arweave:mainnet", encryptedKeyfile: "enc:blob" };
    expect(isForeignKeyEntry(entry)).toBe(false);
  });

  it("rejects an entry missing its required id (a keyless entry cannot be addressed on restore)", () => {
    const entry = { chainId: "arweave:mainnet", encryptedKeyfile: "enc:blob" };
    expect(isForeignKeyEntry(entry)).toBe(false);
  });

  it("rejects an entry missing encryptedKeyfile (the ciphertext is the only copy of the key material)", () => {
    const entry = { id: "fk-1", chainId: "arweave:mainnet" };
    expect(isForeignKeyEntry(entry)).toBe(false);
  });

  it("rejects an entry whose encryptedKeyfile is the wrong type (number, not ciphertext string)", () => {
    const entry = { id: "fk-1", chainId: "arweave:mainnet", encryptedKeyfile: 123 };
    expect(isForeignKeyEntry(entry)).toBe(false);
  });

  it("rejects non-object inputs (null, string, array) — a keyring entry is always an object", () => {
    expect(isForeignKeyEntry(null)).toBe(false);
    expect(isForeignKeyEntry("not-an-object")).toBe(false);
    expect(isForeignKeyEntry(["fk-1"])).toBe(false);
  });
});
