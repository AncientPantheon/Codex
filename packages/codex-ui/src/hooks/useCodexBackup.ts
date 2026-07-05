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
 * and `pureKeypairs` as a bare array (the codec carries it through unchanged).
 * Omitting either wire here would silently drop the corresponding keyring from
 * the backup — a funds-loss bug for `foreignKeys`.
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
  });
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
      consumerSettings: s.consumerSettings,
      codexIdentity: s.codexIdentity,
      schemaVersion: s.schemaVersion,
      lastUpdatedAt: s.lastUpdatedAt,
      lastUpdatedDevice: s.lastUpdatedDevice,
    };
  }, [store]);

  const exportForCloud = useCallback(async (): Promise<string> => {
    const snapshot = buildSnapshotFromState();
    return JSON.stringify(buildBackupPayload(snapshot), null, 2);
  }, [buildSnapshotFromState]);

  const downloadAsJson = useCallback(
    async (filename?: string): Promise<void> => {
      const json = await exportForCloud();
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
        `OuronetCodex_${new Date()
          .toISOString()
          .replace(/[:.]/g, "-")}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    },
    [exportForCloud]
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
        // watchList stays current (not in the wire format).
        watchList: current.watchList,
        uiSettings: parsed.uiSettings,
        // BLOCK → BARE-ARRAY UNWRAP (funds-critical): the wire `foreignKeys` is a
        // `{ schemaVersion, keys }` block; the store/adapter expect a bare
        // `ForeignKeyEntry[]`. Assigning the whole block into an array-typed
        // field would make the slice/adapter `.map`/`.find` on a non-array →
        // the Arweave key is silently lost on restore = funds loss.
        foreignKeys: parsed.foreignKeys?.keys ?? [],
        // PRESERVE the double-Apollo identity + per-consumer settings the
        // sharding adapter shards: the wire format omits them, and a full
        // `saveAll` overwrite would otherwise WIPE them from disk (N-09).
        consumerSettings: current.consumerSettings,
        codexIdentity: current.codexIdentity,
        schemaVersion: current.schemaVersion,
        lastUpdatedAt: new Date().toISOString(),
        lastUpdatedDevice: current.lastUpdatedDevice,
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
