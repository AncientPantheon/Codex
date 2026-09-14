/**
 * rebuildFullKey / bitStringOf — the reusable lift of DalosSecretReveal's
 * module-local re-derivation helper (Arweave seeds, Wave 1 / T1).
 *
 * These specs exist so the helper can be consumed OUTSIDE the reveal modal
 * (the Arweave seed picker turns a stored Ouronet account into its 1600-bit
 * DALOS bitstring). They pin the two properties that consumer depends on:
 *
 *   - every origin mode re-derives the SAME key material the account was
 *     minted from (asserted by address identity across two encodings of the
 *     same key, never by a hardcoded constant), and
 *   - a plaintext that cannot be parsed yields `null` rather than throwing —
 *     the reveal modal renders an error panel on null, so a thrown error
 *     would take the whole panel down instead.
 *
 * `bitStringOf`'s curve inference is exercised against BOTH families, because
 * `IOuroAccount.originCurve` is optional: a DALOS Genesis account must come
 * back 1600 bits and an APOLLO account 1024, decided purely by the address
 * prefix. A test asserting only the dalos side would still pass if the
 * fallback were hardcoded to "dalos".
 */

import { describe, it, expect, vi } from "vitest";
import {
  rebuildFullKey,
  bitStringOf,
} from "@ancientpantheon/codex-ouronet/codex-identity";
import {
  Apollo,
  createDefaultRegistry,
  createOuronetAccount,
} from "@stoachain/stoa-core/dalos";

const WORDS = "alpha bravo charlie delta echo";

/** Independently minted reference key — the value rebuildFullKey must match. */
function referenceKey(curve: "dalos" | "apollo") {
  const registry = createDefaultRegistry();
  if (curve === "apollo") registry.register(Apollo);
  return createOuronetAccount(registry, {
    mode: "seedWords",
    data: WORDS.split(" "),
    primitiveId: curve === "apollo" ? "dalos-apollo" : "dalos-gen-1",
  });
}

// ---------------------------------------------------------------------------
// rebuildFullKey
// ---------------------------------------------------------------------------

describe("rebuildFullKey", () => {
  it("re-derives a seedWords-origin DALOS Genesis key as 1600 bits", () => {
    const full = rebuildFullKey(WORDS, "seedWords", "dalos");
    const reference = referenceKey("dalos");

    expect(full).not.toBeNull();
    expect(full!.privateKey.bitString).toHaveLength(1600);
    expect(full!.privateKey.bitString).toBe(reference.privateKey.bitString);
    expect(full!.standardAddress).toBe(reference.standardAddress);
    expect(full!.standardAddress.startsWith("Ѻ.")).toBe(true);
  });

  it("re-derives an integerBase10-origin key to the same 1600-bit account", () => {
    const reference = referenceKey("dalos");
    const full = rebuildFullKey(reference.privateKey.int10, "integerBase10", "dalos");

    expect(full).not.toBeNull();
    expect(full!.privateKey.bitString).toHaveLength(1600);
    expect(full!.standardAddress).toBe(reference.standardAddress);
  });

  it("re-derives a seedWords-origin APOLLO key on the 1024-bit curve", () => {
    const full = rebuildFullKey(WORDS, "seedWords", "apollo");

    expect(full).not.toBeNull();
    expect(full!.privateKey.bitString).toHaveLength(1024);
    expect(full!.standardAddress.startsWith("₱.")).toBe(true);
  });

  it("returns null instead of throwing on a plaintext the mode cannot parse", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(rebuildFullKey("not a number!!", "integerBase10", "dalos")).toBeNull();
      expect(rebuildFullKey("xyz", "bitString", "dalos")).toBeNull();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("returns null for an empty seed-words plaintext", () => {
    expect(rebuildFullKey("   ", "seedWords", "dalos")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// bitStringOf — curve inferred from the address when originCurve is absent
// ---------------------------------------------------------------------------

describe("bitStringOf", () => {
  it("infers the dalos curve from an Ѻ.-prefixed address with no originCurve", () => {
    const reference = referenceKey("dalos");
    const bits = bitStringOf(
      { address: reference.standardAddress, originMode: "seedWords" },
      WORDS,
    );

    expect(bits).toHaveLength(1600);
    expect(bits).toBe(reference.privateKey.bitString);
  });

  it("infers the dalos curve from a Σ.-prefixed smart address", () => {
    const reference = referenceKey("dalos");
    const bits = bitStringOf(
      { address: reference.smartAddress, originMode: "seedWords" },
      WORDS,
    );

    expect(bits).toBe(reference.privateKey.bitString);
  });

  it("falls back to apollo for a ₱.-prefixed address with no originCurve", () => {
    const reference = referenceKey("apollo");
    const bits = bitStringOf(
      { address: reference.standardAddress, originMode: "seedWords" },
      WORDS,
    );

    expect(bits).toHaveLength(1024);
    expect(bits).toBe(reference.privateKey.bitString);
  });

  it("prefers an explicit originCurve over the address prefix", () => {
    const apolloReference = referenceKey("apollo");
    const bits = bitStringOf(
      {
        address: apolloReference.standardAddress,
        originMode: "seedWords",
        originCurve: "dalos",
      },
      WORDS,
    );

    expect(bits).toHaveLength(1600);
    expect(bits).toBe(referenceKey("dalos").privateKey.bitString);
  });

  it("returns null when the plaintext cannot be rebuilt", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(
        bitStringOf(
          { address: "Ѻ.whatever", originMode: "integerBase10" },
          "not a number!!",
        ),
      ).toBeNull();
    } finally {
      errorSpy.mockRestore();
    }
  });
});
