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
  // DPL-UR chain-symbol audit (2026-09-25): DPL-UR went into archive mode
  // (PureV2/14) — its reads no longer resolve on mainnet AT ALL (not merely
  // fragile). Four of the seven DPL-UR reads this package references have a
  // confirmed replacement on the new `O-UI-SEVEN` module; the `canonical`
  // strings below now name those replacements. IMPORTANT: the `helper`
  // functions are all EXTERNAL (`@ouronet/ouronet-core`, confirmed latest
  // published version 4.6.0 as of this audit) — they still construct the OLD
  // `DPL-UR.*` Pact call internally, so updating `canonical` here corrects
  // this package's OWN documentation/Settings-page display but does NOT by
  // itself fix the live read; that requires `@ouronet/ouronet-core` to ship
  // an O-UI-SEVEN-compatible release this package can pin to.
  {
    id: "URC_0027",
    canonical: "ouronet-ns.O-UI-SEVEN.URC_01|Accounts",
    helper: "getAccountSelectorData",
    subpath: "@ouronet/ouronet-core/interactions/ouroAccountFunctions",
    tier: "T5",
    powers:
      "Ouronet Accounts tab — activation, account guard, smart/standard, payment key + guard + balance, on-chain public key, sovereign, governor, StoicTag.",
    kind: "selector",
  },
  {
    id: "URC_0028",
    canonical: "ouronet-ns.O-UI-SEVEN.URC_05|StoaAccounts",
    helper: "getStoaAccountSelectorData",
    subpath: "@ouronet/ouronet-core/interactions/ouroAccountFunctions",
    tier: "T5",
    powers: 'Stoa Accounts tab — the protocol "Stoa Balance" summary line per k:/c: account.',
    kind: "selector",
  },
  {
    id: "URC_0027b",
    canonical: "ouronet-ns.O-UI-SEVEN.URC_03|StoicTags",
    helper: "getStoicTagSelectorData",
    subpath: "@ouronet/ouronet-core/interactions/ouroAccountFunctions",
    tier: "T5",
    powers:
      "Address Book → StoicTags subsection — batch-resolves saved tag names to their on-chain status (bound account / released / not registered).",
    kind: "selector",
  },
  {
    id: "URC_0027c",
    canonical: "ouronet-ns.O-UI-SEVEN.URC_04|StoicTag",
    helper: "getStoicTagInfo",
    subpath: "@ouronet/ouronet-core/interactions/ouroAccountFunctions",
    tier: "T3",
    powers: "Single forward StoicTag lookup (tag-name resolution in inputs).",
    kind: "selector",
    reachable: false,
  },
  {
    id: "URC_0031",
    // NO confirmed O-UI-SEVEN replacement as of the 2026-09-25 audit — DPL-UR
    // is archived so this read is CONFIRMED BROKEN on mainnet, but its
    // replacement name is unknown (the audit found replacements for
    // URC_0027/0027b/0027c/0028 only — O-UI-SEVEN's "seven" functions leave
    // 3 slots, e.g. URC_02/06/07, unaccounted for; do NOT guess one in without
    // independent chain verification — see deployApiKey.ts's own doc comment).
    canonical: "ouronet-ns.DPL-UR.URC_0031",
    helper: "getApiKeySelectorData",
    subpath: "codex-ouronet/zbom/pythia/deployApiKey (interim; upstream to ouronet-core)",
    tier: "T5",
    powers:
      "Ouronet Accounts tab — batch Apollo→Pythia registration status (registered vs observational) + owner-account, counterpart, timestamps.",
    kind: "selector",
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
    subpath: "@ouronet/ouronet-core/interactions/ouroBalanceFunctions",
    tier: "T5",
    powers: "IGNIS balance — patron selection + gas affordability in ZBOM ops.",
    kind: "balance",
  },

  // ── Guard / keyset resolution ────────────────────────────────────────────────
  {
    id: "UR_AccountGuard",
    canonical: "ouronet-ns.DALOS.UR_AccountGuard",
    helper: "getStoaChainAccountGuard",
    subpath: "@ouronet/ouronet-core/interactions/ouroAccountFunctions",
    tier: "T5",
    powers: "Sovereign guard resolution for the signing auth path.",
    kind: "guard",
  },
  {
    id: "UR_AccountStoa",
    canonical: "ouronet-ns.DALOS.UR_AccountStoa",
    helper: "getKadenaAccountOwner",
    subpath: "@ouronet/ouronet-core/interactions/ouroAccountFunctions",
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
    canonical: "ouronet-ns.INFO-ONE.INFO_DALOS|DeployStandardAccount",
    helper: "getDeployStandardAccountInfo",
    subpath: "@ouronet/ouronet-core/interactions/activateFunctions",
    tier: "T2",
    powers: "Activate (Spawn Standard) — gas/IGNIS cost preview.",
    kind: "info",
  },
  {
    id: "INFO_RegisterStoicTag",
    canonical: "ouronet-ns.CODEX.INFO_CODEX|RegisterStoicTag",
    helper: "getRegisterStoicTagInfo",
    subpath: "@ouronet/ouronet-core/interactions/ouroAccountFunctions",
    tier: "T2",
    powers: "Add StoicTag — cost preview + resolved receivers.",
    kind: "info",
  },
  {
    id: "INFO_ReleaseStoicTag",
    canonical: "ouronet-ns.CODEX.INFO_CODEX|ReleaseStoicTag",
    helper: "(inline pactRead)",
    subpath: "@stoachain/stoa-core/reads",
    tier: "T2",
    powers: "Release StoicTag — cost preview.",
    kind: "info",
  },
  {
    id: "INFO_RotateGovernor",
    canonical: "ouronet-ns.INFO-ONE.INFO_DALOS|RotateGovernor",
    helper: "(inline pactRead)",
    subpath: "@stoachain/stoa-core/reads",
    tier: "T2",
    powers: "Rotate Governor — cost preview.",
    kind: "info",
  },
  {
    id: "INFO_RotateSovereign",
    canonical: "ouronet-ns.INFO-ONE.INFO_DALOS|RotateSovereign",
    helper: "(inline pactRead)",
    subpath: "@stoachain/stoa-core/reads",
    tier: "T2",
    powers: "Rotate Sovereign — cost preview.",
    kind: "info",
  },
  {
    id: "INFO_RotateGuard",
    canonical: "ouronet-ns.INFO-ONE.INFO_DALOS|RotateGuard",
    helper: "(inline pactRead)",
    subpath: "@stoachain/stoa-core/reads",
    tier: "T2",
    powers: "Rotate Guard — cost preview.",
    kind: "info",
  },
  {
    id: "INFO_RotateStoaChain",
    canonical: "ouronet-ns.INFO-ONE.INFO_DALOS|RotateStoa",
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
