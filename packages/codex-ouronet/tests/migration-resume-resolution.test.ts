/**
 * Resolving a recorded migration back into a resumable wizard.
 *
 * The demote-versus-warn split is the subtle part: a decision that has
 * become MEANINGLESS must be re-made, while one that is merely less useful
 * must survive — discarding it would throw away a real choice over a
 * non-problem.
 */

import { describe, it, expect } from "vitest";
import { resolveMigrationResume } from "../src/ui/internal/migrationResume.js";
import type { MigrationProgress } from "@ancientpantheon/codex-core";

const K1 = "a".repeat(64);
const K2 = "b".repeat(64);

const entities = {
  accounts: [{ id: "ouro-1" }, { id: "ouro-7" }],
  seeds: [{ id: "seed-1", accounts: [{ publicKey: K1 }] }],
};

const run = (over: Partial<MigrationProgress> = {}): MigrationProgress => ({
  stage: "selection",
  startedAt: "2026-10-29T09:00:00.000Z",
  updatedAt: "2026-10-29T09:05:00.000Z",
  selection: {
    account: { kind: "existing", accountId: "ouro-7" },
    payment: { kind: "stoic-dalos-position-0" },
    guard: { kind: "recommended-single-key" },
  },
  ...over,
});

describe("a clean resume", () => {
  it("restores both decisions and re-opens on the payment step", () => {
    const p = resolveMigrationResume(run(), entities);
    expect(p.resumable).toBe(true);
    expect(p.step).toBe("payment");
    expect(p.accountChoice).toEqual({ kind: "existing", accountId: "ouro-7" });
    expect(p.paymentChoice).toEqual({ kind: "stoic-dalos-position-0" });
    expect(p.guardChoice).toEqual({ kind: "recommended-single-key" });
    expect(p.notices).toEqual([]);
  });

  it("reports when the run began, for the resumed banner", () => {
    expect(resolveMigrationResume(run(), entities).startedAt)
      .toBe("2026-10-29T09:00:00.000Z");
  });

  it("resumes a keep-current run", () => {
    const p = resolveMigrationResume(
      run({ selection: { account: { kind: "keep-current" }, payment: { kind: "keep" }, guard: { kind: "keep" } } }),
      entities,
    );
    expect(p.resumable).toBe(true);
    expect(p.accountChoice).toEqual({ kind: "keep-current" });
  });

  // The three guard-step-variants kinds (docs/work/guard-step-variants/
  // design.md) — a clean resume restores each exactly as recorded, same as
  // every other guard kind above.
  it.each([
    { kind: "update-keyset-recommended" as const },
    { kind: "update-keyset-custom" as const, keys: [K1], pred: "keys-all" },
    {
      kind: "use-existing-keyset" as const,
      ns: "ouronet-ns", ksn: "owner-made-keyset", keys: [K1], pred: "keys-2",
    },
  ])("restores guard choice %o unchanged", (guard) => {
    const p = resolveMigrationResume(
      run({ selection: { account: { kind: "keep-current" }, payment: { kind: "keep" }, guard } }),
      entities,
    );
    expect(p.resumable).toBe(true);
    expect(p.guardChoice).toEqual(guard);
  });
});

describe("DEMOTE — a choice that has become meaningless", () => {
  it("drops an existing-account choice whose account is gone, and says why", () => {
    const p = resolveMigrationResume(
      run({ selection: { account: { kind: "existing", accountId: "deleted-99" }, payment: { kind: "keep" }, guard: { kind: "keep" } } }),
      entities,
    );
    expect(p.resumable).toBe(true);
    expect(p.accountChoice).toBeNull();
    expect(p.notices.join(" ")).toMatch(/no longer in this codex/i);
  });

  it("re-opens on the ACCOUNT step when that decision was demoted", () => {
    // Re-opening on "payment" would hide the decision that now needs re-making.
    const p = resolveMigrationResume(
      run({ selection: { account: { kind: "existing", accountId: "gone" }, payment: { kind: "keep" }, guard: { kind: "keep" } } }),
      entities,
    );
    expect(p.step).toBe("account");
  });

  it("KEEPS the later decisions, so only what broke must be re-made", () => {
    const p = resolveMigrationResume(
      run({ selection: { account: { kind: "existing", accountId: "gone" }, payment: { kind: "stoic-dalos-position-0" }, guard: { kind: "recommended-single-key" } } }),
      entities,
    );
    expect(p.paymentChoice).toEqual({ kind: "stoic-dalos-position-0" });
    expect(p.guardChoice).toEqual({ kind: "recommended-single-key" });
  });
});

describe("WARN ONLY — a choice that is still valid but less useful", () => {
  it("keeps a custom keyset whose key the codex no longer holds, and warns", () => {
    // Still a perfectly good public key to guard with; it just cannot be
    // locked. Demoting it would discard a real decision over a non-problem.
    const p = resolveMigrationResume(
      run({ selection: {
        account: { kind: "keep-current" },
        payment: { kind: "keep" },
        guard: { kind: "custom", keys: [K1, K2], pred: "keys-2" },
      } }),
      entities,
    );
    expect(p.resumable).toBe(true);
    expect(p.guardChoice).toEqual({ kind: "custom", keys: [K1, K2], pred: "keys-2" });
    expect(p.notices.join(" ")).toMatch(/1 key\(s\).*no longer held/i);
    expect(p.notices.join(" ")).toMatch(/still work as guard keys/i);
  });

  it("says nothing when every custom key is still held", () => {
    const p = resolveMigrationResume(
      run({ selection: {
        account: { kind: "keep-current" },
        payment: { kind: "keep" },
        guard: { kind: "custom", keys: [K1], pred: "keys-all" },
      } }),
      entities,
    );
    expect(p.notices).toEqual([]);
  });

  // The same stale-key check extends to the two other kinds that carry an
  // explicit `keys` array — "update-keyset-custom" and "use-existing-keyset"
  // (docs/work/guard-step-variants/design.md). "update-keyset-recommended"
  // needs no such check, same as "recommended-single-key" gets none — it
  // names no codex-specific key list that could go stale.
  it("keeps an update-keyset-custom choice whose key the codex no longer holds, and warns", () => {
    const p = resolveMigrationResume(
      run({ selection: {
        account: { kind: "keep-current" },
        payment: { kind: "keep" },
        guard: { kind: "update-keyset-custom", keys: [K1, K2], pred: "keys-2" },
      } }),
      entities,
    );
    expect(p.resumable).toBe(true);
    expect(p.guardChoice).toEqual({ kind: "update-keyset-custom", keys: [K1, K2], pred: "keys-2" });
    expect(p.notices.join(" ")).toMatch(/1 key\(s\).*no longer held/i);
  });

  it("keeps a use-existing-keyset choice whose key the codex no longer holds, and warns", () => {
    const p = resolveMigrationResume(
      run({ selection: {
        account: { kind: "keep-current" },
        payment: { kind: "keep" },
        guard: {
          kind: "use-existing-keyset",
          ns: "ouronet-ns", ksn: "owner-made-keyset", keys: [K1, K2], pred: "keys-2",
        },
      } }),
      entities,
    );
    expect(p.resumable).toBe(true);
    expect(p.notices.join(" ")).toMatch(/1 key\(s\).*no longer held/i);
  });

  it("says nothing for update-keyset-recommended — it names no codex-specific key list", () => {
    const p = resolveMigrationResume(
      run({ selection: {
        account: { kind: "keep-current" },
        payment: { kind: "keep" },
        guard: { kind: "update-keyset-recommended" },
      } }),
      entities,
    );
    expect(p.notices).toEqual([]);
  });
});

describe("a renamed entity is NOT stale", () => {
  it("resumes fine when the seed was renamed — ids are what is recorded", () => {
    const renamed = { accounts: entities.accounts, seeds: [{ id: "seed-1", accounts: [{ publicKey: K1 }] }] };
    expect(resolveMigrationResume(run(), renamed).resumable).toBe(true);
  });
});

describe("what cannot be resumed", () => {
  it("refuses a new-words run and explains that the words were never saved", () => {
    const p = resolveMigrationResume(
      run({ selection: { account: { kind: "new-words" }, payment: { kind: "keep" }, guard: { kind: "keep" } } }),
      entities,
    );
    expect(p.resumable).toBe(false);
    expect(p.notices.join(" ")).toMatch(/never saved to your codex/i);
    expect(p.notices.join(" ")).toMatch(/entered again/i);
  });

  it("has nothing to resume with no row at all", () => {
    expect(resolveMigrationResume(undefined, entities).resumable).toBe(false);
    expect(resolveMigrationResume(null, entities).resumable).toBe(false);
  });

  it("has nothing to resume once the run is done", () => {
    expect(resolveMigrationResume(run({ stage: "done" }), entities).resumable).toBe(false);
  });

  it("has nothing to restore when a row exists but recorded no selection", () => {
    const p = resolveMigrationResume(run({ selection: undefined }), entities);
    expect(p.resumable).toBe(false);
    expect(p.startedAt).toBe("2026-10-29T09:00:00.000Z");
  });
});
