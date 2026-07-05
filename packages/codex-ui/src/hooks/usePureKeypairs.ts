/**
 * usePureKeypairs — CRUD over foreign-key (pure) keypairs.
 *
 * Pure keypairs are private keys imported directly into the codex
 * (vs. derived from a seed). Stored with encryptedPrivateKey =
 * smartEncrypt(privateKey, codexPassword). Signed via the "foreign"
 * seedType branch of universalSignTransaction.
 *
 * v1.0.9 backup-format note: pureKeypairs are DEVICE-LOCAL — they do
 * NOT round-trip via the v1.2 codex backup file (the codec
 * intentionally excludes them). Use the Google Drive sub-export for
 * cross-device sync, or re-add on each device.
 */

import { useCodexStore } from "../provider/index.js";
import type { IPureKeypair } from "@ancientpantheon/codex-ouronet/types";

export interface PureKeypairsView {
  keypairs: IPureKeypair[];
  addKeypair: (keypair: IPureKeypair) => Promise<void>;
  deleteKeypair: (id: string) => Promise<void>;
}

export function usePureKeypairs(): PureKeypairsView {
  const store = useCodexStore();
  const keypairs = store((s) => s.pureKeypairs);
  const actions = store((s) => s.actions);

  return {
    keypairs,
    addKeypair: actions.addPureKeypair,
    deleteKeypair: actions.deletePureKeypair,
  };
}
