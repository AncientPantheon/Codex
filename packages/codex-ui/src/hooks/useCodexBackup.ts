/**
 * useCodexBackup — codex backup / restore / cloud-export helpers.
 *
 * Four operations:
 *   - downloadAsJson()              browser file download via Blob + <a>.click
 *   - importFromFile(File)          reads + parses + applies to adapter
 *   - exportForCloud()              returns the JSON string (for /google-drive)
 *   - importFromCloud(string)       applies a cloud-fetched JSON string
 *
 * On-disk format: the canonical codex codec (`buildCodexExport` /
 * `deserializeCodex` from @ancientpantheon/codex-core) emitting a `"1.3"`
 * envelope. The export rides BOTH keyrings: `foreignKeys` as a
 * `{ schemaVersion, keys }` BLOCK (funds-critical — the Arweave key travels
 * inside the encrypted backup) and `pureKeypairs` as a BARE ARRAY (the codec
 * allow-lists it since the D2 revisit). No secret ever leaves plaintext: each
 * entry's `secret` / `encryptedKeyfile` / `encryptedPrivateKey` is a
 * pre-encrypted ciphertext blob the codec wraps but never touches.
 *
 * READER-BEFORE-WRITER (funds-loss-critical): the restore path accepts BOTH the
 * OLD augmented-`"1.2"` backups (which OuronetUI wrote before this rewire — they
 * restore FOREVER, with `foreignKeys` naturally absent) AND the new `"1.3"`
 * shape. Emitting a version the reader rejects (or narrowing the reader to
 * `"1.3"`-only) would make a user's own fresh backup unrestorable — never do it.
 *
 * Browser dependency: downloadAsJson uses window.URL.createObjectURL +
 * document.createElement + <a>.click. SSR consumers should call
 * exportForCloud (which returns the string) instead.
 */

import { useCallback } from "react";
import { useCodexStore } from "../provider/index.js";
import {
  buildCodexExport,
  deserializeCodex,
  type ForeignKeyEntry,
} from "@ancientpantheon/codex-core";
import type { CodexSnapshot } from "@ancientpantheon/codex-ouronet/types";
import { CodexImportError } from "./errors.js";

/** The `foreignKeys` block shape on the wire — a `{ schemaVersion, keys }`
 *  object, NOT a bare array (unlike `pureKeypairs`). The reader unwraps
 *  `.keys` back to the bare `ForeignKeyEntry[]` the store/adapter expect. */
interface ForeignKeysWireBlock {
  schemaVersion: number;
  keys: ForeignKeyEntry[];
}

/** The subset of the `"1.2"`/`"1.3"` codec envelope this hook reads back into a
 *  CodexSnapshot. `deserializeCodex` has already validated the shape + version;
 *  this only narrows the fields the restore path consumes. */
interface ParsedBackup {
  version: "1.2" | "1.3";
  kadenaWallets: CodexSnapshot["kadenaSeeds"];
  ouronetWallets: CodexSnapshot["ouroAccounts"];
  addressBook: CodexSnapshot["addressBook"];
  uiSettings: CodexSnapshot["uiSettings"];
  /** Bare array on the wire (absent on pre-v1.0.9 backups). */
  pureKeypairs?: CodexSnapshot["pureKeypairs"];
  /** `{ schemaVersion, keys }` BLOCK on the wire (absent on "1.2" backups). */
  foreignKeys?: ForeignKeysWireBlock;
  /** Bare array on the wire (absent on any backup written before Arweave
   *  seeds existed). FUNDS-CRITICAL: see `importFromCloud`'s
   *  `current.arweaveSeeds` fallback — an absent field must NOT wipe a live
   *  Prime Arweave Seed on restore. */
  arweaveSeeds?: CodexSnapshot["arweaveSeeds"];
  /** Bare array on the wire (absent on any backup written before the watch
   *  list existed in the codec). See `importFromCloud`'s `current.watchList`
   *  fallback — an absent field must NOT wipe a live watched address on
   *  restore (the reported codex-save-vanishes incident). */
  watchList?: CodexSnapshot["watchList"];
  /** The per-codex shape stamp (`codex-shape-version-stamp`), absent on
   *  legacy/pre-stamp backups. The codec already allow-lists and carries
   *  it; this interface simply never declared it, so the restore path
   *  below had nothing to read — see that assignment's own note. */
  Codex_Shape_Version?: CodexSnapshot["Codex_Shape_Version"];
  /** Master-key locks. Absent on any backup written before locks existed. */
  masterKeyLocks?: CodexSnapshot["masterKeyLocks"];
  /** The Codex Master Seed row. Absent on any backup written before it. */
  codexMasterSeed?: CodexSnapshot["codexMasterSeed"];
  /** An unfinished migration. Absent on any backup written before it. */
  migrationProgress?: CodexSnapshot["migrationProgress"];
}

export interface CodexBackupView {
  downloadAsJson: (filename?: string) => Promise<void>;
  importFromFile: (file: File) => Promise<void>;
  exportForCloud: () => Promise<string>;
  importFromCloud: (json: string) => Promise<void>;
  isDirty: boolean;
  clearDirty: () => void;
}

/**
 * Build the `"1.3"` codec envelope from a snapshot. Threads BOTH keyrings onto
 * the PlaintextCodex-shaped source `buildCodexExport` reads: `foreignKeys` as a
 * bare array (the codec wraps it into a `{ schemaVersion, keys }` block on emit)
 * `pureKeypairs` as a bare array (the codec carries it through unchanged), and
 * `arweaveSeeds` as a bare array (same pass-through discipline as
 * `pureKeypairs`). Omitting any of these wires here would silently drop the
 * corresponding keyring from the backup — a funds-loss bug for `foreignKeys`
 * and `arweaveSeeds` (the reported Prime-Arweave-Seed-vanishes incident this
 * fixes).
 */
function buildBackupPayload(snapshot: CodexSnapshot): unknown {
  return buildCodexExport({
    kadenaWallets: snapshot.kadenaSeeds,
    ouronetWallets: snapshot.ouroAccounts,
    addressBook: snapshot.addressBook,
    pureKeypairs: snapshot.pureKeypairs,
    uiSettings: snapshot.uiSettings,
    schemaVersion: snapshot.schemaVersion,
    lastUpdatedAt: snapshot.lastUpdatedAt,
    lastUpdatedDevice: snapshot.lastUpdatedDevice,
    foreignKeys: snapshot.foreignKeys,
    arweaveSeeds: snapshot.arweaveSeeds,
    watchList: snapshot.watchList,
    // Carries the per-codex shape stamp (codex-shape-version-stamp, T6) onto
    // the export — `buildCodexExport` omits the key entirely when it is
    // `undefined` (same omit-when-absent discipline as every other optional
    // field here), so a legacy/imported codex lacking the field still
    // exports without the key, never a fabricated value.
    Codex_Shape_Version: snapshot.Codex_Shape_Version,
    masterKeyLocks: snapshot.masterKeyLocks,
    codexMasterSeed: snapshot.codexMasterSeed,
    migrationProgress: snapshot.migrationProgress,
  });
}

/**
 * `downloadAsJson`'s default-filename template — encodes the live codex's
 * own `Codex_Shape_Version` (codex-shape-version-stamp, T6) so a user with
 * several exports sitting in a Downloads folder can tell which shape each
 * one is in without opening the file. `shapeVersion` must be read off the
 * already-built snapshot/export payload, never re-parsed from the JSON
 * string. Exported as its own pure function because no real post-T1 export
 * can ever have an `undefined` Codex_Shape_Version end-to-end (every live
 * codex is at least stamped "1.0.0") — this is the only way to directly
 * unit-test the "unversioned" branch.
 *
 * `codex-id-step-flow` (owner, this session): once BOTH Step 1 (versioned)
 * AND Step 2 (Permaweb-eligible) are checked, the codex "finally has the
 * proper shape going forward" — the Permaweb Eligibility wizard's own
 * Finalize step stamps this as `primeAlignment: "aligned"`. Reflected here
 * as a `_permaweb-eligible` filename marker so it's visible without opening
 * the file, mirroring the shape-version marker's own reasoning exactly.
 * Omitted (not a fabricated `"legacy"` suffix) when `primeAlignment` is
 * `"legacy"` or not supplied at all — same omit-when-absent discipline the
 * shape version itself follows for a pre-T1 export.
 */
export function buildDefaultBackupFilename(
  shapeVersion: string | undefined,
  timestamp: string,
  primeAlignment?: "legacy" | "aligned"
): string {
  const alignmentMarker = primeAlignment === "aligned" ? "_permaweb-eligible" : "";
  return `OuronetCodex_v${shapeVersion ?? "unversioned"}${alignmentMarker}_${timestamp}.json`;
}

/**
 * Parse a backup JSON string through the canonical codec. `deserializeCodex`
 * accepts BOTH `"1.2"` and `"1.3"` (reader-before-writer), validates the
 * `foreignKeys` block + `pureKeypairs` array shapes, and rejects any unknown
 * top-level field — its throws are re-wrapped as this package's local
 * `CodexImportError` so the hook's throwing contract is unchanged.
 */
function parseBackupFile(json: string): ParsedBackup {
  try {
    return deserializeCodex(json) as unknown as ParsedBackup;
  } catch (e) {
    if (e instanceof SyntaxError) {
      throw new CodexImportError("parse", "JSON is malformed", e);
    }
    const detail = e instanceof Error ? e.message : String(e);
    throw new CodexImportError("shape", detail, e);
  }
}

export function useCodexBackup(): CodexBackupView {
  const store = useCodexStore();
  const isDirty = store((s) => s.dirty);
  const actions = store((s) => s.actions);

  const buildSnapshotFromState = useCallback((): CodexSnapshot => {
    const s = store.getState();
    return {
      kadenaSeeds: s.kadenaSeeds,
      ouroAccounts: s.ouroAccounts,
      pureKeypairs: s.pureKeypairs,
      addressBook: s.addressBook,
      watchList: s.watchList,
      uiSettings: s.uiSettings,
      // Carry the seedless foreign-key keyring so the Arweave key rides the
      // backup export (funds-critical — omitting it silently drops the key).
      foreignKeys: s.foreignKeys,
      // Carry the Arweave-seed keyring so a Prime Arweave Seed rides the
      // backup export (funds-critical — this is the reported incident: an
      // omitted `arweaveSeeds` here means the seed silently vanishes from
      // every fresh export regardless of the store's live state).
      arweaveSeeds: s.arweaveSeeds,
      consumerSettings: s.consumerSettings,
      codexIdentity: s.codexIdentity,
      schemaVersion: s.schemaVersion,
      lastUpdatedAt: s.lastUpdatedAt,
      lastUpdatedDevice: s.lastUpdatedDevice,
      // Carries the live per-codex shape stamp through to the snapshot
      // (codex-shape-version-stamp, T6) — `undefined` on a legacy/imported
      // codex the T3 store never silently stamps as current, "1.0.0"+ on
      // anything `kickstartCodex` created.
      Codex_Shape_Version: s.Codex_Shape_Version,
      masterKeyLocks: s.masterKeyLocks,
      codexMasterSeed: s.codexMasterSeed,
      migrationProgress: s.migrationProgress,
    };
  }, [store]);

  /** Builds BOTH the snapshot and its stringified export payload in one
   *  pass, so `downloadAsJson` can read `Codex_Shape_Version` off the
   *  already-built `snapshot` for its default filename (T6) without
   *  re-parsing the JSON string it also needs to write to the Blob. */
  const buildExportState = useCallback((): {
    snapshot: CodexSnapshot;
    json: string;
  } => {
    const snapshot = buildSnapshotFromState();
    const json = JSON.stringify(buildBackupPayload(snapshot), null, 2);
    return { snapshot, json };
  }, [buildSnapshotFromState]);

  const exportForCloud = useCallback(async (): Promise<string> => {
    return buildExportState().json;
  }, [buildExportState]);

  const downloadAsJson = useCallback(
    async (filename?: string): Promise<void> => {
      const { snapshot, json } = buildExportState();
      if (
        typeof window === "undefined" ||
        typeof document === "undefined"
      ) {
        throw new Error(
          "downloadAsJson requires a browser environment. Use exportForCloud " +
            "for SSR / Node contexts."
        );
      }
      const blob = new Blob([json], { type: "application/json" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download =
        filename ??
        buildDefaultBackupFilename(
          snapshot.Codex_Shape_Version,
          new Date().toISOString().replace(/[:.]/g, "-"),
          store.getState().primeAlignment
        );
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    },
    [buildExportState, store]
  );

  const importFromCloud = useCallback(
    async (json: string): Promise<void> => {
      const adapter = store.getState().adapter;
      if (!adapter) {
        throw new Error(
          "importFromCloud: codex store has no adapter. <CodexProvider> not mounted?"
        );
      }
      const parsed = parseBackupFile(json);
      const current = buildSnapshotFromState();

      // Hydrate into a CodexSnapshot. Adopt the parsed file's data; preserve
      // current schemaVersion (a runtime-only counter, not part of the wire
      // format).
      const next: CodexSnapshot = {
        kadenaSeeds: parsed.kadenaWallets,
        ouroAccounts: parsed.ouronetWallets,
        pureKeypairs: parsed.pureKeypairs ?? [],
        addressBook: parsed.addressBook,
        // Same funds-safe fallback discipline as `arweaveSeeds` below: a
        // backup written before the watch list rode the codec (or any backup
        // that simply omits the field) must NOT wipe a live watched address —
        // only an explicit (possibly empty) `watchList` array present in the
        // backup itself should replace it. This is the reported incident: a
        // watched Arweave address vanished across an export+reimport because
        // this fell back unconditionally to `current.watchList`, masking the
        // fact that `buildBackupPayload` never emitted the field at all.
        watchList: parsed.watchList ?? current.watchList ?? [],
        uiSettings: parsed.uiSettings,
        // BLOCK → BARE-ARRAY UNWRAP (funds-critical): the wire `foreignKeys` is a
        // `{ schemaVersion, keys }` block; the store/adapter expect a bare
        // `ForeignKeyEntry[]`. Assigning the whole block into an array-typed
        // field would make the slice/adapter `.map`/`.find` on a non-array →
        // the Arweave key is silently lost on restore = funds loss.
        //
        // FUNDS-CRITICAL fallback (same discipline as `arweaveSeeds`/`watchList`
        // below): a backup written before foreignKeys existed (or any backup
        // that simply omits the field) must NOT WIPE the key(s) already
        // resident in this codex. Only an explicit (possibly empty)
        // `foreignKeys` block present in the backup itself should replace it.
        // This was previously `parsed.foreignKeys?.keys ?? []` with no
        // `current.foreignKeys` fallback — an inconsistency with the identical
        // funds-critical discipline already applied to `arweaveSeeds`/
        // `watchList`, found and fixed alongside the Import/Export Contract doc.
        foreignKeys: parsed.foreignKeys?.keys ?? current.foreignKeys ?? [],
        // FUNDS-CRITICAL (the reported incident this fixes): a backup written
        // before Arweave seeds existed (or any backup that simply omits the
        // field) must NOT WIPE the seed(s) already resident in this codex.
        // Unlike `pureKeypairs` above (`?? []` — a keypair-free codex has
        // nothing to lose when an older backup never had the concept),
        // `arweaveSeeds` falls back to `current.arweaveSeeds` first: a Prime
        // Arweave Seed is a high-value, user-created secret, and the reported
        // incident is EXACTLY this field going missing on restore and wiping
        // the live seed. Only an explicit (possibly empty) `arweaveSeeds`
        // array present in the backup itself should replace it.
        arweaveSeeds: parsed.arweaveSeeds ?? current.arweaveSeeds ?? [],
        // PRESERVE the double-Apollo identity + per-consumer settings the
        // sharding adapter shards: the wire format omits them, and a full
        // `saveAll` overwrite would otherwise WIPE them from disk (N-09).
        consumerSettings: current.consumerSettings,
        codexIdentity: current.codexIdentity,
        schemaVersion: current.schemaVersion,
        lastUpdatedAt: new Date().toISOString(),
        lastUpdatedDevice: current.lastUpdatedDevice,
        // Owner-reported incident ("upgraded it, exported it, loaded it
        // again, still says its not versioned"): this assignment did not
        // exist, so every import rebuilt the snapshot WITHOUT the shape
        // stamp and a freshly-upgraded codex came back claiming to be
        // unversioned. The writer side was always correct — their export
        // carries `Codex_Shape_Version: "1.0.0"` and the codec allow-lists
        // it — the reader just never picked it up. Fourth instance of the
        // same omission as watchList / arweaveSeeds / foreignKeys above.
        //
        // ADOPTED VERBATIM, INCLUDING ITS ABSENCE — deliberately NOT
        // `?? current.Codex_Shape_Version`, which is the opposite of the
        // funds-critical discipline those three use, for a specific
        // reason: those protect SECRETS from being wiped by an older
        // backup, whereas this describes the SHAPE OF THE DATA BEING
        // IMPORTED. Inheriting this device's stamp onto freshly-imported
        // legacy data would mark unmigrated shapes as migrated and make
        // the structural upgrade skip the very codex that needs it.
        Codex_Shape_Version: parsed.Codex_Shape_Version,
        // Funds-adjacent, so this one DOES fall back to `current` like
        // foreignKeys/arweaveSeeds/watchList — and unlike the stamp directly
        // above. Importing an older backup that predates locks must never
        // silently unlock the key positions this device's master depends on.
        masterKeyLocks: parsed.masterKeyLocks ?? current.masterKeyLocks,
        // Falls back to `current` for the same reason as the locks: an older
        // backup that predates the row must not make this codex forget which
        // of its seeds everything derives from.
        codexMasterSeed: parsed.codexMasterSeed ?? current.codexMasterSeed,
        // Adopted from the IMPORTED codex, with the device's own as fallback:
        // resuming on another machine is the stated reason this travels at
        // all, so the file's in-progress run must win over this device's.
        migrationProgress: parsed.migrationProgress ?? current.migrationProgress,
      };

      await adapter.saveAll(next);
      // Re-init the store from the adapter so the in-memory state matches.
      await actions.init(adapter, current.lastUpdatedDevice);
    },
    [store, actions, buildSnapshotFromState]
  );

  const importFromFile = useCallback(
    async (file: File): Promise<void> => {
      const text = await file.text();
      return importFromCloud(text);
    },
    [importFromCloud]
  );

  return {
    downloadAsJson,
    importFromFile,
    exportForCloud,
    importFromCloud,
    isDirty,
    clearDirty: actions.clearDirty,
  };
}
