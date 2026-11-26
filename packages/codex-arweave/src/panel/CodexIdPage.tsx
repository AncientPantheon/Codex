/**
 * CodexIdPage — the "Codex ID" page's content, extracted out of
 * `ArweavePanel.tsx`'s own `active === "codex-id"` branch so the SAME page
 * can be mounted BOTH from its original deep-link location (inside
 * `ArweavePanel`'s own category tab strip, unchanged) AND directly from a
 * top-level nav entry (`apps/codex-playground`'s desktop `.cxpg-viewtabs`
 * row / mobile `CodexTierTwoMenu`'s "Codex ID" item), without duplicating
 * any of the page's own markup/logic.
 *
 * Takes the SAME `ArweavePanelDeps | null` shape `ArweavePanel` itself
 * already reads out of `ArweavePanelContext` (via `useContext`) — no new,
 * narrower prop surface was invented. A host mounting this page directly
 * (outside `ArweavePanel`'s own provider tree) supplies the identical
 * `ArweavePanelDeps` bundle it would otherwise feed `ArweavePanelProvider`;
 * `ArweavePanel`'s own `active === "codex-id"` branch now simply forwards
 * its own `deps` straight through, unchanged in behaviour (same testids,
 * same content, same eligibility semantics).
 *
 * Owns its OWN `codexIdEligibility` lookup (lifted unmodified out of
 * `ArweavePanel`'s former in-branch `useEffect` — it used to additionally
 * gate on `active === "codex-id"`, which this component no longer needs:
 * it only ever renders while the page itself is showing, so every mount IS
 * "codex-id active").
 *
 * REVISED (owner correction, 2026-10-12), two changes:
 *
 * 1. The informatics explainers were a single, ever-growing page of static
 *    text — a real usability complaint even after a visual-only re-style
 *    (cards/headings fixed the STYLING, not the "too much at once"
 *    problem). Split into three TABS — "How Backup Works" / "Encryption" /
 *    "Migration" — mirroring `ArweavePanel.tsx`'s own established pill-tab
 *    pattern (`role="tablist"`, `aria-selected`) rather than inventing a
 *    new tab convention. Only the active tab's content renders at once.
 *
 * 2. The "Back up codex to Arweave" button was unconditionally enabled
 *    regardless of eligibility, even though the REAL backend
 *    (`buildRealPanelDeps`'s `backupCodex` closure, `apps/codex-playground/
 *    src/realArweaveAdapter.ts`) already unconditionally REQUIRES
 *    `eligible` as one of its hard preconditions — clicking it on an
 *    ineligible codex was always going to throw. Now gated the same way
 *    "Make This Codex Eligible" already is: a visibly-disabled button with
 *    explanatory copy until the codex resolves eligible. The action also
 *    now opens as a real popup (`CodexModalShell`, the SAME modal chrome
 *    every other write-action in this app uses — `UploadWizard.tsx`,
 *    `RotatePaymentKeyModal.tsx`, etc.) instead of rendering its confirm/
 *    progress/result states inline on the page. `CodexBackupArea`'s own
 *    internal state machine is UNCHANGED and REUSED verbatim — only how
 *    it's framed (inline vs. modal) and when it's reachable (gated) moved.
 *
 * REVISED FURTHER (`legacy-prime-migration-wizard` T3, Wave 1): "Make This
 * Codex Eligible" now has a real destination — `LegacyPrimeMigrationWizard`
 * (`@ancientpantheon/codex-ouronet/components`). It is ENABLED whenever
 * `codexIdEligibility !== "eligible"` (exactly the cases it is already
 * rendered at all) and opens the new wizard via a
 * `legacyPrimeMigrationWizardOpen` boolean, instead of doing nothing. This
 * is a DELIBERATE, flagged behavior change from the previously-shipped
 * disabled "coming soon" state — the old title/copy is replaced by real
 * wizard-opening behavior.
 *
 * REVISED FURTHER (post-build fix round, Fix 2): Wave 2's own implementer
 * left the wizard's `allSeeds`/`allAccounts`/`currentPrimeSeed`/
 * `currentPrimeAccount` props wired to nothing real, documented as a gap
 * ("CodexIdPage.tsx currently has no useStoaChainSeeds/useOuroAccounts
 * hook access at all"). This page now calls `useStoaChainSeeds()`/
 * `useOuroAccounts()` directly — the same seam `CreateStoaChainSeedModal.tsx`
 * already uses — and threads the real seeds/accounts through, plus the two
 * derived `isPrime` lookups, so Page 2's "choose an existing account" option
 * can actually appear for a codex that has stoic-seeded accounts.
 */

import * as React from "react";
import { useCallback, useEffect, useState } from "react";

import { useIsMobile } from "@ancientpantheon/codex-ui/ui";
import {
  CodexModalShell,
  PendingKeyChangesCard,
  PendingKeyChangesSection,
  computeOutstandingKeyChanges,
} from "@ancientpantheon/codex-ouronet/ui";
import {
  LegacyPrimeMigrationWizard,
  StructuralUpgradeWizard,
} from "@ancientpantheon/codex-ouronet/components";
import {
  useCodex,
  useNeedsStructuralUpgrade,
  useOuroAccounts,
  useStoaChainSeeds,
} from "@ancientpantheon/codex-ouronet/hooks";
import { useCodexStoreOptional } from "@ancientpantheon/codex-ouronet/provider";
import { useEnsureCodexUnlockedOptional, describeKeyset } from "@ancientpantheon/codex-ouronet/zbom";
import {
  formatCodexShapeVersionLabel,
  hasMigrationPending,
  isMigrationSealed,
  type ForeignKeyEntry,
} from "@ancientpantheon/codex-core";

import type { ArweavePanelDeps } from "./context.js";
import { CodexBackupArea } from "./CodexBackupArea.js";
import { CodexBackupInformatics } from "./CodexBackupInformatics.js";
import { CodexEncryptionInformatics } from "./CodexEncryptionInformatics.js";
import {
  CodexMigrationInformatics,
  MIGRATION_RUNS_UNINTERRUPTED_MESSAGE,
} from "./CodexMigrationInformatics.js";
import { CodexMasterSeedSection } from "./CodexMasterSeedSection.js";
import { INFORMATICS_ACCENT } from "./informaticsStyles.js";
import { runSeededBatch, type BatchProgressEvent } from "../keygen/KeygenRunner.js";

/**
 * `legacy-prime-migration-wizard` T9 — a LOCAL, byte-for-byte
 * reimplementation of `@stoachain/stoa-core/crypto`'s real V2 envelope
 * (PBKDF2-SHA512/600k -> AES-256-GCM,
 * `btoa(JSON.stringify({v:2,ciphertext,iv,salt}))`), used ONLY by
 * {@link CodexIdPage}'s own `ensurePrimeArweaveSeed` below.
 *
 * WHY LOCAL: `codex-arweave` does NOT (and cannot) depend on
 * `@stoachain/stoa-core` directly — confirmed this session by attempting
 * the resolution: the package is physically absent from this package's own
 * dependency tree (unlike `codex-ouronet`/`codex-ui`/the host app, which
 * already carry it as a real dependency), so an `import` of
 * `@stoachain/stoa-core/crypto` here fails to resolve at both typecheck and
 * test runtime — this is not a style preference, it is a hard boundary.
 * `src/crypto/fileEncryption.ts`'s own "deliberately matched... for
 * consistency/auditability" precedent already establishes that
 * reimplementing this package's own crypto locally (rather than reaching
 * for stoa-core) is this package's accepted discipline when the real
 * library is unreachable — the one difference here is that FULL
 * byte-compatibility (not just matched parameters) is required: an
 * `IArweaveSeed.secret`/`wordsSecret` this page writes must be decryptable
 * later by the REAL `smartDecrypt` anywhere else in the system that reads
 * an Arweave seed (e.g. `apps/codex-playground/src/
 * ForeignChainsWiring.tsx`'s `createArweaveSeedPersistence`), and a seed
 * that REAL code already wrote must be readable here too (the
 * reconciliation check in `ensurePrimeArweaveSeed` below).
 */
const ARWEAVE_SEED_V2_PBKDF2_ITERATIONS = 600_000;

/**
 * The Arweave positions a codex must hold under its Codex Master Seed to be
 * Permaweb-eligible — `#0` and `#1` (`docs/work/arweave-master-accounts/
 * design.md`; owner: "the codex holds #0 and #1 arweave accounts derived from
 * the Codex Master Seed"). The DEFAULT for `ensurePrimeArweaveSeed`'s
 * `missingIndexes`, so a caller that has not evaluated the eligibility
 * predicate still derives the full pair.
 */
const MASTER_ARWEAVE_POSITIONS: readonly number[] = [0, 1];

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let out = "";
  for (let i = 0; i < bytes.byteLength; i++) out += String.fromCharCode(bytes[i]!);
  return btoa(out);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function encryptStringV2Compatible(plaintext: string, password: string): Promise<string> {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: ARWEAVE_SEED_V2_PBKDF2_ITERATIONS, hash: "SHA-512" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(plaintext));
  return btoa(
    JSON.stringify({
      v: 2,
      ciphertext: arrayBufferToBase64(ciphertext),
      iv: arrayBufferToBase64(iv.buffer),
      salt: arrayBufferToBase64(salt.buffer),
    }),
  );
}

/** Inverse of {@link encryptStringV2Compatible}. Throws on anything that
 *  doesn't parse as a V2 envelope, OR on a WebCrypto auth-tag failure (a
 *  decrypt attempted under the wrong key) — `ensurePrimeArweaveSeed`'s own
 *  caller treats either as "doesn't match," never a crash. */
async function decryptStringV2Compatible(encryptedBase64: string, password: string): Promise<string> {
  const envelope = JSON.parse(atob(encryptedBase64)) as {
    v?: number;
    ciphertext?: string;
    iv?: string;
    salt?: string;
  };
  if (
    envelope.v !== 2 ||
    typeof envelope.ciphertext !== "string" ||
    typeof envelope.iv !== "string" ||
    typeof envelope.salt !== "string"
  ) {
    throw new Error("decryptStringV2Compatible: not a recognizable V2 envelope.");
  }
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: base64ToArrayBuffer(envelope.salt),
      iterations: ARWEAVE_SEED_V2_PBKDF2_ITERATIONS,
      hash: "SHA-512",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToArrayBuffer(envelope.iv) },
    key,
    base64ToArrayBuffer(envelope.ciphertext),
  );
  return new TextDecoder().decode(decrypted);
}

/** The "Codex ID" page shell — eligibility status up top, then the two
 *  action buttons, then the informatics tab group. Fills the available
 *  container width (owner correction, 2026-10-12: a fixed maxWidth here
 *  left real empty space on wide viewports even after the tab split —
 *  the informatics CARDS keep their own comfortable reading width via
 *  `informaticsStyles.ts`, this outer shell no longer artificially caps
 *  the page itself). */
const CODEX_ID_PAGE_STYLE: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 20,
  width: "100%",
};

/**
 * `codex-id-step-flow`: the 3 actions used to read as unrelated, equal-
 * weight cards — the owner's own screenshot this session, annotated with
 * "1 -> 2 -> 3" arrows, is what this layout now literally implements.
 * Horizontal row, numbered left-to-right, connected by arrows; wraps to a
 * vertical column (arrows rotated to point down, never dropped) under
 * `useIsMobile()`, same responsive seam the rest of this package already
 * uses rather than a raw CSS media query. */
function codexIdStepsRowStyle(isMobile: boolean): React.CSSProperties {
  return {
    display: "flex",
    flexDirection: isMobile ? "column" : "row",
    alignItems: isMobile ? "stretch" : "flex-start",
    gap: isMobile ? 12 : 10,
  };
}

/** One step's own card — fixed-width on desktop so all 3 line up evenly;
 *  full-width on mobile (stacked). */
function codexIdStepCardStyle(isMobile: boolean): React.CSSProperties {
  return {
    display: "flex",
    flexDirection: "column",
    flex: isMobile ? undefined : "1 1 0",
    minWidth: isMobile ? undefined : 0,
  };
}

/** The arrow connector between two steps — "->" horizontally, "v" (rotated)
 *  when the row wraps to a column on mobile. Purely decorative (the real
 *  sequence is also stated in each step's own number/label), so
 *  `aria-hidden`. */
function StepArrow({ isMobile }: { isMobile: boolean }): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      style={{
        alignSelf: "center",
        color: "#444",
        fontSize: 20,
        lineHeight: 1,
        padding: isMobile ? "4px 0" : "0 2px",
        flexShrink: 0,
      }}
    >
      {isMobile ? "↓" : "→"}
    </span>
  );
}

/** The small circular step-number badge, filled gold with a checkmark once
 *  `done`, otherwise an outlined number. */
function StepNumberBadge({ n, done }: { n: number; done: boolean }): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 22,
        height: 22,
        borderRadius: "50%",
        fontSize: 12,
        fontWeight: 700,
        flexShrink: 0,
        backgroundColor: done ? INFORMATICS_ACCENT : "transparent",
        color: done ? "#0a0a0a" : "#888",
        border: done ? "none" : "1px solid #444",
      }}
    >
      {done ? "✓" : n}
    </span>
  );
}

/** Each action's own honest "what/why" copy, directly under its disabled
 *  button — the `title` tooltip mirrors the existing Upload category
 *  convention, and this paragraph makes the same explanation visible
 *  without hovering. */
const CODEX_ID_ACTION_EXPLANATION_STYLE: React.CSSProperties = {
  margin: "6px 0 0 0",
  fontSize: 12,
  lineHeight: 1.5,
  color: "#888",
};

/** The "already eligible" confirmation note that REPLACES the disabled
 *  "Make this codex eligible" button once eligibility resolves true — a
 *  disabled no-op button would be a confusing dead affordance for a codex
 *  that needs no migration at all. Green-accented (matches
 *  `ArweaveRestoreEligibilityStatus`'s own `eligible` dot colour). */
/** `codex-id-step-flow` (owner, this session): "same size, horizontal and
 *  vertical" — every step's action slot (enabled button / disabled button /
 *  done confirmation) shares this exact box shape, only the fill/border
 *  color and content differ. Replaces the old, differently-sized
 *  `CODEX_ID_ALREADY_ELIGIBLE_STYLE` pill. */
const STEP_ACTION_SLOT_BASE_STYLE: React.CSSProperties = {
  width: "100%",
  minHeight: 48,
  boxSizing: "border-box",
  padding: "0 16px",
  borderRadius: 12,
  fontSize: 14,
  fontWeight: 700,
  textAlign: "left",
  display: "flex",
  alignItems: "center",
};

/** The green "done" variant — a checked step's own action slot, STILL
 *  button-shaped (same size as the other two states), showing the real
 *  value (shape version / "Eligible") inline rather than a separate
 *  smaller status pill. */
const DONE_STEP_STYLE: React.CSSProperties = {
  ...STEP_ACTION_SLOT_BASE_STYLE,
  border: "1px solid #22c55e40",
  backgroundColor: "#22c55e1a",
  color: "#4ade80",
};

/** `legacy-prime-migration-wizard` T3: "Make This Codex Eligible" now has a
 *  real destination (`LegacyPrimeMigrationWizard`) and is ENABLED whenever
 *  `codexIdEligibility !== "eligible"` — this disabled chrome is kept only
 *  for the SAME "not yet eligible" gating `ENABLED_PRIMARY_BUTTON_STYLE`'s
 *  other user, "Back up codex to Arweave", still genuinely needs (the real
 *  backend unconditionally requires `eligible`). Mirrors `ArweavePanel.tsx`'s
 *  own `UPLOAD_ENTRY_BUTTON_DISABLED_STYLE` (duplicated here rather than
 *  imported: that constant lives in `ArweavePanel.tsx`, which imports THIS
 *  module, so importing back would be circular). */
const DISABLED_BUTTON_STYLE: React.CSSProperties = {
  ...STEP_ACTION_SLOT_BASE_STYLE,
  fontWeight: 600,
  cursor: "not-allowed",
  opacity: 0.4,
  border: "1px solid #444",
  backgroundColor: "transparent",
  color: "#888",
};

/** The real, enabled action trigger shared by both "Make This Codex
 *  Eligible" (opens `LegacyPrimeMigrationWizard`) and "Back up codex to
 *  Arweave" — mirrors `CodexBackupArea.tsx`'s own `primaryButtonStyle`
 *  (solid gold fill), but sized/aligned like `DISABLED_BUTTON_STYLE` so
 *  enabled vs. disabled reads as the SAME control, not two different
 *  ones. */
const ENABLED_PRIMARY_BUTTON_STYLE: React.CSSProperties = {
  ...STEP_ACTION_SLOT_BASE_STYLE,
  cursor: "pointer",
  border: "none",
  backgroundColor: INFORMATICS_ACCENT,
  color: "#0a0a0a",
};

/** `migration-pending-apply` T3 — step 2's launcher while a finalized plan
 *  is waiting to be applied. Reuses {@link DONE_STEP_STYLE}'s palette
 *  verbatim (the pending state IS structurally eligible already — it is only
 *  unapplied, so it must read as the SAME green, not a second one), applied
 *  to a real `<button>`: the eligible slot was a `<div role="status">`, which
 *  left "Retry the Eligibility Wizard" nowhere to live. */
const RETRY_STEP_BUTTON_STYLE: React.CSSProperties = {
  ...DONE_STEP_STYLE,
  cursor: "pointer",
};

/** The Apply trigger that sits BENEATH it (owner: *"beneath the middle Make
 *  Eligible button"*), in this page's own enabled-action gold — it is the
 *  step's one real write action, so it reads as the primary one. */
const APPLY_MIGRATION_BUTTON_STYLE: React.CSSProperties = {
  ...ENABLED_PRIMARY_BUTTON_STYLE,
  marginTop: 8,
};

/** Body copy inside the Apply popup. */
const APPLY_NOTE_STYLE: React.CSSProperties = {
  margin: 0,
  fontSize: 13,
  lineHeight: 1.5,
  color: "#d2d3d4",
};

/** The quieter "this is permanent" line beneath it. */
const APPLY_CAVEAT_STYLE: React.CSSProperties = {
  margin: 0,
  fontSize: 12,
  lineHeight: 1.5,
  color: "#888",
};

/** A failed seal. Same `role="alert"` + `#f87171` convention every other
 *  failure message in this package already uses. */
const APPLY_ERROR_STYLE: React.CSSProperties = {
  margin: 0,
  fontSize: 12,
  lineHeight: 1.5,
  color: "#f87171",
};

/** Placeholder styling for an unwired seam — visible, never blank. Mirrors
 *  `ArweavePanel.tsx`'s own `EMPTY_STYLE` (duplicated for the same
 *  circular-import reason as {@link DISABLED_BUTTON_STYLE}). */
const EMPTY_STYLE: React.CSSProperties = {
  padding: "24px",
  borderRadius: 12,
  border: "1px dashed #262626",
  color: "#666",
  fontSize: 13,
};

/** The informatics tab row — mirrors `ArweavePanel.tsx`'s own
 *  `desktopStrip` category-tab pattern (`role="tablist"`, pill buttons,
 *  `aria-selected`) rather than inventing a new tab convention. */
const INFORMATICS_TABLIST_STYLE: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: 8,
};

const INFORMATICS_TAB_HEIGHT = 36;

function informaticsTabStyle(selected: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    height: INFORMATICS_TAB_HEIGHT,
    padding: "0 16px",
    borderRadius: 999,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    border: `1px solid ${selected ? INFORMATICS_ACCENT : "#262626"}`,
    backgroundColor: selected ? INFORMATICS_ACCENT + "1a" : "transparent",
    color: selected ? INFORMATICS_ACCENT : "#888",
  };
}

export interface CodexIdPageProps {
  /** The SAME injected-seam bundle `ArweavePanel` reads out of
   *  `ArweavePanelContext` — `null` when no provider is wired (the page
   *  then degrades to a visible "not available" state, never a throw,
   *  mirroring `ArweavePanel`'s own no-provider tolerance). */
  deps: ArweavePanelDeps | null;
}

/**
 * The LIVE prime-search detail of one `ensurePrimeArweaveSeed` progress
 * report — present ONLY while a search is actually in flight.
 *
 * Mirrors `ArweaveSeedsArea`'s own `RunState["search"]` FIELD FOR FIELD, and
 * for one concrete reason: that area's `RunProgress` already renders the real
 * status line the owner asked the migration wizard to show —
 * `Position N of T · prime STAGE · X this search · Y total · Z%` — and the
 * wizard lives in `codex-ouronet`, which cannot import the component (
 * `codex-arweave` depends on `codex-ouronet`, so the reverse import would
 * close a package cycle). The DATA therefore travels through the progress
 * callback instead, in exactly the shape that line consumes, so the wizard can
 * re-render it rather than invent a second, differently-worded one.
 */
export interface EnsurePrimeArweaveSeedSearch {
  /** 1-based position of the key being searched: `completedCount + 1`. */
  position: number;
  /** The batch's requested count, unchanged for the whole run. */
  totalCount: number;
  /** Which of the two RSA primes is being searched for right now. */
  stage: BatchProgressEvent["stage"];
  /** Candidate draws in THIS search — restated, not accumulated, by the library. */
  attempts: number;
  /**
   * Candidate draws across the WHOLE run so far. NOT a library field: it is
   * derived here from per-(index,stage) high-water marks — see the
   * `onBatchProgress` handler for why summing `attempts` would be a bug.
   */
  grandAttempts: number;
  /** `overallProgress` (0..1) as a whole percent — what the bar is filled to. */
  percent: number;
}

/**
 * One progress report from {@link CodexIdPage}'s `ensurePrimeArweaveSeed`.
 *
 * `index`/`delivered`/`total` are the ORIGINAL, unchanged surface every
 * existing caller reads. `search` is PURELY ADDITIVE and OPTIONAL, so a caller
 * that predates it keeps compiling and keeps behaving identically.
 *
 * `search` is the discriminator between the channel's two kinds of event:
 * a live prime search carries it, a DELIVERED key does not — the very
 * distinction `RunProgress` draws with `run.search !== undefined`.
 */
export interface EnsurePrimeArweaveSeedProgress {
  /** The position in flight (a search) or just delivered (a key). */
  index: number;
  /** How many of the requested positions have been handed over so far. */
  delivered: number;
  /** How many positions this call set out to derive. */
  total: number;
  /** Live search detail — ABSENT on a delivered key. */
  search?: EnsurePrimeArweaveSeedSearch;
}

type CodexIdEligibilityPhase = "unknown" | "checking" | "eligible" | "not-eligible" | "error";

type InformaticsTab = "backup" | "encryption" | "migration";

const INFORMATICS_TABS: ReadonlyArray<{ id: InformaticsTab; label: string }> = [
  { id: "backup", label: "How Backup Works" },
  { id: "encryption", label: "Encryption" },
  { id: "migration", label: "Migration" },
];

export function CodexIdPage({ deps }: CodexIdPageProps): React.ReactElement {
  /**
   * Gates the "Make this codex eligible" button's PRESENCE, AND (new) the
   * "Back up codex to Arweave" button's ENABLED state: hidden/disabled
   * until the codex resolves truly eligible (a disabled no-op button at
   * that point would be a confusing dead affordance), shown/enabled
   * otherwise is the WRONG default here — "unknown"/"checking"/"error"
   * must all keep backup disabled too, since the real backend throws for
   * anything short of a confirmed `eligible === true`.
   *
   * Calls the exact SAME host-injected `checkArweaveRestoreEligibility`
   * seam `ArweaveRestoreEligibilityStatus` (the Library tab's own mount of
   * it, this page no longer renders a second copy — `codex-id-step-flow`,
   * this session) already calls — NOT a second implementation of the
   * underlying derivation (that still lives entirely on the host side).
   */
  const [codexIdEligibility, setCodexIdEligibility] = useState<CodexIdEligibilityPhase>("unknown");
  useEffect(() => {
    if (deps?.checkArweaveRestoreEligibility === undefined) return;
    let cancelled = false;
    setCodexIdEligibility("checking");
    deps
      .checkArweaveRestoreEligibility()
      .then((eligible) => {
        if (!cancelled) setCodexIdEligibility(eligible ? "eligible" : "not-eligible");
      })
      .catch(() => {
        if (!cancelled) setCodexIdEligibility("error");
      });
    return () => {
      cancelled = true;
    };
  }, [deps?.checkArweaveRestoreEligibility]);

  const isEligible = codexIdEligibility === "eligible";
  const isMobile = useIsMobile();

  const [backupWizardOpen, setBackupWizardOpen] = useState(false);
  // `codex-id-step-flow`: Step 3's own "done" indicator is "last backup
  // succeeded this session" (a timestamp), not a permanent checkmark like
  // Steps 1/2 — backing up is repeatable, unlike versioning/eligibility.
  // No change to `CodexBackupArea`'s own behavior: this just wraps the
  // `backupCodex` closure handed to it, recording success locally.
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(null);
  // `legacy-prime-migration-wizard` T3: opens `LegacyPrimeMigrationWizard`
  // from "Make This Codex Eligible" — enabled in exactly the cases that
  // button is rendered at all (`!isEligible`, i.e. `codexIdEligibility !==
  // "eligible"`).
  const [legacyPrimeMigrationWizardOpen, setLegacyPrimeMigrationWizardOpen] = useState(false);
  // `upgrade-prompt-ui` T5: opens `StructuralUpgradeWizard` from the sibling
  // "Codex Upgrade" card below — mirrors `legacyPrimeMigrationWizardOpen`
  // above exactly, just for the separate structural-shape migration.
  const [structuralUpgradeWizardOpen, setStructuralUpgradeWizardOpen] = useState(false);
  // `migration-pending-apply` T3: the Apply popup — the SAME boolean +
  // inline `CodexModalShell` convention as `backupWizardOpen` above, not a
  // second modal mechanism. `sealError` holds a FAILED seal's own message:
  // closing the popup on a failure would read as "sealed" when nothing was.
  const [applyMigrationOpen, setApplyMigrationOpen] = useState(false);
  const [sealError, setSealError] = useState<string | null>(null);
  const [informaticsTab, setInformaticsTab] = useState<InformaticsTab>("backup");

  // `upgrade-prompt-ui` T5: single source of truth for "does this codex need
  // a structural upgrade" (shared with the nav flashing indicator, T3) —
  // never a second comparison against `Codex_Shape_Version` here.
  const needsStructuralUpgrade = useNeedsStructuralUpgrade();
  const { Codex_Shape_Version, codexMasterSeed } = useCodex();
  const shapeLabel = formatCodexShapeVersionLabel(Codex_Shape_Version);

  // Fix 2 (post-build fix round): real seed/account data for the wizard's
  // Page 2 — the same `useStoaChainSeeds`/`useOuroAccounts` seam
  // `CreateStoaChainSeedModal.tsx` already uses. This page is already a
  // descendant of `<CodexProvider>` at runtime (`apps/codex-playground`'s
  // `ForeignChainsWiring.tsx`, itself inside `App.tsx`'s provider), so no
  // provider needs to be lifted/wrapped here.
  const { seeds: allSeeds } = useStoaChainSeeds();
  const { accounts: allAccounts } = useOuroAccounts();
  // `codex-id-step-flow` (owner, real-data bug this session, FOUR rounds —
  // read every word of this comment before touching this line again):
  //
  // Round 1 tried `useActiveWallet()` (`activeOuroAccountId`) as a middle
  // tier — WRONG, that's a separate "★ Selected / active owner for
  // operations" concept (Transfer/CFM default sender), not the permanent
  // CodexPrime identity. Removed.
  //
  // Round 2 landed on `isPrime ?? allAccounts[0]` for BOTH accounts and
  // seeds, reasoning it mirrored `OuronetAccountsTab.tsx`/`SeedWordsTab.tsx`'s
  // own resilience pattern — STILL WRONG for accounts specifically, and
  // the owner's real data proved it again (same "Initial Seed" shown,
  // zero change). The mistake: `OuronetAccountsTab.tsx`'s CodexPrime badge
  // for STANDARD accounts (line ~500-503) NEVER consults `isPrime` AT ALL —
  // `isFirst = index === 0` is the WHOLE rule, full stop, specifically
  // because `isPrime` can be (and evidently is, on this real imported/
  // migrated codex) stamped on an account that ISN'T the one the codex's
  // own canonical display treats as CodexPrime. Checking `isPrime` first,
  // as round 2 did, could pick a DIFFERENT account than index 0 whenever
  // that stray stamp exists — exactly the owner's real-data case. Fixed:
  // accounts are now PURE positional, no `isPrime` check, matching
  // `OuronetAccountsTab.tsx` exactly.
  //
  // Seeds are different: `SeedWordsTab.tsx` (line 538) uses `seed.isPrime
  // === true || index === 0` — `isPrime` DOES participate for seeds, so
  // `currentPrimeSeed` keeps the `isPrime ?? positional` fallback.
  const currentPrimeSeed = allSeeds.find((s) => s.isPrime) ?? allSeeds[0] ?? null;
  // ArWeave seeds for the Codex Master Seed section. Read through the
  // NON-throwing store handle and defaulted to [], matching this file's own
  // "degrade honestly, never throw" convention — `e4-panel-codex-id-
  // extraction.test.tsx` mounts this page with no provider at all, and the
  // section's job is to NAME a missing face, not to crash over one.
  const arweaveSeedsForSection = useCodexStoreOptional()?.getState().arweaveSeeds ?? [];

  const currentPrimeAccount = allAccounts[0] ?? null;

  // `legacy-prime-migration-wizard` T9 — the real store handle
  // `ensurePrimeArweaveSeed` below reads/writes `arweaveSeeds` through.
  // `useCodexStoreOptional()` never throws absent a `<CodexProvider>`
  // ancestor (unlike `useCodexAuth()`/the throwing `useCodexStore()`),
  // matching this file's own "degrade honestly, never throw" convention —
  // see `e4-panel-codex-id-extraction.test.tsx`, which mounts this page
  // with no provider in the tree at all.
  const codexStore = useCodexStoreOptional();

  // `migration-pending-apply` T3 — the recorded migration the step-2 card's
  // two new states are driven by. Read through that SAME non-throwing handle
  // in SELECTOR form (so the card re-renders the instant Apply seals), which
  // is exactly how `PendingKeyChangesSection` already reads this field — not
  // a second data path, and not `getState()`, which would not subscribe.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const migrationProgress = codexStore ? codexStore((s) => s.migrationProgress) : undefined;

  // Owner correction (this session): "when clicking the Make eligible
  // button, the system [should] ask for the password, to unlock the
  // codex, if its locked similarly to when youre executing a transaction,
  // not asking for the password within [the wizard]." A prior attempt
  // built a bespoke in-wizard unlock step — wrong call: this exact
  // "pop the REAL global password prompt if locked, then proceed" gate
  // already exists and is already the app's own established convention —
  // `useEnsureCodexUnlocked`/`useEnsureCodexUnlockedOptional`
  // (`@ancientpantheon/codex-ouronet/zbom`), the SAME hook every ZBOM
  // transaction modal (Rotate Guard, Activate Account, Send, Stake, …)
  // already calls before signing. Reusing it here — not a second,
  // parallel unlock mechanism — means the owner sees the exact same
  // password-prompt UI/UX for "Make Codex Eligible" as for a transaction,
  // because it IS the same prompt. The `Optional` variant degrades to
  // `null` (treated as "no gate available, proceed") when there's no
  // `<CodexProvider>` ancestor — this page's own established "degrade
  // honestly, never throw" convention (see `codexStore` above).
  const ensureCodexUnlocked = useEnsureCodexUnlockedOptional();

  /**
   * `legacy-prime-migration-wizard` T9 — the REAL capability handed to
   * `LegacyPrimeMigrationWizard`'s `ensurePrimeArweaveSeed` prop (see this
   * module's own header comment for the full "why", including why the V2
   * envelope is reimplemented locally). Mirrors `apps/codex-playground/src/
   * kickstartPrimeArweaveSeed.ts`'s own derive-then-persist shape
   * (`secret = encryptStringV2(bits, password)`, `wordsSecret =
   * encryptStringV2(words, password)`, `isPrime: true`), adapted to run
   * from INSIDE the wizard's finalize flow instead of at kickstart time,
   * plus the reconciliation `design.md`'s "Page 7" section calls for:
   *   - an existing Arweave Seed that already decrypts to these exact
   *     words/bitstring → NO new seed row; its `id` is what the derived
   *     accounts are addressed under (T2 — this used to "resolve
   *     immediately", which is the bug described below);
   *   - one that exists but decrypts to something else (or fails to
   *     decrypt at all) → a NEW seed is added from these words, the
   *     mismatched one is never overwritten/deleted;
   *   - none at all → a fresh seed is created and installed as Prime.
   * REVISED (`arweave-master-accounts` T2) — it used to `await
   * deriveArweaveSeedAtPositionZero(...)` purely as a derivability PROBE and
   * throw the returned `SeededKey` away, writing only the seed ROW. An
   * Arweave ACCOUNT is a `ForeignKeyEntry` addressed by `(seedId, index)`, so
   * that left every migrated codex with an Arweave seed and ZERO Arweave
   * accounts — a full RSA-4096 derivation run as pure proof-of-work — while
   * the wizard declared the codex eligible and the Settling Dashboard's
   * violet ticker (reading the real end state) stayed dark. See
   * `docs/work/arweave-master-accounts/design.md`. It now:
   *   - resolves the seed by DECRYPTED BITSTRING across ALL `arweaveSeeds`,
   *     not just the `isPrime`-flagged one — the same rule the eligibility
   *     predicate (`codexHoldsMasterArweaveAccounts`) matches on, so the two
   *     can never disagree about which seed is "the master's";
   *   - derives every position in `missingIndexes` (default `[0, 1]`, the two
   *     master positions eligibility is defined on) in ONE batch;
   *   - PERSISTS each delivered key as it arrives, through the very same
   *     composition `ArweavePanel`'s own `persistKey` uses
   *     (`generateArweaveKey` → `addForeignKey` with `seedId`/`index`);
   *   - reports real progress from the batch's own `onKey`/`onBatchProgress`
   *     events (each RSA-4096 key costs seconds — never a timer);
   *   - REJECTS when the batch delivers none of the requested positions,
   *     rather than leaving behind the seed-with-no-accounts state above.
   *
   * Pre-existing seeds and their keys are never rewritten or deleted: they
   * are real keys that may hold permanently-stored data, and eligibility
   * needs the master's accounts to EXIST, not to be the only ones.
   */
  const ensurePrimeArweaveSeed = useCallback(
    async (
      { bitString, words }: { bitString: string; words?: readonly string[] },
      opts?: {
        /** Which of the master positions are missing. Defaults to BOTH, so
         *  the existing one-argument call sites keep working unchanged; a
         *  caller that already evaluated the eligibility predicate passes
         *  just the positions it found absent (e.g. `[1]`). */
        missingIndexes?: readonly number[];
        /** Driven by the batch's own events — `delivered` counts keys
         *  actually stored, `index` names the position in flight, and
         *  `search` (present only while a prime search is RUNNING) carries
         *  the library's own live detail. See
         *  {@link EnsurePrimeArweaveSeedProgress}. */
        onProgress?: (p: EnsurePrimeArweaveSeedProgress) => void;
      },
    ): Promise<void> => {
      if (!codexStore) {
        throw new Error(
          "ensurePrimeArweaveSeed: no codex store is available — this page must be mounted inside a <CodexProvider>.",
        );
      }
      // Captured as a `const` so the narrowing below survives into the
      // per-key callbacks (a destructured prop binding's narrowing does not).
      const panelDeps = deps;
      if (!panelDeps) {
        throw new Error(
          "ensurePrimeArweaveSeed: no Arweave panel deps are wired for this host.",
        );
      }
      const workerFactory = panelDeps.workerFactory;
      if (!workerFactory) {
        throw new Error(
          "ensurePrimeArweaveSeed: no Arweave keygen worker factory is wired for this host.",
        );
      }

      // Deduplicated, ascending, and NOT run through `planIndexRanges`: that
      // planner folds #0 into every selection by construction, which is
      // wrong here — a codex already holding #0 must derive #1 ALONE.
      const wanted = [...new Set(opts?.missingIndexes ?? MASTER_ARWEAVE_POSITIONS)]
        .filter((index) => Number.isInteger(index) && index >= 0)
        .sort((a, b) => a - b);
      // Nothing missing: write NOTHING. Creating a seed row here and
      // deriving nothing under it is precisely the broken end state this
      // task exists to remove.
      if (wanted.length === 0) return;

      const state = codexStore.getState();
      const password = state.actions.getPassword();

      // The seed whose decrypted bitstring IS the master's — any seed, not
      // only the prime-flagged one. A seed that fails to decrypt is skipped,
      // never fatal (same discipline as `resolveArweaveMatchSeedId`).
      let matchedSeedId: string | null = null;
      for (const seed of state.arweaveSeeds) {
        try {
          if ((await decryptStringV2Compatible(seed.secret, password)) === bitString) {
            matchedSeedId = seed.id;
            break;
          }
        } catch {
          // Not readable under this password / not a V2 envelope — not a match.
        }
      }
      const hasPrimeSeed = state.arweaveSeeds.some((seed) => seed.isPrime === true);

      /**
       * The seed row every persisted key references as its `seedId`. Resolved
       * ONCE and LAZILY — lazily because a derivation that delivers nothing
       * must leave the codex untouched rather than add an account-less seed,
       * and once because two keys arriving in quick succession must not race
       * two `addArweaveSeed` calls into two rows for one bitstring.
       */
      let seedIdOnce: Promise<string> | null =
        matchedSeedId === null ? null : Promise.resolve(matchedSeedId);
      const resolveSeedId = (): Promise<string> => {
        seedIdOnce ??= (async () => {
          const id = `arweave-seed-prime-${crypto.randomUUID()}`;
          const secret = await encryptStringV2Compatible(bitString, password);
          const wordsSecret =
            words !== undefined && words.length > 0
              ? await encryptStringV2Compatible(words.join(" "), password)
              : undefined;
          await state.actions.addArweaveSeed({
            id,
            // NO `name`. The golden designation ("Master ArWeave Seed") is
            // DERIVED from `codexMasterSeed.arweaveSeedId` at render time
            // (`resolveMasterArweaveSeed` → `ArweaveSeedsArea`'s master row),
            // never stored on the entity — see `docs/work/
            // prime-two-name-model/design.md`. This line used to write
            // `name: PRIME_SEED_LABEL`, which destroyed the row's own name
            // field for a seed the user can never rename (there is no rename
            // UI for Arweave seeds), and let a stored title drift away from
            // the id that actually decides the role: the owner reproduced TWO
            // rows both reading "Master ArWeave Seed". A seed this function
            // creates has no user-chosen name yet, so `name` stays unset and
            // the row renders its designation alone.
            secret,
            wordsSecret,
            createdAt: new Date().toISOString(),
            // `addArweaveSeed` throws on a SECOND explicit prime, and
            // auto-flags the first seed a codex ever gets anyway.
            ...(hasPrimeSeed ? {} : { isPrime: true }),
          });
          // ── the DEMOTION (`former-master-record` T2) ──
          //
          // NOTHING is written to the seed this one displaces. The demotion
          // used to find that seed by `seed.name === "Master ArWeave Seed"`
          // and overwrite its `name` with a generic "Arweave Seed N" — live
          // data loss (there is no rename UI for Arweave seeds to put the name
          // back), and a predicate that, now the designation is never stored,
          // would match nothing and make the demotion an undetectable no-op.
          //
          // Demotion is now purely the master ID MOVING: this one write stamps
          // the created seed as the codex's master ArWeave seed, and
          // `setCodexMasterSeed` appends the OUTGOING id to
          // `codexMasterSeed.formerArweaveSeedIds` by itself (append-only,
          // de-duplicated, nothing recorded on a first-ever settlement). From
          // those ids both designations are DERIVED at render time —
          // `MASTER_ARWEAVE_SEED` for `arweaveSeedId`,
          // `FORMER_MASTER_ARWEAVE_SEED` for the history — so the displaced
          // seed keeps its own stored name and still reads as what it was.
          //
          // Ordering: this runs AFTER `addArweaveSeed` above, so a failed add
          // leaves the codex untouched rather than pointing the master id at a
          // row that does not exist.
          //
          // NON-FATAL, and reported — the same discipline (and the same
          // reason) as `LegacyPrimeMigrationWizard`'s own Write 4b, which
          // stamps this very field at the end of a finalize: the action MERGES
          // and THROWS when the merged row cannot name both mandatory faces,
          // so on a codex whose master row was never written this throws. An
          // RSA-4096 derivation that cost minutes must not be lost to a
          // bookkeeping stamp, and a stamp that silently vanished would leave
          // the seeds list colouring by the stale `isPrime` flag with nothing
          // to explain why.
          //
          // `isPrime` is a SEPARATE marker — "the FIRST seed ever added",
          // enforced by `addArweaveSeed` itself — and is deliberately never
          // relocated; do not conflate the two.
          try {
            await state.actions.setCodexMasterSeed({ arweaveSeedId: id });
            // Best-effort commit record, into the `arweaveSeedId` field
            // `MigrationCommitRecord` already declares for exactly this, so a
            // resumed commit can see what landed. No-ops when no migration is
            // in progress.
            void state.actions.recordMigrationCommit({ arweaveSeedId: id }).catch(() => {});
          } catch (e) {
            // eslint-disable-next-line no-console
            console.error(
              "[CodexIdPage] ensurePrimeArweaveSeed: the Codex Master Seed row's Arweave seed id " +
                "did not land — this codex's Arweave seed list may keep ordering and colouring by " +
                "`isPrime`, and the seed it displaced will not read as a former master",
              e,
            );
          }
          return id;
        })();
        return seedIdOnce;
      };

      // The never-clobber guard, applied to EVERY index: the library
      // force-generates #0 on every call whatever `ranges` says
      // (`planIndexRanges.ts`'s header, `rsa4096/ranges.js`'s `new
      // Set([0])`), so storing blindly would overwrite a key the codex
      // already holds at #0. Doubles as the "store each position once" guard.
      const pending = new Set(wanted);
      const total = wanted.length;
      let delivered = 0;
      const persists: Promise<void>[] = [];

      // Per-(index,stage) HIGH-WATER MARKS plus the running grand total the
      // consumer's status line shows. Scoped to THIS invocation — never module
      // level — so two derivations can never bleed counts into each other, and
      // a second call starts from zero exactly like the first.
      const attemptsSeen = new Map<string, number>();
      let grandAttempts = 0;

      const result = await runSeededBatch({
        bits: bitString,
        ranges: wanted.map((index) => ({ start: index, end: index })),
        workerFactory,
        onBatchProgress: (ev) => {
          // The position being SEARCHED, straight from the library's own
          // per-draw event — at ~6.7 s/key this is the only thing that can
          // move a progress line before the first key lands.
          //
          // The filter runs FIRST, so a draw for a position this call never
          // asked for is dropped WHOLE: it reaches neither `onProgress` nor
          // `grandAttempts`. The library force-generates #0 on every call
          // whatever `ranges` says (`rsa4096/ranges.js`'s `new Set([0])`), and
          // crediting the shown positions with a search they did not run would
          // make the "total" figure describe work the user is not waiting for.
          if (!pending.has(ev.index)) return;

          // ── WHY THIS IS NOT `grandAttempts += ev.attempts` ──
          // The library RESTATES the attempt count for the search currently in
          // flight (…5, 9, 12…), it does not emit a delta. Summing the raw
          // events would therefore count every draw once per subsequent event
          // and over-report the run's candidate searches by orders of
          // magnitude. Keeping the LATEST count per (index,stage) and adding
          // only its increase gives the true total in O(1) — the identical
          // treatment `ArweaveSeedsArea`'s own run does, and the Crypto Lab
          // before it. Do not "simplify" this back into a sum.
          const key = `${ev.index}:${ev.stage}`;
          const seen = attemptsSeen.get(key) ?? 0;
          grandAttempts += ev.attempts - seen;
          attemptsSeen.set(key, ev.attempts);

          opts?.onProgress?.({
            index: ev.index,
            delivered,
            total,
            search: {
              position: ev.completedCount + 1,
              totalCount: ev.totalCount,
              stage: ev.stage,
              attempts: ev.attempts,
              grandAttempts,
              percent: Math.round(ev.overallProgress * 100),
            },
          });
        },
        onKey: (key) => {
          if (!pending.has(key.index)) return;
          pending.delete(key.index);
          delivered += 1;
          // NO `search` here, deliberately: a delivered key is not a search in
          // flight. Its absence is exactly how the consumer tells the two
          // apart (`RunProgress` renders its line only while
          // `search !== undefined && status === "running"`), so filling it in
          // with the last known values would leave a finished search frozen
          // on screen.
          opts?.onProgress?.({ index: key.index, delivered, total });
          // Persisted AS IT ARRIVES (never batched to the terminal) via the
          // exact composition `ArweavePanel`'s `persistKey` uses. The promise
          // is collected so the whole call only resolves once every key is
          // genuinely written — a key that failed to store must fail this.
          persists.push(
            (async () => {
              const seedId = await resolveSeedId();
              const encrypted = await panelDeps.generateArweaveKey({
                jwk: key.jwk,
                label: `#${key.index}`,
              });
              const entry: ForeignKeyEntry = {
                ...encrypted,
                seedId,
                index: key.index,
                address: key.address,
              };
              await panelDeps.addForeignKey(entry);
            })(),
          );
        },
      }).catch(async (cause: unknown) => {
        // Never leave an in-flight key write dangling (and unhandled) behind
        // a failed batch — the keys that DID arrive are already stored.
        await Promise.allSettled(persists);
        throw cause;
      });

      await Promise.all(persists);

      if (delivered === 0) {
        throw new Error(
          "ensurePrimeArweaveSeed: the seeded derivation delivered no keys for positions " +
            `${wanted.join(", ")} (delivered=${result.delivered}, cancelled=${result.cancelled}) — ` +
            "no Arweave seed or account was written.",
        );
      }
    },
    [codexStore, deps],
  );

  // `codex-id-step-flow`: wraps `deps.backupCodex` only to record a local
  // "last backup succeeded" timestamp for Step 3's own status line —
  // forwards to the real closure unmodified, same arguments, same result,
  // same thrown errors. `CodexBackupArea` itself is untouched.
  const trackedBackupCodex = useCallback(
    async (exportJson: string) => {
      const result = await deps!.backupCodex(exportJson);
      setLastBackupAt(new Date().toISOString());
      return result;
    },
    [deps],
  );

  /**
   * The ONE gated way into `LegacyPrimeMigrationWizard`, shared by step 2's
   * two launchers — "Make Codex Permaweb Eligible" (no plan yet) and
   * "Retry the Eligibility Wizard" (a plan is waiting). Extracted by
   * `migration-pending-apply` T3 so the second launcher goes through the
   * SAME gate rather than a copy of it.
   *
   * The gate is `useEnsureCodexUnlockedOptional()` — see its declaration
   * above for why this page reuses the app's real password prompt rather
   * than building one. `null` means no `<CodexProvider>` ancestor exists, so
   * there is nothing to unlock: proceed, the established "no provider, no
   * gate" convention every other caller of this hook follows.
   */
  const openMigrationWizard = useCallback(() => {
    void (async () => {
      const unlocked = ensureCodexUnlocked ? await ensureCodexUnlocked() : true;
      if (unlocked) setLegacyPrimeMigrationWizardOpen(true);
    })();
  }, [ensureCodexUnlocked]);

  /**
   * `migration-pending-apply` T3 — the Apply popup's Seal action. Calls T1's
   * real `sealMigration()` (which stamps `primeAlignment: "aligned"` through
   * the single writer and marks the row applied), then closes.
   *
   * Offered ONLY when there is genuinely nothing to execute — see the popup.
   * A failure keeps the popup OPEN and shows the real message: a popup that
   * closed on a failed seal would tell the owner his codex was sealed when it
   * was not, over a write that is permanent when it does land.
   */
  const sealMigrationNow = useCallback(() => {
    void (async () => {
      setSealError(null);
      const actions = codexStore?.getState().actions;
      if (!actions) {
        setSealError("Seal failed: no codex store is available on this page.");
        return;
      }
      try {
        await actions.sealMigration();
        setApplyMigrationOpen(false);
      } catch (cause) {
        setSealError(
          `Seal failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      }
    })();
  }, [codexStore]);

  // `codex-id-step-flow`: the 3-step gating chain — each step only reaches
  // "enabled" once every step before it is done. Step 1 has no
  // precondition (always enabled); Step 2 needs Step 1; Step 3 needs both.
  const step1Done = !needsStructuralUpgrade;
  const step2Done = isEligible;
  const step2Enabled = step1Done;
  const step3Enabled = step1Done && step2Done;

  /**
   * `migration-pending-apply` T3 — step 2's two NEW states.
   *
   * PRECEDENCE, deliberately (read before reordering these): `sealed` and
   * `pending` are RECORDED FACTS about a finalize that already ran, so they
   * win over `step2Done`/`isEligible`, which comes SOLELY from the injected
   * async `checkArweaveRestoreEligibility()` and reads TRUE on every
   * just-finalized codex. Checking eligibility first would render the locked
   * "✓ Permaweb Eligible" note over a plan that was never applied, leaving
   * no Apply button anywhere — i.e. the owner could never seal, which is the
   * whole point of this topic. `hasMigrationPending` already excludes sealed
   * rows (a sealed row deliberately KEEPS its plan as the record of what was
   * applied), so the two flags are mutually exclusive by construction.
   *
   * The step-1 gate (`step2Enabled`) is deliberately NOT consulted for
   * either: it exists to stop an unsafe migration being STARTED, and hiding
   * an already-recorded plan behind a disabled button would strand it.
   */
  const migrationSealed = isMigrationSealed(migrationProgress);
  const migrationPending = hasMigrationPending(migrationProgress);

  /**
   * What Apply would actually have to execute — computed with the EXISTING
   * stage-3A function (the one `PendingKeyChangesSection` below already
   * uses), never a second implementation, so the popup and that card cannot
   * disagree about what is outstanding. The master account is the same
   * positional `accounts[0]` both of them resolve.
   */
  const outstanding = computeOutstandingKeyChanges(migrationProgress, currentPrimeAccount);

  /**
   * `computeOutstandingKeyChanges` deliberately SKIPS both `update-keyset-*`
   * guard kinds (`outstandingKeyChanges.ts:58-71`) — correctly, because it
   * answers the narrower question "which key ROTATIONS are outstanding", and
   * updating a keyset's own definition is not a rotation of an account's
   * guard. But it IS a transaction: a `define-keyset` against the referenced
   * keyset (owner, this session) — and since `migration-execute-keyset` it is
   * an EXECUTABLE step of the chain, emitted in G's slot by
   * `codex-core/src/codex/migrationChain.ts:629-650`. Recorded-but-not-yet-sent
   * is still outstanding WORK, so this derivation is unchanged and the popup
   * must still say so; only the REASON moved, from "this app cannot send it"
   * to "this app has not sent it yet". `outstandingKeyChanges.ts:83-95`'s skip
   * remains right for the narrower question it answers.
   */
  const guardKind = migrationProgress?.selection?.guard?.kind;
  const keysetDefinitionChosen =
    guardKind === "update-keyset-recommended" || guardKind === "update-keyset-custom";

  /**
   * THE seal-blocking condition, derived ONCE. Both things this popup decides
   * — which branch it shows, and whether Seal is offered — read this single
   * value, so it cannot say "needs transactions" in one place while offering
   * the permanent Seal in another. Sealing over un-executed work is exactly
   * the mistake worth a derived name.
   */
  const applyHasOutstandingWork = !outstanding.none || keysetDefinitionChosen;

  /**
   * `migration-execute-keyset` T7. This paragraph used to end "…which is not
   * wired up in this app yet, so it cannot be sent from here." That is now
   * false: design §2 made the keyset update a real step, the planner emits it
   * (`migrationChain.ts:629-650`), `zbom/execute/defineKeysetOps.ts` builds
   * it, the engine submits it and `KeysetUpdateGate` resolves its signers
   * before the press.
   *
   * It is NOT replaced with "it will work", which would be the same mistake
   * pointing the other way. The honest shape is four facts, and all four are
   * stated because each one changes what the owner does next:
   *
   *  1. it IS sent from here, by the same press as the rest, and it goes last
   *     (G's slot — `migrationChain.ts:629-650`; G itself is suppressed for
   *     these two selections, so this is the final transaction of the run);
   *  2. it can only be satisfied by the keyset's CURRENT keys, so an
   *     unreachable predicate makes the chain refuse BEFORE anything is sent,
   *     with design §3's two resolutions — supply, or forfeit. A forfeit is
   *     legitimate: everything else still runs;
   *  3. it is the one step the Ouronet gas station cannot sponsor
   *     (`01_DALOS.pact:456-526` accepts only `coin.C_`/TALOS/DSP shapes), so
   *     it spends STOA on gas from the account's payment key;
   *  4. a keyset in a protocol-guarded namespace
   *     (`stoa-genesis-1.pact:110-113`) may still be refused on chain, which
   *     is REPORTED and never a halt.
   *
   * On (3), note the deliberate asymmetry with
   * `KEYSET_UPDATE_NO_REF_REASON`'s instruction not to mention gas in the
   * user-facing REASON strings: those are read AFTER the chain ran, when gas
   * is not what is standing in the owner's way. This is read BEFORE the
   * press, where "fund the payment key with STOA" is an action they can still
   * take — so here it belongs.
   *
   * Everything structural stays: the testid, the <code>define-keyset</code>
   * literal, and the fact that this is still the SEAL surface. The pointer to
   * the executor ("Execute all remaining transactions" on the stage-3A card)
   * is stated ONCE, in the needs-transactions paragraph that renders directly
   * above this one — deliberately not restated here, so the control's label
   * is transcribed in exactly one place in this file.
   */
  const applyKeysetNote = keysetDefinitionChosen ? (
    <p data-testid="codex-apply-migration-keyset-note" style={APPLY_NOTE_STYLE}>
      Your guard choice was to update the referenced keyset&apos;s own definition.
      That needs its own transaction — a <code>define-keyset</code> against that
      keyset — and it is sent from here, by the same single press as everything
      else, going last so that keyset is still signed by the keys it holds today.
      It can only be signed by that keyset&apos;s current keys: if this codex
      cannot reach the keyset&apos;s predicate, the chain refuses before it starts
      anything and offers you two ways on — supply the missing private keys
      before you press, or forfeit the update and let the rest of the migration
      run with the keyset left exactly as it is. Unlike every other step, the
      Ouronet gas station cannot pay for this one, so it spends STOA on gas from
      your account&apos;s payment key. And a keyset inside a protocol-guarded
      namespace (ouronet-ns, stoa-ns) may still be refused on chain; if that
      happens it is reported rather than fatal, and every other step still runs.
      Until it is sent, the choice stays recorded in your pending plan.
    </p>
  ) : null;

  return (
    <div data-testid="arweave-codex-id-page" style={CODEX_ID_PAGE_STYLE}>
      {/* `codex-id-step-flow` (owner, this session): the standalone
          "Not yet eligible." status bar was redundant with the step row
          below — the steps themselves already show the same information,
          per-step, with an explanation of what's blocking each one. The
          live eligibility CHECK itself (the `codexIdEligibility` state
          above) is unaffected — only this separate, duplicate status
          display is removed. `ArweaveRestoreEligibilityStatus` is still
          used elsewhere (the Library tab) — untouched there. */}
      <div
        data-testid="codex-id-steps-row"
        style={codexIdStepsRowStyle(isMobile)}
      >
        {/* Step 1 — Version. Always enabled, no precondition. */}
        <div data-testid="codex-id-step-1" style={codexIdStepCardStyle(isMobile)}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <StepNumberBadge n={1} done={step1Done} />
            <span style={{ fontSize: 13, fontWeight: 700, color: "#d2d3d4" }}>
              Version your codex
            </span>
          </div>
          {step1Done ? (
            <div
              data-testid="codex-id-structural-upgrade-up-to-date"
              role="status"
              style={DONE_STEP_STYLE}
            >
              ✓ Versioned — {shapeLabel}
            </div>
          ) : (
            <button
              type="button"
              data-testid="codex-id-structural-upgrade-open"
              title="Upgrade Codex Now — opens the structural upgrade wizard"
              onClick={() => setStructuralUpgradeWizardOpen(true)}
              style={ENABLED_PRIMARY_BUTTON_STYLE}
            >
              Upgrade Codex Now
            </button>
          )}
          <p style={CODEX_ID_ACTION_EXPLANATION_STYLE}>
            Current codex shape: {shapeLabel}. Fixes old codex data shapes — e.g.
            legacy seeds whose data wasn&apos;t converted to the current format — so
            they read correctly again.
          </p>
        </div>

        <StepArrow isMobile={isMobile} />

        {/* Step 2 — Permaweb eligibility. Needs Step 1 done first (the real
            backend precondition — see docs/work/codex-versioning/design.md's
            "ordering invariant" — a structurally-unversioned codex is never
            a safe input to the eligibility migration). Renamed from "make
            codex eligible" (owner, this session: "eligible for what?" —
            name the actual thing and explain the concrete benefit, not
            jargon). */}
        <div data-testid="codex-id-step-2" style={codexIdStepCardStyle(isMobile)}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <StepNumberBadge n={2} done={step2Done} />
            <span style={{ fontSize: 13, fontWeight: 700, color: "#d2d3d4" }}>
              Make Permaweb Eligible
            </span>
          </div>
          {/* `migration-pending-apply` T3 — FOUR mutually exclusive states.
              See the `migrationSealed`/`migrationPending` block above for why
              the recorded plan outranks the live eligibility check. */}
          {migrationSealed || (step2Done && !migrationPending) ? (
            <div
              data-testid="arweave-codex-id-already-eligible"
              role="status"
              style={DONE_STEP_STYLE}
            >
              ✓ Permaweb Eligible
            </div>
          ) : migrationPending ? (
            <>
              <button
                type="button"
                data-testid="arweave-codex-id-retry-eligibility"
                title="Retry the Eligibility Wizard — re-runs the migration wizard and REPLACES the pending plan. Nothing is sealed until you press Apply."
                onClick={openMigrationWizard}
                style={RETRY_STEP_BUTTON_STYLE}
              >
                Retry the Eligibility Wizard
              </button>
              <button
                type="button"
                data-testid="arweave-codex-id-apply-migration"
                title="Apply — shows exactly what this pending state would execute on chain, and seals it"
                onClick={() => {
                  setSealError(null);
                  setApplyMigrationOpen(true);
                }}
                style={APPLY_MIGRATION_BUTTON_STYLE}
              >
                Apply
              </button>
            </>
          ) : !step2Enabled ? (
            <button
              type="button"
              disabled
              data-testid="arweave-codex-id-make-eligible"
              title="Make Codex Permaweb Eligible — your codex is not versioned yet. Version it first, then make it eligible."
              style={DISABLED_BUTTON_STYLE}
            >
              Make Codex Permaweb Eligible
            </button>
          ) : (
            <button
              type="button"
              data-testid="arweave-codex-id-make-eligible"
              title="Make Codex Permaweb Eligible — opens the migration wizard"
              // The gated launcher (see `openMigrationWizard` above): pops
              // the real global password prompt if the codex is locked,
              // resolves instantly if it is already unlocked. Shared
              // verbatim with "Retry the Eligibility Wizard".
              onClick={openMigrationWizard}
              style={ENABLED_PRIMARY_BUTTON_STYLE}
            >
              Make Codex Permaweb Eligible
            </button>
          )}
          <p style={CODEX_ID_ACTION_EXPLANATION_STYLE}>
            {migrationSealed
              ? "Applied and sealed. This codex's Prime trio is locked — the " +
                "eligibility wizard cannot be run again."
              : migrationPending
                ? "A finalized plan is waiting. Retry the wizard as many times as " +
                  "you like to replace it — nothing is written until you press " +
                  "Apply, which seals it permanently."
                : !step2Enabled
                  ? "Step 1 (version your codex) must be checked first."
                  : "Making your codex Permaweb eligible unlocks encrypted backup to " +
                    "Arweave and restoring your codex later using just your seed " +
                    "words — nothing to carry or store separately."}
          </p>
        </div>

        <StepArrow isMobile={isMobile} />

        {/* Step 3 — Upload. Needs Steps 1 AND 2 done — the real backend
            (`buildRealPanelDeps`'s `backupCodex`) unconditionally requires
            `eligible`. Repeatable, so its own status is "last backup
            succeeded", not a permanent checkmark. */}
        <div data-testid="codex-id-step-3" style={codexIdStepCardStyle(isMobile)}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <StepNumberBadge n={3} done={lastBackupAt !== null} />
            <span style={{ fontSize: 13, fontWeight: 700, color: "#d2d3d4" }}>
              Upload to Arweave
            </span>
          </div>
          {/* The backup action is real for the default (no-PIN) path —
              `backupCodexToLibrary` (codex-backup-envelope-encryption) is
              fully built. Opens as a real popup (`CodexModalShell`)
              wrapping `CodexBackupArea`, REUSED unmodified — same
              `deps.getExportJson`/`trackedBackupCodex`/`deps.openUrl` seams
              `ArweavePanel`'s own Library-tab mount of it already uses
              (`trackedBackupCodex` only adds the local `lastBackupAt`
              bookkeeping above; it forwards to the real `deps.backupCodex`
              unmodified). PIN-protecting a backup still needs its own
              PIN-entry UI (not built — out of scope here; this only makes
              the plain, default-protected path real). */}
          {deps === null ? (
            <div data-testid="arweave-codex-id-backup-unavailable" style={EMPTY_STYLE}>
              Codex backup is not available until the Arweave upload seam is wired.
            </div>
          ) : step3Enabled ? (
            <button
              type="button"
              data-testid="codex-backup-wizard-open"
              onClick={() => setBackupWizardOpen(true)}
              style={ENABLED_PRIMARY_BUTTON_STYLE}
            >
              Back up codex to Arweave
            </button>
          ) : (
            <button
              type="button"
              disabled
              data-testid="codex-backup-wizard-open"
              title="Back up codex to Arweave — only available once this codex is eligible (see status above)"
              style={DISABLED_BUTTON_STYLE}
            >
              Back up codex to Arweave
            </button>
          )}
          <p style={CODEX_ID_ACTION_EXPLANATION_STYLE}>
            {!step1Done
              ? "Step 1 (version your codex) must be checked first."
              : !step2Done
                ? "Step 2 (make codex eligible) must be checked first."
                : lastBackupAt !== null
                  ? `Last backup: ${new Date(lastBackupAt).toLocaleString()}. Uploads ` +
                    "your whole encrypted codex to Arweave for safekeeping."
                  : "Uploads your whole encrypted codex to Arweave for safekeeping, " +
                    "protected under your Master Seed and/or Codex Identity. PIN " +
                    "protection is not yet available here — this backs up with the " +
                    "default (no-PIN) protection only."}
          </p>
        </div>
      </div>

      {deps !== null && backupWizardOpen ? (
        <CodexModalShell
          title="Back Up Codex to Arweave"
          onClose={() => setBackupWizardOpen(false)}
          accent={INFORMATICS_ACCENT}
          maxWidth={560}
          dialogTestId="codex-backup-wizard-modal"
          closeTestId="codex-backup-wizard-close"
        >
          <CodexBackupArea
            getExportJson={deps.getExportJson}
            backupCodex={trackedBackupCodex}
            openUrl={(id) => deps.openUrl(id, { pool: deps.pool })}
          />
        </CodexModalShell>
      ) : null}

      {/* `migration-pending-apply` T3 — the Apply popup. Same convention as
          the backup wizard above: a boolean `useState` plus an inline
          `CodexModalShell`, never a new modal mechanism. */}
      {applyMigrationOpen ? (
        <CodexModalShell
          title="Apply This Pending State"
          onClose={() => setApplyMigrationOpen(false)}
          accent={INFORMATICS_ACCENT}
          maxWidth={560}
          dialogTestId="codex-apply-migration-modal"
          closeTestId="codex-apply-migration-close"
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {!applyHasOutstandingWork ? (
              <>
                <p data-testid="codex-apply-migration-nothing-to-send" style={APPLY_NOTE_STYLE}>
                  This pending state needs no on-chain transactions. Everything it
                  decided is already in force, so sealing it sends nothing anywhere —
                  it only writes the plan into your codex, permanently.
                </p>
                <p style={APPLY_CAVEAT_STYLE}>
                  Sealing is permanent: your Prime seed, account and Arweave seed are
                  locked afterwards, and the eligibility wizard cannot be run again.
                </p>
                <button
                  type="button"
                  data-testid="codex-apply-migration-seal"
                  onClick={sealMigrationNow}
                  style={ENABLED_PRIMARY_BUTTON_STYLE}
                >
                  Seal this migration
                </button>
              </>
            ) : (
              <>
                <p data-testid="codex-apply-migration-needs-transactions" style={APPLY_NOTE_STYLE}>
                  This pending state needs transactions to be executed before it can be
                  sealed. Send them with &ldquo;Execute all remaining transactions&rdquo;, on
                  the &ldquo;Key changes you chose, not yet on chain&rdquo; card further
                  down this page.{" "}
                  {MIGRATION_RUNS_UNINTERRUPTED_MESSAGE}
                </p>
                {/* The SAME FROM → TO rows the stage-3A card renders — reused,
                    not re-invented, so the two can never describe the same
                    change differently. No launchers here: this popup lists,
                    the card below executes. */}
                <PendingKeyChangesCard changes={outstanding.changes} />
                {applyKeysetNote}
                <p style={APPLY_CAVEAT_STYLE}>
                  Sealing is deliberately not offered while anything is outstanding:
                  it is permanent, and it would lock this codex with the keys you
                  chose never put in force.
                </p>
              </>
            )}
            {sealError !== null ? (
              <p data-testid="codex-apply-migration-error" role="alert" style={APPLY_ERROR_STYLE}>
                {sealError}
              </p>
            ) : null}
          </div>
        </CodexModalShell>
      ) : null}

      <LegacyPrimeMigrationWizard
        open={legacyPrimeMigrationWizardOpen}
        onClose={() => setLegacyPrimeMigrationWizardOpen(false)}
        allSeeds={allSeeds}
        allAccounts={allAccounts}
        currentPrimeSeed={currentPrimeSeed}
        currentPrimeAccount={currentPrimeAccount}
        ensurePrimeArweaveSeed={deps !== null ? ensurePrimeArweaveSeed : undefined}
        // Bug-fix round (`docs/work/wizard-keyset-scale-and-sidebar/`
        // follow-up): this prop was never wired at all, so the guard
        // step's "CURRENT" box could never actually resolve a real
        // on-chain keyset-ref guard — it always fell back to the
        // wizard's own "no chain connection available on this screen"
        // stub, which (once a genuine stale-resolution bug elsewhere was
        // also fixed) correctly shows as "could not be read", never as a
        // silently-resolved flat keyset. `describeKeyset` is the SAME
        // real on-chain `(describe-keyset ...)` read ZBOM's own guard
        // editor already uses — re-exported from `@ancientpantheon/
        // codex-ouronet/zbom` (see that module's own `describeKeyset.ts`
        // doc comment) since this package has no direct dependency on
        // `@ouronet/ouronet-core`. Same `deps !== null` gate every other
        // real-network-dependent prop on this wizard already uses.
        describeKeyset={deps !== null ? describeKeyset : undefined}
      />

      <StructuralUpgradeWizard
        open={structuralUpgradeWizardOpen}
        onClose={() => setStructuralUpgradeWizardOpen(false)}
      />

      {/* Stage 3A — OPTIONAL key changes the user chose that are not yet on
          chain. The section renders nothing at all when there are none, which
          is the case for anyone who kept their existing keys. */}
      <div data-testid="codex-id-stage3a" style={{ marginTop: 16 }}>
        <PendingKeyChangesSection />
      </div>

      <div style={{ marginTop: 16 }}>
        <CodexMasterSeedSection
          row={codexMasterSeed}
          ouroAccounts={allAccounts}
          chainwebSeeds={allSeeds}
          arweaveSeeds={arweaveSeedsForSection}
        />
      </div>

      <div>
        <div role="tablist" aria-label="Codex ID informatics" style={INFORMATICS_TABLIST_STYLE}>
          {INFORMATICS_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={informaticsTab === tab.id}
              data-testid={`codex-id-informatics-tab-${tab.id}`}
              onClick={() => setInformaticsTab(tab.id)}
              style={informaticsTabStyle(informaticsTab === tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div style={{ marginTop: 16 }}>
          {informaticsTab === "backup" ? <CodexBackupInformatics /> : null}
          {informaticsTab === "encryption" ? <CodexEncryptionInformatics /> : null}
          {informaticsTab === "migration" ? <CodexMigrationInformatics /> : null}
        </div>
      </div>
    </div>
  );
}

export default CodexIdPage;
