/**
 * readRegistry — the single source of truth for every blockchain READ the
 * CodexUI depends on to operate.
 *
 * Each entry names a function the package REFERENCES (it lives immutably on
 * StoaChain — the package cannot embed it), the `@stoachain/*` helper that wraps
 * it, the debounce tier it rides on, and what surface it powers. The
 * `codexClock` monitor keys live read activity off these `id`s, and the
 * Settings → "Read Functions" page renders this list with a live ✓/✗ status.
 *
 * Canonical names use the real Pact identifier form `namespace.module.full-name`
 * (the `|` pipes are real Pact identifier characters, e.g. `coin.URV|COLLECT`).
 *
 * Tiers (see pactQueryTiers.ts): selector/display reads ride T5 (passive 30s),
 * keyset expansion rides T6 (lazy 60s), and the per-operation INFO cost reads
 * ride T2 (keystroke-debounced preview).
 */

import type { PactQueryTier } from "./pactQueryTiers.js";

export type ReadKind =
  | "selector" // account/state selector mappers
  | "balance" // token/coin balance reads
  | "info" // ZBOM operation cost (INFO) reads
  | "guard" // guard / keyset resolution
  | "native"; // Pact-native (coin, describe-keyset)

export interface CodexReadFn {
  /** Stable monitor key — codexClock activity + Read Functions status key off this. */
  id: string;
  /** Canonical Pact identifier: `namespace.module.full-name`. */
  canonical: string;
  /** The `@stoachain/*` helper that invokes it (or "(inline pactRead)"). */
  helper: string;
  /** Import subpath the helper lives at. */
  subpath: string;
  /** Debounce tier this read rides on. */
  tier: PactQueryTier;
  /** What CodexUI surface this read powers. */
  powers: string;
  kind: ReadKind;
  /**
   * Whether the current package UI actually invokes this read (so it CAN go
   * live). `false` ⇒ the read is part of the documented Codex read surface but
   * no current UI flow exercises it — the Read Functions page shows it as
   * "declared" rather than "idle" so the status is honest. Defaults to true.
   */
  reachable?: boolean;
}

export const CODEX_READ_REGISTRY: readonly CodexReadFn[] = [
  // ── Account / state selectors (T5) ──────────────────────────────────────────
  {
    id: "URC_0027",
    canonical: "ouronet-ns.DPL-UR.URC_0027_AccountSelectorMapper",
    helper: "getAccountSelectorData",
    subpath: "@stoachain/ouronet-core/interactions/ouroAccountFunctions",
    tier: "T5",
    powers:
      "Ouronet Accounts tab — activation, account guard, smart/standard, payment key + guard + balance, on-chain public key, sovereign, governor, StoicTag.",
    kind: "selector",
  },
  {
    id: "URC_0028",
    canonical: "ouronet-ns.DPL-UR.URC_0028_StoaAccountSelectorMapper",
    helper: "getStoaAccountSelectorData",
    subpath: "@stoachain/ouronet-core/interactions/ouroAccountFunctions",
    tier: "T5",
    powers: 'Stoa Accounts tab — the protocol "Stoa Balance" summary line per k:/c: account.',
    kind: "selector",
  },
  {
    id: "URC_0027b",
    canonical: "ouronet-ns.DPL-UR.URC_0027b_StoicTagSelectorMapper",
    helper: "getStoicTagSelectorData",
    subpath: "@stoachain/ouronet-core/interactions/ouroAccountFunctions",
    tier: "T5",
    powers:
      "Address Book → StoicTags subsection — batch-resolves saved tag names to their on-chain status (bound account / released / not registered).",
    kind: "selector",
  },
  {
    id: "URC_0027c",
    canonical: "ouronet-ns.DPL-UR.URC_0027c_StoicTagSelectorSingle",
    helper: "getStoicTagInfo",
    subpath: "@stoachain/ouronet-core/interactions/ouroAccountFunctions",
    tier: "T3",
    powers: "Single forward StoicTag lookup (tag-name resolution in inputs).",
    kind: "selector",
    reachable: false,
  },

  // ── Balances (T5) ───────────────────────────────────────────────────────────
  {
    id: "coin.get-balance",
    canonical: "coin.get-balance",
    helper: "(inline pactRead, per chain 0–9)",
    subpath: "@stoachain/stoa-core/reads",
    tier: "T5",
    powers: "Stoa Accounts tab — per-chain STOA balance grid + row totals.",
    kind: "native",
  },
  {
    id: "UR_AccountSupply",
    canonical: "ouronet-ns.DPTF.UR_AccountSupply",
    helper: "getIgnisBalance",
    subpath: "@stoachain/ouronet-core/interactions/ouroBalanceFunctions",
    tier: "T5",
    powers: "IGNIS balance — patron selection + gas affordability in ZBOM ops.",
    kind: "balance",
  },

  // ── Guard / keyset resolution ────────────────────────────────────────────────
  {
    id: "UR_AccountGuard",
    canonical: "ouronet-ns.DALOS.UR_AccountGuard",
    helper: "getKadenaAccountGuard",
    subpath: "@stoachain/ouronet-core/interactions/ouroAccountFunctions",
    tier: "T5",
    powers: "Sovereign guard resolution for the signing auth path.",
    kind: "guard",
  },
  {
    id: "UR_AccountKadena",
    canonical: "ouronet-ns.DALOS.UR_AccountKadena",
    helper: "getKadenaAccountOwner",
    subpath: "@stoachain/ouronet-core/interactions/ouroAccountFunctions",
    tier: "T5",
    powers: "k:/c: payment address resolution for native-STOA receiver fields.",
    kind: "guard",
    reachable: false,
  },
  {
    id: "describe-keyset",
    canonical: "describe-keyset",
    helper: "(inline pactRead)",
    subpath: "@stoachain/stoa-core/reads",
    tier: "T6",
    powers: "Keyset-ref guard expansion (resolveGuard / readKeyset).",
    kind: "native",
    reachable: false,
  },

  // ── ZBOM operation cost (INFO) reads (T2, keystroke-debounced preview) ────────
  {
    id: "INFO_DeployStandardAccount",
    canonical: "ouronet-ns.INFO-ZERO.DALOS-INFO|URC_DeployStandardAccount",
    helper: "getDeployStandardAccountInfo",
    subpath: "@stoachain/ouronet-core/interactions/activateFunctions",
    tier: "T2",
    powers: "Activate (Spawn Standard) — gas/IGNIS cost preview.",
    kind: "info",
  },
  {
    id: "INFO_RegisterStoicTag",
    canonical: "ouronet-ns.CODEX.CODEX|INFO_RegisterStoicTag",
    helper: "getRegisterStoicTagInfo",
    subpath: "@stoachain/ouronet-core/interactions/ouroAccountFunctions",
    tier: "T2",
    powers: "Add StoicTag — cost preview + resolved receivers.",
    kind: "info",
  },
  {
    id: "INFO_ReleaseStoicTag",
    canonical: "ouronet-ns.CODEX.CODEX|INFO_ReleaseStoicTag",
    helper: "(inline pactRead)",
    subpath: "@stoachain/stoa-core/reads",
    tier: "T2",
    powers: "Release StoicTag — cost preview.",
    kind: "info",
  },
  {
    id: "INFO_RotateGovernor",
    canonical: "ouronet-ns.INFO-ZERO.DALOS-INFO|URC_RotateGovernor",
    helper: "(inline pactRead)",
    subpath: "@stoachain/stoa-core/reads",
    tier: "T2",
    powers: "Rotate Governor — cost preview.",
    kind: "info",
  },
  {
    id: "INFO_RotateSovereign",
    canonical: "ouronet-ns.INFO-ZERO.DALOS-INFO|URC_RotateSovereign",
    helper: "(inline pactRead)",
    subpath: "@stoachain/stoa-core/reads",
    tier: "T2",
    powers: "Rotate Sovereign — cost preview.",
    kind: "info",
  },
  {
    id: "INFO_RotateGuard",
    canonical: "ouronet-ns.INFO-ZERO.DALOS-INFO|URC_RotateGuard",
    helper: "(inline pactRead)",
    subpath: "@stoachain/stoa-core/reads",
    tier: "T2",
    powers: "Rotate Guard — cost preview.",
    kind: "info",
  },
  {
    id: "INFO_RotateKadena",
    canonical: "ouronet-ns.INFO-ZERO.DALOS-INFO|URC_RotateKadena",
    helper: "(inline pactRead)",
    subpath: "@stoachain/stoa-core/reads",
    tier: "T2",
    powers: "Rotate Payment Key — cost preview.",
    kind: "info",
  },
] as const;

/** Fast id → entry lookup for the monitor. */
export const READ_BY_ID: Record<string, CodexReadFn> = Object.fromEntries(
  CODEX_READ_REGISTRY.map((r) => [r.id, r]),
);

/** All registry ids (stable order). */
export const READ_IDS: readonly string[] = CODEX_READ_REGISTRY.map((r) => r.id);
