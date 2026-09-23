/**
 * PureKeysArea — the Arweave "Pure Keys" category listing.
 *
 * A pure key is a key with NO seed behind it: either genuinely random RSA-4096
 * (unrecoverable if lost, no determinism) or imported from an external Arweave
 * keyfile. Both land in the SAME `ForeignKeyEntry`/`foreignKeys` slice as
 * seed-derived keys, just with `seedId` left `undefined` — this area filters
 * to exactly that subset; seed-derived keys are Seeds'/Accounts' territory.
 *
 * REPLACES `KeyringArea.tsx` (deleted). That component's rename/export/delete
 * handlers hardcoded `foreignKeys[0]` regardless of which row the user clicked
 * — a real bug, fixed here by giving each rendered key its OWN per-row
 * controls, explicitly keyed by that row's `entry.id`/`entry`, mirroring
 * `ArweaveAccountsArea.tsx`'s `AccountRow` (its `iconButtonStyle`/
 * `dangerIconButtonStyle` and two-step confirm-delete pattern are reused here
 * for visual/interaction consistency — both areas belong to the same panel).
 * It also replaced the old paste-into-a-visible-`<textarea>` import flow with
 * a hidden `<input type="file">` (mirroring `BitmapKeyInput.tsx`'s
 * `handleImportFile` idiom): a raw keyfile is exactly the class of secret
 * material this whole project keeps off the screen.
 *
 * A SECOND import method, additive to the JSON-keyfile one above: classical
 * PEM (two files — a private-key `.pem` and a matching public-key `.pem`),
 * for a user who already has an Arweave RSA-4096 key as a pair of PEM files
 * rather than a JSON keyfile. The parse is the exact roundtrip-symmetric
 * inverse of this panel's own PEM *export* (`ArweaveSeedsArea.tsx`'s
 * `downloadKeyArtefact`: standard PKCS#8/SPKI DER, produced by WebCrypto, not
 * a hand-rolled PKCS#1 encoding) — strip the PEM armor, base64-decode to DER,
 * `crypto.subtle.importKey("pkcs8"|"spki", …)`, then `exportKey("jwk", …)` to
 * read the resulting fields back off WebCrypto itself. No manual ASN.1
 * parsing anywhere in this file. Still file-upload, still never a textarea:
 * same secret-hygiene reasoning as the JSON path, just two files instead of
 * one.
 *
 * Funds/secret-critical (FIX-5/FIX-6), preserved from `KeyringArea` with one
 * deliberate change (design.md §5 — the Generate/Save two-step flow):
 *   - The plaintext JWK is NEVER rendered and NEVER lands in a DOM node, but
 *     for the random-generate flow it DOES now live briefly in the `pendingKey`
 *     React state between "Generate Random Key" and "Save to Codex" — the
 *     Arweave analogue of Chainweb `GenerateSubtab`'s `pair.secretKey`,
 *     unavoidable because the key must be rerollable in memory before it is
 *     ever encrypted. It is handed to `generateArweaveKey`/`addForeignKey`
 *     (and then discarded) exactly once, on Save, never logged, and never
 *     displayed except through `RsaParamsSection`'s own reveal-gated fields.
 *     On import, the parsed file content is still handed straight to
 *     `importArweaveKey` and dropped immediately — the File itself is never
 *     kept, only the resulting ciphertext `ForeignKeyEntry` survives. On
 *     export, the decrypted keyfile is delivered as a TRANSIENT object-URL
 *     download, revoked immediately after — never into an input/textarea/
 *     copyable node.
 *   - The generate flow drives its pending/progress/disabled state off a React
 *     pending flag (NOT off the progress event's field), so it is
 *     non-re-entrant while the `runKeygen` promise is in flight.
 *
 * Icons are INLINE SVG, deliberately NOT `lucide-react`: that package lives
 * only at the repo root, where `react` resolves to the stale hoisted React 18
 * (same rule as every other file in this panel — see `ArweaveAccountsArea.tsx`
 * module JSDoc). The glyphs are duplicated locally rather than imported so
 * this module stays self-contained, exactly as `ArweaveAccountsArea.tsx`
 * duplicates `ArweaveSeedsArea.tsx`'s `TrashGlyph` rather than importing it.
 *
 * Top-level structure (design.md §6): a persistent 3-pill `subTab` bar (List/
 * Generate/Import — same shape as `PureKeypairsTab.tsx`'s `sub`/`TABS`, this
 * panel's own `ACCENT`/pill styling instead of Chainweb's per-tab colors).
 * The Generate body is a genuinely separate `GenerateSubtab` child component
 * that MOUNTS only while `subTab === "generate"`, so React discards its
 * `pendingKey`/`label` state the instant the user navigates away — no
 * unsaved plaintext JWK survives in a hidden/inert component.
 */

import * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { ForeignKeyEntry } from "@ancientpantheon/codex-core";
import { type ArweaveJwk, addressOf, winstonToAr } from "@ancientpantheon/arweave-core";
import { useIsMobile } from "@ancientpantheon/codex-ui/ui";
import { CodexModalShell } from "@ancientpantheon/codex-ouronet/ui";

import type { KeygenRunner } from "./context.js";
import { RsaParamsPanel, RsaParamsSection, RsaParamsToggle, useRsaParamsSection } from "./ArweaveSeedsArea.js";
import { ArweaveAddressHighlight } from "./ArweaveAccountsArea.js";

/** Same MONO/ACCENT this panel's Accounts category uses — one visual language
 *  across both categories. Duplicated (not imported) for the same reason
 *  `ArweaveAccountsArea.tsx` duplicates `ArweaveSeedsArea.tsx`'s glyphs: each
 *  area module stays self-contained. */
const MONO = "var(--codex-font-mono, 'JetBrains Mono', ui-monospace, monospace)";
const ACCENT = "#ceac5f";

/** One `PureKeyRow`'s measured height + the gap between rows — a flat,
 *  uniform-height list (no groups/headers). Mirrors Chainweb
 *  `PureKeypairsTab.tsx`'s own `useMobileKeypairPageSize` exactly.
 *  Duplicated per this package's own "self-contained module" convention. */
/** Round 26: trimmed alongside `PureKeyRow`'s own mobile padding/avatar cut
 *  (58px → ~34px real row height) — same treatment `PureKeypairsTab.tsx`'s
 *  own `KEYPAIR_ROW_HEIGHT_FALLBACK` got in the same round. Only the
 *  FALLBACK moves; the real row is always live-measured once mounted. */
const KEYPAIR_ROW_HEIGHT_FALLBACK = 34;
const KEYPAIR_ROW_GAP = 6;

function useMobileKeypairPageSize(): {
  containerRef: React.RefObject<HTMLDivElement | null>;
  rowRef: (node: HTMLDivElement | null) => void;
  pageSize: number;
} {
  const containerRef = useRef<HTMLDivElement>(null);
  const [rowEl, setRowEl] = useState<HTMLDivElement | null>(null);
  const [rowHeight, setRowHeight] = useState(KEYPAIR_ROW_HEIGHT_FALLBACK);
  const [pageSize, setPageSize] = useState(4);

  useEffect(() => {
    if (!rowEl) return;
    const measure = () => {
      const h = rowEl.getBoundingClientRect().height;
      if (h > 0) setRowHeight(h);
    };
    measure();
    let raf = 0;
    if (typeof requestAnimationFrame !== "undefined") raf = requestAnimationFrame(measure);
    const fontsReady = (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts?.ready;
    fontsReady?.then(measure).catch(() => {});
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(measure);
      ro.observe(rowEl);
    }
    return () => {
      ro?.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [rowEl]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const compute = () => {
      const height = el.clientHeight - 2 * KEYPAIR_ROW_GAP;
      if (height <= 0) return;
      const maxRows = Math.floor((height + KEYPAIR_ROW_GAP) / (rowHeight + KEYPAIR_ROW_GAP));
      setPageSize(Math.max(1, maxRows));
    };
    compute();
    let raf = 0;
    if (typeof requestAnimationFrame !== "undefined") raf = requestAnimationFrame(compute);
    if (typeof window !== "undefined") window.addEventListener("resize", compute);
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(compute);
      ro.observe(el);
    }
    return () => {
      ro?.disconnect();
      if (raf) cancelAnimationFrame(raf);
      if (typeof window !== "undefined") window.removeEventListener("resize", compute);
    };
  }, [rowHeight]);

  return { containerRef, rowRef: setRowEl, pageSize };
}

/** Mirrors `ArweaveAccountsArea.tsx`'s identical `PageJumpIndicator`. */
function PageJumpIndicator({ page, totalPages, onJump }: { page: number; totalPages: number; onJump: (page: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  if (totalPages <= 10) {
    return <span style={{ fontSize: 12, fontFamily: MONO, color: "#888" }}>{page + 1} / {totalPages}</span>;
  }
  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => { setDraft(String(page + 1)); setEditing(true); }}
        title="Jump to a page"
        style={{ fontSize: 12, fontFamily: MONO, color: ACCENT, background: "transparent", border: "none", cursor: "pointer", padding: 0, textDecoration: "underline dotted" }}
      >
        {page + 1} / {totalPages}
      </button>
    );
  }
  const commit = () => {
    const n = parseInt(draft, 10);
    if (Number.isFinite(n)) onJump(Math.max(0, Math.min(totalPages - 1, n - 1)));
    setEditing(false);
  };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <input
        autoFocus
        type="number"
        min={1}
        max={totalPages}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
        onBlur={commit}
        aria-label={`Jump to page (1-${totalPages})`}
        style={{ width: 44, fontSize: 12, fontFamily: MONO, padding: "2px 4px", borderRadius: 6, border: `1px solid ${ACCENT}`, backgroundColor: "#0a0a0a", color: "#d2d3d4", textAlign: "center" }}
      />
      <span style={{ fontSize: 12, fontFamily: MONO, color: "#888" }}>/ {totalPages}</span>
    </span>
  );
}

/** Mirrors `ArweaveAccountsArea.tsx`'s identical Prev/Next button style. */
const pageBtn = (disabled: boolean): React.CSSProperties => ({
  fontSize: 12, padding: "6px 12px", borderRadius: 8, border: "1px solid #262626", color: "#d2d3d4",
  background: "transparent", cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.3 : 1,
});

const svgBase = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

const CopyGlyph = ({ style }: { style?: React.CSSProperties }): React.ReactElement => (
  <svg {...svgBase} style={style}>
    <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
  </svg>
);
const PencilGlyph = ({ style }: { style?: React.CSSProperties }): React.ReactElement => (
  <svg {...svgBase} style={style}>
    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
  </svg>
);
const DownloadGlyph = ({ style }: { style?: React.CSSProperties }): React.ReactElement => (
  <svg {...svgBase} style={style}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="M7 10l5 5 5-5" />
    <path d="M12 15V3" />
  </svg>
);
/** Same glyph as `ArweaveAccountsArea.tsx`'s `TrashGlyph` — duplicated for the
 *  same self-containment reason. */
const TrashGlyph = ({ style }: { style?: React.CSSProperties }): React.ReactElement => (
  <svg {...svgBase} style={style}>
    <path d="M3 6h18" />
    <path d="M8 6V4h8v2" />
    <path d="M19 6l-1 14H6L5 6" />
  </svg>
);
const KeyGlyph = ({ style }: { style?: React.CSSProperties }): React.ReactElement => (
  <svg {...svgBase} style={style}>
    <circle cx="8" cy="15" r="4" />
    <path d="m10.85 12.15 7.4-7.4" />
    <path d="m18 5 3 3" />
    <path d="m15 8 2 2" />
  </svg>
);
/** Round 26 — the Generate sub-tab's icon (mobile icon-only row), matching
 *  Chainweb's own `Sparkles` (lucide-react — this file never imports it,
 *  same self-containment reason as every other glyph here). */
const SparkleGlyph = ({ style }: { style?: React.CSSProperties }): React.ReactElement => (
  <svg {...svgBase} style={style}>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" />
  </svg>
);
/** The row-collapse chevrons, matching `ArweaveSeedsArea.tsx`'s own
 *  `ChevronDownGlyph`/`ChevronRightGlyph` paths — one visual language across
 *  this panel's areas, duplicated (not imported) for the same self-contained
 *  reason every other glyph here is (module JSDoc). */
const ChevronDownGlyph = ({ style }: { style?: React.CSSProperties }): React.ReactElement => (
  <svg {...svgBase} style={style}><path d="m6 9 6 6 6-6" /></svg>
);
const ChevronRightGlyph = ({ style }: { style?: React.CSSProperties }): React.ReactElement => (
  <svg {...svgBase} style={style}><path d="m9 18 6-6-6-6" /></svg>
);
/** The PEM-import match/mismatch status glyphs — this file's own inline-SVG
 *  idiom (module JSDoc), standing in for the Chainweb import reference's
 *  `ShieldCheck`/`AlertTriangle` (that reference is `lucide-react`, which this
 *  file never imports). */
const CheckGlyph = ({ style }: { style?: React.CSSProperties }): React.ReactElement => (
  <svg {...svgBase} style={style}>
    <path d="M20 6 9 17l-5-5" />
  </svg>
);
const WarningGlyph = ({ style }: { style?: React.CSSProperties }): React.ReactElement => (
  <svg {...svgBase} style={style}>
    <path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </svg>
);

/** Same icon-button styles as `ArweaveAccountsArea.tsx` — duplicated so this
 *  module stays self-contained (module JSDoc). */
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

/** Same shape as the JSON-import "Choose Keyfile" trigger — the PEM import's
 *  two file-choose buttons look like one family with it. */
const pemChooseButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "8px 14px",
  borderRadius: 10,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  border: "1px solid #262626",
  backgroundColor: "#111",
  color: "#888",
};

/** "Clear" — discards ONE already-picked PEM half without needing to pick a
 *  replacement file, so a user can back out of a wrong choice at any point
 *  (before or after the other half is validated). Smaller/quieter than the
 *  choose button since it's a secondary, destructive-but-harmless action. */
const pemClearButtonStyle: React.CSSProperties = {
  padding: "6px 10px",
  borderRadius: 8,
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  border: "1px solid #262626",
  backgroundColor: "transparent",
  color: "#f87171",
};

/** Middle-truncates a PEM-derived `n` (a giant base64url modulus) to a short,
 *  screen-friendly confirmation string — never the full value, which would
 *  just be noise here (the real, full value only matters to the address
 *  derivation and the final saved key, not to this "yes, something loaded"
 *  glance). */
function truncatePemField(value: string): string {
  if (value.length <= 28) return value;
  return `${value.slice(0, 20)}…${value.slice(-6)}`;
}

/** The cap `RandomKeygenProgress`'s bar ramps toward and holds at — WebCrypto's
 *  `generateKey()` gives no progress callback at all, so this is deliberately
 *  NOT a real completion percent (design.md §4: "do not fabricate fake
 *  position/attempt numbers"). It exists only so the affordance never reads
 *  100% before the key is actually done. */
const RANDOM_KEYGEN_PROGRESS_CAP = 92;
/** Wall-clock ms over which the bar ramps from 0 toward the cap. */
const RANDOM_KEYGEN_RAMP_MS = 4000;
/** How often the elapsed-time tick recomputes the displayed percent. */
const RANDOM_KEYGEN_TICK_MS = 100;

/**
 * A self-contained elapsed-time progress bar for the random-generate flow,
 * replacing the old plain "Generating key…" text (design.md §4). There is no
 * real progress signal for a single WebCrypto `generateKey()` call (unlike the
 * seeded worker's `RunProgress`, driven by actual `batch-progress` events), so
 * this ramps toward a 92% cap over ~4s of elapsed time and holds there for as
 * long as generation runs past that — visually matching `RunProgress`'s bar
 * (same height/radius/ACCENT fill/track color) without claiming a specific ETA.
 *
 * Remounts fresh every time `creating` flips true (its caller only mounts it
 * while `creating` is true), so the elapsed timer naturally restarts per attempt.
 */
function RandomKeygenProgress(): React.ReactElement {
  const startedAt = useRef(Date.now());
  const [percent, setPercent] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      const elapsed = Date.now() - startedAt.current;
      setPercent(Math.min(RANDOM_KEYGEN_PROGRESS_CAP, Math.round((elapsed / RANDOM_KEYGEN_RAMP_MS) * RANDOM_KEYGEN_PROGRESS_CAP)));
    }, RANDOM_KEYGEN_TICK_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div
        data-testid="arweave-pure-key-progress-bar"
        data-percent={String(percent)}
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        style={{
          height: 4,
          borderRadius: 999,
          overflow: "hidden",
          backgroundColor: "#1a1a1a",
        }}
      >
        <div
          style={{
            width: `${percent}%`,
            height: "100%",
            backgroundColor: ACCENT,
            transition: "width 200ms ease",
          }}
        />
      </div>
      <div data-testid="arweave-pure-key-progress-status" style={{ fontSize: 12, color: "#888" }}>
        Generating a random RSA-4096 key… this can take several seconds.
      </div>
    </div>
  );
}

export interface PureKeysAreaProps {
  /** The current foreign-key entries (ciphertext-only), any chain/seed mix —
   *  this area filters to the SEEDLESS subset itself (`seedId === undefined`). */
  foreignKeys: ForeignKeyEntry[];
  /** The off-main-thread keygen seam driving the create-random-key flow. */
  keygenRunner: KeygenRunner;
  /** E1 generate: encrypts the handed JWK at rest, returns the ciphertext entry. */
  generateArweaveKey: (args: { jwk: ArweaveJwk; label?: string }) => Promise<ForeignKeyEntry>;
  /** E1 import: validates + encrypts a raw keyfile, returns the ciphertext entry. */
  importArweaveKey: (raw: unknown, opts?: { label?: string }) => Promise<ForeignKeyEntry>;
  /** E1 decrypt: unlock-gated decrypt of an entry to its transient JWK (export flow). */
  decryptArweaveKey: (entry: ForeignKeyEntry) => Promise<ArweaveJwk>;
  /** Persist a pre-encrypted entry into the foreign-key slice. */
  addForeignKey: (entry: ForeignKeyEntry) => Promise<void>;
  /** Rename an entry by id. */
  renameForeignKey: (id: string, label: string) => Promise<void>;
  /** Delete an entry by id. */
  deleteForeignKey: (id: string) => Promise<void>;
  /** E2 balance read (winston bigint). OPTIONAL and additive — a caller that
   *  omits it gets today's plain confirm-then-delete panel, unchanged. Every
   *  Pure Keys row is seedless by definition, so a funded row is ALWAYS the
   *  "Unprotected" tier (design.md §3): no seed can ever regenerate it, so a
   *  balance `> 0n` blocks deletion outright rather than merely warning. */
  getBalance?: (address: string) => Promise<bigint>;
  /**
   * Reports the list's OWN pagination state so `ArweavePanel` can render it
   * in the shared "middle of the bottom seam" medallion slot — round 9/10
   * owner correction: "we need pagination on the pure keys as well, which
   * should kick in once enough entries exist" + "standard pagination
   * controls zone." Mirrors Chainweb `PureKeypairsTab.tsx`'s own identical
   * prop — Pure Keys never has a Collapse-All medallion of its own (flat
   * list, no groups), so the shared slot is always free for its own
   * pagination. Omitted (every standalone mount), this component keeps
   * rendering its own inline Prev/Next.
   */
  onPaginationHandleChange?: (
    handle: { page: number; totalPages: number; onPrev: () => void; onNext: () => void; onJump: (page: number) => void } | null,
  ) => void;
  /**
   * MOBILE ONLY — round 27 owner correction: "clickign fathippo, opens it
   * in place. i want it to be opened in new page, same as seed, this is
   * only for arweave as it has more detail." Mirrors
   * `ArweaveSeedsAreaProps.fullScreenPortalTarget` exactly: a DOM node
   * spanning the host's whole mobile body, via `createPortal`, so a
   * row's expanded detail (address, RSA parameters, rename/export/delete)
   * covers the WHOLE screen on mobile instead of expanding inline within
   * this tab's own Zone 3 rectangle. Omitted (the default) falls back to
   * today's bounded inline expand, unchanged — including on Chainweb's
   * own `PureKeypairsTab.tsx`, which this prop deliberately has no
   * equivalent of (the owner asked for Arweave only: "THe pure chainweb
   * key can remain as is").
   */
  fullScreenPortalTarget?: Element | null;
}

/** A locked codex surfaces this so the export flow can prompt for unlock rather
 *  than crashing. Detected by name so we do not couple to the concrete class. */
function isCodexLockedError(err: unknown): boolean {
  return err instanceof Error && err.name === "CodexLockedError";
}

/** The final 6 characters of a canonical Arweave address — always present and
 *  unique per entry, so two default-labeled keys never collide (design.md §2). */
function last6(value: string): string {
  return value.slice(-6);
}

/* ─────────────────────────── PEM import (Part B) ─────────────────────────── */

/** The signing algorithm PEM import/export both use — same constant
 *  `ArweaveSeedsArea.tsx`'s `downloadKeyArtefact` defines, duplicated here per
 *  this file's own self-containment convention (module JSDoc). It does not
 *  change the key material either direction. */
const RSA_ALG = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;

/** The private half's parsed fields — everything an `ArweaveJwk` needs besides
 *  `kty`. Held in state only as long as the pending import is unsaved (same
 *  discipline as `GenerateSubtab`'s `pendingKey`); the raw PEM text itself is
 *  discarded the instant this is produced. */
interface PrivatePemFragment {
  n: string;
  e: string;
  d: string;
  p: string;
  q: string;
  dp: string;
  dq: string;
  qi: string;
}

/** The public half's parsed fields — just enough to cross-check against the
 *  private half's own `n`/`e` before anything is assembled or saved. */
interface PublicPemFragment {
  n: string;
  e: string;
}

/** PEM armor → raw DER bytes: strip the `-----BEGIN/END …-----` header/footer
 *  and all whitespace, then base64-decode the body. PEM's alphabet is
 *  STANDARD base64 (unlike a JWK member's base64url), so `atob` — not the
 *  hand-rolled base64url decoder `ArweaveSeedsArea.tsx` uses for JWK fields —
 *  is the correct, self-contained decoder here; it is also `abToB64`'s exact
 *  inverse, the same pairing `downloadKeyArtefact` relies on for export.
 *  Throws on non-base64 content — the caller turns that into a per-file
 *  error, never a crash. */
function pemToDer(pemText: string): ArrayBuffer {
  const body = pemText
    .replace(/-----BEGIN [^-]+-----/, "")
    .replace(/-----END [^-]+-----/, "")
    .replace(/\s+/g, "");
  if (body === "") throw new Error("That file has no PEM-encoded content.");
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** Parses a PKCS#8 private-key PEM (the exact format `downloadKeyArtefact`'s
 *  own `"priv"` export produces) into its 8 non-`kty` JWK fields, entirely via
 *  WebCrypto — no manual ASN.1/DER parsing. Throws a readable message on any
 *  failure (bad base64, wrong DER shape, not an RSA key): the caller shows it
 *  as that file's own error, never a crash. */
async function parsePrivatePem(pemText: string): Promise<PrivatePemFragment> {
  const der = pemToDer(pemText);
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey("pkcs8", der, RSA_ALG, true, ["sign"]);
  } catch {
    throw new Error("That file is not a valid PKCS#8 RSA private key.");
  }
  const jwk = await crypto.subtle.exportKey("jwk", key);
  const { n, e, d, p, q, dp, dq, qi } = jwk;
  if (!n || !e || !d || !p || !q || !dp || !dq || !qi) {
    throw new Error("That private key is missing required RSA parameters.");
  }
  return { n, e, d, p, q, dp, dq, qi };
}

/** Parses an SPKI public-key PEM (the exact format `downloadKeyArtefact`'s own
 *  `"pub"` export produces) into its `n`/`e` fields, entirely via WebCrypto. */
async function parsePublicPem(pemText: string): Promise<PublicPemFragment> {
  const der = pemToDer(pemText);
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey("spki", der, RSA_ALG, true, ["verify"]);
  } catch {
    throw new Error("That file is not a valid SPKI RSA public key.");
  }
  const jwk = await crypto.subtle.exportKey("jwk", key);
  const { n, e } = jwk;
  if (!n || !e) {
    throw new Error("That public key is missing required RSA parameters.");
  }
  return { n, e };
}

/** The Delete flow's state machine when `getBalance` is wired (design.md §3):
 *  `"idle"` (nothing shown yet), `"checking"` (the read is in flight),
 *  `"confirm"` (the plain, pre-existing confirm/cancel panel — reached
 *  directly when `getBalance` is absent, or after a zero/failed read),
 *  `"blocked"` (balance `> 0n` — Pure Keys is ALWAYS the Unprotected tier, so
 *  there is no delete action here at all, only dismiss). */
type DeleteGuardState = "idle" | "checking" | "confirm" | "blocked";

/** Portals `children` into `target` (mobile, e.g. `ArweavePanel`'s
 *  `fullScreenPortalTarget`) when supplied, or renders them inline exactly
 *  where they already are otherwise — the SAME contract `ArweaveSeedsArea.tsx`'s
 *  own (unexported) `MobilePortal` uses; duplicated here per this package's
 *  "self-contained module" convention rather than importing it. */
function MobilePortal({ target, children }: { target?: Element | null; children: React.ReactNode }) {
  return target ? createPortal(children, target) : <>{children}</>;
}

function PureKeyRow({
  entry,
  decryptArweaveKey,
  renameForeignKey,
  deleteForeignKey,
  getBalance,
  fullScreenPortalTarget,
}: {
  entry: ForeignKeyEntry;
  decryptArweaveKey: PureKeysAreaProps["decryptArweaveKey"];
  renameForeignKey: PureKeysAreaProps["renameForeignKey"];
  deleteForeignKey: PureKeysAreaProps["deleteForeignKey"];
  getBalance: PureKeysAreaProps["getBalance"];
  fullScreenPortalTarget?: Element | null;
}): React.ReactElement {
  // Plaintext public material only — never `encryptedKeyfile`. See module JSDoc.
  const address = entry.address ?? entry.id;
  // Round 26 — see the collapsed header's own doc comment below.
  const isMobile = useIsMobile();

  /** The row's own collapsed/expanded state (Chainweb `PureKeypairsTab`'s
   *  `KeypairRow` pattern) — DISTINCT from `RsaParamsSection`'s own `open`
   *  state, which gates only its inner "RSA parameters" disclosure once this
   *  row is already expanded. Collapsed shows ONLY the header strip below:
   *  no address, no action icons, matching Chainweb's List subtab exactly. */
  const [expanded, setExpanded] = useState(false);

  const [renameOpen, setRenameOpen] = useState(false);
  const [renameText, setRenameText] = useState(entry.label ?? "");

  // Round 26 owner correction: "Clicking copy buttons should show the
  // green check after its been tapped, just like on desktop." This row's
  // own copy button never had ANY feedback on either platform — unlike
  // Chainweb's `KeyFieldsHalves`/`MiniBtn`, which already does exactly
  // this (`useState` + `setTimeout` reset), the same shape `CopyValueBtn`
  // (`DalosSecretReveal.tsx`) and `IconCopyBtn` (`IconButtons.tsx`) use
  // elsewhere in this codebase.
  const [addressCopied, setAddressCopied] = useState(false);
  const handleCopyAddress = useCallback(() => {
    void navigator.clipboard?.writeText(address);
    setAddressCopied(true);
    setTimeout(() => setAddressCopied(false), 1200);
  }, [address]);

  const [exportOpen, setExportOpen] = useState(false);
  const [locked, setLocked] = useState(false);

  const [deleteGuard, setDeleteGuard] = useState<DeleteGuardState>("idle");
  const [blockedBalance, setBlockedBalance] = useState<bigint | null>(null);
  const confirmingDelete = deleteGuard === "confirm";

  /** ONE `RsaParamsSection` state instance for this row, shared by the inline
   *  `RsaParamsToggle` (placed with the action icons, on the address row) and
   *  the `RsaParamsPanel` (its own row below) — the split that lets the
   *  toggle move up a row without duplicating any of the reveal/decrypt
   *  state `RsaParamsSection` used to own as one inseparable unit. */
  const rsaParams = useRsaParamsSection({
    index: entry.id,
    loadJwk: () => decryptArweaveKey(entry),
  });

  const handleRenameSubmit = useCallback(async () => {
    await renameForeignKey(entry.id, renameText);
    setRenameOpen(false);
  }, [entry.id, renameForeignKey, renameText]);

  const handleExportConfirm = useCallback(async () => {
    setLocked(false);
    let jwk: ArweaveJwk;
    try {
      jwk = await decryptArweaveKey(entry);
    } catch (err) {
      if (isCodexLockedError(err)) setLocked(true);
      return;
    }
    // Deliver the keyfile as a TRANSIENT object-URL download, revoked right
    // after. The plaintext never touches a rendered/copyable DOM node.
    const blob = new Blob([JSON.stringify(jwk)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    try {
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${entry.id}.json`;
      anchor.click();
    } finally {
      URL.revokeObjectURL(url);
    }
    setExportOpen(false);
  }, [entry, decryptArweaveKey]);

  const handleDeleteConfirm = useCallback(async () => {
    setDeleteGuard("idle");
    await deleteForeignKey(entry.id);
  }, [entry.id, deleteForeignKey]);

  const handleDeleteCancel = useCallback(() => {
    setDeleteGuard("idle");
  }, []);

  /** Delete click, per design.md §3. `getBalance` absent → today's exact plain
   *  confirm panel, unchanged. `getBalance` provided → "Checking balance…",
   *  then either that SAME plain panel (balance `0n`/read failure — a
   *  balance-read failure must never permanently block deleting a key) or the
   *  blocking, delete-less panel (balance `> 0n` — this row is ALWAYS the
   *  Unprotected tier: it has no seed to ever regenerate it from). */
  const handleDeleteClick = useCallback(() => {
    if (getBalance === undefined) {
      setDeleteGuard("confirm");
      return;
    }
    setDeleteGuard("checking");
    getBalance(address)
      .then((balance) => {
        if (balance > 0n) {
          setBlockedBalance(balance);
          setDeleteGuard("blocked");
        } else {
          setDeleteGuard("confirm");
        }
      })
      .catch(() => {
        setDeleteGuard("confirm");
      });
  }, [getBalance, address]);

  return (
    <div
      data-testid={`arweave-pure-key-row-${entry.id}`}
      style={{
        border: "1px solid #262626",
        borderRadius: 12,
        overflow: "hidden",
        backgroundColor: "#0a0a0a",
      }}
    >
      {/* Collapsed header — the ENTIRE strip is clickable (Chainweb
          `PureKeypairsTab`'s `KeypairRow` pattern): chevron + circular key
          avatar + label. No address, no action icons at this level.
          Round 26 owner correction: "The key entries need to have same
          height as the seed entries, slim..." — MOBILE ONLY fork,
          mirroring `PureKeypairsTab.tsx`'s own identical round-26 change:
          `6px` top/bottom padding (was 12px) and the 32×32 avatar circle
          replaced with a small 10×10 colour dot. Desktop keeps the
          original avatar + padding, unchanged. */}
      {isMobile ? (
        <div
          data-testid={`arweave-pure-key-toggle-${entry.id}`}
          onClick={() => setExpanded((v) => !v)}
          style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 16px", cursor: "pointer" }}
        >
          {expanded
            ? <ChevronDownGlyph style={{ width: 16, height: 16, flexShrink: 0, color: ACCENT }} />
            : <ChevronRightGlyph style={{ width: 16, height: 16, flexShrink: 0, color: "#555" }} />}
          <span
            title="Pure key"
            aria-hidden="true"
            style={{ flexShrink: 0, width: 10, height: 10, borderRadius: "50%", backgroundColor: ACCENT }}
          />
          <span
            style={{
              flex: 1, minWidth: 0, fontWeight: 600, fontSize: 14,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#d2d3d4",
            }}
          >
            {entry.label ?? "Untitled key"}
          </span>
        </div>
      ) : (
        <div
          data-testid={`arweave-pure-key-toggle-${entry.id}`}
          onClick={() => setExpanded((v) => !v)}
          style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", cursor: "pointer" }}
        >
          {expanded
            ? <ChevronDownGlyph style={{ width: 16, height: 16, flexShrink: 0, color: ACCENT }} />
            : <ChevronRightGlyph style={{ width: 16, height: 16, flexShrink: 0, color: "#555" }} />}
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 9999,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              backgroundColor: "#262626",
            }}
          >
            <KeyGlyph style={{ width: 18, height: 18, color: ACCENT }} />
          </div>
          <span
            style={{
              flex: 1,
              minWidth: 0,
              fontWeight: 600,
              fontSize: 14,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              color: "#d2d3d4",
            }}
          >
            {entry.label ?? "Untitled key"}
          </span>
        </div>
      )}

      {/* Expanded body — address, action icons, and every rename/export/
          delete-confirm panel + the RSA parameters section, all reachable
          only once the row is expanded.
          Round 27 owner correction: "clickign fathippo, opens it in
          place. i want it to be opened in new page, same as seed, this is
          only for arweave as it has more detail." Mirrors
          `ArweaveSeedsArea.tsx`'s own `SeedRow` round-21 change exactly:
          MOBILE ONLY, this whole body portals into a full-screen
          `CodexModalShell` instead of growing the row inline; DESKTOP
          keeps the exact original inline expand, byte-identical. Content
          itself (`expandedContent` below) is unchanged either way — only
          its WRAPPER differs. */}
      {expanded && (() => {
        const expandedContent = (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
        >
          {/* Round 28 owner correction: "lets make here the Account string
              be on a single line, shorted same as teh arweave addresses.
              and then the buttons below it, and then the detailmedalion
              beneath the square buttons." Was one horizontal row (address
              + RSA toggle + 4 icon buttons all crammed together, address
              WRAPPING across lines via `overflowWrap: anywhere`); now a
              vertical stack — address (single line, live-measured +
              truncated + first-3/last-3 highlighted, the SAME
              `ArweaveAddressHighlight` `ArweaveAccountsArea.tsx`'s own
              account rows already use), then the square action-icon
              buttons, then the RSA-parameters toggle ("detail medallion")
              on its own line beneath them. */}
          <ArweaveAddressHighlight address={address} baseColor="#888" style={{ fontFamily: MONO, fontSize: 12 }} />

          <span style={{ display: "inline-flex", gap: 6 }}>
            <button
              type="button"
              data-testid={`arweave-pure-key-copy-${entry.id}`}
              title={addressCopied ? "Copied" : "Copy address"}
              aria-label={addressCopied ? "Copied" : "Copy address"}
              onClick={handleCopyAddress}
              style={
                addressCopied
                  ? { ...iconButtonStyle, backgroundColor: "#0a2a14", color: "#4ade80", border: "1px solid rgba(74,222,128,0.4)" }
                  : iconButtonStyle
              }
            >
              {addressCopied ? <CheckGlyph style={{ width: 13, height: 13 }} /> : <CopyGlyph style={{ width: 13, height: 13 }} />}
            </button>
            <button
              type="button"
              data-testid={`arweave-pure-key-rename-${entry.id}`}
              title="Rename this key"
              aria-label="Rename this key"
              onClick={() => setRenameOpen((v) => !v)}
              style={iconButtonStyle}
            >
              <PencilGlyph style={{ width: 13, height: 13 }} />
            </button>
            <button
              type="button"
              data-testid={`arweave-pure-key-export-${entry.id}`}
              title="Export keyfile"
              aria-label="Export keyfile"
              onClick={() => setExportOpen((v) => !v)}
              style={iconButtonStyle}
            >
              <DownloadGlyph style={{ width: 13, height: 13 }} />
            </button>
            <button
              type="button"
              data-testid={`arweave-pure-key-delete-${entry.id}`}
              title="Delete this key"
              aria-label="Delete this key"
              onClick={handleDeleteClick}
              style={dangerIconButtonStyle}
            >
              <TrashGlyph style={{ width: 13, height: 13 }} />
            </button>
          </span>

          <RsaParamsToggle
            prefix="arweave-pure-key"
            index={entry.id}
            open={rsaParams.open}
            toggle={rsaParams.toggle}
          />

          <RsaParamsPanel prefix="arweave-pure-key" index={entry.id} {...rsaParams} />

          {renameOpen && (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                data-testid={`arweave-pure-key-rename-input-${entry.id}`}
                value={renameText}
                onChange={(e) => setRenameText(e.target.value)}
                style={{
                  flex: 1,
                  padding: "6px 8px",
                  borderRadius: 6,
                  border: "1px solid #262626",
                  backgroundColor: "#111",
                  color: "#d2d3d4",
                  fontSize: 12,
                }}
              />
              <button
                type="button"
                data-testid={`arweave-pure-key-rename-submit-${entry.id}`}
                onClick={() => void handleRenameSubmit()}
                style={{ ...iconButtonStyle, width: "auto", padding: "0 10px" }}
              >
                Save
              </button>
            </div>
          )}

          {exportOpen && (
            <div
              data-testid={`arweave-pure-key-export-panel-${entry.id}`}
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
              <span data-testid={`arweave-pure-key-export-warning-${entry.id}`} style={{ flex: 1, minWidth: 180 }}>
                Exporting reveals your private keyfile. Anyone with this file controls the wallet.
              </span>
              <button
                type="button"
                data-testid={`arweave-pure-key-export-confirm-${entry.id}`}
                onClick={() => void handleExportConfirm()}
                style={{ ...dangerIconButtonStyle, width: "auto", padding: "0 10px", fontSize: 12 }}
              >
                I understand — export
              </button>
              {locked && (
                <div
                  data-testid={`arweave-pure-key-locked-${entry.id}`}
                  style={{ width: "100%", color: "#fca5a5" }}
                >
                  Your codex is locked. Unlock it to export the keyfile.
                </div>
              )}
            </div>
          )}

          {deleteGuard === "checking" && (
            <div
              data-testid={`arweave-pure-key-delete-checking-${entry.id}`}
              style={{ fontSize: 12, color: "#888" }}
            >
              Checking balance…
            </div>
          )}

          {confirmingDelete && (
            <div
              data-testid={`arweave-pure-key-delete-confirm-panel-${entry.id}`}
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
                Delete this pure key? It cannot be regenerated — it has no seed.
              </span>
              <button
                type="button"
                data-testid={`arweave-pure-key-delete-confirm-${entry.id}`}
                onClick={() => void handleDeleteConfirm()}
                style={{ ...dangerIconButtonStyle, width: "auto", padding: "0 10px", fontSize: 12 }}
              >
                Delete
              </button>
              <button
                type="button"
                data-testid={`arweave-pure-key-delete-cancel-${entry.id}`}
                onClick={handleDeleteCancel}
                style={{ ...iconButtonStyle, width: "auto", padding: "0 10px", fontSize: 12 }}
              >
                Cancel
              </button>
            </div>
          )}

          {deleteGuard === "blocked" && blockedBalance !== null && (
            <div
              data-testid={`arweave-pure-key-delete-blocked-${entry.id}`}
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
                {`This key holds ${winstonToAr(blockedBalance)} AR and has no seed behind it — ` +
                  "it can never be regenerated. Deletion is disabled to prevent irreversible fund loss."}
              </span>
              <button
                type="button"
                data-testid={`arweave-pure-key-delete-dismiss-${entry.id}`}
                onClick={handleDeleteCancel}
                style={{ ...iconButtonStyle, width: "auto", padding: "0 10px", fontSize: 12 }}
              >
                Dismiss
              </button>
            </div>
          )}
          </div>
        );
        return isMobile ? (
          <MobilePortal target={fullScreenPortalTarget}>
            <CodexModalShell
              title={entry.label ?? "Untitled key"}
              onClose={() => setExpanded(false)}
              dialogTestId={`arweave-pure-key-expand-modal-${entry.id}`}
              closeTestId="arweave-pure-key-expand-close"
            >
              {expandedContent}
            </CodexModalShell>
          </MobilePortal>
        ) : (
          <div
            style={{
              padding: "10px 16px 12px",
              borderTop: "1px solid #262626",
            }}
          >
            {expandedContent}
          </div>
        );
      })()}
    </div>
  );
}

/**
 * The Generate subtab's own self-contained panel (design.md §5/§6) — extracted
 * as a genuinely separate child component so it MOUNTS only while
 * `subTab === "generate"` (conditional render, not `display:none`). React
 * discards `pendingKey`/`label`/etc. the instant the user navigates to
 * another pill, exactly like `PureKeypairsTab.tsx`'s `GenerateSubtab` gets
 * for free from `{sub === "generate" && <GenerateSubtab .../>}` — a
 * deliberate secret-hygiene win: no unsaved plaintext JWK survives in a
 * hidden/inert component.
 *
 * `onSaved` is called both on a successful Save AND on Cancel — from the
 * parent's point of view, "the user is done with this subtab" is the same
 * transition (`setSubTab("list")`) either way, exactly like Chainweb's
 * `onSaved()` prop.
 */
function GenerateSubtab({
  keygenRunner,
  generateArweaveKey,
  addForeignKey,
  onSaved,
}: {
  keygenRunner: KeygenRunner;
  generateArweaveKey: PureKeysAreaProps["generateArweaveKey"];
  addForeignKey: PureKeysAreaProps["addForeignKey"];
  onSaved: () => void;
}): React.ReactElement {
  // The Generate/Save panel's own state machine (design.md §5):
  //   `pendingKey`  — the freshly minted, NOT-YET-PERSISTED `{ jwk, address }`.
  //                   `null` until the first successful generate; overwritten
  //                   wholesale by every later "Generate Another" — free,
  //                   repeatable, no gate, no confirmation.
  //   `label`       — the in-progress label input; blank is allowed throughout.
  //   `creating`/`createError` — the `runKeygen` step (drives `RandomKeygenProgress`
  //                   and the reused `arweave-pure-key-create-error` copy).
  //   `saving`/`saveError`     — the Save step (`generateArweaveKey` + `addForeignKey`).
  const [pendingKey, setPendingKey] = useState<{ jwk: ArweaveJwk; address: string } | null>(null);
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);

  /** "Generate Random Key" (no `pendingKey` yet) / "Generate Another" (one
   *  already exists) — same handler, same button. Free and repeatable: a
   *  fresh key always wholesale-overwrites whatever `pendingKey` held before,
   *  with no gate or confirmation (design.md §5). */
  const handleGenerate = useCallback(async () => {
    if (creating) return; // non-re-entrant while pending
    setCreating(true);
    setCreateError(false);
    try {
      // The plaintext JWK lives only in `pendingKey` until Save — never
      // rendered, never logged, handed to the encrypt-at-rest seam exactly
      // once (module JSDoc).
      const jwk = await keygenRunner.runKeygen(() => {});
      const address = await addressOf(jwk);
      setPendingKey({ jwk, address });
    } catch {
      setCreateError(true);
    } finally {
      // Clear the pending state on a macrotask so the pending frame (progress
      // indicator + disabled button) stays committed and observable across a
      // fake runner's synchronous resolution instead of collapsing within the
      // same microtask flush. Preserved verbatim from `KeyringArea`.
      await new Promise((resolve) => setTimeout(resolve, 0));
      setCreating(false);
    }
  }, [creating, keygenRunner]);

  /** "Save to Codex" — encrypts + persists whatever `pendingKey` currently
   *  holds under the currently-typed label (or the distinct default label,
   *  design.md §2), then hands control back to the list via `onSaved`. On
   *  failure, `pendingKey`/`label` are preserved exactly as they were so Save
   *  can be retried without regenerating (design.md §5). */
  const handleSave = useCallback(async () => {
    if (pendingKey === null || saving) return;
    setSaving(true);
    setSaveError(false);
    try {
      const trimmed = label.trim();
      const finalLabel = trimmed.length > 0 ? trimmed : `Random Key ${last6(pendingKey.address)}`;
      const entry = await generateArweaveKey({ jwk: pendingKey.jwk, label: finalLabel });
      await addForeignKey(entry);
      onSaved();
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }, [pendingKey, saving, label, generateArweaveKey, addForeignKey, onSaved]);

  return (
    <div
      data-testid="arweave-pure-key-generate-panel"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: 14,
        borderRadius: 12,
        border: "1px solid #262626",
        backgroundColor: "#0a0a0a",
      }}
    >
      {pendingKey === null && (
        <p style={{ margin: 0, fontSize: 12, color: "#888", lineHeight: 1.5 }}>
          Generate a fresh, genuinely random RSA-4096 keypair. It has no seed behind it — if
          it's lost after saving, it cannot be regenerated. You can reroll freely before saving.
        </p>
      )}

      <button
        type="button"
        data-testid="arweave-pure-key-generate-start"
        onClick={() => void handleGenerate()}
        disabled={creating}
        style={{
          display: "inline-flex",
          alignSelf: "flex-start",
          alignItems: "center",
          gap: 8,
          padding: "8px 14px",
          borderRadius: 10,
          fontSize: 13,
          fontWeight: 600,
          cursor: creating ? "default" : "pointer",
          border: `1px solid ${ACCENT}`,
          backgroundColor: creating ? "transparent" : ACCENT,
          color: creating ? ACCENT : "#0a0a0a",
          opacity: creating ? 0.6 : 1,
        }}
      >
        <KeyGlyph style={{ width: 14, height: 14 }} />
        {pendingKey === null ? "Generate Random Key" : "Generate Another"}
      </button>

      {creating && <RandomKeygenProgress />}
      {createError && (
        <div
          data-testid="arweave-pure-key-create-error"
          role="alert"
          style={{ fontSize: 12, color: "#f87171" }}
        >
          Key generation failed. Please try again.
        </div>
      )}

      {pendingKey !== null && !creating && (
        <>
          <div
            style={{
              fontFamily: MONO,
              fontSize: 12,
              color: "#d2d3d4",
              overflowWrap: "anywhere",
            }}
          >
            {pendingKey.address}
          </div>

          <RsaParamsSection
            prefix="arweave-pure-key-generate"
            index={pendingKey.address}
            jwk={pendingKey.jwk}
          />

          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <input
              type="text"
              data-testid="arweave-pure-key-generate-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Cold Arweave key…"
              style={{
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid #262626",
                backgroundColor: "#111",
                color: "#d2d3d4",
                fontSize: 12,
              }}
            />
          </div>

          <button
            type="button"
            data-testid="arweave-pure-key-generate-save"
            onClick={() => void handleSave()}
            disabled={saving}
            style={{
              display: "inline-flex",
              alignSelf: "flex-start",
              alignItems: "center",
              gap: 8,
              padding: "8px 14px",
              borderRadius: 10,
              fontSize: 13,
              fontWeight: 700,
              border: "none",
              cursor: saving ? "not-allowed" : "pointer",
              backgroundColor: saving ? "#262626" : ACCENT,
              color: saving ? "#555" : "#0a0a0a",
            }}
          >
            {saving ? "Saving…" : "Save to Codex"}
          </button>
          {saveError && (
            <div
              data-testid="arweave-pure-key-generate-save-error"
              role="alert"
              style={{ fontSize: 12, color: "#f87171" }}
            >
              Could not save this key. Please try again.
            </div>
          )}
        </>
      )}

      <button
        type="button"
        data-testid="arweave-pure-key-generate-cancel"
        onClick={onSaved}
        style={{
          display: "inline-flex",
          alignSelf: "flex-start",
          alignItems: "center",
          gap: 8,
          padding: "8px 14px",
          borderRadius: 10,
          fontSize: 13,
          fontWeight: 600,
          cursor: "pointer",
          border: "1px solid #262626",
          backgroundColor: "#111",
          color: "#888",
        }}
      >
        Cancel
      </button>
    </div>
  );
}

/**
 * The PEM-import method (Part B), additive to the JSON-keyfile import above:
 * two `.pem` files — a private key and its matching public key — live-
 * validated against each other before anything can be saved. Mirrors
 * `PureKeypairsTab.tsx`'s `ImportSubtab` WORKFLOW SHAPE (two required inputs,
 * live cross-validation via `useMemo`, blocked Save until "ok") but NOT its
 * paste-into-a-text-input MECHANISM: an Arweave PEM is exactly the class of
 * large secret blob this file's JSON-keyfile import already chose file-upload
 * over paste for (module JSDoc) — so both PEM halves arrive the same way.
 *
 * A genuinely separate child component, mounted only while its own subtab is
 * active, for the same secret-hygiene reason `GenerateSubtab` is: its own
 * pending, not-yet-saved `privateFragment` (carrying `d`/`p`/`q`/`dp`/`dq`/
 * `qi`) is discarded the instant the user navigates away, unmounted rather
 * than lingering. The raw PEM text itself never reaches state at all — each
 * file handler reads it, parses it into a JWK fragment, and lets the string
 * itself fall out of scope (module JSDoc's "plaintext JWK never persists"
 * discipline, extended here to "raw PEM text never persists either").
 */
function PemImportSubsection({
  importArweaveKey,
  addForeignKey,
  onSaved,
}: {
  importArweaveKey: PureKeysAreaProps["importArweaveKey"];
  addForeignKey: PureKeysAreaProps["addForeignKey"];
  onSaved: () => void;
}): React.ReactElement {
  const privateInputRef = useRef<HTMLInputElement>(null);
  const publicInputRef = useRef<HTMLInputElement>(null);

  const [privateFragment, setPrivateFragment] = useState<PrivatePemFragment | null>(null);
  const [privateError, setPrivateError] = useState<string | null>(null);
  const [publicFragment, setPublicFragment] = useState<PublicPemFragment | null>(null);
  const [publicError, setPublicError] = useState<string | null>(null);

  const [label, setLabel] = useState("");
  const [previewAddress, setPreviewAddress] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);

  /** Reads and parses ONE selected file, per-file: a bad private PEM must
   *  never disturb whatever the public half already holds, and vice versa
   *  (independent re-choosable inputs, ask 7). */
  const handlePrivateFile = useCallback(async (file: File): Promise<void> => {
    setPrivateError(null);
    setPrivateFragment(null);
    let text: string;
    try {
      text = await file.text();
    } catch {
      setPrivateError("Could not read that file.");
      return;
    }
    try {
      setPrivateFragment(await parsePrivatePem(text));
    } catch (cause) {
      setPrivateError(
        cause instanceof Error ? cause.message : "That file is not a valid private-key PEM.",
      );
    }
  }, []);

  const handlePublicFile = useCallback(async (file: File): Promise<void> => {
    setPublicError(null);
    setPublicFragment(null);
    let text: string;
    try {
      text = await file.text();
    } catch {
      setPublicError("Could not read that file.");
      return;
    }
    try {
      setPublicFragment(await parsePublicPem(text));
    } catch (cause) {
      setPublicError(
        cause instanceof Error ? cause.message : "That file is not a valid public-key PEM.",
      );
    }
  }, []);

  const handlePrivateInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = ""; // allow re-choosing the same filename later
      if (file) void handlePrivateFile(file);
    },
    [handlePrivateFile],
  );

  const handlePublicInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (file) void handlePublicFile(file);
    },
    [handlePublicFile],
  );

  /** Live cross-validation (Chainweb `ImportSubtab`'s WORKFLOW shape, ported
   *  to two files instead of two pasted hex strings): idle until BOTH halves
   *  are parsed, "ok" only when the private half's own `n`/`e` byte-for-byte
   *  match the public half's, "err" otherwise. */
  const validation = useMemo<{ state: "idle" | "ok" | "err"; msg: string }>(() => {
    if (privateFragment === null || publicFragment === null) {
      return { state: "idle", msg: "Choose both a private-key and a matching public-key PEM." };
    }
    if (privateFragment.n === publicFragment.n && privateFragment.e === publicFragment.e) {
      return { state: "ok", msg: "Keys match — the public key belongs to this private key." };
    }
    return { state: "err", msg: "Mismatch — this private key and public key are not a pair." };
  }, [privateFragment, publicFragment]);

  /** The live preview address — "generated on the spot", via the SAME
   *  `addressOf` the random-generate flow already derives its own preview
   *  address from (module JSDoc / `GenerateSubtab.handleGenerate`). Recomputes
   *  whenever a fresh matching pair replaces the old one (ask 7's free reroll). */
  useEffect(() => {
    if (validation.state !== "ok" || privateFragment === null) {
      setPreviewAddress(null);
      setPreviewError(null);
      return;
    }
    let cancelled = false;
    void addressOf({ kty: "RSA", ...privateFragment } as ArweaveJwk)
      .then((addr) => {
        if (!cancelled) setPreviewAddress(addr);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setPreviewError(
            cause instanceof Error ? cause.message : "Could not derive this key's address.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [validation.state, privateFragment]);

  const canSave = validation.state === "ok" && previewAddress !== null;

  const handleSave = useCallback(async (): Promise<void> => {
    if (!canSave || privateFragment === null || previewAddress === null || saving) return;
    setSaving(true);
    setSaveError(false);
    try {
      const assembled: ArweaveJwk = { kty: "RSA", ...privateFragment };
      const trimmed = label.trim();
      const entry = await importArweaveKey(assembled, trimmed !== "" ? { label: trimmed } : undefined);
      // Same distinct-default-label rule as the JSON-keyfile import path
      // (design.md §2), reused here.
      await addForeignKey(
        entry.label ? entry : { ...entry, label: `Imported Key ${last6(entry.address ?? entry.id)}` },
      );
      // Success closes back to the list — nothing lingers: every local
      // PEM-derived field is cleared, not just hidden.
      setPrivateFragment(null);
      setPrivateError(null);
      setPublicFragment(null);
      setPublicError(null);
      setLabel("");
      setPreviewAddress(null);
      setPreviewError(null);
      onSaved();
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }, [canSave, privateFragment, previewAddress, saving, label, importArweaveKey, addForeignKey, onSaved]);

  const statusColor =
    validation.state === "ok" ? "#4ade80" : validation.state === "err" ? "#f87171" : "#888";

  return (
    <div
      data-testid="arweave-pure-key-import-pem-panel"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: 14,
        borderRadius: 12,
        border: "1px solid #262626",
        backgroundColor: "#0a0a0a",
      }}
    >
      <p style={{ margin: 0, fontSize: 12, color: "#888", lineHeight: 1.5 }}>
        Already have a classical PEM key pair? Choose both files — they are validated against each
        other before anything is stored.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          <button
            type="button"
            data-testid="arweave-pure-key-import-pem-private-open"
            onClick={() => privateInputRef.current?.click()}
            style={pemChooseButtonStyle}
          >
            Import Private Key (.pem)
          </button>
          {privateFragment !== null && (
            <button
              type="button"
              data-testid="arweave-pure-key-import-pem-private-clear"
              onClick={() => {
                setPrivateFragment(null);
                setPrivateError(null);
              }}
              style={pemClearButtonStyle}
            >
              Clear
            </button>
          )}
        </div>
        <input
          ref={privateInputRef}
          type="file"
          accept=".pem,application/x-pem-file"
          data-testid="arweave-pure-key-import-pem-private-input"
          onChange={handlePrivateInputChange}
          style={{ display: "none" }}
        />
        {privateError !== null && (
          <div
            data-testid="arweave-pure-key-import-pem-private-error"
            role="alert"
            style={{ fontSize: 12, color: "#f87171" }}
          >
            {privateError}
          </div>
        )}
        {/* Per-file feedback the instant a half is parsed — not gated on the
         *  OTHER half also being present. The private half's `d`/`p`/`q`/etc.
         *  are never shown here, only its public-safe `n`/`e` (the same two
         *  fields the public PEM itself carries) — enough to confirm SOMETHING
         *  loaded without printing private material on screen. */}
        {privateFragment !== null && (
          <div
            data-testid="arweave-pure-key-import-pem-private-loaded"
            style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#4ade80" }}
          >
            <CheckGlyph style={{ width: 14, height: 14 }} />
            <span>
              Private key loaded — n: {truncatePemField(privateFragment.n)}, e: {privateFragment.e}
            </span>
          </div>
        )}

        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          <button
            type="button"
            data-testid="arweave-pure-key-import-pem-public-open"
            onClick={() => publicInputRef.current?.click()}
            style={pemChooseButtonStyle}
          >
            Import Public Key (.pem)
          </button>
          {publicFragment !== null && (
            <button
              type="button"
              data-testid="arweave-pure-key-import-pem-public-clear"
              onClick={() => {
                setPublicFragment(null);
                setPublicError(null);
              }}
              style={pemClearButtonStyle}
            >
              Clear
            </button>
          )}
        </div>
        <input
          ref={publicInputRef}
          type="file"
          accept=".pem,application/x-pem-file"
          data-testid="arweave-pure-key-import-pem-public-input"
          onChange={handlePublicInputChange}
          style={{ display: "none" }}
        />
        {publicError !== null && (
          <div
            data-testid="arweave-pure-key-import-pem-public-error"
            role="alert"
            style={{ fontSize: 12, color: "#f87171" }}
          >
            {publicError}
          </div>
        )}
        {publicFragment !== null && (
          <div
            data-testid="arweave-pure-key-import-pem-public-loaded"
            style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#4ade80" }}
          >
            <CheckGlyph style={{ width: 14, height: 14 }} />
            <span>
              Public key loaded — n: {truncatePemField(publicFragment.n)}, e: {publicFragment.e}
            </span>
          </div>
        )}
      </div>

      {(privateFragment !== null || publicFragment !== null) && (
        <div
          data-testid="arweave-pure-key-import-pem-status"
          data-state={validation.state}
          style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: statusColor }}
        >
          {validation.state === "ok" ? (
            <CheckGlyph style={{ width: 14, height: 14 }} />
          ) : (
            <WarningGlyph style={{ width: 14, height: 14 }} />
          )}
          {validation.msg}
        </div>
      )}

      {previewError !== null && (
        <div
          data-testid="arweave-pure-key-import-pem-preview-error"
          role="alert"
          style={{ fontSize: 12, color: "#f87171" }}
        >
          {previewError}
        </div>
      )}

      {previewAddress !== null && (
        <div
          data-testid="arweave-pure-key-import-pem-preview-address"
          style={{ fontFamily: MONO, fontSize: 12, color: "#d2d3d4", overflowWrap: "anywhere" }}
        >
          {previewAddress}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <input
          type="text"
          data-testid="arweave-pure-key-import-pem-label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. Imported cold key…"
          style={{
            padding: "8px 10px",
            borderRadius: 8,
            border: "1px solid #262626",
            backgroundColor: "#111",
            color: "#d2d3d4",
            fontSize: 12,
          }}
        />
      </div>

      <button
        type="button"
        data-testid="arweave-pure-key-import-pem-save"
        onClick={() => void handleSave()}
        disabled={!canSave || saving}
        style={{
          display: "inline-flex",
          alignSelf: "flex-start",
          alignItems: "center",
          gap: 8,
          padding: "8px 14px",
          borderRadius: 10,
          fontSize: 13,
          fontWeight: 700,
          border: "none",
          cursor: !canSave || saving ? "not-allowed" : "pointer",
          backgroundColor: canSave && !saving ? ACCENT : "#262626",
          color: canSave && !saving ? "#0a0a0a" : "#555",
        }}
      >
        {saving ? "Saving…" : "Save to Codex"}
      </button>
      {saveError && (
        <div
          data-testid="arweave-pure-key-import-pem-save-error"
          role="alert"
          style={{ fontSize: 12, color: "#f87171" }}
        >
          Could not save this key. Please try again.
        </div>
      )}
    </div>
  );
}

/** The persistent subtab strip (design.md §6) — matches
 *  `ArweaveAccountsArea.tsx`'s `arweave-accounts-subtab-${key}` pills exactly
 *  (same active/inactive border/background/color logic), just renamed to this
 *  area's own `arweave-pure-keys-subtab-${key}` namespace. */
type PureKeysSubTab = "list" | "generate" | "import";

export function PureKeysArea(props: PureKeysAreaProps): React.ReactElement {
  const {
    foreignKeys,
    keygenRunner,
    generateArweaveKey,
    importArweaveKey,
    decryptArweaveKey,
    addForeignKey,
    renameForeignKey,
    deleteForeignKey,
    getBalance,
    onPaginationHandleChange,
    fullScreenPortalTarget,
  } = props;
  const isMobile = useIsMobile();

  // Seedless only — a key WITH a `seedId` is Seeds'/Accounts' territory (module JSDoc).
  const entries = useMemo(
    () => foreignKeys.filter((e) => e.seedId === undefined),
    [foreignKeys],
  );

  // MOBILE ONLY — round 9/10 owner correction: "we need pagination on the
  // pure keys as well, which should kick in once enough entries exist, of
  // course." Mirrors Chainweb `PureKeypairsTab.tsx`'s own identical
  // pagination shape, including the "report externally once a caller opts
  // in, otherwise render inline" fallback rule.
  const { containerRef: keysPageContainerRef, rowRef: keysPageRowRef, pageSize: mobileKeysPageSize } = useMobileKeypairPageSize();
  const [page, setPage] = useState(0);
  const mobilePages = useMemo(() => {
    if (entries.length === 0) return [[]] as ForeignKeyEntry[][];
    const out: ForeignKeyEntry[][] = [];
    for (let i = 0; i < entries.length; i += mobileKeysPageSize) out.push(entries.slice(i, i + mobileKeysPageSize));
    return out;
  }, [entries, mobileKeysPageSize]);
  const totalPages = isMobile ? mobilePages.length : 1;
  const clampedPage = Math.min(page, totalPages - 1);
  const pageEntries = isMobile ? (mobilePages[clampedPage] ?? []) : entries;

  const reportsPaginationExternally = !!onPaginationHandleChange;
  useEffect(() => {
    if (!reportsPaginationExternally) return;
    if (totalPages <= 1) {
      onPaginationHandleChange?.(null);
      return;
    }
    onPaginationHandleChange?.({
      page: clampedPage,
      totalPages,
      onPrev: () => setPage((p) => Math.max(0, p - 1)),
      onNext: () => setPage((p) => Math.min(totalPages - 1, p + 1)),
      onJump: (p) => setPage(p),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportsPaginationExternally, totalPages, clampedPage, onPaginationHandleChange]);

  const [subTab, setSubTab] = useState<PureKeysSubTab>("list");
  const goToList = useCallback(() => setSubTab("list"), []);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importInvalidJson, setImportInvalidJson] = useState(false);
  const [importRejectMessage, setImportRejectMessage] = useState<string | null>(null);

  const handleImportFile = useCallback(
    async (file: File) => {
      setImportInvalidJson(false);
      setImportRejectMessage(null);
      let parsed: unknown;
      try {
        const text = await file.text();
        parsed = JSON.parse(text);
      } catch {
        // The file is never kept — no secret keyfile material lingers.
        setImportInvalidJson(true);
        return;
      }
      try {
        const entry = await importArweaveKey(parsed);
        // Same distinct-default-label rule as random-generate (design.md §2).
        await addForeignKey(
          entry.label ? entry : { ...entry, label: `Imported Key ${last6(entry.address ?? entry.id)}` },
        );
      } catch (err) {
        setImportRejectMessage(err instanceof Error ? err.message : String(err));
      }
    },
    [importArweaveKey, addForeignKey],
  );

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = ""; // allow re-importing the same filename later
      if (file) void handleImportFile(file);
    },
    [handleImportFile],
  );

  const TABS: { key: PureKeysSubTab; label: string; Icon: (p: { style?: React.CSSProperties }) => React.ReactElement }[] = [
    { key: "list", label: `Keys (${entries.length})`, Icon: KeyGlyph },
    { key: "generate", label: "Generate", Icon: SparkleGlyph },
    { key: "import", label: "Import", Icon: DownloadGlyph },
  ];

  return (
    <div
      data-testid="arweave-pure-keys-area"
      style={{
        display: "flex", flexDirection: "column", gap: 16, color: "#d2d3d4",
        // MOBILE ONLY — bounds this component to whatever height its host
        // gives it, so `useMobileKeypairPageSize` measures a real available
        // height instead of the list just growing with its own content.
        height: isMobile ? "100%" : undefined,
        minHeight: isMobile ? 0 : undefined,
      }}
    >
      {/* Round 26 owner correction: "the 3 buttons from pure keys are a
          bit to big, making the view get a horisontal scroll... we should
          move to icons instead of thsse buttons. Then the buttons need to
          stay put, scrolling shouldnt move them." Reverses round 19's
          "keep the labels, just equalize width" call — ported here from
          `PureKeypairsTab.tsx`'s identical round-26 reversal. Icon-only,
          small fixed squares (mobile only; desktop keeps its original
          left-aligned, wrapping, labeled row); `position: sticky` pins the
          row to the top of `ArweavePanel`'s own scrolling ancestor. */}
      <div
        role="tablist"
        aria-label="Pure Keys categories"
        style={{
          display: "flex", flexWrap: isMobile ? "nowrap" : "wrap", justifyContent: isMobile ? "center" : "flex-start", gap: 8,
          position: isMobile ? "sticky" : undefined,
          top: isMobile ? 0 : undefined,
          zIndex: isMobile ? 5 : undefined,
          backgroundColor: isMobile ? "#0a0a0a" : undefined,
          paddingTop: isMobile ? 4 : undefined,
          paddingBottom: isMobile ? 4 : undefined,
        }}
      >
        {TABS.map(({ key, label, Icon }) => {
          const active = subTab === key;
          const badgeCount = key === "list" ? entries.length : 0;
          return (
            <button
              key={key}
              type="button"
              data-testid={`arweave-pure-keys-subtab-${key}`}
              aria-pressed={active}
              aria-label={label}
              title={label}
              onClick={() => setSubTab(key)}
              style={
                isMobile
                  ? {
                      position: "relative",
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      width: 44, height: 36, borderRadius: 8, cursor: "pointer",
                      border: `1px solid ${active ? ACCENT : "#262626"}`,
                      backgroundColor: active ? ACCENT : "#111",
                      color: active ? "#0a0a0a" : "#888",
                    }
                  : {
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                      padding: "8px 14px",
                      borderRadius: 10,
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: "pointer",
                      border: `1px solid ${active ? ACCENT : "#262626"}`,
                      backgroundColor: active ? ACCENT : "#111",
                      color: active ? "#0a0a0a" : "#888",
                    }
              }
            >
              {isMobile ? (
                <>
                  <Icon style={{ width: 16, height: 16 }} />
                  {badgeCount > 0 && (
                    <span
                      style={{
                        position: "absolute", top: -5, right: -5, minWidth: 15, height: 15, padding: "0 3px",
                        borderRadius: 9999, fontSize: 9, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center",
                        backgroundColor: ACCENT, color: "#0a0a0a", border: "1px solid #0a0a0a",
                      }}
                    >
                      {badgeCount}
                    </span>
                  )}
                </>
              ) : (
                label
              )}
            </button>
          );
        })}
      </div>

      {subTab === "list" &&
        (entries.length === 0 ? (
          <div
            data-testid="arweave-pure-keys-empty"
            style={{
              padding: "24px",
              borderRadius: 12,
              border: "1px dashed #262626",
              color: "#666",
              fontSize: 13,
            }}
          >
            No pure keys yet. Generate one at random, or import an existing Arweave keyfile.
          </div>
        ) : isMobile ? (
          <>
            {/* MOBILE ONLY — the measured, paginated entry area (round
                9/10 owner correction: "we need pagination on the pure
                keys as well, which should kick in once enough entries
                exist"). Deliberately NO `overflow: hidden` — a
                `PureKeyRow` expands INLINE (accordion), so a page's total
                height can legitimately grow past the measured bound while
                a row is open; forcing a hard clip there would risk
                silently cutting the very content the user just opened.
                Mirrors Chainweb `PureKeypairsTab.tsx`'s identical
                tradeoff. */}
            <div ref={keysPageContainerRef} style={{ display: "flex", flexDirection: "column", gap: KEYPAIR_ROW_GAP, padding: KEYPAIR_ROW_GAP, flex: 1, minHeight: 0 }}>
              {(() => {
                let measured = false;
                return pageEntries.map((entry) => {
                  const shouldMeasure = !measured;
                  if (shouldMeasure) measured = true;
                  return (
                    <div key={entry.id} ref={shouldMeasure ? keysPageRowRef : undefined}>
                      <PureKeyRow
                        entry={entry}
                        decryptArweaveKey={decryptArweaveKey}
                        renameForeignKey={renameForeignKey}
                        deleteForeignKey={deleteForeignKey}
                        getBalance={getBalance}
                        fullScreenPortalTarget={fullScreenPortalTarget}
                      />
                    </div>
                  );
                });
              })()}
            </div>
            {/* Prev/Next — rendered INLINE only when no caller opted into
                `onPaginationHandleChange` (round 9's "standard pagination
                controls zone" — `ArweavePanel` renders the shared
                medallion version otherwise). */}
            {!reportsPaginationExternally && totalPages > 1 && (
              <div style={{ flex: "none", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 8 }}>
                <button type="button" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={clampedPage === 0} style={pageBtn(clampedPage === 0)}>
                  ← Prev
                </button>
                <PageJumpIndicator page={clampedPage} totalPages={totalPages} onJump={setPage} />
                <button type="button" onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={clampedPage >= totalPages - 1} style={pageBtn(clampedPage >= totalPages - 1)}>
                  Next →
                </button>
              </div>
            )}
          </>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {entries.map((entry) => (
              <PureKeyRow
                key={entry.id}
                entry={entry}
                decryptArweaveKey={decryptArweaveKey}
                renameForeignKey={renameForeignKey}
                deleteForeignKey={deleteForeignKey}
                getBalance={getBalance}
                fullScreenPortalTarget={fullScreenPortalTarget}
              />
            ))}
          </div>
        ))}

      {subTab === "generate" && (
        <GenerateSubtab
          keygenRunner={keygenRunner}
          generateArweaveKey={generateArweaveKey}
          addForeignKey={addForeignKey}
          onSaved={goToList}
        />
      )}

      {subTab === "import" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <button
            type="button"
            data-testid="arweave-pure-key-import-open"
            onClick={() => fileInputRef.current?.click()}
            style={{
              display: "inline-flex",
              alignSelf: "flex-start",
              alignItems: "center",
              gap: 8,
              padding: "8px 14px",
              borderRadius: 10,
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              border: "1px solid #262626",
              backgroundColor: "#111",
              color: "#888",
            }}
          >
            Choose Keyfile
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            data-testid="arweave-pure-key-import-input"
            onChange={handleFileInputChange}
            style={{ display: "none" }}
          />

          {importInvalidJson && (
            <div
              data-testid="arweave-pure-key-import-invalid-json"
              role="alert"
              style={{ fontSize: 12, color: "#f87171" }}
            >
              That file is not valid JSON. Check the file and try again.
            </div>
          )}
          {importRejectMessage !== null && (
            <div
              data-testid="arweave-pure-key-import-rejected"
              role="alert"
              style={{ fontSize: 12, color: "#f87171" }}
            >
              {importRejectMessage}
            </div>
          )}

          <div style={{ fontSize: 11, color: "#666", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Or import a classical PEM key pair
          </div>
          <PemImportSubsection
            importArweaveKey={importArweaveKey}
            addForeignKey={addForeignKey}
            onSaved={goToList}
          />
        </div>
      )}
    </div>
  );
}

export default PureKeysArea;
