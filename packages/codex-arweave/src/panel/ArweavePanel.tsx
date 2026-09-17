/**
 * ArweavePanel — the Arweave chain panel contributed into codex-ui's generic
 * `ForeignChainsTab` slot.
 *
 * Conforms to codex-ui's chain-agnostic `PanelProps` (`{ id, ctx? }`, imported
 * TYPE-ONLY via the bare package name so the edge erases at build), so the E5
 * consumer can wire `foreignChainPanels[ARWEAVE_CHAIN_ID] = ArweavePanel`. It
 * hosts the chain's own CATEGORY strip — the Class IA spine (Seeds / Pure Keys /
 * Accounts) plus the two Arweave-specific categories (Upload / Library) — over
 * the existing areas, and reads its E1-E3 seams from the panel context; the
 * codex-ui slot stays chain-blind; the Arweave panel obtains its own seams here.
 * `seeds` is the ONE category with no implementation (seeded RSA-4096 keygen is
 * deferred): it renders an explicit "not yet wired" placeholder, never a blank
 * panel and never a throw.
 *
 * The category id vocabulary is namespaced off the ARWEAVE_CHAIN_ID const — the
 * chain id string is never re-spelled here.
 *
 * SEED STATE IS THE HOST'S, not this panel's. Switching the Class-2 chain rail
 * unmounts the WHOLE panel, so a seed kept in panel state was destroyed on every
 * chain switch while the RSA keys it produced survived in the codex — orphans no
 * seed could ever regenerate. The panel therefore READS the seeds from the
 * injected deps (`arweaveSeeds`) and DELEGATES define/delete outward
 * (`onSeedDefined` / `onDeleteSeed`), so the codex owns them.
 *
 * What stays local is the SESSION overlay: a seed defined in this session is
 * also kept here, because its record carries the plaintext bitstring the
 * generate flow needs and the host's copy is ciphertext at rest. The overlay is
 * merged ON TOP of the host list by id, and pruned on delete so a deleted seed
 * cannot come back. A host that wires neither seam still gets the previous
 * session-only behaviour — degraded, never broken.
 *
 * The panel is also the only place that can hand the SAME seed list to both
 * wired categories, so Accounts can group keys under the seed that produced them.
 */

import * as React from "react";
import { useCallback, useContext, useEffect, useMemo, useState } from "react";

import type { PanelProps } from "@ancientpantheon/codex-ui";
import type { ForeignKeyEntry } from "@ancientpantheon/codex-core";
import type { WatchListEntry } from "@ancientpantheon/codex-ouronet/types";

import { ARWEAVE_CHAIN_ID } from "../address-book/chainId.js";
import { ArweavePanelContext } from "./context.js";
import { ArweaveAccountsArea } from "./ArweaveAccountsArea.js";
import { PureKeysArea } from "./PureKeysArea.js";
import {
  ArweaveSeedsArea,
  type ArweaveSeedDeletion,
  type ArweaveSeedRecord,
  type GeneratedArweaveKey,
} from "./ArweaveSeedsArea.js";


/**
 * The store-backed seed seams the HOST wires alongside `ArweavePanelDeps`.
 *
 * Read STRUCTURALLY (a narrowing of the injected deps object) rather than
 * declared on `ArweavePanelDeps` itself: that interface lives in `context.tsx`,
 * which this change does not own. Both members are optional, so a host that
 * wires neither is exactly the old session-only panel; the playground wiring
 * types them explicitly on its own deps bundle. Fold them into
 * `ArweavePanelDeps` (and drop this local shape) when that file is next open.
 */
interface ArweaveSeedStoreSeams {
  /** The codex's persisted Arweave seeds — the list that survives a chain
   *  switch. Their `bits` are whatever the host could resolve (the codex stores
   *  the seed as CIPHERTEXT; an unlocked host decrypts, a locked one cannot). */
  arweaveSeeds?: readonly ArweaveSeedRecord[];
  /** Persists a newly defined seed into the codex. Absent → session-only. */
  onSeedDefined?: (seed: ArweaveSeedRecord) => Promise<void> | void;
}

/**
 * The store-backed watch-list seams the HOST wires alongside `ArweavePanelDeps`
 * (T1) — same structural-narrowing pattern as {@link ArweaveSeedStoreSeams}.
 *
 * Reused from Chainweb's own `watchList` store slice (design.md), filtered to
 * this chain's WatchListEntry.type value by the host wiring — this panel
 * never reads a store itself. `ForeignChainsWiring.tsx`'s `WiredArweavePanelDeps` types the values
 * `| undefined` rather than declaring the keys optional (`?:`), so they are
 * read the same way here: present, but possibly unwired.
 */
interface ArweaveWatchListSeams {
  watchedAddresses: WatchListEntry[];
  addWatchedAddress: (address: string, label?: string) => Promise<void>;
  removeWatchedAddress: (id: string) => Promise<void>;
}


/** The Arweave chain's declared categories, in display order. */
const CATEGORIES = ["seeds", "pure-keys", "accounts", "upload", "library"] as const;
type CategoryId = (typeof CATEGORIES)[number];

/** Human labels for the category strip. */
const CATEGORY_LABELS: Record<CategoryId, string> = {
  seeds: "Seeds",
  "pure-keys": "Pure Keys",
  accounts: "Accounts",
  upload: "Upload",
  library: "Library",
};


/** Inline category glyphs. Deliberately NOT `lucide-react`: that package lives
 *  only at the repo root, where `react` resolves to the stale hoisted React 18,
 *  so importing it renders elements from a second React ("A React Element from
 *  an older version of React was rendered"). These few local SVGs keep the panel
 *  free of any icon-package resolution while matching lucide's stroke look. */
type Glyph = (p: { style?: React.CSSProperties }) => React.ReactElement;

const svgBase = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

const SeedsGlyph: Glyph = ({ style }) => (
  <svg {...svgBase} style={style}><path d="M7 20h10" /><path d="M12 20V9" /><path d="M12 9a5 5 0 0 1 5-5h3v3a5 5 0 0 1-5 5h-3Z" /><path d="M12 12H9a4 4 0 0 1-4-4V6h3a4 4 0 0 1 4 4v2Z" /></svg>
);
const KeysGlyph: Glyph = ({ style }) => (
  <svg {...svgBase} style={style}><circle cx="8" cy="15" r="4" /><path d="m10.85 12.15 7.4-7.4" /><path d="m18 5 3 3" /><path d="m15 8 2 2" /></svg>
);
const AccountsGlyph: Glyph = ({ style }) => (
  <svg {...svgBase} style={style}><path d="M12 2 22 12 12 22 2 12Z" /></svg>
);
const UploadGlyph: Glyph = ({ style }) => (
  <svg {...svgBase} style={style}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M17 8 12 3 7 8" /><path d="M12 3v13" /></svg>
);
const LibraryGlyph: Glyph = ({ style }) => (
  <svg {...svgBase} style={style}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" /></svg>
);

/** Icon + accent per category. Seeds / Pure Keys / Accounts deliberately reuse
 *  ChainwebPanel's colours so a shared category name reads the same on every
 *  chain; Upload / Library are Arweave-only and take their own accents. */
const CATEGORY_META: Record<CategoryId, { Icon: Glyph; color: string }> = {
  seeds: { Icon: SeedsGlyph, color: "#22c55e" },
  "pure-keys": { Icon: KeysGlyph, color: "#a78bfa" },
  accounts: { Icon: AccountsGlyph, color: "#ceac5f" },
  upload: { Icon: UploadGlyph, color: "#38bdf8" },
  library: { Icon: LibraryGlyph, color: "#f472b6" },
};

/** Category-button height. Matches the chain rail's row height in codex-ui's
 *  ForeignChainsTab so the vertical menu and this strip share a baseline. Kept
 *  local rather than imported: a layout number is not worth widening codex-ui's
 *  locked public surface. */
const CATEGORY_ROW_HEIGHT = 40;

/** Styling for the seed-persistence failure notice — the one surface that
 *  reports a seed the Codex refused to store. */
const SEED_ERROR_STYLE: React.CSSProperties = {
  marginBottom: 12,
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid #7f1d1d",
  backgroundColor: "#7f1d1d1a",
  color: "#fca5a5",
  fontSize: 13,
};

/** Placeholder styling for an unwired category — visible, never blank. */
const EMPTY_STYLE: React.CSSProperties = {
  padding: "24px",
  borderRadius: 12,
  border: "1px dashed #262626",
  color: "#666",
  fontSize: 13,
};

/** The full-panel backdrop behind the leave-generation confirm dialog (design.md
 *  ask A) — dims the tab strip and whichever area is still mounted underneath,
 *  so the choice reads as blocking rather than an inline aside. */
const LEAVE_DIALOG_BACKDROP_STYLE: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  backgroundColor: "#000000a0",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 50,
};

const LEAVE_DIALOG_STYLE: React.CSSProperties = {
  width: 380,
  maxWidth: "90vw",
  padding: 20,
  borderRadius: 12,
  border: "1px solid #262626",
  backgroundColor: "#111111",
  color: "#d2d3d4",
};

const LEAVE_DIALOG_BUTTON_ROW_STYLE: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 10,
  marginTop: 16,
};

const LEAVE_DIALOG_STOP_BUTTON_STYLE: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 8,
  border: "1px solid #7f1d1d",
  backgroundColor: "transparent",
  color: "#fca5a5",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

const LEAVE_DIALOG_CONTINUE_BUTTON_STYLE: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 8,
  border: "1px solid #ceac5f",
  backgroundColor: "#ceac5f",
  color: "#0a0a0a",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

/** The category the panel lands on — the one a user reaches for first. */
const DEFAULT_CATEGORY: CategoryId = "accounts";

export function ArweavePanel(_props: PanelProps): React.ReactElement {
  const [active, setActive] = useState<CategoryId>(DEFAULT_CATEGORY);

  /** The Seeds area's live run, reported up via `ArweaveSeedsArea`'s
   *  `onRunActivityChange` (T1) — non-null exactly while a generate run has
   *  `status === "running"`. Read by the tab strip below to intercept a
   *  category switch that would otherwise abandon it silently (design.md ask A:
   *  unmounting the area does not stop the worker, it just makes it invisible
   *  and uncancelable). */
  const [activeGeneration, setActiveGeneration] = useState<
    { seedLabel: string; cancel: () => void } | null
  >(null);
  /** The category a tab click asked for while `activeGeneration !== null` — set
   *  the moment the leave-generation dialog opens, applied once the user picks
   *  "Stop" or "Continue", and cleared either way. */
  const [pendingCategory, setPendingCategory] = useState<CategoryId | null>(null);

  /** Requests a switch to `id`. The `seeds` tab and a switch with no run active
   *  both proceed immediately, exactly as before this task — only a switch AWAY
   *  from an in-flight generation is intercepted. */
  const requestCategory = useCallback(
    (id: CategoryId): void => {
      if (id === "seeds" || activeGeneration === null) {
        setActive(id);
        return;
      }
      setPendingCategory(id);
    },
    [activeGeneration],
  );

  const handleStopGeneration = useCallback((): void => {
    activeGeneration?.cancel();
    setActiveGeneration(null);
    if (pendingCategory !== null) setActive(pendingCategory);
    setPendingCategory(null);
  }, [activeGeneration, pendingCategory]);

  const handleContinueInBackground = useCallback((): void => {
    // Deliberately does NOT call `cancel()` — the whole point of this choice is
    // that the run keeps going. `activeGeneration` is left as-is: the area may
    // still report it live (background run) or settle it to `null` on its own.
    if (pendingCategory !== null) setActive(pendingCategory);
    setPendingCategory(null);
  }, [pendingCategory]);

  // If the run settles on its own (finishes/errors/is cancelled elsewhere)
  // WHILE a switch is pending — between the tab click and the user picking
  // "Stop"/"Continue", or even before the dialog has painted — there is no
  // longer a background run to warn about, so the pending switch is applied
  // rather than left stranded with the dialog closed and `active` never
  // updated (a click that silently did nothing).
  useEffect(() => {
    if (activeGeneration === null && pendingCategory !== null) {
      setActive(pendingCategory);
      setPendingCategory(null);
    }
  }, [activeGeneration, pendingCategory]);

  // Native browser prompt for the OTHER way to abandon a run: closing the tab
  // or refreshing. `beforeunload` cannot show custom copy — only the browser's
  // own "leave site?" chrome — so this is intentionally the bare standard
  // pattern, not an attempt at the dialog above.
  useEffect(() => {
    if (activeGeneration === null) return;
    const handler = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [activeGeneration]);

  // The injected seams, read OPTIONALLY (not through `useArweavePanelDeps`,
  // which throws): a consumer that has not wired the provider yet still gets a
  // working read-only panel rather than a crash.
  const deps = useContext(ArweavePanelContext);

  /** The host's store-backed seed seams (see {@link ArweaveSeedStoreSeams}). */
  const seedSeams = deps as (typeof deps & ArweaveSeedStoreSeams) | null;

  /** The host's store-backed watch-list seams (see {@link ArweaveWatchListSeams}). */
  const watchSeams = deps as (typeof deps & ArweaveWatchListSeams) | null;

  /** Seeds defined in THIS session, kept as an overlay over the host list: the
   *  record carries the plaintext bitstring the generate flow needs, which the
   *  persisted (ciphertext) copy cannot hand back on its own. */
  const [sessionSeeds, setSessionSeeds] = useState<ArweaveSeedRecord[]>([]);
  /** Why the Codex refused to store the last defined seed (locked codex, failed
   *  encrypt, a second prime). The seed stays usable for THIS session, but it
   *  will NOT survive an unmount — so the failure is shown, never swallowed.
   *  Carries the host's message only; no seed material ever reaches it. */
  const [seedPersistError, setSeedPersistError] = useState<string | null>(null);
  /** Keys generated in this session, so they are visible before the host app
   *  feeds an updated `foreignKeys` back in. */
  const [sessionKeys, setSessionKeys] = useState<ForeignKeyEntry[]>([]);

  /** THIS chain's keys only — the foreign-key slice is chain-agnostic. */
  const arweaveKeys = useMemo<ForeignKeyEntry[]>(() => {
    const byId = new Map<string, ForeignKeyEntry>();
    for (const entry of deps?.foreignKeys ?? []) {
      if (entry.chainId === ARWEAVE_CHAIN_ID) byId.set(entry.id, entry);
    }
    for (const entry of sessionKeys) byId.set(entry.id, entry);
    return [...byId.values()];
  }, [deps?.foreignKeys, sessionKeys]);

  /** Persist ONE generated key, composed from the existing E1 seams: the
   *  keyring encrypts the JWK at rest, then the entry is stored with its seed
   *  provenance. Called per key AS IT ARRIVES — never batched. */
  const persistKey = useMemo(() => {
    if (deps === null) return undefined;
    return async ({ seedId, index, jwk, address }: GeneratedArweaveKey): Promise<void> => {
      const encrypted = await deps.generateArweaveKey({ jwk, label: `#${index}` });
      const entry: ForeignKeyEntry = { ...encrypted, seedId, index, address };
      await deps.addForeignKey(entry);
      setSessionKeys((prev) => [...prev, entry]);
    };
  }, [deps]);

  /** Host seeds first, session overlay on top (same id → the session record
   *  wins, because it is the one that still knows its bitstring). */
  const seeds = useMemo<ArweaveSeedRecord[]>(() => {
    const byId = new Map<string, ArweaveSeedRecord>();
    for (const seed of seedSeams?.arweaveSeeds ?? []) byId.set(seed.id, seed);
    for (const seed of sessionSeeds) byId.set(seed.id, seed);
    return [...byId.values()];
  }, [seedSeams?.arweaveSeeds, sessionSeeds]);

  /** A newly defined seed goes OUT to the codex (so it survives this panel) and
   *  into the session overlay (so it is usable immediately, with its bits). */
  const handleSeedDefined = useCallback(
    (seed: ArweaveSeedRecord): void => {
      setSessionSeeds((prev) => [...prev.filter((s) => s.id !== seed.id), seed]);
      setSeedPersistError(null);
      void (async () => {
        try {
          await seedSeams?.onSeedDefined?.(seed);
        } catch (cause) {
          setSeedPersistError(
            `"${seed.label}" could not be saved to the Codex, so it will not ` +
              `survive leaving this panel: ${
                cause instanceof Error ? cause.message : String(cause)
              }`,
          );
        }
      })();
    },
    [seedSeams],
  );

  /** Deleting a seed also drops BOTH session overlays — the seed AND every key
   *  the cascade removes. Pruning only `sessionSeeds` left a this-session-
   *  generated key's id alive in `sessionKeys`, which `arweaveKeys` merges back
   *  in on top of the (now-empty) host list — the deleted key resurrected, and
   *  `existingKeys.length` never dropped back to zero, wrongly hiding Quick
   *  Define forever after a delete. */
  const handleDeleteSeed = useCallback(
    async (request: ArweaveSeedDeletion): Promise<void> => {
      setSessionSeeds((prev) => prev.filter((s) => s.id !== request.seedId));
      setSessionKeys((prev) => prev.filter((k) => !request.keyIds.includes(k.id)));
      await deps?.onDeleteSeed?.(request);
    },
    [deps],
  );

  // ── Pure Keys' own add/rename/delete wrappers ──
  // Mirrors the seeded-key session overlay above: a pure key created/renamed/
  // deleted THIS session must be visible immediately in `arweaveKeys` rather
  // than waiting for the host to round-trip an updated `foreignKeys` prop.
  const handleAddPureKey = useCallback(
    async (entry: ForeignKeyEntry): Promise<void> => {
      await deps?.addForeignKey(entry);
      setSessionKeys((prev) => [...prev, entry]);
    },
    [deps],
  );
  const handleRenamePureKey = useCallback(
    async (id: string, label: string): Promise<void> => {
      await deps?.renameForeignKey(id, label);
      setSessionKeys((prev) => prev.map((k) => (k.id === id ? { ...k, label } : k)));
    },
    [deps],
  );
  const handleDeletePureKey = useCallback(
    async (id: string): Promise<void> => {
      setSessionKeys((prev) => prev.filter((k) => k.id !== id));
      await deps?.deleteForeignKey(id);
    },
    [deps],
  );

  const accountsSeeds = useMemo(
    // Forward `isPrime` so Accounts titles the prime group "Prime Arweave Seed"
    // even when the prime seed is not first in the array. Without it the list
    // falls back to positional inference (index 0), which mislabels after a
    // reorder or once an earlier seed is deleted.
    //
    // `hasWords` drives Accounts' balance-delete-guard tier (design.md §3):
    // `true` only when this seed's plaintext words are actually known this
    // session — a Direct/bitstring-sourced seed, or a word-based seed whose
    // session-only words were lost on reload, both read `false` here.
    () =>
      seeds.map((seed) => ({
        id: seed.id,
        label: seed.label,
        isPrime: seed.isPrime,
        hasWords: seed.words !== undefined && seed.words.length > 0,
      })),
    [seeds],
  );

  return (
    <div data-testid="arweave-panel" data-chain-id={ARWEAVE_CHAIN_ID}>
      <div
        role="tablist"
        aria-label="Arweave panel"
        style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 16 }}
      >
        {CATEGORIES.map((id) => {
          const { Icon, color } = CATEGORY_META[id];
          const selected = id === active;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={selected}
              data-testid={`arweave-subtab-${id}`}
              onClick={() => requestCategory(id)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                height: CATEGORY_ROW_HEIGHT,
                padding: "0 16px",
                borderRadius: 999,
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                border: `1px solid ${selected ? color : "#262626"}`,
                backgroundColor: selected ? color + "1a" : "transparent",
                color: selected ? color : "#888",
                whiteSpace: "nowrap",
              }}
            >
              <Icon style={{ width: 14, height: 14 }} />
              {CATEGORY_LABELS[id]}
            </button>
          );
        })}
      </div>

      <div role="tabpanel">
        {/* Seeds, Pure Keys and Accounts are WIRED (E5). The remaining two keep
            their explicit empty placeholder: the demo/mock surfaces they used
            to mount (BalanceArea / SendArea / UploadArea / LibraryArea) are
            being replaced by real wiring one category at a time. Those area
            components still exist and keep their own e4-panel-*.test.tsx specs,
            so nothing was deleted — they are simply no longer mounted here.

            Seeds is a KEEP-ALIVE, unlike Accounts and the placeholders: it is
            hidden with `display: none` rather than unmounted when another
            category is active, because it is the one category that can carry
            an in-flight generation. The worker keeps running regardless of
            what the panel renders (confirmed architecture — keys persist via
            the host store regardless of component lifecycle), so unmounting
            `ArweaveSeedsArea` destroyed its `run` state and, on returning to
            Seeds, showed no progress bar at all even though the run was still
            alive. Mounting it unconditionally and only toggling visibility
            keeps `run`/`abortRef`/`storedRef`/the form fields intact across the
            switch, with no change needed inside `ArweaveSeedsArea` itself. */}
        <div style={{ display: active === "seeds" ? undefined : "none" }}>
          {seedPersistError !== null && (
            <div data-testid="arweave-seed-persist-error" role="alert" style={SEED_ERROR_STYLE}>
              {seedPersistError}
            </div>
          )}
          <ArweaveSeedsArea
            seeds={seeds}
            onSeedDefined={handleSeedDefined}
            existingKeys={arweaveKeys}
            persistKey={persistKey}
            ouronetAccounts={deps?.ouronetAccounts}
            revealAccountSecret={deps?.revealAccountSecret}
            chainwebSeeds={deps?.chainwebSeeds}
            revealSeedWords={deps?.revealSeedWords}
            workerFactory={deps?.workerFactory}
            onDeleteSeed={handleDeleteSeed}
            decryptArweaveKey={deps?.decryptArweaveKey}
            onRunActivityChange={setActiveGeneration}
          />
        </div>
        {active === "accounts" ? (
          <ArweaveAccountsArea
            entries={arweaveKeys}
            seeds={accountsSeeds}
            // onDeleteKey intentionally NOT threaded: Accounts is a pure
            // listing of every address the codex holds — it never deletes.
            // A key can only be removed from its OWN category: a seed-derived
            // key via the Seeds category (deleting the seed), or a seedless
            // key via the Pure Keys category. `onDeleteKey` is optional on
            // this component precisely so omitting it renders no delete
            // control on any row at all (see this component's own module doc).
            // getBalance IS now threaded (was deliberately withheld until this
            // was wired): every row shows a live AR balance, fetched in
            // parallel per row with a "Live balances / Refresh" control
            // mirroring StoaAccountsTab. The same read also still feeds the
            // funded-key delete guard, unchanged from before this task.
            getBalance={deps?.getBalance}
            // deps (full ArweavePanelDeps) threaded so the row-level Send
            // button/modal can reach sendFrom/estimateFee — deps is `null`
            // here (no-context state) but the prop wants `undefined`.
            deps={deps ?? undefined}
            // T2: the watch-list seams (see {@link ArweaveWatchListSeams}) —
            // an unwired host (watchSeams === null, or one that never wires
            // these three fields) degrades to an empty list and a disabled
            // add form, never a throw.
            watchedEntries={watchSeams?.watchedAddresses ?? []}
            onAddWatched={watchSeams?.addWatchedAddress}
            onRemoveWatched={watchSeams?.removeWatchedAddress}
          />
        ) : active === "pure-keys" ? (
          deps === null ? (
            <div data-testid="arweave-pure-keys-unavailable" style={EMPTY_STYLE}>
              Pure Keys are not available until the Arweave keyring is wired.
            </div>
          ) : (
            <PureKeysArea
              foreignKeys={arweaveKeys}
              keygenRunner={deps.keygenRunner}
              generateArweaveKey={deps.generateArweaveKey}
              importArweaveKey={deps.importArweaveKey}
              decryptArweaveKey={deps.decryptArweaveKey}
              addForeignKey={handleAddPureKey}
              renameForeignKey={handleRenamePureKey}
              deleteForeignKey={handleDeletePureKey}
              // getBalance intentionally NOT threaded here yet: mock mode's
              // fake `getBalance` always resolves the SAME fixed balance for
              // every address, including a key created seconds ago with
              // nothing on it. A Pure Key is *always* seedless (exactly the
              // case the funded-guard exists to protect), so wiring it here
              // would make a false-positive "funded, can't delete" warning
              // the single most visible place this would bite a user testing
              // a freshly-generated, genuinely-empty key. `getBalance` is
              // optional on this component precisely so the guard stays a
              // no-op (today's plain confirm) until a real balance read
              // exists to feed it — unlike Accounts (T4), this one is NOT yet
              // wired to a live value display either, so there is no display
              // reason to force the read here today.
            />
          )
        ) : active !== "seeds" ? (
          <div data-testid={`arweave-category-empty-${active}`} style={EMPTY_STYLE}>
            {`${CATEGORY_LABELS[active]} — not wired yet.`}
          </div>
        ) : null}
      </div>

      {pendingCategory !== null && activeGeneration !== null && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-label="Leave the seed still generating?"
          data-testid="arweave-leave-generation-dialog"
          style={LEAVE_DIALOG_BACKDROP_STYLE}
        >
          <div style={LEAVE_DIALOG_STYLE}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
              {`"${activeGeneration.seedLabel}" is still generating keys.`}
            </div>
            <div style={{ fontSize: 13, color: "#888" }}>
              Leaving this tab does not stop it, but you will lose the progress bar
              and the ability to cancel until you come back.
            </div>
            <div style={LEAVE_DIALOG_BUTTON_ROW_STYLE}>
              <button
                type="button"
                data-testid="arweave-leave-generation-stop"
                onClick={handleStopGeneration}
                style={LEAVE_DIALOG_STOP_BUTTON_STYLE}
              >
                Stop generation now
              </button>
              <button
                type="button"
                data-testid="arweave-leave-generation-continue"
                onClick={handleContinueInBackground}
                style={LEAVE_DIALOG_CONTINUE_BUTTON_STYLE}
              >
                Continue in background
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ArweavePanel;
