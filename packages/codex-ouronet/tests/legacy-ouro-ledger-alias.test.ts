/**
 * `IOuroAccount.kadenaLedger` → `stoaChainLedger` — the missing migration for
 * the one and only persisted-field rename `dd485a5` ("refactor!: rename
 * Kadena → StoaChain across the Codex (v0.2.0, breaking)") ever made.
 *
 * Measured on the owner's real export
 * (`Miscellaneous/_Codices/Foreign/Ionut_OuronetCodex_v1.0.0_2026-11-26T11-35-08-299Z.json`):
 *
 *     ouronetWallets[0].kadenaLedger    = "k:e20f2672…f231"
 *     ouronetWallets[0].stoaChainLedger = undefined
 *
 * `dd485a5` renamed the field in `types/entities.ts` and shipped no migration,
 * so every codex written before it stores the account's registered PAYMENT KEY
 * under a name nothing in the package reads any more (`grep -rn kadenaLedger
 * src/` → zero hits). It stayed hidden because `OuronetAccountsTab` overwrites
 * the field from the LIVE CHAIN read (`d["payment-key"] || account
 * .stoaChainLedger`, `ui/tabs/OuronetAccountsTab.tsx:115`); every surface that
 * reads STORED state instead — the eligibility wizard's `currentPaymentKeyOf`
 * — correctly but uselessly reports "no payment key on record".
 *
 * Two layers are pinned here, both driven by the SINGLE mapping rule in
 * `types/entities.ts` (`normalizeLegacyOuroAccounts`):
 *
 *   1. `applyMigrations`' shape-normalization pass (`state/migrations.ts`),
 *      which is deliberately NOT keyed to the integer `schemaVersion` axis:
 *      the owner's export carries no `schemaVersion` AT ALL, and a
 *      LocalStorage codex with no `codex_schema_version` key loads as `0` —
 *      neither value has a `fromVersion` in `SCHEMA_MIGRATIONS` (1→2, 2→3),
 *      so neither enters the version chain (pinned by
 *      `state-migrations.test.ts`'s "does NOT apply a 1->2 migration to a v0
 *      snapshot"). A fix keyed to a version would therefore never run on a
 *      single one of the affected codices.
 *   2. `LocalStorageCodexAdapter.loadAll`'s parse of `"ouronetWallets"`, with
 *      the same best-effort write-back `loadStoaChainSeedsWithMigration`
 *      already uses for the seed-type migration — so the codex is legible
 *      before/without any migration having run, and the correction sticks.
 *
 * Driven against an injected fake `Storage` (the seam
 * `adapter-shape-version-shard.test.ts` establishes), never `vi.mock`.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  LocalStorageCodexAdapter,
  emptySnapshot,
  type CodexSnapshot,
} from "@ancientpantheon/codex-ouronet/adapters";
import {
  CURRENT_SCHEMA_VERSION,
  SCHEMA_MIGRATIONS,
  applyMigrations,
} from "@ancientpantheon/codex-ouronet/state";
import type { IOuroAccount } from "../src/types/entities.js";
import { normalizeLegacyOuroAccounts } from "../src/types/entities.js";

/** The account's ACTUAL on-chain payment key, verbatim from the owner's
 *  export — `OriginalKoala`/`FormerKoala` key #0, carried WITH the `k:`
 *  sigil exactly as `store.ts` writes it for every non-stoic seed. Public
 *  key material only; no ciphertext from the real file is reproduced here. */
const OWNER_PAYMENT_KEY =
  "k:e20f267264634c5bc76e15dd5a9df6703fc3c06726e7674aa6217edeb064f231";

/**
 * The owner's `ouronetWallets[0]`, field-for-field and in the stored order:
 * `kadenaLedger` present between `guard` and `secret`, and NO
 * `stoaChainLedger` key at all. Ciphertext fields are placeholders (the real
 * blobs are the user's encrypted key material and never belong in the repo —
 * the shape is what this spec is about).
 */
const legacyStoredAccount = {
  id: "a9abb2ea-3e32-497b-88c4-80b94442e6aa",
  version: "1.0",
  name: "Prime Codex Seed",
  isSmart: false,
  address: "Ѻ.ÇñLŁ€pmœöĐWĂΓБñвíûζαβçŸ¢ETΛĆUтȚΛrFĆØĆξЪп1HěńÚяŹĂ7ζoãЦЩЭЯ₳îÀýJξÙу5юĘȘĂγ9",
  guard: { pred: "keys-any", keys: ["9H.ahG73Fj", "9H.vmpBzD22"] },
  kadenaLedger: OWNER_PAYMENT_KEY,
  secret: "ct-ouro-secret",
  backup: "ct-ouro-backup",
  publicKey: "9H.ahG73FjM5pHvmpBzD22dFmKKAhnnoh3eeMqlghxmfamGHGaH25ymeczx7Mi5Fqnlx",
  isActive: true,
} as const;

/** Map-backed `localStorage` stand-in that COUNTS writes per key, so a load
 *  of already-correct data can be proven not to churn the store. */
function makeFakeStorage(): Storage & { writes: Map<string, number> } {
  const map = new Map<string, string>();
  const writes = new Map<string, number>();
  return {
    writes,
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      writes.set(k, (writes.get(k) ?? 0) + 1);
      map.set(k, String(v));
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => {
      map.clear();
      writes.clear();
    },
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    get length() {
      return map.size;
    },
  } as unknown as Storage & { writes: Map<string, number> };
}

/** A snapshot built the way a FRESHLY IMPORTED codex arrives: the owner's
 *  legacy account, and NO `schemaVersion` field whatsoever (the v1.2/v1.3
 *  export envelope deliberately omits it — it is device-local). */
function importedSnapshotWithNoSchemaVersion(): CodexSnapshot {
  const snap = {
    ...emptySnapshot("dev"),
    ouroAccounts: [legacyStoredAccount as unknown as IOuroAccount],
  } as CodexSnapshot;
  delete (snap as Partial<CodexSnapshot>).schemaVersion;
  return snap;
}

describe("the kadenaLedger → stoaChainLedger mapping rule (types/entities.ts)", () => {
  it("adopts a legacy kadenaLedger as the account's stoaChainLedger", () => {
    // The defect itself, at the one place the rule lives: a stored account
    // whose payment key is only under the pre-dd485a5 name must come out
    // readable through the field every current reader uses.
    const { accounts, changed } = normalizeLegacyOuroAccounts([
      legacyStoredAccount as unknown as IOuroAccount,
    ]);
    expect(changed).toBe(true);
    expect(accounts[0]!.stoaChainLedger).toBe(OWNER_PAYMENT_KEY);
  });

  it("never destroys the legacy field's value (skip-not-drop)", () => {
    // If the rule ever `delete`s the old key, the only copy of a value this
    // package misread for months is gone and the decision is irreversible.
    const { accounts } = normalizeLegacyOuroAccounts([
      legacyStoredAccount as unknown as IOuroAccount,
    ]);
    expect(accounts[0]!.kadenaLedger).toBe(OWNER_PAYMENT_KEY);
  });

  it("lets a non-empty stoaChainLedger win when both names disagree", () => {
    // Tie-break: only pre-dd485a5 code could have written `kadenaLedger`, so
    // a present `stoaChainLedger` is strictly the NEWER writer (the live-chain
    // hydration in OuronetAccountsTab, or a payment-key rotation) and wins.
    const both = {
      ...legacyStoredAccount,
      stoaChainLedger: "k:" + "a".repeat(64),
    } as unknown as IOuroAccount;
    const { accounts, changed } = normalizeLegacyOuroAccounts([both]);
    expect(changed).toBe(false);
    expect(accounts[0]!.stoaChainLedger).toBe("k:" + "a".repeat(64));
    expect(accounts[0]!.kadenaLedger).toBe(OWNER_PAYMENT_KEY);
  });

  it("adopts the legacy value when stoaChainLedger is explicitly null", () => {
    // `null` is this type's "no payment key on record", which on a legacy
    // codex is indistinguishable from "never migrated" — and a stored legacy
    // key is strictly more informative than an empty field.
    const nulled = {
      ...legacyStoredAccount,
      stoaChainLedger: null,
    } as unknown as IOuroAccount;
    expect(normalizeLegacyOuroAccounts([nulled]).accounts[0]!.stoaChainLedger).toBe(
      OWNER_PAYMENT_KEY
    );
  });

  it("reports no change, and the same array, for an account with neither name", () => {
    // Guards against churn: a post-rename codex must not be rewritten on
    // every load, and `stoaChainLedger` must land on the type's `null`, not
    // `undefined` (the shape `seedDashboard.ts` documents crashing on).
    const clean = [
      { ...legacyStoredAccount, kadenaLedger: undefined, stoaChainLedger: null },
    ] as unknown as IOuroAccount[];
    const out = normalizeLegacyOuroAccounts(clean);
    expect(out.changed).toBe(false);
    expect(out.accounts).toBe(clean);
  });
});

describe("applyMigrations — shape normalization for a codex with no schemaVersion", () => {
  it("makes the owner's payment key legible on a snapshot carrying no schemaVersion", () => {
    // The exact import shape: no `schemaVersion` means the version chain is
    // never entered at all (`while (undefined < 3)` is false), so a
    // version-keyed fix would silently skip the codices that need it.
    const out = applyMigrations(
      importedSnapshotWithNoSchemaVersion(),
      SCHEMA_MIGRATIONS,
      CURRENT_SCHEMA_VERSION
    );
    expect(out.ouroAccounts[0]!.stoaChainLedger).toBe(OWNER_PAYMENT_KEY);
    expect(out.ouroAccounts[0]!.kadenaLedger).toBe(OWNER_PAYMENT_KEY);
  });

  it("makes it legible on a LocalStorage-shaped v0 codex (no codex_schema_version key)", () => {
    // `loadSchemaVersion()` returns 0 for an absent key, and there is no
    // `fromVersion: 0` migration — the documented chain gap. Same defect,
    // different entry value.
    const out = applyMigrations(
      { ...importedSnapshotWithNoSchemaVersion(), schemaVersion: 0 },
      SCHEMA_MIGRATIONS,
      CURRENT_SCHEMA_VERSION
    );
    expect(out.ouroAccounts[0]!.stoaChainLedger).toBe(OWNER_PAYMENT_KEY);
  });

  it("carries the fix through the real 1→2→3 version chain too", () => {
    // A codex that DOES enter the chain must come out both at version 3 and
    // with its payment key legible — the two layers must not be exclusive.
    const out = applyMigrations(
      { ...importedSnapshotWithNoSchemaVersion(), schemaVersion: 1 },
      SCHEMA_MIGRATIONS,
      CURRENT_SCHEMA_VERSION
    );
    expect(out.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(out.ouroAccounts[0]!.stoaChainLedger).toBe(OWNER_PAYMENT_KEY);
  });

  it("is idempotent — a second run changes nothing further", () => {
    const once = applyMigrations(
      importedSnapshotWithNoSchemaVersion(),
      SCHEMA_MIGRATIONS,
      CURRENT_SCHEMA_VERSION
    );
    const twice = applyMigrations(once, SCHEMA_MIGRATIONS, CURRENT_SCHEMA_VERSION);
    expect(twice).toEqual(once);
  });

  it("returns an already-correct snapshot BY REFERENCE at the target version", () => {
    // `store.init` persists only when `migrated.schemaVersion !==
    // preMigration.schemaVersion`, and `state-migrations.test.ts` pins the
    // no-op contract. Normalization must not manufacture a new object (and a
    // spurious write) for a codex with nothing to fix.
    const clean: CodexSnapshot = {
      ...emptySnapshot("dev"),
      schemaVersion: CURRENT_SCHEMA_VERSION,
    };
    expect(applyMigrations(clean, SCHEMA_MIGRATIONS, CURRENT_SCHEMA_VERSION)).toBe(
      clean
    );
  });
});

describe("LocalStorageCodexAdapter — legacy ouronetWallets ledger fallback", () => {
  let realLocalStorage: Storage | undefined;
  let fake: ReturnType<typeof makeFakeStorage>;

  beforeEach(() => {
    realLocalStorage = window.localStorage;
    fake = makeFakeStorage();
    Object.defineProperty(window, "localStorage", {
      value: fake,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "localStorage", {
      value: realLocalStorage,
      configurable: true,
      writable: true,
    });
  });

  /** The owner's codex as it sits in localStorage: the legacy account, and NO
   *  `codex_schema_version` key. */
  function seedOwnerLegacyCodex(): void {
    fake.setItem("ouronetWallets", JSON.stringify([legacyStoredAccount]));
    fake.writes.clear();
  }

  it("loads the owner's payment key through stoaChainLedger (nothing live-chain required)", async () => {
    // The headline regression: before this, `loadAll()` parsed
    // "ouronetWallets" straight into IOuroAccount with no field mapping, so
    // the payment key was invisible to every stored-state reader.
    seedOwnerLegacyCodex();
    const snap = await new LocalStorageCodexAdapter("dev").loadAll();
    expect(snap.ouroAccounts).toHaveLength(1);
    expect(snap.ouroAccounts[0]!.stoaChainLedger).toBe(OWNER_PAYMENT_KEY);
  });

  it("writes the correction back, so it survives the next reload", async () => {
    // Belt-only-in-memory would leave every other reader of raw localStorage
    // (and every consumer that skips the migration runner) still blind.
    seedOwnerLegacyCodex();
    await new LocalStorageCodexAdapter("dev").loadAll();
    const stored = JSON.parse(fake.getItem("ouronetWallets")!) as IOuroAccount[];
    expect(stored[0]!.stoaChainLedger).toBe(OWNER_PAYMENT_KEY);
    expect(stored[0]!.kadenaLedger).toBe(OWNER_PAYMENT_KEY);
  });

  it("does not rewrite ouronetWallets on a load with nothing to correct", async () => {
    // Idempotence at the storage layer: the second boot of a corrected codex
    // must not touch the store (the discipline
    // `loadStoaChainSeedsWithMigration` already follows).
    seedOwnerLegacyCodex();
    const adapter = new LocalStorageCodexAdapter("dev");
    await adapter.loadAll();
    expect(fake.writes.get("ouronetWallets")).toBe(1);
    await adapter.loadAll();
    expect(fake.writes.get("ouronetWallets")).toBe(1);
  });

  it("leaves a post-rename codex exactly as stored", async () => {
    // No collateral damage to the codices that are already fine.
    const current = {
      ...legacyStoredAccount,
      kadenaLedger: undefined,
      stoaChainLedger: "k:" + "b".repeat(64),
    };
    fake.setItem("ouronetWallets", JSON.stringify([current]));
    fake.writes.clear();
    const snap = await new LocalStorageCodexAdapter("dev").loadAll();
    expect(snap.ouroAccounts[0]!.stoaChainLedger).toBe("k:" + "b".repeat(64));
    expect(fake.writes.get("ouronetWallets")).toBeUndefined();
  });
});
