/**
 * Schema migration framework for the codex snapshot.
 *
 * Phase 1 (v0.3.0) ships the framework only: an empty registry plus the pure
 * `applyMigrations` runner and the `canConsumerWrite` boundary helper. The
 * real v0.2 -> v0.3 migration entry is added later — until then the runner is
 * a no-op for already-current codices.
 *
 * The runner is pure (no I/O, no side effects). Persistence + state wiring
 * lives in the store's `init()` / `migrateToCurrent()` actions, which call
 * this module and then save the result through the adapter.
 */

import type { CodexSnapshot } from "../adapters/types.js";
import { CodexMigrationError } from "../errors/index.js";
import {
  DEFAULT_UI_SETTINGS,
  normalizeLegacyOuroAccounts,
} from "../types/entities.js";
import type {
  IConsumerSettings,
  PatronSelectionMode,
  UiSettings,
} from "../types/entities.js";

export interface SchemaMigration {
  fromVersion: number;
  toVersion: number;
  description: string;
  /** Pure function — no I/O, no side effects. MUST set the output snapshot's
   *  `schemaVersion` to its own `toVersion` (the runner enforces this as a
   *  post-condition). */
  migrate: (snapshot: CodexSnapshot) => CodexSnapshot;
}

/** Current schema version this package writes. v0.3 writes 2; v0.5 writes 3
 *  (ZBOM settings + patron-enum reconcile). Bumped per migration. */
export const CURRENT_SCHEMA_VERSION = 3 as const;

/** Canonical UiSettings keys — sourced from DEFAULT_UI_SETTINGS so the
 *  whitelist stays in sync with the typed schema. Any key in a stored
 *  uiSettings that is NOT one of these is a consumer-specific "extra"
 *  (historically stashed by OuronetUI via the `[extra]` escape hatch) and is
 *  relocated into `consumerSettings["OuronetUI"]` by the v1->v2 migration. */
const CANONICAL_UI_SETTINGS_KEYS = new Set(Object.keys(DEFAULT_UI_SETTINGS));

/**
 * v0.2 (schemaVersion 1) -> v0.3 (schemaVersion 2). Pure.
 *   - Partitions `uiSettings` into canonical (kept) vs extras (relocated).
 *   - Seeds `consumerSettings` from the snapshot, then merges the OuronetUI
 *     slot (only when there are extras to move).
 *   - Strips relocated extras from `uiSettings` so data isn't duplicated.
 *   - Leaves `codexIdentity` unset (passive — interactive flow fills it later).
 *   - Sets `schemaVersion: 2` (the runner validates this post-condition).
 */
function migrateV1ToV2(snap: CodexSnapshot): CodexSnapshot {
  const canonical: Record<string, unknown> = {};
  const extras: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(snap.uiSettings ?? {})) {
    if (CANONICAL_UI_SETTINGS_KEYS.has(k)) canonical[k] = v;
    else extras[k] = v;
  }

  const consumerSettings: Record<string, IConsumerSettings> = {
    ...(snap.consumerSettings ?? {}),
  };
  if (Object.keys(extras).length > 0) {
    consumerSettings["OuronetUI"] = {
      consumerName: "OuronetUI",
      consumerVersion: "unknown",
      schemaVersion: 1,
      settings: extras,
      lastUpdatedAt: new Date().toISOString(),
    };
  }

  return {
    ...snap,
    uiSettings: canonical as UiSettings,
    consumerSettings,
    codexIdentity: undefined,
    schemaVersion: 2,
  };
}

/** Maps a stored `patronSelectionMode` onto the v0.5.0 vocabulary
 *  (`wealthiest | prime | resident`). The package shipped 0.4.0 with
 *  `wealthiest | active-wallet | manual`; OuronetUI persists
 *  `wealthiest | prime | resident`. Legacy package values are remapped
 *  (`active-wallet`->`prime`, `manual`->`resident`); already-current values
 *  pass through; anything unrecognized falls back to the default. */
function reconcilePatronMode(raw: unknown): PatronSelectionMode {
  switch (raw) {
    case "active-wallet":
      return "prime";
    case "manual":
      return "resident";
    case "wealthiest":
    case "prime":
    case "resident":
      return raw;
    default:
      return DEFAULT_UI_SETTINGS.patronSelectionMode;
  }
}

/** ZBOM uiSettings keys introduced in v0.5.0. Seeded from DEFAULT_UI_SETTINGS
 *  when absent on a codex persisted before the schema bump. */
const ZBOM_SETTING_KEYS = [
  "zbomProfile",
  "zbomZone0",
  "zbomZone1",
  "zbomZone2",
  "zbomZone3",
  "zbomExecutePosition",
] as const;

/**
 * v0.3 (schemaVersion 2) -> v0.5 (schemaVersion 3). Pure.
 *   - Reconciles `patronSelectionMode` onto the v0.5.0 vocabulary (D2):
 *     `active-wallet`->`prime`, `manual`->`resident`.
 *   - Seeds the new ZBOM settings (`zbomProfile`, `zbomZone0..3`,
 *     `zbomExecutePosition`) from DEFAULT_UI_SETTINGS when absent, so a
 *     persisted 0.4.0 codex gets the basic profile (D5).
 *   - Leaves every other field untouched.
 *   - Sets `schemaVersion: 3` (the runner validates this post-condition).
 */
function migrateV2ToV3(snap: CodexSnapshot): CodexSnapshot {
  const prev = (snap.uiSettings ?? {}) as Record<string, unknown>;
  const next: Record<string, unknown> = { ...prev };

  next.patronSelectionMode = reconcilePatronMode(prev.patronSelectionMode);

  for (const key of ZBOM_SETTING_KEYS) {
    if (prev[key] === undefined) {
      next[key] = DEFAULT_UI_SETTINGS[key];
    }
  }

  return {
    ...snap,
    uiSettings: next as UiSettings,
    schemaVersion: 3,
  };
}

/** Registry of all schema migrations, applied in chain order on load when the
 *  stored codex is older than CURRENT_SCHEMA_VERSION. Never delete past
 *  entries — old codices still need them. */
export const SCHEMA_MIGRATIONS: SchemaMigration[] = [
  {
    fromVersion: 1,
    toVersion: 2,
    description:
      "v0.2 -> v0.3: seed consumerSettings, relocate OuronetUI uiSettings extras into consumerSettings['OuronetUI'], leave codexIdentity unset",
    migrate: migrateV1ToV2,
  },
  {
    fromVersion: 2,
    toVersion: 3,
    description:
      "v0.3 -> v0.5: reconcile patronSelectionMode onto wealthiest|prime|resident, seed ZBOM settings defaults",
    migrate: migrateV2ToV3,
  },
];

/**
 * A VERSION-INDEPENDENT shape correction, applied by {@link applyMigrations}
 * on entry — before (and regardless of) the integer `schemaVersion` chain.
 *
 * WHY this exists alongside {@link SCHEMA_MIGRATIONS} rather than as another
 * entry in it: the integer chain can only reach a codex whose stored
 * `schemaVersion` is the `fromVersion` of a registered migration, and the
 * codices that carry legacy field names do not qualify. Measured, not
 * assumed:
 *   - The v1.2/v1.3 export envelope carries NO `schemaVersion` at all (it is
 *     device-local by design — `@ouronet/ouronet-core/codex`'s
 *     `CodexExportV1_2`/`V1_3`). An imported snapshot therefore enters the
 *     runner with `schemaVersion: undefined`, where `undefined === target` is
 *     false, `undefined > target` is false, and `while (undefined < target)`
 *     is ALSO false — the chain is skipped silently, with no error.
 *   - A LocalStorage codex with no `codex_schema_version` key loads as `0`
 *     (`LocalStorageCodexAdapter.loadSchemaVersion`), and `SCHEMA_MIGRATIONS`
 *     starts at `fromVersion: 1` — a chain gap the runner `break`s out of.
 *     `state-migrations.test.ts` pins that v0 skip as deliberate: `0` also
 *     means "nothing persisted yet" (`emptySnapshot`), so pulling it into the
 *     chain would run the v1→v2 uiSettings relocation over every fresh codex
 *     and every legacy one, which is a different change than fixing a field
 *     name.
 * A fix keyed to a version would thus never run on a single affected codex.
 * Keying it to nothing instead is both correct and honest: a field name is a
 * property of the data's AGE, which `schemaVersion` on these codices simply
 * does not record.
 *
 * Contract: `normalize` MUST be pure, MUST be idempotent, and MUST return the
 * INPUT SNAPSHOT BY REFERENCE when it changes nothing — `store.init` persists
 * only when the version moved, and the runner's documented "returns the
 * snapshot unchanged at target" no-op depends on reference identity surviving
 * this pass.
 */
export interface SnapshotShapeNormalizer {
  description: string;
  normalize: (snapshot: CodexSnapshot) => CodexSnapshot;
}

/**
 * `IOuroAccount.kadenaLedger` → `stoaChainLedger`, the missing half of
 * `dd485a5` ("refactor!: rename Kadena → StoaChain across the Codex (v0.2.0,
 * breaking)"): it renamed the account's REGISTERED PAYMENT KEY field and
 * shipped no migration, so on every codex written before it the payment key
 * is stored under a name nothing in the package reads.
 *
 * The mapping rule itself (including the both-present tie-break) lives in
 * `types/entities.ts`'s `resolveOuroAccountLedger` — defined once, shared
 * with `LocalStorageCodexAdapter`'s read-time fallback. The legacy field is
 * never cleared.
 */
const legacyOuroLedgerNormalizer: SnapshotShapeNormalizer = {
  description:
    "IOuroAccount.kadenaLedger -> stoaChainLedger (dd485a5 rename, no schemaVersion required)",
  normalize: (snap) => {
    const { accounts, changed } = normalizeLegacyOuroAccounts(
      snap.ouroAccounts ?? []
    );
    return changed ? { ...snap, ouroAccounts: accounts } : snap;
  },
};

/** Registry of version-independent shape normalizations. Append-only, same
 *  as {@link SCHEMA_MIGRATIONS}: a legacy name that is still present in some
 *  user's data must keep being understood forever. */
export const SNAPSHOT_SHAPE_NORMALIZERS: SnapshotShapeNormalizer[] = [
  legacyOuroLedgerNormalizer,
];

/** Applies every {@link SnapshotShapeNormalizer} in order. Pure; returns
 *  `snapshot` by reference when no normalizer changed anything. */
export function normalizeSnapshotShape(
  snapshot: CodexSnapshot,
  normalizers: SnapshotShapeNormalizer[] = SNAPSHOT_SHAPE_NORMALIZERS
): CodexSnapshot {
  return normalizers.reduce((current, n) => n.normalize(current), snapshot);
}

/** Returns true if this package version can safely WRITE a codex loaded at the
 *  given schema version. False when the loaded codex is at a NEWER schema —
 *  writing could silently drop fields this package doesn't understand. */
export function canConsumerWrite(loadedSchemaVersion: number): boolean {
  return loadedSchemaVersion <= CURRENT_SCHEMA_VERSION;
}

/**
 * Pure migration runner. Upgrades `snapshot` toward `targetVersion` by walking
 * the migration chain with a rolling cursor.
 *
 * Semantics:
 *   - ALWAYS applies {@link normalizeSnapshotShape} first — the
 *     version-independent shape corrections (legacy field names), which must
 *     run even for the snapshots that skip the chain below. Reference
 *     identity is preserved when it corrects nothing, so every no-op case
 *     listed here still returns the caller's own object.
 *   - If `snapshot.schemaVersion === targetVersion`: returns it unchanged.
 *   - If `snapshot.schemaVersion > targetVersion`: throws
 *     `unknown-schema-version` (this consumer is too old to read the codex).
 *   - Otherwise walks migrations whose `fromVersion === current` (strict, NOT
 *     `>=`), advancing `current = toVersion` after each step, until it reaches
 *     `targetVersion` or finds no applicable next migration (a chain gap — the
 *     snapshot is returned at the highest version reached).
 *
 * Validates the supplied registry on entry: a reversed entry
 * (`fromVersion >= toVersion`) or a duplicate `fromVersion` throws
 * `post-condition-failed`. A migration that throws is wrapped in
 * `migration-failed` (cause = original). A migration whose output schemaVersion
 * doesn't equal its declared `toVersion` throws `post-condition-failed`.
 */
export function applyMigrations(
  snapshot: CodexSnapshot,
  migrations: SchemaMigration[],
  targetVersion: number
): CodexSnapshot {
  // Version-INDEPENDENT shape normalization runs first, on every path through
  // this function — including the two paths that skip the chain entirely (a
  // snapshot already at `targetVersion`, and one whose `schemaVersion` has no
  // registered `fromVersion`: `undefined` from an import, `0` from a
  // never-stamped LocalStorage codex). See SnapshotShapeNormalizer for why
  // these corrections cannot live on the integer axis. Returns `snapshot` by
  // reference when there is nothing to correct, so the no-op contracts below
  // are preserved exactly.
  const normalized = normalizeSnapshotShape(snapshot);

  if (normalized.schemaVersion === targetVersion) {
    return normalized;
  }
  if (normalized.schemaVersion > targetVersion) {
    throw new CodexMigrationError(
      "unknown-schema-version",
      `loaded=${normalized.schemaVersion}, max=${targetVersion}`
    );
  }

  validateRegistry(migrations);

  const sorted = [...migrations].sort((a, b) => a.fromVersion - b.fromVersion);

  let result = normalized;
  let current = normalized.schemaVersion;

  while (current < targetVersion) {
    const next = sorted.find((m) => m.fromVersion === current);
    if (!next) {
      // Chain gap: no migration starts at the current version. Leave the
      // snapshot at the highest version reached; the caller decides whether
      // that is acceptable for its target.
      break;
    }

    let migrated: CodexSnapshot;
    try {
      migrated = next.migrate(result);
    } catch (cause) {
      throw new CodexMigrationError(
        "migration-failed",
        next.description,
        cause
      );
    }

    if (migrated.schemaVersion !== next.toVersion) {
      throw new CodexMigrationError(
        "post-condition-failed",
        `migration "${next.description}" expected schemaVersion=${next.toVersion}, got ${migrated.schemaVersion}`
      );
    }

    result = migrated;
    current = next.toVersion;
  }

  return result;
}

function validateRegistry(migrations: SchemaMigration[]): void {
  const seenFrom = new Set<number>();
  for (const m of migrations) {
    if (m.fromVersion >= m.toVersion) {
      throw new CodexMigrationError(
        "post-condition-failed",
        `malformed migration "${m.description}": fromVersion=${m.fromVersion} must be < toVersion=${m.toVersion}`
      );
    }
    if (seenFrom.has(m.fromVersion)) {
      throw new CodexMigrationError(
        "post-condition-failed",
        `duplicate migration fromVersion=${m.fromVersion}`
      );
    }
    seenFrom.add(m.fromVersion);
  }
}
