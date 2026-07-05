/**
 * IConsumerSettings type + CodexConsumerSettingsError shape tests.
 *
 * Pins the contract Phase 2's store actions (T2.3) depend on: the canonical
 * IConsumerSettings shape (a registry entry namespaced by consumerName) and
 * the CodexConsumerSettingsError shape — three discriminating reason codes,
 * the CodexError prototype chain, an optional detail appended to the
 * reason-keyed default message, and an optional cause forwarded to
 * Error.cause.
 */

import { describe, it, expect } from "vitest";
import {
  CodexConsumerSettingsError,
  CodexError,
} from "@ancientpantheon/codex-ouronet/errors";
import type { IConsumerSettings } from "@ancientpantheon/codex-ouronet/types";

describe("IConsumerSettings type", () => {
  it("admits a fully-populated registry entry with the 5 canonical fields", () => {
    // Type-compile assertion via direct construction: if any field is missing
    // or mis-typed the test file fails to compile (vitest runs through tsc).
    const x: IConsumerSettings = {
      consumerName: "OuronetUI",
      consumerVersion: "1.0.0",
      schemaVersion: 1,
      settings: { foo: "bar" },
      lastUpdatedAt: "2026-05-29T00:00:00Z",
    };
    // Runtime sanity so the assertion isn't compile-only: the escape-hatch
    // payload round-trips arbitrary consumer-defined keys verbatim.
    expect(x.consumerName).toBe("OuronetUI");
    expect(x.settings.foo).toBe("bar");
    expect(x.schemaVersion).toBe(1);
  });
});

describe("CodexConsumerSettingsError", () => {
  const reasons = [
    "invalid-consumer-name",
    "schema-downgrade",
    "missing-entry",
  ] as const;

  it("surfaces each of the 3 reasons as error.reason", () => {
    for (const reason of reasons) {
      const err = new CodexConsumerSettingsError(reason);
      expect(err.reason).toBe(reason);
    }
  });

  it("is a CodexError and an Error with name CodexConsumerSettingsError", () => {
    const err = new CodexConsumerSettingsError("invalid-consumer-name");
    expect(err.name).toBe("CodexConsumerSettingsError");
    expect(err instanceof CodexConsumerSettingsError).toBe(true);
    expect(err instanceof CodexError).toBe(true);
    expect(err instanceof Error).toBe(true);
  });

  it("appends detail to the reason-keyed default message when provided", () => {
    const bare = new CodexConsumerSettingsError("schema-downgrade");
    const detailed = new CodexConsumerSettingsError(
      "schema-downgrade",
      "existing=5, attempted=4"
    );
    // A consumer rendering err.message must see both the cause class default
    // AND the context detail, so the downgrade is diagnosable from the string.
    expect(detailed.message).toContain(bare.message);
    expect(detailed.message).toContain("existing=5, attempted=4");
    expect(detailed.message).not.toBe(bare.message);
  });

  it("produces a clean bare default message with no detail and no cause", () => {
    const err = new CodexConsumerSettingsError("missing-entry");
    expect(err.message.length).toBeGreaterThan(0);
    expect(err.cause).toBeUndefined();
    // Distinct reasons yield distinct default messages so a string-rendered
    // error is self-diagnosing without inspecting .reason.
    expect(err.message).not.toBe(
      new CodexConsumerSettingsError("invalid-consumer-name").message
    );
  });

  it("propagates cause via error.cause when provided", () => {
    const original = new Error("underlying failure");
    const err = new CodexConsumerSettingsError(
      "invalid-consumer-name",
      'consumerName="../evil"',
      original
    );
    expect(err.cause).toBe(original);
  });
});
