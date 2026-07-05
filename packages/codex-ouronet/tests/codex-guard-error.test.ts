/**
 * IPureKeypair CodexGuard/DuoPurePrime marker flags + CodexGuardError shape tests.
 *
 * Pins the contract Phase 5's store getters (T5.3) and Phases 6/7/8 depend on:
 *   - the IPureKeypair extension (four additive-optional marker flags ride the
 *     existing entry shape — full-flag and minimal-flag literals both type-check)
 *   - the CodexGuardError shape — six discriminating reason codes (the 6th,
 *     `integrity-violated`, was added in the plan-review for the getter
 *     defense), the CodexError prototype chain, an optional detail appended to
 *     the reason-keyed default message, and an optional cause forwarded to
 *     Error.cause.
 */

import { describe, it, expect } from "vitest";
import {
  CodexGuardError,
  CodexError,
} from "@ancientpantheon/codex-ouronet/errors";
import type { IPureKeypair } from "@ancientpantheon/codex-ouronet/types";

describe("IPureKeypair CodexGuard / DuoPurePrime markers", () => {
  it("admits a fully-flagged pure keypair (all four new optional flags populated)", () => {
    // Type-compile assertion via direct construction: if any new flag is
    // mis-typed (e.g. duoPurePrimeRole accepts a string outside the union) the
    // test file fails to compile (vitest runs through tsc).
    const x: IPureKeypair = {
      id: "k1",
      label: "CodexGuard",
      publicKey: "a".repeat(64),
      encryptedPrivateKey: "enc-priv-blob",
      createdAt: "2026-05-29T00:00:00.000Z",
      isCodexGuard: true,
      wasCodexGuard: false,
      isDuoPurePrime: true,
      duoPurePrimeRole: "guard",
    };
    // Runtime sanity so the assertion isn't compile-only: each flag round-trips
    // verbatim, including the discriminated-union role literal.
    expect(x.isCodexGuard).toBe(true);
    expect(x.wasCodexGuard).toBe(false);
    expect(x.isDuoPurePrime).toBe(true);
    expect(x.duoPurePrimeRole).toBe("guard");
  });

  it("admits a minimal v0.2-shaped pure keypair (no new flags) — additive-optional back-compat", () => {
    // A legacy entry with only the original required fields must still
    // construct cleanly; the four flags stay undefined. This proves existing
    // user codices keep loading without a runtime migration.
    const x: IPureKeypair = {
      id: "k2",
      publicKey: "b".repeat(64),
      encryptedPrivateKey: "enc-priv-blob-2",
      createdAt: "2026-05-29T00:00:00.000Z",
    };
    expect(x.isCodexGuard).toBeUndefined();
    expect(x.wasCodexGuard).toBeUndefined();
    expect(x.isDuoPurePrime).toBeUndefined();
    expect(x.duoPurePrimeRole).toBeUndefined();
  });
});

describe("CodexGuardError", () => {
  const reasons = [
    "already-exists",
    "missing-codex-guard",
    "rename-rejected",
    "delete-rejected",
    "rotation-invalid",
    "integrity-violated",
  ] as const;

  it("surfaces each of the 6 reasons as error.reason", () => {
    for (const reason of reasons) {
      const err = new CodexGuardError(reason);
      expect(err.reason).toBe(reason);
    }
  });

  it("is a CodexError and an Error with name CodexGuardError", () => {
    const err = new CodexGuardError("already-exists");
    expect(err.name).toBe("CodexGuardError");
    expect(err instanceof CodexGuardError).toBe(true);
    expect(err instanceof CodexError).toBe(true);
    expect(err instanceof Error).toBe(true);
  });

  it("appends detail to the reason-keyed default message when provided", () => {
    const bare = new CodexGuardError("already-exists");
    const detailed = new CodexGuardError("already-exists", "codexId=abc123");
    // A consumer rendering err.message must see both the reason's default
    // wording AND the context detail, so the failure is diagnosable from the
    // string without inspecting .reason.
    expect(bare.message).toMatch(/already has an active CodexGuard/);
    expect(detailed.message).toContain(bare.message);
    expect(detailed.message).toContain("codexId=abc123");
    expect(detailed.message).not.toBe(bare.message);
  });

  it("propagates cause via error.cause when provided", () => {
    const inner = new Error("inner");
    const err = new CodexGuardError("rotation-invalid", "bad target", inner);
    expect((err.cause as Error).message).toBe("inner");
  });

  it("has an exhaustive reason-to-message lookup table (no reason echoes itself)", () => {
    // Iterating proves every reason code has a real default-message entry, not
    // a fallback that just echoes the reason discriminator string.
    for (const reason of reasons) {
      const err = new CodexGuardError(reason);
      expect(err.message.length).toBeGreaterThan(0);
      expect(err.message).not.toBe(reason);
    }
  });
});
