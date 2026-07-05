/**
 * CodexMigrationError tests — verify the error shape contract that the
 * schema-migration runner (T1.2) and the store init() wiring (T1.3) depend
 * on: three discriminating reason codes, the CodexError prototype chain, an
 * optional detail appended to the reason-keyed default message, and an
 * optional cause forwarded to Error.cause.
 */

import { describe, it, expect } from "vitest";
import {
  CodexMigrationError,
  CodexError,
} from "@ancientpantheon/codex-ouronet/errors";

describe("CodexMigrationError", () => {
  const reasons = [
    "unknown-schema-version",
    "migration-failed",
    "post-condition-failed",
  ] as const;

  it("surfaces each of the 3 reasons as error.reason", () => {
    for (const reason of reasons) {
      const err = new CodexMigrationError(reason);
      expect(err.reason).toBe(reason);
    }
  });

  it("is a CodexError and an Error with name CodexMigrationError", () => {
    const err = new CodexMigrationError("migration-failed");
    expect(err.name).toBe("CodexMigrationError");
    expect(err instanceof CodexMigrationError).toBe(true);
    expect(err instanceof CodexError).toBe(true);
    expect(err instanceof Error).toBe(true);
  });

  it("appends detail to the reason-keyed default message when provided", () => {
    const bare = new CodexMigrationError("unknown-schema-version");
    const detailed = new CodexMigrationError(
      "unknown-schema-version",
      "loaded=99, max=2"
    );
    // The detailed message must contain the bare default AND the detail, so a
    // consumer rendering err.message sees both the cause class and the context.
    expect(detailed.message).toContain(bare.message);
    expect(detailed.message).toContain("loaded=99, max=2");
    expect(detailed.message).not.toBe(bare.message);
  });

  it("propagates cause via error.cause when provided", () => {
    const original = new Error("disk full");
    const err = new CodexMigrationError(
      "migration-failed",
      "v0.2 -> v0.3",
      original
    );
    expect(err.cause).toBe(original);
  });

  it("produces the bare reason-keyed default message with no detail/cause", () => {
    const err = new CodexMigrationError("post-condition-failed");
    expect(err.message.length).toBeGreaterThan(0);
    expect(err.cause).toBeUndefined();
    // Distinct reasons yield distinct default messages so a string-rendered
    // error is self-diagnosing without inspecting .reason.
    expect(err.message).not.toBe(
      new CodexMigrationError("migration-failed").message
    );
  });
});
