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
 */

import * as React from "react";
import { useMemo, useState } from "react";

import type { ForeignKeyEntry } from "@ancientpantheon/codex-core";
import { winstonToAr } from "@ancientpantheon/arweave-core";

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
const ExternalLinkGlyph = ({ style }: { style?: React.CSSProperties }): React.ReactElement => (
  <svg {...svgBase} style={style}>
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <path d="M15 3h6v6" />
    <path d="M10 14 21 3" />
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
   *  omits it gets today's plain confirm-then-delete panel, unchanged
   *  (design.md §3). When wired, a funded row's delete guard branches on its
   *  group's `protected` tier (see {@link Group}). */
  getBalance?: (address: string) => Promise<bigint>;
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

function AccountRow({
  entry,
  onDeleteKey,
  getBalance,
  protectedTier,
}: {
  entry: ForeignKeyEntry;
  onDeleteKey?: (entry: ForeignKeyEntry) => Promise<void> | void;
  getBalance?: (address: string) => Promise<bigint>;
  /** This row's group's balance-delete-guard tier (design.md §3). Only
   *  consulted once a funded balance is actually read. */
  protectedTier: boolean;
}): React.ReactElement {
  // `address` is plaintext public material; `id` is the fallback. The
  // `encryptedKeyfile` is never read here — see module JSDoc.
  const address = entry.address ?? entry.id;
  const position = typeof entry.index === "number" ? `#${entry.index}` : (entry.label ?? "—");

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
        {/* Balances are out of scope for this whole project (design.md) — this
            is a static placeholder, never a store or network read. */}
        <span
          data-testid={`arweave-account-value-${entry.id}`}
          style={{ fontFamily: MONO, fontSize: 12, fontWeight: 600, color: "#555", flexShrink: 0 }}
        >
          Empty
        </span>
        <span
          onClick={(e) => e.stopPropagation()}
          style={{ display: "inline-flex", gap: 6, flexShrink: 0 }}
        >
          <button
            type="button"
            data-testid={`arweave-account-copy-${entry.id}`}
            title="Copy address"
            aria-label="Copy address"
            onClick={(e) => {
              e.stopPropagation();
              // Same idiom as `ArweaveSeedsArea.tsx`'s copy handler: `void` a
              // possibly-undefined result rather than chaining `.catch` onto
              // it, since a bare `vi.fn()` test double returns `undefined`.
              void navigator.clipboard?.writeText(address);
            }}
            style={iconButtonStyle}
          >
            <CopyGlyph style={{ width: 13, height: 13 }} />
          </button>
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
    </div>
  );
}

function GroupSection({
  group,
  onDeleteKey,
  getBalance,
}: {
  group: Group;
  onDeleteKey?: (entry: ForeignKeyEntry) => Promise<void> | void;
  getBalance?: (address: string) => Promise<bigint>;
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
}: ArweaveAccountsAreaProps): React.ReactElement {
  const [subTab, setSubTab] = useState<"codex" | "watch">("codex");

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

  // Arweave has no watch-list yet; the tab exists (and reads 0) so this page and
  // Chainweb's stay structurally identical.
  const WATCHED_COUNT = 0;

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
            {entries.length + WATCHED_COUNT}
          </div>
        </div>
      </div>

      {/* Codex / Watched toggle */}
      <div style={{ display: "flex", gap: 8 }}>
        {(
          [
            ["codex", "Codex Accounts", entries.length],
            ["watch", "Watched Accounts", WATCHED_COUNT],
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
              <GroupSection key={group.id} group={group} onDeleteKey={onDeleteKey} getBalance={getBalance} />
            ))
          )}
        </div>
      ) : (
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
      )}
    </div>
  );
}

export default ArweaveAccountsArea;
