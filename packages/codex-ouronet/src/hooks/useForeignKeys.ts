/**
 * useForeignKeys — CRUD over the seedless foreign-chain keyring (E-02).
 *
 * Foreign keys are non-StoaChain chain keys (the first being Arweave JWKs) stored
 * as an INDEPENDENTLY-encrypted `encryptedKeyfile` ciphertext at rest (N-07).
 * This hook exposes the `foreignKeys` slice state + its CRUD actions; the
 * Arweave-specific generate/import/decrypt logic (which produces the
 * pre-encrypted entry this hook's `addForeignKey` persists) lives in
 * `@ancientpantheon/codex-arweave/keyring`.
 *
 * Mirrors `usePureKeypairs` — the slice persists via the complete-snapshot
 * `saveAll` route (FIX-5), so a foreign-key mutation never wipes another shard.
 */

import { useCodexStore } from "../provider/index.js";
import type { ForeignKeyEntry } from "@ancientpantheon/codex-core";
import type { CodexStoreState } from "../state/store.js";

export interface ForeignKeysView {
  foreignKeys: ForeignKeyEntry[];
  addForeignKey: (entry: ForeignKeyEntry) => Promise<void>;
  renameForeignKey: (id: string, newLabel: string) => Promise<void>;
  deleteForeignKey: (id: string) => Promise<void>;
}

export function useForeignKeys(): ForeignKeysView {
  const store = useCodexStore();
  // The re-exported `useCodexStore` selector param is loosely typed at this
  // package boundary (matches the existing zbom/seam call sites); annotate
  // explicitly against the store's own state so `noImplicitAny` stays clean.
  const foreignKeys = store((s: CodexStoreState) => s.foreignKeys);
  const actions = store((s: CodexStoreState) => s.actions);

  return {
    foreignKeys,
    addForeignKey: actions.addForeignKey,
    renameForeignKey: actions.renameForeignKey,
    deleteForeignKey: actions.deleteForeignKey,
  };
}
