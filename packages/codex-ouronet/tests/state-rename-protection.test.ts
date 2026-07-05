/**
 * Phase 6 (REQ-06) — rename protection for protected pure keypairs.
 *
 * `renamePureKeypair(id, newLabel)` is a NEW action. It rejects renames on
 * keys carrying `isCodexGuard`, `wasCodexGuard`, or `isDuoPurePrime` EXCEPT
 * when `newLabel` matches the controlled retirement-suffix pattern
 * `/ \(retired #\d+\)$/` (consumed by Phase 8's `rotateCodexGuard`).
 * Regular keys rename freely; a missing id is a silent no-op. The
 * `RETIREMENT_SUFFIX_REGEX` constant is exported for Phase 8 reuse.
 */

import { describe, it, expect } from "vitest";
import { createCodexStore } from "@ancientpantheon/codex-ouronet/state";
import { RETIREMENT_SUFFIX_REGEX } from "@ancientpantheon/codex-ouronet/state";
import {
  MemoryCodexAdapter,
  emptySnapshot,
} from "@ancientpantheon/codex-ouronet/adapters";
import type { CodexAdapter, CodexSnapshot } from "@ancientpantheon/codex-ouronet/adapters";
import { CodexGuardError } from "@ancientpantheon/codex-ouronet/errors";
import type { IPureKeypair } from "@ancientpantheon/codex-ouronet/types";

const pure = (
  id: string,
  overrides: Partial<IPureKeypair> = {}
): IPureKeypair => ({
  id,
  label: "Pure",
  publicKey: "f".repeat(64),
  encryptedPrivateKey: "enc-pk",
  createdAt: "2026-05-24T10:01:00.000Z",
  ...overrides,
});

const baseSnapshot = (overrides: Partial<CodexSnapshot> = {}): CodexSnapshot => ({
  ...emptySnapshot("dev"),
  schemaVersion: 1,
  ...overrides,
});

async function storeWith(snap: CodexSnapshot) {
  const adapter: CodexAdapter = new MemoryCodexAdapter("dev");
  await adapter.saveAll(snap);
  const store = createCodexStore();
  await store.getState().actions.init(adapter, "dev");
  return store;
}

const labelOf = (store: Awaited<ReturnType<typeof storeWith>>, id: string) =>
  store.getState().pureKeypairs.find((k) => k.id === id)?.label;

describe("RETIREMENT_SUFFIX_REGEX export", () => {
  it("matches a trailing ' (retired #N)' suffix", () => {
    expect(RETIREMENT_SUFFIX_REGEX.test("foo (retired #1)")).toBe(true);
    expect(RETIREMENT_SUFFIX_REGEX.test("CodexGuard (retired #42)")).toBe(true);
  });

  it("does NOT match labels without the exact suffix shape", () => {
    expect(RETIREMENT_SUFFIX_REGEX.test("(retired #1)")).toBe(false);
    expect(RETIREMENT_SUFFIX_REGEX.test("retired #1")).toBe(false);
    expect(RETIREMENT_SUFFIX_REGEX.test("foo (retired #1) extra")).toBe(false);
    expect(RETIREMENT_SUFFIX_REGEX.test("foo (retired #abc)")).toBe(false);
  });
});

describe("renamePureKeypair — Phase 6 protection", () => {
  describe("rejects non-suffix renames on protected keys", () => {
    it("REJECTS when target has isCodexGuard: true", async () => {
      const store = await storeWith(
        baseSnapshot({
          pureKeypairs: [pure("kg", { label: "CodexGuard", isCodexGuard: true })],
        })
      );
      await expect(
        store.getState().actions.renamePureKeypair("kg", "My New Name")
      ).rejects.toMatchObject({
        name: "CodexGuardError",
        reason: "rename-rejected",
      });
      // Label must be unchanged after a rejected rename.
      expect(labelOf(store, "kg")).toBe("CodexGuard");
    });

    it("detail names id, label, flag, and the rejected newLabel", async () => {
      const store = await storeWith(
        baseSnapshot({
          pureKeypairs: [pure("kg", { label: "CodexGuard", isCodexGuard: true })],
        })
      );
      await expect(
        store.getState().actions.renamePureKeypair("kg", "My New Name")
      ).rejects.toThrow(
        /id=kg.*label=CodexGuard.*flag=isCodexGuard.*newLabel=My New Name/
      );
    });

    it("REJECTS when target has wasCodexGuard: true", async () => {
      const store = await storeWith(
        baseSnapshot({
          pureKeypairs: [pure("retired", { wasCodexGuard: true })],
        })
      );
      await expect(
        store.getState().actions.renamePureKeypair("retired", "Renamed")
      ).rejects.toThrow(/flag=wasCodexGuard/);
    });

    it("REJECTS when target has isDuoPurePrime: true (role=payment)", async () => {
      const store = await storeWith(
        baseSnapshot({
          pureKeypairs: [
            pure("dpp", { isDuoPurePrime: true, duoPurePrimeRole: "payment" }),
          ],
        })
      );
      await expect(
        store.getState().actions.renamePureKeypair("dpp", "Renamed")
      ).rejects.toThrow(/flag=isDuoPurePrime/);
    });

    it("REJECTS when target has isDuoPurePrime: true (role=guard)", async () => {
      const store = await storeWith(
        baseSnapshot({
          pureKeypairs: [
            pure("dpp", { isDuoPurePrime: true, duoPurePrimeRole: "guard" }),
          ],
        })
      );
      await expect(
        store.getState().actions.renamePureKeypair("dpp", "Renamed")
      ).rejects.toThrow(/flag=isDuoPurePrime/);
    });
  });

  describe("retirement-suffix bypasses protection", () => {
    it("ALLOWS rename to '<x> (retired #N)' on an isCodexGuard key", async () => {
      const store = await storeWith(
        baseSnapshot({
          pureKeypairs: [pure("kg", { label: "CodexGuard", isCodexGuard: true })],
        })
      );
      await store
        .getState()
        .actions.renamePureKeypair("kg", "CodexGuard (retired #1)");
      expect(labelOf(store, "kg")).toBe("CodexGuard (retired #1)");
    });

    it("ALLOWS retirement-suffix rename on a wasCodexGuard key", async () => {
      const store = await storeWith(
        baseSnapshot({
          pureKeypairs: [pure("was", { label: "Old", wasCodexGuard: true })],
        })
      );
      await store
        .getState()
        .actions.renamePureKeypair("was", "Old (retired #2)");
      expect(labelOf(store, "was")).toBe("Old (retired #2)");
    });

    it("ALLOWS retirement-suffix rename on an isDuoPurePrime key", async () => {
      // Symmetric bypass: not exercised by Phase 8 rotation, but the regex
      // policy allows it regardless of which protection flag is set.
      const store = await storeWith(
        baseSnapshot({
          pureKeypairs: [
            pure("dpp", {
              label: "Duo",
              isDuoPurePrime: true,
              duoPurePrimeRole: "guard",
            }),
          ],
        })
      );
      await store
        .getState()
        .actions.renamePureKeypair("dpp", "Duo (retired #3)");
      expect(labelOf(store, "dpp")).toBe("Duo (retired #3)");
    });
  });

  describe("regex precision against an isCodexGuard fixture", () => {
    const cases: Array<[string, boolean]> = [
      ["My Key (retired #1)", true],
      ["(retired #1)", false],
      ["retired #1", false],
      ["My Key (retired #1) extra", false],
      ["My Key (retired #abc)", false],
    ];
    for (const [newLabel, allowed] of cases) {
      it(`${allowed ? "ALLOWS" : "REJECTS"} newLabel="${newLabel}"`, async () => {
        const store = await storeWith(
          baseSnapshot({
            pureKeypairs: [pure("kg", { label: "Guard", isCodexGuard: true })],
          })
        );
        const op = store.getState().actions.renamePureKeypair("kg", newLabel);
        if (allowed) {
          await op;
          expect(labelOf(store, "kg")).toBe(newLabel);
        } else {
          await expect(op).rejects.toBeInstanceOf(CodexGuardError);
          expect(labelOf(store, "kg")).toBe("Guard");
        }
      });
    }
  });

  describe("regular keys rename freely", () => {
    it("ALLOWS any newLabel on a key with no protective flags", async () => {
      const store = await storeWith(
        baseSnapshot({ pureKeypairs: [pure("reg", { label: "Regular Key" })] })
      );
      await store.getState().actions.renamePureKeypair("reg", "Anything I Want");
      expect(labelOf(store, "reg")).toBe("Anything I Want");
    });

    it("ALLOWS a retirement-suffix newLabel on an unprotected key", async () => {
      const store = await storeWith(
        baseSnapshot({ pureKeypairs: [pure("reg", { label: "Regular Key" })] })
      );
      await store
        .getState()
        .actions.renamePureKeypair("reg", "Regular Key (retired #1)");
      expect(labelOf(store, "reg")).toBe("Regular Key (retired #1)");
    });
  });

  describe("missing-id behavior", () => {
    it("is a silent no-op and does not mutate state", async () => {
      const store = await storeWith(
        baseSnapshot({ pureKeypairs: [pure("keep")] })
      );
      await expect(
        store.getState().actions.renamePureKeypair("non-existent-id", "whatever")
      ).resolves.toBeUndefined();
      expect(store.getState().pureKeypairs).toHaveLength(1);
      expect(
        store.getState().pureKeypairs.some((k) => k.label === "whatever")
      ).toBe(false);
    });
  });
});
