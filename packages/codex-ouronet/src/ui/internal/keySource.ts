/**
 * Key-source identification + address coloring — ported from OuronetUI's
 * OuroAccountList helpers (identifyKeySource / addrColor / SEED_COLORS).
 *
 * Adapted to the package data model: OuronetUI carried a flat
 * `kadenaAccounts: IKadenaWallet[]` list alongside the seeds; the codex
 * store keeps derived accounts inside `seed.accounts` and pure keys in a
 * separate `IPureKeypair[]`, so we resolve a public key against both.
 */

import type { IKadenaSeed, IPureKeypair, SeedType } from "../../types/entities.js";
import { getSeedDisplayName } from "./seedNames.js";

export interface KeySourceInfo {
  label: string;
  color: string;
}

export const SEED_COLORS: Record<SeedType, string> = {
  koala: "#f472b6",
  eckowallet: "#f97316",
  chainweaver: "#3b82f6",
};

/** Normalize legacy/stale seedType values that may survive persistence. */
const SEED_TYPE_NORMALIZE: Record<string, SeedType> = {
  koala: "koala",
  new: "koala",
  eckowallet: "eckowallet",
  chainweaver: "chainweaver",
  legacy: "chainweaver",
};

export function normalizeSeedType(raw: string | undefined): SeedType {
  return SEED_TYPE_NORMALIZE[raw?.toLowerCase() ?? ""] ?? "chainweaver";
}

export const ADDRESS_COLORS: Record<string, string> = {
  "c:": "#3b82f6",
  "u:": "#92400e",
  "w:": "#a78bfa",
  "k:": "#c0c0c0",
};

export const FOREIGN_COLOR = "#c0392b";

export function addrColor(addr: string): string {
  return ADDRESS_COLORS[addr.slice(0, 2)] || "#c0c0c0";
}

/**
 * Map a public key (or k:/c:/u:/w: address) to a human label + color by
 * locating it among the codex seeds + pure keypairs.
 */
export function identifyKeySource(
  keyOrAddr: string,
  seeds: IKadenaSeed[],
  pureKeypairs: IPureKeypair[] = [],
): KeySourceInfo {
  if (!keyOrAddr) return { label: "", color: "#888" };
  if (keyOrAddr.startsWith("c:")) return { label: "Principal Capability Guard", color: "#3b82f6" };
  if (keyOrAddr.startsWith("u:")) return { label: "Principal User Guard", color: "#92400e" };
  if (keyOrAddr.startsWith("w:")) return { label: "Multisig Account", color: "#a78bfa" };

  const pub = keyOrAddr.startsWith("k:") ? keyOrAddr.slice(2) : keyOrAddr;

  for (const seed of seeds) {
    const name = getSeedDisplayName(seed, seeds);
    for (const acc of seed.accounts) {
      if (acc.publicKey === pub) {
        return { label: `${name} #${acc.index}`, color: SEED_COLORS[normalizeSeedType(seed.seedType)] };
      }
    }
  }

  for (const pk of pureKeypairs) {
    if (pk.publicKey === pub) {
      return { label: pk.label || "Pure Keypair", color: "#a78bfa" };
    }
  }

  return { label: keyOrAddr.startsWith("k:") ? "Foreign Payment Key" : "Foreign Key", color: FOREIGN_COLOR };
}
