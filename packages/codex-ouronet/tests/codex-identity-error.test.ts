/**
 * ICodexIdentity type + CodexIdentityError shape tests.
 *
 * Pins the contract Phase 3's snapshot slot (T3.2) and store getter (T3.3)
 * depend on: the canonical ICodexIdentity shape (display fields, the two
 * Apollo public keys, the six encrypted derivation caches, the optional
 * encrypted private keys, and plaintext split metadata) and the
 * CodexIdentityError shape — six discriminating reason codes, the CodexError
 * prototype chain, an optional detail appended to the reason-keyed default
 * message, and an optional cause forwarded to Error.cause.
 */

import { describe, it, expect } from "vitest";
import {
  CodexIdentityError,
  CodexError,
} from "@ancientpantheon/codex-ouronet/errors";
import type { ICodexIdentity } from "@ancientpantheon/codex-ouronet/types";

describe("ICodexIdentity type", () => {
  it("admits a fully-populated identity with all 16 fields (13 required + 3 optional)", () => {
    // Type-compile assertion via direct construction: if any field is missing
    // or mis-typed the test file fails to compile (vitest runs through tsc).
    const x: ICodexIdentity = {
      formatted: "₱.AAA:Π.BBB",
      standardPublicKey: "S".repeat(160),
      smartPublicKey: "Z".repeat(160),
      encryptedSeedWords: "enc-seed-words",
      encryptedStandardBitstring: "enc-std-bits",
      encryptedSmartBitstring: "enc-smart-bits",
      encryptedStandardBase10: "enc-std-b10",
      encryptedSmartBase10: "enc-smart-b10",
      encryptedStandardBase49: "enc-std-b49",
      encryptedSmartBase49: "enc-smart-b49",
      encryptedStandardPrivateKey: "enc-std-priv",
      encryptedSmartPrivateKey: "enc-smart-priv",
      totalWordCount: 12,
      splitIndex: 6,
      createdAt: "2026-05-29T00:00:00.000Z",
      createdBy: "alice",
    };
    // Runtime sanity so the assertion isn't compile-only: the plaintext split
    // metadata round-trips the deterministic half-boundary inputs verbatim.
    expect(x.totalWordCount).toBe(12);
    expect(x.splitIndex).toBe(6);
    expect(x.createdBy).toBe("alice");
  });

  it("admits a minimal identity with only the 13 required fields (no private-key caches, no createdBy)", () => {
    // The three optional fields (encryptedStandardPrivateKey,
    // encryptedSmartPrivateKey, createdBy) are absent here — proves they are
    // genuinely optional and a fresh non-Mnemosyne codex constructs cleanly.
    const x: ICodexIdentity = {
      formatted: "₱.AAA:Π.BBB",
      standardPublicKey: "S".repeat(160),
      smartPublicKey: "Z".repeat(160),
      encryptedSeedWords: "enc-seed-words",
      encryptedStandardBitstring: "enc-std-bits",
      encryptedSmartBitstring: "enc-smart-bits",
      encryptedStandardBase10: "enc-std-b10",
      encryptedSmartBase10: "enc-smart-b10",
      encryptedStandardBase49: "enc-std-b49",
      encryptedSmartBase49: "enc-smart-b49",
      totalWordCount: 7,
      splitIndex: 3,
      createdAt: "2026-05-29T00:00:00.000Z",
    };
    expect(x.encryptedStandardPrivateKey).toBeUndefined();
    expect(x.encryptedSmartPrivateKey).toBeUndefined();
    expect(x.createdBy).toBeUndefined();
    // Odd word count: Smart half gets the larger share (splitIndex=floor(7/2)=3).
    expect(x.totalWordCount).toBe(7);
    expect(x.splitIndex).toBe(3);
  });
});

describe("CodexIdentityError", () => {
  const reasons = [
    "already-exists",
    "seed-invalid",
    "seed-word-count",
    "split-invalid",
    "immutable-field",
    "missing-codex-identity",
  ] as const;

  it("surfaces each of the 6 reasons as error.reason", () => {
    for (const reason of reasons) {
      const err = new CodexIdentityError(reason);
      expect(err.reason).toBe(reason);
    }
  });

  it("is a CodexError and an Error with name CodexIdentityError", () => {
    const err = new CodexIdentityError("already-exists");
    expect(err.name).toBe("CodexIdentityError");
    expect(err instanceof CodexIdentityError).toBe(true);
    expect(err instanceof CodexError).toBe(true);
    expect(err instanceof Error).toBe(true);
  });

  it("appends detail to the reason-keyed default message when provided", () => {
    const bare = new CodexIdentityError("already-exists");
    const detailed = new CodexIdentityError(
      "already-exists",
      "codexId=abc123"
    );
    // A consumer rendering err.message must see both the reason's default
    // wording AND the context detail, so the failure is diagnosable from the
    // string without inspecting .reason.
    expect(bare.message).toMatch(/already has an ICodexIdentity/);
    expect(detailed.message).toContain(bare.message);
    expect(detailed.message).toContain("codexId=abc123");
    expect(detailed.message).not.toBe(bare.message);
  });

  it("propagates cause via error.cause when provided", () => {
    const inner = new Error("inner");
    const err = new CodexIdentityError("seed-invalid", "bad seed", inner);
    expect((err.cause as Error).message).toBe("inner");
  });

  it("has an exhaustive reason-to-message lookup table (no reason echoes itself)", () => {
    // Iterating proves every reason code has a real default-message entry, not
    // a fallback that just echoes the reason discriminator string.
    for (const reason of reasons) {
      const err = new CodexIdentityError(reason);
      expect(err.message.length).toBeGreaterThan(0);
      expect(err.message).not.toBe(reason);
    }
  });
});
