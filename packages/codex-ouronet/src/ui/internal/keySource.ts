/**
 * Key-source identification + address coloring — ported from OuronetUI's
 * OuroAccountList helpers (identifyKeySource / addrColor / SEED_COLORS).
 *
 * Adapted to the package data model: OuronetUI carried a flat
 * `stoaChainAccounts: IStoaChainWallet[]` list alongside the seeds; the codex
 * store keeps derived accounts inside `seed.accounts` and pure keys in a
 * separate `IPureKeypair[]`, so we resolve a public key against both.
 */

import type { IStoaChainSeed, IPureKeypair, SeedType } from "../../types/entities.js";
import { getSeedDisplayName } from "./seedNames.js";

export interface KeySourceInfo {
  label: string;
  color: string;
}

// Chainweaver and EckoWallet are the same wallet underneath (same 12-word
// mnemonic → keypair derivation); both keys stay valid so an existing seed
// persisted under either value renders correctly, but they now share one
// color so the two badges read as the same wallet rather than two different
// ones. Only "chainweaver" is ever chosen for a NEW seed (see
// CreateStoaChainSeedModal.tsx) — "eckowallet" survives here purely for
// legacy display/normalization of already-stored data.
export const SEED_COLORS: Record<SeedType, string> = {
  koala: "#f472b6",
  eckowallet: "#3b82f6",
  chainweaver: "#3b82f6",
  // Stoic ("Stoa Dalos") reuses the user's existing Ouronet (DALOS) seed
  // rather than a fresh StoaChain mnemonic — a distinct color from
  // koala/chainweaver so its badge reads as its own family.
  stoic: "#eab308",
};

/** Normalize legacy/stale seedType values that may survive persistence. */
const SEED_TYPE_NORMALIZE: Record<string, SeedType> = {
  koala: "koala",
  new: "koala",
  eckowallet: "eckowallet",
  chainweaver: "chainweaver",
  legacy: "chainweaver",
  stoic: "stoic",
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
  seeds: IStoaChainSeed[],
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
