/**
 * useCodexBackup — codex backup / restore / cloud-export helpers.
 *
 * Four operations:
 *   - downloadAsJson()              browser file download via Blob + <a>.click
 *   - importFromFile(File)          reads + parses + applies to adapter
 *   - exportForCloud()              returns the JSON string (for /google-drive)
 *   - importFromCloud(string)       applies a cloud-fetched JSON string
 *
 * On-disk format: the v1.2 codex file format from
 * @stoachain/ouronet-core/codex, EXTENDED with a `pureKeypairs` array
 * (OuronetUI v1.0.9 fix). The base codec is frozen at v1.2 and rejects
 * unknown top-level fields, so this hook serializes/deserializes the
 * augmented format directly rather than going through `serializeCodex` /
 * `deserializeCodex`. Imports tolerate pureKeypairs being absent
 * (existing pre-v1.0.9 backups), so we don't break older codices.
 *
 * Why pureKeypairs and NOT watchList: spec §G1 explicitly adds
 * pureKeypairs to the export per the v1.0.9 hotfix. Adding watchList
 * would be silent scope-creep — codified to wait for Phase 9 OuronetUI
 * migration where the gap will surface concretely.
 *
 * Browser dependency: downloadAsJson uses window.URL.createObjectURL +
 * document.createElement + <a>.click. SSR consumers should call
 * exportForCloud (which returns the string) instead.
 */

import { useCallback } from "react";
import { useCodexStore } from "../provider/index.js";
import type { CodexSnapshot } from "@ancientpantheon/codex-ouronet/types";
import { CodexImportError } from "./errors.js";

// Wire-shape of the augmented v1.2-plus-pureKeypairs file the package
// reads/writes. Matches OuronetUI v1.0.9's downloadAsJson output.
interface BackupFileV12Plus {
  version: "1.2";
  exportedAt: string;
  kadenaWallets: CodexSnapshot["kadenaSeeds"];
  ouronetWallets: CodexSnapshot["ouroAccounts"];
  addressBook: CodexSnapshot["addressBook"];
  uiSettings: CodexSnapshot["uiSettings"];
  /** v1.0.9 extension — device-local pure keypairs. Optional on import
   *  for backwards-compat with pre-v1.0.9 backups. */
  pureKeypairs?: CodexSnapshot["pureKeypairs"];
}

export interface CodexBackupView {
  downloadAsJson: (filename?: string) => Promise<void>;
  importFromFile: (file: File) => Promise<void>;
  exportForCloud: () => Promise<string>;
  importFromCloud: (json: string) => Promise<void>;
  isDirty: boolean;
  clearDirty: () => void;
}

function buildBackupPayload(snapshot: CodexSnapshot): BackupFileV12Plus {
  return {
    version: "1.2",
    exportedAt: new Date().toISOString(),
    kadenaWallets: snapshot.kadenaSeeds,
    ouronetWallets: snapshot.ouroAccounts,
    addressBook: snapshot.addressBook,
    uiSettings: snapshot.uiSettings,
    pureKeypairs: snapshot.pureKeypairs,
  };
}

function parseBackupFile(json: string): BackupFileV12Plus {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    throw new CodexImportError("parse", "JSON is malformed", e);
  }
  if (!parsed || typeof parsed !== "object") {
    throw new CodexImportError("shape", "top-level is not an object");
  }
  const p = parsed as Record<string, unknown>;
  if (p.version !== "1.2") {
    throw new CodexImportError(
      "shape",
      `unsupported version ${String(p.version)} — expected "1.2"`
    );
  }
  if (!Array.isArray(p.kadenaWallets)) {
    throw new CodexImportError("shape", "kadenaWallets must be an array");
  }
  if (!Array.isArray(p.ouronetWallets)) {
    throw new CodexImportError("shape", "ouronetWallets must be an array");
  }
  if (!Array.isArray(p.addressBook)) {
    throw new CodexImportError("shape", "addressBook must be an array");
  }
  if (
    typeof p.uiSettings !== "object" ||
    p.uiSettings === null ||
    Array.isArray(p.uiSettings)
  ) {
    throw new CodexImportError("shape", "uiSettings must be an object");
  }
  // pureKeypairs is optional (pre-v1.0.9 backups); validate only if present.
  if (p.pureKeypairs !== undefined && !Array.isArray(p.pureKeypairs)) {
    throw new CodexImportError(
      "shape",
      "pureKeypairs must be an array if present"
    );
  }
  return p as unknown as BackupFileV12Plus;
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

      // Hydrate into a CodexSnapshot. Adopt the parsed file's data;
      // preserve current schemaVersion (it's a runtime-only counter,
      // not part of the wire format).
      const next: CodexSnapshot = {
        kadenaSeeds: parsed.kadenaWallets,
        ouroAccounts: parsed.ouronetWallets,
        pureKeypairs: parsed.pureKeypairs ?? [],
        addressBook: parsed.addressBook,
        // watchList stays current (not in the v1.2 wire format).
        watchList: current.watchList,
        uiSettings: parsed.uiSettings,
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
