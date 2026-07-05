// ============================================================================
// The file-upload storage adapter for the codex-playground devtool.
//
// Two explicit load modes seed the REAL dashboard's storage seam:
//
//   - mode-2 (plaintext snapshot): hydrate a fresh MemoryCodexAdapter VERBATIM
//     BEFORE mount. `saveAll` is a `structuredClone`, so the round-trip
//     deep-equals the fixture — lastUpdated* included, no re-stamp.
//
//   - mode-1 (encrypted backup JSON): the App mounts an EMPTY adapter under
//     <CodexProvider>, then delegates the restore to the REAL
//     useCodexBackup().importFromCloud — the single-reader restore path. That
//     hook owns the version gate (accepts BOTH "1.2" AND the E1-rewired "1.3"
//     codec envelope — reader-before-writer), the wire→snapshot field map, the
//     synthesized lastUpdatedAt, and the current-device re-stamp. This module
//     holds NO React hook call itself; importFromCloud is injected by the App.
//
// DEVICE TAG: the DeviceVariant union is "dev" | "main" — it REJECTS
// "playground". Every adapter here is constructed with "dev".
//
// SECRET HYGIENE (N-06): nothing here logs a snapshot, a backup blob, or a
// secret value. Errors name a field/reason; they never echo an encrypted blob.
// ============================================================================

import {
  MemoryCodexAdapter,
  type CodexSnapshot,
} from "@ancientpantheon/codex-ouronet/adapters";

/** The device tag for every playground adapter. The DeviceVariant union is
 *  "dev" | "main" and rejects "playground"; "dev" is the substituted tag. */
const PLAYGROUND_DEVICE = "dev" as const;

/**
 * Mode-2 — pure, pre-mount hydration of a plaintext snapshot.
 *
 * Constructs a fresh MemoryCodexAdapter("dev") and hands it the snapshot
 * VERBATIM via `saveAll` (structuredClone). The returned adapter's `loadAll()`
 * deep-equals the input, lastUpdated* included. Wallet secrets pass through
 * encrypted — this path never decrypts.
 *
 * Fail-closed: a non-object snapshot is rejected before any write, so a bad
 * upload cannot seed the store with garbage.
 */
export async function hydrateFromPlaintextSnapshot(
  snapshot: CodexSnapshot,
): Promise<MemoryCodexAdapter> {
  if (snapshot === null || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new Error(
      "hydrateFromPlaintextSnapshot: snapshot must be a CodexSnapshot object",
    );
  }
  const adapter = new MemoryCodexAdapter(PLAYGROUND_DEVICE);
  await adapter.saveAll(snapshot);
  return adapter;
}

/**
 * Mode-1 — thin delegate to the REAL backup restore hook.
 *
 * The App passes `useCodexBackup().importFromCloud` (bound to the mounted,
 * empty adapter) plus the uploaded backup text. That hook owns the whole
 * restore: parse + version gate ({1.2, 1.3} — E1 rewired the writer onto the
 * "1.3" codec; the reader still accepts old "1.2" backups) + shape checks + wire→snapshot field map
 * + synthesized lastUpdatedAt + current-device re-stamp + saveAll + store init.
 *
 * This wrapper adds NOTHING to the restore — it neither parses the backup by
 * hand nor calls the low-level codec. Keeping the hook as the single reader is
 * why fail-closed (malformed / wrong-version) surfaces from importFromCloud's
 * own gate, not from a duplicate gate here.
 */
export async function restoreBackupIntoStore(
  importFromCloud: (json: string) => Promise<void>,
  backupText: string,
): Promise<void> {
  await importFromCloud(backupText);
}

/**
 * Explicit-mode dispatcher — NO sniff-and-guess.
 *
 * The caller states the mode. A mode/payload mismatch (encrypted mode handed a
 * non-string, or plaintext mode handed a string) throws a clear, secret-free
 * error naming the mismatch rather than silently mis-routing the upload.
 */
export function loadCodex(
  input:
    | { mode: "plaintext"; snapshot: CodexSnapshot }
    | {
        mode: "encrypted";
        backupText: string;
        importFromCloud: (json: string) => Promise<void>;
      },
): Promise<MemoryCodexAdapter | void> {
  if (input.mode === "plaintext") {
    if (typeof input.snapshot === "string") {
      return Promise.reject(
        new Error(
          "loadCodex: plaintext mode expects a CodexSnapshot object, got a backup string",
        ),
      );
    }
    return hydrateFromPlaintextSnapshot(input.snapshot);
  }

  if (typeof input.backupText !== "string") {
    return Promise.reject(
      new Error(
        "loadCodex: encrypted mode expects a backup JSON string, got a snapshot object",
      ),
    );
  }
  return restoreBackupIntoStore(input.importFromCloud, input.backupText);
}
