// The LIBRARY area of the Arweave panel (E-10).
//
// Presentation over E3's Library seam: lists the owner's entries NEWEST-FIRST
// (distinguishable pending/final badges); opens each via a HEALTHY gateway
// (the injected `openUrl(id, { pool })` composes the URL from the pool's healthy
// endpoint — never a hardcoded arweave.net); renders a manifest entry as a SINGLE
// link; and offers rebuild-from-chain, which re-reads the list after the injected
// `rebuildLibrary` reconciles the store.
//
// Holds ONLY public on-chain metadata (N-07) — no key material ever reaches here.
//
// `arweave-upload-encryption` (T6) — decrypt-on-download. Every entry gets a
// "Download" action alongside the existing "Open" link (additive — Open is
// unchanged). For a public entry (no `Codex-Encrypted` tag, or `"false"`) the
// download is just the bytes served at the SAME `openUrl` URL the Open link
// already uses, handed to the user via a Blob/`<a download>` click — no
// behavior change to what Open already does, only a second, explicit
// affordance. For an encrypted entry (`Codex-Encrypted: "true"`): the raw
// ciphertext is fetched from that SAME URL (reusing `openUrl` + an injectable
// `fetchFn`, mirroring `PollStatusOptions.fetchFn`/`RebuildLibraryOptions.
// fetchFn` — no new HTTP client invented here), the `Codex-Encryptor` tag
// names the encrypting account's address, and that address is resolved back
// to an `accountId` via `ouronetAccounts` (the SAME seam `ArweavePanelDeps`
// already exposes and `ArweaveSeedsArea` already consumes for its own Option
// 2 bitstring re-derivation) — the ONLY mapping this area has from an
// on-chain address back to a revealable account. No match, no
// `revealAccountSecret`, or a `null` reveal all surface the SAME specific
// `CANNOT_DECRYPT_ENCRYPTOR_MESSAGE` — a decrypt is never attempted with a
// wrong/guessed key. A genuine match derives the AES key via T3's
// `deriveAccountAesKey`/`decryptWithDerivedKey` (`fileEncryption.ts` — NOT
// `accountKeyCipher.ts`, which is for single short strings, not file
// content), strips the leading `IV_BYTE_LENGTH` bytes of the fetched bytes as
// the IV (the upload side prepends it — the project's documented convention),
// and base64-decodes the decrypted result back to the original raw bytes
// (files are base64-encoded before encryption on the upload side).
//
// Owner-reported redesign (post-first-real-upload UX pass): the flat list used
// to render every entry as a single row with THREE adjacent, unstyled inline
// spans (id/status/manifest-badge) and zero visual separation between them —
// readable as a single crushed-together string (e.g. "...Tn0final" or
// "...finalmanifest"). This also flattened a bundle upload (a manifest + its N
// files, all sharing one `Codex-Upload-Id`) into N+1 PEER rows with no
// indication they were one upload action.
//
// The redesign, in the owner's own words: "The library should show items by
// category... with their names, and for each entry, a string beneath in a
// string box with a copy button, that would clearly be the link that I would
// need to add into the NFT... one per manifest, one per subentry." Concretely:
//   1. Entries are grouped into CATEGORY SECTIONS (`Codex-Category`, the same
//      tag `CodexBackupHistoryArea.tsx`'s own `filterCodexBackups` already
//      reads) — only categories with at least one entry render a section.
//   2. A bundle (a manifest + its files sharing one `Codex-Upload-Id`) renders
//      as ONE group: a small de-emphasized header (the manifest's own id,
//      when known) followed by one row PER FILE, named from its `Codex-Path`
//      tag (the SAME fallback `downloadEntry` already uses: `Codex-Path` tag,
//      then `itemId`) — never a bare cryptic id as the primary label. The
//      manifest is context/container, not a third peer row with its own
//      Open/Download controls.
//   3. Every row's real access link (`openHrefFor`, unchanged) renders in a
//      styled, selectable text box with an adjacent Copy button
//      (`navigator.clipboard.writeText`, with a visible fallback on failure —
//      never a silent no-op).
//   4. The combined, paginated (10 per page) list of top-level render units
//      (a bundle group or an ungrouped entry each count as ONE unit) — a
//      simple "Page X of Y" + Prev/Next control, gold-pill styled, shown only
//      when there is more than one page.
//   5. Status/manifest badges are separated, styled pills (a colored dot +
//      label, mirroring `ArweaveRestoreEligibilityStatus.tsx`'s own
//      dot+pill convention) rather than bare adjacent spans.
//
// Follow-up redesign (`arweave-upload-library`, owner's own words, direct
// quote): "lets make two Tabs here, General Data and Codex... one entry has
// two lines, the name of the File, and below is a field with the
// address/link of the item, and at the end, 3 buttons, square, with icons,
// Open, Download, Copy... the display... has to be paginated, and each
// entry has to use as little as possible in height so that we may display
// lots per page. Imagine i upload a folder with 15000 photos... categories
// must be collapsable." `ArweavePanel.tsx` owns the new "General Data" /
// "Codex" tab split (this component is unaware of it — it is simply mounted
// ONLY on the "General Data" tab now); what THIS file owns:
//   1. An entry tagged `Codex-Category: codex-backup` is EXCLUDED here —
//      that's the "Codex" tab's own `CodexBackupHistoryArea`'s job, and
//      showing the same upload on both tabs would read as two different
//      things.
//   2. Each row is exactly TWO lines: line 1 is the filename + status/
//      manifest pills; line 2 is the copyable link field + 3 SQUARE,
//      icon-only buttons (Open/Download/Copy, via `lucide-react` — already a
//      declared peer dependency of this package) — not the old 3-sub-row
//      layout (header row, then a separate link-box row, then a separate
//      text-button actions row). Every button keeps a `title`/`aria-label`
//      naming the action (there is no visible text label to fall back on).
//   3. `LIBRARY_PAGE_SIZE` is bumped 10 → 25: the 2-line row is roughly half
//      the vertical space of the old 3-sub-row layout, so twice as many
//      units fit on a page without feeling any less scannable — exactly the
//      density tradeoff the owner's own "15000 photos" scenario asks for.
//   4. Each category section header gets its own collapse/expand toggle
//      (`ChevronDown`/`ChevronRight`, same icon source as the row actions),
//      defaulting to EXPANDED — local `useState` is enough; nothing here
//      needs to survive a remount. Collapsing hides a category's rows from
//      the page WITHOUT changing pagination math (a collapsed category's
//      units still occupy their page slots) — collapsing is a display
//      choice, not a re-filter.

import * as React from "react";
import { useCallback, useEffect, useState } from "react";
import { Check, ChevronDown, ChevronRight, Copy as CopyGlyph, Download as DownloadGlyph, ExternalLink } from "lucide-react";

import {
  TAG_CODEX_CATEGORY,
  UPLOAD_CATEGORIES,
  type GatewayPool,
  type Tag,
  type UploadCategory,
} from "@ancientpantheon/arweave-core";
import { bitStringOf } from "@ancientpantheon/codex-ouronet/codex-identity";

import type { LibraryEntry, LibraryStatus } from "../library/types.js";
import { deriveAccountAesKey, decryptWithDerivedKey } from "../crypto/fileEncryption.js";
import type { ArweaveSeedAccountSource } from "./ArweaveSeedsArea.js";

/**
 * `Codex-Encrypted`/`Codex-Encryptor` — T2 (`arweave-upload-encryption`)
 * added these to `arweave-core`'s `upload/tags.ts`, but its public
 * `index.ts` barrel has not (yet) re-exported the two constants alongside
 * `TAG_CODEX_CATEGORY` etc. Duplicated here as literal tag names rather than
 * imported, mirroring `library/flow.ts`'s own identical duplication of
 * `TAG_CODEX_PATH` for the same reason (a private/unexported upstream
 * constant this module only ever READS, never posts).
 */
const TAG_CODEX_ENCRYPTED = "Codex-Encrypted";
const TAG_CODEX_ENCRYPTOR = "Codex-Encryptor";

/** The app-metadata tag carrying a bundled file item's relative path — the
 *  closest thing to an "original filename" this tag schema carries today.
 *  Same literal `library/flow.ts` already duplicates from arweave-core's
 *  private `bundle.ts` constant of the same name. Absent on a single-file
 *  (non-bundle) upload, which falls back to the entry's own `itemId`. */
const TAG_CODEX_PATH = "Codex-Path";

/** AES-GCM IV length in bytes — `fileEncryption.ts`'s own `IV_BYTE_LENGTH`
 *  (private, not exported). The upload composition layer prepends exactly
 *  this many bytes of IV before the ciphertext it posts (the project's
 *  documented "prepend the IV" convention), so this download path strips the
 *  same fixed length off the front before calling `decryptWithDerivedKey`. */
const IV_BYTE_LENGTH = 12;

/** The ONE specific message surfaced for every "can't decrypt" case — never a
 *  generic failure, and never an attempted decrypt with a wrong/guessed key:
 *  `revealAccountSecret` absent, no `ouronetAccounts` entry whose address
 *  matches the entry's `Codex-Encryptor` tag, or a `null`/empty reveal. */
export const CANNOT_DECRYPT_ENCRYPTOR_MESSAGE =
  "This codex doesn't hold the account that encrypted this upload.";

/** The gold accent this package's own established visual language uses
 *  (`ArweaveAccountsArea.tsx`/`PureKeysArea.tsx`/`UploadWizard.tsx`'s own
 *  `ACCENT`) — this module's own local copy, following the same per-file
 *  convention every other panel area already uses (no shared/exported style
 *  helper exists across these components yet). */
const ACCENT = "#ceac5f";

/** This package's own per-file monospace stack convention
 *  (`PureKeysArea.tsx`'s own `MONO`) — used for the copyable link box so a
 *  long id/URL stays legible and unambiguous. */
const MONO = "var(--codex-font-mono, 'JetBrains Mono', ui-monospace, monospace)";

/** The outlined ("secondary") action button chrome — mirrors
 *  `UploadWizard.tsx`'s own `secondaryButtonStyle()` exactly (same palette),
 *  applied here to "Rebuild from chain"/"Download"/"Open"/"Copy"/pagination so
 *  nothing renders as bare, unstyled browser-chrome (the owner's own
 *  repeatedly-stated rejection of plain buttons anywhere in this app). */
const secondaryButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  padding: "8px 16px",
  borderRadius: 10,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  border: `1px solid ${ACCENT}40`,
  backgroundColor: "#111",
  color: ACCENT,
  textDecoration: "none",
};

export interface LibraryAreaProps {
  /**
   * EVERY owner address this chain's panel currently holds a configured key
   * for — NOT just one. A codex can hold more than one Arweave key, and the
   * Upload Wizard's own Account step genuinely lets an upload go out under
   * ANY of them (`arweave-upload-wizard-account-wiring`'s per-call
   * `accountId` resolution); scoping Library to a single hardcoded address
   * (the bug this field fixes) made every OTHER key's uploads silently
   * invisible and un-rebuildable, even though they genuinely exist on chain
   * under a key this very codex holds. Library's whole point is "show me
   * everything I've uploaded", not "show me what one specific key
   * uploaded" — `listLibrary`/`rebuildLibrary` below are therefore called
   * once PER owner here and the results merged, rather than threading a
   * single owner through unchanged. A codex with exactly one configured key
   * behaves exactly as before (a one-element array).
   */
  owners: readonly string[];
  /** The gateway pool the open/rebuild/download paths run through. */
  pool: GatewayPool;
  /** E3 list: the owner's Library entries (the store returns them newest-first). */
  listLibrary: (owner: string) => Promise<LibraryEntry[]>;
  /** E3 openUrl: composes a healthy-gateway URL for an id. */
  openUrl: (id: string, opts: { pool: GatewayPool }) => string;
  /** E3 rebuild-from-chain: reconciles the Library for an owner. */
  rebuildLibrary: (owner: string, opts: { pool: GatewayPool }) => Promise<void>;
  /** Injectable fetch seam the download path's raw-byte gateway read runs
   *  through (mirrors `PollStatusOptions.fetchFn`/`RebuildLibraryOptions.
   *  fetchFn` — no new HTTP client invented for this area). Defaults to
   *  the global `fetch`. */
  fetchFn?: typeof fetch;
  /** Unlock-gated reveal of an Ouronet account's decrypted `secret`
   *  plaintext, so an encrypted entry's AES key can be re-derived. The SAME
   *  seam `ArweavePanelDeps.revealAccountSecret` already exposes and
   *  `ArweaveSeedsArea` already consumes — injected here identically.
   *  Absent → every encrypted entry's download surfaces
   *  {@link CANNOT_DECRYPT_ENCRYPTOR_MESSAGE} rather than attempting a
   *  decrypt. */
  revealAccountSecret?: (accountId: string) => Promise<string | null> | string | null;
  /** The codex's own activated Ouronet accounts — the ONLY seam this area
   *  has to map an on-chain `Codex-Encryptor` address back to the
   *  `accountId` `revealAccountSecret` expects. Same prop shape as
   *  `ArweavePanelDeps.ouronetAccounts`. An entry whose `Codex-Encryptor`
   *  matches no account's `account.address` here is treated as "this codex
   *  doesn't hold that account" — {@link CANNOT_DECRYPT_ENCRYPTOR_MESSAGE},
   *  never a guessed decrypt. */
  ouronetAccounts?: readonly ArweaveSeedAccountSource[];
}

/** Newest-first by `createdAt` DESC, with a stable `id` DESC tiebreak. */
function sortNewestFirst(entries: LibraryEntry[]): LibraryEntry[] {
  return [...entries].sort((a, b) => {
    if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
    if (a.id < b.id) return 1;
    if (a.id > b.id) return -1;
    return 0;
  });
}

/** Read a tag value by name from an entry's tag list; `undefined` when absent. */
function tagValue(tags: readonly Tag[], name: string): string | undefined {
  return tags.find((t) => t.name === name)?.value;
}

/**
 * Resolves the relative path a manifest entry's Open link should resolve
 * through — the first (lexicographically, for determinism) sibling FILE
 * entry sharing the SAME `uploadId` that carries a `Codex-Path` tag, or
 * `undefined` when no such sibling is locally known (e.g. the manifest's own
 * file entries haven't rebuilt/loaded yet, or this is a solo manifest with
 * no files). A bare `<manifestId>` has no default content to resolve to
 * without an `"index"` entry in the manifest's own JSON body (per the
 * ANS-104/arweave-paths manifest spec) — confirmed 404ing against the live
 * gateway for an already-posted manifest of this exact shape, while
 * `<manifestId>/<path>` 200s. Composing THIS link, rather than relying on a
 * future upload-side `"index"` fix, resolves every manifest already on
 * chain today, not just new uploads.
 *
 * Under the category/bundle redesign below, a manifest WITH known siblings is
 * always grouped into a bundle (its siblings render as their OWN rows, each
 * with its own direct `openHrefFor` link) — so this function's sibling search
 * only ever finds a match for a manifest rendered standalone (no siblings
 * grouped with it), in which case there IS no sibling and this intentionally
 * falls through to the bare-id fallback below. Kept exactly as-is (not
 * re-derived) per the correlation this file already established.
 */
function manifestFilePath(entry: LibraryEntry, entries: readonly LibraryEntry[]): string | undefined {
  if (entry.uploadId === undefined) return undefined;
  const siblingPaths = entries
    .filter((candidate) => candidate.manifest === undefined && candidate.uploadId === entry.uploadId)
    .map((candidate) => tagValue(candidate.tags, TAG_CODEX_PATH))
    .filter((path): path is string => path !== undefined)
    .sort();
  return siblingPaths[0];
}

/** Composes the Open href for `entry`: a manifest entry with a resolvable
 *  sibling file path links straight to `<manifestId>/<path>` (every URL path
 *  segment individually percent-encoded, slashes preserved as separators);
 *  every other entry — including a manifest with no resolvable sibling path —
 *  keeps the plain `openUrl(entry.id, {pool})` link, unchanged. */
function openHrefFor(
  entry: LibraryEntry,
  entries: readonly LibraryEntry[],
  openUrl: (id: string, opts: { pool: GatewayPool }) => string,
  pool: GatewayPool,
): string {
  const base = openUrl(entry.id, { pool });
  if (entry.manifest?.isManifest !== true) return base;
  const path = manifestFilePath(entry, entries);
  if (path === undefined) return base;
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  return `${base}/${encodedPath}`;
}

/** Standard-alphabet base64 → raw bytes — the exact `atob` + `charCodeAt`
 *  decode shape `PureKeysArea.tsx`'s own `pemToDer` already uses (PEM's/this
 *  module's base64 is the STANDARD alphabet, unlike a JWK member's
 *  base64url, so `atob` is the correct, self-contained decoder here). */
function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Hands `bytes` to the user as a download — object URL + `<a>` click +
 *  revoke, the EXACT browser-download idiom `useCodexBackup.ts`'s
 *  `downloadAsJson` uses (append/click/remove the anchor, revoke
 *  immediately — no `setTimeout`). */
function saveBytesAsFile(bytes: Uint8Array<ArrayBuffer>, filename: string, contentType: string): void {
  const blob = new Blob([bytes], { type: contentType || "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/** One exported Library item — see `buildExportPayload`'s own doc comment
 *  for the exact field-by-field provenance of every value below. */
interface LibraryExportItem {
  filename: string;
  link: string;
  id: string;
  owner: string;
  contentType: string;
  status: LibraryStatus;
  isManifest: boolean;
  uploadId?: string;
}

/** The exported JSON's top-level shape — an ISO export timestamp, a
 *  redundant `itemCount` (so a consumer can sanity-check `items.length`
 *  without counting), and the full item list. */
interface LibraryExportPayload {
  exportedAt: string;
  itemCount: number;
  items: LibraryExportItem[];
}

/**
 * Maps EVERY entry in `entries` (the full, already-loaded, unfiltered
 * dataset across every owner — NOT a page slice) to one exported item each.
 * `filename`/`link` reuse the EXACT SAME conventions `EntryRow` already
 * renders (`tagValue(entry.tags, TAG_CODEX_PATH) ?? entry.itemId`, and
 * `openHrefFor` for the manifest-aware link) so an exported row always
 * matches what that row's own "Open"/link-box would show — no separate,
 * divergent derivation. No pre-filtering: a manifest entry is included
 * (flagged via `isManifest`) rather than silently dropped.
 */
function buildExportPayload(
  entries: readonly LibraryEntry[],
  openUrl: (id: string, opts: { pool: GatewayPool }) => string,
  pool: GatewayPool,
): LibraryExportPayload {
  const items: LibraryExportItem[] = entries.map((entry) => ({
    filename: tagValue(entry.tags, TAG_CODEX_PATH) ?? entry.itemId,
    link: openHrefFor(entry, entries, openUrl, pool),
    id: entry.id,
    owner: entry.owner,
    contentType: entry.contentType,
    status: entry.status,
    isManifest: entry.manifest?.isManifest === true,
    ...(entry.uploadId !== undefined ? { uploadId: entry.uploadId } : {}),
  }));
  return {
    exportedAt: new Date().toISOString(),
    itemCount: items.length,
    items,
  };
}

/** Resolves the `Codex-Encryptor` tag's address back to the `ArweaveSeedAccountSource`
 *  this codex actually holds for it, or `undefined` when none matches — the
 *  "no account in this codex holds this address" case `downloadEntry` turns
 *  into {@link CANNOT_DECRYPT_ENCRYPTOR_MESSAGE} rather than a guessed decrypt. */
function findEncryptorAccount(
  encryptorAddress: string,
  ouronetAccounts: readonly ArweaveSeedAccountSource[],
): ArweaveSeedAccountSource | undefined {
  return ouronetAccounts.find((entry) => entry.account.address === encryptorAddress);
}

/* ─────────────────────── category grouping + bundle grouping ───────────────────────
 *
 * `Codex-Category` (read via the SAME `tagValue` helper `CodexBackupHistoryArea.tsx`'s
 * own `filterCodexBackups` already uses — no new tag-reading convention invented) buckets
 * entries into labeled SECTIONS, rendered in the canonical `UPLOAD_CATEGORIES` taxonomy
 * order (the design doc's own grouped table — `arweave-core/src/upload/tags.ts`), with an
 * "Uncategorized" section (always LAST) catching any entry with no/garbage category tag so
 * nothing silently disappears. A section with zero entries never renders a header.
 *
 * Within a section, entries sharing a `Codex-Upload-Id` (the SAME correlation
 * `manifestFilePath` above already keys on) are grouped into ONE render unit: 2+ members is
 * a "bundle" (its manifest member, if any, demoted to a de-emphasized header rather than a
 * peer row — `uploadBundle`'s own manifest+files shape); everything else (including a solo
 * manifest with no known siblings) is a "single" unit — unchanged, one full peer row.
 */

const UNCATEGORIZED_CATEGORY = "uncategorized" as const;
type CategoryKey = UploadCategory | typeof UNCATEGORIZED_CATEGORY;

/** A legible label per `UPLOAD_CATEGORIES` value (the design doc's taxonomy has only
 *  GROUP labels, e.g. "Creative & Professional" — no existing per-category label to
 *  reuse, so this is this file's own first one, title-cased from the canonical slug). */
const CATEGORY_LABELS: Record<CategoryKey, string> = {
  "personal-photos": "Personal Photos",
  "personal-videos": "Personal Videos",
  "personal-audio": "Personal Audio",
  "journals-writing": "Journals & Writing",
  "personal-documents": "Personal Documents",
  "medical-records": "Medical Records",
  "financial-records": "Financial Records",
  "legal-records": "Legal Records",
  "certificates-credentials": "Certificates & Credentials",
  "creative-work": "Creative Work",
  "nft-data": "NFT Data",
  "software-code": "Software / Code",
  "website-dapp-hosting": "Website / DApp Hosting",
  "research-data": "Research Data",
  "publications-books": "Publications & Books",
  "public-statement": "Public Statement",
  "proof-timestamping": "Proof / Timestamping",
  "memorial-legacy": "Memorial / Legacy",
  "historical-archive": "Historical Archive",
  "genealogy-family-history": "Genealogy & Family History",
  "correspondence-archive": "Correspondence Archive",
  "gaming-virtual-assets": "Gaming / Virtual Assets",
  "event-records": "Event Records",
  "codex-backup": "Codex Backup",
  foreign: "Foreign",
  "general-other": "General / Other",
  [UNCATEGORIZED_CATEGORY]: "Uncategorized",
};

/** Canonical section order: the taxonomy's own order, then Uncategorized last. */
const CATEGORY_ORDER: readonly CategoryKey[] = [...UPLOAD_CATEGORIES, UNCATEGORIZED_CATEGORY];

const VALID_CATEGORY_SET: ReadonlySet<string> = new Set(UPLOAD_CATEGORIES);

/** `entry`'s section key — its `Codex-Category` tag value when it is one of the
 *  canonical `UPLOAD_CATEGORIES`, else {@link UNCATEGORIZED_CATEGORY} (covers both a
 *  missing tag and a garbage/forged value, so every entry lands in a REAL section). */
function categoryOf(entry: LibraryEntry): CategoryKey {
  const raw = tagValue(entry.tags, TAG_CODEX_CATEGORY);
  return raw !== undefined && VALID_CATEGORY_SET.has(raw) ? (raw as UploadCategory) : UNCATEGORIZED_CATEGORY;
}

/** One top-level render unit: either a single peer entry, or a bundle (2+ entries
 *  sharing one `Codex-Upload-Id`) with its manifest member (if any) split out. */
interface LibraryRenderUnit {
  /** Stable React key — the shared `Codex-Upload-Id`, or `solo:<id>` for an
   *  entry with no `uploadId` (never collides with a real uploadId). */
  key: string;
  kind: "single" | "bundle";
  /** Present only for a "bundle" unit whose group includes a manifest member. */
  manifestEntry?: LibraryEntry;
  /** The row(s) to render: the bundle's non-manifest members, or the lone
   *  "single" entry itself (length 1). */
  fileEntries: LibraryEntry[];
}

/** Groups `categoryEntries` (already newest-first) into {@link LibraryRenderUnit}s by
 *  shared `Codex-Upload-Id`, preserving newest-first unit order (a `Map`'s insertion
 *  order is the position of each group's FIRST — i.e. newest — member). */
function buildRenderUnits(categoryEntries: readonly LibraryEntry[]): LibraryRenderUnit[] {
  const groups = new Map<string, LibraryEntry[]>();
  for (const entry of categoryEntries) {
    const key = entry.uploadId ?? `solo:${entry.id}`;
    const existing = groups.get(key);
    if (existing !== undefined) existing.push(entry);
    else groups.set(key, [entry]);
  }

  const units: LibraryRenderUnit[] = [];
  for (const [key, members] of groups) {
    if (members.length === 1) {
      units.push({ key, kind: "single", fileEntries: members });
      continue;
    }
    const manifestEntry = members.find((m) => m.manifest?.isManifest === true);
    const fileEntries = manifestEntry === undefined ? members : members.filter((m) => m !== manifestEntry);
    units.push({ key, kind: "bundle", manifestEntry, fileEntries });
  }
  return units;
}

/** One rendered category section: its key plus the render units inside it. */
interface CategorySection {
  category: CategoryKey;
  units: LibraryRenderUnit[];
}

/** `LibraryArea` is mounted ONLY on the panel's "General Data" tab
 *  (`arweave-upload-library` follow-up redesign) — the "Codex" tab's own
 *  `CodexBackupHistoryArea` is the dedicated "just my codex backups" view,
 *  reading the SAME underlying Library data. {@link buildCategorySections}
 *  excludes this category entirely so an upload never reads as appearing
 *  TWICE across the two tabs with no indication they're the same thing. */
const CODEX_BACKUP_CATEGORY = "codex-backup" as const;

/** Buckets `entries` by {@link categoryOf}, then builds render units PER bucket, in
 *  canonical {@link CATEGORY_ORDER}. A category with zero matching entries is skipped
 *  entirely — never an empty header. `codex-backup` entries are dropped BEFORE
 *  bucketing — see {@link CODEX_BACKUP_CATEGORY}'s own doc comment. */
function buildCategorySections(entries: readonly LibraryEntry[]): CategorySection[] {
  const byCategory = new Map<CategoryKey, LibraryEntry[]>();
  for (const entry of entries) {
    const category = categoryOf(entry);
    if (category === CODEX_BACKUP_CATEGORY) continue;
    const bucket = byCategory.get(category);
    if (bucket !== undefined) bucket.push(entry);
    else byCategory.set(category, [entry]);
  }

  const sections: CategorySection[] = [];
  for (const category of CATEGORY_ORDER) {
    const bucket = byCategory.get(category);
    if (bucket === undefined || bucket.length === 0) continue;
    sections.push({ category, units: buildRenderUnits(bucket) });
  }
  return sections;
}

/** A render unit tagged with the section it belongs to — the flat, paginated
 *  sequence `LibraryArea` slices into pages. */
interface FlatUnit {
  category: CategoryKey;
  unit: LibraryRenderUnit;
}

function flattenSections(sections: readonly CategorySection[]): FlatUnit[] {
  const flat: FlatUnit[] = [];
  for (const section of sections) {
    for (const unit of section.units) flat.push({ category: section.category, unit });
  }
  return flat;
}

/** Fixed page size, in TOP-LEVEL UNITS (a bundle group or an ungrouped entry each
 *  count as ONE unit, never per raw file row). Bumped 10 → 25 alongside the
 *  2-line row redesign below — see this file's own module doc comment ("the
 *  2-line row is roughly half the vertical space of the old 3-sub-row
 *  layout") for the reasoning; a real Library list stays just as scannable
 *  per page at this density, without inventing a user-facing page-size
 *  setting. */
const LIBRARY_PAGE_SIZE = 25;

/* ───────────────────────────── row-level presentation ─────────────────────────────
 *
 * Each row is exactly TWO lines (owner's own words: "one entry has two lines, the
 * name of the File, and below is a field with the address/link of the item, and at
 * the end, 3 buttons, square, with icons, Open, Download, Copy"):
 *   line 1 — `ROW_LINE1_STYLE`: filename + status/manifest pills.
 *   line 2 — `ROW_LINE2_STYLE`: the copyable link field + the 3 square icon buttons,
 *            on the SAME line (keeps the row shortest, per the task's own "pick
 *            whichever keeps the row shortest" instruction).
 * Padding/gaps throughout this section are deliberately tight — "each entry has to
 * use as little as possible in height so that we may display lots per page" (the
 * owner's own "15000 photos" scenario) — while staying large enough to tap/click
 * comfortably (24px square action buttons, matching this package's other compact
 * icon-button sizes, e.g. `ArweavePanel.tsx`'s own `PaginationMedallion` arrows).
 */

const ENTRY_ROW_STYLE: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 3,
  padding: "5px 8px",
  borderRadius: 8,
  border: "1px solid #262626",
  backgroundColor: "#0d0d0d",
  marginBottom: 3,
};

const ROW_LINE1_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: 6,
};

const ROW_LABEL_STYLE: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: "#d2d3d4",
  wordBreak: "break-word",
};

const ROW_LINE2_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: 4,
};

const ERROR_TEXT_STYLE: React.CSSProperties = {
  color: "#f87171",
  fontSize: 11,
};

/** A small colored-dot + pill — mirrors `ArweaveRestoreEligibilityStatus.tsx`'s own
 *  dot+pill convention, applied here to the status badge so it is a real, bounded,
 *  padded element rather than a bare inline `<span>` touching its neighbors. */
const STATUS_PILL_STYLE: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  padding: "1px 7px",
  borderRadius: 9999,
  border: `1px solid ${ACCENT}40`,
  backgroundColor: `${ACCENT}1a`,
  color: "#d2d3d4",
  fontSize: 10,
  fontWeight: 700,
};

const MANIFEST_BADGE_STYLE: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "1px 7px",
  borderRadius: 9999,
  border: "1px solid #88888855",
  backgroundColor: "#88888822",
  color: "#aaaaaa",
  fontSize: 10,
  fontWeight: 700,
};

const DOT_STYLE = (color: string): React.CSSProperties => ({
  flexShrink: 0,
  width: 7,
  height: 7,
  borderRadius: 9999,
  backgroundColor: color,
});

const STATUS_DOT_COLOR: Record<LibraryStatus, string> = {
  pending: ACCENT,
  final: "#22c55e",
};

/** The status indicator — a real pill (padding + border + background) with a
 *  colored dot, NEVER a bare inline `<span>` touching its neighbors (the exact
 *  class of bug that crushed id/status/manifest-badge into one unreadable
 *  string). */
function StatusBadge({ status }: { status: LibraryStatus }): React.ReactElement {
  return (
    <span data-testid={`library-status-${status}`} style={STATUS_PILL_STYLE}>
      <span aria-hidden style={DOT_STYLE(STATUS_DOT_COLOR[status])} />
      {status === "pending" ? "Pending" : "Final"}
    </span>
  );
}

/** The "came from a manifest" indicator — same styled-pill treatment as
 *  {@link StatusBadge}, rendered as its OWN bounded element. */
function ManifestBadge(): React.ReactElement {
  return (
    <span data-testid="library-manifest-badge" style={MANIFEST_BADGE_STYLE}>
      Manifest
    </span>
  );
}

const LINK_BOX_TEXT_STYLE: React.CSSProperties = {
  flex: "1 1 200px",
  minWidth: 0,
  fontFamily: MONO,
  fontSize: 11,
  padding: "3px 7px",
  borderRadius: 6,
  border: `1px solid ${ACCENT}40`,
  backgroundColor: "#0a0a0a",
  color: "#d2d3d4",
  wordBreak: "break-all",
  userSelect: "all",
};

const COPY_SUCCESS_STYLE: React.CSSProperties = { color: "#22c55e", fontSize: 11 };
const COPY_FAILED_STYLE: React.CSSProperties = { color: "#f87171", fontSize: 11 };

/** The 3 row actions' SQUARE, icon-only button chrome (owner's own words:
 *  "3 buttons, square, with icons, Open, Download, Copy") — the SAME gold
 *  `ACCENT` this package's text-button convention already uses, just
 *  restyled to a fixed-size square rather than a padded text pill, so a
 *  thousand-entry page stays as compact as the 2-line row itself demands.
 *  `title`/`aria-label` on every caller name the action, since there is no
 *  visible text label to fall back on for accessibility. */
const ICON_BUTTON_STYLE: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
  width: 22,
  height: 22,
  borderRadius: 6,
  border: `1px solid ${ACCENT}40`,
  backgroundColor: "#111",
  color: ACCENT,
  cursor: "pointer",
  padding: 0,
  textDecoration: "none",
};

const ICON_GLYPH_SIZE = 12;

/**
 * Copy-to-clipboard behavior for one row's link — split out of the old
 * `CopyLinkBox` component so the SQUARE icon button (rendered alongside
 * Open/Download on line 2) and the link text box (also line 2) can be two
 * separate elements sharing one piece of state, rather than one component
 * owning both. `navigator.clipboard.writeText` NEVER fails silently:
 * unavailable or a rejected promise both surface a visible "copy failed,
 * select and copy manually" fallback — unchanged from before this redesign.
 */
function useClipboardCopy(url: string): {
  copyState: "idle" | "copied" | "failed";
  onCopy: () => void;
} {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  const onCopy = useCallback((): void => {
    const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
    if (clipboard === undefined || typeof clipboard.writeText !== "function") {
      setCopyState("failed");
      return;
    }
    clipboard
      .writeText(url)
      .then(() => setCopyState("copied"))
      .catch(() => setCopyState("failed"));
  }, [url]);

  return { copyState, onCopy };
}

/** One file/entry row — the SAME shape for both an ungrouped entry AND a
 *  bundle's own file row: EXACTLY 2 lines (owner's own words quoted in this
 *  file's module doc comment) — line 1 is the legible name + separated
 *  status/manifest pills; line 2 is the copyable link field plus the 3
 *  square Open/Download/Copy icon buttons, together on the same line so the
 *  row stays as short as possible. The visible label reuses `downloadEntry`'s
 *  OWN filename fallback (`Codex-Path` tag, else `itemId`) — never the bare,
 *  cryptic `entry.id` — the same convention already governing what a
 *  DOWNLOADED file is named on disk. */
function EntryRow({
  entry,
  href,
  onDownload,
  downloadError,
}: {
  entry: LibraryEntry;
  href: string;
  onDownload: () => void;
  downloadError?: string;
}): React.ReactElement {
  const label = tagValue(entry.tags, TAG_CODEX_PATH) ?? entry.itemId;
  const { copyState, onCopy } = useClipboardCopy(href);
  return (
    <div data-testid="library-entry" style={ENTRY_ROW_STYLE}>
      <div data-testid="library-entry-line1" style={ROW_LINE1_STYLE}>
        <span data-testid="library-entry-label" style={ROW_LABEL_STYLE}>
          {label}
        </span>
        <StatusBadge status={entry.status} />
        {entry.manifest?.isManifest ? <ManifestBadge /> : null}
      </div>
      <div data-testid="library-entry-line2" style={ROW_LINE2_STYLE}>
        <div data-testid="library-link-box" style={LINK_BOX_TEXT_STYLE}>
          {href}
        </div>
        <a
          data-testid="library-open-link"
          href={href}
          title="Open"
          aria-label="Open"
          style={ICON_BUTTON_STYLE}
        >
          <ExternalLink size={ICON_GLYPH_SIZE} aria-hidden />
        </a>
        <button
          type="button"
          data-testid="library-download-button"
          onClick={onDownload}
          title="Download"
          aria-label="Download"
          style={ICON_BUTTON_STYLE}
        >
          <DownloadGlyph size={ICON_GLYPH_SIZE} aria-hidden />
        </button>
        <button
          type="button"
          data-testid="library-copy-button"
          onClick={onCopy}
          title="Copy link"
          aria-label="Copy link"
          style={ICON_BUTTON_STYLE}
        >
          {copyState === "copied" ? (
            <Check size={ICON_GLYPH_SIZE} aria-hidden />
          ) : (
            <CopyGlyph size={ICON_GLYPH_SIZE} aria-hidden />
          )}
        </button>
        {copyState === "copied" ? (
          <span data-testid="library-copy-success" style={COPY_SUCCESS_STYLE}>
            Copied!
          </span>
        ) : null}
        {copyState === "failed" ? (
          <span data-testid="library-copy-failed" role="alert" style={COPY_FAILED_STYLE}>
            Copy failed — select and copy manually.
          </span>
        ) : null}
      </div>
      {downloadError !== undefined ? (
        <span data-testid="library-download-error" role="alert" style={ERROR_TEXT_STYLE}>
          {downloadError}
        </span>
      ) : null}
    </div>
  );
}

const BUNDLE_GROUP_STYLE: React.CSSProperties = {
  marginBottom: 3,
  paddingLeft: 8,
  borderLeft: `2px solid ${ACCENT}55`,
};

const BUNDLE_HEADER_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: 8,
  padding: "2px 2px 4px",
  fontSize: 11,
  color: "#9a9a9a",
};

const BUNDLE_MANIFEST_ID_STYLE: React.CSSProperties = {
  fontFamily: MONO,
  color: "#6f6f6f",
};

/** A bundle group — ONE de-emphasized header (the upload's own file count, plus
 *  the manifest's id when one is known, NEVER a full peer row with its own
 *  Open/Download controls) followed by one {@link EntryRow} PER FILE. */
function BundleGroup({
  unit,
  renderRow,
}: {
  unit: LibraryRenderUnit;
  renderRow: (entry: LibraryEntry) => React.ReactElement;
}): React.ReactElement {
  return (
    <div data-testid="library-bundle-group" style={BUNDLE_GROUP_STYLE}>
      <div data-testid="library-bundle-header" style={BUNDLE_HEADER_STYLE}>
        <span>
          Bundle upload · {unit.fileEntries.length} file{unit.fileEntries.length === 1 ? "" : "s"}
        </span>
        {unit.manifestEntry !== undefined ? (
          <span data-testid="library-bundle-manifest-id" style={BUNDLE_MANIFEST_ID_STYLE}>
            manifest: {unit.manifestEntry.id}
          </span>
        ) : null}
      </div>
      {unit.fileEntries.map((entry) => renderRow(entry))}
    </div>
  );
}

const SECTION_HEADER_ROW_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  margin: "14px 0 6px",
};

const SECTION_TOGGLE_BUTTON_STYLE: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 18,
  height: 18,
  padding: 0,
  border: "none",
  background: "transparent",
  color: ACCENT,
  cursor: "pointer",
  flexShrink: 0,
};

const SECTION_HEADER_STYLE: React.CSSProperties = {
  color: ACCENT,
  fontSize: 14,
  fontWeight: 700,
  margin: 0,
};

/**
 * One category section's header — the section LABEL (unchanged `data-testid`/
 * text contract every existing test already asserts on: `library-category-
 * <key>`, exact text `CATEGORY_LABELS[category]`) plus its OWN collapse/expand
 * toggle (`library-category-toggle-<key>`, a SEPARATE element) — "categories
 * must be collapsable" (owner's own words), defaulting to EXPANDED so the
 * owner never lands on a Library full of silently-hidden sections. Collapsing
 * is purely a DISPLAY choice made by the caller (`LibraryArea` below skips
 * rendering this category's rows while collapsed) — it never changes which
 * units belong to which page.
 */
function CategorySectionHeader({
  category,
  collapsed,
  onToggle,
}: {
  category: CategoryKey;
  collapsed: boolean;
  onToggle: () => void;
}): React.ReactElement {
  const label = CATEGORY_LABELS[category];
  return (
    <div style={SECTION_HEADER_ROW_STYLE}>
      <button
        type="button"
        data-testid={`library-category-toggle-${category}`}
        aria-expanded={!collapsed}
        aria-label={`${collapsed ? "Expand" : "Collapse"} ${label}`}
        title={collapsed ? "Expand" : "Collapse"}
        onClick={onToggle}
        style={SECTION_TOGGLE_BUTTON_STYLE}
      >
        {collapsed ? <ChevronRight size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
      </button>
      <h4 data-testid={`library-category-${category}`} style={SECTION_HEADER_STYLE}>
        {label}
      </h4>
    </div>
  );
}

const PAGER_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 12,
  marginTop: 12,
};

function pagerButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    ...secondaryButtonStyle,
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.4 : 1,
  };
}

/** The simple, clearly-labeled "Page X of Y" + Prev/Next control — no existing
 *  UI-pagination precedent in this package applies cleanly here (the closest,
 *  `ArweaveAccountsArea.tsx`/`PureKeysArea.tsx`'s own Prev/Next, is built for
 *  mobile-only swipeable pages of a fixed row count measured off real layout);
 *  this is that SAME Prev/Next vocabulary (disabled at the edges, gold-pill
 *  styled, never a bare default button) without the swipe-gesture machinery
 *  this non-mobile-specific area doesn't need. */
function LibraryPager({
  page,
  totalPages,
  onPrev,
  onNext,
}: {
  page: number;
  totalPages: number;
  onPrev: () => void;
  onNext: () => void;
}): React.ReactElement {
  const atFirst = page === 0;
  const atLast = page >= totalPages - 1;
  return (
    <div data-testid="library-pager" style={PAGER_STYLE}>
      <button
        type="button"
        data-testid="library-page-prev"
        onClick={onPrev}
        disabled={atFirst}
        style={pagerButtonStyle(atFirst)}
      >
        ← Prev
      </button>
      <span data-testid="library-page-label" style={{ fontSize: 13, color: "#d2d3d4" }}>
        Page {page + 1} of {totalPages}
      </span>
      <button
        type="button"
        data-testid="library-page-next"
        onClick={onNext}
        disabled={atLast}
        style={pagerButtonStyle(atLast)}
      >
        Next →
      </button>
    </div>
  );
}

export function LibraryArea(props: LibraryAreaProps): React.ReactElement {
  const {
    owners,
    pool,
    listLibrary,
    openUrl,
    rebuildLibrary,
    fetchFn,
    revealAccountSecret,
    ouronetAccounts = [],
  } = props;

  // De-duplicated so a caller that (harmlessly) repeats the same address
  // across `owners` never queries/rebuilds it twice.
  const uniqueOwners = [...new Set(owners)];

  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [downloadErrors, setDownloadErrors] = useState<Record<string, string>>({});
  const [rebuildError, setRebuildError] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  const refresh = useCallback(async (): Promise<void> => {
    // One `listLibrary` call PER owner, merged — Library aggregates across
    // every configured key rather than scoping to a single address (see
    // `LibraryAreaProps.owners`'s own doc comment for why).
    const rowsPerOwner = await Promise.all(uniqueOwners.map((o) => listLibrary(o)));
    setEntries(sortNewestFirst(rowsPerOwner.flat()));
    setLoaded(true);
    // A refreshed list (initial load, post-rebuild, or auto-rebuild) always
    // lands back on page 1 — a stale page index into a now-shorter/reordered
    // list would otherwise show nothing or the wrong page with zero cue why.
    setPage(0);
    // `uniqueOwners` is derived fresh from `owners` every render (a plain
    // `[...new Set(...)]`, not memoized) — depending on its CONTENTS via the
    // join below keeps this callback referentially stable across renders
    // that pass a content-identical (but newly-allocated) `owners` array,
    // the same "avoid a new-array-every-render effect loop" discipline
    // `ArweavePanel.tsx`'s own `EMPTY_WATCHED_ENTRIES` fix already applies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listLibrary, uniqueOwners.join(" ")]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * A rejected `rebuildLibrary` (a wrong/empty owner address throwing
   * `InvalidAddressError`, a gateway/network failure, pool exhaustion,
   * anything) used to be an UNHANDLED promise rejection here — the click
   * handler below fires this via `void onRebuild()`, so with no try/catch
   * the failure was invisible in the UI: the button looked like it "did
   * nothing" (the real owner-reported bug this fixes). Now any failure is
   * caught and surfaced via `rebuildError`, exactly like `onDownload`
   * already surfaces a per-entry failure via `downloadErrors`.
   *
   * Rebuilds EVERY owner (same aggregation as `refresh` above) — a single
   * rejection (from any owner) aborts the whole rebuild and is surfaced,
   * rather than silently reconciling only a subset.
   */
  async function onRebuild(): Promise<void> {
    setRebuildError(null);
    try {
      await Promise.all(uniqueOwners.map((o) => rebuildLibrary(o, { pool })));
      await refresh();
    } catch (cause) {
      setRebuildError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  /**
   * Resolves `entry`'s plaintext bytes (decrypting when needed) and hands
   * them to the user as a download under the original filename/content-type.
   * A public entry's bytes are exactly what `openUrl`'s URL already serves —
   * no behavior change from the existing Open link, just a forced download
   * instead of a navigation. An encrypted entry decrypts first; see the
   * module doc comment for the full pipeline.
   */
  const downloadEntry = useCallback(
    async (entry: LibraryEntry): Promise<void> => {
      const isEncrypted = tagValue(entry.tags, TAG_CODEX_ENCRYPTED) === "true";
      const url = openUrl(entry.id, { pool });
      const doFetch = fetchFn ?? fetch;
      const response = await doFetch(url);
      const raw: Uint8Array<ArrayBuffer> = new Uint8Array(await response.arrayBuffer());

      let plaintext: Uint8Array<ArrayBuffer>;
      if (!isEncrypted) {
        plaintext = raw;
      } else {
        const encryptorAddress = tagValue(entry.tags, TAG_CODEX_ENCRYPTOR);
        const account =
          encryptorAddress === undefined
            ? undefined
            : findEncryptorAccount(encryptorAddress, ouronetAccounts);
        if (revealAccountSecret === undefined || account === undefined) {
          throw new Error(CANNOT_DECRYPT_ENCRYPTOR_MESSAGE);
        }
        const secret = await revealAccountSecret(account.id);
        if (secret === null || secret === undefined || secret === "") {
          throw new Error(CANNOT_DECRYPT_ENCRYPTOR_MESSAGE);
        }
        const bits = bitStringOf(account.account, secret);
        if (bits === null) {
          throw new Error(CANNOT_DECRYPT_ENCRYPTOR_MESSAGE);
        }
        const key = await deriveAccountAesKey(bits);
        const iv = raw.slice(0, IV_BYTE_LENGTH);
        const ciphertext = raw.slice(IV_BYTE_LENGTH);
        const decrypted = await decryptWithDerivedKey(key, ciphertext, iv);
        const base64Text = new TextDecoder().decode(decrypted);
        plaintext = base64ToBytes(base64Text);
      }

      const filename = tagValue(entry.tags, TAG_CODEX_PATH) ?? entry.itemId;
      saveBytesAsFile(plaintext, filename, entry.contentType);
    },
    [openUrl, pool, fetchFn, revealAccountSecret, ouronetAccounts],
  );

  async function onDownload(entry: LibraryEntry): Promise<void> {
    setDownloadErrors((prev) => {
      if (!(entry.id in prev)) return prev;
      const { [entry.id]: _removed, ...rest } = prev;
      return rest;
    });
    try {
      await downloadEntry(entry);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setDownloadErrors((prev) => ({ ...prev, [entry.id]: message }));
    }
  }

  /**
   * Exports EVERY entry currently held in `entries` — the full, aggregated,
   * unpaginated dataset — as a downloaded JSON file (see
   * `buildExportPayload`'s own doc comment). Always available, including
   * against an empty Library (`items: []` is a valid export, not an error).
   */
  function onExport(): void {
    const payload = buildExportPayload(entries, openUrl, pool);
    const json = JSON.stringify(payload, null, 2);
    const bytes = new TextEncoder().encode(json);
    const dateOnly = payload.exportedAt.slice(0, 10);
    saveBytesAsFile(bytes, `codex-library-export-${dateOnly}.json`, "application/json");
  }

  function renderRow(entry: LibraryEntry): React.ReactElement {
    return (
      <EntryRow
        key={entry.id}
        entry={entry}
        href={openHrefFor(entry, entries, openUrl, pool)}
        onDownload={() => {
          void onDownload(entry);
        }}
        downloadError={downloadErrors[entry.id]}
      />
    );
  }

  /**
   * "Categories must be collapsable... we need to be able to display in
   * bulk all of this" (owner's own words) — which categories are currently
   * COLLAPSED, defaulting to the empty set (every category starts EXPANDED).
   * Purely local display state: collapsing a category hides its rows from
   * the rendered page below WITHOUT touching `flatUnits`/pagination math —
   * a category with hundreds of entries still occupies its real page slots
   * whether collapsed or not, it just isn't drawn on screen right now.
   */
  const [collapsedCategories, setCollapsedCategories] = useState<ReadonlySet<CategoryKey>>(
    new Set(),
  );

  function toggleCategory(category: CategoryKey): void {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }

  const sections = buildCategorySections(entries);
  const flatUnits = flattenSections(sections);
  const totalPages = Math.max(1, Math.ceil(flatUnits.length / LIBRARY_PAGE_SIZE));
  const clampedPage = Math.min(page, totalPages - 1);
  const pageUnits = flatUnits.slice(
    clampedPage * LIBRARY_PAGE_SIZE,
    clampedPage * LIBRARY_PAGE_SIZE + LIBRARY_PAGE_SIZE,
  );

  const pageNodes: React.ReactNode[] = [];
  let lastCategory: CategoryKey | null = null;
  for (const { category, unit } of pageUnits) {
    if (category !== lastCategory) {
      const collapsed = collapsedCategories.has(category);
      pageNodes.push(
        <CategorySectionHeader
          key={`section-${category}`}
          category={category}
          collapsed={collapsed}
          onToggle={() => toggleCategory(category)}
        />,
      );
      lastCategory = category;
    }
    // Collapsed → the header above still rendered (so the category stays
    // reachable/re-expandable), but its rows are skipped entirely — not
    // just visually hidden via CSS, so a collapsed category of thousands of
    // rows costs nothing to keep off-screen.
    if (collapsedCategories.has(category)) continue;
    pageNodes.push(
      unit.kind === "bundle" ? (
        <BundleGroup key={unit.key} unit={unit} renderRow={renderRow} />
      ) : (
        renderRow(unit.fileEntries[0]!)
      ),
    );
  }

  return (
    <div data-testid="library-area">
      <button
        type="button"
        data-testid="library-rebuild"
        onClick={() => {
          void onRebuild();
        }}
        style={secondaryButtonStyle}
      >
        Rebuild from chain
      </button>
      <button
        type="button"
        data-testid="library-export"
        onClick={onExport}
        style={secondaryButtonStyle}
      >
        Export Library
      </button>
      {rebuildError ? (
        <div data-testid="library-rebuild-error" role="alert">
          {rebuildError}
        </div>
      ) : null}

      {loaded && entries.length === 0 ? (
        <div data-testid="library-empty">
          No uploads yet. Rebuild from chain to recover any existing entries.
        </div>
      ) : null}

      <div data-testid="library-sections">{pageNodes}</div>

      {totalPages > 1 ? (
        <LibraryPager
          page={clampedPage}
          totalPages={totalPages}
          onPrev={() => setPage((p) => Math.max(0, p - 1))}
          onNext={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
        />
      ) : null}
    </div>
  );
}

export default LibraryArea;
