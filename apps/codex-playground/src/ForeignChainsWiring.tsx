// ============================================================================
// ForeignChainsWiring — the playground's app-side wiring of the E4 generic
// Foreign Chains tab to the concrete Arweave panel (the wiring E4 scope-fenced
// out to E5).
//
// `buildArweaveWiring({ mode })` builds a fresh `createForeignChainRegistry()`
// INSTANCE, registers the mode's adapter (mock in mock mode), and returns:
//   - `foreignChains`      — `registry.list()` (the injected id list the generic
//                            tab dispatches off; NO module-global accessor, D3 F-001)
//   - `foreignChainPanels` — `{ [ARWEAVE_CHAIN_ID]: ArweavePanel,
//                            [CHAINWEB_RAIL_ID]: ChainwebPanel }` (the app wires
//                            the panels; codex-ui stays chain-free — no edge).
//                            Together with the id list above this IS Class 2:
//                            the vertical blockchain rail + the selected chain's
//                            own category strip.
//   - `panelDeps`          — the E4 `ArweavePanelDeps` bundle fed into the panel
//                            context provider
//
// The address book the panel's Send recipient picker offers is NOT a fake: the
// component reads the REAL codex slice (`useAddressBook`) and maps it through
// `toPanelAddressBook`, which is where an `arweave`-typed entry acquires the
// `chainId` the Send area filters on.
//
// The `mode` param keeps the wiring MODE-SWAPPABLE for the real toggle (T15.6
// adds `ARWEAVE_WIRING_MODE_REAL` + the real adapter/seams; this file owns the
// switch). The `ForeignChainsWiring` component mounts the WHOLE `CodexTabs`
// shell — Class 2 already fed the rail — wrapped in the `ArweavePanelProvider`
// so the panel + its 5 areas read their fake seams. The app renders this one
// surface; there is no second, parallel foreign-chains section.
// ============================================================================

import { useEffect, useMemo, useState, type ReactElement } from "react";

import { createForeignChainRegistry } from "@ancientpantheon/codex-core";
import { ARWEAVE_CHAIN_ID } from "@ancientpantheon/codex-arweave/address-book";
import {
  ArweavePanel,
  ArweavePanelProvider,
  type ArweavePanelDeps,
  type PanelAddressBookEntry,
} from "@ancientpantheon/codex-arweave/panel";
import {
  ChainwebPanel,
  CodexTabs,
  type CodexTabKey,
} from "@ancientpantheon/codex-ouronet/ui";
import {
  useAddressBook,
  useCodexAuth,
  useOuroAccounts,
  useStoaChainSeeds,
} from "@ancientpantheon/codex-ouronet/hooks";
import { useCodexStore } from "@ancientpantheon/codex-ouronet/provider";
import { curveOf } from "@ancientpantheon/codex-ouronet/codex-identity";
import type {
  AddressBookEntry,
  IOuroAccount,
  IStoaChainSeed,
} from "@ancientpantheon/codex-ouronet/types";
import type { ForeignChainPanels } from "@ancientpantheon/codex-ui/ui/foreign-chains";
import { encryptStringV2, smartDecrypt } from "@stoachain/stoa-core/crypto";

import type { GatewayPool } from "@ancientpantheon/arweave-core";
import type { ForeignChainAdapter, ForeignKeyEntry } from "@ancientpantheon/codex-core";

import { createWorkerKeygenRunner } from "@ancientpantheon/codex-arweave/keygen";

import { buildMockPanelDeps, createMockArweaveAdapter } from "./mockArweaveAdapter";
import {
  buildRealPanelDeps,
  createArweaveKeyPersistence,
  createKeygenWorker,
  createRealArweaveAdapter,
} from "./realArweaveAdapter";
import { DEFAULT_GATEWAY_URL } from "./ArweaveModeToggle";

/**
 * The Class 2 rail id for Chainweb. It is the CHAIN-RAIL vocabulary shared with
 * `ForeignChainAdapter.id` / `ForeignKeyEntry.chainId` — deliberately NOT
 * `STOACHAIN_CHAIN_ID` ("kadena:mainnet"), which is the ADDRESS-BOOK chain id in
 * a different namespace. Chainweb contributes a PANEL only (its keys live in the
 * codex itself), so it has no registry adapter and is appended to the rail
 * behind the registry's own ids.
 */
export const CHAINWEB_RAIL_ID = "chainweb";

/**
 * Map the CODEX address-book slice onto the panel's `addressBook` seam.
 *
 * The Address Book tab stores an Arweave recipient as `type: "arweave"` and
 * writes NO `chainId`, while `SendArea` filters its seam by
 * `chainId === ARWEAVE_CHAIN_ID` — so the chain has to be derived HERE or a
 * saved Arweave address never reaches the recipient picker. Entries of other
 * kinds keep whatever `chainId` they carry (usually none) and are therefore
 * filtered out by the Send area, exactly as intended.
 */
export function toPanelAddressBook(
  entries: AddressBookEntry[],
): PanelAddressBookEntry[] {
  return entries.map((entry) => ({
    id: entry.id,
    name: entry.name,
    address: entry.address,
    chainId: entry.type === "arweave" ? ARWEAVE_CHAIN_ID : entry.chainId,
  }));
}

/**
 * Option 2's candidate shape in `ArweaveSeedsArea` (`ArweaveSeedAccountSource`):
 * an Ouronet account whose private key ALREADY is a 1600-bit DALOS bitstring.
 *
 * Declared structurally HERE rather than imported because codex-arweave's
 * `./panel` barrel does not export the Seeds-area prop types — the app can only
 * reach them through a deep source path, which resolves under the playground's
 * src alias but NOT through the package's `exports` map. Structural typing makes
 * this assignable to the component's prop the moment the panel forwards it.
 */
export interface ArweaveSeedAccountSource {
  id: string;
  label: string;
  account: IOuroAccount;
  /** The default selection — CodexPrime. */
  isDefault?: boolean;
}

/**
 * Map the codex's Ouronet accounts onto Option 2 of the Arweave define-seed
 * flow: the ACTIVATED (`isActive === true`), `dalos`-curve accounts — WITH ONE
 * carve-out, the prime account is offered regardless of activation.
 *
 * The filters are load-bearing:
 *   - `dalos` only — design.md defers APOLLO (1024-bit) bitstrings, and
 *     `resolveSeedBitString` REFUSES anything that is not exactly 1600 bits
 *     rather than padding it, so an Apollo row could only ever fail.
 *   - activated, UNLESS PRIME — an unactivated non-prime account is not a
 *     usable Ouronet identity yet, so offering it would seed Arweave material
 *     off a half-made account. The prime/CodexPrime account is exempted: it is
 *     the Codex's central, long-lived identity, and `isActive` tracks ON-CHAIN
 *     registration only — a fact with no bearing on whether its private key
 *     material can be decrypted. Requiring it anyway hid CodexPrime from
 *     `ouronetAccounts` whenever the real account had never been activated,
 *     which left Quick Define (and Option 2) permanently disabled with "No
 *     default (CodexPrime) Ouronet account exists in this Codex" even though
 *     CodexPrime very much existed — the reported bug this carve-out fixes.
 *
 * `curveOf` (codex-identity, T1) is the single source of the curve decision: it
 * prefers the recorded `originCurve` and falls back to the address prefix, so
 * accounts written before `originCurve` existed still classify correctly.
 */
export function toArweaveSeedAccounts(
  accounts: IOuroAccount[],
): ArweaveSeedAccountSource[] {
  return accounts
    .filter(
      (account) =>
        (account.isActive === true || account.isPrime === true) &&
        curveOf(account) === "dalos" &&
        // The Seed-Based generator's whole premise is that its 1600 bits
        // come from words — an account made from a bitmap/bitstring/scalar
        // has none to show and belongs exclusively to the (separate) Direct
        // generator. A missing originMode (a legacy account predating that
        // field) defaults to "seedWords", matching `bitStringOf`'s own
        // fallback — it is NOT treated as "no words".
        (account.originMode ?? "seedWords") === "seedWords",
    )
    .map((account) => ({
      id: account.id,
      label: account.name ?? account.address,
      account,
      isDefault: account.isPrime === true,
    }));
}

/**
 * Option 3's candidate shape in `ArweaveSeedsArea` (`ArweaveSeedChainwebSource`):
 * an existing Chainweb (StoaChain) seed, captured directly.
 *
 * Carries NO words: the seed's mnemonic stays encrypted in the store and is
 * decrypted LAZILY, for the one seed the user picks, through
 * {@link createRevealSeedWords}. Mapping every seed eagerly would hold every
 * mnemonic of the Codex in memory just to paint a `<select>`.
 *
 * Declared structurally here for the same reason as
 * {@link ArweaveSeedAccountSource} — codex-arweave's `./panel` barrel does not
 * export the Seeds-area prop types.
 */
export interface ArweaveSeedChainwebSource {
  id: string;
  label: string;
  /** The default selection — the Prime Codex Seed. */
  isDefault: boolean;
}

/**
 * Map the codex's Chainweb seeds onto Option 3 of the define-seed flow.
 *
 * The label follows the Chainweb Seed Words surface exactly
 * (`SeedWordsTab`/`StoaAccountsTab`): the prime seed is "Prime Codex Seed" (it
 * carries no `name`, so without this it would render as a blank row) and any
 * other seed falls back to its position. The prime seed is also design.md's
 * default selection for Option 3.
 */
export function toArweaveSeedChainwebSources(
  seeds: IStoaChainSeed[],
): ArweaveSeedChainwebSource[] {
  return seeds.map((seed, i) => ({
    id: seed.id,
    label: seed.isPrime === true ? "Prime Codex Seed" : seed.name || `Seed #${i + 1}`,
    isDefault: seed.isPrime === true,
  }));
}

/**
 * Build Option 2's unlock-gated reveal seam: decrypt ONE account's stored
 * `secret` so the Seeds area can re-derive its 1600-bit DALOS bitstring.
 *
 * The decrypt recipe is `ViewSeedModal`'s, verbatim — `smartDecrypt(
 * account.secret, getCurrentPassword())` — so a secret written under either the
 * V1 or the V2 envelope is readable.
 *
 * RETURNS `null` on every failure (unknown account, locked codex, wrong
 * password) and NEVER throws: the area renders a `null` as an inline "could not
 * read the key material" refusal, while an escaping throw would surface as an
 * unhandled rejection. The plaintext is returned to the caller and never logged,
 * stored or cached here.
 */
export function createRevealAccountSecret({
  accounts,
  getPassword,
}: {
  accounts: readonly IOuroAccount[];
  getPassword: () => string;
}): (accountId: string) => Promise<string | null> {
  return async (accountId: string): Promise<string | null> => {
    const account = accounts.find((entry) => entry.id === accountId);
    if (account === undefined) return null;
    try {
      // `getPassword()` throws on a locked codex — inside the try on purpose.
      return await smartDecrypt(account.secret, getPassword());
    } catch {
      return null;
    }
  };
}

/**
 * Build Option 3's LAZY reveal seam: decrypt ONE Chainweb seed's mnemonic and
 * split it into the words the DALOS ellipse converts.
 *
 * The split is what makes this usable: the store holds the mnemonic as a single
 * ciphertext STRING, and handing that string over whole would be read as one
 * 12-word-long "word" and resolve to a different bitstring — i.e. a seed that
 * silently does not match the Chainweb seed it claims to be.
 *
 * Same failure contract as {@link createRevealAccountSecret}: `null`, never a
 * throw.
 */
export function createRevealSeedWords({
  seeds,
  getPassword,
}: {
  seeds: readonly IStoaChainSeed[];
  getPassword: () => string;
}): (seedId: string) => Promise<readonly string[] | null> {
  return async (seedId: string): Promise<readonly string[] | null> => {
    const seed = seeds.find((entry) => entry.id === seedId);
    if (seed === undefined) return null;
    try {
      const mnemonic = await smartDecrypt(seed.secret, getPassword());
      const words = mnemonic.trim().split(/\s+/).filter(Boolean);
      return words.length === 0 ? null : words;
    } catch {
      return null;
    }
  };
}

/**
 * A codex Arweave seed as the panel's Seeds area consumes it
 * (`ArweaveSeedRecord`): id, label, the 1600-bit `bits` and the prime marker.
 *
 * Declared structurally HERE for the same reason as
 * {@link ArweaveSeedAccountSource} — codex-arweave's `./panel` barrel does not
 * export the Seeds-area prop types.
 */
export interface PanelArweaveSeed {
  id: string;
  label: string;
  /** The 1600-bit DALOS bitstring. SECRET — decrypted from the codex only while
   *  it is unlocked; `""` when it could not be read (locked / wrong password),
   *  which still LISTS the seed rather than making it vanish. */
  bits: string;
  isPrime?: boolean;
}

/** The codex's stored Arweave seed. Structural (the `/types` barrel does not
 *  re-export `IArweaveSeed`); `secret` is CIPHERTEXT. */
export interface StoredArweaveSeed {
  id: string;
  name?: string;
  secret: string;
  createdAt: string;
  isPrime?: boolean;
}

/** The label a stored seed shows. The Prime Arweave Seed keeps its name even if
 *  the row was stored without one — a blank row would read as "undefined seed",
 *  which is exactly what the Seeds area renders for a seed that does NOT exist. */
function labelOfStoredSeed(seed: StoredArweaveSeed): string {
  const name = seed.name?.trim();
  if (name !== undefined && name !== "") return name;
  return seed.isPrime === true ? "Prime Arweave Seed" : "Arweave Seed";
}

/**
 * Map the codex's stored Arweave seeds onto the panel's seed records.
 *
 * PURE and SYNCHRONOUS on purpose: the row must appear the instant the panel
 * mounts. The seed is stored as CIPHERTEXT, so the bitstring arrives separately
 * through {@link revealArweaveSeedBits} and is looked up here by id — a seed
 * whose bits are not (yet) readable still LISTS, with `bits: ""`. Deriving the
 * list from the decrypt instead would blank the Seeds area for as long as the
 * PBKDF2 unseal takes, i.e. show "Prime Arweave Seed — undefined" for a seed
 * that very much exists.
 */
export function toPanelArweaveSeeds(
  seeds: readonly StoredArweaveSeed[],
  bitsById: Readonly<Record<string, string>> = {},
): PanelArweaveSeed[] {
  return seeds.map((seed) => {
    const record: PanelArweaveSeed = {
      id: seed.id,
      label: labelOfStoredSeed(seed),
      bits: bitsById[seed.id] ?? "",
    };
    if (seed.isPrime !== undefined) record.isPrime = seed.isPrime;
    return record;
  });
}

/**
 * Unseal the stored seeds' 1600-bit bitstrings — the unlock-gated reveal seam
 * for the Arweave seeds, the counterpart of {@link createRevealAccountSecret}.
 *
 * Returns an id → bits map. NEVER throws and never logs: a locked codex (or a
 * seed sealed under an older password) simply contributes no entry for that
 * seed, which leaves its row listed but without material — a seed that
 * disappears is the bug this slice exists to fix, and a throw here would take
 * the whole Seeds area down with it.
 */
export async function revealArweaveSeedBits(
  seeds: readonly StoredArweaveSeed[],
  getPassword: () => string,
): Promise<Record<string, string>> {
  const entries = await Promise.all(
    seeds.map(async (seed): Promise<[string, string] | null> => {
      try {
        // `getPassword()` throws on a locked codex — inside the try on purpose.
        return [seed.id, await smartDecrypt(seed.secret, getPassword())];
      } catch {
        return null;
      }
    }),
  );
  return Object.fromEntries(entries.filter((e): e is [string, string] => e !== null));
}

/**
 * Build the define-seed PERSIST seam: seal a newly defined seed at the codex
 * password and hand it to the store.
 *
 * RECOVERY-CRITICAL and the fix for the reported bug — before this, a defined
 * seed lived in `ArweavePanel` state and was destroyed the moment the Class-2
 * chain rail unmounted the panel, leaving its RSA keys orphaned in Accounts
 * with nothing able to regenerate them.
 *
 * The plaintext bitstring exists only as the argument: what leaves is the
 * `encryptStringV2` ciphertext (the same V2 envelope account secrets and
 * foreign keys use, so ONE codex password unlocks everything). It is never
 * logged, never stored in the clear and never put in an error message.
 *
 * KNOWN GAP, not a silent one: `rekeyCodex`'s secret inventory
 * (`codex-ouronet/src/rekey/index.ts`) does not yet walk `arweaveSeeds`, so a
 * codex-password change re-encrypts every OTHER secret and leaves these sealed
 * under the old password. The snapshot keeps them (structuredClone), but they
 * stop decrypting until that inventory gains the slice.
 *
 * `isPrime` is deliberately NOT forwarded: the codex owns primality (the first
 * seed it ever stores becomes the Prime Arweave Seed), so the UI's positional
 * notion can never conflict with the store's.
 */
export function createArweaveSeedPersistence({
  getPassword,
  addArweaveSeed,
}: {
  getPassword: () => string;
  addArweaveSeed: (seed: StoredArweaveSeed) => Promise<void>;
}): (seed: PanelArweaveSeed) => Promise<void> {
  return async (seed: PanelArweaveSeed): Promise<void> => {
    const secret = await encryptStringV2(seed.bits, getPassword());
    await addArweaveSeed({
      id: seed.id,
      name: seed.label,
      secret,
      createdAt: new Date().toISOString(),
    });
  };
}

/** What a seed deletion must remove — the seed's OWN key ids, resolved by the
 *  Seeds area from the entries it already holds. Mirrors the area's
 *  `ArweaveSeedDeletion` (which the panel barrel does not export). */
export interface ArweaveSeedDeletionRequest {
  seedId: string;
  keyIds: readonly string[];
}

/**
 * Build the seed→keys delete cascade: remove every `ForeignKeyEntry` the deleted
 * seed produced. Without it the seed row disappears and its RSA keys ORPHAN in
 * Arweave → Accounts — entries no seed can ever regenerate, which is exactly
 * what design.md rules out.
 *
 * SEQUENTIAL, deliberately: the store's `deleteForeignKey` is a read-modify-write
 * over the whole `foreignKeys` slice followed by a full-snapshot save, so firing
 * them in parallel would have each call start from the same pre-delete array and
 * resurrect the keys of its siblings.
 */
export function createSeedKeyDeleter({
  deleteForeignKey,
  deleteArweaveSeed,
}: {
  deleteForeignKey: (id: string) => Promise<void>;
  /** Removes the SEED itself from the codex. Optional so the pure key-cascade
   *  contract still stands on its own; wired, the delete is complete — seed and
   *  keys gone together, which is what design.md requires. */
  deleteArweaveSeed?: (id: string) => Promise<void>;
}): (request: ArweaveSeedDeletionRequest) => Promise<void> {
  return async ({ seedId, keyIds }: ArweaveSeedDeletionRequest): Promise<void> => {
    for (const id of keyIds) {
      await deleteForeignKey(id);
    }
    // The seed goes LAST: if a key delete fails, the seed that can regenerate
    // that key is still there.
    await deleteArweaveSeed?.(seedId);
  };
}

/** The mock wiring mode — the default, funds-safe, offline path. */
export const ARWEAVE_WIRING_MODE_MOCK = "mock" as const;

/** The real wiring mode — OPT-IN. Constructs the E1-E3 stack against a gateway. */
export const ARWEAVE_WIRING_MODE_REAL = "real" as const;

/** The set of Arweave wiring modes: the default mock and the opt-in real path. */
export type ArweaveWiringMode =
  | typeof ARWEAVE_WIRING_MODE_MOCK
  | typeof ARWEAVE_WIRING_MODE_REAL;

/**
 * The panel-deps bundle with the Arweave-seed seams the app resolves out of the
 * codex narrowed to the concrete (non-optional) app-side shapes.
 *
 * `ArweavePanelDeps` declares every one of these OPTIONAL — a host that omits
 * one leaves exactly that affordance disabled. The playground fills them ALL,
 * and `ArweavePanel` forwards each straight through to `ArweaveSeedsArea`, so
 * the narrowing here is what documents that no seed affordance is left dark.
 */
export type WiredArweavePanelDeps = ArweavePanelDeps & {
  /** The codex's persisted Arweave seeds, decrypted for this session. The panel
   *  READS its seed list from here instead of owning it, which is what makes a
   *  defined seed survive the chain-rail switch that unmounts the panel.
   *  Not declared on `ArweavePanelDeps` (that file was out of scope for the fix);
   *  `ArweavePanel` reads both seed seams structurally. */
  arweaveSeeds: PanelArweaveSeed[];
  /** Persists a newly defined seed into the codex (ciphertext at rest). */
  onSeedDefined?: (seed: PanelArweaveSeed) => Promise<void>;
  /** Option 2's candidates: ACTIVATED, `dalos`-curve Ouronet accounts. */
  ouronetAccounts: ArweaveSeedAccountSource[];
  /** Option 3's candidates: the codex's Chainweb seeds (no words — lazy). */
  chainwebSeeds: ArweaveSeedChainwebSource[];
  /** The seeded RSA-4096 batch worker. Its presence is half the gate on the
   *  Seeds area's Generate button (`persistKey` is the other half). */
  workerFactory: () => Worker;
};

/** The assembled wiring the tab + the panel context consume. */
export interface ArweaveWiring {
  /** The injected id list — `registry.list()`, in registration order. */
  foreignChains: string[];
  /** The id → panel-component slot map the generic tab dispatches through. */
  foreignChainPanels: ForeignChainPanels;
  /** The E4 injected-seam bundle fed into the panel context provider. */
  panelDeps: WiredArweavePanelDeps;
}

export interface BuildArweaveWiringOptions {
  /** The wiring mode. Mock is the funds-safe default; real is opt-in. */
  mode: ArweaveWiringMode;
  /** The codex address book, already mapped to the panel seam shape (see
   *  {@link toPanelAddressBook}). Feeds the Send recipient picker. */
  addressBook?: PanelAddressBookEntry[];
  /** The user-configured gateway URL fed to `createGatewayPool` in real mode.
   *  Defaults to the testnet/local `DEFAULT_GATEWAY_URL` (never mainnet). */
  gatewayUrl?: string;
  /** An injected gateway pool for real mode — automated tests pass a FAKE pool
   *  so the "real" path is exercised with ZERO live network. */
  pool?: GatewayPool;
  /** The codex's REAL foreign-key slice (ciphertext-only). Arweave → Accounts
   *  lists these grouped by the seed that produced them, so an empty Codex
   *  shows the empty state and never a demo entry. */
  foreignKeys?: ForeignKeyEntry[];
  /** The codex's Arweave seeds, already decrypted by
   *  {@link toPanelArweaveSeeds}. Empty means the Codex has no seed yet — the
   *  Seeds area then shows the undefined Prime Arweave Seed row. */
  arweaveSeeds?: PanelArweaveSeed[];
  /** The define-seed persist seam ({@link createArweaveSeedPersistence}). */
  onSeedDefined?: (seed: PanelArweaveSeed) => Promise<void>;
  /** Option 2's candidates, already filtered by {@link toArweaveSeedAccounts}. */
  ouronetAccounts?: ArweaveSeedAccountSource[];
  /** Option 2's unlock-gated reveal seam ({@link createRevealAccountSecret}). */
  revealAccountSecret?: (accountId: string) => Promise<string | null>;
  /** Option 3's candidates ({@link toArweaveSeedChainwebSources}). */
  chainwebSeeds?: ArweaveSeedChainwebSource[];
  /** Option 3's LAZY mnemonic reveal seam ({@link createRevealSeedWords}). */
  revealSeedWords?: (seedId: string) => Promise<readonly string[] | null>;
  /** The seed → keys delete cascade ({@link createSeedKeyDeleter}). */
  onDeleteSeed?: (request: ArweaveSeedDeletionRequest) => Promise<void>;
  /** The seeded-keygen worker factory. Defaults to the app's real bundler-built
   *  worker; tests inject a fake (jsdom has no `Worker`). */
  workerFactory?: () => Worker;
  /** The codex password reader (`useCodexAuth().getCurrentPassword`). Supplying
   *  it ARMS the encrypt-at-rest persist path in BOTH modes. */
  getPassword?: () => string;
  /** The codex store's `addForeignKey` action — where a generated key lands. */
  addForeignKey?: (entry: ForeignKeyEntry) => Promise<void>;
  /** The codex store's `deleteForeignKey` action — where a deleted key leaves. */
  deleteForeignKey?: (id: string) => Promise<void>;
}

/**
 * Build the mode's Arweave wiring: a fresh registry with the mode's adapter
 * registered, the `foreignChains` id list, the `foreignChainPanels` slot map,
 * and the panel-context deps. Mode-swappable — `mode === "real"` swaps the mock
 * adapter + fake seams for the real E1-E3 stack against the configured gateway.
 *
 * FUNDS-SAFETY: the real adapter/pool is constructed ONLY in the `mode === "real"`
 * branch. The default mock path never reaches `createRealArweaveAdapter`, so
 * building the default wiring opens no network connection.
 */
export function buildArweaveWiring({
  mode,
  gatewayUrl = DEFAULT_GATEWAY_URL,
  pool,
  addressBook = [],
  foreignKeys = [],
  arweaveSeeds = [],
  onSeedDefined,
  ouronetAccounts = [],
  revealAccountSecret,
  chainwebSeeds = [],
  revealSeedWords,
  onDeleteSeed,
  workerFactory = createKeygenWorker,
  getPassword,
  addForeignKey,
  deleteForeignKey,
}: BuildArweaveWiringOptions): ArweaveWiring {
  const registry = createForeignChainRegistry();

  // The encrypt-at-rest persist path behind `ArweavePanel.persistKey`. ARMED
  // whenever the caller wired the codex password; unarmed it is left to the
  // mode's own (refusing / inert) keyring seams.
  const persistence =
    getPassword === undefined
      ? null
      : createArweaveKeyPersistence({
          getPassword,
          addForeignKey: addForeignKey ?? (async () => {}),
          deleteForeignKey,
        });

  let adapter: ForeignChainAdapter;
  let baseDeps: ArweavePanelDeps;

  if (mode === ARWEAVE_WIRING_MODE_REAL) {
    // OPT-IN real path — constructs the E1 adapter + E3 seams against the
    // configured gateway (or the injected fake pool in tests). Reached ONLY here.
    adapter = createRealArweaveAdapter({ gatewayUrl, pool });
    baseDeps = buildRealPanelDeps({
      gatewayUrl,
      pool,
      adapter,
      addressBook,
      foreignKeys,
      workerFactory,
      getPassword,
      addForeignKey,
      deleteForeignKey,
    });
  } else {
    // The mock path (the default, funds-safe, offline). No network, no real keys.
    // The keyring LIST is still the codex's own slice — it is codex-local data,
    // not a network seam, and faking it hides the user's keys from Accounts.
    //
    // The PERSIST path is real here too, and deliberately so: a seeded key is
    // produced by the REAL RSA-4096 worker out of the user's own 1600-bit seed —
    // local cryptography with no network and no funds — so "mock mode" has no
    // fake version of it to offer. Left inert (mock's no-op `addForeignKey`) a
    // generated key would be dropped after ~6.7 s of CPU EACH, and the Seeds
    // area's Generate button would stay disabled, since it is gated on the
    // persist seam. Mock's NETWORK seams (send/upload/gateway) stay fakes.
    adapter = createMockArweaveAdapter();
    baseDeps = {
      ...buildMockPanelDeps({ addressBook, foreignKeys }),
      ...(persistence ?? {}),
      // Pure Keys' "Create Random Key" rides `deps.keygenRunner` straight into
      // the now-REAL `generateArweaveKey` above (armed whenever `persistence`
      // is). Left as the mock's scripted `FakeKeygenRunner` (an all-empty-field
      // placeholder JWK), the real `generateArweaveKey` -> `addressOf` throws
      // (`n` decodes to 0 bytes, not the 512-byte RSA-4096 modulus) — surfacing
      // as "Key generation failed" for every pure-key random generation. The
      // REAL worker-driven runner is the same one `buildRealPanelDeps` uses.
      ...(persistence !== null
        ? { keygenRunner: createWorkerKeygenRunner({ workerFactory }) }
        : {}),
    };
  }

  // The seed seams ride alongside the E1-E3 seams in both modes: they are
  // codex-local reads (no network, no funds), so the mode does not change them.
  const panelDeps: WiredArweavePanelDeps = {
    ...baseDeps,
    arweaveSeeds,
    onSeedDefined,
    ouronetAccounts,
    revealAccountSecret,
    chainwebSeeds,
    revealSeedWords,
    workerFactory,
    onDeleteSeed,
  };

  registry.register(adapter);

  // The app (never codex-ui) maps the concrete panels into the id slots. This is
  // the Class 2 rail: Arweave (the registry adapter this module owns) plus
  // Chainweb (panel-only — `ChainwebPanel` re-parents the Seed Words / Pure Key
  // Pairs / Stoa Accounts surfaces under its own category strip).
  const foreignChainPanels: ForeignChainPanels = {
    [ARWEAVE_CHAIN_ID]: ArweavePanel,
    [CHAINWEB_RAIL_ID]: ChainwebPanel,
  };

  // Registry ids lead the rail (so the landing panel is the one this wiring's
  // adapter backs); Chainweb, which contributes no adapter, follows.
  return {
    foreignChains: [...registry.list(), CHAINWEB_RAIL_ID],
    foreignChainPanels,
    panelDeps,
  };
}

export interface ForeignChainsWiringProps {
  /** The wiring mode; defaults to mock+offline (funds-safety). */
  mode?: ArweaveWiringMode;
  /** The gateway URL fed to the real wiring (ignored in mock mode). */
  gatewayUrl?: string;
  /** An injected gateway pool for real mode (tests pass a fake — no live network). */
  pool?: GatewayPool;
  /** Forwarded to `CodexTabs` (the shell keeps its own layout hook). */
  className?: string;
  /** Forwarded to `CodexTabs`; defaults to its own landing Class tab. */
  defaultTab?: CodexTabKey;
}

/**
 * The wired Codex tab shell: `CodexTabs` fed the injected `foreignChains` id
 * list + `foreignChainPanels` slot map, wrapped in the `ArweavePanelProvider` so
 * the mounted `ArweavePanel` + its 5 areas read their (fake, in mock mode) E1-E3
 * seams.
 *
 * The SHELL lives here rather than in `App.tsx` because this module already owns
 * everything Class 2 needs — the registry, the id → panel map, `CHAINWEB_RAIL_ID`
 * and the address-book mapping. Rendering a bare `<CodexTabs />` in the app and
 * the rail beside it produced TWO disconnected surfaces: the Blockchain Accounts
 * Class tab showed "No foreign chains." while the working rail sat below it.
 * There is exactly one wired surface now, and Class 2 is the rail's only home.
 *
 * Must be mounted INSIDE `<CodexProvider>`: every codex-local seam it feeds the
 * panel — the address book behind the Send recipient picker, the `foreignKeys`
 * slice behind Arweave → Accounts, and the Ouronet accounts behind the Arweave
 * seed flow's Option 2 — is read out of the mounted store, never faked.
 */
export function ForeignChainsWiring({
  mode = ARWEAVE_WIRING_MODE_MOCK,
  gatewayUrl,
  pool,
  className,
  defaultTab,
}: ForeignChainsWiringProps = {}): ReactElement {
  // The REAL codex address book (never a fake): mapped into the panel seam so a
  // saved Arweave address is selectable as a Send recipient.
  const { entries } = useAddressBook();
  const addressBook = useMemo(() => toPanelAddressBook(entries), [entries]);

  // The REAL foreign-key slice behind Arweave → Accounts. Read through the store
  // selector (there is no exported `useForeignKeys` on the public hooks barrel),
  // so the list re-renders as keys are added. The slice is chain-agnostic — the
  // Arweave panel does the `chainId` filtering, exactly as the Chainweb rail
  // would do for its own entries.
  const store = useCodexStore();
  const foreignKeys = store((s) => s.foreignKeys);

  const actions = store((s) => s.actions);

  // The codex password, read at CALL time by the seams below. `getCurrentPassword`
  // THROWS on a locked codex — the reveal seams convert that into their `null`
  // refusal, while the persist path lets it through so a key is never silently
  // "stored" nowhere.
  const { getCurrentPassword, isLocked } = useCodexAuth();

  // Option 2 of the define-seed flow: the codex's ACTIVATED dalos-curve accounts,
  // plus the unlock-gated reveal of the picked account's key material.
  const { accounts } = useOuroAccounts();
  const ouronetAccounts = useMemo(() => toArweaveSeedAccounts(accounts), [accounts]);
  const revealAccountSecret = useMemo(
    () => createRevealAccountSecret({ accounts, getPassword: getCurrentPassword }),
    [accounts, getCurrentPassword],
  );

  // Option 3: the codex's Chainweb seeds. Only id/label are mapped — the
  // mnemonic is decrypted LAZILY, for the one seed the user picks.
  const { seeds: storedChainwebSeeds } = useStoaChainSeeds();
  const chainwebSeeds = useMemo(
    () => toArweaveSeedChainwebSources(storedChainwebSeeds),
    [storedChainwebSeeds],
  );
  const revealSeedWords = useMemo(
    () =>
      createRevealSeedWords({
        seeds: storedChainwebSeeds,
        getPassword: getCurrentPassword,
      }),
    [storedChainwebSeeds, getCurrentPassword],
  );

  // The REAL Arweave-seed slice. Read from the store (not panel state) so a
  // defined seed survives the Class-2 chain switch that unmounts the panel —
  // the reported bug. Stored seeds are ciphertext, so the bitstrings the Seeds
  // area needs are unsealed in an effect under the codex password.
  const storedArweaveSeeds = store((s) => s.arweaveSeeds);
  const [seedBits, setSeedBits] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    void revealArweaveSeedBits(storedArweaveSeeds, getCurrentPassword).then(
      (bits) => {
        if (!cancelled) setSeedBits(bits);
      },
    );
    // Dropping the decrypted bitstrings on unmount keeps them in memory no
    // longer than the surface that needs them.
    return () => {
      cancelled = true;
    };
    // `isLocked` is a REAL dependency, not noise: unlocking the codex changes
    // nothing about the seed list itself, but it is what makes the bitstrings
    // readable — without it a seed listed while locked would stay `bits: ""`
    // for the rest of the session.
  }, [storedArweaveSeeds, getCurrentPassword, isLocked]);
  // The LIST is synchronous (rows appear immediately); only the material waits.
  const arweaveSeeds = useMemo(
    () => toPanelArweaveSeeds(storedArweaveSeeds, seedBits),
    [storedArweaveSeeds, seedBits],
  );

  const onSeedDefined = useMemo(
    () =>
      createArweaveSeedPersistence({
        getPassword: getCurrentPassword,
        addArweaveSeed: actions.addArweaveSeed,
      }),
    [actions, getCurrentPassword],
  );

  // Deleting a seed takes its RSA keys AND the seed itself — otherwise the keys
  // orphan in Arweave → Accounts with no seed able to regenerate them, or the
  // seed reappears on the next mount because only the row was cleared.
  const onDeleteSeed = useMemo(
    () =>
      createSeedKeyDeleter({
        deleteForeignKey: actions.deleteForeignKey,
        deleteArweaveSeed: actions.deleteArweaveSeed,
      }),
    [actions],
  );

  const { foreignChains, foreignChainPanels, panelDeps } = buildArweaveWiring({
    mode,
    gatewayUrl,
    pool,
    addressBook,
    foreignKeys,
    arweaveSeeds,
    onSeedDefined,
    ouronetAccounts,
    revealAccountSecret,
    chainwebSeeds,
    revealSeedWords,
    onDeleteSeed,
    // The persist path: encrypt-at-rest under the codex password, then into the
    // REAL foreign-key slice — which is what makes a generated key survive and
    // show up in Arweave → Accounts.
    getPassword: getCurrentPassword,
    addForeignKey: actions.addForeignKey,
    deleteForeignKey: actions.deleteForeignKey,
  });

  return (
    <ArweavePanelProvider deps={panelDeps}>
      <CodexTabs
        className={className}
        defaultTab={defaultTab}
        foreignChains={foreignChains}
        foreignChainPanels={foreignChainPanels}
      />
    </ArweavePanelProvider>
  );
}

export default ForeignChainsWiring;
