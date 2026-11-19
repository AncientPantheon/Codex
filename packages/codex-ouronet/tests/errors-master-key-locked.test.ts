/**
 * `CodexMasterKeyLockedError` — the refusal raised when something tries to
 * remove a derived key position, or delete a seed, that the Codex Ouronet
 * Master is actually relying on.
 *
 * Pinned here rather than only inside the store tests because the MESSAGE is
 * the whole point: the existing protection errors in this package
 * (`CodexPrimeSeedProtectedError`, `CodexPrimeProtectedError`) all name the
 * entity AND explain the way out, and a lock that refuses without saying
 * WHICH position and WHY would be indistinguishable from a bug — the reason
 * is precisely what tells the user to re-run Secure Master Account.
 */

import { describe, it, expect } from "vitest";
import { OURONET_CODEX_MASTER } from "@ancientpantheon/codex-core";
import {
  CodexMasterKeyLockedError,
  CodexError,
} from "@ancientpantheon/codex-ouronet/errors";

describe("CodexMasterKeyLockedError", () => {
  it("is exported from the package barrel and extends CodexError", () => {
    const e = new CodexMasterKeyLockedError("seed-1", 0, "master-payment-key");
    expect(e).toBeInstanceOf(CodexError);
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("CodexMasterKeyLockedError");
  });

  it("names the seed, the position and the reason in its message", () => {
    const e = new CodexMasterKeyLockedError("seed-1", 0, "master-payment-key");
    expect(e.message).toContain("seed-1");
    expect(e.message).toContain("0");
    expect(e.message).toContain("master-payment-key");
  });

  it("names the master by the canonical constant in BOTH message branches, never a copied literal", () => {
    // Both branches of this message hardcoded the master's name, so when the
    // constant was corrected the refusal kept citing a product name that no
    // longer exists anywhere else in the UI — while this same file's OTHER
    // errors (CodexPrimeProtectedError) interpolated the constant and moved.
    // A user who hits a lock and a user who reads the accounts tab must be
    // told about the same named thing.
    const position = new CodexMasterKeyLockedError("seed-1", 0, "master-payment-key");
    expect(position.message).toContain(OURONET_CODEX_MASTER);
    const wholeSeed = new CodexMasterKeyLockedError("seed-2", null, "master-guard-key");
    expect(wholeSeed.message).toContain(OURONET_CODEX_MASTER);
  });

  it("exposes seedId / position / reason as structured fields, so a caller never parses the message", () => {
    const e = new CodexMasterKeyLockedError("seed-9", 3, "master-guard-key");
    expect(e.seedId).toBe("seed-9");
    expect(e.position).toBe(3);
    expect(e.reason).toBe("master-guard-key");
  });

  it("supports a WHOLE-SEED refusal with position null, and says so without printing 'null'", () => {
    // Deleting a seed is refused by the same invariant, but there is no one
    // offending position — the seed is held by at least one lock.
    const e = new CodexMasterKeyLockedError("seed-2", null, "master-guard-key");
    expect(e.position).toBeNull();
    expect(e.message).toContain("seed-2");
    expect(e.message).not.toContain("null");
  });

  it("the prototype chain survives, so `instanceof` works after transpilation", () => {
    try {
      throw new CodexMasterKeyLockedError("seed-1", 1, "master-guard-key");
    } catch (caught) {
      expect(caught instanceof CodexMasterKeyLockedError).toBe(true);
    }
  });
});
