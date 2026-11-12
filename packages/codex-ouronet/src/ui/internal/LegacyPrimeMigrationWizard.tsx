/**
 * LegacyPrimeMigrationWizard — the Codex ID page's "Make This Codex
 * Eligible" entry point (`legacy-prime-migration-wizard` T3, Wave 1),
 * extended by T4 (Wave 2) with Page 2 ("account").
 *
 * Mirrors `codex-arweave`'s own `UploadWizard.tsx` convention: ONE large
 * component, `CodexModalShell`-wrapped, with its own internal `step` state
 * rather than a router/multi-file page stack — the SAME shape of thing (a
 * multi-page popup wizard), just Ouronet-domain instead of Arweave-domain.
 *
 * `step` is a string union, `"intro" | "account" | "keys"` — T3 only built
 * `"intro"`'s real content; this task (T4) builds `"account"`'s real
 * content and wires "Continue" to actually navigate there. `"keys"` (T5,
 * Wave 3) is still declared only, for that later task to extend this SAME
 * file/type coherently.
 *
 * Page 1 ("intro") reuses `codex-arweave`'s `CodexMigrationInformatics`'s
 * own established prose register for the why/what explanation — this
 * package cannot import that component directly (codex-arweave depends on
 * codex-ouronet, not the other way around, per this package's own
 * dependency direction), so the text below is written fresh, matching its
 * tone, not imported. The lock-in warning block is new, and is stated
 * verbatim — see {@link LOCK_IN_WARNING_TEXT} — per
 * `legacy-prime-migration-wizard/design.md`'s "Page 1 — Why & what"
 * section.
 *
 * Page 2 ("account") — the Prime Ouronet Account identity choice, per
 * `legacy-prime-migration-wizard/design.md`'s "Page 2 — Choose the Prime
 * Ouronet Account" section. **CORRECTED by T6 (Wave 4)** — the original
 * version below filtered candidates by `IStoaChainSeed.seedType ===
 * "stoic"`, a category error (picking Chainweb SEEDS instead of Ouronet
 * ACCOUNTS; confirmed wrong by the owner this session — see
 * {@link computeExistingAccountCandidates}'s own doc comment for the real
 * model). Three choices, all account-based now:
 *   1. Keep the current account — always available. Tagged "Recommended"
 *      iff the CURRENT account's own `originSeedTab === "write-seed"`. When
 *      the current account's `originSeedTab === undefined` (no known
 *      recovery words at all), shows an additional, always-visible warning
 *      ({@link NO_KNOWN_WORDS_WARNING_TEXT}) — keeping it never actually
 *      achieves words-only-restore eligibility, the wizard's whole purpose;
 *      it stays selectable regardless, just honestly labeled.
 *   2. Choose an existing account with a known word origin — a picker over
 *      every OTHER `IOuroAccount` (excluding the current one) whose
 *      `originSeedTab !== undefined` (see
 *      {@link computeExistingAccountCandidates}). Hidden entirely when zero
 *      such candidates exist. Each listed candidate carries its OWN
 *      "Recommended" badge (`originSeedTab === "write-seed"`) or none
 *      (`"12-words"`/`"24-words"` — still a genuine, clickable candidate,
 *      never hidden for being sub-optimal).
 *   3. Type new words — always available. `CreateStoaChainSeedModal.tsx`'s
 *      own "new DALOS words" entry is NOT a separable component (it's
 *      inline JSX inside that file's `isStoic`/`stoicSubMode === "new"`
 *      branch, not its own named component the way `StoicAccountPicker`
 *      is) — so this builds a minimal new `<textarea>` here instead of
 *      importing anything. Tagged "Recommended" iff NEITHER the current
 *      account NOR any option-2 candidate is already `"write-seed"`-origin
 *      — a real gap in the previously-shipped code (it never showed a
 *      badge on option 3 at all), fixed by T6.
 *
 * Selecting any of the three options stores the resolved choice in this
 * component's own `accountChoice` state (which existing account, OR the
 * newly-typed words) — Page 3 (below, same file) reads it directly to
 * build its derivation-method choice. No account activation or other side
 * effect happens here; this is selection UI only.
 *
 * Page 3 ("keys") — the derivation-METHOD choice, per
 * `legacy-prime-migration-wizard/design.md`'s "Page 3 — Choose the payment
 * key + guard key" section (the grounding doc for this page — read it, not
 * just the plan line, when either disagree). **CORRECTED by T6 (Wave 4)**
 * — Page 3 no longer has an "accept the existing keys unchanged" branch at
 * all; the words are NEVER re-chosen here (always exactly whichever words
 * back the Page-2 account), and every reachable path derives keys from
 * those SAME words via one of two methods:
 *   1. **Stoic Dalos Derivation** ({@link STOIC_DALOS_DERIVATION_LABEL}) —
 *      always available, always the default/recommended. Position 0 = the
 *      payment key, position 1 = the guard key, `keys-all` predicate.
 *   2. **Advanced (native format) derivation**
 *      ({@link ADVANCED_NATIVE_DERIVATION_LABEL}) — offered ONLY when the
 *      Page-2-chosen account's own `originSeedTab` is `"12-words"` or
 *      `"24-words"` (dictionary-gated) — entirely ABSENT from the DOM for
 *      a `"write-seed"`-origin account or freshly-typed words (there is no
 *      native dictionary format for arbitrary words to fall back to).
 *      Labeled visibly "Advanced" / "Not recommended". Mirrors
 *      `SeedWordsTab.tsx`'s own `revealPrivateKey`'s
 *      `StoaChainWalletBuilder.createWalletPairFromMnemonic` call for the
 *      equivalent seed type (chainweaver for `"12-words"`, koala for
 *      `"24-words"`) — this task only builds the SELECTION UI for this
 *      option, it never actually calls that derivation (same "selection
 *      only" discipline as every other choice in this file).
 *
 * Full transparency: whichever keys end up in play, the words and
 * derivation path that produced them are shown, never hidden. Display
 * choice (plaintext words vs. a reference), stated and justified: this
 * component only ever holds PLAINTEXT words for the `"new-words"` path
 * (the user just typed them into `accountChoice.words`, still in memory as
 * entered). For `"keep-current"` and `"existing"`, the real words are never
 * available here as plaintext — `IStoaChainSeed.wordsSecret` /
 * `IOuroAccount.secret` are both CIPHERTEXT (`entities.ts`), and this
 * component is never handed a codex password to decrypt them, nor should it
 * be: decrypting sensitive seed material inside a selection-UI step, only to
 * redisplay it for a users who, by definition, already has that already-
 * existing account's words available to them another way (that's what
 * "existing" means), would be re-exposing secret material with no new
 * benefit. So: actual words are shown for `"new-words"`; a plain-language
 * REFERENCE ("your current account's words" / "the selected existing
 * account's words") is shown for `"keep-current"`/`"existing"` — the
 * derivation path (Stoic Dalos or Advanced) is still always named whenever
 * new keys are the active choice, so the PATH is never hidden even when the
 * words themselves are referenced rather than redisplayed.
 *
 * T6 does NOT compute a real `sweepNeeded` — per `design.md`'s own "Page 3"
 * section, that is a genuine COMPARISON against whatever currently
 * controls the chosen account (its existing `guard`), which only
 * `ensurePrimeSeedAccountPairingAndPromote` (a later wave's store action)
 * can determine for real. `sweepNeeded` on this component's own exposed
 * state is therefore always reported `true` — the honest, safe default
 * until that real computation exists — never a `false` this selection-only
 * step cannot actually back up.
 *
 * Inspection seam: an optional `onStateChange` prop, called with the
 * wizard's full `{step, accountChoice, keysChoice, sweepNeeded}` snapshot
 * every time `step`/`accountChoice`/`keysChoice` change.
 *
 * `currentPrimeSeed`/`currentPrimeAccount`/`allSeeds`/`allAccounts` are
 * real codex data Page 2 needs. UPDATED (post-build fix round, Fix 2):
 * `CodexIdPage.tsx` now plumbs these through for real, via its own
 * `useStoaChainSeeds`/`useOuroAccounts` calls (`CreateStoaChainSeedModal.tsx`'s
 * own established seam for this exact data) — the gap Wave 2's own
 * implementer left documented ("CodexIdPage.tsx currently has no
 * useStoaChainSeeds/useOuroAccounts hook access at all") is closed. All
 * four stay optional here, defaulting to empty/`null`, so a caller that
 * supplies nothing (e.g. this file's own tests, which exercise Page 2
 * directly via mock props) keeps working unchanged.
 *
 * Fix 1 (post-build fix round): a `STEP_LABELS`-equivalent ordered array
 * (see {@link STEP_LABELS} below) feeds `CodexModalShell`'s `subtitle` prop
 * with a live "Step N of 3 — <label>" line — mirrors `codex-arweave`'s own
 * `UploadWizard.tsx`'s `STEP_LABELS` convention (there is no existing
 * "Step N of M" primitive in this codebase to reuse verbatim).
 *
 * Fix 3 (post-build fix round): every rendered option on Page 2 and Page 3
 * now carries a small numbered circle badge (see {@link OptionNumberBadge})
 * matching `design.md`'s own numbered-list wording for these same options.
 * Numbers are FIXED per option identity, never renumbered to fill a gap
 * left by a hidden option — e.g. Page 2's "type new words" always reads
 * "3", even when "choose an existing account" (2) is hidden for having no
 * candidates — so the number stays a stable cross-reference back to
 * `design.md`'s own list positions rather than a function of which options
 * happen to render for a given codex.
 *
 * Fix 4 (post-build fix round): Page 2's "type new words" option now shows
 * a live, debounced (300ms) preview of the Ouronet account + both derived
 * keys that typing those words would produce — mirrors OuronetUI's own
 * onboarding seed-input preview MECHANISM/CONTENT (a sibling app, not a
 * dependency of this package; read read-only for reference, nothing
 * imported from it), using the SAME derivation calls this package's own
 * `SpawnAccountModal.tsx` (`createOuronetAccount`/`createDefaultRegistry`)
 * and `CreateStoaChainSeedModal.tsx` (`seedWordsToBitString`,
 * `deriveStoaDalosKeypairAtIndex`) already use — not a second
 * implementation of either pipeline.
 *
 * "Continue" on "intro" now really navigates to "account" (T4 wired this).
 * "Continue" on "account" now really navigates to "keys" (T5) — but only
 * once an account choice has been made (`accountChoice != null`); otherwise
 * it stays a no-op stub (same `console.debug` convention T3/T4 used), since
 * there is nothing yet to build Page 3 from. "Continue" on "keys" now really
 * navigates to "finalize" (THIS task, T8) — once a derivation-method choice
 * has been made (`keysChoice != null`) — and immediately kicks off the real
 * Finalize sequence below; Pages 4-6 (the sweep plan/execution/verify) are
 * a LATER plan's job entirely, per `design.md`'s own "Page 7 — Finalize"
 * section ("Always runs, regardless of which path got here").
 *
 * Page 7 ("finalize") — per `legacy-prime-migration-wizard/design.md`'s
 * "Page 7 — Finalize" section and `plan.md`'s T8. Reaching this step runs
 * {@link runFinalize} (an internal, non-exported function, same discipline
 * as `handleContinue`/`handleBack`), which:
 *   1. Resolves `{accountId, bitString, words, method}` from whichever
 *      Page-2/Page-3 choice is active, via {@link resolveFinalizeDerivation}
 *      — see that function's own doc comment for the real subtlety here:
 *      `"keep-current"`/`"existing"` never held plaintext words anywhere in
 *      this component before now (Page 3's own `KeysWordsBlock` deliberately
 *      never decrypts, per the module doc's "Page 3" section) — Finalize is
 *      the first point a real action (not selection UI) needs them, so it
 *      decrypts here, via the SAME `getPassword()` → `smartDecrypt(account.
 *      secret, password)` seam `SeedWordsTab.tsx`'s own `revealPrivateKey`/
 *      `handleView` already use.
 *   2. Calls the store's `ensurePrimeSeedAccountPairingAndPromote` (T7,
 *      `state/store.ts`) with that resolved triple. If its `sweepNeeded`
 *      comes back `true`, shows {@link SWEEP_NOT_AVAILABLE_TEXT} and STOPS —
 *      no Arweave-seed step, no alignment stamp; this path is a deliberate
 *      dead end until the sweep engine exists, never a silent failure.
 *   3. If `sweepNeeded` is `false`, calls the optional `ensurePrimeArweaveSeed`
 *      prop (see {@link LegacyPrimeMigrationWizardProps.ensurePrimeArweaveSeed}).
 *      Absent, or if it throws, shows an honest "not available" state
 *      INSTEAD of stamping alignment — alignment is never stamped unless
 *      the Arweave-seed step genuinely completed.
 *   4. Otherwise calls the store's `stampPrimeAlignmentAligned()` and shows
 *      a success screen with {@link PRIME_TRIO_LOCKED_REMINDER_TEXT}.
 *
 * Store access is via `useCodexStoreOptional()` (never the throwing
 * `useCodexStore()`) — mirrors `useEnsureCodexUnlockedOptional`'s own
 * documented reasoning (`zbom/hooks/useEnsureCodexUnlocked.ts`): whether a
 * `<CodexProvider>` ancestor exists is fixed for this component's entire
 * mounted lifetime, so conditioning further hook-shaped calls on it is not
 * the "hooks called conditionally" hazard the rule exists to prevent. A
 * `null` store (no provider — e.g. every one of this file's OWN pre-T8
 * tests, which render the wizard directly with no `<CodexProvider>`
 * ancestor at all) degrades Finalize to the same honest "not available"
 * state, never a crash.
 *
 * KNOWN GAP, flagged rather than silently guessed at (T8's own file scope is
 * exactly this file + its test, and fixing this would require either a NEW
 * store primitive or touching `SpawnAccountModal.tsx`'s account-creation
 * path, neither in scope here): `ensurePrimeSeedAccountPairingAndPromote`
 * requires an EXISTING `IOuroAccount` id (per its own doc comment and
 * `design.md`'s "Page 7" algorithm, both written assuming the Page-2
 * account already exists) — but Page 2's `"new-words"` choice never
 * creates one (selection UI only, per the module doc's "Page 2" section).
 * Finalize therefore reports "not available" for `"new-words"` rather than
 * inventing an account id or silently falling back to a different account.
 */

import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createDefaultRegistry, createOuronetAccount } from "@stoachain/stoa-core/dalos";
import { KadenaWalletBuilder as StoaChainWalletBuilder } from "@stoachain/stoa-core/wallet";
import {
  smartDecrypt,
  WrongPasswordError,
  CorruptEnvelopeError,
  UnsupportedFormatError,
} from "@stoachain/stoa-core/crypto";
import { seedWordsToBitString } from "@ouronet/dalos-crypto/gen1";

import { CodexModalShell, modalInput } from "./CodexModalShell.js";
import { OuronetAddressHighlight } from "./OuronetAddressHighlight.js";
import { detectOriginCurve, isExperimentalAccount } from "./originCurve.js";
import { useAccountChainData } from "./useAccountChainData.js";
import { MeasuredHexHighlight } from "./StoaAddressHighlight.js";
import { deriveStoaDalosKeypairAtIndex, validateTypedSeedWords } from "../../wallet/stoaDalosKeygen.js";
import { resolveGuardKeys, keysOf } from "../../guards/resolveGuardKeys.js";
import { resolveMigrationResume } from "./migrationResume.js";
import { isPredAvailable, predGroups } from "../../guards/predicates.js";
import type { GuardKeyResolution } from "../../guards/resolveGuardKeys.js";
import { useCodexStoreOptional } from "../../provider/index.js";
import type { CodexStoreState } from "../../state/store.js";
import type { IOuroAccount, IStoaChainSeed, OuroOriginSeedTab } from "../../types/entities.js";
import { OURONET_CODEX_MASTER, MASTER_CHAINWEB_SEED, MASTER_ARWEAVE_SEED, masterChainwebSeedName, toPersistableAccountSelection, CODEX_MASTER_SEED } from "@ancientpantheon/codex-core";
import type { MigrationSelection, MigrationCommitRecord } from "@ancientpantheon/codex-core";

/** The wizard's own page/step union — `"intro"`, `"account"`, `"payment"`,
 *  `"guard"`, and `"finalize"` (T8, Wave 5 — Page 7) all have real content
 *  now. `"payment"` and `"guard"` were ONE combined step (`"keys"`) until
 *  the owner's correction, this session: *"i said made step 3A and step 3B
 *  as individual steps, not both on the same step 3 page."* They are two
 *  genuinely separate screens now, each with its own Continue gate — see
 *  `continueBlockedReason`/`handleContinue`/`handleBack` below. */
export type LegacyPrimeMigrationWizardStep =
  | "intro"
  | "account"
  | "payment"
  | "guard"
  /** STAGE 1 -> 2 gate: everything chosen, on one screen, before anything is
   *  written. The owner's *"i need to make sure the parts prior to it are
   *  all correct"* — a commit you cannot inspect first is a commit you have
   *  to undo to understand. */
  | "review"
  | "finalize";

/** Page 2's resolved choice — which existing account becomes the Prime
 *  Ouronet Account, or the newly-typed words for a brand-new one. Page 3
 *  (same file) reads this directly to decide which derivation methods are
 *  offered and what the words block displays. **CORRECTED by T6 (Wave
 *  4)**: the `"existing"` variant dropped `seedId` — there is no seed
 *  concept at this step anymore (Page 3/Finalize is what establishes the
 *  seed pairing, per `design.md`'s own "Page 3" section). */
export type LegacyPrimeMigrationAccountChoice =
  | { kind: "keep-current" }
  | { kind: "existing"; accountId: string }
  | { kind: "new-words"; words: string };

/** Page 3's resolved choice — which derivation METHOD produces the payment
 *  key + guard key from the Page-2 words. **CORRECTED by T6 (Wave 4)**:
 *  replaces the earlier `"accept-existing"` / `"new-keys"` framing (there
 *  is no longer an "accept the existing keys unchanged" branch — every
 *  path derives). See the module doc's "Page 3" section for when
 *  `"advanced-native"` is offered. */
/**
 * Page 3, section 1 - what the Ouronet Codex Master's PAYMENT key should be.
 *
 * `"keep"` is offered because the owner asked for it. CORRECTED, this
 * session — the owner's own technical challenge to a prior, overstated
 * version of this comment: eligibility (`checkArweaveRestoreEligibility`)
 * derives ONLY from the Ouronet account's bitstring vs. the stored Prime
 * Arweave address; it reads no payment key, no guard, nothing Chainweb at
 * all. Keeping the payment key does NOT affect eligibility and never did.
 *
 * What it DOES affect is a narrower thing: a kept key is not re-derivable
 * from the seed words alone, so restoring it depends on a codex backup
 * existing and being found/decrypted — not on the words directly. That is
 * exactly why "keep" must LOCK the kept key (`runFinalize`'s Write 3,
 * `currentPaymentKeyOf(allSeeds)` rather than `null` — see that function's
 * own note): the lock is what keeps the key inside the backup that makes
 * it recoverable at all, in place of word-derivation. `"keep"` is still
 * labelled honestly as the one with that extra dependency, same treatment
 * Page 2 gives "keep your current account" — just not mislabelled as
 * breaking eligibility, which it does not.
 */
export type LegacyPrimeMigrationPaymentChoice =
  | { kind: "keep" }
  | { kind: "stoic-dalos-position-0" };

/**
 * Page 3, section 2 - what the Ouronet Codex Master's GUARD should be.
 *
 *  - `"recommended-single-key"`: `keys-all` over the SINGLE position-1 key.
 *    Not a new rule - `ActivateStandardAccountModal.tsx` already builds
 *    exactly this guard in its auto mode.
 *  - `"keep"`: leave the guard exactly as it is, INCLUDING an on-chain
 *    keyset reference. Per the owner's decision this migration never
 *    modifies a namespace keyset; instead the keys it names get locked.
 *  - `"custom"`: any keys the codex holds, any predicate.
 */
/** Mirrors `@ancientpantheon/codex-core`'s `MigrationGuardSelection`
 *  kind-for-kind (`recordSelectionIfComplete` assigns this live choice
 *  straight into a `MigrationSelection.guard` field with no cast, so the
 *  two unions must stay identical) — see that type's own doc comment for
 *  what the three newest kinds mean and why neither
 *  `"update-keyset-recommended"` nor `"update-keyset-custom"` executes
 *  anything on chain yet. */
export type LegacyPrimeMigrationGuardChoice =
  | { kind: "keep" }
  | { kind: "recommended-single-key" }
  | { kind: "custom"; keys: readonly string[]; pred: string }
  | { kind: "update-keyset-recommended" }
  | { kind: "update-keyset-custom"; keys: readonly string[]; pred: string }
  | { kind: "use-existing-keyset"; ns: string; ksn: string; keys: readonly string[]; pred: string };

export type LegacyPrimeMigrationKeysChoice =
  | { kind: "stoic-dalos" }
  | { kind: "advanced-native" };

/** The wizard's full exposed state snapshot — handed to `onStateChange`
 *  (see {@link LegacyPrimeMigrationWizardProps.onStateChange}) every time
 *  any of these change. `sweepNeeded` is always `true` as of T6 (Wave 4) —
 *  see the module doc's "Page 3" section for why this selection-only step
 *  deliberately does not compute the real comparison. */
export interface LegacyPrimeMigrationWizardState {
  step: LegacyPrimeMigrationWizardStep;
  accountChoice: LegacyPrimeMigrationAccountChoice | null;
  keysChoice: LegacyPrimeMigrationKeysChoice | null;
  /** Page 3, section 1. `null` until the user decides. */
  paymentChoice: LegacyPrimeMigrationPaymentChoice | null;
  /** Page 3, section 2. `null` until the user decides. */
  guardChoice: LegacyPrimeMigrationGuardChoice | null;
  sweepNeeded: boolean;
}

export interface LegacyPrimeMigrationWizardProps {
  open: boolean;
  onClose: () => void;
  /** The codex's current Prime Chainweb Seed / Prime Ouronet Account —
   *  shown under option 1 ("keep current") when supplied. Optional/
   *  defaulted (see module doc: the real `CodexIdPage.tsx` wiring is a
   *  documented follow-up). */
  currentPrimeSeed?: IStoaChainSeed | null;
  currentPrimeAccount?: IOuroAccount | null;
  /** Every `IStoaChainSeed` in the codex. Accepted (and still plumbed by
   *  `CodexIdPage.tsx`) for forward-compatibility with a later wave's
   *  Finalize step, but UNUSED by Page 2/3 as of T6 (Wave 4) — option 2's
   *  candidates are account-based now (see
   *  {@link computeExistingAccountCandidates}), not seed-based. */
  allSeeds?: readonly IStoaChainSeed[];
  /** Every `IOuroAccount` in the codex — option 2's candidates (see
   *  {@link computeExistingAccountCandidates}) and Page 3's "is the chosen
   *  account dictionary-gated?" lookup are both filtered out of this list.
   *  Defaults to `[]`. */
  allAccounts?: readonly IOuroAccount[];
  /** Optional inspection seam (T5): called with the wizard's full
   *  `LegacyPrimeMigrationWizardState` snapshot every time `step`,
   *  `accountChoice`, or `keysChoice` (and therefore the derived
   *  `sweepNeeded`) change. No production call site needs this yet — it
   *  exists so tests (and a later page that needs `sweepNeeded`) can read
   *  the wizard's internal state without the component otherwise exposing
   *  it. Never called for `onClose`/render-only changes. */
  onStateChange?: (state: LegacyPrimeMigrationWizardState) => void;
  /** Page 7 ("finalize", T8, Wave 5) — ensures the codex's Prime Arweave
   *  Seed decrypts to these exact words (reusing a matching existing one
   *  unchanged, adding a new one when an existing Prime Arweave Seed's
   *  words differ, or creating one from scratch when none exists — per
   *  `design.md`'s "Page 7" section, point 3). Optional: the REAL
   *  implementation is a documented follow-up (T9) that wires this from
   *  `CodexIdPage.tsx`, mirroring `kickstartPrimeArweaveSeed.ts`'s own
   *  derive-and-install pattern — omitted here (including every one of
   *  this file's OWN tests that don't supply it), Finalize shows the same
   *  honest "not available" state T9 will eventually make real, and NEVER
   *  stamps `primeAlignment: "aligned"` in that case. */
  ensurePrimeArweaveSeed?: (words: { bitString: string; words?: readonly string[] }) => Promise<void>;
  /** Resolve a qualified on-chain keyset name, for unfolding a guard that is
   *  a keyset REFERENCE. Injected (not imported) so this component stays
   *  testable without a chain. When absent, a reference guard renders as
   *  explicitly UNRESOLVED - never as "authorizes no keys", which would be a
   *  different and dangerous claim. */
  describeKeyset?: (qualifiedName: string) => Promise<{ keys: readonly string[]; pred: string }>;
}

const ACCENT = "#ceac5f";

/** Fix 1's `STEP_LABELS`-equivalent. The real navigation sequence is
 *  intro -> account -> payment -> guard -> review -> finalize; every
 *  transition is spelled out explicitly in `handleContinue`/`handleBack`
 *  below, nothing reads this map by array position. `STEP_DISPLAY_NUMBER`
 *  (below) supplies the subtitle's step NUMBER separately, since
 *  `"payment"`/`"guard"` share one conceptual "step 3". */
const STEP_LABELS: Record<LegacyPrimeMigrationWizardStep, string> = {
  intro: "Why & What",
  account: OURONET_CODEX_MASTER,
  payment: "Payment Key Setup",
  guard: "Ouronet Account Guard Setup",
  review: "Review & Commit",
  finalize: "Finalize",
};

/**
 * The subtitle's step NUMBER — distinct from `STEP_ORDER`'s plain index
 * because `"payment"`/`"guard"` are sub-steps of one conceptual "step 3"
 * (the owner's own "Step 3A"/"Step 3B" naming), not two more steps added to
 * the count. `"review"` stays "4" rather than becoming "5" — the overall
 * flow still reads as four stages to the user, the third one just has two
 * screens. `"finalize"` is never looked up here (see the subtitle
 * computation below, which special-cases it, same as before this change). */
const STEP_DISPLAY_NUMBER: Record<Exclude<LegacyPrimeMigrationWizardStep, "finalize">, string> = {
  intro: "1",
  account: "2",
  payment: "3A",
  guard: "3B",
  review: "4",
};

/**
 * The lock-in rule, stated VERBATIM per `legacy-prime-migration-wizard/
 * design.md`'s "Page 1 — Why & what" section — never paraphrased, since a
 * caller may rely on this exact wording (e.g. a future confirmation step
 * quoting it again for consistency).
 */
export const LOCK_IN_WARNING_TEXT =
  `once this completes, your ${OURONET_CODEX_MASTER}, ${MASTER_CHAINWEB_SEED}, and ${MASTER_ARWEAVE_SEED} are locked — permanently.`;

/**
 * Page 7 ("finalize", T8) — stated per `plan.md`'s own T8 task line
 * ("at minimum state plainly...") when `ensurePrimeSeedAccountPairingAndPromote`
 * (T7) reports `sweepNeeded: true`. Exported for the same reason as
 * {@link LOCK_IN_WARNING_TEXT} — a future test/caller asserts against this
 * exact wording rather than re-typing it.
 */
export const SWEEP_NOT_AVAILABLE_TEXT =
  "A fund-moving sweep isn't available yet; nothing has changed, it's safe to close this wizard.";

/**
 * Page 7's success-screen reminder, stated VERBATIM per `plan.md`'s T8 task
 * line ("an explicit 'the Prime trio is now permanently locked' reminder").
 */
export const PRIME_TRIO_LOCKED_REMINDER_TEXT = "the Prime trio is now permanently locked.";

/**
 * Page 7's honest "not available" message for the Prime Arweave Seed step —
 * shown when `ensurePrimeArweaveSeed` is absent, or throws, per `plan.md`'s
 * own T8 task line ("show an honest error/not-available state instead of
 * silently stamping alignment anyway"). The real failure message (when one
 * threw) is shown ALONGSIDE this, not instead of it — see `FinalizeStep`.
 */
export const ARWEAVE_SEED_NOT_AVAILABLE_TEXT =
  `The ${MASTER_ARWEAVE_SEED} step isn't available yet — nothing has been locked in, it's safe to close this wizard and try again later.`;

const introParagraphStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 13,
  lineHeight: 1.6,
  color: "#d2d3d4",
};

/** The irreversibility/"why & what" explanation — matches
 *  `CodexMigrationInformatics`'s own established prose register (plain,
 *  factual, no internal type/function/variable names), plus the new,
 *  clearly-set-apart lock-in warning block. */
function IntroStep(): React.ReactElement {
  return (
    <div
      data-testid="legacy-prime-migration-intro"
      style={{ display: "flex", flexDirection: "column", gap: 14 }}
    >
      <p style={introParagraphStyle}>
        Some codexes aren&apos;t eligible for seed-words-only restore yet. Onboarding has
        always generated a dictionary-gated word phrase (Koala) to create your Chainweb
        keys, and most codexes also derived their Ouronet Account from those exact same
        words. Arweave support came later, so those words were never also used to
        generate an Arweave account at the time — that timing gap, not where the words
        came from, is the real reason an older codex&apos;s words don&apos;t currently
        line up across all three.
      </p>
      <p style={introParagraphStyle}>
        This wizard settles on one single set of seed words — your Master Seed — that
        together generates all three: your Ouronet Account, your Chainweb keys, and your
        Prime Arweave Seed. A Master Seed is what makes full seed-words-only restore
        actually possible: your seed words alone can always regenerate those three from
        scratch, and your Master Seed is also what lets a seed-words-only restore locate
        and decrypt an already-made Arweave backup of everything else your codex has
        additionally accumulated.
      </p>
      <p style={introParagraphStyle}>
        This process is irreversible. Once it completes, there is no going back.
      </p>
      <div
        data-testid="legacy-prime-migration-lockin-warning"
        role="alert"
        style={{
          padding: "12px 14px",
          borderRadius: 10,
          border: "1px solid #8b1a1a40",
          backgroundColor: "#8b1a1a15",
          color: "#f87171",
          fontSize: 13,
          fontWeight: 700,
          lineHeight: 1.6,
        }}
      >
        {LOCK_IN_WARNING_TEXT}
      </div>
    </div>
  );
}

/** Page 2's option-3 ("type new words") warning lines, stated verbatim per
 *  `legacy-prime-migration-wizard/design.md`'s "Page 2" section, point 3 —
 *  exported so a future task/test can assert against the exact same string
 *  without re-typing it. */
export const NEW_ACCOUNT_ACTIVATION_WARNING_TEXT =
  "This creates a new account that must be activated on-chain before use";
export const NEW_ACCOUNT_EMPTY_WARNING_TEXT =
  "This account starts completely empty — no funds, no history.";

/** Page 2's option-1 ("keep current") warning line — shown only when the
 *  current account's own `originSeedTab === undefined` (no known recovery
 *  words on record at all), per `legacy-prime-migration-wizard/design.md`'s
 *  rewritten "Page 2" section's "edge case, flagged for confirmation".
 *  Exported for the same reason as the two warnings above. */
export const NO_KNOWN_WORDS_WARNING_TEXT =
  "Keeping this account will not make seed-words-only restore possible — it has no known recovery words on record.";

// Shared warning-box visuals — one role="alert" box style for all three of
// this file's warning lines (the two option-3 ones above, plus
// `NO_KNOWN_WORDS_WARNING_TEXT`) rather than three copies of the same
// style object.
const warningBoxStyle: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid #8b1a1a40",
  backgroundColor: "#8b1a1a15",
  color: "#f87171",
  fontSize: 11,
  fontWeight: 600,
  lineHeight: 1.5,
};

/** Option 2's one candidate shape — an `IOuroAccount` with a known word
 *  origin (see {@link computeExistingAccountCandidates}). `recommended` is
 *  `true` iff `account.originSeedTab === "write-seed"` (the one
 *  non-dictionary-gated word-based mode — optimal); `false` for
 *  `"12-words"`/`"24-words"` (real, known words, but dictionary-gated —
 *  sub-optimal, still a genuine candidate). */
interface ExistingAccountCandidate {
  account: IOuroAccount;
  recommended: boolean;
  /** `false` when `account.originSeedTab === undefined` — no recorded word
   *  origin. Shown anyway (owner correction, this session: "it should show
   *  the Standard Ouronet Accounts existing in the codex" — ALL of them,
   *  word-origin only decides the RECOMMENDED tag, never list membership),
   *  but flagged so the UI can show the same "no known words" honesty
   *  Option 1 already uses, rather than silently implying it's equivalent
   *  to a known-words candidate. */
  hasKnownWords: boolean;
}

/**
 * T6 fix (Wave 4): REPLACES `computeStoicCandidates`, which filtered
 * `IStoaChainSeed.seedType === "stoic"` — a category error, confirmed wrong
 * by the owner this session. Page 2 picks a Prime **Ouronet Account**, not
 * a Chainweb seed; the two are derived independently (an `IOuroAccount` can
 * be spawned directly, with no paired Chainweb seed at all, via
 * `SpawnAccountModal.tsx`'s 7 derivation modes). The real per-account
 * signal for "was this built from arbitrary, non-dictionary words" is
 * `IOuroAccount.originSeedTab`, stamped at spawn time — see
 * `legacy-prime-migration-wizard/design.md`'s rewritten "Page 2" section.
 *
 * T6 SECOND correction (owner, this session — real screenshot evidence a
 * real codex's Standard accounts were missing entirely): `originSeedTab
 * === undefined` is NO LONGER a listing filter. Many real Standard,
 * DALOS-curve accounts in an imported/migrated codex never had this field
 * stamped at all (same class of legacy-data gap the whole
 * `codex-versioning` project exists to handle) — excluding them entirely
 * made the picker show almost nothing real. "it should show the Standard
 * Ouronet Accounts existing in the codex" (owner, verbatim) — ALL of them.
 * Word-origin now ONLY decides the RECOMMENDED tag
 * (`hasKnownWords && originSeedTab === "write-seed"`); an account with no
 * recorded words still appears, unrecommended, via `hasKnownWords: false`.
 *
 * Two conditions remain real EXCLUSIONS (never shown at all, regardless of
 * word origin):
 *   1. `!account.isSmart` — "Smart ouronet accounts have no place in the
 *      list" (owner, verbatim). Only STANDARD accounts qualify; a Smart
 *      account is a distinct identity derived from/governed by its
 *      Standard counterpart, never itself the Prime Ouronet Account.
 *   2. `!isExperimentalAccount(account)` (i.e. DALOS curve, not APOLLO) —
 *      "Apollo Accounts have no place in the list" (owner, verbatim). The
 *      whole eligibility flow is built on the Stoic Dalos Derivation
 *      pipeline (1600-bit DALOS); APOLLO (1024-bit, "observational" —
 *      see `originCurve.ts`'s own doc comment) is a structurally different,
 *      non-production curve, incompatible with that derivation. Reuses
 *      `detectOriginCurve`'s existing address-prefix-sniffing fallback
 *      (`originCurve.ts`) for accounts that predate the `originCurve`
 *      stamp — not a second implementation of that detection.
 *
 * Returns every account in `allAccounts` meeting both, EXCEPT the one
 * matching `currentAccountId`.
 */
function computeExistingAccountCandidates(
  allAccounts: readonly IOuroAccount[],
  currentAccountId: string | null,
): ExistingAccountCandidate[] {
  const candidates: ExistingAccountCandidate[] = [];
  for (const account of allAccounts) {
    if (account.id === currentAccountId) continue;
    if (account.isSmart) continue;
    if (isExperimentalAccount(account)) continue;
    const hasKnownWords = account.originSeedTab !== undefined;
    candidates.push({
      account,
      hasKnownWords,
      recommended: hasKnownWords && account.originSeedTab === "write-seed",
    });
  }
  return candidates;
}

// Shared radio-style option-box visuals — used by Page 2's ("account")
// three options and, as of this task, Page 3's ("keys") two options. Named
// generically (not "accountOptionStyle") since both pages now reuse the
// exact same visual pattern.
const radioOptionStyle = (selected: boolean): React.CSSProperties => ({
  display: "flex",
  flexDirection: "column",
  gap: 8,
  padding: 14,
  borderRadius: 10,
  border: `1px solid ${selected ? ACCENT : "#262626"}`,
  backgroundColor: selected ? ACCENT + "0f" : "transparent",
});

const radioOptionHeaderButtonStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: 0,
  border: "none",
  background: "none",
  cursor: "pointer",
  textAlign: "left",
  fontSize: 13,
  fontWeight: 700,
  color: "#d2d3d4",
};

/** "Recommended" badge. T6 (Wave 4) fix: previously exactly one of option 1
 *  or option 2 ever carried it (never option 3) — now each of Page 2's
 *  three options, AND each individual option-2 candidate, carries its OWN
 *  badge based on its own `"write-seed"`-origin check (see the module
 *  doc's "Page 2" section); Page 3's Stoic Dalos option carries it too
 *  (always the default/recommended method). */
function RecommendedBadge(): React.ReactElement {
  return (
    <span
      style={{
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 10,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        color: ACCENT,
        backgroundColor: ACCENT + "1a",
        border: `1px solid ${ACCENT}40`,
      }}
    >
      Recommended
    </span>
  );
}

/**
 * Guard step tiering (`docs/work/guard-step-variants/design.md`) — three
 * new badges, deliberately SEPARATE from {@link RecommendedBadge} above
 * (which stays exactly as it was, still used verbatim by the payment
 * step's "derive" option and the derivation-method options): this is new
 * vocabulary specific to the guard step's own two-tier recommendation
 * scheme, not a rename of the existing one. Solid-filled — the strongest
 * visual weight in this file — for the tier the owner called out as the
 * single best option on a keyset-reference account.
 */
function DalosHighlyRecommendedBadge(): React.ReactElement {
  return (
    <span
      style={{
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 10,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        color: "#0a0a0a",
        backgroundColor: ACCENT,
        border: `1px solid ${ACCENT}`,
      }}
    >
      DALOS Highly Recommended
    </span>
  );
}

/** The second tier — same accent-tint/outline treatment
 *  {@link RecommendedBadge} uses, just this screen's own wording so it
 *  reads as one notch below {@link DalosHighlyRecommendedBadge} rather
 *  than equal to it. */
function DalosRecommendedBadge(): React.ReactElement {
  return (
    <span
      style={{
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 10,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        color: ACCENT,
        backgroundColor: ACCENT + "1a",
        border: `1px solid ${ACCENT}40`,
      }}
    >
      DALOS Recommended
    </span>
  );
}

/** The one "muted pill" style shared by every discouraged/secondary tag in
 *  this file — "Not Recommended", "Expert Mode", the capability-guard
 *  fallback's "Advanced", and `PaymentStep`'s own "Advanced (native format)
 *  derivation" option's "Not recommended" tag. Takes its label as children
 *  so a palette/sizing tweak to this look only has one definition to edit
 *  (code review, guard-step-variants: these four were previously four
 *  separate copies of the identical style object, one of them already
 *  drifted on casing). */
function MutedPillBadge({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <span
      style={{
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 10,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        color: "#888",
        backgroundColor: "#ffffff0d",
        border: "1px solid #262626",
      }}
    >
      {children}
    </span>
  );
}

/** Muted, not alarming — "discouraged", not "dangerous" (that register is
 *  reserved for the red warning boxes elsewhere in this file). */
function NotRecommendedBadge(): React.ReactElement {
  return <MutedPillBadge>Not Recommended</MutedPillBadge>;
}

/** Fix 3's visible option numbering — a small numbered circle badge,
 *  mirroring the closest existing precedent for this exact visual shape in
 *  this package (`SpawnAccountModal.tsx`'s own curve/prefix circle badges:
 *  `width/height: 18`, `borderRadius: 9999`, accent-on-accent-tint
 *  coloring) rather than a plain "1." text prefix — this file's own
 *  `RecommendedBadge` already establishes "small accent-colored pill" as
 *  this file's badge idiom, so a circular number badge reads as the same
 *  family of thing, not a new visual language. */
function OptionNumberBadge({ n }: { n: number }): React.ReactElement {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 18,
        height: 18,
        flexShrink: 0,
        borderRadius: 9999,
        fontSize: 10,
        fontWeight: 700,
        color: ACCENT,
        backgroundColor: ACCENT + "20",
        border: `1px solid ${ACCENT}40`,
      }}
    >
      {n}
    </span>
  );
}

const stepParagraphStyle: React.CSSProperties = {
  margin: "0 0 2px 0",
  fontSize: 11,
  lineHeight: 1.5,
  color: "#888",
};

/** Page 2 — the Prime Ouronet Account identity choice (three radio-style
 *  options; see the module doc). Purely a selection UI: choosing any
 *  option only calls `onChoose`, never performs account activation or any
 *  other side effect. */
function AccountStep({
  currentPrimeSeed,
  currentPrimeAccount,
  allAccounts,
  choice,
  onChoose,
  getPassword,
  authenticate,
  passwordEpoch,
}: {
  currentPrimeSeed: IStoaChainSeed | null;
  currentPrimeAccount: IOuroAccount | null;
  allAccounts: readonly IOuroAccount[];
  choice: LegacyPrimeMigrationAccountChoice | null;
  onChoose: (choice: LegacyPrimeMigrationAccountChoice) => void;
  /** Owner correction (this session, real screenshot): "a lot of accounts
   *  are shown with no known words, when in fact the codex can indeed show
   *  me their seed words" — `originSeedTab` metadata is, like `isPrime`,
   *  unreliably stamped on real/imported accounts. OPTIONAL, read-only
   *  decrypt probe (never a mutation — same "view, don't write" discipline
   *  `ViewSeedModal.tsx`/`SeedWordsTab.tsx`'s own reveal flows already use)
   *  for candidates the metadata claims have no words, to confirm the REAL
   *  decrypted content rather than trusting stale metadata. Absent (e.g.
   *  no `<CodexProvider>`) degrades to metadata-only detection — never a
   *  crash, never blocks selection. */
  getPassword?: () => string;
  /** Round 3 owner correction (this session, real screenshot — STILL "No
   *  known words" on everything after round 2's fix landed and was
   *  verified served): a repro test (`getPassword()` called with the codex
   *  NEVER authenticated) proved `getPassword()` throwing `CodexLockedError`
   *  was left UNCAUGHT inside the probe's async body — an unhandled
   *  rejection that silently abandons the probe forever, with zero visible
   *  sign anything went wrong. A real codex's password cache has a TTL
   *  (`uiSettings.passwordCacheMinutes`) that can easily have expired by
   *  the time the owner reaches this step, even though the rest of the app
   *  (which the owner WAS using successfully) still reads as "unlocked" —
   *  exactly like `ViewSeedModal.tsx`'s own `needsPassword` inline-prompt
   *  fallback exists to handle. `authenticate` (optional, same
   *  `actions.authenticate` the wizard's Finalize step already calls)
   *  lets this step offer the SAME inline "enter your password" recovery
   *  instead of failing silently. */
  authenticate?: (password: string) => void;
  /** Round 8: the store's current `passwordCache.expiresAt`, or `null`
   *  when locked. Changes on EVERY fresh `authenticate()` — anywhere in
   *  the app — which is precisely the "the password you hold may now be a
   *  different (hopefully correct) one" signal this step needs to re-arm
   *  previously-failed probes. Carried as a plain value rather than read
   *  from the store here so `AccountStep` stays prop-driven/testable. */
  passwordEpoch?: number | null;
}): React.ReactElement {
  const existingCandidates = useMemo(
    () => computeExistingAccountCandidates(allAccounts, currentPrimeAccount?.id ?? null),
    [allAccounts, currentPrimeAccount],
  );
  const hasExistingCandidates = existingCandidates.length > 0;

  // Round 4 owner correction (this session, real screenshot, rejected the
  // "architectural limitation" explanation twice): "why are accounts like
  // Mnemosyne and Ouronet displaying the red bullet, when they are
  // activated?" — this was previously left as a documented gap (the
  // bullet read only the STORED `account.isActive`, which can lag behind
  // live chain state). Re-reading `OuronetAccountsTab.tsx` found the gap
  // was never actually unfixable: it overlays live state via
  // `useAccountChainData` (`./useAccountChainData.js`), the SAME hook —
  // not a reimplementation — reused here directly. `byAddress[address]`
  // is only populated for DALOS-prefix addresses (the hook's own filter);
  // every candidate reaching this list already passed the DALOS-only gate
  // above, so every candidate here is eligible. Falls back to the stored
  // `account.isActive` ("last known") only while the live read is still
  // loading or failed (node unreachable) — never a crash, never blocks
  // selection, same degrade-honestly discipline as the decrypt probe.
  const candidateAddresses = useMemo(
    () => (currentPrimeAccount ? [currentPrimeAccount.address] : []).concat(
      existingCandidates.map((c) => c.account.address),
    ),
    [existingCandidates, currentPrimeAccount],
  );
  const { byAddress: liveChainByAddress } = useAccountChainData(candidateAddresses);

  // Decrypt-probe override: accounts `computeExistingAccountCandidates`
  // marked `hasKnownWords: false` (no `originSeedTab` metadata) get a
  // real, read-only decrypt attempt — `true` once the secret is CONFIRMED
  // to decrypt to non-empty plaintext. Owner correction (this session,
  // real screenshot round 2): an earlier version of this probe additionally
  // required the plaintext NOT look like a pre-converted DALOS bitstring,
  // reasoning a bitstring secret meant "no words" — that was wrong, caught
  // against real data (most of the owner's real accounts, which DO decrypt
  // to bitstrings, were still shown "No known words"). `ViewSeedModal.tsx` /
  // `DalosSecretReveal.tsx` (the codex's own real "reveal seed words"
  // feature) prove the real rule: `rebuildFullKey` re-derives a FULL key
  // from ANY successfully-decrypted representation — seedWords, bitString,
  // bitmap, integerBase10/49 — and the reveal ALWAYS includes a words/Seed
  // tab regardless of which representation the secret was actually stored
  // as. So "known words" only needs a successful decrypt with non-empty
  // content; the representation inside no longer matters. (`recommended` —
  // dictionary-gated vs. arbitrary — still stays metadata-only below; that
  // distinction genuinely can't be told from decrypted content alone.)
  // Never downgrades a metadata-confirmed `true` — this only adds
  // confidence, never removes it. Keyed by account id so a result survives
  // re-renders without re-decrypting (real PBKDF2 work, not free).
  const [probedHasWords, setProbedHasWords] = useState<Record<string, boolean>>({});
  // Round 6 owner correction (real screenshot — STILL "No known words"
  // across the board, with the owner directly asking "how could you know
  // the OTHER accounts have seed words [via stored metadata, no decrypt
  // needed] if for these ones you can't [decrypt-verify]?"): rather than
  // guess at yet another unverified theory, surface the REAL reason each
  // decrypt attempt failed — `@stoachain/stoa-core/crypto`'s own typed
  // error taxonomy (`WrongPasswordError`/`CorruptEnvelopeError`/
  // `UnsupportedFormatError`, v2.2.0+) already distinguishes exactly this:
  // wrong password (retryable) vs. corrupted data (no password fixes it)
  // vs. an unsupported envelope format. Keyed by account id, same as
  // `probedHasWords`, so the owner (and future debugging) sees HARD
  // evidence instead of another guess.
  const [probeErrors, setProbeErrors] = useState<Record<string, string>>({});
  // Round 7 owner correction: "you can easily detect that yourself, if its
  // not a valid koala or chainweaver seed, then its not dictionary gated,
  // and it should then read recommended."
  //
  // The owner was right and a previous round of mine was WRONG: I claimed
  // "this codebase has no client-side wordlist to check membership
  // against — verified, not assumed" and built a manual "Not
  // dictionary-gated? Mark it" button around that claim. The check has
  // been here the whole time —
  // `KadenaWalletBuilder.isValidMnemonic(mnemonic, seedType?)`
  // (`@stoachain/stoa-core/wallet`, the SAME builder this package already
  // imports in five other files, re-exported here under its
  // `StoaChainWalletBuilder` alias) does exactly the owner's rule: no
  // `seedType` → dispatch on word count, 12 → `kadenaCheckMnemonic`
  // (Chainweaver wordlist + checksum), 24 → BIP39 English wordlist +
  // checksum, anything else → `false`. My earlier search just looked for
  // the wrong symbol names in the wrong packages.
  //
  // `true` here means CONFIRMED-not-dictionary-gated (→ Recommended),
  // decided from the account's REAL decrypted content rather than its
  // `originSeedTab` stamp — which this whole session has shown is
  // unreliable on real imported/migrated accounts. The manual "Mark it"
  // button is gone with it.
  const [probedUngated, setProbedUngated] = useState<Record<string, boolean>>({});
  // Round 3: set when `getPassword()` itself throws (codex locked / cache
  // expired) — distinct from a per-account decrypt failure. Surfaces the
  // inline unlock prompt below instead of failing silently forever.
  // Round 8 owner report — "it worked for a second, then i got out, and
  // tried again, then it shows like this that it doesnt recognise the
  // words". `probeLocked` became `probeNeedsPassword`, which now covers
  // BOTH ways this step can end up without a usable password:
  //
  //   "locked" — `getPassword()` threw (no cache / TTL expired).
  //   "wrong"  — `getPassword()` SUCCEEDED but nothing it decrypts works.
  //              `<PasswordModal>` (codex-ui) documents that it "doesn't
  //              validate the password against an encrypted secret", and
  //              `authenticate()` caches whatever it is handed — so a
  //              typo'd or stale password caches happily, `getPassword()`
  //              returns it without complaint, every decrypt then fails,
  //              and the ONLY symptom is a list that silently claims no
  //              account has any words. That is exactly the owner's
  //              screenshot: no unlock prompt (we weren't "locked"), just
  //              "No known words" on everything.
  const [probeNeedsPassword, setProbeNeedsPassword] = useState<null | "locked" | "wrong">(null);
  const [probeUnlockPw, setProbeUnlockPw] = useState("");
  const [probeUnlocking, setProbeUnlocking] = useState(false);
  const [probeUnlockError, setProbeUnlockError] = useState<string | null>(null);
  /** Bumped by the explicit "Re-check" control — lets a pass be retried
   *  without closing and reopening the wizard. */
  const [probeRunKey, setProbeRunKey] = useState(0);
  /**
   * Round 9 owner ask: "it kinda loaded with latency, first was red, and
   * then it loaded. Id rather be shown first a progress bar before
   * anything is shown, then shown everything at once correctly from the
   * get go."
   *
   * Round 8 deliberately published each account AS IT RESOLVED, which
   * fixed "the whole list sits there until the last decrypt lands" but
   * traded it for exactly what the owner is describing: a list that paints
   * WRONG first (every row red "No known words", because nothing has been
   * decrypted yet) and then corrects itself row by row. Reading a wall of
   * red and watching it repair itself is worse than waiting — so the step
   * now withholds its body entirely until the pass has settled, and shows
   * real progress while it works.
   *
   * `"pending"` is the INITIAL value whenever a probe is possible
   * (`getPassword` present): without it the list would paint unresolved
   * for the frame between mount and the effect firing — the same wrong
   * first paint, just briefer.
   */
  const [probePhase, setProbePhase] = useState<"pending" | "running" | "settled">(
    getPassword ? "pending" : "settled",
  );
  const [probeProgress, setProbeProgress] = useState<{ done: number; total: number }>({
    done: 0,
    total: 0,
  });

  // Round 7: probe EVERY candidate, not just the ones whose metadata
  // claims no words. The probe now decides `recommended` too, and the
  // owner's own question ("how could you know the OTHER accounts have
  // seed words... if for these ones you can't?") was exactly right to
  // call out judging two halves of one list by two different standards —
  // metadata for some, real decryption for others. Everything reaching
  // this list is now judged the same way: by what its secret actually
  // decrypts to.
  //
  // Round 8 kept a `toProbe` ("not yet attempted") list alongside
  // `unresolved`; round 10 deleted it. Tracking "what's left" separately
  // from "what still lacks an answer" is what let the probe effect get
  // keyed on its own progress — see that effect's own note.

  /** The candidate SET (not its probe progress) — one half of a pass's
   *  identity. Stable across the results the pass itself produces, which
   *  is exactly what the old `toProbe`-keyed effect got wrong. */
  const candidateSignature = useMemo(
    () => existingCandidates.map((c) => c.account.id).join(","),
    [existingCandidates],
  );
  /** The last pass actually started, so a pass runs exactly once per
   *  (candidate set x password era x retry) — including under
   *  StrictMode's deliberate double-invocation of effects. */
  const startedPassRef = useRef<string | null>(null);

  /** Every candidate still lacking CONFIRMED words — what a retry (new
   *  auth epoch, or the explicit "Re-check") must re-attempt, as opposed
   *  to `toProbe`'s "not yet attempted in this pass". */
  const unresolved = useMemo(
    () => existingCandidates.filter((c) => probedHasWords[c.account.id] !== true),
    [existingCandidates, probedHasWords],
  );

  /** Drop recorded FAILURES (never successes) so they are eligible to be
   *  probed again. Triggered when the password cache changes — i.e. the
   *  owner authenticated again, plausibly with the right password this
   *  time — and by the explicit "Re-check" control. */
  function resetFailedProbes(): void {
    setProbedHasWords((prev) => {
      const kept: Record<string, boolean> = {};
      for (const [id, ok] of Object.entries(prev)) if (ok) kept[id] = true;
      return kept;
    });
    setProbeErrors({});
    setProbeNeedsPassword(null);
    // Round 9: a retry re-enters the progress state rather than flashing
    // the stale (wrong) list while it re-runs.
    if (getPassword) setProbePhase("pending");
  }

  // A fresh `authenticate()` anywhere (this step's own prompt, the global
  // `<PasswordModal>`, the Make-Eligible gate) moves `passwordEpoch` —
  // which is the signal that a previously-failing password may now be the
  // right one. Re-arm the failures so the effect below picks them up.
  useEffect(() => {
    resetFailedProbes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passwordEpoch, probeRunKey]);

  function classifyDecryptError(e: unknown): string {
    if (e instanceof WrongPasswordError) return "Wrong password for this account's secret.";
    if (e instanceof CorruptEnvelopeError) {
      return "This account's stored secret is corrupted/malformed — no password will fix this.";
    }
    if (e instanceof UnsupportedFormatError) {
      return "This account's secret uses an encryption format this build doesn't support.";
    }
    return e instanceof Error ? e.message : "Could not decrypt this account's secret.";
  }

  /** Round 7: the owner's own rule, run against REAL decrypted content —
   *  "if its not a valid koala or chainweaver seed, then its not
   *  dictionary gated". `isValidMnemonic` with no `seedType` dispatches on
   *  word count itself (12 → Chainweaver checksum, 24 → BIP39 checksum,
   *  anything else → `false`), so a custom DALOS phrase, a pre-converted
   *  bitstring, a bitmap/integer secret — none of which are dictionary
   *  constrained — all correctly come back ungated. Defensive `catch`:
   *  a throw from the underlying wordlist/checksum code must never be
   *  read as "gated", it just means "couldn't tell". */
  async function isUngatedPlaintext(plain: string): Promise<boolean> {
    try {
      return !(await StoaChainWalletBuilder.isValidMnemonic(plain.trim()));
    } catch {
      return false;
    }
  }

  /** Shared by the automatic effect (below) and the manual "Unlock &
   *  Check" submit — decrypts each candidate with the given password.
   *  Never throws: a per-account decrypt failure is caught and recorded
   *  as `false` plus a classified reason, never swallowed into an
   *  unexplained boolean.
   *
   *  Round 8, two changes that matter at REAL codex sizes (the owner's
   *  has 16+ standard accounts, each decrypt a full PBKDF2-600k):
   *
   *  - `shouldStop` ABORTS the loop. It previously ran to completion even
   *    after the step unmounted — `cancelled` only suppressed the
   *    `setState`, so every remaining account was still decrypted for
   *    nothing, stealing CPU from whatever the user moved on to (caught
   *    by this file's own Page-7 finalize tests timing out once round 7
   *    started probing every candidate rather than only metadata-less
   *    ones).
   *  - `onResult` publishes each account AS IT RESOLVES, so a long list
   *    fills in progressively instead of sitting on "No known words" for
   *    every row until the whole batch finishes. */
  async function probeWithPassword(
    password: string,
    candidates: readonly ExistingAccountCandidate[],
    opts?: {
      shouldStop?: () => boolean;
      onResult?: (id: string, r: { ok: boolean; error?: string; ungated?: boolean }) => void;
    },
  ): Promise<{
    results: Record<string, boolean>;
    errors: Record<string, string>;
    ungated: Record<string, boolean>;
  }> {
    const results: Record<string, boolean> = {};
    const errors: Record<string, string> = {};
    const ungated: Record<string, boolean> = {};

    // Round 9: a BOUNDED-concurrency pool instead of one-at-a-time. Each
    // account costs a full PBKDF2-600k `smartDecrypt`; strictly serial,
    // the owner's 16-account codex spends that latency 16 times over,
    // which is the wait they are now staring at behind a progress bar.
    // WebCrypto runs these off the main thread, so overlapping a few
    // genuinely shortens the wall clock. Kept small on purpose — this is
    // deliberately CPU-heavy work (that is the point of 600k iterations)
    // and saturating every core would just starve the rest of the UI.
    const POOL_SIZE = 4;
    let nextIndex = 0;
    async function worker(): Promise<void> {
      for (;;) {
        if (opts?.shouldStop?.()) return;
        const i = nextIndex++;
        if (i >= candidates.length) return;
        const { account } = candidates[i]!;
        let ok = false;
        let error: string | undefined;
        let isUngated: boolean | undefined;
        try {
          const plain = await smartDecrypt(account.secret, password);
          ok = plain.length > 0;
          if (!ok) error = "Decrypted successfully but to empty content.";
          else isUngated = await isUngatedPlaintext(plain);
        } catch (e) {
          ok = false;
          error = classifyDecryptError(e);
        }
        results[account.id] = ok;
        if (error !== undefined) errors[account.id] = error;
        if (isUngated !== undefined) ungated[account.id] = isUngated;
        if (!opts?.shouldStop?.()) opts?.onResult?.(account.id, { ok, error, ungated: isUngated });
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(POOL_SIZE, candidates.length) }, () => worker()),
    );
    return { results, errors, ungated };
  }

  /**
   * Round 10 owner report: the panel sat on "Reading your Ouronet
   * accounts… 0 of 14" and never moved.
   *
   * THE BUG, and it was mine: this effect used to be keyed on
   * `toProbe` — the accounts STILL LEFT to probe — so the pass was
   * re-keyed by its own progress. The moment the first result committed,
   * `probedHasWords` changed, `toProbe` shrank, the dep string changed,
   * React ran the cleanup (`cancelled = true`) and started the effect
   * over. Round 9's 4-wide pool turned that from "wasteful" into
   * "visibly stuck": the one worker that finished cancelled the other
   * three MID-DECRYPT, whose results were then dropped on the floor
   * (both `onResult` and the post-pass commit are `!cancelled`-guarded),
   * and the restarted pass reset the counter to `0` again. Hence a
   * progress bar pinned at 0 while the CPU burned through decrypt after
   * discarded decrypt.
   *
   * A pass is now keyed on the things that should actually start a new
   * one — WHICH accounts exist, WHICH password era we are in, and an
   * explicit retry — and never on its own partial results. `passKey` +
   * `startedPassRef` make it exactly-once per pass, including under
   * StrictMode's double-invoke.
   */
  useEffect(() => {
    if (!getPassword) return;

    const passKey = `${candidateSignature}|${passwordEpoch ?? "none"}|${probeRunKey}`;
    if (startedPassRef.current === passKey) return;
    startedPassRef.current = passKey;

    // Snapshot the work ONCE, up front. Deliberately read out of the
    // current render's `probedHasWords` rather than depending on it:
    // confirmed results survive a retry, but a committed result must
    // never feed back into this effect's identity again.
    const pending = existingCandidates.filter((c) => probedHasWords[c.account.id] !== true);
    if (pending.length === 0) {
      setProbePhase("settled");
      return;
    }

    let cancelled = false;
    // Round 10b: did this pass reach its own end? Decides whether the
    // cleanup below hands the pass BACK for a successor to run.
    let completed = false;
    void (async () => {
      try {
        let password: string;
        try {
          password = getPassword();
        } catch {
          // Codex locked / password cache expired — surface the inline
          // unlock prompt instead of an unhandled rejection + silent
          // forever-"No known words". Leaves `probedHasWords` untouched so
          // these candidates can still resolve once unlocked.
          if (!cancelled) setProbeNeedsPassword("locked");
          return;
        }
        if (!cancelled) {
          setProbePhase("running");
          setProbeProgress({ done: 0, total: pending.length });
        }
        const { results } = await probeWithPassword(password, pending, {
          shouldStop: () => cancelled,
          // Results land per account to drive the PROGRESS counter; the
          // body stays hidden until the pass settles, so the list still
          // appears once, already correct.
          onResult: (id, r) => {
            setProbedHasWords((prev) => ({ ...prev, [id]: r.ok }));
            if (r.error !== undefined) setProbeErrors((prev) => ({ ...prev, [id]: r.error! }));
            if (r.ungated !== undefined) setProbedUngated((prev) => ({ ...prev, [id]: r.ungated! }));
            setProbeProgress((prev) => ({ ...prev, done: prev.done + 1 }));
          },
        });
        if (!cancelled) {
          // Round 8: a whole pass that decrypted NOTHING means the password
          // we hold is wrong for this codex — not that none of these
          // accounts have words. `getPassword()` cannot tell us this
          // (`<PasswordModal>`/`authenticate()` never validate), so this
          // count is the only available signal. Ask for the password
          // instead of silently labelling every account "No known words".
          const attempted = Object.values(results);
          if (attempted.length > 0 && !attempted.some(Boolean)) {
            setProbeNeedsPassword("wrong");
          } else {
            setProbeNeedsPassword(null);
          }
        }
        completed = true;
      } finally {
        // Round 10: ALWAYS leave the progress state, whatever happened —
        // locked, wrong password, a throw from anywhere. The step hides
        // its whole body behind this phase now, so a pass that fails to
        // settle is a dead end with no way out, which is precisely the
        // failure the owner just hit.
        if (!cancelled) setProbePhase("settled");
      }
    })();
    return () => {
      cancelled = true;
      // Round 10b — THE STALL THE OWNER HIT ("Reading your Ouronet
      // accounts… 0 of 14", forever). `<StrictMode>` (which
      // `apps/codex-playground/src/main.tsx` wraps the app in, and which
      // Testing Library does NOT use — hence a green suite over a broken
      // screen) deliberately runs every effect as mount -> CLEANUP ->
      // mount again. That cleanup cancelled the just-started pass, whose
      // `finally` then declined to settle because it had been cancelled,
      // and the second mount found `startedPassRef` already holding this
      // exact `passKey` and returned without starting anything. Result:
      // phase pinned at "running", body withheld, counter frozen at 0.
      //
      // A pass that did NOT finish must therefore release its claim, so
      // the next mount re-runs it. Only a COMPLETED pass keeps the key.
      if (!completed) startedPassRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidateSignature, getPassword, passwordEpoch, probeRunKey]);

  async function handleUnlockAndProbe(): Promise<void> {
    if (!probeUnlockPw) return;
    setProbeUnlocking(true);
    setProbeUnlockError(null);
    try {
      // Round 8: `unresolved`, NOT `toProbe`. `toProbe` only holds
      // candidates not yet attempted in the current pass — after a failed
      // pass it is EMPTY, which is exactly why typing the correct password
      // here used to do nothing at all.
      const retry = unresolved;
      const { results, errors, ungated } = await probeWithPassword(probeUnlockPw, retry);
      const anyDecrypted = Object.values(results).some(Boolean);
      if (!anyDecrypted && retry.length > 0) {
        // Every candidate failed to decrypt with this password — almost
        // certainly the wrong password, not "none of these have words".
        setProbeUnlockError("Incorrect password — try again.");
        return;
      }
      setProbedHasWords((prev) => ({ ...prev, ...results }));
      setProbeErrors((prev) => ({ ...prev, ...errors }));
      setProbedUngated((prev) => ({ ...prev, ...ungated }));
      authenticate?.(probeUnlockPw);
      setProbeNeedsPassword(null);
      setProbeUnlockPw("");
    } finally {
      setProbeUnlocking(false);
    }
  }

  // Merge the real decrypt-probe result on top of the metadata-derived
  // candidate list. Round 7: the probe is now AUTHORITATIVE for BOTH
  // fields whenever it actually ran, because the owner's real data has
  // proven `originSeedTab` unreliable in both directions — accounts they
  // know are ungated stamped as gated (or not stamped at all). When the
  // probe couldn't run (locked / corrupt secret), the metadata-derived
  // values stand as the only thing left to go on.
  const existingCandidatesWithProbe = useMemo(
    () =>
      existingCandidates.map((c) => {
        const probedWords = probedHasWords[c.account.id];
        if (probedWords === undefined) return c; // never probed — keep metadata.
        const ungated = probedUngated[c.account.id];
        return {
          ...c,
          hasKnownWords: c.hasKnownWords || probedWords,
          // Only a CONFIRMED decrypt can earn (or lose) the tag; an
          // unreadable secret falls back to whatever the metadata said.
          recommended: probedWords ? ungated === true : c.recommended,
        };
      }),
    [existingCandidates, probedHasWords, probedUngated],
  );

  // Owner correction (this session): "they must be ordered alphabetically
  // similar as they are shown in the codex" — mirrors the real Ouronet
  // Accounts tab's own display order. Sorted by display name (the SAME
  // name-or-address fallback the rendered row itself uses below), not by
  // id/insertion order.
  const sortedExistingCandidates = useMemo(
    () =>
      [...existingCandidatesWithProbe].sort((a, b) =>
        (a.account.name ?? a.account.address).localeCompare(b.account.name ?? b.account.address),
      ),
    [existingCandidatesWithProbe],
  );

  // T6 (Wave 4): option 1/3's own "Recommended" logic, per the module
  // doc's "Page 2" section — option 1 iff the CURRENT account is
  // write-seed-origin; option 3 iff NEITHER the current account NOR any
  // option-2 candidate is already write-seed-origin.
  const currentIsWriteSeedOrigin = currentPrimeAccount?.originSeedTab === "write-seed";
  const currentHasNoKnownWords = currentPrimeAccount?.originSeedTab === undefined;
  const anyWriteSeedCandidateExists = existingCandidates.some((c) => c.recommended);
  const keepRecommended = currentIsWriteSeedOrigin;
  const newWordsRecommended = !currentIsWriteSeedOrigin && !anyWriteSeedCandidateExists;

  // Page 2's own draft of newly-typed words, kept local so the textarea
  // stays controlled even across choice changes elsewhere (e.g. picking
  // option 1, then coming back to option 3) — mirrors
  // `CreateStoaChainSeedModal.tsx`'s own `stoicNewWordsInput` pattern.
  const [newWordsDraft, setNewWordsDraft] = useState("");
  const newWords = useMemo(() => newWordsDraft.trim().split(/\s+/).filter(Boolean), [newWordsDraft]);

  // Fix 4 (post-build fix round): live Ouronet-account + key preview for
  // "type new words" — debounced 300ms, gated on `newWords` passing
  // `validateTypedSeedWords` (the SAME gate `CreateStoaChainSeedModal.tsx`
  // already uses for its own Stoic "new" words). Invalid/empty input clears
  // the preview with no error shown at all — the same "absent data, no
  // placeholder" convention `KeysWordsBlock` elsewhere in this file follows.
  // A genuine derivation failure (rare — these are pure, local calls) is
  // surfaced via `newWordsPreviewError` instead of letting it crash the
  // component.
  const [newWordsPreview, setNewWordsPreview] = useState<{
    accountAddress: string;
    key0PublicKey: string;
    key1PublicKey: string;
  } | null>(null);
  const [newWordsPreviewError, setNewWordsPreviewError] = useState<string | null>(null);

  useEffect(() => {
    if (newWords.length === 0 || validateTypedSeedWords(newWords) !== null) {
      setNewWordsPreview(null);
      setNewWordsPreviewError(null);
      return;
    }
    const timer = setTimeout(() => {
      try {
        const bitString = seedWordsToBitString(newWords);
        // Same registry-mediated entry point `SpawnAccountModal.tsx`'s own
        // `deriveKey` callback uses — no second account-derivation
        // implementation.
        const account = createOuronetAccount(createDefaultRegistry(), {
          mode: "seedWords",
          data: newWords,
        });
        const key0 = deriveStoaDalosKeypairAtIndex(bitString, 0);
        const key1 = deriveStoaDalosKeypairAtIndex(bitString, 1);
        setNewWordsPreview({
          accountAddress: account.standardAddress,
          key0PublicKey: key0.publicKey,
          key1PublicKey: key1.publicKey,
        });
        setNewWordsPreviewError(null);
      } catch (e) {
        setNewWordsPreview(null);
        setNewWordsPreviewError(
          e instanceof Error ? e.message : "Could not derive a preview from these seed words.",
        );
      }
    }, 300);
    return () => clearTimeout(timer);
    // `newWords.join(" ")` (not the array itself, which is a fresh identity
    // every render) — mirrors `CreateStoaChainSeedModal.tsx`'s own
    // `stoicNewWords.join(" ")` dependency for the exact same reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newWords.join(" ")]);

  const isKeepSelected = choice?.kind === "keep-current";
  const isExistingSelected = choice?.kind === "existing";
  const isNewSelected = choice?.kind === "new-words";

  // Owner correction (this session, real screenshot): this used to fall
  // back to `currentPrimeSeed?.name` when the ACCOUNT had no name —
  // silently substituting the Chainweb SEED's name for the OURONET
  // ACCOUNT's name, under a label that explicitly claims to be the
  // account ("keeps ... as your Prime Ouronet Account"). Genuinely
  // misleading regardless of why the account name was missing — removed.
  // Falls back to the account's own address (via `OuronetAddressHighlight`,
  // same convention Option 2's candidates already use) when it has no
  // `name`, never to an unrelated entity's name.
  //
  // Round 6 owner correction (real screenshot): STILL showed the
  // account's raw stored `.name` ("Initial Seed") instead of "CodexPrime".
  // Root cause found in `OuronetAccountsTab.tsx` itself (the tab the owner
  // trusts), which now routes through `masterOuronetAccountName(index,
  // account.name || ...)` — for the account at array position 0, the tab
  // NEVER reads `.name` at all; "CodexPrime" is a hardcoded cosmetic label
  // for that position, full stop. This mirrors that exact rule — when
  // `currentPrimeAccount` IS `allAccounts[0]` (true by construction from
  // `CodexIdPage.tsx`'s own round-4 positional-only resolution, but
  // checked locally here so any other caller gets the same honesty), the
  // literal "CodexPrime" label wins over whatever `.name` happens to be
  // stored, exactly like the tab the owner is comparing against.
  const isCurrentAccountAtIndexZero =
    allAccounts.length > 0 && allAccounts[0]?.id === currentPrimeAccount?.id;
  const currentAccountLabel = isCurrentAccountAtIndexZero
    ? OURONET_CODEX_MASTER
    : currentPrimeAccount?.name ?? null;

  // Round 9 owner ask — "Id rather be shown first a progress bar before
  // anything is shown, then shown everything at once correctly from the
  // get go." Everything below (both the Option 1 chip and the Option 2
  // list) depends on what the decrypt pass finds, so the whole step waits
  // rather than painting a wrong first draft and repairing it in place.
  if (probePhase !== "settled") {
    const { done, total } = probeProgress;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    return (
      <div
        data-testid="legacy-prime-migration-account"
        style={{ display: "flex", flexDirection: "column", gap: 14 }}
      >
        <p style={{ ...stepParagraphStyle, fontSize: 13, color: "#d2d3d4" }}>
          Choose which Ouronet account becomes your Prime Ouronet Account. This is a
          separate decision from which payment/guard keys it uses — the next step.
        </p>
        <div
          data-testid="legacy-prime-migration-account-probe-progress"
          role="status"
          aria-live="polite"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            padding: "14px 16px",
            borderRadius: 10,
            border: "1px solid #262626",
            backgroundColor: "#18181B",
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 600, color: "#d2d3d4" }}>
            {total > 0
              ? `Reading your Ouronet accounts… ${done} of ${total}`
              : "Reading your Ouronet accounts…"}
          </span>
          <div
            style={{
              height: 6,
              borderRadius: 999,
              backgroundColor: "#262626",
              overflow: "hidden",
            }}
          >
            <div
              data-testid="legacy-prime-migration-account-probe-progress-bar"
              style={{
                height: "100%",
                width: `${pct}%`,
                minWidth: pct > 0 ? 6 : 0,
                borderRadius: 999,
                backgroundColor: ACCENT,
                transition: "width 120ms linear",
              }}
            />
          </div>
          <span style={stepParagraphStyle}>
            Each account&apos;s secret is decrypted once to check whether its recovery
            words are recoverable, and whether they are dictionary-gated. The list
            appears when every account has been checked.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="legacy-prime-migration-account"
      style={{ display: "flex", flexDirection: "column", gap: 14 }}
    >
      <p style={{ ...stepParagraphStyle, fontSize: 13, color: "#d2d3d4" }}>
        Choose which Ouronet account becomes your Prime Ouronet Account. This is a
        separate decision from which payment/guard keys it uses — the next step.
      </p>

      {/* Option 1 — keep current. Always available. */}
      <div
        data-testid="legacy-prime-migration-account-option-keep"
        role="radio"
        aria-selected={isKeepSelected}
        style={radioOptionStyle(isKeepSelected)}
      >
        <button
          type="button"
          style={radioOptionHeaderButtonStyle}
          onClick={() => onChoose({ kind: "keep-current" })}
        >
          <OptionNumberBadge n={1} />
          Keep your current account
          {keepRecommended ? <RecommendedBadge /> : null}
        </button>
        {/* Round 4 owner correction (real screenshot, asked "the last 7
            times"): the account being kept was only ever named inline, in
            prose — not visually distinct the way Option 2's candidates are
            (bullet + name + curve badge). Whatever the exact reason the
            owner couldn't find it, making it IMPOSSIBLE to miss — the same
            chip treatment Option 2 already uses, including the SAME live
            chain-data hydration — removes the ambiguity outright rather
            than relying on prose alone. */}
        {currentPrimeAccount ? (
          <div
            data-testid="legacy-prime-migration-account-keep-chip"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 3,
              padding: "6px 10px",
              borderRadius: 8,
              backgroundColor: "#ceac5f0d",
              border: "1px solid #ceac5f30",
              // Round 6 owner correction: was `width: "fit-content"` — a
              // chip-sized box with no defined width leaves
              // `OuronetAddressHighlight`'s own `el.clientWidth` measurement
              // (it fills whatever concrete width its flex parent gives it)
              // nothing stable to shrink against, so the address line below
              // rendered the FULL raw string instead of the shortened
              // first-3/last-3 form the owner asked for. Full-width (same
              // as Option 2's own candidate rows) gives it a real, bounded
              // width to truncate into.
              width: "100%",
              boxSizing: "border-box",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
                fontWeight: 600,
                color: "#d2d3d4",
              }}
            >
              {(() => {
                const live = liveChainByAddress[currentPrimeAccount.address];
                const isActive = live ? live["iz-activated"] : currentPrimeAccount.isActive === true;
                const title = live
                  ? isActive ? "Activated" : "Not activated"
                  : isActive
                    ? "Activated (last known — live chain read still loading)"
                    : "Not activated (last known — live chain read still loading)";
                return (
                  <span
                    aria-hidden="true"
                    title={title}
                    style={{
                      display: "inline-block",
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      flexShrink: 0,
                      backgroundColor: isActive ? "#4ade80" : "#c0392b",
                    }}
                  />
                );
              })()}
              {currentAccountLabel ?? <OuronetAddressHighlight address={currentPrimeAccount.address} />}
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                  color: "#666",
                  border: "1px solid #333",
                  borderRadius: 4,
                  padding: "1px 5px",
                }}
              >
                {detectOriginCurve(currentPrimeAccount).toUpperCase()}
              </span>
            </div>
            {/* Round 6 owner ask: "beneath it a shortening of its string,
                which by the way, all other entries below should show" —
                the account's own address, truncated/highlighted via the
                SAME `OuronetAddressHighlight` primitive the fallback
                (no-name) path above already uses, now shown unconditionally
                underneath the name too (not only as a name substitute).
                Round 7 owner correction: "the string should extend the
                whole available width" — a previous round capped this at
                `maxWidth: 200` to FORCE a short `first3…last3` form; the
                owner wants the opposite, which is also what this primitive
                (and OuronetUI's own `AddressChip`) is built for: fill the
                row, show every character that fits, elide ONLY the
                remainder into a single centered `…`. `display: flex` stays
                load-bearing — the primitive measures its own `clientWidth`
                via `flex: 1`, which needs a real flex parent to resolve
                against. */}
            <div
              style={{
                display: "flex",
                width: "100%",
                fontSize: 10,
                fontFamily: "var(--codex-font-mono, monospace)",
                paddingLeft: 14,
              }}
            >
              <OuronetAddressHighlight address={currentPrimeAccount.address} />
            </div>
          </div>
        ) : null}
        <p style={stepParagraphStyle}>
          No identity change — keeps{" "}
          {currentPrimeAccount ? (
            <strong>
              {currentAccountLabel ?? <OuronetAddressHighlight address={currentPrimeAccount.address} />}
            </strong>
          ) : (
            "your current account"
          )}{" "}
          as your Prime Ouronet Account
          {currentPrimeSeed?.name ? (
            <>
              {" "}
              (its Chainweb seed: <strong>{currentPrimeSeed.name}</strong>)
            </>
          ) : null}
          .
        </p>
        {currentHasNoKnownWords ? (
          <div role="alert" style={warningBoxStyle}>
            {NO_KNOWN_WORDS_WARNING_TEXT}
          </div>
        ) : null}
      </div>

      {/* Option 2 — choose an EXISTING Standard Ouronet account. Owner
          correction, this session: shows EVERY other Standard, DALOS-curve
          account in the codex (hidden entirely only when zero such
          accounts exist at all) — word origin no longer gates listing,
          only the RECOMMENDED tag. An account with no recorded words shows
          "No known words" instead, same honesty Option 1 already uses. */}
      {hasExistingCandidates ? (
        <div
          data-testid="legacy-prime-migration-account-option-existing"
          role="radio"
          aria-selected={isExistingSelected}
          style={radioOptionStyle(isExistingSelected)}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <OptionNumberBadge n={2} />
            <span style={{ fontSize: 13, fontWeight: 700, color: "#d2d3d4" }}>
              Choose an existing Standard Ouronet Account
            </span>
          </div>
          <p style={stepParagraphStyle}>
            Every other STANDARD, DALOS-curve Ouronet account in this codex — Smart
            accounts and APOLLO-curve accounts never appear here (the Stoic Dalos
            Derivation this flow uses doesn&apos;t apply to either). Each candidate shows
            its detected curve and activation status; only accounts with known recovery
            words (not dictionary-gated) are tagged Recommended.
          </p>
          {probeNeedsPassword !== null && unresolved.length > 0 ? (
            <div
              data-testid="legacy-prime-migration-account-probe-unlock"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                padding: "8px 10px",
                borderRadius: 8,
                backgroundColor: "#ceac5f15",
                border: "1px solid #ceac5f40",
                marginBottom: 2,
              }}
            >
              {/* Round 8: the "wrong" case is the one the owner actually
                  hit — `getPassword()` happily returned a password that
                  decrypts nothing, so the step was never "locked" and
                  this prompt never appeared; every row just claimed "No
                  known words". Say which situation it is, plainly. */}
              <span style={{ fontSize: 11, color: "#ceac5f" }}>
                {probeNeedsPassword === "locked"
                  ? "Your codex is locked — enter your password to check which of the "
                  : "The password this codex currently holds could not decrypt ANY of these accounts, so none of them could be checked. Re-enter it to check the "}
                {unresolved.length} account{unresolved.length === 1 ? "" : "s"} below marked
                &quot;No known words&quot;.
              </span>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input
                  type="password"
                  value={probeUnlockPw}
                  onChange={(e) => setProbeUnlockPw(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && probeUnlockPw && !probeUnlocking) void handleUnlockAndProbe();
                  }}
                  placeholder="Codex password"
                  data-testid="legacy-prime-migration-account-probe-unlock-input"
                  style={{
                    flex: 1,
                    fontSize: 12,
                    padding: "6px 8px",
                    borderRadius: 6,
                    border: "1px solid #333",
                    backgroundColor: "#111",
                    color: "#d2d3d4",
                  }}
                />
                <button
                  type="button"
                  disabled={!probeUnlockPw || probeUnlocking}
                  onClick={() => void handleUnlockAndProbe()}
                  data-testid="legacy-prime-migration-account-probe-unlock-submit"
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    padding: "6px 12px",
                    borderRadius: 6,
                    border: "none",
                    cursor: probeUnlockPw && !probeUnlocking ? "pointer" : "not-allowed",
                    backgroundColor: "#ceac5f",
                    color: "#111",
                    opacity: !probeUnlockPw || probeUnlocking ? 0.5 : 1,
                  }}
                >
                  {probeUnlocking ? "Checking…" : "Unlock & Check"}
                </button>
              </div>
              {probeUnlockError ? (
                <span style={{ fontSize: 11, color: "#f87171" }}>{probeUnlockError}</span>
              ) : null}
            </div>
          ) : null}
          {/* Round 8: an explicit, always-available retry. The owner's
              "it worked for a second... then it shows that it doesnt
              recognise the words" had NO in-wizard way out — a failed
              pass was terminal until the whole wizard was closed and
              reopened (and, because failures used to be cached as
              final, often not even then). */}
          {probeNeedsPassword === null && unresolved.length > 0 ? (
            <button
              type="button"
              data-testid="legacy-prime-migration-account-probe-recheck"
              onClick={() => setProbeRunKey((n) => n + 1)}
              style={{
                alignSelf: "flex-start",
                fontSize: 10,
                fontWeight: 700,
                color: "#888",
                background: "none",
                border: "1px solid #262626",
                borderRadius: 6,
                padding: "3px 8px",
                cursor: "pointer",
                marginBottom: 2,
              }}
              title="Re-read these accounts' secrets with the codex password held right now — use this if they were checked while the codex was locked, or with a password that has since changed."
            >
              Re-check {unresolved.length} account{unresolved.length === 1 ? "" : "s"}
            </button>
          ) : null}
          <div
            role="listbox"
            aria-label="Existing account to promote"
            style={{ display: "flex", flexDirection: "column", gap: 6 }}
          >
            {sortedExistingCandidates.map(({ account, recommended, hasKnownWords }) => {
              const selected = isExistingSelected && choice?.accountId === account.id;
              return (
                <button
                  key={account.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  data-testid={`legacy-prime-migration-account-existing-item-${account.id}`}
                  onClick={() => onChoose({ kind: "existing", accountId: account.id })}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-start",
                    padding: "8px 12px",
                    borderRadius: 8,
                    cursor: "pointer",
                    textAlign: "left",
                    border: `1px solid ${selected ? ACCENT : "#262626"}`,
                    backgroundColor: selected ? ACCENT + "14" : "transparent",
                  }}
                >
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 12,
                      fontWeight: 600,
                      color: selected ? ACCENT : "#d2d3d4",
                    }}
                  >
                    {/* Owner correction (this session): "with a green
                        bullet if its activated, red if its not" — mirrors
                        `OuronetAccountsTab.tsx`'s own established
                        Active/Inactive color convention exactly
                        (`#4ade80`/`#c0392b`), not a new color scheme. Status
                        only — never gates which accounts are listed.
                        Round 4: now reads REAL live chain state via the
                        SAME `useAccountChainData` hook the tab uses (see
                        this component's own module-level note above) —
                        falls back to the stored `account.isActive` ("last
                        known") only while that live read is still loading
                        or has failed. */}
                    {(() => {
                      const live = liveChainByAddress[account.address];
                      const isActive = live ? live["iz-activated"] : account.isActive === true;
                      const title = live
                        ? isActive
                          ? "Activated"
                          : "Not activated"
                        : isActive
                          ? "Activated (last known — live chain read still loading)"
                          : "Not activated (last known — live chain read still loading)";
                      return (
                        <span
                          aria-hidden="true"
                          title={title}
                          style={{
                            display: "inline-block",
                            width: 8,
                            height: 8,
                            borderRadius: "50%",
                            flexShrink: 0,
                            backgroundColor: isActive ? "#4ade80" : "#c0392b",
                          }}
                        />
                      );
                    })()}
                    {account.name ? account.name : <OuronetAddressHighlight address={account.address} />}
                    {/* Owner ask (this session): "each candidate... shows
                        its detected curve for transparency" — every item
                        reaching this render has ALREADY passed the DALOS-
                        only filter above, so this is always "DALOS" by
                        construction; shown anyway so a filter regression
                        (an Apollo account slipping through) is immediately
                        visible here, not hidden behind a bare name. */}
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        letterSpacing: "0.04em",
                        color: "#666",
                        border: "1px solid #333",
                        borderRadius: 4,
                        padding: "1px 5px",
                      }}
                    >
                      {detectOriginCurve(account).toUpperCase()}
                    </span>
                    {recommended ? (
                      <RecommendedBadge />
                    ) : !hasKnownWords ? (
                      // Owner correction (this session): this account still
                      // appears (never excluded), but — same honesty as
                      // Option 1's own "no known words" warning — it is
                      // never silently treated as equivalent to a real
                      // candidate with recorded words.
                      //
                      // Round 6: the `title` tooltip now carries the REAL,
                      // classified reason a decrypt attempt failed
                      // (`probeErrors[account.id]`) — wrong password vs.
                      // corrupted data vs. unsupported format vs. "not yet
                      // checked" (still locked/probing). Real evidence
                      // instead of a label that just says "no" with no way
                      // to tell WHY.
                      <span
                        title={
                          probeErrors[account.id] ??
                          (probeNeedsPassword !== null
                            ? "Not checked — the codex password available here could not be used. Enter it above to check."
                            : "Checking…")
                        }
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          color: "#c0392b",
                        }}
                      >
                        {/* Round 8: the REASON is no longer tooltip-only.
                            A whole round was spent with the owner looking
                            at a wall of unexplained "No known words" — the
                            short reason rides along inline now, with the
                            full sentence still in the `title`. */}
                        No known words
                        {probeErrors[account.id] ? (
                          <span style={{ fontWeight: 600, color: "#8a4b44" }}>
                            {" · "}
                            {probeErrors[account.id]?.startsWith("Wrong password")
                              ? "wrong password"
                              : probeErrors[account.id]?.startsWith("This account's stored secret is corrupted")
                                ? "corrupted secret"
                                : probeErrors[account.id]?.startsWith("This account's secret uses an encryption")
                                  ? "unsupported format"
                                  : "unreadable"}
                          </span>
                        ) : probeNeedsPassword !== null ? (
                          <span style={{ fontWeight: 600, color: "#8a4b44" }}>{" · not checked"}</span>
                        ) : null}
                      </span>
                    ) : null}
                    {/* Round 7: the "Not dictionary-gated? Mark it" button
                        that used to live here is GONE. It only existed
                        because of my own wrong claim that gating couldn't
                        be detected from decrypted content — it can, via
                        `StoaChainWalletBuilder.isValidMnemonic` (see
                        `isUngatedPlaintext` above). The owner shouldn't be
                        asked to hand-label what the codex can check
                        itself. */}
                  </span>
                  {/* Round 6 owner ask: "beneath it a shortening of its
                      string, which by the way, all other entries below
                      should show" — every candidate's own address, same
                      truncated/highlighted primitive as the name fallback
                      and the Option 1 chip above. `display: flex` +
                      `width: 100%` are both load-bearing: the button's own
                      `alignItems: flex-start` does NOT stretch children by
                      default, and `OuronetAddressHighlight` resolves its
                      `flex: 1` / measures its own `clientWidth` against a
                      real, concrete flex parent. Round 7 owner correction —
                      "the string should extend the whole available width":
                      an earlier `maxWidth: 200` cap (to force a short
                      `first3…last3`) is gone; full width, eliding only the
                      overflow, is the asked-for behavior. */}
                  <div
                    style={{
                      display: "flex",
                      width: "100%",
                      fontSize: 10,
                      fontFamily: "var(--codex-font-mono, monospace)",
                      paddingLeft: 14,
                    }}
                  >
                    <OuronetAddressHighlight address={account.address} />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Option 3 — type new words. Always available. The two warning
          lines below are always rendered, unconditionally, regardless of
          whether any words have been typed yet or this option is the
          active choice. */}
      <div
        data-testid="legacy-prime-migration-account-option-new"
        role="radio"
        aria-selected={isNewSelected}
        style={radioOptionStyle(isNewSelected)}
      >
        <button
          type="button"
          style={radioOptionHeaderButtonStyle}
          onClick={() => onChoose({ kind: "new-words", words: newWordsDraft })}
        >
          <OptionNumberBadge n={3} />
          Type new words
          {newWordsRecommended ? <RecommendedBadge /> : null}
        </button>
        <div role="alert" style={warningBoxStyle}>
          {NEW_ACCOUNT_ACTIVATION_WARNING_TEXT}
        </div>
        <div role="alert" style={warningBoxStyle}>
          {NEW_ACCOUNT_EMPTY_WARNING_TEXT}
        </div>
        <textarea
          data-testid="legacy-prime-migration-account-new-words-input"
          placeholder="Type brand-new seed words, separated by spaces…"
          value={newWordsDraft}
          onChange={(e) => {
            setNewWordsDraft(e.target.value);
            onChoose({ kind: "new-words", words: e.target.value });
          }}
          style={{
            width: "100%",
            boxSizing: "border-box",
            minHeight: 60,
            padding: 10,
            borderRadius: 8,
            outline: "none",
            resize: "none",
            backgroundColor: "#18181B",
            border: "1px solid #262626",
            color: "#d2d3d4",
            fontFamily: "var(--codex-font-mono, monospace)",
            fontSize: 12,
            lineHeight: 1.6,
          }}
        />
        {newWordsPreview ? (
          <div
            data-testid="legacy-prime-migration-account-new-words-preview"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              padding: 10,
              borderRadius: 8,
              backgroundColor: "#18181B",
              border: "1px solid #262626",
            }}
          >
            {/* Post-build fix round, Issues 2/3: the owner's screenshot
                showed this exact block overflowing horizontally with raw,
                untruncated hex. Every value below now renders through this
                package's OWN existing measured-width truncation primitives
                (`OuronetAddressHighlight`/`MeasuredHexHighlight`) rather
                than a bare string — same mechanism (canvas/DOM-measured
                fit, `ResizeObserver`-driven re-fit, centered middle
                ellipsis, colored edge anchors) OuronetUI's own
                `AddressChip`/`useAvailableChars` already establish for this
                exact problem, just this package's own already-shipped
                implementation of it (`StoaAddressHighlight.tsx`/
                `OuronetAddressHighlight.tsx`), reused rather than
                duplicated. */}
            <div>
              <p style={stepParagraphStyle}>Ouronet Account</p>
              <div style={{ ...stepParagraphStyle, fontFamily: "var(--codex-font-mono, monospace)" }}>
                <OuronetAddressHighlight address={newWordsPreview.accountAddress} />
              </div>
            </div>
            <div>
              <p style={stepParagraphStyle}>Position #0 Key — Payment Key Source</p>
              <div style={{ ...stepParagraphStyle, fontFamily: "var(--codex-font-mono, monospace)" }}>
                <MeasuredHexHighlight value={newWordsPreview.key0PublicKey} edgeColor="#eab308" />
              </div>
              <p style={stepParagraphStyle}>
                Payment Key (Chainweb Account):{" "}
                <MeasuredHexHighlight
                  value={`k:${newWordsPreview.key0PublicKey}`}
                  prefixChars={2}
                  edgeColor="#eab308"
                  style={{ display: "inline-block" }}
                />
              </p>
            </div>
            <div>
              <p style={stepParagraphStyle}>Position #1 Key — Ouronet Guard Source</p>
              <div style={{ ...stepParagraphStyle, fontFamily: "var(--codex-font-mono, monospace)" }}>
                <MeasuredHexHighlight value={newWordsPreview.key1PublicKey} edgeColor="#eab308" />
              </div>
            </div>
          </div>
        ) : null}
        {newWordsPreviewError ? (
          <div role="alert" style={warningBoxStyle}>
            {newWordsPreviewError}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** The derivation path named whenever new keys are defined, per
 *  `legacy-prime-migration-wizard/design.md`'s "Page 3" section — exported
 *  so a future task/test can assert against the exact same string without
 *  re-typing it (same convention as {@link NEW_ACCOUNT_ACTIVATION_WARNING_TEXT}). */
export const STOIC_DALOS_DERIVATION_LABEL = "Stoic Dalos Derivation";

/** The derivation path named whenever the "Advanced" (native-format)
 *  method is active, per `legacy-prime-migration-wizard/design.md`'s
 *  "Page 3" section — exported for the same reason as
 *  {@link STOIC_DALOS_DERIVATION_LABEL}. */
export const ADVANCED_NATIVE_DERIVATION_LABEL = "Advanced (native format) derivation";

/**
 * Resolves the Page-2-chosen account's own `originSeedTab` — the signal
 * Page 3 uses to decide whether "Advanced" native derivation is even
 * offered (see {@link KeysStep}). `"new-words"` (freshly-typed words) and
 * no choice yet both resolve to `undefined` — never dictionary-gated, so
 * "Advanced" is never offered for them.
 */
function resolveChosenAccountOriginSeedTab(
  accountChoice: LegacyPrimeMigrationAccountChoice | null,
  currentPrimeAccount: IOuroAccount | null,
  allAccounts: readonly IOuroAccount[],
): OuroOriginSeedTab | undefined {
  if (accountChoice?.kind === "existing") {
    return allAccounts.find((a) => a.id === accountChoice.accountId)?.originSeedTab;
  }
  if (accountChoice?.kind === "keep-current") {
    return currentPrimeAccount?.originSeedTab ?? undefined;
  }
  return undefined;
}

/**
 * The Page-2-chosen account itself — the one whose words back the new keys.
 * Lifted out of the old combined `KeysStep` so the MAIN component can
 * derive the position-0/1 preview ONCE, shared by the (now separate)
 * payment and guard pages plus the review step, rather than each page
 * re-decrypting it independently.
 */
function resolveChosenAccount(
  accountChoice: LegacyPrimeMigrationAccountChoice | null,
  currentPrimeAccount: IOuroAccount | null,
  allAccounts: readonly IOuroAccount[],
): IOuroAccount | null {
  if (accountChoice?.kind === "existing") {
    return allAccounts.find((a) => a.id === accountChoice.accountId) ?? null;
  }
  if (accountChoice?.kind === "keep-current") {
    return currentPrimeAccount;
  }
  return null;
}

/** The derived position-0/1 preview for the Page-2-chosen account. */
type MasterKeyPreview =
  | { status: "loading" }
  | { status: "ready"; key0: string; key1: string }
  | { status: "error"; message: string };

/**
 * Where a public key actually lives in this codex - which seed, which
 * position. This is the "and its ties" half of the owner's ask: showing a
 * bare 64-hex payment key says nothing about what deleting a seed would
 * cost you.
 */
function findKeyTies(
  seeds: readonly IStoaChainSeed[],
  publicKey: string,
): { seedId: string; seedName: string; position: number } | null {
  for (let i = 0; i < seeds.length; i++) {
    const seed = seeds[i]!;
    for (const acc of seed.accounts ?? []) {
      if (acc.publicKey === publicKey) {
        return {
          seedId: seed.id,
          seedName: masterChainwebSeedName(i, seed.isPrime, seed.name),
          position: acc.index,
        };
      }
    }
  }
  return null;
}

/**
 * The codex's CURRENT payment key: position 0 of the first Chainweb seed.
 *
 * Same value `ActivateStandardAccountModal.tsx` already uses as `primeKey0`
 * when it builds a transaction, and the exact key the owner quoted as their
 * "FROM". Read positionally rather than from `isPrime`, because a real codex
 * can carry a stale flag (the Page-2 lesson).
 */
function currentPaymentKeyOf(seeds: readonly IStoaChainSeed[]): string | null {
  return seeds[0]?.accounts?.find((a) => a.index === 0)?.publicKey ?? null;
}

/** A labelled row of hex that truncates instead of overflowing. */
function KeyLine({
  label,
  value,
  testId,
}: {
  label: string;
  value: string;
  testId?: string;
}): React.ReactElement {
  return (
    <div data-testid={testId} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <p style={{ ...stepParagraphStyle, color: "#8b8b96" }}>{label}</p>
      <div style={{ ...stepParagraphStyle, display: "flex", minWidth: 0 }}>
        <MeasuredHexHighlight value={value} edgeColor="#eab308" />
      </div>
    </div>
  );
}

/** Page 3's words/derivation transparency block. See the module doc's
 *  "Page 3" section for the plaintext-vs-reference display decision this
 *  implements: actual words only for `accountChoice.kind === "new-words"`
 *  (the only case this component ever holds them as plaintext); a
 *  plain-language reference otherwise. Always names whichever derivation
 *  method is active ({@link STOIC_DALOS_DERIVATION_LABEL} or
 *  {@link ADVANCED_NATIVE_DERIVATION_LABEL}) — T6 (Wave 4) fix: there is no
 *  longer an "accept existing, unchanged" branch that skips naming a path
 *  at all; every reachable choice derives. */
function KeysWordsBlock({
  accountChoice,
  keysChoice,
}: {
  accountChoice: LegacyPrimeMigrationAccountChoice | null;
  keysChoice: LegacyPrimeMigrationKeysChoice;
}): React.ReactElement {
  let wordsLine: string;
  if (accountChoice?.kind === "new-words") {
    wordsLine = `Words: ${accountChoice.words || "(none typed yet)"}`;
  } else if (accountChoice?.kind === "existing") {
    wordsLine =
      "Words: the selected existing account's words — already securely stored, not re-displayed here.";
  } else {
    // "keep-current" (or no choice yet).
    wordsLine =
      "Words: your current account's words — already securely stored, not re-displayed here.";
  }

  const derivationLabel =
    keysChoice.kind === "stoic-dalos" ? STOIC_DALOS_DERIVATION_LABEL : ADVANCED_NATIVE_DERIVATION_LABEL;

  return (
    <div
      data-testid="legacy-prime-migration-keys-words-block"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        padding: 10,
        borderRadius: 8,
        backgroundColor: "#18181B",
        border: "1px solid #262626",
      }}
    >
      <p style={{ ...stepParagraphStyle, color: "#d2d3d4" }}>{wordsLine}</p>
      <p style={stepParagraphStyle}>
        Derivation path: <strong>{derivationLabel}</strong>
      </p>
    </div>
  );
}


/** Page 3, section 1 - the payment key. */
function PaymentKeySection({
  currentKey,
  ties,
  preview,
  choice,
  onChoose,
}: {
  currentKey: string | null;
  ties: { seedName: string; position: number } | null;
  preview: MasterKeyPreview;
  choice: LegacyPrimeMigrationPaymentChoice | null;
  onChoose: (c: LegacyPrimeMigrationPaymentChoice) => void;
}): React.ReactElement {
  const isDerive = choice?.kind === "stoic-dalos-position-0";
  const isKeep = choice?.kind === "keep";
  const newKey = preview.status === "ready" ? preview.key0 : null;

  return (
    <div data-testid="legacy-prime-migration-payment-section"
         style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <p style={{ ...stepParagraphStyle, fontSize: 13, color: "#d2d3d4" }}>
        <strong>Payment key.</strong> The key that pays for your{" "}
        {OURONET_CODEX_MASTER}&apos;s transactions.
      </p>

      <div style={{ padding: 10, borderRadius: 8, backgroundColor: "#18181B", border: "1px solid #262626" }}>
        {currentKey ? (
          <>
            <KeyLine label="Current payment key" value={currentKey}
                     testId="legacy-prime-migration-payment-current" />
            <p data-testid="legacy-prime-migration-payment-ties"
               style={{ ...stepParagraphStyle, marginTop: 6 }}>
              {ties
                ? `Held in this codex as ${ties.seedName} - Key #${ties.position}.`
                : "This key is not held anywhere in this codex."}
            </p>
          </>
        ) : (
          <p data-testid="legacy-prime-migration-payment-current-none" style={stepParagraphStyle}>
            This codex has no Chainweb key at position 0 yet, so there is no current payment key
            to show.
          </p>
        )}
      </div>

      <div data-testid="legacy-prime-migration-payment-option-derive"
           role="radio" aria-selected={isDerive} style={radioOptionStyle(isDerive)}>
        <button type="button" style={radioOptionHeaderButtonStyle}
                onClick={() => onChoose({ kind: "stoic-dalos-position-0" })}>
          <OptionNumberBadge n={1} />
          Derive a new one from this account&apos;s words
          <RecommendedBadge />
        </button>
        <p style={stepParagraphStyle}>
          Position 0 of the {MASTER_CHAINWEB_SEED}, via {STOIC_DALOS_DERIVATION_LABEL}. This is
          what makes words-only restore possible. That seed and its position 0 become
          non-removable once this completes.
        </p>
      </div>

      <div data-testid="legacy-prime-migration-payment-option-keep"
           role="radio" aria-selected={isKeep} style={radioOptionStyle(isKeep)}>
        <button type="button" style={radioOptionHeaderButtonStyle}
                onClick={() => onChoose({ kind: "keep" })}>
          <OptionNumberBadge n={2} />
          Keep the current payment key
        </button>
        <p style={stepParagraphStyle}>
          Changes nothing on chain. This key isn&apos;t derived from your {MASTER_CHAINWEB_SEED},
          so it won&apos;t regenerate from your seed words alone &mdash; recovering it depends on
          a codex backup. It becomes non-removable from this codex so that backup stays complete.
        </p>
      </div>

      {isDerive ? (
        <div data-testid="legacy-prime-migration-payment-fromto"
             style={{ display: "flex", flexDirection: "column", gap: 8, padding: 10,
                      borderRadius: 8, backgroundColor: "#18181B", border: "1px solid #262626" }}>
          {currentKey ? <KeyLine label="FROM" value={currentKey} /> : (
            <p style={stepParagraphStyle}>FROM &mdash; nothing (no current payment key).</p>
          )}
          {preview.status === "loading" ? (
            <p data-testid="legacy-prime-migration-payment-to-loading" style={stepParagraphStyle}>
              TO &mdash; deriving from this account&apos;s words&hellip;
            </p>
          ) : preview.status === "error" ? (
            <p data-testid="legacy-prime-migration-payment-to-error" role="alert"
               style={{ ...stepParagraphStyle, color: "#fca5a5" }}>
              TO &mdash; could not derive: {preview.message}
            </p>
          ) : (
            <KeyLine label="TO" value={newKey!} testId="legacy-prime-migration-payment-to" />
          )}
        </div>
      ) : null}
    </div>
  );
}

/** Renders whatever the account's guard currently is, by shape. */
function CurrentGuardBlock({
  resolution,
}: {
  resolution: GuardKeyResolution | null;
}): React.ReactElement {
  if (resolution === null) {
    return (
      <p data-testid="legacy-prime-migration-guard-current-loading" style={stepParagraphStyle}>
        Reading this account&apos;s guard&hellip;
      </p>
    );
  }
  if (resolution.kind === "none") {
    return (
      <p data-testid="legacy-prime-migration-guard-current-none" style={stepParagraphStyle}>
        This account has no guard on record.
      </p>
    );
  }
  if (resolution.kind === "unsupported") {
    return (
      <p data-testid="legacy-prime-migration-guard-current-unsupported" style={stepParagraphStyle}>
        This account is guarded by a {resolution.guardKind} guard, which does not name a fixed
        list of keys. Nothing here can be locked to it.
      </p>
    );
  }
  if (resolution.kind === "keyset-ref-unresolved") {
    return (
      <div data-testid="legacy-prime-migration-guard-current-unresolved">
        <p style={stepParagraphStyle}>
          Guarded by the on-chain keyset <strong>{resolution.ref}</strong>.
        </p>
        <p role="alert" style={{ ...stepParagraphStyle, color: "#fca5a5" }}>
          Its keys could not be read right now ({resolution.error}), so what it authorizes is
          unknown &mdash; not empty.
        </p>
      </div>
    );
  }
  if (resolution.kind === "unknown") {
    return (
      <p data-testid="legacy-prime-migration-guard-current-unknown" style={stepParagraphStyle}>
        This account&apos;s guard is in a shape this screen does not recognise, so it is not
        shown rather than guessed at.
      </p>
    );
  }
  const viaRef = resolution.kind === "keyset-ref" ? resolution.ref
    : resolution.viaRef ?? null;
  return (
    <div data-testid="legacy-prime-migration-guard-current-keyset"
         style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <p style={stepParagraphStyle}>
        {viaRef
          ? `Guarded by the on-chain keyset ${viaRef}, which names ${resolution.keys.length} key(s) under ${resolution.pred}:`
          : `Guarded by a keyset of ${resolution.keys.length} key(s) under ${resolution.pred}:`}
      </p>
      {resolution.keys.map((k) => (
        <KeyLine key={k} label="" value={k} />
      ))}
    </div>
  );
}


/**
 * The ADVANCED custom-keyset editor: pick any keys the codex already holds,
 * pick any predicate.
 *
 * The owner's ask was "all the keys he has in wallet", which the ZBOM guard
 * editor does NOT provide - its Define tab is free-text 64-hex entry only.
 * So the keys here come from the codex's own Chainweb seeds, labelled by the
 * seed and position that hold them, which is also exactly what makes them
 * lockable afterwards.
 */
function CustomKeysetEditor({
  allSeeds,
  selectedKeys,
  pred,
  onChange,
}: {
  allSeeds: readonly IStoaChainSeed[];
  selectedKeys: readonly string[];
  pred: string;
  onChange: (keys: readonly string[], pred: string) => void;
}): React.ReactElement {
  const available = allSeeds.flatMap((seed, i) =>
    (seed.accounts ?? []).map((acc) => ({
      publicKey: acc.publicKey,
      label: `${masterChainwebSeedName(i, seed.isPrime, seed.name)} - Key #${acc.index}`,
    })),
  );
  const toggle = (k: string): void => {
    const next = selectedKeys.includes(k)
      ? selectedKeys.filter((x) => x !== k)
      : [...selectedKeys, k];
    const stillOk = isPredAvailable(pred, next.length);
    onChange(next, stillOk ? pred : "keys-all");
  };

  return (
    <div data-testid="legacy-prime-migration-guard-custom-editor"
         style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8, padding: 10,
                  borderRadius: 8, backgroundColor: "#141417", border: "1px solid #262626" }}>
      <p style={{ ...stepParagraphStyle, color: "#8b8b96" }}>
        Keys in this codex ({selectedKeys.length} selected)
      </p>
      {available.length === 0 ? (
        <p style={stepParagraphStyle}>This codex holds no Chainweb keys to choose from.</p>
      ) : (
        available.map((k) => (
          <label key={k.publicKey}
                 style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={selectedKeys.includes(k.publicKey)}
              onChange={() => toggle(k.publicKey)}
              aria-label={k.label}
            />
            <span style={{ ...stepParagraphStyle, color: "#d2d3d4" }}>{k.label}</span>
          </label>
        ))
      )}

      <label style={{ ...stepParagraphStyle, color: "#8b8b96", marginTop: 4 }} htmlFor="lpm-pred">
        Predicate
      </label>
      <select
        id="lpm-pred"
        data-testid="legacy-prime-migration-guard-custom-pred"
        value={pred}
        onChange={(e) => onChange(selectedKeys, e.target.value)}
        style={{ backgroundColor: "#18181B", color: "#d2d3d4", border: "1px solid #262626",
                 borderRadius: 6, padding: "6px 8px", fontSize: 12 }}
      >
        {predGroups().map((g) => (
          <optgroup key={g.group} label={g.group}>
            {g.items.map((p) => (
              <option key={p.value} value={p.value}
                      disabled={!isPredAvailable(p.value, selectedKeys.length)}>
                {p.label} - {p.description}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {selectedKeys.length === 0 ? (
        <p data-testid="legacy-prime-migration-guard-custom-empty" role="alert"
           style={{ ...stepParagraphStyle, color: "#fca5a5" }}>
          Select at least one key - a keyset with no keys would lock you out.
        </p>
      ) : null}
    </div>
  );
}

/** Page 3, section 2 - the guard. */
/** The "Expert Mode" pill — shares `MutedPillBadge`'s one style definition
 *  with "Not Recommended"/the fallback's "Advanced" tag (code review,
 *  guard-step-variants: this used to be its own copy of that style
 *  object). */
function ExpertModeBadge(): React.ReactElement {
  return <MutedPillBadge>Expert Mode</MutedPillBadge>;
}

/** A small two-way pill toggle, used by both variants' "Define Custom
 *  Guard" option to switch between its 3A/3B sub-choice without a second
 *  full option row. */
function SubChoiceToggle({
  options,
  active,
  onSelect,
}: {
  options: readonly { testId: string; label: string }[];
  active: number;
  onSelect: (i: number) => void;
}): React.ReactElement {
  return (
    <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
      {options.map((o, i) => (
        <button
          key={o.testId}
          type="button"
          data-testid={o.testId}
          role="tab"
          aria-selected={active === i}
          // code review (guard-step-variants): re-clicking the ALREADY
          // active tab used to still fire `onSelect`, and both call sites
          // reset `keys: []` unconditionally — so re-clicking a tab you
          // were already on silently wiped every key the user had chosen.
          // No-op here instead.
          onClick={() => { if (i !== active) onSelect(i); }}
          style={{
            padding: "4px 10px", borderRadius: 999, fontSize: 11, fontWeight: 600,
            cursor: "pointer",
            border: active === i ? `1px solid ${ACCENT}` : "1px solid #262626",
            backgroundColor: active === i ? ACCENT + "1a" : "transparent",
            color: active === i ? ACCENT : "#888",
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * "Use an existing keyset" (Variant B's option 3B) — the one place this
 * screen would otherwise have to trust a user-typed key list instead of a
 * real resolution. The owner's own spec says "you must provide the keys to
 * use such a keyset", but this project's standing rule (pinned repeatedly
 * this session: absence of evidence must not unlock or mis-lock a
 * funds-bearing key) means the keys come from `describeKeyset`, never a
 * free-form field — same honest "could not be read — unknown, not empty"
 * failure mode `CurrentGuardBlock`'s own `"keyset-ref-unresolved"` branch
 * already uses. Deliberately a plain `<input>`, not the CodeMirror-backed
 * `GuardEntryInput` in `zbom/cfm/inputs.tsx` — this file already avoids
 * that import for its bundle weight (see `predicates.ts`'s own doc
 * comment on lifting the predicate catalogue out instead of importing it).
 */
function ExistingKeysetPicker({
  resolved,
  describeKeyset,
  onResolved,
  onInvalidate,
}: {
  /** The CURRENT choice, when it is already `"use-existing-keyset"` —
   *  lets Back-then-forward (or a resumed run) show what was already
   *  resolved instead of a blank form. */
  resolved: Extract<LegacyPrimeMigrationGuardChoice, { kind: "use-existing-keyset" }> | null;
  describeKeyset?: (qualifiedName: string) => Promise<{ keys: readonly string[]; pred: string }>;
  onResolved: (c: { ns: string; ksn: string; keys: readonly string[]; pred: string }) => void;
  /** code review (guard-step-variants): called the instant the typed ns/ksn
   *  diverges from what `resolved` actually names — the committed choice
   *  must stop being treated as complete the moment it no longer matches
   *  what is on screen, or Continue could lock a keyset the user had
   *  since moved on from without ever re-clicking "Resolve". */
  onInvalidate: () => void;
}): React.ReactElement {
  const [ns, setNs] = useState(resolved?.ns ?? "");
  const [ksn, setKsn] = useState(resolved?.ksn ?? "");
  // "empty" is distinct from "error": the read SUCCEEDED — the keyset is
  // real and resolved, it simply names no keys. Reusing the generic error
  // wrapper's "could not be read... unknown, not empty" wording for this
  // case would say the opposite of what happened.
  const [status, setStatus] = useState<"idle" | "loading" | "error" | "empty">("idle");
  const [error, setError] = useState<string | null>(null);

  // code review (guard-step-variants): ONE comparison, not three copies —
  // a prior round wrote "does the typed ns/ksn still match what `resolved`
  // actually names" inline at every call site, which let the three copies
  // silently drift out of sync with each other.
  const matchesResolved = (nsVal: string, ksnVal: string): boolean =>
    resolved !== null && nsVal.trim() === resolved.ns && ksnVal.trim() === resolved.ksn;

  // Stale the instant the text no longer names what was actually resolved
  // — covers both a genuinely different ns/ksn AND the zero-key case (see
  // `resolve()` below, which never commits a zero-key result in the first
  // place, so `resolved` with zero keys here only ever means "invalidated").
  const isStale = resolved !== null && (resolved.keys.length === 0 || !matchesResolved(ns, ksn));

  // code review (guard-step-variants): a request token, bumped on every
  // edit AND every `resolve()` call — a `describeKeyset` call that lands
  // AFTER the user has already changed ns/ksn (or started a newer resolve)
  // is for text no longer on screen and must never commit. Bumping it on
  // EVERY edit (not only edits `onInvalidate` already reacts to) is what
  // closes the race `onInvalidate` alone cannot: on a first-ever resolve,
  // `resolved` is still `null`, so `onInvalidate` has nothing to invalidate
  // yet, and a late-landing result would otherwise silently commit a
  // keyset the screen no longer shows, with Continue left unblocked.
  const requestIdRef = useRef(0);
  const bumpRequest = (): number => ++requestIdRef.current;

  // code review (guard-step-variants): the request-id guard above only
  // catches a response superseded by a NEWER call from THIS SAME mounted
  // instance — it does nothing once the instance itself is gone. Switching
  // away from the "3B — use an existing keyset" sub-tab unmounts this
  // component entirely, but does not cancel an in-flight `describeKeyset`
  // promise; `onResolved`/`onInvalidate` are ordinary closures bound to the
  // STILL-LIVE parent `onChoose`, so a stale resolve that lands after the
  // user has switched tabs and started a real custom-key selection would
  // otherwise silently overwrite it. This ref is the actual unmount guard.
  const isMountedRef = useRef(true);
  useEffect(() => {
    return () => { isMountedRef.current = false; };
  }, []);

  const handleNsChange = (value: string): void => {
    setNs(value);
    bumpRequest();
    // code review (guard-step-variants): any edit abandons whatever was
    // loading/just-landed for the PREVIOUS text — reset `status` here,
    // immediately, rather than waiting for that now-superseded request to
    // eventually settle and do it. Resetting it from inside `resolve()`'s
    // own discard branch instead would risk stomping on a NEWER resolve
    // that is itself still loading (two overlapping requests is possible
    // once this reset re-enables the button mid-flight) — `status` is only
    // ever touched by whichever actor is currently "latest": an edit here,
    // or `resolve()` for the request it itself started.
    setStatus("idle");
    if (resolved !== null && !matchesResolved(value, ksn)) onInvalidate();
  };
  const handleKsnChange = (value: string): void => {
    setKsn(value);
    bumpRequest();
    setStatus("idle");
    if (resolved !== null && !matchesResolved(ns, value)) onInvalidate();
  };

  const resolve = async (): Promise<void> => {
    const nsTrimmed = ns.trim();
    const ksnTrimmed = ksn.trim();
    if (!nsTrimmed || !ksnTrimmed) return;
    const myRequestId = bumpRequest();
    setStatus("loading");
    setError(null);
    try {
      if (!describeKeyset) throw new Error("no chain connection available on this screen");
      const described = await describeKeyset(`${nsTrimmed}.${ksnTrimmed}`);
      // Superseded by a later edit or a later `resolve()` call — the text
      // this result describes is no longer on screen, so discard it. Never
      // touch `status` here: whatever superseded this call already owns
      // it (an edit already reset it to "idle"; a newer `resolve()` will
      // set its own status when IT settles).
      if (requestIdRef.current !== myRequestId) return;
      // code review (guard-step-variants): the component ITSELF may be
      // gone — switching away from this sub-tab unmounts it, but does not
      // cancel this promise. `onResolved`/`onInvalidate` close over the
      // PARENT's still-live `onChoose`, so calling either here would
      // silently overwrite whatever guard choice the user has since made
      // on a different tab entirely. Never call back into the parent once
      // unmounted — `setStatus`/`setError` on an unmounted component are
      // likewise pointless (and React warns on them), so bail out first.
      if (!isMountedRef.current) return;
      // code review (guard-step-variants): a keyset that genuinely resolves
      // to zero keys is a real but degenerate on-chain shape — recording it
      // as the guard would lock the account out, the exact hazard
      // `CustomKeysetEditor`'s own empty-keys warning exists to prevent.
      if (described.keys.length === 0) {
        setStatus("empty");
        // A re-resolve of an ALREADY-successful ns/ksn that now comes back
        // empty must invalidate that earlier non-empty result — otherwise
        // the stale "Resolved — N key(s)" block keeps rendering right next
        // to this "no keys" warning, AND the committed `guardChoice` stays
        // non-empty, leaving Continue wrongly unblocked.
        if (resolved !== null) onInvalidate();
        return;
      }
      setStatus("idle");
      onResolved({ ns: nsTrimmed, ksn: ksnTrimmed, keys: [...described.keys], pred: described.pred });
    } catch (e) {
      if (requestIdRef.current !== myRequestId) return; // superseded — see above
      if (!isMountedRef.current) return; // unmounted — see above
      setStatus("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div data-testid="legacy-prime-migration-guard-existing-picker"
         style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8, padding: 10,
                  borderRadius: 8, backgroundColor: "#141417", border: "1px solid #262626" }}>
      <label style={{ ...stepParagraphStyle, color: "#8b8b96" }} htmlFor="lpm-existing-ns">
        Namespace
      </label>
      <input id="lpm-existing-ns" data-testid="legacy-prime-migration-guard-existing-ns"
             value={ns} onChange={(e) => handleNsChange(e.target.value)} placeholder="ouronet-ns"
             style={modalInput} />
      <label style={{ ...stepParagraphStyle, color: "#8b8b96" }} htmlFor="lpm-existing-ksn">
        Keyset name
      </label>
      <input id="lpm-existing-ksn" data-testid="legacy-prime-migration-guard-existing-ksn"
             value={ksn} onChange={(e) => handleKsnChange(e.target.value)} placeholder="my-keyset"
             style={modalInput} />
      <button type="button" data-testid="legacy-prime-migration-guard-existing-resolve"
              onClick={() => void resolve()}
              disabled={!ns.trim() || !ksn.trim() || status === "loading"}
              style={{ alignSelf: "flex-start", padding: "6px 14px", borderRadius: 8,
                       border: `1px solid ${ACCENT}40`, backgroundColor: ACCENT + "1a",
                       color: ACCENT, fontWeight: 700, fontSize: 12,
                       cursor: !ns.trim() || !ksn.trim() || status === "loading" ? "not-allowed" : "pointer" }}>
        {status === "loading" ? "Resolving…" : "Resolve"}
      </button>
      {status === "error" ? (
        <p role="alert" data-testid="legacy-prime-migration-guard-existing-error"
           style={{ ...stepParagraphStyle, color: "#fca5a5" }}>
          Its keys could not be read ({error}), so what it authorises is unknown &mdash; not empty.
        </p>
      ) : null}
      {status === "empty" ? (
        <p role="alert" data-testid="legacy-prime-migration-guard-existing-empty"
           style={{ ...stepParagraphStyle, color: "#fca5a5" }}>
          That keyset names no keys &mdash; using it as your guard would lock you out.
        </p>
      ) : null}
      {/* code review (guard-step-variants): `status === "error"` is excluded
          too — re-resolving the SAME, already-resolved ns/ksn and getting a
          transient failure must not show the stale success block alongside
          the new error, which would read as "it's fine, ignore that". */}
      {resolved && !isStale && status !== "error" ? (
        <div data-testid="legacy-prime-migration-guard-existing-resolved"
             style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <p style={stepParagraphStyle}>
            Resolved &mdash; {resolved.ns}.{resolved.ksn}: {resolved.keys.length} key(s) under{" "}
            {resolved.pred}:
          </p>
          {resolved.keys.map((k) => <KeyLine key={k} label="" value={k} />)}
        </div>
      ) : null}
    </div>
  );
}

/** code review (guard-step-variants): the ready/loading/error preview of
 *  the recommended guard key — used by BOTH `GuardVariantA`'s two
 *  recommended-tier options, `GuardVariantB`'s one, AND `GuardSection`'s
 *  own pre-existing fallback option. Lifted to module scope (same tier as
 *  `KeyLine`/`MutedPillBadge`) instead of each caller re-typing (or, in
 *  `GuardVariantA`'s case, re-closing-over) the identical three-way
 *  branch — this is the same "one definition, not N copies" pattern
 *  `MutedPillBadge` was already consolidated into earlier this topic.
 *  Pure function of `preview`, so lifting it changes none of the three
 *  call sites' rendered output — the fallback's own copy stays
 *  byte-identical, satisfying this topic's design.md requirement. */
function GuardKeyPreviewBlock({ preview }: { preview: MasterKeyPreview }): React.ReactElement {
  return preview.status === "ready" ? (
    <KeyLine label="Guard key" value={preview.key1}
             testId="legacy-prime-migration-guard-recommended-key" />
  ) : preview.status === "loading" ? (
    <p style={stepParagraphStyle}>Deriving the guard key&hellip;</p>
  ) : (
    <p role="alert" style={{ ...stepParagraphStyle, color: "#fca5a5" }}>
      Could not derive the guard key: {preview.message}
    </p>
  );
}

/**
 * Variant A — the account's current guard is a keyset REFERENCE
 * (`resolution.kind` is `"keyset-ref"` or `"keyset-ref-unresolved"`).
 * Owner's own numbering, verbatim: 0 keep / 1 update the keyset
 * (DALOS Highly Recommended) / 2 switch to a direct keyset (DALOS
 * Recommended) / 3 custom (Expert Mode, 3A keep-ref-custom / 3B
 * direct-custom).
 */
function GuardVariantA({
  preview,
  choice,
  onChoose,
  allSeeds,
}: {
  preview: MasterKeyPreview;
  choice: LegacyPrimeMigrationGuardChoice | null;
  onChoose: (c: LegacyPrimeMigrationGuardChoice) => void;
  allSeeds: readonly IStoaChainSeed[];
}): React.ReactElement {
  const isKeep = choice?.kind === "keep";
  const isUpdateRecommended = choice?.kind === "update-keyset-recommended";
  const isDirectRecommended = choice?.kind === "recommended-single-key";
  const isCustomGroup = choice?.kind === "update-keyset-custom" || choice?.kind === "custom";
  // Sub-tab 0 = "keep the reference, update it" (3A), 1 = "switch to
  // direct" (3B) — derived from `choice.kind` so there is no second,
  // redundant piece of state to keep in sync with it.
  const activeSub = choice?.kind === "custom" ? 1 : 0;

  return (
    <>
      <div data-testid="legacy-prime-migration-guard-option-keep"
           role="radio" aria-selected={isKeep} style={radioOptionStyle(isKeep)}>
        <button type="button" style={radioOptionHeaderButtonStyle}
                onClick={() => onChoose({ kind: "keep" })}>
          <OptionNumberBadge n={0} />
          Keep the keyset as is
          <NotRecommendedBadge />
        </button>
        <p style={stepParagraphStyle}>
          The on-chain keyset is never modified by this migration. Instead, every key it names
          that this codex holds becomes non-removable, along with the seed holding it.
        </p>
      </div>

      <div data-testid="legacy-prime-migration-guard-option-update-keyset"
           role="radio" aria-selected={isUpdateRecommended} style={radioOptionStyle(isUpdateRecommended)}>
        <button type="button" style={radioOptionHeaderButtonStyle}
                onClick={() => onChoose({ kind: "update-keyset-recommended" })}>
          <OptionNumberBadge n={1} />
          Keep the reference, update the keyset
          <DalosHighlyRecommendedBadge />
        </button>
        <p style={stepParagraphStyle}>
          The reference stays exactly where it is; the keyset it points at is updated to a{" "}
          <strong>keys-all</strong> keyset over one key: position 1 of the {MASTER_CHAINWEB_SEED},
          via {STOIC_DALOS_DERIVATION_LABEL}. Any other account sharing this reference is upgraded
          the same moment.
        </p>
        {isUpdateRecommended ? <GuardKeyPreviewBlock preview={preview} /> : null}
      </div>

      <div data-testid="legacy-prime-migration-guard-option-recommended"
           role="radio" aria-selected={isDirectRecommended} style={radioOptionStyle(isDirectRecommended)}>
        <button type="button" style={radioOptionHeaderButtonStyle}
                onClick={() => onChoose({ kind: "recommended-single-key" })}>
          <OptionNumberBadge n={2} />
          Replace the reference with a single-key keyset
          <DalosRecommendedBadge />
        </button>
        <p style={stepParagraphStyle}>
          A <strong>keys-all</strong> keyset over one key: position 1 of the{" "}
          {MASTER_CHAINWEB_SEED}, via {STOIC_DALOS_DERIVATION_LABEL}.
        </p>
        {isDirectRecommended ? <GuardKeyPreviewBlock preview={preview} /> : null}
      </div>

      <div data-testid="legacy-prime-migration-guard-option-custom"
           role="radio" aria-selected={isCustomGroup} style={radioOptionStyle(isCustomGroup)}>
        <button type="button" style={radioOptionHeaderButtonStyle}
                // code review (guard-step-variants): re-clicking this header
                // while already in the custom group used to re-fire
                // `onChoose` with `keys: []`, wiping whatever the user had
                // already selected below. No-op once already selected.
                onClick={() => {
                  if (!isCustomGroup) onChoose({ kind: "update-keyset-custom", keys: [], pred: "keys-all" });
                }}>
          <OptionNumberBadge n={3} />
          Define a custom guard
          <ExpertModeBadge />
        </button>
        <p style={stepParagraphStyle}>
          Choose any keys this codex holds and any predicate. Every chosen key, and the seed
          holding it, becomes non-removable.
        </p>
        {isCustomGroup ? (
          <>
            <SubChoiceToggle
              options={[
                { testId: "legacy-prime-migration-guard-custom-sub-update", label: "3A — Keep the reference, update it" },
                { testId: "legacy-prime-migration-guard-custom-sub-direct", label: "3B — Switch to a direct keyset" },
              ]}
              active={activeSub}
              onSelect={(i) => onChoose(i === 0
                ? { kind: "update-keyset-custom", keys: [], pred: "keys-all" }
                : { kind: "custom", keys: [], pred: "keys-all" })}
            />
            <CustomKeysetEditor
              allSeeds={allSeeds}
              selectedKeys={
                choice?.kind === "update-keyset-custom" || choice?.kind === "custom" ? choice.keys : []
              }
              pred={
                choice?.kind === "update-keyset-custom" || choice?.kind === "custom" ? choice.pred : "keys-all"
              }
              onChange={(keys, pred) =>
                onChoose({ kind: activeSub === 0 ? "update-keyset-custom" : "custom", keys, pred })
              }
            />
          </>
        ) : null}
      </div>
    </>
  );
}

/**
 * Variant B — the account's current guard is a direct keyset or absent
 * (`resolution.kind` is `"keyset"` or `"none"`). Owner's own numbering,
 * verbatim: 1 switch to a direct keyset (DALOS Recommended) / 2 keep /
 * 3 custom (Expert Mode, 3A direct-custom / 3B use an existing keyset).
 */
function GuardVariantB({
  preview,
  choice,
  onChoose,
  allSeeds,
  describeKeyset,
}: {
  preview: MasterKeyPreview;
  choice: LegacyPrimeMigrationGuardChoice | null;
  onChoose: (c: LegacyPrimeMigrationGuardChoice) => void;
  allSeeds: readonly IStoaChainSeed[];
  describeKeyset?: (qualifiedName: string) => Promise<{ keys: readonly string[]; pred: string }>;
}): React.ReactElement {
  const isDirectRecommended = choice?.kind === "recommended-single-key";
  const isKeep = choice?.kind === "keep";
  const isCustomGroup = choice?.kind === "custom" || choice?.kind === "use-existing-keyset";
  // Sub-tab 0 = "a custom on-the-spot keyset" (3A), 1 = "use an existing
  // keyset" (3B). Unlike Variant A's two sub-choices (which both have a
  // real `choice.kind` the instant you pick them), "use an existing
  // keyset" has NO sensible choice to record until `describeKeyset`
  // resolves something real — so which sub-tab is showing cannot be
  // derived from `choice` alone while the picker is still empty. `uiSub`
  // tracks the tab the user clicked; it is cleared (falls back to
  // deriving from `choice`) once a real "use-existing-keyset" choice
  // lands, so a resumed/pre-set choice still opens on the right tab.
  const [uiSub, setUiSub] = React.useState<number | null>(null);
  const activeSub = uiSub ?? (choice?.kind === "use-existing-keyset" ? 1 : 0);

  return (
    <>
      <div data-testid="legacy-prime-migration-guard-option-recommended"
           role="radio" aria-selected={isDirectRecommended} style={radioOptionStyle(isDirectRecommended)}>
        <button type="button" style={radioOptionHeaderButtonStyle}
                onClick={() => onChoose({ kind: "recommended-single-key" })}>
          <OptionNumberBadge n={1} />
          Upgrade to a single-key keyset
          <DalosRecommendedBadge />
        </button>
        <p style={stepParagraphStyle}>
          A <strong>keys-all</strong> keyset over one key: position 1 of the{" "}
          {MASTER_CHAINWEB_SEED}, via {STOIC_DALOS_DERIVATION_LABEL}.
        </p>
        <GuardKeyPreviewBlock preview={preview} />
      </div>

      <div data-testid="legacy-prime-migration-guard-option-keep"
           role="radio" aria-selected={isKeep} style={radioOptionStyle(isKeep)}>
        <button type="button" style={radioOptionHeaderButtonStyle}
                onClick={() => onChoose({ kind: "keep" })}>
          <OptionNumberBadge n={2} />
          Keep this guard exactly as it is
          <NotRecommendedBadge />
        </button>
        <p style={stepParagraphStyle}>
          Nothing changes. Every key this guard names that the codex holds becomes non-removable,
          along with the seed holding it.
        </p>
      </div>

      <div data-testid="legacy-prime-migration-guard-option-custom"
           role="radio" aria-selected={isCustomGroup} style={radioOptionStyle(isCustomGroup)}>
        <button type="button" style={radioOptionHeaderButtonStyle}
                // code review (guard-step-variants): see GuardVariantA's
                // identical guard — re-clicking this header while already
                // in the custom group used to wipe the user's chosen keys.
                onClick={() => {
                  if (!isCustomGroup) onChoose({ kind: "custom", keys: [], pred: "keys-all" });
                }}>
          <OptionNumberBadge n={3} />
          Define a custom guard
          <ExpertModeBadge />
        </button>
        <p style={stepParagraphStyle}>
          Choose any keys this codex holds and any predicate &mdash; or point this guard at a
          keyset you already defined on a namespace. Every chosen key, and the seed holding it,
          becomes non-removable.
        </p>
        {isCustomGroup ? (
          <>
            <SubChoiceToggle
              options={[
                { testId: "legacy-prime-migration-guard-custom-sub-direct", label: "3A — Custom on-the-spot keyset" },
                { testId: "legacy-prime-migration-guard-custom-sub-existing", label: "3B — Use an existing keyset" },
              ]}
              active={activeSub}
              onSelect={(i) => {
                setUiSub(i);
                // code review (guard-step-variants): this used to reset
                // ONLY when switching TO 3A (`i === 0`) — switching TO 3B
                // left whatever non-empty "custom" choice 3A had selected
                // still committed, even though the screen now shows a
                // blank "use an existing keyset" form with no indication
                // anything is chosen. Switching sub-tab must start THAT
                // tab's selection fresh in BOTH directions, matching the
                // comment's own promise and GuardVariantA's own symmetric
                // version of this same toggle.
                onChoose(i === 0
                  ? { kind: "custom", keys: [], pred: "keys-all" }
                  : { kind: "use-existing-keyset", ns: "", ksn: "", keys: [], pred: "keys-all" });
              }}
            />
            {activeSub === 0 ? (
              <CustomKeysetEditor
                allSeeds={allSeeds}
                selectedKeys={choice?.kind === "custom" ? choice.keys : []}
                pred={choice?.kind === "custom" ? choice.pred : "keys-all"}
                onChange={(keys, pred) => onChoose({ kind: "custom", keys, pred })}
              />
            ) : (
              <ExistingKeysetPicker
                resolved={choice?.kind === "use-existing-keyset" ? choice : null}
                describeKeyset={describeKeyset}
                onResolved={(c) => { setUiSub(null); onChoose({ kind: "use-existing-keyset", ...c }); }}
                onInvalidate={() =>
                  onChoose({ kind: "use-existing-keyset", ns: "", ksn: "", keys: [], pred: "keys-all" })
                }
              />
            )}
          </>
        ) : null}
      </div>
    </>
  );
}

/**
 * Dispatches to {@link GuardVariantA} / {@link GuardVariantB} by what the
 * account's CURRENT guard actually is (`docs/work/guard-step-variants/
 * design.md`) — a keyset REFERENCE vs. a direct keyset (or none). On
 * `"unsupported"`/`"unknown"` (a capability/user guard, or a shape this
 * code does not recognise), rendering is BYTE-IDENTICAL to before that
 * topic: there is nothing variant-specific to offer when the current guard
 * isn't a keyset at all, so this keeps the original 3-option fallback
 * unchanged — including its own copy (`isRef` was always `false` for
 * these two cases before, so the fallback's wording never branched on it).
 */
function GuardSection({
  resolution,
  preview,
  choice,
  onChoose,
  allSeeds,
  describeKeyset,
}: {
  resolution: GuardKeyResolution | null;
  preview: MasterKeyPreview;
  choice: LegacyPrimeMigrationGuardChoice | null;
  onChoose: (c: LegacyPrimeMigrationGuardChoice) => void;
  allSeeds: readonly IStoaChainSeed[];
  describeKeyset?: (qualifiedName: string) => Promise<{ keys: readonly string[]; pred: string }>;
}): React.ReactElement {
  const isVariantA = resolution?.kind === "keyset-ref" || resolution?.kind === "keyset-ref-unresolved";
  const isVariantB = resolution?.kind === "keyset" || resolution?.kind === "none";

  const isRec = choice?.kind === "recommended-single-key";
  const isKeep = choice?.kind === "keep";
  const isCustom = choice?.kind === "custom";

  return (
    <div data-testid="legacy-prime-migration-guard-section"
         style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <p style={{ ...stepParagraphStyle, fontSize: 13, color: "#d2d3d4" }}>
        <strong>Guard.</strong> What is allowed to authorise changes to your{" "}
        {OURONET_CODEX_MASTER}.
      </p>

      <div style={{ padding: 10, borderRadius: 8, backgroundColor: "#18181B", border: "1px solid #262626" }}>
        <CurrentGuardBlock resolution={resolution} />
      </div>

      {isVariantA ? (
        <GuardVariantA preview={preview} choice={choice} onChoose={onChoose} allSeeds={allSeeds} />
      ) : isVariantB ? (
        <GuardVariantB preview={preview} choice={choice} onChoose={onChoose} allSeeds={allSeeds}
                       describeKeyset={describeKeyset} />
      ) : (
        <>
          <div data-testid="legacy-prime-migration-guard-option-recommended"
               role="radio" aria-selected={isRec} style={radioOptionStyle(isRec)}>
            <button type="button" style={radioOptionHeaderButtonStyle}
                    onClick={() => onChoose({ kind: "recommended-single-key" })}>
              <OptionNumberBadge n={1} />
              Upgrade to a single-key keyset
              <RecommendedBadge />
            </button>
            <p style={stepParagraphStyle}>
              A <strong>keys-all</strong> keyset over one key: position 1 of the{" "}
              {MASTER_CHAINWEB_SEED}, via {STOIC_DALOS_DERIVATION_LABEL}.
            </p>
            <GuardKeyPreviewBlock preview={preview} />
          </div>

          <div data-testid="legacy-prime-migration-guard-option-keep"
               role="radio" aria-selected={isKeep} style={radioOptionStyle(isKeep)}>
            <button type="button" style={radioOptionHeaderButtonStyle}
                    onClick={() => onChoose({ kind: "keep" })}>
              <OptionNumberBadge n={2} />
              Keep this guard exactly as it is
            </button>
            <p style={stepParagraphStyle}>
              Nothing changes. Every key this guard names that the codex holds becomes
              non-removable, along with the seed holding it.
            </p>
          </div>

          <div data-testid="legacy-prime-migration-guard-option-custom"
               role="radio" aria-selected={isCustom} style={radioOptionStyle(isCustom)}>
            <button type="button" style={radioOptionHeaderButtonStyle}
                    // code review (guard-step-variants): the same re-click-
                    // wipes-keys guard applied to GuardVariantA/GuardVariantB's
                    // identical header — this fallback branch had been left
                    // with the un-guarded version. No rendering output
                    // changes (still "byte-identical" per the design doc),
                    // only the already-selected re-click's side effect does.
                    onClick={() => {
                      if (!isCustom) onChoose({ kind: "custom", keys: [], pred: "keys-all" });
                    }}>
              <OptionNumberBadge n={3} />
              Define a custom keyset
              <MutedPillBadge>Advanced</MutedPillBadge>
            </button>
            <p style={stepParagraphStyle}>
              Choose any keys this codex holds and any predicate. Every chosen key, and the seed
              holding it, becomes non-removable.
            </p>
            {isCustom ? (
              <CustomKeysetEditor
                allSeeds={allSeeds}
                selectedKeys={choice.kind === "custom" ? choice.keys : []}
                pred={choice.kind === "custom" ? choice.pred : "keys-all"}
                onChange={(keys, pred) => onChoose({ kind: "custom", keys, pred })}
              />
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

/** Page 3 — the derivation-METHOD choice (see the module doc's "Page 3"
 *  section for when each option is offered and the words/derivation
 *  transparency block's display rules). Purely a selection UI, same
 *  discipline as {@link AccountStep}: choosing an option only calls
 *  `onChoose`, never performs any key derivation or other side effect. */
/**
 * Step 3A — Payment Key Setup. Was HALF of the combined `KeysStep` (with
 * guard and the derivation-method choice) until the owner's correction,
 * this session: *"i said made step 3A and step 3B as individual steps, not
 * both on the same step 3 page."* The derivation-method choice lives here
 * rather than on the guard page — it is the method that produces BOTH
 * position 0 (payment) and position 1 (guard), but choosing "derive" on
 * THIS page already sets it by default (see the call site's
 * `onChoosePayment`), so it reads as this page's own advanced option
 * rather than a third, separate screen the owner never asked for.
 *
 * `preview` is now a PROP, not derived locally — lifted to the main
 * component so payment, guard, and review all read the SAME decrypt
 * instead of each page re-decrypting the chosen account on its own mount
 * (which splitting this into two pages would otherwise double).
 */
function PaymentStep({
  accountChoice,
  currentPrimeAccount,
  allAccounts,
  allSeeds,
  preview,
  choice,
  onChoose,
  paymentChoice,
  onChoosePayment,
}: {
  accountChoice: LegacyPrimeMigrationAccountChoice | null;
  currentPrimeAccount: IOuroAccount | null;
  allAccounts: readonly IOuroAccount[];
  allSeeds: readonly IStoaChainSeed[];
  preview: MasterKeyPreview;
  choice: LegacyPrimeMigrationKeysChoice | null;
  onChoose: (choice: LegacyPrimeMigrationKeysChoice) => void;
  paymentChoice: LegacyPrimeMigrationPaymentChoice | null;
  onChoosePayment: (c: LegacyPrimeMigrationPaymentChoice) => void;
}): React.ReactElement {
  const currentPaymentKey = currentPaymentKeyOf(allSeeds);
  const paymentTies = currentPaymentKey ? findKeyTies(allSeeds, currentPaymentKey) : null;
  // "Advanced" (native-format) derivation is offered ONLY when the Page-2-
  // chosen account's own words are dictionary-gated ("12-words"/
  // "24-words") — never for "write-seed"-origin or freshly-typed words
  // (there is no native dictionary format for arbitrary words to fall back
  // to). See the module doc's "Page 3" section.
  const chosenOriginSeedTab = resolveChosenAccountOriginSeedTab(accountChoice, currentPrimeAccount, allAccounts);
  const canOfferAdvanced = chosenOriginSeedTab === "12-words" || chosenOriginSeedTab === "24-words";

  const isStoicDalosSelected = choice?.kind === "stoic-dalos";
  const isAdvancedSelected = choice?.kind === "advanced-native";

  return (
    <div
      data-testid="legacy-prime-migration-keys"
      style={{ display: "flex", flexDirection: "column", gap: 14 }}
    >
      <PaymentKeySection
        currentKey={currentPaymentKey}
        ties={paymentTies}
        preview={preview}
        choice={paymentChoice}
        onChoose={onChoosePayment}
      />

      <p style={{ ...stepParagraphStyle, fontSize: 13, color: "#d2d3d4", marginTop: 6 }}>
        <strong>Derivation method.</strong> How those keys are produced from the words.
      </p>

      <div
        data-testid="legacy-prime-migration-keys-option-stoic-dalos"
        role="radio"
        aria-selected={isStoicDalosSelected}
        style={radioOptionStyle(isStoicDalosSelected)}
      >
        <button
          type="button"
          style={radioOptionHeaderButtonStyle}
          onClick={() => onChoose({ kind: "stoic-dalos" })}
        >
          <OptionNumberBadge n={1} />
          {STOIC_DALOS_DERIVATION_LABEL}
          <RecommendedBadge />
        </button>
        <p style={stepParagraphStyle}>
          Position 0 derives the payment key, position 1 derives the guard key — a
          keys-all guard over both. Always available, always the default.
        </p>
      </div>

      {canOfferAdvanced ? (
        <div
          data-testid="legacy-prime-migration-keys-option-advanced"
          role="radio"
          aria-selected={isAdvancedSelected}
          style={radioOptionStyle(isAdvancedSelected)}
        >
          <button
            type="button"
            style={radioOptionHeaderButtonStyle}
            onClick={() => onChoose({ kind: "advanced-native" })}
          >
            <OptionNumberBadge n={2} />
            Advanced (native format) derivation
            <NotRecommendedBadge />
          </button>
          <p style={stepParagraphStyle}>
            Derives using this word format&apos;s own native mnemonic pipeline instead of{" "}
            {STOIC_DALOS_DERIVATION_LABEL}.
          </p>
        </div>
      ) : null}

      {choice ? <KeysWordsBlock accountChoice={accountChoice} keysChoice={choice} /> : null}
    </div>
  );
}

/**
 * Step 3B — Ouronet Account Guard Setup. The other half of the old combined
 * `KeysStep` — its own page now, reached by its own Continue click from
 * {@link PaymentStep}, per the owner's correction (see that component's
 * own doc comment). `preview` is the SAME lifted value `PaymentStep` and
 * the review step read — this page never re-decrypts the account.
 */
function GuardStep({
  allSeeds,
  preview,
  guardResolution,
  guardChoice,
  onChooseGuard,
  describeKeyset,
}: {
  allSeeds: readonly IStoaChainSeed[];
  preview: MasterKeyPreview;
  /** Lifted to the main component (see its own doc comment) — this step no
   *  longer resolves the guard itself, so navigating away and back to this
   *  page never re-triggers a chain read, and `runFinalize` can read the
   *  SAME resolved value for the "keep" lock (see that function's own
   *  note). */
  guardResolution: GuardKeyResolution | null;
  guardChoice: LegacyPrimeMigrationGuardChoice | null;
  onChooseGuard: (c: LegacyPrimeMigrationGuardChoice) => void;
  /** Restored as an explicit prop (guard-step-variants,
   *  docs/work/guard-step-variants/design.md) — needed again for Variant
   *  B's "use an existing keyset" picker, a NEW use of `describeKeyset`
   *  distinct from the account-guard-resolving effect this step no longer
   *  owns (that one is lifted to the parent; this one resolves whatever
   *  `ns.ksn` the user TYPES at selection time). */
  describeKeyset?: (qualifiedName: string) => Promise<{ keys: readonly string[]; pred: string }>;
}): React.ReactElement {
  return (
    <div
      data-testid="legacy-prime-migration-guard-step"
      style={{ display: "flex", flexDirection: "column", gap: 14 }}
    >
      <GuardSection
        resolution={guardResolution}
        preview={preview}
        choice={guardChoice}
        onChoose={onChooseGuard}
        allSeeds={allSeeds}
        describeKeyset={describeKeyset}
      />
    </div>
  );
}


/**
 * STAGE 1 -> 2 GATE. Everything chosen, on one screen, before a single byte
 * is written to the codex.
 *
 * Reports the CONSEQUENCES, not just the selections: which seed and position
 * become non-removable is a fact about this codex that the user cannot infer
 * from "keys-all over position 1", and it is the one that is hard to undo.
 */
function ReviewStep({
  accountLabel,
  currentPaymentKey,
  paymentChoice,
  guardChoice,
  preview,
  seedName,
}: {
  accountLabel: string | null;
  currentPaymentKey: string | null;
  paymentChoice: LegacyPrimeMigrationPaymentChoice | null;
  guardChoice: LegacyPrimeMigrationGuardChoice | null;
  preview: MasterKeyPreview;
  seedName: string | null;
}): React.ReactElement {
  const derived = preview.status === "ready" ? preview : null;
  const newPayment =
    paymentChoice?.kind === "stoic-dalos-position-0" ? derived?.key0 ?? null : currentPaymentKey;
  // guard-step-variants (docs/work/guard-step-variants/design.md):
  // "update-keyset-recommended" derives the SAME position-1 key
  // "recommended-single-key" does — just via a different eventual on-chain
  // action (update the reference's keyset, not switch away from it).
  // "update-keyset-custom"/"use-existing-keyset" already carry their own
  // real `keys` directly on the choice, same as "custom" does.
  const guardKeys =
    guardChoice?.kind === "recommended-single-key" || guardChoice?.kind === "update-keyset-recommended"
      ? (derived ? [derived.key1] : [])
      : guardChoice?.kind === "custom"
        || guardChoice?.kind === "update-keyset-custom"
        || guardChoice?.kind === "use-existing-keyset"
        ? guardChoice.keys
        : null;
  const guardPred =
    guardChoice?.kind === "custom"
      || guardChoice?.kind === "update-keyset-custom"
      || guardChoice?.kind === "use-existing-keyset"
      ? guardChoice.pred
      : "keys-all";

  return (
    <div data-testid="legacy-prime-migration-review"
         style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <p style={{ ...stepParagraphStyle, fontSize: 13, color: "#d2d3d4" }}>
        Everything you have chosen, before anything is written. Nothing has touched your codex
        yet &mdash; going back changes any of it freely.
      </p>

      <div data-testid="legacy-prime-migration-review-account" style={reviewBoxStyle}>
        <p style={{ ...stepParagraphStyle, color: "#8b8b96" }}>{OURONET_CODEX_MASTER}</p>
        <p style={{ ...stepParagraphStyle, color: "#d2d3d4" }}>{accountLabel ?? "(not chosen)"}</p>
      </div>

      <div data-testid="legacy-prime-migration-review-payment" style={reviewBoxStyle}>
        <p style={{ ...stepParagraphStyle, color: "#8b8b96" }}>Payment key</p>
        {paymentChoice?.kind === "keep" ? (
          <p style={stepParagraphStyle}>Unchanged.</p>
        ) : (
          <>
            {currentPaymentKey ? <KeyLine label="FROM" value={currentPaymentKey} /> : null}
            {newPayment ? (
              <KeyLine label="TO" value={newPayment} />
            ) : (
              <p style={stepParagraphStyle}>TO &mdash; still deriving&hellip;</p>
            )}
          </>
        )}
      </div>

      <div data-testid="legacy-prime-migration-review-guard" style={reviewBoxStyle}>
        <p style={{ ...stepParagraphStyle, color: "#8b8b96" }}>Guard</p>
        {guardChoice?.kind === "keep" ? (
          <p style={stepParagraphStyle}>Unchanged.</p>
        ) : guardKeys && guardKeys.length > 0 ? (
          <>
            <p style={stepParagraphStyle}>
              A keyset of {guardKeys.length} key(s) under {guardPred}.
            </p>
            {guardKeys.map((k) => <KeyLine key={k} label="" value={k} />)}
          </>
        ) : (
          <p style={stepParagraphStyle}>Still deriving&hellip;</p>
        )}
      </div>

      <div data-testid="legacy-prime-migration-review-consequences" style={reviewBoxStyle}>
        <p style={{ ...stepParagraphStyle, color: "#8b8b96" }}>What this makes permanent</p>
        <p style={stepParagraphStyle}>
          {seedName
            ? `${seedName}, and the key positions your master ends up using, become non-removable from this codex.`
            : "The seed and key positions your master ends up using become non-removable from this codex."}
        </p>
        <p style={{ ...stepParagraphStyle, color: "#ceac5f" }}>
          Moving your funds onto the new keys is a separate step after this, and this codex is
          not marked eligible until that is done.
        </p>
      </div>
    </div>
  );
}

const reviewBoxStyle: React.CSSProperties = {
  padding: 10,
  borderRadius: 8,
  backgroundColor: "#18181B",
  border: "1px solid #262626",
  display: "flex",
  flexDirection: "column",
  gap: 4,
};

/**
 * Page 7 ("finalize", T8, Wave 5) — resolves the `{accountId, bitString,
 * words, method}` triple `ensurePrimeSeedAccountPairingAndPromote` (T7,
 * `state/store.ts`) needs, from whichever Page-2/Page-3 choice is active —
 * reusing the SAME account objects already in this component's scope
 * (`currentPrimeAccount`/`allAccounts`), never re-fetching anything. See
 * the module doc's "Page 7" section for the full reasoning; summarized:
 *
 *  - `"new-words"` is NOT YET SUPPORTED here (a real, flagged gap — see the
 *    module doc) — `ensurePrimeSeedAccountPairingAndPromote` requires an
 *    EXISTING `IOuroAccount` id, and Page 2's `"new-words"` choice never
 *    creates one.
 *  - `"keep-current"` / `"existing"` decrypt the chosen account's own
 *    `secret` (via `getPassword()` → `smartDecrypt`, the SAME seam
 *    `SeedWordsTab.tsx`'s `revealPrivateKey`/`handleView` already use) —
 *    this is the first point in the wizard that is allowed to, since
 *    Finalize is a real action, not Page 2/3's selection-only UI. Requires
 *    `originSeedTab !== undefined` (a real, known word origin); an account
 *    with no known words (the `NO_KNOWN_WORDS_WARNING_TEXT` case) cannot be
 *    finalized at all.
 *  - `bitString`'s meaning differs by method, matching
 *    `ensurePrimeSeedAccountPairingAndPromote`'s own landed implementation
 *    exactly: for `"stoic-dalos"`, the real DALOS encoding
 *    (`seedWordsToBitString(words)`); for `"advanced-native"`, the plain
 *    mnemonic text itself (that action's own key derivation ignores
 *    `bitString` for this method, using `words.join(" ")` instead — but
 *    STILL persists `bitString` verbatim as a newly-created seed's
 *    `secret`, so this must be whatever a chainweaver/koala seed's `secret`
 *    is supposed to decrypt back to: the mnemonic, never a DALOS
 *    bitstring).
 */
type FinalizeDerivationResult =
  | { ok: true; accountId: string; bitString: string; words: readonly string[]; method: "stoic-dalos" | "advanced-native" }
  | { ok: false; error: string };

async function resolveFinalizeDerivation(args: {
  accountChoice: LegacyPrimeMigrationAccountChoice | null;
  keysChoice: LegacyPrimeMigrationKeysChoice | null;
  currentPrimeAccount: IOuroAccount | null;
  allAccounts: readonly IOuroAccount[];
  getPassword: () => string;
}): Promise<FinalizeDerivationResult> {
  const { accountChoice, keysChoice, currentPrimeAccount, allAccounts, getPassword } = args;

  if (!keysChoice) {
    return { ok: false, error: "No payment/guard key derivation method was chosen." };
  }
  if (accountChoice?.kind === "new-words") {
    return {
      ok: false,
      error:
        "Finalizing a brand-new account isn't available in this build yet — go back and choose your current account or an existing one instead.",
    };
  }

  const targetAccount: IOuroAccount | null =
    accountChoice?.kind === "existing"
      ? allAccounts.find((a) => a.id === accountChoice.accountId) ?? null
      : currentPrimeAccount;
  if (!targetAccount) {
    return { ok: false, error: "No Prime Ouronet Account was chosen." };
  }
  if (targetAccount.originSeedTab === undefined) {
    return {
      ok: false,
      error:
        "This account has no known recovery words on record — there is nothing to derive the Prime Chainweb Seed from.",
    };
  }

  let wordsPlain: string;
  try {
    wordsPlain = await smartDecrypt(targetAccount.secret, getPassword());
  } catch (e) {
    return {
      ok: false,
      error:
        e instanceof Error
          ? `Could not decrypt this account's words: ${e.message}`
          : "Could not decrypt this account's words.",
    };
  }
  const words = wordsPlain.trim().split(/\s+/).filter(Boolean);
  const bitString = keysChoice.kind === "stoic-dalos" ? seedWordsToBitString(words) : wordsPlain;
  return { ok: true, accountId: targetAccount.id, bitString, words, method: keysChoice.kind };
}

/** Page 7's own internal status machine — `"running"` while
 *  {@link resolveFinalizeDerivation}/`ensurePrimeSeedAccountPairingAndPromote`/
 *  `ensurePrimeArweaveSeed`/`stampPrimeAlignmentAligned` are in flight,
 *  settling into exactly one of the other four terminal states. */
/**
 * `"committed-pending-transactions"` replaces the old `"sweep-needed"` dead
 * end. The difference is real, not cosmetic: the old state meant "nothing
 * was written and nothing will be", while this one means "every local
 * decision IS written; only the money has still to move". Stage 3 resumes
 * from exactly that state.
 */
type FinalizeStatus =
  | "running"
  /** Eligible — stage 2 is complete and the codex really can be restored
   *  from its words — but the key changes the user CHOSE are not on chain
   *  yet (stage 3A). Distinct from `"success"` so the screen can say so
   *  rather than implying a rotation that has not happened. */
  | "eligible-rotation-outstanding"
  | "arweave-unavailable"
  | "error"
  | "success";

const finalizeInfoBoxStyle: React.CSSProperties = {
  padding: "12px 14px",
  borderRadius: 10,
  border: "1px solid #26262680",
  backgroundColor: "#ffffff08",
  color: "#d2d3d4",
  fontSize: 13,
  lineHeight: 1.6,
};

const finalizeSuccessBoxStyle: React.CSSProperties = {
  padding: "12px 14px",
  borderRadius: 10,
  border: `1px solid ${ACCENT}40`,
  backgroundColor: ACCENT + "15",
  color: ACCENT,
  fontSize: 13,
  fontWeight: 700,
  lineHeight: 1.6,
};

/** Page 7 ("finalize") — renders exactly one of the five states
 *  {@link FinalizeStatus} can be in. A single shared "Close" button for
 *  every TERMINAL state (every state but `"running"`) calls `onClose` —
 *  there is nothing more for the user to decide once Finalize has settled,
 *  per the module doc's "Page 7" section. */
function FinalizeStep({
  status,
  errorMessage,
  onClose,
  committed,
}: {
  status: FinalizeStatus;
  errorMessage: string | null;
  onClose: () => void;
  /** What stage 2 actually wrote, so the result screen reports facts rather
   *  than a generic "done". */
  committed?: MigrationCommitRecord;
}): React.ReactElement {
  return (
    <div
      data-testid="legacy-prime-migration-finalize"
      style={{ display: "flex", flexDirection: "column", gap: 14 }}
    >
      {status === "running" ? (
        <p data-testid="legacy-prime-migration-finalize-running" style={stepParagraphStyle}>
          Finalizing your Prime trio…
        </p>
      ) : null}

      {status === "eligible-rotation-outstanding" ? (
        <div
          data-testid="legacy-prime-migration-finalize-committed"
          style={{ display: "flex", flexDirection: "column", gap: 8 }}
        >
          <div style={finalizeInfoBoxStyle}>
            <p style={{ margin: 0, fontWeight: 700 }}>
              This codex is now eligible.
            </p>
            <p style={{ ...stepParagraphStyle, marginTop: 6 }}>
              Your seed words alone can now find and unlock a backup of it. That is what
              eligibility means, and it is done.
            </p>
          </div>
          <ul
            data-testid="legacy-prime-migration-commit-summary"
            style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}
          >
            {committed?.seedId ? (
              <li style={stepParagraphStyle}>
                Your {OURONET_CODEX_MASTER} and its {MASTER_CHAINWEB_SEED} are paired.
              </li>
            ) : null}
            {committed?.rowWritten ? (
              <li style={stepParagraphStyle}>The {CODEX_MASTER_SEED} row is recorded.</li>
            ) : null}
            {committed?.locksWritten ? (
              <li style={stepParagraphStyle}>
                The keys your master depends on are now non-removable.
              </li>
            ) : null}
            <li data-testid="legacy-prime-migration-commit-outstanding"
                style={{ ...stepParagraphStyle, color: "#ceac5f" }}>
              Still outstanding, and OPTIONAL: the payment key and guard you chose are not on
              chain yet. Your old keys keep working and this codex keeps them, so nothing is
              lost by leaving this — it only matters if you want the new keys in force.
            </li>
          </ul>
          <p style={{ ...stepParagraphStyle, color: "#8b8b96" }}>
            Your choices are saved, so closing this now and applying them later picks up
            exactly here.
          </p>
        </div>
      ) : null}

      {status === "arweave-unavailable" || status === "error" ? (
        <div data-testid="legacy-prime-migration-finalize-error" role="alert" style={warningBoxStyle}>
          <p style={{ margin: 0 }}>{errorMessage ?? ARWEAVE_SEED_NOT_AVAILABLE_TEXT}</p>
        </div>
      ) : null}

      {status === "success" ? (
        <div data-testid="legacy-prime-migration-finalize-success" role="alert" style={finalizeSuccessBoxStyle}>
          {PRIME_TRIO_LOCKED_REMINDER_TEXT}
        </div>
      ) : null}

      {status !== "running" ? (
        <button
          type="button"
          data-testid="legacy-prime-migration-finalize-close"
          onClick={onClose}
          style={{
            padding: "10px 20px",
            borderRadius: 8,
            border: "none",
            fontWeight: 700,
            fontSize: 13,
            backgroundColor: ACCENT,
            color: "#0a0a0a",
            cursor: "pointer",
            alignSelf: "flex-start",
          }}
        >
          Close
        </button>
      ) : null}
    </div>
  );
}

export function LegacyPrimeMigrationWizard({
  open,
  onClose,
  currentPrimeSeed = null,
  currentPrimeAccount = null,
  allSeeds = [],
  allAccounts = [],
  onStateChange,
  ensurePrimeArweaveSeed,
  describeKeyset,
}: LegacyPrimeMigrationWizardProps): React.ReactElement | null {
  const [step, setStep] = useState<LegacyPrimeMigrationWizardStep>("intro");
  // Page 2's own resolved choice — Page 3 (T5, same file) reads this
  // directly to build its key choices. Selection UI only: no account
  // activation or other side effect happens from setting this.
  const [accountChoice, setAccountChoice] = useState<LegacyPrimeMigrationAccountChoice | null>(
    null,
  );
  // Page 3's own resolved choice (T5) — `sweepNeeded` is always derived
  // from this, never stored separately, so it can never drift out of sync
  // with the choice that produced it.
  // Owner, this session: "by default the option 1 is selectable" — both of
  // Step 3's decisions (and the derivation-method flag they imply, below)
  // default to their RECOMMENDED option rather than starting unchosen, so
  // the FROM -> TO preview and the selected state are visible the moment
  // the user arrives, with no click required first. An explicit choice
  // (click, or a resumed/demoted run — see the resume block below) always
  // overrides this default; it is only ever the starting point.
  const [keysChoice, setKeysChoice] =
    useState<LegacyPrimeMigrationKeysChoice | null>({ kind: "stoic-dalos" });
  // Page 3's two real decisions (topic 5). Separate from `keysChoice`, which
  // stays the DERIVATION METHOD feeding Finalize's existing contract.
  const [paymentChoice, setPaymentChoice] =
    useState<LegacyPrimeMigrationPaymentChoice | null>({ kind: "stoic-dalos-position-0" });
  const [guardChoice, setGuardChoice] =
    useState<LegacyPrimeMigrationGuardChoice | null>({ kind: "recommended-single-key" });
  // Page 7's own status machine (T8) — see `FinalizeStep`'s own doc
  // comment. `finalizeError`'s message is only ever shown while
  // `finalizeStatus` is `"error"` or `"arweave-unavailable"`.
  // ── RESUME (topic 3) ──────────────────────────────────────────────────
  // A recorded run is restored ONCE per opening, never re-applied on every
  // render: re-applying would fight the user every time they changed a
  // decision, since changing one re-records the row this reads from.
  const resumeAppliedRef = useRef(false);
  // The derived position-0/1 preview, lifted here so the REVIEW step can
  // show the same FROM -> TO the keys step did without re-deriving it.
  const [reviewPreview, setReviewPreview] = useState<MasterKeyPreview>({ status: "loading" });
  const [resumeInfo, setResumeInfo] = useState<{
    startedAt: string | null;
    notices: string[];
  } | null>(null);
  const [finalizeStatus, setFinalizeStatus] = useState<FinalizeStatus>("running");
  const [finalizeError, setFinalizeError] = useState<string | null>(null);

  // Store access (T8) — via the NON-throwing `useCodexStoreOptional()`,
  // never `useCodexStore()`: whether a `<CodexProvider>` ancestor exists is
  // fixed for this component's entire mounted lifetime (same reasoning
  // `useEnsureCodexUnlockedOptional` already documents,
  // `zbom/hooks/useEnsureCodexUnlocked.ts`), so conditioning the selector
  // call on it below is not the "hooks called conditionally" hazard the
  // rule exists to prevent. `null` (no provider — every one of this file's
  // OWN pre-T8 tests) degrades Finalize to an honest "not available" state,
  // never a crash.
  const codexStore = useCodexStoreOptional();
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const actions = codexStore ? codexStore((s: CodexStoreState) => s.actions) : null;
  // Round 8: re-arms `AccountStep`'s failed decrypt probes whenever a
  // fresh `authenticate()` lands (see that step's `passwordEpoch` prop).
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const passwordCache = codexStore ? codexStore((s: CodexStoreState) => s.passwordCache) : null;
  // SUBSCRIBED, not read through `getState()`: the resume below must run on
  // the render where hydration completes, and `getState()` is not reactive —
  // reading it meant the component never re-rendered when `ready` flipped.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const codexReady = codexStore ? codexStore((s: CodexStoreState) => s.ready) : false;
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const recordedRun = codexStore
    ? codexStore((s: CodexStoreState) => s.migrationProgress)
    : undefined;

  // LIFTED preview (position 0 + 1 derived from the Page-2-chosen account's
  // words) — the one `useEffect` in this component, here specifically so
  // it runs ONCE regardless of which of payment/guard/review is currently
  // shown. Before the owner's "payment and guard must be separate pages"
  // correction, one combined `KeysStep` derived this itself and lifted the
  // RESULT up via an `onPreview` callback; now that payment and guard are
  // two components that mount/unmount independently as the user navigates
  // between them, deriving it in each would mean decrypting the account
  // twice (once per page) and flashing a second "loading" state on
  // whichever page is visited second. Computing it here, keyed only on
  // which account is chosen, means it is often already settled by the time
  // the user reaches either page.
  const chosenAccountForPreview = resolveChosenAccount(accountChoice, currentPrimeAccount ?? null, allAccounts);
  const chosenSecretForPreview = chosenAccountForPreview?.secret ?? null;
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    let cancelled = false;
    if (!chosenSecretForPreview) {
      setReviewPreview({ status: "error", message: "No account chosen yet." });
      return;
    }
    setReviewPreview({ status: "loading" });
    void (async () => {
      try {
        const getPassword = actions?.getPassword;
        if (!getPassword) throw new Error("the codex is locked");
        const plain = await smartDecrypt(chosenSecretForPreview, getPassword());
        const words = plain.trim().split(/\s+/).filter(Boolean);
        const bitString = seedWordsToBitString(words);
        const k0 = deriveStoaDalosKeypairAtIndex(bitString, 0);
        const k1 = deriveStoaDalosKeypairAtIndex(bitString, 1);
        if (!cancelled) {
          setReviewPreview({ status: "ready", key0: k0.publicKey, key1: k1.publicKey });
        }
      } catch (e) {
        if (!cancelled) {
          setReviewPreview({
            status: "error",
            message: e instanceof Error ? e.message : "could not read this account's words",
          });
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosenSecretForPreview]);

  // LIFTED guard resolution — same reasoning as the preview effect just
  // above, plus one more: `runFinalize`'s "keep" lock (see that function's
  // own note) needs the SAME resolved value the guard page displayed, not
  // a second, possibly-different chain read taken later. Unfolds whatever
  // shape `currentPrimeAccount.guard` is — `null` while in flight, never
  // rendered as "no guard", which would be a different and wrong statement.
  const [guardResolution, setGuardResolution] = useState<GuardKeyResolution | null>(null);
  const currentGuardForResolution = currentPrimeAccount?.guard ?? null;
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    let cancelled = false;
    setGuardResolution(null);
    void (async () => {
      const r = await resolveGuardKeys(currentGuardForResolution, {
        describeKeyset:
          describeKeyset ??
          (async () => {
            throw new Error("no chain connection available on this screen");
          }),
      });
      if (!cancelled) setGuardResolution(r);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(currentGuardForResolution)]);

  // Imperative notify-on-change otherwise, matching this file's existing
  // style of explicit setter calls (the preview effect just above is the
  // one exception — it has no discrete "user did X" moment to hang off of) —
  // every call site below that changes `step`/`accountChoice`/`keysChoice`
  // computes the FULL next snapshot and reports it through this one seam,
  // so `onStateChange` always sees a value consistent with what just
  // rendered, never a stale intermediate. `sweepNeeded` is always `true` as
  // of T6 (Wave 4) — see {@link LegacyPrimeMigrationWizardState}'s own doc
  // comment for why this selection-only step cannot honestly report
  // `false`: that is a real comparison against the chosen account's
  // current guard, which only a later wave's store action can perform.
  function notifyStateChange(next: {
    step: LegacyPrimeMigrationWizardStep;
    accountChoice: LegacyPrimeMigrationAccountChoice | null;
    keysChoice: LegacyPrimeMigrationKeysChoice | null;
    paymentChoice?: LegacyPrimeMigrationPaymentChoice | null;
    guardChoice?: LegacyPrimeMigrationGuardChoice | null;
  }): void {
    onStateChange?.({
      step: next.step,
      accountChoice: next.accountChoice,
      keysChoice: next.keysChoice,
      paymentChoice: next.paymentChoice !== undefined ? next.paymentChoice : paymentChoice,
      guardChoice: next.guardChoice !== undefined ? next.guardChoice : guardChoice,
      sweepNeeded: true,
    });
  }

  // Applied on the first render of an OPEN wizard, after the store handle
  // exists. Deliberately not a `useEffect`: this component drives every
  // other state change through explicit calls (see `notifyStateChange`), and
  // an effect here would apply a frame late, flashing an empty step 1 first.
  // Gated on `ready`, not merely on the store EXISTING: the store handle is
  // available from the first render, but `migrationProgress` only arrives
  // once `init()` has hydrated it from the adapter. Latching on the first
  // render found an empty row every time and never looked again.
  if (open && !resumeAppliedRef.current && codexStore && codexReady) {
    resumeAppliedRef.current = true;
    const plan = resolveMigrationResume(recordedRun, {
      accounts: allAccounts,
      seeds: allSeeds,
    });
    if (plan.resumable) {
      setStep(plan.step);
      setAccountChoice(plan.accountChoice);
      setPaymentChoice(plan.paymentChoice);
      setGuardChoice(plan.guardChoice);
      // A resumed run that chose Stoic Dalos must carry the derivation
      // method too, or Finalize would have nothing to derive from.
      if (plan.paymentChoice?.kind === "stoic-dalos-position-0") {
        setKeysChoice({ kind: "stoic-dalos" });
      }
      setResumeInfo({ startedAt: plan.startedAt, notices: plan.notices });
    } else if (plan.notices.length > 0) {
      // Not resumable, but there IS something to say (a new-words run).
      setResumeInfo({ startedAt: plan.startedAt, notices: plan.notices });
    }
  }
  if (!open) {
    // Re-arm, so closing and re-opening restores again rather than once ever.
    resumeAppliedRef.current = false;
    return null;
  }

  // Page 7 ("finalize", T8) — see the module doc's "Page 7" section for the
  // full call sequence this implements. Runs once, triggered by
  // `handleContinue`'s "keys" branch below; never re-entrant (that branch
  // only fires once per "keys" -> "finalize" transition).
  /**
   * STAGE 2 — THE COMMIT.
   *
   * Four writes, each recorded in `migrationProgress.committed` as it lands
   * so a resumed commit skips it instead of redoing it, and the alignment
   * stamp LAST so a codex never reads as eligible on a partial commit.
   *
   *   1. pair + promote the seed   -> committed.seedId / .accountId
   *   2. the Codex Master Seed row -> committed.rowWritten
   *   3. the master-key locks      -> committed.locksWritten
   *   4. stamp alignment           -> committed.alignmentStamped
   *
   * Recording is best-effort throughout: it makes a resume cheaper, and must
   * never be what fails a migration that otherwise succeeded.
   */
  async function runFinalize(): Promise<void> {
    setFinalizeStatus("running");
    setFinalizeError(null);
    void actions?.beginMigrationCommit().catch(() => {});

    if (!actions) {
      setFinalizeStatus("error");
      setFinalizeError(
        "Finalize is not available right now — this wizard has no connection to the codex.",
      );
      return;
    }

    const resolved = await resolveFinalizeDerivation({
      accountChoice,
      keysChoice,
      currentPrimeAccount,
      allAccounts,
      getPassword: actions.getPassword,
    });
    if (!resolved.ok) {
      setFinalizeStatus("error");
      setFinalizeError(resolved.error);
      return;
    }

    let guardRotationNeeded: boolean;
    try {
      const result = await actions.ensurePrimeSeedAccountPairingAndPromote(resolved.accountId, {
        bitString: resolved.bitString,
        words: resolved.words,
        method: resolved.method,
      });
      guardRotationNeeded = result.guardRotationNeeded;
      // Write 1 landed.
      void actions.recordMigrationCommit({
        seedId: result.seedId,
        accountId: resolved.accountId,
      }).catch(() => {});
    } catch (e) {
      setFinalizeStatus("error");
      setFinalizeError(e instanceof Error ? e.message : "Could not finalize this codex's Prime trio.");
      return;
    }
    // ── Write 2: the Codex Master Seed row. ALWAYS — nothing about which
    //    three entities are the faces of this seed depends on a sweep.
    const committedSeedId = codexStore?.getState().migrationProgress?.committed?.seedId;
    try {
      if (committedSeedId) {
        await actions.setCodexMasterSeed({
          ouroAccountId: resolved.accountId,
          chainwebSeedId: committedSeedId,
          establishedAt: new Date().toISOString(),
        });
        void actions.recordMigrationCommit({ rowWritten: true }).catch(() => {});
      }
    } catch {
      // Non-fatal: the row is descriptive, and re-runnable.
    }

    // ── Write 3: the master-key locks, from the keys actually in use.
    //    ALSO always: protecting a key the master already depends on must
    //    not wait on money moving.
    //
    //    Owner, this session: "if others are kept, that key should become
    //    non removable from the codex" — "keep" must still lock, not pass
    //    `null`. `null` to `secureMasterAccount` means "unresolved" (see
    //    `masterKeyLockDelta.ts`'s own doc), which only suppresses RELEASES
    //    of existing locks; it never ADDS one. Before this fix, "keep" on
    //    either decision locked NOTHING — the comment that used to sit here
    //    ("Secure Master Account settles it") described a second call that
    //    does not exist anywhere in this codebase; `secureMasterAccount` is
    //    called exactly once, right here.
    //
    //    Payment's current key is already known locally (`currentPaymentKeyOf`
    //    — the same value the "Current payment key" box already displays),
    //    so there is no reason for "keep" to pass `null` there at all.
    //    Guard's "keep" can mean keeping a keyset REFERENCE, which may need
    //    a real chain read to expand — `guardResolution` (lifted above) is
    //    that exact resolution, already computed for the guard page's own
    //    display; `keysOf` turns it into the same null-vs-[] distinction
    //    `computeMasterKeyLockDelta` already expects (a genuinely unresolved
    //    reference must still suppress releases, never silently unlock).
    try {
      // guard-step-variants (docs/work/guard-step-variants/design.md): the
      // three newest kinds lock the SAME way "recommended-single-key"/
      // "custom" already do — the intended final key set, regardless of
      // whether a Stage 3 transaction is still needed to make it true on
      // chain. "update-keyset-recommended" derives the SAME position-1 key
      // "recommended-single-key" does (the difference is only WHICH
      // on-chain action eventually applies it — updating the reference vs.
      // switching away from it — and neither executes here, see
      // `outstandingKeyChanges.ts`'s own note). "update-keyset-custom"/
      // "use-existing-keyset" already carry their own real `keys` directly.
      const guardKeys =
        guardChoice?.kind === "custom" || guardChoice?.kind === "update-keyset-custom"
        || guardChoice?.kind === "use-existing-keyset"
          ? guardChoice.keys
          : guardChoice?.kind === "recommended-single-key"
            || guardChoice?.kind === "update-keyset-recommended"
            ? [deriveStoaDalosKeypairAtIndex(resolved.bitString, 1).publicKey]
            : guardResolution
              ? keysOf(guardResolution)
              : null; // genuinely not yet resolved — stays unknown, not "none"
      const paymentPublicKey =
        paymentChoice?.kind === "stoic-dalos-position-0"
          ? deriveStoaDalosKeypairAtIndex(resolved.bitString, 0).publicKey
          : currentPaymentKeyOf(allSeeds);
      await actions.secureMasterAccount({ paymentPublicKey, guardPublicKeys: guardKeys });
      // Record the PUBLIC keys alongside, so stage 3A can report what should
      // be in force without decrypting the seed just to display it.
      void actions.recordMigrationCommit({
        locksWritten: true,
        ...(paymentPublicKey ? { paymentPublicKey } : {}),
        ...(guardKeys ? { guardPublicKeys: [...guardKeys] } : {}),
      }).catch(() => {});
    } catch {
      // Non-fatal for the same reason; Secure Master Account can be re-run.
    }

    // ── Write 4: the ArWeave face, when it can be established. Its absence
    //    no longer blocks the two writes above — it only leaves the Master
    //    Seed row at two faces, which the Codex ID page already states.
    let arweaveOutstanding = false;
    if (!ensurePrimeArweaveSeed) {
      arweaveOutstanding = true;
    } else {
      try {
        await ensurePrimeArweaveSeed({ bitString: resolved.bitString, words: resolved.words });
      } catch (e) {
        arweaveOutstanding = true;
        setFinalizeError(e instanceof Error ? e.message : ARWEAVE_SEED_NOT_AVAILABLE_TEXT);
      }
    }

    // ── Write 5: alignment.
    //
    // CORRECTED (owner, 2026-10-30): this used to wait on `sweepNeeded`,
    // which is NOT an asset check at all — it is a comparison of the
    // account's on-chain guard against the derived pair. Eligibility does
    // not depend on it, or on where assets sit:
    // `checkArweaveRestoreEligibility` derives an ArWeave address from the
    // prime account's bitstring and compares it to the stored prime ArWeave
    // address. Nothing on chain, no funds, no guard.
    //
    // So eligibility is settled HERE, at the end of stage 2. What a user
    // additionally CHOSE to change on chain (stage 3A) and whether they want
    // to move old assets (stage 3B) are separate, optional, and reported
    // rather than blocking.
    //
    // The ArWeave seed is the one real precondition: without it there is no
    // prime ArWeave address to compare against, so eligibility genuinely
    // cannot be claimed.
    if (arweaveOutstanding) {
      setFinalizeStatus("arweave-unavailable");
      return;
    }

    await actions.stampPrimeAlignmentAligned();
    void actions.recordMigrationCommit({ alignmentStamped: true }).catch(() => {});

    if (guardRotationNeeded) {
      // Eligible, but the user's CHOSEN key changes are not on chain yet.
      // The run is deliberately NOT cleared: it records what was chosen, and
      // stage 3A resumes from exactly this.
      setFinalizeStatus("eligible-rotation-outstanding");
      return;
    }

    void actions.completeMigration().catch(() => {});
    setFinalizeStatus("success");
  }

  // T4 (Wave 2) wired "intro" -> "account" for real. T5 wires "account" ->
  // "payment" for real, but only once an account choice has been made —
  // otherwise there is nothing yet to build Page 3 from, so it stays the
  // same documented no-op-stub convention T3/T4 used. T8 (this task) wires
  // "guard" -> "finalize" for real (via "review"), the same way, gated on
  // `keysChoice != null` — and immediately kicks off `runFinalize` above.
  /**
   * Why Continue is unavailable, or `null` when it is available.
   *
   * This replaces a silent `console.debug` no-op: the button used to render
   * gold with `cursor: pointer` in every state and simply do nothing when a
   * step's requirements were unmet, which is indistinguishable from a broken
   * button. The owner hit exactly that. A disabled control that says why is
   * the minimum; a live-looking one that ignores clicks is a bug.
   *
   * "payment" and "guard" were one combined "keys" step until the owner's
   * correction this session — each is its own screen now, each with its
   * own gate. Both decisions default to their recommended option (see the
   * `paymentChoice`/`guardChoice` `useState` initializers above), so in
   * practice neither page's `== null` branch fires anymore except
   * defensively; the one gate that still fires for real is a CUSTOM guard
   * keyset left empty.
   */
  function continueBlockedReason(): string | null {
    if (step === "intro") return null;
    if (step === "account") {
      return accountChoice == null
        ? "Choose which account becomes your Ouronet Codex Master first."
        : null;
    }
    if (step === "payment") {
      return paymentChoice == null ? "Choose what the payment key should be." : null;
    }
    if (step === "guard") {
      if (guardChoice == null) return "Choose what the guard should be.";
      // "use-existing-keyset" is never set with an incomplete value in the
      // first place (`ExistingKeysetPicker` only calls `onChoose` once
      // `describeKeyset` has actually resolved real keys) — so unlike the
      // two custom-keys kinds below, it needs no empty-keys check here.
      if (
        (guardChoice.kind === "custom" || guardChoice.kind === "update-keyset-custom")
        && guardChoice.keys.length === 0
      ) {
        return "Select at least one key for your custom keyset.";
      }
      // code review (guard-step-variants): a defensive backstop for
      // "use-existing-keyset" — `ExistingKeysetPicker.resolve()` itself now
      // refuses to record a zero-key resolution (a real but degenerate
      // on-chain keyset shape), and invalidates its own choice back to this
      // empty state whenever the ns/ksn text is edited after a successful
      // resolve without re-resolving. Either path lands here with the same
      // "would lock you out" message every other empty-keys case uses.
      if (guardChoice.kind === "use-existing-keyset" && guardChoice.keys.length === 0) {
        return "Resolve a keyset with at least one key for your custom guard.";
      }
      return null;
    }
    return null;
  }

  /**
   * STAGE 1 -> 2 BOUNDARY.
   *
   * The selection is recorded the moment it is COMPLETE (account + payment +
   * guard all chosen), and never before: abandoning a PARTIAL stage 1 must
   * leave the codex untouched, while abandoning a FINISHED one must be
   * resumable — the owner's *"if stage one was already done and the wizard
   * wasnt finalised"*. `recordMigrationSelection` is equality-gated, so this
   * firing on every render cannot churn the codex.
   *
   * Seed words never reach it: `toPersistableAccountSelection` is the one
   * conversion, and it drops them.
   */
  function recordSelectionIfComplete(
    nextAccount: LegacyPrimeMigrationAccountChoice | null,
    nextPayment: LegacyPrimeMigrationPaymentChoice | null,
    nextGuard: LegacyPrimeMigrationGuardChoice | null,
  ): void {
    if (!actions) return;
    if (nextAccount == null || nextPayment == null || nextGuard == null) return;
    const selection: MigrationSelection = {
      account: toPersistableAccountSelection(nextAccount),
      payment: nextPayment,
      guard: nextGuard,
      ...(keysChoice ? { derivationMethod: keysChoice.kind } : {}),
    };
    void actions.recordMigrationSelection(selection).catch(() => {
      // A failed record must never block the user from continuing: the row
      // is a convenience for resuming, not a precondition for migrating.
    });
  }

  function handleContinue(): void {
    if (step === "intro") {
      setStep("account");
      notifyStateChange({ step: "account", accountChoice, keysChoice });
      return;
    }
    if (step === "account") {
      if (continueBlockedReason() !== null) return; // disabled; defensive only
      setStep("payment");
      notifyStateChange({ step: "payment", accountChoice, keysChoice });
      return;
    }
    if (step === "payment") {
      if (continueBlockedReason() !== null) return; // disabled; defensive only
      setStep("guard");
      notifyStateChange({ step: "guard", accountChoice, keysChoice });
      return;
    }
    if (step === "guard") {
      if (continueBlockedReason() !== null) return; // disabled; defensive only
      // STAGE 1 -> REVIEW. Continue no longer commits: the user sees every
      // choice, and its consequences, before anything is written.
      setStep("review");
      notifyStateChange({ step: "review", accountChoice, keysChoice });
      return;
    }
    if (step === "review") {
      // STAGE 2 starts HERE, explicitly.
      setStep("finalize");
      notifyStateChange({ step: "finalize", accountChoice, keysChoice });
      void runFinalize();
    }
  }

  // Post-build fix round, Issue 4: the "Back" counterpart to
  // `handleContinue` above — "account" -> "intro", "payment" -> "account",
  // "guard" -> "payment", "review" -> "guard". Never reachable from "intro"
  // (there is nothing before it — the button itself is simply not rendered
  // there, below). Deliberately does NOT reset `accountChoice`/
  // `paymentChoice`/`guardChoice`/`keysChoice`: going back and then forward
  // again must still show whatever was already selected, same discipline
  // `handleContinue` already follows for every OTHER state transition in
  // this component (nothing here ever clears a choice as a side effect of
  // navigation alone).
  function handleBack(): void {
    if (step === "account") {
      setStep("intro");
      notifyStateChange({ step: "intro", accountChoice, keysChoice });
      return;
    }
    if (step === "payment") {
      setStep("account");
      notifyStateChange({ step: "account", accountChoice, keysChoice });
      return;
    }
    if (step === "guard") {
      setStep("payment");
      notifyStateChange({ step: "payment", accountChoice, keysChoice });
      return;
    }
    if (step === "review") {
      // Back out of the gate to edit the decisions. Nothing has been written
      // at this point, so this is free — which is the whole reason the
      // review sits BEFORE the commit rather than after it.
      setStep("guard");
      notifyStateChange({ step: "guard", accountChoice, keysChoice });
    }
  }

  function handleChooseAccount(next: LegacyPrimeMigrationAccountChoice): void {
    setAccountChoice(next);
    notifyStateChange({ step, accountChoice: next, keysChoice });
  }

  function handleChooseKeys(next: LegacyPrimeMigrationKeysChoice): void {
    setKeysChoice(next);
    notifyStateChange({ step, accountChoice, keysChoice: next });
  }

  // `"finalize"` is deliberately absent from `STEP_DISPLAY_NUMBER` (see
  // its own doc comment) — it gets its own fixed subtitle instead of a
  // "Step N of 4" count that was never true for it.
  return (
    <CodexModalShell
      title="Make This Codex Eligible"
      subtitle={
        step === "finalize"
          ? STEP_LABELS[step]
          : `Step ${STEP_DISPLAY_NUMBER[step]} of 4 — ${STEP_LABELS[step]}`
      }
      onClose={onClose}
      accent={ACCENT}
      maxWidth={560}
      dialogTestId="legacy-prime-migration-wizard-modal"
      closeTestId="legacy-prime-migration-wizard-close"
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {resumeInfo !== null ? (
          <div
            data-testid="legacy-prime-migration-resume-banner"
            style={{
              display: "flex", flexDirection: "column", gap: 6, padding: 10,
              marginBottom: 12, borderRadius: 8,
              backgroundColor: "#1a1710", border: "1px solid #3a3420",
            }}
          >
            <p style={{ ...stepParagraphStyle, color: "#ceac5f", fontWeight: 700 }}>
              Resumed — you started this on{" "}
              {resumeInfo.startedAt ? resumeInfo.startedAt.slice(0, 10) : "an earlier session"}.
              Your choices are shown as you left them.
            </p>
            {resumeInfo.notices.map((n) => (
              <p key={n} data-testid="legacy-prime-migration-resume-notice"
                 style={{ ...stepParagraphStyle, color: "#fca5a5" }}>
                {n}
              </p>
            ))}
            <button
              type="button"
              data-testid="legacy-prime-migration-resume-startover"
              onClick={() => {
                void actions?.abandonMigration().catch(() => {});
                setAccountChoice(null);
                // Back to the SAME starting point a fresh open lands on —
                // option 1 pre-selected on both decisions, not a blank
                // slate — so "start over" and "never opened before" read
                // identically.
                setPaymentChoice({ kind: "stoic-dalos-position-0" });
                setGuardChoice({ kind: "recommended-single-key" });
                setKeysChoice({ kind: "stoic-dalos" });
                setResumeInfo(null);
                setStep("intro");
              }}
              style={{
                alignSelf: "flex-start", padding: "4px 10px", borderRadius: 6,
                border: "1px solid #3a3420", backgroundColor: "transparent",
                color: "#8b8b96", fontSize: 11, cursor: "pointer",
              }}
            >
              Start over instead
            </button>
          </div>
        ) : null}
        {/* Owner, this session: the sticky copy has to sit ABOVE the step's
            own content to do any good — placed after the step content (like
            the bottom copy, below) it would only start sticking once
            scrolled PAST everything, by which point the bottom copy is
            already in view. Placed here, it is pinned from the first frame
            a step with real overflow renders. */}
        {step !== "finalize" ? navRow("top") : null}
        {step === "intro" ? <IntroStep /> : null}
        {step === "account" ? (
          <AccountStep
            currentPrimeSeed={currentPrimeSeed}
            currentPrimeAccount={currentPrimeAccount}
            allAccounts={allAccounts}
            choice={accountChoice}
            onChoose={handleChooseAccount}
            getPassword={actions?.getPassword}
            authenticate={actions?.authenticate}
            passwordEpoch={passwordCache?.expiresAt ?? null}
          />
        ) : null}
        {step === "payment" ? (
          <PaymentStep
            accountChoice={accountChoice}
            currentPrimeAccount={currentPrimeAccount}
            allAccounts={allAccounts}
            allSeeds={allSeeds}
            preview={reviewPreview}
            choice={keysChoice}
            onChoose={handleChooseKeys}
            paymentChoice={paymentChoice}
            onChoosePayment={(c) => {
              setPaymentChoice(c);
              recordSelectionIfComplete(accountChoice, c, guardChoice);
              // Choosing to derive IS the Stoic Dalos method, so keep the
              // existing Finalize contract in step rather than making the
              // user answer the same question twice.
              if (c.kind === "stoic-dalos-position-0" && keysChoice === null) {
                setKeysChoice({ kind: "stoic-dalos" });
                notifyStateChange({
                  step: "payment", accountChoice, keysChoice: { kind: "stoic-dalos" },
                  paymentChoice: c,
                });
                return;
              }
              notifyStateChange({ step: "payment", accountChoice, keysChoice, paymentChoice: c });
            }}
          />
        ) : null}
        {step === "guard" ? (
          <GuardStep
            allSeeds={allSeeds}
            preview={reviewPreview}
            guardResolution={guardResolution}
            guardChoice={guardChoice}
            onChooseGuard={(c) => {
              setGuardChoice(c);
              recordSelectionIfComplete(accountChoice, paymentChoice, c);
              notifyStateChange({ step: "guard", accountChoice, keysChoice, guardChoice: c });
            }}
            describeKeyset={describeKeyset}
          />
        ) : null}
        {step === "review" ? (
          <ReviewStep
            accountLabel={
              accountChoice?.kind === "keep-current"
                // Same positional rule AccountStep uses: index 0 displays as
                // the master regardless of its stored name.
                ? (allAccounts.length > 0 && allAccounts[0]?.id === currentPrimeAccount?.id
                    ? OURONET_CODEX_MASTER
                    : currentPrimeAccount?.name ?? null)
                : accountChoice?.kind === "existing"
                  ? allAccounts.find((a) => a.id === accountChoice.accountId)?.name ?? null
                  : "newly typed words"
            }
            currentPaymentKey={currentPaymentKeyOf(allSeeds)}
            paymentChoice={paymentChoice}
            guardChoice={guardChoice}
            preview={reviewPreview}
            seedName={
              allSeeds.length > 0
                ? masterChainwebSeedName(0, allSeeds[0]!.isPrime, allSeeds[0]!.name)
                : null
            }
          />
        ) : null}
        {step === "finalize" ? (
          <FinalizeStep
            status={finalizeStatus}
            errorMessage={finalizeError}
            onClose={onClose}
            committed={recordedRun?.committed}
          />
        ) : null}
        {step !== "finalize" ? navRow("bottom") : null}
      </div>
    </CodexModalShell>
  );

  /**
   * Back / Continue, rendered TWICE — owner, this session: *"the prev next
   * buttons, have to also be placed on top... they have to stay fixed
   * there, even if i scroll... so theyre always there for pressing."* A
   * step with many entries to pick through (the custom keyset editor,
   * dozens of codex keys) could put Continue a long scroll below the fold;
   * the bottom copy stays too, for anyone who scrolls down anyway.
   *
   * ONE function, not two copies — `variant` only changes the wrapper's
   * position/testid-suffix; the buttons' logic (`handleBack`,
   * `handleContinue`, `continueBlockedReason`) is the SAME call, so the two
   * copies can never read as out of sync with each other.
   *
   * `position: sticky` (not `fixed`): this row lives inside `children`,
   * nested in `CodexModalShell`'s own scrolling card — `fixed` would
   * position against the viewport and escape the card entirely on a tall
   * page. `sticky` pins it to the TOP of that same scrolling box the
   * instant it would otherwise scroll past, which is exactly "stay fixed
   * while the rest scrolls" scoped to this card, not the whole screen.
   * `top` keeps the bottom copy exactly where it already was — unchanged,
   * not sticky, not touched by this change.
   */
  function navRow(variant: "top" | "bottom"): React.ReactElement {
    const suffix = variant === "top" ? "-top" : "";
    const blockedReason = continueBlockedReason();
    return (
      <div
        data-testid={`legacy-prime-migration-nav${suffix}`}
        style={{
          display: "flex",
          // Post-build fix round, Issue 4: "Back" (when present) sits on
          // the opposite end of the SAME row from "Continue" — there is
          // no existing Close/Cancel precedent in THIS row to mirror (the
          // only other button, the modal's own × close, lives in
          // `CodexModalShell`'s separate header row), so "space-between"
          // is this row's own, simplest two-button layout once a second
          // button exists; Page 1 keeps the original single-button
          // "flex-end" since it never renders "Back" at all.
          justifyContent: step === "intro" ? "flex-end" : "space-between",
          ...(variant === "top"
            ? {
                position: "sticky", top: 0, zIndex: 1,
                backgroundColor: "#0a0a0a", marginTop: -4,
                paddingTop: 10, paddingBottom: 10,
                borderBottom: "1px solid #262626",
              }
            : { borderTop: "1px solid #262626", paddingTop: 14 }),
        }}
      >
        {step !== "intro" ? (
          <button
            type="button"
            data-testid={`legacy-prime-migration-back${suffix}`}
            onClick={handleBack}
            style={{
              padding: "10px 20px",
              borderRadius: 8,
              fontWeight: 700,
              fontSize: 13,
              // Secondary/outline treatment — mirrors this package's own
              // established "Cancel"-style secondary button
              // (`CreateStoaChainSeedModal.tsx`'s own Cancel button:
              // transparent fill, muted border + text) rather than
              // repeating "Continue"'s solid accent fill, so the two
              // buttons read as primary vs. secondary, not two equally-
              // weighted actions.
              border: "1px solid #262626",
              background: "transparent",
              color: "#888",
              cursor: "pointer",
            }}
          >
            Back
          </button>
        ) : null}
        {blockedReason !== null ? (
          <span
            data-testid={`legacy-prime-migration-continue-blocked${suffix}`}
            style={{ ...stepParagraphStyle, color: "#8b8b96", marginRight: 12 }}
          >
            {blockedReason}
          </span>
        ) : null}
        <button
          type="button"
          data-testid={`legacy-prime-migration-continue${suffix}`}
          onClick={handleContinue}
          disabled={blockedReason !== null}
          title={blockedReason ?? undefined}
          style={{
            padding: "10px 20px",
            borderRadius: 8,
            border: "none",
            fontWeight: 700,
            fontSize: 13,
            backgroundColor: blockedReason === null ? ACCENT : "#1a1a1a",
            color: blockedReason === null ? "#0a0a0a" : "#555",
            cursor: blockedReason === null ? "pointer" : "not-allowed",
          }}
        >
          Continue
        </button>
      </div>
    );
  }
}

export default LegacyPrimeMigrationWizard;
