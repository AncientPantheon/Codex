/**
 * ArweaveAccountsArea — the Arweave "Accounts" category listing.
 *
 * PRESENTATIONAL ONLY. It is handed the ciphertext `ForeignKeyEntry[]` and the
 * known seeds. It NEVER decrypts, never reads a store, never touches the
 * network, and holds no state beyond which sub-tab is open and which groups are
 * collapsed.
 *
 * STRUCTURE IS COPIED, NOT INVENTED: this is the SAME shape Chainweb's
 * `StoaAccountsTab` uses, so both chains' Accounts pages read as one surface —
 *   • a "Total Addresses N" header block;
 *   • a `Codex Accounts (N)` / `Watched Accounts (N)` sub-tab toggle. Arweave has
 *     no watch-list yet, so Watched is a real tab with a count of 0 and its own
 *     empty state — the control stays so the two chains stay identical;
 *   • addresses grouped by their SOURCE SEED, each group collapsible with a
 *     count badge (Stoa's `GroupRow`), holding that seed's entries ascending by
 *     `index`. The prime seed's group is fixed as "Prime Arweave Seed"; any other
 *     falls back to `Seed #N` when it carries no label (Stoa's naming rule).
 *
 * Secrecy: `encryptedKeyfile` is the only copy of the user's key material and is
 * NEVER rendered — every row shows the entry's PLAINTEXT `address` (E5's
 * provenance field, public material), falling back to the entry `id`. That is
 * precisely why `address` exists on `ForeignKeyEntry`: a list renders without
 * decrypting anything.
 *
 * Index spaces are PER SEED — `#0` exists under every seed and is not globally
 * unique — so an index is only ever rendered inside its seed's group.
 *
 * Nothing is ever silently dropped: an entry whose `seedId` names no known seed,
 * and a LEGACY entry written before seed provenance existed (no `seedId` at
 * all), both land in a final "Unassigned" group. Losing a key from the user's
 * view is the worst failure this surface could have.
 *
 * Icons are INLINE SVG, deliberately NOT `lucide-react`: that package lives only
 * at the repo root where `react` resolves to the stale hoisted React 18, so
 * importing it renders elements from a second React ("A React Element from an
 * older version of React was rendered"). Same rule as `ArweavePanel.tsx`.
 *
 * T7: each row also gets a "Send AR" button opening `SendArweaveModal.tsx` for
 * that row's entry — the one place this file stops being purely
 * presentational-only-of-ciphertext and threads the full `ArweavePanelDeps`
 * bundle down to a row, OPTIONALLY (`deps` prop, gated the same way
 * `onDeleteKey` already is): a caller that omits it gets no Send button at
 * all, rather than one that would throw or no-op on click. A successful send
 * re-fires T4's `fetchBalances([address])` for exactly that row.
 */

import * as React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { ForeignKeyEntry } from "@ancientpantheon/codex-core";
import { winstonToAr } from "@ancientpantheon/arweave-core";
import type { WatchListEntry } from "@ancientpantheon/codex-ouronet/types";
import { validateAddress } from "@ancientpantheon/codex-ouronet/hooks";
import { onTxConfirmed } from "@ancientpantheon/codex-ouronet/zbom";

import type { ArweavePanelDeps } from "./context.js";
import { SendArweaveModal } from "./SendArweaveModal.js";
import { ARWEAVE_CHAIN_ID } from "../address-book/chainId.js";

/** A single STABLE empty array, reused as `watchedEntries`'s default when the
 *  prop is omitted. A `[]` written directly in the destructuring default is a
 *  NEW array literal on every render, which changes `addresses`'s (T4) memoized
 *  identity every render, which re-fires the balance-fetch effect every render
 *  — an infinite render loop the very first time this component mounts without
 *  `watchedEntries` wired (i.e. every pre-T2 caller). */
const EMPTY_WATCHED_ENTRIES: WatchListEntry[] = [];

/** The id of the TRUE-ORPHAN catch-all group: a `seedId` naming no known seed
 *  (unknown/legacy provenance). NOT a real seed id — no seed may use it. */
const UNASSIGNED_ID = "unassigned";
const UNASSIGNED_LABEL = "Unassigned";

/** The id of the genuinely-seedless catch-all group: `seedId === undefined`,
 *  the exact filter `PureKeysArea.tsx` uses for its own list — these entries
 *  duplicate into that standalone tab, so this Accounts-side label matches it
 *  rather than folding them into the true-orphan "Unassigned" bucket above. */
const PURE_KEYS_ID = "pure-keys";
const PURE_KEYS_LABEL = "Pure Keys";

/** The prime seed's group is fixed copy, never the stored label. */
const PRIME_LABEL = "Prime Arweave Seed";

const MONO = "var(--codex-font-mono, 'JetBrains Mono', ui-monospace, monospace)";

/** Accounts accent — the same gold the Accounts category uses on every chain. */
const ACCENT = "#ceac5f";

const svgBase = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

const ChevronDownGlyph = ({ style }: { style?: React.CSSProperties }): React.ReactElement => (
  <svg {...svgBase} style={style}><path d="m6 9 6 6 6-6" /></svg>
);
const ChevronRightGlyph = ({ style }: { style?: React.CSSProperties }): React.ReactElement => (
  <svg {...svgBase} style={style}><path d="m9 18 6-6-6-6" /></svg>
);
const EyeGlyph = ({ style }: { style?: React.CSSProperties }): React.ReactElement => (
  <svg {...svgBase} style={style}>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
const CopyGlyph = ({ style }: { style?: React.CSSProperties }): React.ReactElement => (
  <svg {...svgBase} style={style}>
    <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
  </svg>
);
/** `data-glyph="check"` lets tests distinguish this from the resting
 *  `CopyGlyph` without depending on SVG path internals. */
const CheckGlyph = ({ style }: { style?: React.CSSProperties }): React.ReactElement => (
  <svg {...svgBase} style={style} data-glyph="check">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);
const ExternalLinkGlyph = ({ style }: { style?: React.CSSProperties }): React.ReactElement => (
  <svg {...svgBase} style={style}>
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <path d="M15 3h6v6" />
    <path d="M10 14 21 3" />
  </svg>
);
/** T7's per-row "Send AR" button glyph — a paper-plane send icon, same
 *  inline-SVG rule (module JSDoc). */
const SendGlyph = ({ style }: { style?: React.CSSProperties }): React.ReactElement => (
  <svg {...svgBase} style={style}>
    <path d="m22 2-7 20-4-9-9-4Z" />
    <path d="M22 2 11 13" />
  </svg>
);
/** Same glyph as `ArweaveSeedsArea.tsx`'s `TrashGlyph` — this module stays
 *  self-contained (module JSDoc), so it is duplicated rather than imported. */
const TrashGlyph = ({ style }: { style?: React.CSSProperties }): React.ReactElement => (
  <svg {...svgBase} style={style}>
    <path d="M3 6h18" />
    <path d="M8 6V4h8v2" />
    <path d="M19 6l-1 14H6L5 6" />
  </svg>
);
/** The "Live balances" header's refresh-all control — same inline-SVG rule
 *  (module JSDoc), mirroring `StoaAccountsTab.tsx`'s `RefreshCw` glyph. */
const RefreshGlyph = ({ style }: { style?: React.CSSProperties }): React.ReactElement => (
  <svg {...svgBase} style={style}>
    <path d="M21 12a9 9 0 1 1-2.64-6.36" />
    <path d="M21 3v6h-6" />
  </svg>
);

/** A seed as this list needs to know it: an id to group by and a label to show. */
export interface ArweaveAccountsSeed {
  id: string;
  label: string;
  /** The Prime Arweave Seed. Absent → the FIRST seed is prime, as Stoa does. */
  isPrime?: boolean;
  /** Whether this seed's plaintext words are known THIS SESSION — a Direct/
   *  bitstring-sourced seed, or a word-based seed whose session-only words
   *  were lost on reload, both read `false`/absent here. Absent (an older
   *  caller predating this feature) defaults to PROTECTED inside this
   *  component — see the module doc and design.md §3: never silently
   *  downgrades something that used to delete with a plain confirm into a
   *  hard block. */
  hasWords?: boolean;
}

export interface ArweaveAccountsAreaProps {
  /** The foreign-key entries (ciphertext-only) to list, in any order. */
  entries: ForeignKeyEntry[];
  /** The known Arweave seeds, in display order; each becomes one group. */
  seeds: ArweaveAccountsSeed[];
  /** Deletes ONE key. INJECTED — this surface reaches into no store, it only
   *  names the entry to delete. Omitted entirely → no row renders a delete
   *  control at all (mirrors Stoa's `onRemove &&` gating), since an unwired
   *  delete button would either throw on click or silently do nothing. */
  onDeleteKey?: (entry: ForeignKeyEntry) => Promise<void> | void;
  /** E2 balance read (winston bigint). OPTIONAL and additive — a caller that
   *  omits it gets a plain "—" value cell and today's plain confirm-then-
   *  delete panel, unchanged (design.md §3). When wired, it feeds TWO
   *  independent consumers: (1) every row's value cell, fired once per row
   *  on mount and on "Refresh" (T4, parallel via `Promise.allSettled`), and
   *  (2) the delete guard's own on-click read below, which branches on its
   *  group's `protected` tier (see {@link Group}) — unaffected by (1). */
  getBalance?: (address: string) => Promise<bigint>;
  /** T7: the full injected seam bundle, needed only to open the per-row Send
   *  modal (`deps.sendFrom`/`deps.estimateFee`). OPTIONAL and additive,
   *  mirroring `onDeleteKey`'s own omission convention — a caller that omits
   *  it (this file's own pre-T7 tests) gets no Send button on any row rather
   *  than a button that would throw or no-op on click. */
  deps?: ArweavePanelDeps;
  /** T2: third-party addresses the codex holds no private key for — the
   *  Watched Accounts sub-tab's list. OPTIONAL and additive: a caller that
   *  omits it (every pre-T2 test in this file) sees the Watched sub-tab's
   *  existing empty state and no watched rows, exactly as before this task. */
  watchedEntries?: WatchListEntry[];
  /** Adds a new watched address, or (called again with the same address)
   *  re-labels an existing one — the upsert-by-id semantics of the host's
   *  `addWatchListEntry` make this the same seam for both. OPTIONAL: absent
   *  disables the add form (its submit button renders but stays `disabled`)
   *  and the inline label editor on every watched row. */
  onAddWatched?: (address: string, label?: string) => Promise<void>;
  /** Removes one watched address by its watch-list entry id. OPTIONAL: absent
   *  disables the remove control on every watched row (mirrors `onDeleteKey`'s
   *  own gating). */
  onRemoveWatched?: (id: string) => Promise<void>;
}

interface Group {
  id: string;
  label: string;
  entries: ForeignKeyEntry[];
  /** The balance-delete-guard tier (design.md §3): `true` (Protected — a
   *  human can retype the seed words and regenerate the exact same key) for a
   *  real seed group whose `hasWords` is not explicitly `false`; `false`
   *  (Unprotected — funds can never be recovered if the key is lost) for the
   *  Pure Keys and Unassigned catch-alls alike, and for a real seed group
   *  whose `hasWords` is explicitly `false`. */
  protected: boolean;
}

/** The live value-cell read state for ONE row's address (T4). Distinct from
 *  {@link DeleteGuardState} below — that state machine drives its OWN,
 *  separately-fired `getBalance` call on delete-click; this one drives the
 *  value cell's automatic on-mount/on-refresh read. */
type BalanceState = { status: "loading" } | { status: "ready"; balance: bigint } | { status: "error" };

/** "Live balances" alone doesn't say whether it's stale — there is no
 *  periodic polling at all (only on-mount, manual Refresh, post-send, and
 *  post-confirmation reads), so a plain "updated Xs ago" is how a user
 *  actually tells freshness from staleness at a glance. */
function formatUpdatedAgo(lastFetchedAt: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - lastFetchedAt) / 1000));
  if (seconds < 5) return "Updated just now";
  if (seconds < 60) return `Updated ${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  return `Updated ${minutes}m ago`;
}

/** Ascending by `index`; an entry without one (legacy) sorts last. */
function byIndexAscending(a: ForeignKeyEntry, b: ForeignKeyEntry): number {
  const ai = typeof a.index === "number" ? a.index : Number.POSITIVE_INFINITY;
  const bi = typeof b.index === "number" ? b.index : Number.POSITIVE_INFINITY;
  return ai - bi;
}

/** There is no existing Arweave explorer constant anywhere in the codebase
 *  (`codex-arweave` deliberately holds no `arweave.net` literal) — this is a
 *  new, local decision, exactly like Stoa's own `explorerUrl` in
 *  `StoaAccountsTab.tsx`. */
function explorerUrl(address: string): string {
  return `https://viewblock.io/arweave/address/${address}`;
}

const iconButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 26,
  height: 26,
  borderRadius: 6,
  flexShrink: 0,
  cursor: "pointer",
  backgroundColor: "#141414",
  color: "#888",
  border: "1px solid #262626",
  textDecoration: "none",
};

const dangerIconButtonStyle: React.CSSProperties = {
  ...iconButtonStyle,
  color: "#f87171",
  border: "1px solid #7f1d1d",
};

/** The Delete flow's state machine when `getBalance` is wired — the exact
 *  same shape `PureKeysArea.tsx`'s `PureKeyRow` uses (design.md §3): `"idle"`
 *  (nothing shown yet), `"checking"` (the read is in flight), `"confirm"`
 *  (the plain, pre-existing confirm/cancel panel — reached directly when
 *  `getBalance` is absent, or after a zero/failed read, or for a funded
 *  Protected-tier row with sharper copy), `"blocked"` (funded + Unprotected —
 *  no delete action at all, only dismiss). */
type DeleteGuardState = "idle" | "checking" | "confirm" | "blocked";

/** The live value-cell read (T4), factored out of `AccountRow` so `WatchedRow`
 *  (T2) renders the identical loading/ready/error states off the SAME
 *  `balances` map the parent fetches into — a watched row's balance goes
 *  through the exact same `getBalance` pipeline as a Codex-owned row, per
 *  design.md. `testIdBase` is the caller's own per-row id prefix (e.g.
 *  `arweave-account-value-${entry.id}` / `arweave-watched-value-${w.id}`); the
 *  error state appends `-error`, unchanged from `AccountRow`'s original
 *  contract. */
function BalanceCell({
  testIdBase,
  address,
  balances,
}: {
  testIdBase: string;
  address: string;
  balances: Record<string, BalanceState>;
}): React.ReactElement {
  const balanceState = balances[address];
  const isError = balanceState?.status === "error";
  const testId = isError ? `${testIdBase}-error` : testIdBase;
  const content =
    balanceState?.status === "ready"
      ? `${winstonToAr(balanceState.balance)} AR`
      : balanceState?.status === "loading"
        ? "…"
        : "—";
  const color =
    balanceState?.status === "ready"
      ? balanceState.balance > 0n
        ? ACCENT
        : "#555"
      : isError
        ? "#f87171"
        : "#555";
  return (
    <span
      data-testid={testId}
      style={{ fontFamily: MONO, fontSize: 12, fontWeight: 600, color, flexShrink: 0 }}
    >
      {content}
    </span>
  );
}

/** The copy-address icon button, shared by `AccountRow` and `WatchedRow` —
 *  same green-check-then-revert feedback as Chainweb's `IconCopyBtn`
 *  (`StoaAccountsTab.tsx`), which this previously had no equivalent of: a
 *  click here used to give no visible confirmation at all. Mirrors
 *  `IconCopyBtn`'s exact timing (1200ms) and color swap (green background +
 *  border + icon while `copied`). */
function CopyButton({ testId, address }: { testId: string; address: string }): React.ReactElement {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      data-testid={testId}
      title="Copy address"
      aria-label="Copy address"
      onClick={(e) => {
        e.stopPropagation();
        // Same idiom as `ArweaveSeedsArea.tsx`'s copy handler: `void` a
        // possibly-undefined result rather than chaining `.catch` onto it,
        // since a bare `vi.fn()` test double returns `undefined`.
        void navigator.clipboard?.writeText(address);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      style={{
        ...iconButtonStyle,
        backgroundColor: copied ? "#0a2a14" : iconButtonStyle.backgroundColor,
        color: copied ? "#4ade80" : iconButtonStyle.color,
        border: copied ? "1px solid rgba(74,222,128,0.4)" : iconButtonStyle.border,
      }}
    >
      {copied ? (
        <CheckGlyph style={{ width: 13, height: 13 }} />
      ) : (
        <CopyGlyph style={{ width: 13, height: 13 }} />
      )}
    </button>
  );
}

function AccountRow({
  entry,
  onDeleteKey,
  getBalance,
  protectedTier,
  balances,
  deps,
  onSendSuccess,
}: {
  entry: ForeignKeyEntry;
  onDeleteKey?: (entry: ForeignKeyEntry) => Promise<void> | void;
  getBalance?: (address: string) => Promise<bigint>;
  /** This row's group's balance-delete-guard tier (design.md §3). Only
   *  consulted once a funded balance is actually read. */
  protectedTier: boolean;
  /** The live value-cell read state, keyed by address (T4) — owned and
   *  fetched by {@link ArweaveAccountsArea}, not this row. */
  balances: Record<string, BalanceState>;
  /** T7: the injected seam bundle the Send modal needs. Absent → no Send
   *  button renders at all (same gating as `onDeleteKey`). */
  deps?: ArweavePanelDeps;
  /** T7: fired with this row's address on a successful send, so the parent
   *  can re-fire T4's `fetchBalances([address])` for exactly this row. */
  onSendSuccess?: (address: string) => void;
}): React.ReactElement {
  // `address` is plaintext public material; `id` is the fallback. The
  // `encryptedKeyfile` is never read here — see module JSDoc.
  const address = entry.address ?? entry.id;
  const position = typeof entry.index === "number" ? `#${entry.index}` : (entry.label ?? "—");
  const [sendOpen, setSendOpen] = useState(false);

  /** Confirm-then-delete: matches Arweave's OWN seed-delete pattern
   *  (`ArweaveSeedsArea.tsx`'s `SeedRow`), not Chainweb's immediate `onRemove`
   *  — a key costs ~6.7 s of RSA-4096 search to regenerate, so a stray click
   *  must not be destructive. */
  const [deleteGuard, setDeleteGuard] = useState<DeleteGuardState>("idle");
  const [fundedBalance, setFundedBalance] = useState<bigint | null>(null);
  const confirmingDelete = deleteGuard === "confirm";

  return (
    <div
      data-testid="arweave-account-row"
      data-index={typeof entry.index === "number" ? String(entry.index) : undefined}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "8px 12px",
        borderRadius: 10,
        border: "1px solid #1a1a1a",
        backgroundColor: "#0a0a0a",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 600, color: ACCENT, flexShrink: 0 }}>
          {position}
        </span>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontFamily: MONO,
            fontSize: 12,
            color: "#d2d3d4",
            overflowWrap: "anywhere",
          }}
        >
          {address}
        </span>
        {/* T4: the live value cell — fetched by the parent via `getBalance`,
            one call per row on mount and on "Refresh" (Promise.allSettled).
            `balances[address]` is absent entirely when `getBalance` was never
            wired at all (an inert "—", never attempted a read). */}
        <BalanceCell testIdBase={`arweave-account-value-${entry.id}`} address={address} balances={balances} />
        <span
          onClick={(e) => e.stopPropagation()}
          style={{ display: "inline-flex", gap: 6, flexShrink: 0 }}
        >
          {deps && (
            <button
              type="button"
              data-testid={`arweave-account-send-${entry.id}`}
              title="Send AR"
              aria-label="Send AR"
              onClick={(e) => {
                e.stopPropagation();
                setSendOpen(true);
              }}
              style={iconButtonStyle}
            >
              <SendGlyph style={{ width: 13, height: 13 }} />
            </button>
          )}
          <CopyButton testId={`arweave-account-copy-${entry.id}`} address={address} />
          <a
            data-testid={`arweave-account-explorer-${entry.id}`}
            href={explorerUrl(address)}
            target="_blank"
            rel="noopener noreferrer"
            title="Open in Explorer"
            aria-label="Open in Explorer"
            onClick={(e) => e.stopPropagation()}
            style={iconButtonStyle}
          >
            <ExternalLinkGlyph style={{ width: 13, height: 13 }} />
          </a>
          {onDeleteKey && (
            <button
              type="button"
              data-testid={`arweave-account-delete-${entry.id}`}
              title="Delete this key"
              aria-label="Delete this key"
              onClick={(e) => {
                e.stopPropagation();
                if (getBalance === undefined) {
                  setDeleteGuard("confirm");
                  return;
                }
                setDeleteGuard("checking");
                getBalance(address)
                  .then((balance) => {
                    if (balance > 0n && !protectedTier) {
                      setFundedBalance(balance);
                      setDeleteGuard("blocked");
                    } else {
                      // Zero/failed read, OR funded-but-Protected: same plain
                      // confirm-then-delete action as today — Protected just
                      // gets sharper copy below.
                      setFundedBalance(balance > 0n ? balance : null);
                      setDeleteGuard("confirm");
                    }
                  })
                  .catch(() => {
                    setFundedBalance(null);
                    setDeleteGuard("confirm");
                  });
              }}
              style={dangerIconButtonStyle}
            >
              <TrashGlyph style={{ width: 13, height: 13 }} />
            </button>
          )}
        </span>
      </div>

      {deleteGuard === "checking" && (
        <div
          data-testid={`arweave-account-delete-checking-${entry.id}`}
          style={{ fontSize: 12, color: "#888" }}
        >
          Checking balance…
        </div>
      )}

      {confirmingDelete && (
        <div
          data-testid={`arweave-account-delete-confirm-panel-${entry.id}`}
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 8,
            padding: "8px 10px",
            borderRadius: 8,
            border: "1px solid #7f1d1d",
            backgroundColor: "#1a0a0a",
            fontSize: 12,
            color: "#f87171",
          }}
        >
          <span style={{ flex: 1, minWidth: 180 }}>
            {fundedBalance !== null
              ? `This address holds ${winstonToAr(fundedBalance)} AR. Deleting it is possible but not reversible without the seed that made it.`
              : "Delete this Arweave key? It cannot be regenerated without its seed."}
          </span>
          <button
            type="button"
            data-testid={`arweave-account-delete-confirm-${entry.id}`}
            onClick={(e) => {
              e.stopPropagation();
              setDeleteGuard("idle");
              void onDeleteKey?.(entry);
            }}
            style={{ ...dangerIconButtonStyle, width: "auto", padding: "0 10px", fontSize: 12 }}
          >
            Delete
          </button>
          <button
            type="button"
            data-testid={`arweave-account-delete-cancel-${entry.id}`}
            onClick={(e) => {
              e.stopPropagation();
              setDeleteGuard("idle");
            }}
            style={{ ...iconButtonStyle, width: "auto", padding: "0 10px", fontSize: 12 }}
          >
            Cancel
          </button>
        </div>
      )}

      {deleteGuard === "blocked" && fundedBalance !== null && (
        <div
          data-testid={`arweave-account-delete-blocked-${entry.id}`}
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 8,
            padding: "8px 10px",
            borderRadius: 8,
            border: "1px solid #7f1d1d",
            backgroundColor: "#1a0a0a",
            fontSize: 12,
            color: "#f87171",
          }}
        >
          <span style={{ flex: 1, minWidth: 180 }}>
            {`This address holds ${winstonToAr(fundedBalance)} AR and has no seed behind it — ` +
              "it can never be regenerated. Deletion is disabled to prevent irreversible fund loss."}
          </span>
          <button
            type="button"
            data-testid={`arweave-account-delete-dismiss-${entry.id}`}
            onClick={(e) => {
              e.stopPropagation();
              setDeleteGuard("idle");
            }}
            style={{ ...iconButtonStyle, width: "auto", padding: "0 10px", fontSize: 12 }}
          >
            Dismiss
          </button>
        </div>
      )}

      {deps && (
        <SendArweaveModal
          entry={entry}
          isOpen={sendOpen}
          onClose={() => setSendOpen(false)}
          deps={deps}
          onSuccess={() => onSendSuccess?.(address)}
          // Reuses the SAME balances map the value cell above already reads
          // (T4) — no extra fetch. Undefined (loading/error/unfetched)
          // simply leaves the modal's amount-fits-balance check inert; it
          // never blocks submit on an unknown balance (see the modal's own
          // prop doc).
          senderBalanceWinston={balances[address]?.status === "ready" ? balances[address].balance : undefined}
        />
      )}
    </div>
  );
}

/** T2: one row of the Watched Accounts sub-tab — a third-party address the
 *  codex holds no private key for. `WatchListEntry` cannot be handed to
 *  `AccountRow` unmodified (it takes a `ForeignKeyEntry`, which carries a
 *  mandatory `encryptedKeyfile`), so this is a SEPARATE component, not an
 *  overload.
 *
 *  Mirrors `AccountRow`'s layout (address text, the SAME `BalanceCell` off the
 *  SAME `balances` map, copy, ViewBlock explorer link) plus an inline label
 *  editor and a remove button, mirroring `StoaAccountsTab.tsx`'s own watched
 *  row (`onRelabel`/`onRemove`, upsert-by-id semantics).
 *
 *  Deliberately carries NO `deps` prop and renders NO Send control anywhere:
 *  there is no private key behind a watched address to sign a send with. */
function WatchedRow({
  entry,
  balances,
  onRelabel,
  onRemove,
}: {
  entry: WatchListEntry;
  /** The live value-cell read state, keyed by address (T4) — the SAME map
   *  {@link ArweaveAccountsArea} fetches for the Codex rows; a watched
   *  address's own address is included in that same fetch. */
  balances: Record<string, BalanceState>;
  /** Relabels this watched entry. Absent → no label editor renders (mirrors
   *  `onDeleteKey`'s own gating on `AccountRow`). */
  onRelabel?: (label: string) => void;
  /** Removes this watched entry. Absent → no remove control renders. */
  onRemove?: () => void;
}): React.ReactElement {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entry.label);

  const saveLabel = (): void => {
    onRelabel?.(draft.trim());
    setEditing(false);
  };

  return (
    <div
      data-testid="arweave-watched-row"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "8px 12px",
        borderRadius: 10,
        border: "1px solid #1a1a1a",
        backgroundColor: "#0a0a0a",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontFamily: MONO,
            fontSize: 12,
            color: "#d2d3d4",
            overflowWrap: "anywhere",
          }}
        >
          {entry.address}
        </span>
        <BalanceCell
          testIdBase={`arweave-watched-value-${entry.id}`}
          address={entry.address}
          balances={balances}
        />
        <span
          onClick={(e) => e.stopPropagation()}
          style={{ display: "inline-flex", gap: 6, flexShrink: 0 }}
        >
          {/* Deliberately NO Send button here — a watched address has no
              private key behind it to sign a send with (module JSDoc). */}
          <CopyButton testId={`arweave-watched-copy-${entry.id}`} address={entry.address} />
          <a
            data-testid={`arweave-watched-explorer-${entry.id}`}
            href={explorerUrl(entry.address)}
            target="_blank"
            rel="noopener noreferrer"
            title="Open in Explorer"
            aria-label="Open in Explorer"
            onClick={(e) => e.stopPropagation()}
            style={iconButtonStyle}
          >
            <ExternalLinkGlyph style={{ width: 13, height: 13 }} />
          </a>
          {onRemove && (
            <button
              type="button"
              data-testid={`arweave-watched-remove-${entry.id}`}
              title="Stop watching this address"
              aria-label="Stop watching this address"
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
              style={dangerIconButtonStyle}
            >
              <TrashGlyph style={{ width: 13, height: 13 }} />
            </button>
          )}
        </span>
      </div>

      {onRelabel && (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, color: "#555" }}>Label</span>
          {editing ? (
            <>
              <input
                autoFocus
                data-testid={`arweave-watched-label-input-${entry.id}`}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveLabel();
                  if (e.key === "Escape") setEditing(false);
                }}
                style={{
                  flex: 1,
                  height: 26,
                  fontSize: 12,
                  padding: "0 8px",
                  borderRadius: 6,
                  backgroundColor: "#0a0a0a",
                  border: "1px solid #4ade8060",
                  color: "#d2d3d4",
                }}
              />
              <button
                type="button"
                data-testid={`arweave-watched-label-save-${entry.id}`}
                onClick={saveLabel}
                style={{ ...iconButtonStyle, width: "auto", padding: "0 10px", fontSize: 12 }}
              >
                Save
              </button>
              <button
                type="button"
                data-testid={`arweave-watched-label-cancel-${entry.id}`}
                onClick={() => setEditing(false)}
                style={{ ...iconButtonStyle, width: "auto", padding: "0 10px", fontSize: 12 }}
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              data-testid={`arweave-watched-label-edit-${entry.id}`}
              onClick={() => {
                setDraft(entry.label);
                setEditing(true);
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontSize: 11,
                padding: "2px 8px",
                borderRadius: 6,
                background: "transparent",
                border: "1px solid #262626",
                color: "#888",
                cursor: "pointer",
              }}
            >
              {entry.label || "(set label)"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function GroupSection({
  group,
  onDeleteKey,
  getBalance,
  balances,
  deps,
  onSendSuccess,
}: {
  group: Group;
  onDeleteKey?: (entry: ForeignKeyEntry) => Promise<void> | void;
  getBalance?: (address: string) => Promise<bigint>;
  balances: Record<string, BalanceState>;
  deps?: ArweavePanelDeps;
  onSendSuccess?: (address: string) => void;
}): React.ReactElement {
  const [open, setOpen] = useState(true);
  return (
    <div
      data-testid={`arweave-accounts-group-${group.id}`}
      style={{ border: "1px solid #262626", borderRadius: 12, overflow: "hidden" }}
    >
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        data-testid={`arweave-accounts-toggle-${group.id}`}
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 14px",
          cursor: "pointer",
          backgroundColor: "#0d0d0d",
        }}
      >
        {open ? (
          <ChevronDownGlyph style={{ width: 16, height: 16, flexShrink: 0, color: ACCENT }} />
        ) : (
          <ChevronRightGlyph style={{ width: 16, height: 16, flexShrink: 0, color: "#555" }} />
        )}
        <span style={{ flex: 1, fontWeight: 600, fontSize: 14, color: "#d2d3d4" }}>{group.label}</span>
        <span
          data-testid={`arweave-accounts-count-${group.id}`}
          style={{
            fontSize: 11,
            fontWeight: 600,
            padding: "1px 8px",
            borderRadius: 9999,
            color: "#555",
            backgroundColor: "#1a1a1a",
          }}
        >
          {group.entries.length}
        </span>
      </div>
      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 10 }}>
          {group.entries.length === 0 ? (
            <div style={{ fontSize: 12, color: "#666" }}>No addresses generated from this seed yet.</div>
          ) : (
            group.entries.map((entry) => (
              <AccountRow
                key={entry.id}
                entry={entry}
                onDeleteKey={onDeleteKey}
                getBalance={getBalance}
                protectedTier={group.protected}
                balances={balances}
                deps={deps}
                onSendSuccess={onSendSuccess}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function ArweaveAccountsArea({
  entries,
  seeds,
  onDeleteKey,
  getBalance,
  deps,
  watchedEntries = EMPTY_WATCHED_ENTRIES,
  onAddWatched,
  onRemoveWatched,
}: ArweaveAccountsAreaProps): React.ReactElement {
  const [subTab, setSubTab] = useState<"codex" | "watch">("codex");

  // T4: live per-row balances. Every entry's resolvable address — same
  // fallback the row itself uses (`entry.address ?? entry.id`) — PLUS (T2)
  // every watched address, so a watched row reads its balance through the
  // exact same fetch/refresh pipeline as a Codex-owned row.
  const addresses = useMemo(
    () => [
      ...entries.map((entry) => entry.address ?? entry.id),
      ...watchedEntries.map((w) => w.address),
    ],
    [entries, watchedEntries],
  );
  const [balances, setBalances] = useState<Record<string, BalanceState>>({});
  // When the FULL set (`refreshAllBalances`) last actually completed a read —
  // NOT when a per-row `fetchBalances([address])` fires alone, so "updated
  // Xs ago" always describes what the visible "Live balances" label claims.
  // `null` until the first read resolves (nothing rendered yet to be stale).
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);
  // Ticks once a second purely to force a re-render — `formatUpdatedAgo`
  // itself reads `Date.now()` fresh each render; this is what makes "Updated
  // 3s ago" advance on screen without any new network read.
  const [, setClockTick] = useState(0);

  /** Reads `getBalance(address)` for the given addresses, ALL in parallel via
   *  `Promise.allSettled` (no bulk-read capability exists in arweave-core —
   *  design.md), marking each address "loading" first so the value cell never
   *  silently keeps its stale content while a new read is in flight.
   *
   *  Also THE per-row refresh hook point a later task (T7's Send modal, after
   *  a successful send) can reuse — `fetchBalances([address])` refreshes
   *  exactly that one row without re-fetching every other row. */
  const fetchBalances = useCallback(
    (targets: readonly string[]) => {
      if (!getBalance) return;
      setBalances((prev) => {
        const next = { ...prev };
        for (const addr of targets) next[addr] = { status: "loading" };
        return next;
      });
      void Promise.allSettled(targets.map((addr) => getBalance(addr))).then((results) => {
        setBalances((prev) => {
          const next = { ...prev };
          results.forEach((result, i) => {
            const addr = targets[i];
            next[addr] =
              result.status === "fulfilled"
                ? { status: "ready", balance: result.value }
                : { status: "error" };
          });
          return next;
        });
      });
    },
    [getBalance],
  );

  const refreshAllBalances = useCallback(() => {
    fetchBalances(addresses);
    setLastFetchedAt(Date.now());
  }, [fetchBalances, addresses]);

  // Fires once per row on mount, and again whenever the entry list itself
  // changes (a key generated/imported/deleted) — re-reading the FULL set,
  // matching `refreshAllBalances`'s own scope.
  useEffect(() => {
    refreshAllBalances();
  }, [refreshAllBalances]);

  // Real on-chain confirmation for an Arweave send arrives up to ~10 minutes
  // AFTER `sendFrom` resolves (toastManager.ts's arweave poll) — long after
  // this row's own post-send `fetchBalances([address])` already fired at
  // BROADCAST time, before the debit was final. Without this, the balance
  // shown here just silently stays the pre-send figure until the user
  // remembers to click Refresh themselves. `onTxConfirmed` is a blunt "ANY
  // tx confirmed, somewhere" signal (no payload) — refreshing every visible
  // balance on it is cheap for this panel's realistic address counts and is
  // always correct, unlike guessing which single row to target.
  useEffect(() => onTxConfirmed(refreshAllBalances), [refreshAllBalances]);

  // Ticks the "updated Xs ago" label forward once a second while mounted.
  useEffect(() => {
    const id = setInterval(() => setClockTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const anyBalanceLoading = addresses.some((addr) => balances[addr]?.status === "loading");

  const groups = useMemo<Group[]>(() => {
    const known = new Map<string, ForeignKeyEntry[]>(seeds.map((seed) => [seed.id, []]));
    // Genuinely seedless (`seedId === undefined`) — the exact filter
    // `PureKeysArea.tsx` uses for its own list. These duplicate into that
    // standalone tab, so they group here as "Pure Keys", not "Unassigned".
    const pureKeys: ForeignKeyEntry[] = [];
    // A `seedId` naming no known seed — a TRUE orphan (unknown/legacy
    // provenance), distinct from the above.
    const unassigned: ForeignKeyEntry[] = [];

    for (const entry of entries) {
      if (entry.seedId === undefined) {
        pureKeys.push(entry);
        continue;
      }
      const bucket = known.get(entry.seedId);
      // A seedId naming no known seed → Unassigned, never dropped.
      if (bucket === undefined) unassigned.push(entry);
      else bucket.push(entry);
    }

    const out: Group[] = seeds.map((seed, i) => ({
      id: seed.id,
      // Same rule as Stoa: the prime seed is named by the product, not by its
      // stored label; every other seed falls back to its position.
      label: seed.isPrime === true || i === 0 ? PRIME_LABEL : seed.label || `Seed #${i + 1}`,
      entries: [...(known.get(seed.id) ?? [])].sort(byIndexAscending),
      // Protected unless the seed EXPLICITLY says its words are unknown this
      // session; absent `hasWords` (an older caller) defaults to Protected —
      // the conservative direction for a caller that predates this feature
      // (design.md §3).
      protected: seed.hasWords !== false,
    }));
    if (pureKeys.length > 0) {
      out.push({
        id: PURE_KEYS_ID,
        label: PURE_KEYS_LABEL,
        entries: [...pureKeys].sort(byIndexAscending),
        // Always Unprotected: no seed at all, by definition.
        protected: false,
      });
    }
    if (unassigned.length > 0) {
      out.push({
        id: UNASSIGNED_ID,
        label: UNASSIGNED_LABEL,
        entries: [...unassigned].sort(byIndexAscending),
        // Always Unprotected: unknown/legacy provenance, never provably recoverable.
        protected: false,
      });
    }
    return out;
  }, [entries, seeds]);

  // T2: the add-watched-address form's own local state — mirrors
  // `StoaAccountsTab.tsx`'s `handleAddWatch` shape exactly (module JSDoc).
  const [watchInput, setWatchInput] = useState("");
  const [watchError, setWatchError] = useState<string | null>(null);

  const handleAddWatch = useCallback(async (): Promise<void> => {
    setWatchError(null);
    const addr = watchInput.trim();
    if (!validateAddress(ARWEAVE_CHAIN_ID, addr)) {
      setWatchError("Not a valid Arweave address.");
      return;
    }
    if (entries.some((e) => e.address === addr)) {
      setWatchError("That address is already a Codex account.");
      return;
    }
    if (watchedEntries.some((w) => w.address === addr)) {
      setWatchError("Already watched.");
      return;
    }
    try {
      await onAddWatched?.(addr);
      setWatchInput("");
    } catch (e) {
      setWatchError(e instanceof Error ? e.message : "Could not add.");
    }
  }, [watchInput, entries, watchedEntries, onAddWatched]);

  return (
    <div
      data-testid="arweave-accounts-area"
      style={{ display: "flex", flexDirection: "column", gap: 16, color: "#d2d3d4" }}
    >
      {/* Total Addresses */}
      <div
        data-testid="arweave-accounts-total"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "14px 16px",
          borderRadius: 12,
          border: "1px solid #262626",
          backgroundColor: "#0a0a0a",
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: `${ACCENT}20`,
          }}
        >
          <svg {...svgBase} strokeWidth={1.6} style={{ width: 18, height: 18, color: ACCENT }}>
            <path d="M12 1.5 L22.5 12 L12 22.5 L1.5 12 Z" />
            <path d="M6.75 6.75 L17.25 17.25 M17.25 6.75 L6.75 17.25" />
          </svg>
        </div>
        <div>
          <div style={{ fontSize: 12, color: "#888" }}>Total Addresses</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#d2d3d4" }}>
            {entries.length + watchedEntries.length}
          </div>
        </div>
        <div style={{ flex: 1 }} />
        {/* T4: "Live balances / Refresh" — mirrors `StoaAccountsTab.tsx`'s own
            live-chain-status + refresh convention, adapted to this file's
            established inline-SVG styling. */}
        {anyBalanceLoading ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: "#888" }}>
            <RefreshGlyph style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} />
            Reading balances…
          </span>
        ) : (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: "#4ade80" }}>
            Live balances
            {/* "Live" alone doesn't say WHEN — there is no periodic polling,
                only on-mount/manual-refresh/post-send/post-confirmation
                reads, so this is how staleness is actually told at a glance. */}
            {lastFetchedAt !== null && (
              <span style={{ color: "#555" }} data-testid="arweave-accounts-updated-ago">
                · {formatUpdatedAgo(lastFetchedAt, Date.now())}
              </span>
            )}
          </span>
        )}
        <button
          type="button"
          data-testid="arweave-accounts-refresh"
          title="Refresh balances"
          onClick={refreshAllBalances}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "2px 8px",
            borderRadius: 6,
            border: "1px solid #262626",
            background: "transparent",
            color: "#888",
            cursor: "pointer",
            fontSize: 11,
          }}
        >
          <RefreshGlyph style={{ width: 11, height: 11 }} />
          Refresh
        </button>
      </div>

      {/* Codex / Watched toggle */}
      <div style={{ display: "flex", gap: 8 }}>
        {(
          [
            ["codex", "Codex Accounts", entries.length],
            ["watch", "Watched Accounts", watchedEntries.length],
          ] as const
        ).map(([key, label, count]) => {
          const active = subTab === key;
          return (
            <button
              key={key}
              type="button"
              data-testid={`arweave-accounts-subtab-${key}`}
              aria-pressed={active}
              onClick={() => setSubTab(key)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 14px",
                borderRadius: 10,
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                border: `1px solid ${active ? ACCENT : "#262626"}`,
                backgroundColor: active ? ACCENT : "#111",
                color: active ? "#0a0a0a" : "#888",
              }}
            >
              {label}
              <span
                style={{
                  fontSize: 11,
                  padding: "0 7px",
                  borderRadius: 9999,
                  backgroundColor: active ? "#0a0a0a20" : "#262626",
                  color: active ? "#0a0a0a" : "#555",
                }}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {subTab === "codex" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {entries.length === 0 ? (
            <div
              data-testid="arweave-accounts-empty"
              style={{
                padding: "24px",
                borderRadius: 12,
                border: "1px dashed #262626",
                color: "#666",
                fontSize: 13,
              }}
            >
              No Arweave addresses yet. Define a seed and generate one to see it here.
            </div>
          ) : (
            groups.map((group) => (
              <GroupSection
                key={group.id}
                group={group}
                onDeleteKey={onDeleteKey}
                getBalance={getBalance}
                balances={balances}
                deps={deps}
                onSendSuccess={(address) => fetchBalances([address])}
              />
            ))
          )}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {/* T2: add-address form — ALWAYS rendered in the watch tab, even
              while the list is empty (mirrors Chainweb's own tab, module
              JSDoc). The submit button stays enabled-looking but `disabled`
              while `onAddWatched` is unwired, so an unwired seam never
              silently no-ops on click. */}
          <div style={{ display: "flex", gap: 8 }}>
            <span style={{ display: "inline-flex", alignItems: "center", padding: "0 10px", color: "#888" }}>
              <EyeGlyph style={{ width: 16, height: 16 }} />
            </span>
            <input
              data-testid="arweave-watch-input"
              value={watchInput}
              onChange={(e) => setWatchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleAddWatch();
              }}
              placeholder="Watch an Arweave address…"
              spellCheck={false}
              style={{
                flex: 1,
                padding: "8px 12px",
                borderRadius: 8,
                outline: "none",
                backgroundColor: "#0a0a0a",
                border: "1px solid #262626",
                color: "#d2d3d4",
                fontSize: 13,
                fontFamily: MONO,
              }}
            />
            <button
              type="button"
              data-testid="arweave-watch-submit"
              disabled={onAddWatched === undefined}
              onClick={() => void handleAddWatch()}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 14px",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                border: "none",
                backgroundColor: onAddWatched === undefined ? "#262626" : ACCENT,
                color: onAddWatched === undefined ? "#666" : "#0a0a0a",
                cursor: onAddWatched === undefined ? "not-allowed" : "pointer",
              }}
            >
              Watch
            </button>
          </div>
          {watchError && (
            <p role="alert" style={{ fontSize: 12, color: "#f87171", margin: 0 }}>
              {watchError}
            </p>
          )}

          {watchedEntries.length === 0 ? (
            <div
              data-testid="arweave-accounts-watched-empty"
              style={{
                textAlign: "center",
                padding: "32px 0",
                borderRadius: 12,
                border: "1px dashed #262626",
                color: "#555",
                fontSize: 13,
              }}
            >
              <EyeGlyph style={{ width: 24, height: 24, opacity: 0.4 }} />
              <p style={{ fontSize: 14, margin: "8px 0 0" }}>No watched addresses.</p>
            </div>
          ) : (
            watchedEntries.map((w) => (
              <WatchedRow
                key={w.id}
                entry={w}
                balances={balances}
                onRelabel={
                  onAddWatched ? (label: string) => void onAddWatched(w.address, label) : undefined
                }
                onRemove={onRemoveWatched ? () => void onRemoveWatched(w.id) : undefined}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default ArweaveAccountsArea;
