/**
 * cfm data-seam — the single translation layer between the verbatim-cloned
 * OuronetUI cfm/* components and the package's own Zustand state.
 *
 * OuronetUI's cfm components read their wallet material from a React Context
 * (`useWallet` in `@/context/wallet-context`) and their ZBOM zone-open /
 * patron-selection preferences from Redux (`useSelector((s) => s.wallet
 * .uiSettings?.X)`). The clones import the SAME-named hooks from here instead,
 * so the component bodies stay byte-for-byte identical to OuronetUI and only
 * the import line changes.
 *
 * `useWallet()` returns the exact shape OuronetUI's context did
 * (`{ ouro, kadena, kadenaAccounts, pureKeypairs }`), assembled from the
 * package's per-entity hooks. `kadenaAccounts` is FLATTENED from the seeds the
 * same way OuronetUI's context carried a flat `IKadenaWallet[]`.
 */

import { useMemo } from "react";
import { useOuroAccounts } from "../../hooks/index.js";
import { useKadenaSeeds } from "../../hooks/index.js";
import { usePureKeypairs } from "../../hooks/index.js";
import { useCodexStore } from "../../provider/index.js";
import type {
  IOuroAccount,
  IKadenaSeed,
  IKadenaWallet,
  IPureKeypair,
} from "../../types/entities.js";

/** Flatten the codex's kadena seeds into the flat `IKadenaWallet[]` that
 *  OuronetUI's wallet-context carried. Each derived account is stamped with its
 *  `k:`-prefixed address + its seed linkage (secret / seedId / seedType) so the
 *  signing-material lookup in SigningZone / AuthPathZone works unchanged. */
export function flattenKadenaAccounts(seeds: IKadenaSeed[]): IKadenaWallet[] {
  const out: IKadenaWallet[] = [];
  for (const seed of seeds) {
    for (const acc of seed.accounts) {
      out.push({
        ...acc,
        address: "k:" + acc.publicKey,
        secret: seed.secret,
        seedId: seed.id,
        seedType: seed.seedType,
      });
    }
  }
  return out;
}

export interface WalletView {
  ouro: IOuroAccount[];
  kadena: IKadenaSeed[];
  kadenaAccounts: IKadenaWallet[];
  pureKeypairs: IPureKeypair[];
}

/** Package analogue of OuronetUI's `useWallet()` (from
 *  `@/context/wallet-context`). Same return shape; sourced from the package's
 *  Zustand-backed per-entity hooks. */
export function useWallet(): WalletView {
  const { accounts: ouro } = useOuroAccounts();
  const { seeds: kadena } = useKadenaSeeds();
  const { keypairs: pureKeypairs } = usePureKeypairs();
  const kadenaAccounts = useMemo(() => flattenKadenaAccounts(kadena), [kadena]);
  return { ouro, kadena, kadenaAccounts, pureKeypairs };
}

/** Package analogue of OuronetUI's `useSelector((s) => s.wallet.uiSettings?.KEY
 *  ?? DEF)`. Reads the codex-scoped UI setting from the Zustand store with a
 *  focused subscription (re-renders only when that key changes). */
export function useUiSetting<T>(key: string, def: T): T {
  const store = useCodexStore();
  const val = store((s) => (s.uiSettings as Record<string, unknown>)[key]);
  return (val === undefined ? def : val) as T;
}
