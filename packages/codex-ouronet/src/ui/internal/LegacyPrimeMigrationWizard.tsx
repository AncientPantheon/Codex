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
 *      iff the CURRENT account's own `originSeedTab === "write-seed"`. No
 *      longer shows a "no known words" warning regardless of
 *      `originSeedTab` — removed (`wizard-page2-and-dashboard-fixes`
 *      round 3), since `originSeedTab` is a provenance tag stamped only
 *      at account-SPAWN time, never derived from or verified against
 *      the actual stored secret, and every account's real material is
 *      now recoverable via `SeedRevealModal` regardless of its shape.
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
 * Page 6 ("arweave") — the Arweave verification step
 * (`docs/work/wizard-arweave-step/design.md`), between review and finalize.
 * The owner asked for it twice and got invisible `runFinalize` logic both
 * times: *"how can the codex be eligible, if the wizard has no step for
 * verifying if the codex has arweave account?"* It renders the three checks
 * the eligibility predicate actually performs — a matching Arweave seed,
 * account #0, account #1 — as three separate rows from ONE
 * `codexHoldsMasterArweaveAccounts` evaluation, and BINDS Continue to that
 * answer (see `continueBlockedReason`'s `"arweave"` branch), so finalize is
 * unreachable until the codex genuinely holds both accounts. Its Generate
 * button is rendered but inert as of `wizard-arweave-step` T1; T2 wires it
 * to `ensurePrimeArweaveSeed` with that derivation's own per-key progress.
 * The master bitstring it checks against comes from
 * {@link resolveFinalizeDerivation} and the predicate input from
 * {@link evaluateMasterArweaveAccounts} — the SAME two functions the commit
 * uses, never a parallel pair that could drift.
 *
 * Page 7 ("finalize") — per `legacy-prime-migration-wizard/design.md`'s
 * "Page 7 — Finalize" section and `plan.md`'s T8. Reaching this step runs
 * NOTHING: it arrives IDLE (`FinalizeStatus`'s `"awaiting-settle"`) and
 * offers one button, {@link SETTLE_CHOICES_LABEL}, gated on the Settling
 * Dashboard's four colours (`settleBlockedReason`). Owner, after live
 * testing: *"the wizard has to end with a finalize button 'Settle Choices'.
 * This button must be clickable once all the squares are lit… clicking it is
 * the final action that settles the selected choices."* Pressing it runs
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
 *   3. Evaluates `codexHoldsMasterArweaveAccounts` — the SAME predicate the
 *      Settling Dashboard's violet ticker reads — against the resolved master
 *      bitstring. Already satisfied: nothing is derived. Otherwise it calls
 *      the optional `ensurePrimeArweaveSeed` prop (see
 *      {@link LegacyPrimeMigrationWizardProps.ensurePrimeArweaveSeed}) for the
 *      missing positions, reporting its progress on the panel, and then
 *      RE-EVALUATES the predicate. Absent, throwing, or still not satisfied
 *      afterwards shows an honest "not available" state INSTEAD of recording
 *      a pending plan (`arweave-master-accounts` T3 — a resolved call is not
 *      the same fact as a codex that holds the accounts, which is exactly how
 *      the old code came to print "eligible" beside a dark ticker).
 *   4. Otherwise calls the store's `recordMigrationPending()` — writing the
 *      PENDING PLAN Apply will later execute and seal — and shows a success
 *      screen with {@link PRIME_TRIO_LOCKED_REMINDER_TEXT}. It deliberately
 *      does NOT stamp alignment and does NOT clear the recorded run; see
 *      `runFinalize`'s own "What Write 5 used to be" note and
 *      `docs/work/migration-pending-apply/design.md`.
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
import { ChevronLeft, ChevronRight } from "lucide-react";

import { CodexModalShell, modalInput } from "./CodexModalShell.js";
import { InlineUnlockPrompt } from "./InlineUnlockPrompt.js";
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
import type { IOuroAccount, IStoaChainSeed, IPureKeypair, IArweaveSeed, OuroOriginSeedTab } from "../../types/entities.js";
import { normalizeSeedType } from "./keySource.js";
import {
  // `resolveArweaveMatchSeedId` is deliberately NOT imported any more — the
  // violet ticker it used to drive now runs the one real predicate
  // (`codexHoldsMasterArweaveAccounts`, see `resolveMasterArweaveHeld`). The
  // function itself stays exported and tested for its other callers.
  computeSeedDashboardCards, resolveAccountSeedId, findSeedIdForKey,
  codexHoldsMasterArweaveAccounts,
  pureKeypairBacksRole, accountOwnKeyBacksRole, paymentKeyOriginLabel, STOIC_DALOS_DERIVATION_LABEL,
  type SeedDashboardCard, type SeedDashboardSubRow, type PaymentKeyOrigin,
  type CodexHoldsMasterArweaveAccountsInput, type CodexHoldsMasterArweaveAccountsResult,
} from "./seedDashboard.js";
import { SeedRevealModal } from "./SeedRevealModal.js";
import { AccountSeedRevealModal } from "./AccountSeedRevealModal.js";
import { OURONET_CODEX_MASTER, MASTER_CHAINWEB_SEED, MASTER_ARWEAVE_SEED, masterChainwebSeedName, toPersistableAccountSelection, CODEX_MASTER_SEED } from "@ancientpantheon/codex-core";
import type { MigrationSelection, MigrationCommitRecord, ForeignKeyEntry } from "@ancientpantheon/codex-core";

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
  /** The Arweave verification step (`docs/work/wizard-arweave-step/
   *  design.md`). A REAL step, not logic hidden inside finalize: the owner
   *  asked for it twice — *"how can the codex be eligible, if the wizard has
   *  no step for verifying if the codex has arweave account? … There should
   *  be a separate step regarding the arweave account verification."* — and
   *  got invisible `runFinalize` logic both times.
   *
   *  Sits AFTER review on purpose: review is the stage 1 -> 2 gate
   *  ("everything chosen, before anything is written") and generating Arweave
   *  accounts WRITES to the codex. Continue out of it is bound to the same
   *  predicate the finalize gate and the violet ticker read, so Finalize is
   *  unreachable until the codex genuinely holds accounts #0 and #1 under the
   *  Codex Master Seed. */
  | "arweave"
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
 * Page 3, section 1 - what the Codex Ouronet Master's PAYMENT key should be.
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
 * Page 3, section 2 - what the Codex Ouronet Master's GUARD should be.
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

/**
 * The LIVE prime search behind the position currently in flight — the detail
 * that makes a minutes-long RSA-4096 derivation watchable rather than merely
 * silent.
 *
 * Every number here comes from the derivation itself; nothing in this shape
 * may be interpolated, animated or inferred from a clock.
 */
export interface ArweaveDerivationSearch {
  /** 1-based position being searched for: `completedCount + 1`. */
  position: number;
  /** How many positions the whole run was asked for. Fixed for the run. */
  totalCount: number;
  /** Which of the two RSA primes is being searched for right now. */
  stage: "p" | "q";
  /** Candidate draws in THIS search — RESTATED per draw by the library, not
   *  accumulated. */
  attempts: number;
  /**
   * Candidate draws across the WHOLE run so far. Already DERIVED upstream
   * (from per-(index, stage) high-water marks) and must be rendered as given:
   * summing `attempts` here would over-count badly, because the library
   * restates that field on every draw instead of incrementing it.
   */
  grandAttempts: number;
  /** The library's own `overallProgress` (0..1) as a whole percent — what the
   *  bar is filled to. */
  percent: number;
}

/**
 * One Arweave-derivation progress event, as
 * {@link LegacyPrimeMigrationWizardProps.ensurePrimeArweaveSeed} reports it
 * (`arweave-master-accounts` T3). Carries the position in flight and how many
 * of the requested positions are already stored — enough for an honest line,
 * and nothing that could be fabricated without real events behind it (no
 * elapsed time, no clock-driven movement).
 *
 * `index`/`delivered`/`total` are the ORIGINAL surface, unchanged. `search` is
 * purely additive and OPTIONAL, so a provider that predates it still satisfies
 * this interface structurally — which is how `codex-arweave`'s
 * `EnsurePrimeArweaveSeedProgress` fits here WITHOUT this package importing
 * it (that dependency runs the other way: `codex-arweave` depends on
 * `codex-ouronet`, never the reverse).
 */
export interface ArweaveDerivationProgress {
  /** The master position (`#0`/`#1`) in flight (a search) or just delivered. */
  index: number;
  /** How many of `total` positions have been delivered AND persisted. */
  delivered: number;
  /** How many positions this derivation was asked for. */
  total: number;
  /**
   * Live search detail — present ONLY on a search event, and ABSENT on a
   * delivered-key event. That absence is load-bearing, not an oversight: it is
   * exactly how the bar tells "still hunting for a prime" from "that key is
   * done", and a renderer that carries stale search detail across a delivery
   * would be describing work that is no longer happening.
   */
  search?: ArweaveDerivationSearch;
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
  /** Every `IPureKeypair` in the codex — threaded to `CustomKeysetEditor`'s
   *  picker (one selectable checkbox per entry, alongside every seed-
   *  derived key) and to the Settling Dashboard's "Pure Keys" attribution
   *  card (`docs/work/wizard-keyset-scale-and-sidebar/design.md`'s "G —
   *  Pure keys join the picker and the dashboard"). Optional/defaulted,
   *  same "optional, additive" pattern `allAccounts` already uses — when
   *  omitted, falls back to this component's own `useCodexStoreOptional()`
   *  read (pre-existing, used by `detectPaymentKeyOrigin`'s "PureKey"
   *  label), so `CodexIdPage.tsx`'s current call site (which does not yet
   *  pass this prop) keeps working unchanged. */
  pureKeypairs?: readonly IPureKeypair[];
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
   *  stamps `primeAlignment: "aligned"` in that case.
   *
   *  `arweave-master-accounts` T3 widened this with a SECOND, OPTIONAL
   *  argument (so every existing one-argument call site still satisfies it):
   *  - `missingIndexes` — exactly which of the master positions the
   *    eligibility predicate found absent, so a codex already holding #0
   *    derives only #1 instead of paying for an RSA-4096 key it has;
   *  - `onProgress` — the derivation's OWN per-key events, rendered on the
   *    finalize panel (each key costs seconds; a silent screen for that long
   *    is indistinguishable from a hang).
   *
   *  Resolving does NOT mean the codex is now eligible — a PARTIAL delivery
   *  resolves too. Eligibility is re-verified from the codex's end state
   *  afterwards; see `runFinalize`'s Write 4. */
  ensurePrimeArweaveSeed?: (
    words: { bitString: string; words?: readonly string[] },
    opts?: {
      missingIndexes?: readonly number[];
      onProgress?: (progress: ArweaveDerivationProgress) => void;
    },
  ) => Promise<void>;
  /** Resolve a qualified on-chain keyset name, for unfolding a guard that is
   *  a keyset REFERENCE. Injected (not imported) so this component stays
   *  testable without a chain. When absent, a reference guard renders as
   *  explicitly UNRESOLVED - never as "authorizes no keys", which would be a
   *  different and dangerous claim. */
  describeKeyset?: (qualifiedName: string) => Promise<{ keys: readonly string[]; pred: string }>;
  /**
   * Page 2's decrypt-probe seam — defaults to `@stoachain/stoa-core/crypto`'s
   * own `smartDecrypt`, which is what every production call site gets.
   * INJECTED (same discipline, and the same reason, as `describeKeyset`
   * above) rather than reached for through a module mock: this package's
   * specs drive mainnet-facing code, so a test that needs a decrypt which
   * hangs or fails on demand must say so through the component's real
   * surface instead of rewriting the crypto module out from under it.
   *
   * Read-only, exactly like the default: the probe never writes what it
   * decrypts anywhere (see `AccountStep`'s `probeWithPassword`).
   */
  probeDecrypt?: (secret: string, password: string) => Promise<string>;
  /**
   * How long Page 2's decrypt probe may run before it gives up and says so
   * (`honest-failure-reporting` §1). Defaults to
   * {@link PROBE_WATCHDOG_MS_DEFAULT}. Injected so a test can observe the
   * terminal state in milliseconds rather than waiting out a production
   * wall clock — the value itself is a UI timing policy, not a secret.
   */
  probeWatchdogMs?: number;
}

/**
 * Page 2's probe watchdog, in ms (`honest-failure-reporting` §1: "a stalled
 * probe must reach a terminal state with a visible 'could not read N
 * accounts' rather than spinning forever").
 *
 * Deliberately generous. Each candidate costs a full PBKDF2-600k
 * `smartDecrypt`, the pool is 4 wide, and the owner's real codex has 14+
 * Standard accounts — on a slow machine a HEALTHY pass can legitimately
 * take tens of seconds, and a watchdog that fires over a pass still doing
 * its job would be its own dishonesty. 90s is far past any healthy pass
 * observed and still far short of "forever", which is what this replaces.
 */
export const PROBE_WATCHDOG_MS_DEFAULT = 90_000;

/**
 * Per-account reason recorded for a candidate the watchdog gave up on
 * (`honest-failure-reporting` §1). Deliberately NOT one of
 * `classifyDecryptError`'s taxonomy entries: nothing was learned about this
 * account's secret at all — the decrypt never came back either way — so
 * claiming a wrong password, a corrupt envelope or an unsupported format
 * would be inventing a diagnosis. Exported so a caller/test asserts the
 * exact wording rather than re-typing it (same reason as
 * {@link LOCK_IN_WARNING_TEXT}).
 */
export const PROBE_TIMED_OUT_ACCOUNT_TEXT =
  "Reading this account's secret timed out — it never completed, so nothing is known about it either way.";

const ACCENT = "#ceac5f";

/** Fix 1's `STEP_LABELS`-equivalent. The real navigation sequence is
 *  intro -> account -> payment -> guard -> review -> arweave -> finalize;
 *  every transition is spelled out explicitly in `handleContinue`/
 *  `handleBack` below, nothing reads this map by array position.
 *  `STEP_DISPLAY_NUMBER` (below) supplies the subtitle's step NUMBER
 *  separately, since `"payment"`/`"guard"` share one conceptual "step 3". */
const STEP_LABELS: Record<LegacyPrimeMigrationWizardStep, string> = {
  intro: "Why & What",
  account: OURONET_CODEX_MASTER,
  payment: "Payment Key Setup",
  guard: "Ouronet Account Guard Setup",
  review: "Review & Commit",
  arweave: "Arweave Accounts",
  finalize: "Finalize",
};

/**
 * The subtitle's step NUMBER — distinct from `STEP_ORDER`'s plain index
 * because `"payment"`/`"guard"` are sub-steps of one conceptual "step 3"
 * (the owner's own "Step 3A"/"Step 3B" naming), not two more steps added to
 * the count. `"review"` stays "4" rather than becoming "5" — the overall
 * flow reads as five stages to the user, the third one just has two
 * screens. `"finalize"` is never looked up here (see the subtitle
 * computation below, which special-cases it, same as before this change).
 *
 * `"arweave"` IS a genuine fifth numbered stage (`docs/work/
 * wizard-arweave-step/design.md`), not a sub-step of review: it is a
 * separate question (does this codex hold the master's Arweave accounts?)
 * answered on its own screen, with its own gate, and — unlike 3A/3B, which
 * are two halves of one "set up your keys" decision — nothing about it is
 * part of the decision before it. */
const STEP_DISPLAY_NUMBER: Record<Exclude<LegacyPrimeMigrationWizardStep, "finalize">, string> = {
  intro: "1",
  account: "2",
  payment: "3A",
  guard: "3B",
  review: "4",
  arweave: "5",
};

/**
 * How many numbered stages the subtitle counts out of. DERIVED from
 * {@link STEP_DISPLAY_NUMBER}, never typed as a literal: the previous
 * hardcoded `of 4` at the `CodexModalShell` call site is exactly what went
 * stale the moment a real fifth step was added, and a count that cannot
 * drift from the map it describes is the fix. Counts DISTINCT leading
 * numbers rather than map entries, so `"3A"`/`"3B"` collapse back into the
 * one stage they are.
 */
const STEP_DISPLAY_TOTAL = new Set(
  Object.values(STEP_DISPLAY_NUMBER).map((n) => n.replace(/[^0-9]/g, "")),
).size;

/** Owner (live testing, `wizard-page2-and-dashboard-fixes` round 6):
 *  "at every stage we show only the tickers that have been settled up
 *  to that step... Going back should show no tickers, since going
 *  back, means the forward selections are reverted, or not done yet."
 *  Payment/guard default to a real (non-null) choice from the moment
 *  the wizard mounts — `paymentChoice`/`guardChoice` being non-null is
 *  NOT the same thing as "the user has actually reached that step".
 *  This ordering lets the Settling Dashboard gate each role's own
 *  ticker on whether `step` has reached (or passed) that role's own
 *  step — purely a function of the CURRENT `step`, so navigating
 *  backward un-gates (reverts) later roles automatically, with no
 *  separate "furthest step ever reached" ratchet needed. */
const STEP_ORDER: Record<LegacyPrimeMigrationWizardStep, number> = {
  intro: 0,
  account: 1,
  payment: 2,
  guard: 3,
  review: 4,
  arweave: 5,
  finalize: 6,
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

/**
 * Shown when the derivation RAN and resolved, but the codex still does not
 * hold Arweave accounts #0 and #1 under the Codex Master Seed
 * (`arweave-master-accounts` T3). A real, reachable state, not a theoretical
 * one: a PARTIAL delivery resolves (only a zero-key derivation rejects), so
 * "the call came back" has never been evidence of the end state.
 *
 * Says what is missing and that re-running finishes it, because that is the
 * truth — the positions that DID arrive are kept, so a second attempt only
 * pays for what is still absent. The alternative, which this replaces, was
 * printing "This codex is now eligible." over a dark violet ticker.
 */
export const ARWEAVE_MASTER_ACCOUNTS_NOT_HELD_TEXT =
  `This codex still doesn't hold Arweave accounts #0 and #1 derived from its ${CODEX_MASTER_SEED}, so it is not eligible yet. Nothing else is lost — every other choice is saved, and running Finalize again picks up from the accounts that are still missing.`;

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

// Shared warning-box visuals — one role="alert" box style for every
// warning line in this file (the two option-3 ones above, Finalize's own
// error box, etc.) rather than a separate copy of the same style object
// per caller.
//
// Page 2's option-1 ("keep current") USED to show a warning here too —
// "Keeping this account will not make seed-words-only restore possible
// — it has no known recovery words on record" — whenever the current
// account's own `originSeedTab === undefined`. Owner correction (live
// testing, `wizard-page2-and-dashboard-fixes` round 3): "whatever
// Ouronet Account you choose, it makes seed word recuperation possible,
// so i dont know what you had to write that." Removed outright, not
// just re-gated on a better signal: `originSeedTab` is a provenance tag
// stamped only at account-SPAWN time, never derived from or verified
// against the actual stored secret (the SAME reason
// `resolveFinalizeDerivation`'s own doc comment, below, already stopped
// hard-gating Finalize on it two rounds ago) — and `SeedRevealModal`
// (this same round) now recovers real seed material for EVERY account/
// seed shape, so there is no real account this warning was ever
// correctly describing.
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
// owner (live testing, this session): "only the circled 1/2 can be
// pressed, we need to be able to make the whole selection clickable" —
// every option row below now carries its OWN onClick (duplicated from
// its inner header button's, same handler) so a click ANYWHERE on the
// card — the description text included — selects it, not just the
// number badge/header row. `cursor: "pointer"` here is the matching
// visual cue for the whole card, not just the header.
const radioOptionStyle = (selected: boolean): React.CSSProperties => ({
  display: "flex",
  flexDirection: "column",
  gap: 8,
  padding: 14,
  borderRadius: 10,
  border: `1px solid ${selected ? ACCENT : "#262626"}`,
  backgroundColor: selected ? ACCENT + "0f" : "transparent",
  cursor: "pointer",
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

/** owner (live testing, this session): "the user has to see, hey my guard
 *  currently is a keyset-ref" — this is the SAME blue "keyset-ref" pill
 *  `GuardTree.tsx` (the Codex ID page's own guard renderer) already uses
 *  for this exact shape (`KIND_COLORS["keyset-ref"]`: bg `#3b82f620`, fg
 *  `#60a5fa`) — reused verbatim here rather than inventing new vocabulary,
 *  so a user sees the SAME label for the SAME fact on both screens. */
function KeysetRefBadge(): React.ReactElement {
  return (
    <span
      data-testid="legacy-prime-migration-guard-keyset-ref-badge"
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 10,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        color: "#60a5fa",
        backgroundColor: "#3b82f620",
        border: "1px solid #3b82f660",
      }}
    >
      Keyset-ref
    </span>
  );
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

/**
 * Page 2's decrypt-probe diagnostics, rendered INSIDE the progress panel
 * (`honest-failure-reporting` §1, acceptance criterion 2).
 *
 * Everything this step knows about a failure — `probeErrors`, the inline
 * unlock prompt, `classifyDecryptError`'s whole typed taxonomy — was
 * rendered BELOW the progress panel's early return, i.e. unreachable for
 * exactly as long as the panel was the only thing on screen. On the
 * owner's 14-account codex that means a pass where account 1 fails says
 * nothing at all until (and unless) account 14 comes back. A failure that
 * has already happened is a fact the screen can state immediately.
 *
 * Renders nothing at all when there is nothing to report — the same
 * "absent data, no placeholder" convention this file follows elsewhere.
 */
function ProbeDiagnostics({
  lines,
  fatal,
  testid,
}: {
  lines: readonly { id: string; name: string; reason: string }[];
  fatal: string | null;
  testid: string;
}): React.ReactElement | null {
  if (lines.length === 0 && fatal === null) return null;
  return (
    <div
      data-testid={testid}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        padding: "8px 10px",
        borderRadius: 8,
        backgroundColor: "#c0392b12",
        border: "1px solid #c0392b40",
      }}
    >
      <span style={{ fontSize: 11, fontWeight: 700, color: "#e07b72" }}>
        {lines.length > 0
          ? `${lines.length} account${lines.length === 1 ? "" : "s"} could not be read:`
          : "The account check failed:"}
      </span>
      {fatal !== null ? (
        <span style={{ fontSize: 11, color: "#e07b72" }}>{fatal}</span>
      ) : null}
      {lines.map((l) => (
        <span key={l.id} style={{ fontSize: 11, lineHeight: 1.5, color: "#b9847e" }}>
          <strong style={{ color: "#d2d3d4" }}>{l.name}</strong>
          {" — "}
          {l.reason}
        </span>
      ))}
    </div>
  );
}

/** Page 2 — the Prime Ouronet Account identity choice (three radio-style
 *  options; see the module doc). Purely a selection UI: choosing any
 *  option only calls `onChoose`, never performs account activation or any
 *  other side effect. */
function AccountStep({
  // Owner (`wizard-page2-and-dashboard-fixes`, this round): option 1's own
  // "(its Chainweb seed: X)" mention is gone (condensed per that round's
  // "optimise option 1... to not use so much vertical space" ask) — this
  // prop stays part of the component's own public signature (existing
  // callers/tests still pass it) but is no longer read inside the
  // component itself.
  currentPrimeSeed: _currentPrimeSeed,
  currentPrimeAccount,
  allAccounts,
  choice,
  onChoose,
  getPassword,
  authenticate,
  passwordEpoch,
  onProbeSettledChange,
  probeDecrypt = smartDecrypt,
  probeWatchdogMs = PROBE_WATCHDOG_MS_DEFAULT,
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
  /** Owner (live testing, this round): "as long as the Ouronet Account
   *  isnt selected... the View Seed button is disabled... Only when the
   *  step 2 has popped [i.e. the probe has settled]... THEN the view seed
   *  button is lit." The probe's settle state (`probePhase`) is otherwise
   *  entirely private to this component — the Settling Dashboard lives in
   *  the PARENT wizard, so it needs a way to observe the settle
   *  transition. Fired from a `useEffect` (never during render) whenever
   *  `probePhase` changes; optional so every existing non-probe caller
   *  (tests, `getPassword` absent) keeps working unchanged. */
  onProbeSettledChange?: (settled: boolean) => void;
  /** The decrypt seam, defaulting to the real `smartDecrypt` — see
   *  {@link LegacyPrimeMigrationWizardProps.probeDecrypt}. */
  probeDecrypt?: (secret: string, password: string) => Promise<string>;
  /** The watchdog's wall clock, defaulting to
   *  {@link PROBE_WATCHDOG_MS_DEFAULT} — see
   *  {@link LegacyPrimeMigrationWizardProps.probeWatchdogMs}. */
  probeWatchdogMs?: number;
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
  /**
   * Set when the WATCHDOG — not the pass itself — ended the pass
   * (`honest-failure-reporting` §1). `unread` is how many candidates had
   * still not come back either way at that moment.
   *
   * A settled phase alone cannot carry this fact: a pass that genuinely
   * finished and a pass that was cut off after 90 seconds both leave the
   * step rendering its list, and the second one is making claims
   * ("Recommended", "No known words") about accounts it never actually
   * read. So the banner below states it, by count, above everything else
   * on the step, with the re-check path right there.
   */
  const [probeStall, setProbeStall] = useState<{ unread: number } | null>(null);
  /**
   * Set when the pass's own async body rejected OUTRIGHT — see the
   * `.catch` on the fire-and-forget below. Previously that rejection had
   * nowhere to go: an unhandled promise rejection in the console, a
   * progress panel that never moved, and no UI consequence whatsoever.
   */
  const [probeFatalError, setProbeFatalError] = useState<string | null>(null);

  // Owner (live testing, this round): the Settling Dashboard's "View
  // seed" button must stay disabled until THIS step's own probe has
  // settled (see `onProbeSettledChange`'s own doc for the full quote).
  // Reported via effect, never read mid-render, so the parent's own
  // state update happens as its own commit, not a render-phase side
  // effect.
  useEffect(() => {
    onProbeSettledChange?.(probePhase === "settled");
  }, [probePhase, onProbeSettledChange]);

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
  /**
   * The last pass that actually FINISHED — a separate fact from
   * `startedPassRef`, and the missing half of the exactly-once guard.
   *
   * `honest-failure-reporting` §1, the defect that cost the owner the most
   * time. "This pass was already claimed" was being used to answer two
   * different questions: *is a pass in flight?* (don't start a second one)
   * and *is the answer already on screen?* (don't re-render the spinner).
   * It can only answer the first. So when a sibling effect pushed
   * `probePhase` back to `"pending"` — `resetFailedProbes`, which runs on
   * every `passwordEpoch`/`probeRunKey` change AND on every StrictMode
   * remount — the probe effect declined on the stale claim and left the
   * phase exactly where that sibling had put it: `"pending"`, with the
   * step's whole body withheld behind the progress panel's early return,
   * forever.
   *
   * With the completion recorded separately, a declined re-run can tell
   * the two apart and SETTLE instead of hanging (see the effect below).
   */
  const completedPassRef = useRef<string | null>(null);

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
    // A new attempt is pending, so last attempt's verdicts about it —
    // "the watchdog gave up on N accounts", "the pass itself blew up" —
    // are no longer true of anything. Cleared here rather than at the
    // banner, so there is exactly one place a retry is defined.
    setProbeStall(null);
    setProbeFatalError(null);
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
          // `probeDecrypt`, not the imported `smartDecrypt` directly —
          // same function by default (see this component's own
          // `probeDecrypt` prop), injectable for specs that need a decrypt
          // which fails or never returns.
          const plain = await probeDecrypt(account.secret, password);
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
    if (startedPassRef.current === passKey) {
      // Already claimed — but "claimed" alone is not a state the UI can
      // render. If that pass FINISHED, its answer is already in
      // `probedHasWords`/`probeErrors`, so the only correct phase is
      // "settled": re-assert it, because `resetFailedProbes` (a sibling
      // effect, ordered BEFORE this one) has just pushed it back to
      // "pending". Without this, a StrictMode remount after a completed
      // pass left the step withheld behind the progress panel forever —
      // see `completedPassRef`. Still running: leave it alone, the pass
      // owns the phase.
      if (completedPassRef.current === passKey) setProbePhase("settled");
      return;
    }
    startedPassRef.current = passKey;

    // Snapshot the work ONCE, up front. Deliberately read out of the
    // current render's `probedHasWords` rather than depending on it:
    // confirmed results survive a retry, but a committed result must
    // never feed back into this effect's identity again.
    const pending = existingCandidates.filter((c) => probedHasWords[c.account.id] !== true);
    if (pending.length === 0) {
      // A pass with nothing to decrypt is a pass that COMPLETED — the
      // ordinary shape of a codex whose only Standard DALOS account is
      // already its prime (`computeExistingAccountCandidates` excludes the
      // current prime, every Smart account and every APOLLO account).
      // Recording the completion is what makes this exit definite rather
      // than a claim no successor can interpret; the previous version
      // returned here with the claim held and nothing to say it was done,
      // which is exactly the stall the owner hit.
      completedPassRef.current = passKey;
      setProbeProgress({ done: 0, total: 0 });
      setProbePhase("settled");
      return;
    }

    let cancelled = false;
    // Round 10b: did this pass reach its own end? Decides whether the
    // cleanup below hands the pass BACK for a successor to run.
    let completed = false;
    /** Candidates that came back — either way — before the watchdog fired.
     *  Lets the watchdog name exactly what it is giving up on instead of
     *  reporting a count of "everything we asked for". */
    const returned = new Set<string>();
    /**
     * THE WATCHDOG (`honest-failure-reporting` §1). Releasing the claim on
     * every exit fixes the stalls that have an exit; this covers the one
     * that does not — a decrypt that neither resolves nor rejects, so the
     * pool never drains, the `finally` never runs, and the panel owns the
     * screen for the rest of the session with no CPU, no error and no
     * retry (precisely the owner's report).
     *
     * It ends the pass rather than politely waiting: `cancelled` stops the
     * pool from burning further PBKDF2 work on a run whose answer is no
     * longer going to be used, each un-returned candidate gets the honest
     * {@link PROBE_TIMED_OUT_ACCOUNT_TEXT} reason (never one of
     * `classifyDecryptError`'s verdicts — nothing was learned about these),
     * and the phase settles so the step's body, its re-check control and
     * its diagnostics are all reachable again.
     */
    const watchdog = setTimeout(() => {
      if (completed || cancelled) return;
      const unread = pending.filter((c) => !returned.has(c.account.id));
      if (unread.length === 0) {
        // Everything came back; only the pass's own tail is outstanding.
        // Nothing to report, but the phase still must not hang.
        setProbePhase("settled");
        return;
      }
      cancelled = true;
      setProbeErrors((prev) => {
        const next = { ...prev };
        for (const c of unread) {
          if (next[c.account.id] === undefined) next[c.account.id] = PROBE_TIMED_OUT_ACCOUNT_TEXT;
        }
        return next;
      });
      setProbeStall({ unread: unread.length });
      setProbePhase("settled");
    }, Math.max(0, probeWatchdogMs));
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
            returned.add(id);
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
        // Recorded for the NEXT run of this effect (a StrictMode remount,
        // or any re-render that re-arms the phase): this pass's answer is
        // already on screen, so a declined re-run must settle rather than
        // leave the progress panel up. See `completedPassRef`.
        completedPassRef.current = passKey;
      } finally {
        // The pass answered (or died trying) — the watchdog must not fire
        // over it later and claim accounts went unread.
        clearTimeout(watchdog);
        // Round 10: ALWAYS leave the progress state, whatever happened —
        // locked, wrong password, a throw from anywhere. The step hides
        // its whole body behind this phase now, so a pass that fails to
        // settle is a dead end with no way out, which is precisely the
        // failure the owner just hit.
        if (!cancelled) setProbePhase("settled");
      }
    })().catch((e: unknown) => {
      // `honest-failure-reporting` §1, item 4: this fire-and-forget had no
      // `.catch`, so anything the inner `try/finally` could not contain
      // (a throw from `setProbePhase` itself, a rejection added by a later
      // edit between the two) became an unhandled rejection with ZERO UI
      // consequence — the single most expensive shape of failure in this
      // whole file. Defensive by design and expected never to fire; if it
      // ever does, it says so on screen instead of in a console nobody has
      // open.
      clearTimeout(watchdog);
      if (cancelled) return;
      setProbeFatalError(
        e instanceof Error ? e.message : "The account check failed for an unknown reason.",
      );
      setProbePhase("settled");
    });
    return () => {
      cancelled = true;
      clearTimeout(watchdog);
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
    // `probeDecrypt`/`probeWatchdogMs` are deliberately NOT dependencies.
    // A pass's identity is WHICH accounts, WHICH password era, and an
    // explicit retry — nothing else may restart it (that lesson is the
    // whole of round 10's note above). Both are read from the closure of
    // whichever render started the pass; an inline arrow prop would
    // otherwise re-key this effect on every single render, which is the
    // exact failure mode this dep list exists to prevent.
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

  /** `probeErrors` as renderable, NAMED lines — the raw record is keyed by
   *  account id, which is not a thing the owner can recognise. Shared by
   *  the progress panel's own diagnostics (criterion 2: a failure is
   *  visible while the probe is still running, not only after it) and by
   *  the terminal stall banner. */
  const probeErrorLines = useMemo(
    () =>
      Object.entries(probeErrors).map(([id, reason]) => {
        const candidate = existingCandidates.find((c) => c.account.id === id);
        return {
          id,
          name: candidate?.account.name ?? candidate?.account.address ?? id,
          reason,
        };
      }),
    [probeErrors, existingCandidates],
  );

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
  const anyWriteSeedCandidateExists = existingCandidates.some((c) => c.recommended);
  const keepRecommended = currentIsWriteSeedOrigin;
  const newWordsRecommended = !currentIsWriteSeedOrigin && !anyWriteSeedCandidateExists;

  // Owner (`wizard-page2-and-dashboard-fixes`, this round): "a lot of
  // ouronet Accounts... add to it a search bar that searches for a given
  // name" — a plain client-side filter over the already-loaded candidate
  // list (every candidate's own name is already in memory by the time
  // this renders; no decrypt/network involved). An account with no
  // `name` at all is excluded whenever the search box is non-empty,
  // included whenever it's empty — matching Option 2's own existing
  // name-or-address display fallback elsewhere in this component.
  const [existingSearch, setExistingSearch] = useState("");
  const filteredExistingCandidates = useMemo(() => {
    const query = existingSearch.trim().toLowerCase();
    if (!query) return sortedExistingCandidates;
    return sortedExistingCandidates.filter(({ account: a }) =>
      (a.name ?? "").toLowerCase().includes(query),
    );
  }, [sortedExistingCandidates, existingSearch]);

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
          {/* `honest-failure-reporting` §1, criterion 2 — the diagnostics
              are no longer hidden BEHIND this panel. Whatever has already
              failed is stated here, by account name, while the rest of the
              pass continues. */}
          <ProbeDiagnostics
            lines={probeErrorLines}
            fatal={probeFatalError}
            testid="legacy-prime-migration-account-probe-progress-errors"
          />
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

      {/* The WATCHDOG's terminal statement (`honest-failure-reporting` §1).
          Above every option on purpose: the list below is about to make
          claims ("Recommended", "No known words") about accounts this pass
          never actually read, and the count of those is the first thing
          that has to be on screen. The alternative — which this replaces —
          was a progress panel that never came down. */}
      {probeStall !== null || probeFatalError !== null ? (
        <div
          data-testid="legacy-prime-migration-account-probe-stalled"
          role="alert"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            padding: "10px 12px",
            borderRadius: 8,
            backgroundColor: "#c0392b12",
            border: "1px solid #c0392b40",
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 700, color: "#e07b72" }}>
            {probeStall !== null
              ? `Could not read ${probeStall.unread} account${probeStall.unread === 1 ? "" : "s"}.`
              : "The account check failed."}
          </span>
          <span style={stepParagraphStyle}>
            {probeStall !== null
              ? "The check ran out of time before their secrets came back, so nothing is known about them either way — they are listed below with no verdict. Nothing in this codex was changed."
              : probeFatalError}
          </span>
          <button
            type="button"
            data-testid="legacy-prime-migration-account-probe-stalled-recheck"
            onClick={() => setProbeRunKey((n) => n + 1)}
            style={{
              alignSelf: "flex-start",
              fontSize: 10,
              fontWeight: 700,
              color: "#d2d3d4",
              background: "none",
              border: "1px solid #c0392b60",
              borderRadius: 6,
              padding: "3px 8px",
              cursor: "pointer",
            }}
          >
            Try reading them again
          </button>
        </div>
      ) : null}

      {/* Option 1 — keep current. Always available. */}
      <div
        data-testid="legacy-prime-migration-account-option-keep"
        role="radio"
        aria-selected={isKeepSelected}
        style={radioOptionStyle(isKeepSelected)}
        onClick={() => onChoose({ kind: "keep-current" })}
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
        {/* Owner (`wizard-page2-and-dashboard-fixes`, this round):
            "optimise option 1... to not use so much vertical space with
            the explanation" — the chip above already shows this
            account's name/address/curve unambiguously; this line no
            longer repeats it in full prose. */}
        <p style={stepParagraphStyle}>No identity change.</p>
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
          <input
            type="text"
            data-testid="legacy-prime-migration-account-existing-search"
            placeholder="Search by name…"
            value={existingSearch}
            onChange={(e) => setExistingSearch(e.target.value)}
            style={{
              width: "100%", boxSizing: "border-box", padding: "6px 10px",
              borderRadius: 6, border: "1px solid #333", backgroundColor: "#111",
              color: "#d2d3d4", fontSize: 12,
            }}
          />
          {/* Owner: "the Ouronet Account selector make it have its own
              scroll" — bounded height + its own `overflowY`, scoped to
              THIS list only, not the modal's own outer scroll. */}
          <div
            role="listbox"
            aria-label="Existing account to promote"
            style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 320, overflowY: "auto" }}
          >
            {filteredExistingCandidates.map(({ account, recommended, hasKnownWords }) => {
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
                                  : // `honest-failure-reporting` §1: the watchdog gave
                                    // up on this one. NOT "unreadable" — that claims
                                    // the secret was read and rejected, when in fact
                                    // the decrypt never came back at all.
                                    probeErrors[account.id] === PROBE_TIMED_OUT_ACCOUNT_TEXT
                                    ? "timed out"
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
        onClick={() => onChoose({ kind: "new-words", words: newWordsDraft })}
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
        {/* Owner (`wizard-page2-and-dashboard-fixes`, this round):
            "optimise option 1 and 3 to not use so much vertical space
            with the explanation" — ONE combined alert instead of two
            full-prose boxes stacked; both constants' exact wording is
            preserved verbatim (`design.md`'s own text), just joined. */}
        <div role="alert" style={warningBoxStyle}>
          {NEW_ACCOUNT_ACTIVATION_WARNING_TEXT}. {NEW_ACCOUNT_EMPTY_WARNING_TEXT}
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
 * The bare public key behind a StoaChain payment-key ADDRESS.
 *
 * MIRRORED (not shared) from `internal/outstandingKeyChanges.ts`'s own
 * `bareKeyFromAddress`, which is module-private there. Exporting it would
 * mean editing that file, and this fix is deliberately confined to this
 * one component; duplicating six lines of pure string handling is the
 * cheaper of the two, and it is already this codebase's own local idiom —
 * `seedDashboard.ts:97`, `:119`, `:155` and `keySource.ts:77` each inline
 * the identical strip-then-compare rather than reaching for a shared
 * helper. If a fourth caller ever appears, promote it out of
 * `outstandingKeyChanges.ts` and delete this copy.
 *
 * The rule itself is `state/store.ts:2680`'s own encoding of the two forms
 * a payment key is stored in: `seedType === "stoic" ? paymentPublicKey :
 * \`k:${paymentPublicKey}\`` — a stoic seed's address IS the bare key,
 * every other seed's carries the `k:` sigil. Every key this file compares
 * it against (`seeds[].accounts[].publicKey`, `pureKeypairs[].publicKey`,
 * `deriveStoaDalosKeypairAtIndex`'s output, `committed.paymentPublicKey`)
 * is bare, so the address has to reduce to bare before it can be matched
 * or locked at all.
 *
 * Defensive on the input TYPE, deliberately: `IOuroAccount` types
 * `stoaChainLedger` as `string | null`, but real persisted legacy accounts
 * — the ones this wizard exists to rescue — carry it absent entirely, the
 * hazard `seedDashboard.ts:146-155` documents from live testing (a missing
 * field once took the whole wizard down on `.startsWith` of `undefined`).
 * Anything that is not a usable string is "none on record", never a crash
 * at render time.
 */
function bareKeyFromAddress(keyOrAddr: unknown): string | null {
  if (typeof keyOrAddr !== "string" || keyOrAddr.length === 0) return null;
  return keyOrAddr.startsWith("k:") ? keyOrAddr.slice(2) : keyOrAddr;
}

/**
 * The CURRENT payment key OF THE CHOSEN ACCOUNT — its own registered
 * `stoaChainLedger`, read bare.
 *
 * CORRECTED (owner-reported, found on a real codex and verified by
 * decrypting that codex's export). This used to return
 * `seeds[0].accounts[index === 0].publicKey`: the first Chainweb seed's
 * position 0, POSITIONALLY, never consulting the account whose payment key
 * it claimed to report. On the owner's codex those are two different keys —
 * the account's real on-chain payment key is `k:e20f2672…f231`, position 0
 * of a NON-prime koala seed, while `seeds[0]` is the prime stoic
 * "Prime Codex Seed" whose position 0 is `225eb6d1…`. So the screen
 * printed the stoic key as "Current payment key" under the caption "Held
 * in this codex as Master Chainweb Seed - Key #0", a false statement about
 * that account; the kept-key SETTLED FOR box and the kept key's own
 * derivation label ("This key's own derivation: Stoic Dalos", over a
 * Koala-derived key) inherited the same wrong key; and worst, `runFinalize`
 * locked it non-removable via `secureMasterAccount` and recorded it with
 * `recordMigrationCommit` on a `"keep"` choice — a WRITE, of the wrong key,
 * against a real codex.
 *
 * `stoaChainLedger` is the account's live PAYMENT key (the selector fills
 * it from the chain's `payment-key`, `ui/tabs/OuronetAccountsTab.tsx:115`)
 * — not `chainPublicKey`, which is the account's own identity key and says
 * nothing about which payment key is in force. Same correction, same
 * field, same reason as `internal/outstandingKeyChanges.ts`'s payment
 * branch (`docs/work/migration-execute/design.md` §7 defect 2).
 *
 * `null` when the account has none on record stays `null`: there is then no
 * honest answer, and the positional guess is exactly what is being removed.
 * Every consumer already handles it — the payment section renders its own
 * "no payment key on record" box, the review step omits its FROM line, and
 * `runFinalize` passes `null` through to `secureMasterAccount`, where it is
 * the defined "unresolved" value that suppresses releasing existing locks
 * and adds none (`masterKeyLockDelta.ts`). Locking nothing is recoverable;
 * locking another seed's key is not.
 */
function currentPaymentKeyOf(account: IOuroAccount | null | undefined): string | null {
  return bareKeyFromAddress(account?.stoaChainLedger);
}

/** owner (live testing, this session): "when selecting option 2 (keep the
 *  same payment key), then the Derivation method changes automatically to
 *  the type of derivation that key is derived from. So it would be Koala,
 *  Chainweaver or PureKey (since that key is in the codex, you could know
 *  what to display here). If that payment key ISNT in the codex, or its
 *  another type of non k: address, we simply display a warning."
 *
 *  Walks the same two places `identifyKeySource` (`keySource.ts`) already
 *  walks — the codex's OWN seeds, then its pure keypairs — but returns a
 *  clean discriminated kind instead of a display label/color, since the
 *  caller here needs to pick its OWN wording ("Koala"/"Chainweaver"/
 *  "PureKey"/a foreign-key warning), not `identifyKeySource`'s own
 *  "SeedName #N" labelling (that's for naming a SPECIFIC account, not
 *  classifying a key's origin TYPE). `c:`/`u:`/`w:` addresses are reported
 *  as `"foreign"` too — the owner's own "or non k: address detected".
 *
 *  `PaymentKeyOrigin`/`paymentKeyOriginLabel` themselves now live in
 *  `seedDashboard.ts` (`wizard-seed-dashboard-refinements`) — that module's
 *  own sub-row-label computation needs them too, and importing them FROM
 *  this file would be circular (this file already imports FROM
 *  `seedDashboard.ts`). Imported back below. */
function detectPaymentKeyOrigin(
  key: string | null,
  seeds: readonly IStoaChainSeed[],
  pureKeypairs: readonly IPureKeypair[],
): PaymentKeyOrigin | null {
  if (!key) return null;
  if (key.startsWith("c:") || key.startsWith("u:") || key.startsWith("w:")) {
    return { kind: "foreign" };
  }
  const pub = key.startsWith("k:") ? key.slice(2) : key;
  for (const seed of seeds) {
    if ((seed.accounts ?? []).some((a) => a.publicKey === pub)) {
      return { kind: "seed", seedType: normalizeSeedType(seed.seedType) };
    }
  }
  for (const pk of pureKeypairs) {
    if (pk.publicKey === pub) return { kind: "pure-keypair" };
  }
  return { kind: "foreign" };
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


/** The RIGHT side of the payment step's "Current / Settled for" row — a
 *  live summary of whatever `choice` currently is. "keep" restates the
 *  SAME origin detection (`PaymentKeyOrigin`) the "Keep the current
 *  payment key" option itself already shows, so the consequence reads
 *  the same on both sides of the row. */
function PaymentSettledSummary({
  choice,
  currentKey,
  origin,
  newKey,
  preview,
}: {
  choice: LegacyPrimeMigrationPaymentChoice | null;
  currentKey: string | null;
  origin: PaymentKeyOrigin | null;
  newKey: string | null;
  preview: MasterKeyPreview;
}): React.ReactElement {
  if (!choice) {
    return (
      <p data-testid="legacy-prime-migration-payment-settled-none" style={stepParagraphStyle}>
        Choose an option below.
      </p>
    );
  }
  if (choice.kind === "keep") {
    const originNote =
      origin === null ? "" : origin.kind === "foreign"
        ? " It is not in this codex, or is a non-k: address."
        : ` It is a ${paymentKeyOriginLabel(origin)} key.`;
    return (
      <div data-testid="legacy-prime-migration-payment-settled">
        <p style={stepParagraphStyle}>Unchanged.{originNote}</p>
        {currentKey ? <KeyLine label="" value={currentKey} /> : null}
      </div>
    );
  }
  // "stoic-dalos-position-0" — a new key, derived at position 0. The
  // `testId` here is the SAME `legacy-prime-migration-payment-to` the
  // now-removed standalone FROM/TO box used to carry on its own
  // `KeyLine` — see that box's own removal note in `PaymentKeySection`.
  return (
    <div data-testid="legacy-prime-migration-payment-settled">
      <p style={stepParagraphStyle}>
        A new key, derived at position 0 of the {MASTER_CHAINWEB_SEED}.
      </p>
      {newKey ? (
        <KeyLine label="" value={newKey} testId="legacy-prime-migration-payment-to" />
      ) : (
        <p style={stepParagraphStyle}>
          {preview.status === "error" ? `Could not derive: ${preview.message}` : "Still deriving…"}
        </p>
      )}
    </div>
  );
}

/** Page 3, section 1 - the payment key. */
function PaymentKeySection({
  currentKey,
  ties,
  origin,
  preview,
  choice,
  onChoose,
}: {
  currentKey: string | null;
  ties: { seedName: string; position: number } | null;
  origin: PaymentKeyOrigin | null;
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

      {/* owner (live testing, this session): same "Current / Settled for"
          rectangle pair as the guard step now uses — the LEFT side is
          this step's pre-existing "current payment key" content,
          unchanged; the RIGHT side is new, summarizing whatever
          `choice` currently is. */}
      <CurrentSettledRow
        current={
          currentKey ? (
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
            // The copy used to read "this codex has no Chainweb key at
            // position 0 yet" — the old, positional question. The honest
            // one is about the ACCOUNT: a legacy/imported account can
            // genuinely carry no `stoaChainLedger` at all, and naming
            // some other seed's key in its place is the bug this box's
            // own `currentKey` source was just corrected for.
            <p data-testid="legacy-prime-migration-payment-current-none" style={stepParagraphStyle}>
              This account has no payment key on record, so there is no current payment key to
              show. Keeping it would keep nothing — derive one instead.
            </p>
          )
        }
        settled={
          <PaymentSettledSummary
            choice={choice}
            currentKey={currentKey}
            origin={origin}
            newKey={newKey}
            preview={preview}
          />
        }
      />

      <div data-testid="legacy-prime-migration-payment-option-derive"
           role="radio" aria-selected={isDerive} style={radioOptionStyle(isDerive)}
           onClick={() => onChoose({ kind: "stoic-dalos-position-0" })}>
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
           role="radio" aria-selected={isKeep} style={radioOptionStyle(isKeep)}
           onClick={() => onChoose({ kind: "keep" })}>
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
        {/* owner (live testing, this session): "the Derivation method
            changes automatically to the type of derivation that key is
            derived from... If that payment key ISNT in the codex, or its
            another type of non k: address, we simply display a warning." */}
        {origin ? (
          origin.kind === "foreign" ? (
            <p role="alert" data-testid="legacy-prime-migration-payment-keep-origin-warning"
               style={{ ...stepParagraphStyle, color: "#fca5a5" }}>
              Payment key is not in the codex, or non-k: address detected.
            </p>
          ) : (
            <p data-testid="legacy-prime-migration-payment-keep-origin" style={stepParagraphStyle}>
              This key&apos;s own derivation: <strong>{paymentKeyOriginLabel(origin)}</strong>.
            </p>
          )
        ) : null}
      </div>
    </div>
  );
}

/** owner (live testing, this session): "we should present current guard...
 *  and then the right rectangle... would show the guard you settled on.
 *  Current detected, and the upcoming one you settled for in a simple
 *  Current/Before and After Rectangle." Two side-by-side boxes, used by
 *  BOTH the payment and guard steps so the same "what IS it / what will
 *  it become" pattern reads identically on both — a small arrow between
 *  them (the same gesture the owner's own screenshot annotation drew)
 *  makes the left-to-right direction explicit rather than implied. */
function CurrentSettledRow({
  current,
  settled,
}: {
  current: React.ReactNode;
  settled: React.ReactNode;
}): React.ReactElement {
  const boxStyle: React.CSSProperties = {
    flex: "1 1 0%",
    minWidth: 0,
    padding: 10,
    borderRadius: 8,
    backgroundColor: "#18181B",
    border: "1px solid #262626",
    display: "flex",
    flexDirection: "column",
    gap: 4,
  };
  const labelStyle: React.CSSProperties = {
    margin: "0 0 2px",
    fontSize: 10,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    color: "#8b8b96",
  };
  return (
    <div style={{ display: "flex", alignItems: "stretch", gap: 8 }}>
      <div data-testid="legacy-prime-migration-current-box" style={boxStyle}>
        <p style={labelStyle}>Current</p>
        {current}
      </div>
      <span aria-hidden="true" style={{ alignSelf: "center", color: "#555", fontSize: 16, flex: "0 0 auto" }}>
        &rarr;
      </span>
      <div data-testid="legacy-prime-migration-settled-box" style={boxStyle}>
        <p style={labelStyle}>Settled for</p>
        {settled}
      </div>
    </div>
  );
}

/** Reused by both {@link ReviewStep} (unchanged behavior, just no longer a
 *  second copy of this exact ternary) and the Guard step's own new
 *  "Settled for" box — the SAME "what will this guard choice actually
 *  produce" computation, now with one definition instead of two. */
/** The settled payment key — "derive" yields the freshly-derived position-0
 *  key once `preview` is ready, "keep" yields `currentPaymentKey` unchanged.
 *  Extracted so this ternary has exactly one definition (previously only
 *  inlined in `ReviewStep`); the Seed Dashboard
 *  (`docs/work/wizard-seed-dashboard/design.md`) needs the SAME value at
 *  the top-level component, not a second copy. */
function settledPaymentKeyOf(
  paymentChoice: LegacyPrimeMigrationPaymentChoice | null,
  preview: MasterKeyPreview,
  currentPaymentKey: string | null,
): string | null {
  const derived = preview.status === "ready" ? preview : null;
  return paymentChoice?.kind === "stoic-dalos-position-0" ? derived?.key0 ?? null : currentPaymentKey;
}

function summarizeGuardChoice(
  guardChoice: LegacyPrimeMigrationGuardChoice | null,
  preview: MasterKeyPreview,
): { headline: string; keys: readonly string[] | null; pred: string } | null {
  if (!guardChoice) return null;
  if (guardChoice.kind === "keep") {
    return { headline: "Unchanged.", keys: null, pred: "" };
  }
  const derived = preview.status === "ready" ? preview : null;
  const keys =
    guardChoice.kind === "recommended-single-key" || guardChoice.kind === "update-keyset-recommended"
      ? (derived ? [derived.key1] : null)
      : guardChoice.kind === "custom"
        || guardChoice.kind === "update-keyset-custom"
        || guardChoice.kind === "use-existing-keyset"
        ? guardChoice.keys
        : null;
  const pred =
    guardChoice.kind === "custom"
      || guardChoice.kind === "update-keyset-custom"
      || guardChoice.kind === "use-existing-keyset"
      ? guardChoice.pred
      : "keys-all";
  if (!keys || keys.length === 0) return { headline: "Still deriving…", keys: null, pred };
  return { headline: `A keyset of ${keys.length} key(s) under ${pred}.`, keys, pred };
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
          <KeysetRefBadge /> <strong>{resolution.ref}</strong>.
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
  // owner (live testing, this session): "we gotta show that there AND
  // expand it... the user has to see, hey my guard currently is a
  // keyset-ref" — folding the reference name into a sentence ("Guarded by
  // the on-chain keyset X...") wasn't legible enough as "this is a
  // REFERENCE, not a direct keyset". `KeysetRefBadge` now makes that shape
  // explicit and visually distinct — matching the same "keyset-ref" pill
  // the Codex ID page's own GuardTree already uses for this exact shape,
  // so the vocabulary is consistent across both screens.
  const viaRef = resolution.kind === "keyset-ref" ? resolution.ref
    : resolution.viaRef ?? null;
  return (
    <div data-testid="legacy-prime-migration-guard-current-keyset"
         style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <p style={stepParagraphStyle}>
        {viaRef ? (
          <>
            <KeysetRefBadge /> <strong>{viaRef}</strong> &mdash; names {resolution.keys.length} key(s)
            under {resolution.pred}:
          </>
        ) : (
          `Guarded by a keyset of ${resolution.keys.length} key(s) under ${resolution.pred}:`
        )}
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
  pureKeypairs,
  selectedKeys,
  pred,
  onChange,
}: {
  allSeeds: readonly IStoaChainSeed[];
  /** Pure keypairs join the seed-derived keys below, each still its OWN
   *  individually selectable checkbox — a predicate (e.g. keys-2-of-3)
   *  needs real, distinct public keys, so a pure keypair can never
   *  collapse into an unselectable blob HERE (only the Settling
   *  Dashboard's attribution card does that, see `PureKeysCardView`).
   *  `docs/work/wizard-keyset-scale-and-sidebar/design.md`'s "G". */
  pureKeypairs: readonly IPureKeypair[];
  selectedKeys: readonly string[];
  pred: string;
  onChange: (keys: readonly string[], pred: string) => void;
}): React.ReactElement {
  // `docs/work/wizard-keyset-scale-and-sidebar/design.md`'s "E — Search +
  // collapsed-by-default grouping in the picker": the flat `available` list
  // T3 extended with pure keys is partitioned into one disclosure per seed
  // (same `masterChainwebSeedName` naming this file already uses), plus one
  // trailing "Pure Keys" group — a seed/pure-keypairs source with no rows
  // contributes no group, same as the flat list contributed nothing for it.
  const groups: { name: string; rows: { publicKey: string; label: string }[] }[] = [
    ...allSeeds
      .map((seed, i) => ({
        name: masterChainwebSeedName(i, seed.isPrime, seed.name),
        rows: (seed.accounts ?? []).map((acc) => ({
          publicKey: acc.publicKey,
          label: `${masterChainwebSeedName(i, seed.isPrime, seed.name)} - Key #${acc.index}`,
        })),
      }))
      .filter((g) => g.rows.length > 0),
    // Labelled using the same vocabulary `identifyKeySource` (`keySource.ts`)
    // already established for a pure keypair's own label, rather than
    // inventing new wording.
    ...(pureKeypairs.length > 0
      ? [{
          name: "Pure Keys",
          rows: pureKeypairs.map((pk) => ({
            publicKey: pk.publicKey,
            label: pk.label || "Pure Keypair",
          })),
        }]
      : []),
  ];
  const available = groups.flatMap((g) => g.rows);

  const toggle = (k: string): void => {
    const next = selectedKeys.includes(k)
      ? selectedKeys.filter((x) => x !== k)
      : [...selectedKeys, k];
    const stillOk = isPredAvailable(pred, next.length);
    onChange(next, stillOk ? pred : "keys-all");
  };

  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  // A row matches on either its OWN label or its group's name — so typing
  // "Pure Keys" surfaces every pure key even though an individual pure
  // key's own label rarely mentions the group it's in.
  const rowMatches = (
    group: { name: string },
    row: { label: string },
  ): boolean => group.name.toLowerCase().includes(query) || row.label.toLowerCase().includes(query);

  // Collapsed by default, except a group already holding a selected key —
  // computed once, at genuine first mount (e.g. a resumed run can arrive
  // with `selectedKeys` already non-empty), not re-derived on every
  // `selectedKeys` change, so a later in-editor selection doesn't silently
  // re-open/re-close a group the user already toggled by hand.
  const [expanded, setExpanded] = useState<Record<number, boolean>>(() => {
    const init: Record<number, boolean> = {};
    groups.forEach((g, i) => {
      init[i] = g.rows.some((r) => selectedKeys.includes(r.publicKey));
    });
    return init;
  });
  const toggleGroup = (i: number): void => setExpanded((prev) => ({ ...prev, [i]: !prev[i] }));

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
        <>
          <input
            type="text"
            data-testid="legacy-prime-migration-guard-custom-search"
            placeholder="Search keys…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: "100%", boxSizing: "border-box", padding: "6px 10px",
              borderRadius: 6, border: "1px solid #333", backgroundColor: "#111",
              color: "#d2d3d4", fontSize: 12,
            }}
          />
          {groups.map((g, i) => {
            // While searching, a matching row force-expands its group
            // (never hidden behind a collapse) and a non-matching group
            // collapses, regardless of its own manual state; with the
            // search box empty, the manual/initial `expanded` state rules.
            const isExpanded = query ? g.rows.some((r) => rowMatches(g, r)) : !!expanded[i];
            const visibleRows = query ? g.rows.filter((r) => rowMatches(g, r)) : g.rows;
            return (
              <div key={g.name + i}>
                <button
                  type="button"
                  data-testid={`legacy-prime-migration-guard-custom-group-${i}`}
                  aria-expanded={isExpanded}
                  onClick={() => toggleGroup(i)}
                  style={{
                    display: "flex", width: "100%", justifyContent: "space-between",
                    alignItems: "center", cursor: "pointer", background: "transparent",
                    border: "1px solid #262626", borderRadius: 6, padding: "6px 8px",
                    color: "#d2d3d4", fontSize: 12, fontWeight: 600,
                  }}
                >
                  <span>{isExpanded ? "▾" : "▸"} {g.name}</span>
                  <span style={{ color: "#8b8b96", fontWeight: 400 }}>{g.rows.length}</span>
                </button>
                {isExpanded
                  ? visibleRows.map((k) => (
                      <label key={k.publicKey}
                             style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
                                      padding: "4px 8px 0 16px" }}>
                        <input
                          type="checkbox"
                          checked={selectedKeys.includes(k.publicKey)}
                          onChange={() => toggle(k.publicKey)}
                          aria-label={k.label}
                        />
                        <span style={{ ...stepParagraphStyle, color: "#d2d3d4" }}>{k.label}</span>
                      </label>
                    ))
                  : null}
              </div>
            );
          })}
        </>
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
  pureKeypairs,
}: {
  preview: MasterKeyPreview;
  choice: LegacyPrimeMigrationGuardChoice | null;
  onChoose: (c: LegacyPrimeMigrationGuardChoice) => void;
  allSeeds: readonly IStoaChainSeed[];
  pureKeypairs: readonly IPureKeypair[];
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
           role="radio" aria-selected={isKeep} style={radioOptionStyle(isKeep)}
           onClick={() => onChoose({ kind: "keep" })}>
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
           role="radio" aria-selected={isUpdateRecommended} style={radioOptionStyle(isUpdateRecommended)}
           onClick={() => onChoose({ kind: "update-keyset-recommended" })}>
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
           role="radio" aria-selected={isDirectRecommended} style={radioOptionStyle(isDirectRecommended)}
           onClick={() => onChoose({ kind: "recommended-single-key" })}>
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
           role="radio" aria-selected={isCustomGroup} style={radioOptionStyle(isCustomGroup)}
           // code review (guard-step-variants, extended for the "whole card
           // clickable" fix): same no-op-once-already-selected guard as the
           // header button below — clicking anywhere in the expanded
           // custom-editor area (which lives inside this same div) must
           // never re-fire this and wipe the user's in-progress selection.
           onClick={() => {
             if (!isCustomGroup) onChoose({ kind: "update-keyset-custom", keys: [], pred: "keys-all" });
           }}>
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
              pureKeypairs={pureKeypairs}
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
  pureKeypairs,
  describeKeyset,
}: {
  preview: MasterKeyPreview;
  choice: LegacyPrimeMigrationGuardChoice | null;
  onChoose: (c: LegacyPrimeMigrationGuardChoice) => void;
  allSeeds: readonly IStoaChainSeed[];
  pureKeypairs: readonly IPureKeypair[];
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
           role="radio" aria-selected={isDirectRecommended} style={radioOptionStyle(isDirectRecommended)}
           onClick={() => onChoose({ kind: "recommended-single-key" })}>
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
           role="radio" aria-selected={isKeep} style={radioOptionStyle(isKeep)}
           onClick={() => onChoose({ kind: "keep" })}>
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
           role="radio" aria-selected={isCustomGroup} style={radioOptionStyle(isCustomGroup)}
           onClick={() => {
             if (!isCustomGroup) onChoose({ kind: "custom", keys: [], pred: "keys-all" });
           }}>
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
                pureKeypairs={pureKeypairs}
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

/** The RIGHT side of the guard step's "Current / Settled for" row — a
 *  live summary of whatever `choice` currently is, via
 *  {@link summarizeGuardChoice} (the SAME computation `ReviewStep` uses).
 *
 *  Owner (live testing, this round): "Settle for Unchanged is incorrect,
 *  we should show the same keys as the one on left. instead of saying
 *  Unchanged... And if its the same then we add (unchanged) in
 *  parenthesis." `summarizeGuardChoice`'s own `"keep"` branch deliberately
 *  returns no keys at all (`{headline:"Unchanged.", keys:null, pred:""}`)
 *  — it's `ReviewStep`'s own "what will this choice PRODUCE" computation,
 *  with no reason to re-derive keys that aren't changing. THIS box needs
 *  the opposite for `"keep"`: the real CURRENT guard, from the SAME
 *  `resolution` the left-hand `CurrentGuardBlock` already renders — so
 *  the "keep" branch below mirrors THAT component's own per-kind
 *  branching exactly (never fabricating a key list for an
 *  unresolved/unsupported/unknown shape), just with "(unchanged)" folded
 *  into whichever branch actually applies. */
function GuardSettledSummary({
  choice,
  preview,
  resolution,
}: {
  choice: LegacyPrimeMigrationGuardChoice | null;
  preview: MasterKeyPreview;
  resolution: GuardKeyResolution | null;
}): React.ReactElement {
  if (choice?.kind === "keep") {
    if (resolution === null) {
      return (
        <p data-testid="legacy-prime-migration-guard-settled" style={stepParagraphStyle}>
          Reading this account&apos;s guard&hellip;
        </p>
      );
    }
    if (resolution.kind === "none") {
      return (
        <p data-testid="legacy-prime-migration-guard-settled" style={stepParagraphStyle}>
          No guard on record (unchanged).
        </p>
      );
    }
    if (resolution.kind === "unsupported") {
      return (
        <p data-testid="legacy-prime-migration-guard-settled" style={stepParagraphStyle}>
          A {resolution.guardKind} guard, which does not name a fixed list of keys (unchanged).
        </p>
      );
    }
    if (resolution.kind === "keyset-ref-unresolved") {
      return (
        <div data-testid="legacy-prime-migration-guard-settled">
          <p style={stepParagraphStyle}>
            <KeysetRefBadge /> <strong>{resolution.ref}</strong> (unchanged).
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
        <p data-testid="legacy-prime-migration-guard-settled" style={stepParagraphStyle}>
          This guard is in a shape this screen does not recognise (unchanged).
        </p>
      );
    }
    // Same `viaRef` computation `CurrentGuardBlock` uses for this exact
    // final branch (`resolution.kind` narrowed to `"keyset" | "keyset-
    // ref"` by the early returns above).
    const viaRef = resolution.kind === "keyset-ref" ? resolution.ref : resolution.viaRef ?? null;
    return (
      <div data-testid="legacy-prime-migration-guard-settled"
           style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <p style={stepParagraphStyle}>
          {viaRef ? (
            <>
              <KeysetRefBadge /> <strong>{viaRef}</strong> &mdash; names {resolution.keys.length} key(s)
              under {resolution.pred} (unchanged):
            </>
          ) : (
            `A keyset of ${resolution.keys.length} key(s) under ${resolution.pred} (unchanged):`
          )}
        </p>
        {resolution.keys.map((k) => <KeyLine key={k} label="" value={k} />)}
      </div>
    );
  }
  const summary = summarizeGuardChoice(choice, preview);
  if (!summary) {
    return (
      <p data-testid="legacy-prime-migration-guard-settled-none" style={stepParagraphStyle}>
        Choose an option below.
      </p>
    );
  }
  return (
    <div data-testid="legacy-prime-migration-guard-settled">
      <p style={stepParagraphStyle}>{summary.headline}</p>
      {summary.keys?.map((k) => <KeyLine key={k} label="" value={k} />)}
    </div>
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
  pureKeypairs,
  describeKeyset,
}: {
  resolution: GuardKeyResolution | null;
  preview: MasterKeyPreview;
  choice: LegacyPrimeMigrationGuardChoice | null;
  onChoose: (c: LegacyPrimeMigrationGuardChoice) => void;
  allSeeds: readonly IStoaChainSeed[];
  pureKeypairs: readonly IPureKeypair[];
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

      {/* owner (live testing, this session): "existing guard when
          selected still doesnt detect its a keyset ref... we should
          present current guard... and then the right rectangle would
          show the guard you settled on." The LEFT side is the SAME
          `CurrentGuardBlock` as before (already names the keyset-ref
          shape explicitly via `KeysetRefBadge`); the RIGHT side is new —
          a live summary of whatever `choice` currently is, via the same
          computation `ReviewStep` uses, so the consequence is visible
          immediately rather than only after reaching Review. */}
      <CurrentSettledRow
        current={<CurrentGuardBlock resolution={resolution} />}
        settled={<GuardSettledSummary choice={choice} preview={preview} resolution={resolution} />}
      />

      {isVariantA ? (
        <GuardVariantA preview={preview} choice={choice} onChoose={onChoose} allSeeds={allSeeds}
                       pureKeypairs={pureKeypairs} />
      ) : isVariantB ? (
        <GuardVariantB preview={preview} choice={choice} onChoose={onChoose} allSeeds={allSeeds}
                       pureKeypairs={pureKeypairs} describeKeyset={describeKeyset} />
      ) : (
        <>
          <div data-testid="legacy-prime-migration-guard-option-recommended"
               role="radio" aria-selected={isRec} style={radioOptionStyle(isRec)}
               onClick={() => onChoose({ kind: "recommended-single-key" })}>
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
               role="radio" aria-selected={isKeep} style={radioOptionStyle(isKeep)}
               onClick={() => onChoose({ kind: "keep" })}>
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
               role="radio" aria-selected={isCustom} style={radioOptionStyle(isCustom)}
               onClick={() => {
                 if (!isCustom) onChoose({ kind: "custom", keys: [], pred: "keys-all" });
               }}>
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
                pureKeypairs={pureKeypairs}
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
  pureKeypairs,
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
  pureKeypairs: readonly IPureKeypair[];
  preview: MasterKeyPreview;
  choice: LegacyPrimeMigrationKeysChoice | null;
  onChoose: (choice: LegacyPrimeMigrationKeysChoice) => void;
  paymentChoice: LegacyPrimeMigrationPaymentChoice | null;
  onChoosePayment: (c: LegacyPrimeMigrationPaymentChoice) => void;
}): React.ReactElement {
  // The account whose payment key this page is ABOUT — the Page-2 choice,
  // resolved the same way the parent resolves `chosenAccountForPreview`
  // and the same way this page already resolves `chosenOriginSeedTab`
  // below (`resolveChosenAccountOriginSeedTab`). `currentPaymentKeyOf`
  // reads that account's own registered key; reading it off `allSeeds`
  // positionally is the bug that function's own doc comment describes.
  const chosenAccount = resolveChosenAccount(accountChoice, currentPrimeAccount, allAccounts);
  const currentPaymentKey = currentPaymentKeyOf(chosenAccount);
  // Still a SEEDS question, and still correct as it stands: "which seed
  // and position hold this key" is answered by searching for the key
  // itself, so it now reports the seed that genuinely holds the account's
  // own payment key (the owner's non-prime koala seed) instead of
  // restating position 0 of `seeds[0]`.
  const paymentTies = currentPaymentKey ? findKeyTies(allSeeds, currentPaymentKey) : null;
  const currentPaymentKeyOrigin = detectPaymentKeyOrigin(currentPaymentKey, allSeeds, pureKeypairs);
  // "Advanced" (native-format) derivation is offered ONLY when the Page-2-
  // chosen account's own words are dictionary-gated ("12-words"/
  // "24-words") — never for "write-seed"-origin or freshly-typed words
  // (there is no native dictionary format for arbitrary words to fall back
  // to). See the module doc's "Page 3" section.
  const chosenOriginSeedTab = resolveChosenAccountOriginSeedTab(accountChoice, currentPrimeAccount, allAccounts);
  const canOfferAdvanced = chosenOriginSeedTab === "12-words" || chosenOriginSeedTab === "24-words";

  const isStoicDalosSelected = choice?.kind === "stoic-dalos";
  const isAdvancedSelected = choice?.kind === "advanced-native";

  // Owner (live testing, `wizard-page2-and-dashboard-fixes` round 7):
  // "when making the 2nd selection, which is to keep the existing
  // private key, the circled Dalos Derivation would have to change to
  // Koala Derivation, because that's what the seed is using that is
  // responsible for the key involved in the second selection."
  // `STOIC_DALOS_DERIVATION_LABEL` is honest while payment is actually
  // being DERIVED (it genuinely is the method in use) — but once
  // payment is explicitly KEPT as an existing, non-Stoic-Dalos key
  // (a real seed-backed origin — never shown for a foreign/pure-keypair
  // origin, which has no seed-type label to show), nothing is deriving
  // via Stoic Dalos for payment anymore, so this option's own label
  // reflects the kept key's REAL origin instead. The `RECOMMENDED`
  // badge goes with it — this is no longer a recommendation, it is a
  // statement of the kept key's own fact.
  const keptPaymentOrigin =
    paymentChoice?.kind === "keep" && currentPaymentKeyOrigin?.kind === "seed" ? currentPaymentKeyOrigin : null;
  const stoicDalosOptionLabel = keptPaymentOrigin
    ? `${paymentKeyOriginLabel(keptPaymentOrigin)} Derivation`
    : STOIC_DALOS_DERIVATION_LABEL;

  return (
    <div
      data-testid="legacy-prime-migration-keys"
      style={{ display: "flex", flexDirection: "column", gap: 14 }}
    >
      <PaymentKeySection
        currentKey={currentPaymentKey}
        ties={paymentTies}
        origin={currentPaymentKeyOrigin}
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
        onClick={() => onChoose({ kind: "stoic-dalos" })}
      >
        <button
          type="button"
          style={radioOptionHeaderButtonStyle}
          onClick={() => onChoose({ kind: "stoic-dalos" })}
        >
          <OptionNumberBadge n={1} />
          {stoicDalosOptionLabel}
          {keptPaymentOrigin ? null : <RecommendedBadge />}
        </button>
        <p style={stepParagraphStyle}>
          {keptPaymentOrigin ? (
            <>
              Your kept payment key is already {paymentKeyOriginLabel(keptPaymentOrigin)}-derived —
              not via {STOIC_DALOS_DERIVATION_LABEL}. Position 1 still derives the guard key this
              way unless you also keep the guard.
            </>
          ) : (
            <>
              Position 0 derives the payment key, position 1 derives the guard key — a
              keys-all guard over both. Always available, always the default.
            </>
          )}
        </p>
      </div>

      {canOfferAdvanced ? (
        <div
          data-testid="legacy-prime-migration-keys-option-advanced"
          role="radio"
          aria-selected={isAdvancedSelected}
          style={radioOptionStyle(isAdvancedSelected)}
          onClick={() => onChoose({ kind: "advanced-native" })}
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
  pureKeypairs,
  preview,
  guardResolution,
  guardChoice,
  onChooseGuard,
  describeKeyset,
}: {
  allSeeds: readonly IStoaChainSeed[];
  pureKeypairs: readonly IPureKeypair[];
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
        pureKeypairs={pureKeypairs}
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
  const newPayment = settledPaymentKeyOf(paymentChoice, preview, currentPaymentKey);
  // code review (owner, this session): now the SAME computation the
  // guard step's own new "Settled for" box uses — one definition, not
  // two copies of the identical ternary.
  const guardSummary = summarizeGuardChoice(guardChoice, preview);

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
        {guardSummary ? (
          <>
            <p style={stepParagraphStyle}>{guardSummary.headline}</p>
            {guardSummary.keys?.map((k) => <KeyLine key={k} label="" value={k} />)}
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
 * The Arweave step's own check state (`docs/work/wizard-arweave-step/
 * design.md`). `"checking"` is a real, visible state, not a flicker: the
 * check decrypts every Arweave seed the codex holds (a 600,000-iteration
 * PBKDF2 each) to compare bitstrings, so it takes real time and must never
 * be rendered as "missing" while it is still running — a premature "missing"
 * would invite the user to generate accounts they already have.
 */
type ArweaveCheckState =
  | { status: "checking" }
  | {
      status: "settled";
      result: CodexHoldsMasterArweaveAccountsResult;
      /** Set when the CODEX MASTER SEED's own bitstring could not be
       *  resolved at all (a locked codex, a password that decrypts nothing,
       *  no store) — i.e. the three rows read "missing" because nothing
       *  could be checked, not because the codex was checked and found
       *  wanting. Shown alongside the rows, because those two situations
       *  need different actions from the user and printing only "missing"
       *  for both is the kind of half-truth this topic exists to remove. */
      masterUnresolved: string | null;
      /** WHICH password failure left `masterUnresolved` set, when that is
       *  what left it set (`wizard-arweave-step` T2). Non-null is the step's
       *  cue to render {@link InlineUnlockPrompt} instead of leaving the
       *  owner on a screen whose only way out is closing the wizard — the
       *  dead end T1 reported. `null` for every other kind of unresolved
       *  master (no derivation method chosen, a "new words" account), which
       *  no password can fix and so must not be asked about. */
      masterPasswordProblem: FinalizePasswordProblem | null;
    };

/**
 * How the Arweave step's last Generate ended (`wizard-arweave-step` T2).
 * `"settled"` says only that `ensurePrimeArweaveSeed` RESOLVED — never that
 * it delivered, which is why it carries no verdict of its own: the verdict is
 * the re-evaluated predicate.
 */
type ArweaveGenerateOutcome =
  | { kind: "rejected"; message: string }
  | { kind: "settled" };

/** One check row's own resolved state.
 *
 *  `"unknown"` is NOT `"missing"`, and the difference is the whole point:
 *  a locked codex — or one holding a password that decrypts nothing — cannot
 *  be read at all, and printing "Missing" for that would invite the owner to
 *  re-derive two RSA-4096 keys the codex may well already hold. "Checking…"
 *  is in flight and will resolve on its own; "unknown" has resolved to
 *  "nobody can currently tell", which needs an action (the password) that
 *  the step now offers. */
type ArweaveRowState = "checking" | "satisfied" | "missing" | "unknown";

const ARWEAVE_ROW_WORD: Record<ArweaveRowState, string> = {
  checking: "Checking…",
  satisfied: "Satisfied",
  missing: "Missing",
  unknown: "Can't tell yet",
};

/**
 * The Arweave step's own two password questions (`wizard-arweave-step` T2).
 * Same two cases, same vocabulary, Finalize's own prompt uses
 * ({@link FINALIZE_LOCKED_PROMPT_TEXT}) — phrased for what this screen is
 * doing, which is checking rather than finishing.
 */
const ARWEAVE_STEP_LOCKED_PROMPT_TEXT =
  "Your codex is locked, so these accounts can't be checked — enter your password to check them.";
const ARWEAVE_STEP_WRONG_PASSWORD_PROMPT_TEXT =
  "The password this codex currently holds could not decrypt this account, so these accounts can't be checked. Re-enter it to check them.";

/**
 * Generate with no `ensurePrimeArweaveSeed` prop in sight. Stated on the
 * screen, not just as a `title`: the prop is optional (several hosts, and
 * every one of this file's own prop-only tests, mount the wizard without
 * it), so this is a reachable state rather than a defensive branch.
 */
const ARWEAVE_STEP_GENERATE_UNAVAILABLE_TEXT =
  "Generating is not available on this screen — this wizard has no connection to the Arweave derivation. Nothing is lost by closing it: every choice is saved, and the accounts can be added from the Codex ID page.";

/**
 * Generate on a codex whose HELD password is not the one that was just
 * proven here (`wizard-arweave-step` T2, a pre-existing hazard T1 reported).
 *
 * `ensurePrimeArweaveSeed` encrypts what it writes under the password the
 * CODEX holds — it calls `getPassword()` inside its own package
 * (`packages/codex-arweave`) and takes no password argument — while this
 * step's check reads with the password it actually proved. Running the
 * derivation across that gap would leave a real Arweave seed encrypted under
 * a password nothing else in this codex uses: unreadable afterwards, and
 * unable to ever satisfy this check. Blocking is the only honest option
 * available from here; re-caching the proven password instead is not, because
 * an already-unlocked codex's window is ABSOLUTE and must not be restarted
 * (`src/zbom/hooks/useEnsureCodexUnlocked.ts`).
 */
const ARWEAVE_STEP_GENERATE_PASSWORD_MISMATCH_TEXT =
  "This codex is still holding a different password than the one you just entered, and a new Arweave seed would be encrypted under the held one — unreadable afterwards. Lock this codex and unlock it again with the password you just used, then generate.";

/**
 * Why Continue out of the Arweave step is unavailable, NAMING what is
 * missing — `null` when the codex genuinely holds both accounts.
 *
 * Module-level (not inline in `continueBlockedReason`) so the exact same
 * sentence is available to anything else that has to explain this state, and
 * so the distinguishable cases stay side by side where they read as one
 * list: still checking, no matching seed at all, or a matching seed missing
 * #0 and/or #1.
 */
function arweaveStepBlockedReason(check: ArweaveCheckState): string | null {
  if (check.status === "checking") {
    // Same "hang tight" register the account step's own in-flight gate uses.
    return "Checking this codex's Arweave accounts — hang tight…";
  }
  // "COULD NOT BE CHECKED" IS ITS OWN ANSWER, and it comes first: the
  // predicate reports a codex it cannot read as `{ok:false, seedId:null}`,
  // which is indistinguishable, from here, from a codex that really holds no
  // matching seed. Saying "holds no Arweave seed" about a locked codex is a
  // half-truth that points the owner at the wrong action (generate) instead
  // of the right one (the password prompt on this very step).
  if (check.masterUnresolved !== null) {
    return check.masterPasswordProblem !== null
      ? "These checks can't run until this codex's password is entered — the prompt on this step is the way through."
      : `These checks could not be run: ${check.masterUnresolved}`;
  }
  const { ok, seedId, missingIndexes } = check.result;
  if (ok) return null;
  if (seedId === null) {
    return `This codex holds no Arweave seed matching its ${CODEX_MASTER_SEED} yet — generate it to continue.`;
  }
  const positions = missingIndexes.map((i) => `#${i}`).join(" and ");
  return `Arweave account${missingIndexes.length > 1 ? "s" : ""} ${positions} ${
    missingIndexes.length > 1 ? "are" : "is"
  } still missing under that seed — generate ${missingIndexes.length > 1 ? "them" : "it"} to continue.`;
}

/**
 * What the step says when a derivation FINISHED and the re-evaluated
 * predicate still comes back unsatisfied (`wizard-arweave-step` T2).
 *
 * This is a real, reachable outcome and not a defensive branch: a PARTIAL
 * delivery resolves — only a zero-key derivation rejects — so a call that
 * came back is no evidence at all about the end state. That inference ("the
 * call returned, therefore eligible") is the bug this whole topic exists to
 * close, and this sentence is what the honest alternative looks like.
 *
 * It names the positions, and says the derived ones are kept, because both
 * are true: a second attempt only pays for what is still absent. The
 * finalize panel's own version of this is
 * {@link ARWEAVE_MASTER_ACCOUNTS_NOT_HELD_TEXT}; this one is phrased for a
 * step where nothing has been committed yet.
 */
function arweaveStillMissingText(result: CodexHoldsMasterArweaveAccountsResult): string {
  const plural = result.missingIndexes.length > 1;
  const positions = result.missingIndexes.map((i) => `#${i}`).join(" and ");
  const tail =
    " Nothing already derived is lost — generating again picks up from what is still absent.";
  if (result.seedId === null) {
    return `That finished, but this codex still holds no Arweave seed matching its ${CODEX_MASTER_SEED}, so account${
      plural ? "s" : ""
    } ${positions} ${plural ? "are" : "is"} still missing.${tail}`;
  }
  return `That finished, but Arweave account${plural ? "s" : ""} ${positions} ${
    plural ? "are" : "is"
  } still missing under that seed.${tail}`;
}

/**
 * The Arweave derivation's progress bar — the SAME bar the owner already
 * knows from the Arweave tab.
 *
 * THE ORIGINAL IS `RunProgress` in
 * `packages/codex-arweave/src/panel/ArweaveSeedsArea.tsx` (the generate box's
 * display). This is a deliberate, traceable DUPLICATE of its presentation
 * decisions — the field vocabulary, the separator, the upper-cased stage, the
 * thousands-separated attempt counts, the `role="progressbar"` shape and the
 * `search`-present / `search`-absent split — because `codex-arweave` depends
 * on this package and importing it back would invert that dependency. Keep the
 * two in step: a change to `RunProgress`'s status line belongs here too.
 *
 * Every number rendered comes from the event. There is no timer, no
 * interpolation and no animated crawl: a derivation that has not yet reported
 * a search shows the delivered/total fallback (`RunProgress`'s own
 * `storedPercent`) rather than pretending to move.
 */
function ArweaveDerivationProgressBar({
  progress,
  testId,
}: {
  progress: ArweaveDerivationProgress;
  /** Base test id; the status line and the bar hang off it as `-search` and
   *  `-bar`, so both screens stay separately addressable. */
  testId: string;
}): React.ReactElement {
  const { index, delivered, total, search } = progress;
  // `RunProgress`'s `storedPercent`: what is really persisted, used on its own
  // whenever there is no live search to track.
  const deliveredPercent = total === 0 ? 0 : Math.round((delivered / total) * 100);
  const percent = search !== undefined ? search.percent : deliveredPercent;

  return (
    <div
      data-testid={testId}
      style={{ display: "flex", flexDirection: "column", gap: 6 }}
    >
      <p style={{ ...stepParagraphStyle, color: ACCENT }}>
        Deriving Arweave account #{index} &mdash; {delivered} of {total} done.
      </p>

      {search !== undefined ? (
        // `RunProgress`'s status line, field for field:
        // "Position N of T · prime P · X this search · Y total · Z%"
        <div data-testid={`${testId}-search`} style={{ fontSize: 12, color: ACCENT }}>
          {`Position ${search.position} of ${search.totalCount}` +
            ` · prime ${search.stage.toUpperCase()}` +
            ` · ${search.attempts.toLocaleString()} this search` +
            ` · ${search.grandAttempts.toLocaleString()} total` +
            ` · ${search.percent}%`}
        </div>
      ) : null}

      <div
        data-testid={`${testId}-bar`}
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
    </div>
  );
}

/**
 * Page 6 ("arweave") — the Arweave verification step, per
 * `docs/work/wizard-arweave-step/design.md`.
 *
 * States the owner's own three questions, in the owner's own order, each as
 * its own separately-visible row with its own verdict:
 *   1. is there an Arweave seed identical to the Codex Master Seed?
 *   2. does account #0 exist under it?
 *   3. does account #1 exist under it?
 *
 * All three come from ONE `codexHoldsMasterArweaveAccounts` evaluation (the
 * same predicate finalize and the violet ticker read), never from three
 * independent lookups that could disagree: the seed row is `seedId !== null`
 * and the key rows are `missingIndexes`.
 *
 * GENERATE IS WIRED (T2) to the SAME `ensurePrimeArweaveSeed` prop
 * `runFinalize` uses, asked for exactly the positions THIS evaluation found
 * missing, reporting that derivation's own per-key events — and, when it
 * settles, judged by a RE-EVALUATION of the predicate rather than by the
 * promise having resolved. A partial delivery resolves (only a zero-key run
 * rejects), so "the call came back" has never been evidence of anything; see
 * `handleArweaveGenerate`.
 *
 * Generation is MANUAL by design, never automatic on arrival: each RSA-4096
 * key costs seconds, and a multi-second derivation must not start behind the
 * owner's back on a screen they are trying to read.
 *
 * When the check could not be RUN at all for a password reason, this screen
 * asks for the password where the user stands ({@link InlineUnlockPrompt},
 * the same panel Finalize and the Account step use) instead of leaving the
 * dead end T1 reported: three unreadable rows, a blocked Continue, and
 * closing the wizard as the only way out.
 */
function ArweaveStep({
  check,
  progress,
  generating,
  generateError,
  generateUnavailableReason,
  onGenerate,
  onUnlock,
}: {
  check: ArweaveCheckState;
  /** The in-flight derivation's own latest event, or `null` when nothing is
   *  deriving. Driven ONLY by `ensurePrimeArweaveSeed`'s `onProgress` — no
   *  timer, no synthetic percentage — exactly as the finalize panel's own
   *  progress line is. */
  progress: ArweaveDerivationProgress | null;
  generating: boolean;
  /** What went wrong on the LAST Generate: either the derivation rejected, or
   *  it resolved and the re-evaluation still found accounts missing. */
  generateError: string | null;
  /** Why Generate cannot be pressed at all, or `null` when it can. Rendered
   *  as its own visible line, not merely a `title`: a disabled control that
   *  says nothing is indistinguishable from a broken one. */
  generateUnavailableReason: string | null;
  onGenerate: () => void;
  onUnlock: (password: string) => Promise<{ ok: boolean; error?: string }>;
}): React.ReactElement {
  const settled = check.status === "settled" ? check.result : null;
  const unresolved = check.status === "settled" ? check.masterUnresolved : null;
  const rowState = (satisfied: boolean): ArweaveRowState =>
    check.status === "checking"
      ? "checking"
      : unresolved !== null
        // Nothing could be read, so nothing is known — and "unknown" must
        // never be printed as "missing".
        ? "unknown"
        : satisfied ? "satisfied" : "missing";
  const seedRow = rowState(settled !== null && settled.seedId !== null);
  const keyRow = (index: number): ArweaveRowState =>
    rowState(
      settled !== null && settled.seedId !== null && !settled.missingIndexes.includes(index),
    );

  return (
    <div
      data-testid="legacy-prime-migration-arweave-step"
      style={{ display: "flex", flexDirection: "column", gap: 12 }}
    >
      <p style={{ ...stepParagraphStyle, fontSize: 13, color: "#d2d3d4" }}>
        Restoring this codex from its words alone needs Arweave accounts #0 and #1 derived
        from your {CODEX_MASTER_SEED}. This step checks whether they are really here &mdash;
        nothing else makes the codex eligible.
      </p>

      <ArweaveCheckRow
        testId="legacy-prime-migration-arweave-check-seed"
        label={`An Arweave seed identical to your ${CODEX_MASTER_SEED}`}
        state={seedRow}
      />
      <ArweaveCheckRow
        testId="legacy-prime-migration-arweave-check-key0"
        label="Arweave account #0 under that seed"
        state={keyRow(0)}
      />
      <ArweaveCheckRow
        testId="legacy-prime-migration-arweave-check-key1"
        label="Arweave account #1 under that seed"
        state={keyRow(1)}
      />

      {/* The one genuinely slow thing on this screen: each Arweave account is
          a full RSA-4096 derivation costing seconds, so the position in
          flight, the live prime search behind it and the count delivered so
          far are all named — the SAME bar the Arweave tab already shows
          ({@link ArweaveDerivationProgressBar}), which the finalize panel
          renders too. Driven ONLY by the derivation's
          `onProgress` events, so it cannot claim movement that is not
          happening, and rendered OUTSIDE the "unsatisfied" block below on
          purpose: a key landing mid-run re-arms the check, and an in-flight
          derivation must keep reporting itself across that re-check rather
          than blinking out of existence. */}
      {progress !== null ? (
        <ArweaveDerivationProgressBar
          progress={progress}
          testId="legacy-prime-migration-arweave-progress"
        />
      ) : null}

      {unresolved !== null ? (
        <p
          data-testid="legacy-prime-migration-arweave-master-unresolved"
          style={{ ...stepParagraphStyle, color: "#fca5a5" }}
        >
          These checks could not be run: {unresolved}
        </p>
      ) : null}

      {/* The way OUT of that state, rather than a description of it. Only for
          the password reasons: nothing typed here can fix "no derivation
          method chosen", so nothing is asked for in that case. */}
      {check.status === "settled" && check.masterPasswordProblem !== null ? (
        <InlineUnlockPrompt
          message={
            check.masterPasswordProblem === "locked"
              ? ARWEAVE_STEP_LOCKED_PROMPT_TEXT
              : ARWEAVE_STEP_WRONG_PASSWORD_PROMPT_TEXT
          }
          submitLabel="Unlock & Check"
          onUnlock={onUnlock}
        />
      ) : null}

      {settled !== null && settled.ok && unresolved === null ? (
        <p style={{ ...stepParagraphStyle, color: "#86efac" }}>
          Nothing to do &mdash; this codex already holds both accounts, and the existing
          ones are kept exactly as they are. Continue to finalize.
        </p>
      ) : null}

      {/* Rendered only when the check actually RAN and came back unsatisfied.
          A codex nothing could be read on gets the prompt above instead —
          offering to generate accounts that may already be there, on the
          strength of a check that never happened, is the opposite of what
          this screen exists for. */}
      {settled !== null && !settled.ok && unresolved === null ? (
        <>
          <button
            type="button"
            data-testid="legacy-prime-migration-arweave-generate"
            disabled={generating || generateUnavailableReason !== null}
            onClick={onGenerate}
            title={
              generating
                ? "Deriving — each account is a full RSA-4096 key, so this takes seconds."
                : generateUnavailableReason ?? undefined
            }
            style={{
              alignSelf: "flex-start", padding: "8px 16px", borderRadius: 8, border: "none",
              fontWeight: 700, fontSize: 13,
              backgroundColor: generating || generateUnavailableReason !== null ? "#1a1a1a" : ACCENT,
              color: generating || generateUnavailableReason !== null ? "#555" : "#0a0a0a",
              cursor: generating || generateUnavailableReason !== null ? "not-allowed" : "pointer",
            }}
          >
            {generating ? "Generating…" : "Generate what's missing"}
          </button>

          {generateUnavailableReason !== null ? (
            <p
              data-testid="legacy-prime-migration-arweave-generate-unavailable"
              style={{ ...stepParagraphStyle, color: "#fca5a5" }}
            >
              {generateUnavailableReason}
            </p>
          ) : null}

          {generateError !== null ? (
            <p
              data-testid="legacy-prime-migration-arweave-generate-error"
              style={{ ...stepParagraphStyle, color: "#fca5a5" }}
            >
              {generateError}
            </p>
          ) : null}

          <p style={{ ...stepParagraphStyle, color: "#8b8b96" }}>
            Any Arweave seed already in this codex is left exactly where it is &mdash; a
            matching one is added alongside it, never in place of it.
          </p>
        </>
      ) : null}
    </div>
  );
}

function ArweaveCheckRow({
  testId,
  label,
  state,
}: {
  testId: string;
  label: string;
  state: ArweaveRowState;
}): React.ReactElement {
  const color = state === "satisfied" ? "#86efac" : state === "missing" ? "#fca5a5" : "#8b8b96";
  return (
    <div
      data-testid={testId}
      data-state={state}
      style={{ ...reviewBoxStyle, flexDirection: "row", alignItems: "center", gap: 10 }}
    >
      <span aria-hidden style={{ color, fontWeight: 700, fontSize: 13 }}>
        {state === "satisfied" ? "✓" : state === "missing" ? "✗" : state === "unknown" ? "?" : "…"}
      </span>
      <p style={{ ...stepParagraphStyle, color: "#d2d3d4", flex: 1 }}>{label}</p>
      <span style={{ ...stepParagraphStyle, color, fontWeight: 700 }}>
        {ARWEAVE_ROW_WORD[state]}
      </span>
    </div>
  );
}

/**
 * The "Seed Dashboard" (`docs/work/wizard-seed-dashboard/design.md`) — one
 * rectangle per seed that backs at least one of: the chosen Ouronet
 * account (blue), the settled payment key (dark green), a settled guard
 * key (dark gold, with a count — a keyset can draw members from different
 * seeds), or the codex's Prime Arweave address (violet). The first three
 * come from `computeSeedDashboardRows` (pure public-key matching, see
 * `seedDashboard.ts`); the violet one is async (decrypt-and-compare) and
 * arrives later via `arweaveMatchSeedId` — `null` until resolved, so every
 * row simply starts with its violet ticker unlit and re-renders once a
 * real id lands (T3 of the plan wires that effect; this component only
 * renders whatever it's given).
 *
 * Tickers 1-3 render inside their own bordered sub-box — the owner's own
 * grouping: an account, its payment key, and its guard are one coherent
 * "Ouronet string". Ticker 4 renders outside that sub-box, same rectangle
 * — a distinct, Arweave-side concern.
 *
 * The expand chevron reveals WHICH key/position backs each lit ticker on
 * THIS seed — it never reveals the seed's plaintext words, matching this
 * file's own established "already securely stored, not re-displayed
 * here" convention (see the Payment step's own copy).
 */
function SeedDashboard({
  seeds,
  accountSeedId,
  paymentSeedId,
  paymentIsStoicDerived,
  guardSeedIds,
  guardIsStoicDerived,
  arweaveMatchSeedId,
  getPassword,
  viewSeedDisabled,
  chosenAccount,
  accountFallbackPaymentMatch,
  accountFallbackGuardCount,
  accountFallbackArweaveMatch,
  pureKeysPaymentMatch,
  pureKeysGuardCount,
  unattributedGuardCount,
}: {
  seeds: readonly IStoaChainSeed[];
  /** Already-resolved — see `SeedDashboardInput.accountSeedId`'s own doc
   *  comment in `seedDashboard.ts` for why this is an id, not a key. */
  accountSeedId: string | null;
  /** Already-resolved seed id — see `SeedDashboardInput.paymentSeedId`'s
   *  own doc comment in `seedDashboard.ts`. */
  paymentSeedId: string | null;
  paymentIsStoicDerived?: boolean;
  guardSeedIds: readonly (string | null)[] | null;
  guardIsStoicDerived?: boolean;
  arweaveMatchSeedId: string | null;
  /** Threaded down to each sub-row's "view seed" button
   *  (`SeedRevealModal`) — optional, prop-driven, matching this wizard's
   *  own established convention. */
  getPassword?: () => string;
  /** Owner (live testing, this round): "as long as the Ouronet Account
   *  isnt selected... the View Seed button is disabled... Only when the
   *  step 2 has popped... THEN the view seed button is lit." True while
   *  the account step's own candidate-probe is still scanning — see
   *  `AccountStep`'s `onProbeSettledChange`. Defaults to `false`
   *  (enabled) so every other step/caller is unaffected. */
  viewSeedDisabled?: boolean;
  /** Owner (live testing, round 3/4): "Selecting AncientHolder, and then
   *  clicking reveal seed, still doesn't show its Ouronet Seed." An
   *  account genuinely unmatched by any recorded `IStoaChainSeed`
   *  (common for the legacy/imported accounts this wizard exists to
   *  rescue) never gets a card via `computeSeedDashboardCards` — there
   *  is nothing to click that would ever reveal THAT account's own
   *  material. When `accountSeedId` is `null` and a real account IS
   *  chosen, an extra, always-present fallback card renders for it,
   *  revealing its own secret directly (`AccountSeedRevealModal`),
   *  independent of seed-entity matching entirely. */
  chosenAccount?: IOuroAccount | null;
  /** Owner (round 5): "with the default selection, this same Master
   *  Seed would be responsible for the generation of the payment
   *  key... thus also green ticker." The fallback card above has no
   *  `seedId` to compare against (`accountSeedId` is `null` precisely
   *  because it exists), so whether payment/guard ALSO derive from the
   *  SAME seed-less account is tracked directly by the caller instead. */
  accountFallbackPaymentMatch?: boolean;
  accountFallbackGuardCount?: number;
  /** Whether the codex holds Arweave accounts #0 and #1 under THAT seed-less
   *  account's own bitstring (`docs/work/wizard-arweave-step/design.md`).
   *  Separate from `arweaveMatchSeedId` for the same reason
   *  `accountFallbackPaymentMatch` is separate from `paymentSeedId`: the
   *  fallback card has no seed id, so id equality (`null === null`) would
   *  spuriously match every time. Before the ticker was rewired onto
   *  `codexHoldsMasterArweaveAccounts` this card's violet square was
   *  hardcoded dark, honestly so — the OLD predicate compared an Arweave
   *  seed's bitstring against CHAINWEB SEED ENTITIES, and this card exists
   *  precisely because there is none. The new predicate compares against the
   *  ACCOUNT's own bitstring, which this card does have, so a dark square
   *  here would now be a lie for exactly the legacy/imported codices this
   *  wizard exists to rescue. */
  accountFallbackArweaveMatch?: boolean;
  /** Drives the always-last "Pure Keys" card (`PureKeysCardView`,
   *  `docs/work/wizard-keyset-scale-and-sidebar/design.md`'s "G") — a bare
   *  pure keypair has no seed entity to attribute to at all, so (unlike
   *  every other role above) this is never resolved via
   *  `computeSeedDashboardCards`; the caller checks it directly against
   *  the codex's own `pureKeypairs` and passes the result straight
   *  through here. */
  pureKeysPaymentMatch?: boolean;
  pureKeysGuardCount?: number;
  /** Drives the catch-all "Keys Not In This Codex" card
   *  ({@link UnattributedKeysCardView}) — guard keys no other bucket could
   *  claim. Exists so the per-card counts always SUM to the real keyset
   *  size (owner: "If a keyset is made of 9 keys, the total numbers shown
   *  would have to add up to 9"), instead of a key this codex doesn't hold
   *  silently vanishing from the dashboard. */
  unattributedGuardCount?: number;
}): React.ReactElement | null {
  const cards = computeSeedDashboardCards(seeds, {
    accountSeedId, paymentSeedId, paymentIsStoicDerived, guardSeedIds, guardIsStoicDerived, arweaveMatchSeedId,
  });
  const showAccountFallback = accountSeedId === null && (chosenAccount ?? null) !== null;
  const showPureKeys = pureKeysPaymentMatch === true || (pureKeysGuardCount ?? 0) > 0;
  const showUnattributed = (unattributedGuardCount ?? 0) > 0;
  if (cards.length === 0 && !showAccountFallback && !showPureKeys && !showUnattributed) return null;
  const bySeedId = new Map(seeds.map((s) => [s.id, s] as const));
  return (
    <div
      data-testid="legacy-prime-migration-settling-dashboard"
      style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}
    >
      <p style={{ ...stepParagraphStyle, fontSize: 13, color: "#d2d3d4" }}>
        <strong>Settling Dashboard.</strong> What each seed in this codex is backing for your
        current selections.
      </p>
      {/* Owner (live testing, this round): "it seems the blue ticker isnt
          appearing anymore... or it did, but took a while. we should at
          least show some sort of progress that its being decrypted or
          something." Every ticker/button below already goes dark/disabled
          for this exact `viewSeedDisabled` window (the account step's own
          candidate probe, or an in-flight account-switch resolution) —
          this single status line is the only thing that was missing: it
          tells the user SOMETHING is happening, rather than leaving every
          card looking silently stuck. One line for the whole dashboard,
          not repeated per card — every card's disablement already shares
          this one cause. */}
      {viewSeedDisabled === true ? (
        <p
          data-testid="legacy-prime-migration-settling-dashboard-checking"
          style={{ ...stepParagraphStyle, fontSize: 12, color: "#8b8b96", fontStyle: "italic" }}
        >
          Checking which seed backs your current selections&hellip;
        </p>
      ) : null}
      {/* Owner (live testing, round 7, screenshot 2): "the Master Seed
          must always be shown on the first position... the Other Seeds
          that are responsible for the Selected Keys, must follow
          beneath it." The fallback card — when present — IS the
          chosen account's own identity (there is no real seed entity
          for it, but it plays the SAME "Master" role), so it renders
          BEFORE every seed-matched card, never after.
          `computeSeedDashboardCards` itself already sorts its OWN
          account-matching card first among `cards` for the case where
          a real seed DOES back the account — the two mechanisms are
          mutually exclusive (`showAccountFallback` is only true when
          `accountSeedId` is `null`, i.e. no card in `cards` can ever be
          the account's own match at the same time). */}
      {showAccountFallback && chosenAccount ? (
        <AccountFallbackCardView
          account={chosenAccount}
          getPassword={getPassword}
          viewSeedDisabled={viewSeedDisabled}
          paymentMatch={accountFallbackPaymentMatch}
          guardCount={accountFallbackGuardCount}
          arweaveMatch={accountFallbackArweaveMatch}
        />
      ) : null}
      {cards.map((card) => {
        const seed = bySeedId.get(card.seedId);
        if (!seed) return null;
        return (
          <SeedDashboardCardView
            key={card.seedId}
            card={card}
            seed={seed}
            getPassword={getPassword}
            viewSeedDisabled={viewSeedDisabled}
          />
        );
      })}
      {/* Always LAST — one entry, regardless of how many distinct pure
          keypairs are actually involved this run (`docs/work/wizard-
          keyset-scale-and-sidebar/design.md`'s "G"). */}
      {showPureKeys ? (
        <PureKeysCardView
          paymentMatch={pureKeysPaymentMatch === true}
          guardCount={pureKeysGuardCount ?? 0}
        />
      ) : null}
      {/* Truly last — the leftovers, so every card's counts SUM to the
          real keyset size (see `unattributedGuardCount`'s own doc). */}
      {showUnattributed ? (
        <UnattributedKeysCardView guardCount={unattributedGuardCount ?? 0} />
      ) : null}
    </div>
  );
}

/** The chosen account's own fallback card (see `SeedDashboard`'s
 *  `chosenAccount` doc) — this card exists precisely BECAUSE no seed
 *  entity matched, but the account can still back OTHER roles too, the
 *  exact same way a real seed card can (owner, round 5: "with the
 *  default selection, this same Master Seed would be responsible for
 *  the generation of the payment key... thus also green ticker"). Shows
 *  the SAME four-ticker layout every real card shows (owner: "each
 *  entry must keep they square tickers, and we light up only that which
 *  fits") — account/payment/guard inside the ticker group, Arweave
 *  outside it, ALWAYS present, lighting only the roles that actually
 *  apply. The Arweave one included: this card IS the Codex Master Seed
 *  for a seed-less account (see `accountFallbackArweaveMatch`), so its
 *  violet square answers the same one question every other violet
 *  square does. Its "View seed" button reveals the account's own secret
 *  directly via `AccountSeedRevealModal`, never a `IStoaChainSeed`. */
function AccountFallbackCardView({
  account, getPassword, viewSeedDisabled, paymentMatch, guardCount, arweaveMatch,
}: {
  account: IOuroAccount;
  getPassword?: () => string;
  viewSeedDisabled?: boolean;
  paymentMatch?: boolean;
  guardCount?: number;
  arweaveMatch?: boolean;
}): React.ReactElement {
  const [revealOpen, setRevealOpen] = useState(false);
  const testidBase = "legacy-prime-migration-settling-dashboard-account-fallback";
  const disabled = viewSeedDisabled === true;
  // Owner (live testing, round 8): "it should then Read Codex Master
  // Seed (Ancient Hodler), as in we use in parenthesis the Ouronet
  // Account that Settled The Codex Master Seed." This card has no real
  // `IStoaChainSeed` of its own, but it plays the SAME "Codex Master
  // Seed" role a real account-matching card does (round 5/8) — titled
  // the same way, with the chosen account's own name in parentheses so
  // it reads as THE codex's own master identity, not just another
  // account entry.
  const fallbackTitle = `${CODEX_MASTER_SEED} (${account.name ?? "This Ouronet Account"})`;
  return (
    <div data-testid={`${testidBase}-card`} style={{ ...reviewBoxStyle, gap: 8 }}>
      <span style={{ ...stepParagraphStyle, color: "#d2d3d4", fontWeight: 700 }}>
        {fallbackTitle}
      </span>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            data-testid={`${testidBase}-expand`}
            disabled={disabled}
            onClick={() => setRevealOpen(true)}
            style={{
              background: "transparent", border: "1px solid #262626", borderRadius: 4,
              color: "#8b8b96", cursor: disabled ? "not-allowed" : "pointer",
              padding: "2px 8px", fontSize: 11, flexShrink: 0,
              opacity: disabled ? 0.45 : 1,
            }}
          >
            View seed
          </button>
          <div
            data-testid={`${testidBase}-ticker-group`}
            style={{ display: "flex", gap: 4, padding: 4, borderRadius: 4, border: "1px solid #262626" }}
          >
            <SeedTicker
              testid={`${testidBase}-ticker-account`}
              lit={!disabled}
              color={SEED_TICKER_COLORS.account}
            />
            <SeedTicker
              testid={`${testidBase}-ticker-payment`}
              lit={paymentMatch === true && !disabled}
              color={SEED_TICKER_COLORS.payment}
            />
            <SeedTicker
              testid={`${testidBase}-ticker-guard`}
              lit={(guardCount ?? 0) > 0 && !disabled}
              color={SEED_TICKER_COLORS.guard}
              count={guardCount}
            />
          </div>
          {/* Gated on `!disabled` like its siblings: while the dashboard's
              own resolving window is open, nothing on this card claims to
              know anything yet. */}
          <SeedTicker
            testid={`${testidBase}-ticker-arweave`}
            lit={arweaveMatch === true && !disabled}
            color={SEED_TICKER_COLORS.arweave}
          />
          <span style={stepParagraphStyle}>
            {account.name ?? "This account"} ({STOIC_DALOS_DERIVATION_LABEL})
          </span>
        </div>
        <span style={{ ...stepParagraphStyle, fontSize: 11, color: "#666" }}>
          No matching Chainweb seed on record — this account&rsquo;s own words, directly.
        </span>
      </div>
      <AccountSeedRevealModal
        open={revealOpen}
        onClose={() => setRevealOpen(false)}
        account={account}
        getPassword={getPassword}
      />
    </div>
  );
}

/** The "Pure Keys" attribution card (`docs/work/wizard-keyset-scale-and-
 *  sidebar/design.md`'s "G — Pure keys join the picker and the
 *  dashboard") — ONE entry, regardless of how many distinct pure keypairs
 *  actually back payment/guard this run: unlike a seed, a bare pure
 *  keypair has no entity to individuate by, so (unlike
 *  `AccountFallbackCardView`'s per-account card) it never multiplies.
 *  Reuses the SAME four-ticker ticker-group layout every other card
 *  shows, but simpler: the account and Arweave tickers are PERMANENTLY
 *  dark (an Ouronet account is always Dalos/seed-derived, never a bare
 *  pure key, and there is no Arweave bitstring to decrypt-and-compare
 *  against one), and "View seed" is PERMANENTLY disabled — no click
 *  handler, no reveal modal at all, since there is no seed entity to
 *  ever reveal (not even probe-gated, unlike every other card's own
 *  button). */
function PureKeysCardView({
  paymentMatch,
  guardCount,
}: {
  paymentMatch: boolean;
  guardCount: number;
}): React.ReactElement {
  const testidBase = "legacy-prime-migration-settling-dashboard-pure-keys";
  return (
    <div data-testid={`${testidBase}-card`} style={{ ...reviewBoxStyle, gap: 8 }}>
      <span style={{ ...stepParagraphStyle, color: "#d2d3d4", fontWeight: 700 }}>
        Pure Keys
      </span>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            data-testid={`${testidBase}-view-seed`}
            disabled
            style={{
              background: "transparent", border: "1px solid #262626", borderRadius: 4,
              color: "#8b8b96", cursor: "not-allowed",
              padding: "2px 8px", fontSize: 11, flexShrink: 0,
              opacity: 0.45,
            }}
          >
            View seed
          </button>
          <div
            data-testid={`${testidBase}-ticker-group`}
            style={{ display: "flex", gap: 4, padding: 4, borderRadius: 4, border: "1px solid #262626" }}
          >
            <SeedTicker testid={`${testidBase}-ticker-account`} lit={false} color={SEED_TICKER_COLORS.account} />
            <SeedTicker testid={`${testidBase}-ticker-payment`} lit={paymentMatch} color={SEED_TICKER_COLORS.payment} />
            <SeedTicker
              testid={`${testidBase}-ticker-guard`}
              lit={guardCount > 0}
              color={SEED_TICKER_COLORS.guard}
              count={guardCount}
            />
          </div>
          <SeedTicker testid={`${testidBase}-ticker-arweave`} lit={false} color={SEED_TICKER_COLORS.arweave} />
          <span style={stepParagraphStyle}>Pure Keys</span>
        </div>
        <span style={{ ...stepParagraphStyle, fontSize: 11, color: "#666" }}>
          Bare keypairs held directly by this codex — no seed to reveal.
        </span>
      </div>
    </div>
  );
}

/** The catch-all attribution card — guard keys this codex cannot place in
 *  ANY other bucket (no seed holds them, no pure keypair matches them, and
 *  they are not the chosen account's own identity/payment key).
 *
 *  Owner (live testing, repeatedly): "If a keyset is made of 9 keys, the
 *  total numbers shown would have to add up to 9." Without this card, an
 *  unplaceable key silently disappeared from the dashboard and the per-card
 *  counts summed to LESS than the real keyset size — which is both wrong
 *  arithmetic and, worse, hides the single most security-relevant fact a
 *  guard can carry: that it authorises a key this codex does not hold. */
function UnattributedKeysCardView({
  guardCount,
}: {
  guardCount: number;
}): React.ReactElement {
  const testidBase = "legacy-prime-migration-settling-dashboard-unattributed";
  return (
    <div data-testid={`${testidBase}-card`} style={{ ...reviewBoxStyle, gap: 8 }}>
      <span style={{ ...stepParagraphStyle, color: "#d2d3d4", fontWeight: 700 }}>
        Keys Not In This Codex
      </span>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            data-testid={`${testidBase}-view-seed`}
            disabled
            style={{
              background: "transparent", border: "1px solid #262626", borderRadius: 4,
              color: "#8b8b96", cursor: "not-allowed",
              padding: "2px 8px", fontSize: 11, flexShrink: 0,
              opacity: 0.45,
            }}
          >
            View seed
          </button>
          <div
            data-testid={`${testidBase}-ticker-group`}
            style={{ display: "flex", gap: 4, padding: 4, borderRadius: 4, border: "1px solid #262626" }}
          >
            <SeedTicker testid={`${testidBase}-ticker-account`} lit={false} color={SEED_TICKER_COLORS.account} />
            <SeedTicker testid={`${testidBase}-ticker-payment`} lit={false} color={SEED_TICKER_COLORS.payment} />
            <SeedTicker
              testid={`${testidBase}-ticker-guard`}
              lit={guardCount > 0}
              color={SEED_TICKER_COLORS.guard}
              count={guardCount}
            />
          </div>
          <SeedTicker testid={`${testidBase}-ticker-arweave`} lit={false} color={SEED_TICKER_COLORS.arweave} />
          <span style={stepParagraphStyle}>Keys Not In This Codex</span>
        </div>
        <span style={{ ...stepParagraphStyle, fontSize: 11, color: "#666" }}>
          Named by this guard, but held by no seed, pure keypair, or account here — nothing to
          reveal, and nothing this codex could sign with.
        </span>
      </div>
    </div>
  );
}

const SEED_TICKER_COLORS = {
  account: "#3b82f6",
  payment: "#15803d",
  guard: "#92400e",
  arweave: "#7c3aed",
} as const;

function SeedTicker({
  testid, lit, color, count,
}: {
  testid: string; lit: boolean; color: string; count?: number;
}): React.ReactElement {
  return (
    <span
      data-testid={testid}
      data-lit={lit ? "true" : "false"}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        minWidth: 14, height: 14,
        padding: count !== undefined && count > 0 ? "0 4px" : 0,
        borderRadius: 3,
        backgroundColor: lit ? color : "transparent",
        border: `1px solid ${lit ? color : "#3a3a3a"}`,
        color: "#0a0a0a", fontSize: 10, fontWeight: 700,
      }}
    >
      {lit && count !== undefined && count > 0 ? count : ""}
    </span>
  );
}

/** One CARD — one seed's own "Seed Words" entry — containing one sub-row
 *  per distinct derivation label in play for it this run. */
function SeedDashboardCardView({
  card, seed, getPassword, viewSeedDisabled,
}: {
  card: SeedDashboardCard;
  seed: IStoaChainSeed;
  getPassword?: () => string;
  viewSeedDisabled?: boolean;
}): React.ReactElement {
  const cardTestidBase = `legacy-prime-migration-settling-dashboard-card-${card.seedId}`;
  return (
    <div data-testid={cardTestidBase} style={{ ...reviewBoxStyle, gap: 8 }}>
      <span style={{ ...stepParagraphStyle, color: "#d2d3d4", fontWeight: 700 }}>{card.seedName}</span>
      {card.subRows.map((subRow, index) => (
        <SeedDashboardSubRowView
          key={subRow.label}
          testidBase={`${cardTestidBase}-subrow-${index}`}
          card={card}
          subRow={subRow}
          seed={seed}
          getPassword={getPassword}
          viewSeedDisabled={viewSeedDisabled}
        />
      ))}
    </div>
  );
}

/** One sub-row within a card — one specific derivation label and its own
 *  ticker set. The button opens the REAL seed-reveal modal for this
 *  card's OWN seed (owner, this round: "a button that shows the seed in
 *  a new popup, similar to what the codex already has... we reuse what
 *  we already have") — never a separate Arweave-seed reveal, even for a
 *  sub-row whose violet ticker is the one that's lit: cards are keyed by
 *  the Chainweb seed's own identity, so this naturally shows real words
 *  whenever THIS seed has them on record. Enabled whenever the sub-row
 *  exists at all — a card is only ever rendered for a seed present in
 *  `allSeeds`, so there is nothing further to gate on. */
function SeedDashboardSubRowView({
  testidBase, card, subRow, seed, getPassword, viewSeedDisabled,
}: {
  testidBase: string;
  card: SeedDashboardCard;
  subRow: SeedDashboardSubRow;
  seed: IStoaChainSeed;
  getPassword?: () => string;
  viewSeedDisabled?: boolean;
}): React.ReactElement {
  const [revealOpen, setRevealOpen] = useState(false);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {/* Left to right (owner, this round): "Let's place the button on
            the left part, 4 checkers. Then the name of the seed." */}
        <button
          type="button"
          data-testid={`${testidBase}-expand`}
          disabled={viewSeedDisabled === true}
          onClick={() => setRevealOpen(true)}
          style={{
            background: "transparent", border: "1px solid #262626", borderRadius: 4,
            color: "#8b8b96", cursor: viewSeedDisabled === true ? "not-allowed" : "pointer",
            padding: "2px 8px", fontSize: 11, flexShrink: 0,
            opacity: viewSeedDisabled === true ? 0.45 : 1,
          }}
        >
          View seed
        </button>
        <div
          data-testid={`${testidBase}-ticker-group`}
          style={{ display: "flex", gap: 4, padding: 4, borderRadius: 4, border: "1px solid #262626" }}
        >
          {/* Owner (live testing, this round): "during loading when the
              View seed is disabled, the blue tick should also be
              disabled... because it becomes lit, when the first
              ouronet account is selected in step 2" — the account role
              can resolve (via the synchronous `currentPrimeSeed`
              shortcut) WHILE the account step's own candidate probe is
              still scanning. Only the TICKER's visual lit state is
              overridden here (never `subRow.accountMatch` itself,
              which still drives whether this card/sub-row exists at
              all and whether the "View seed" button renders) — forcing
              `accountMatch` to `false` upstream would make a card
              backed ONLY by the account role vanish mid-probe instead
              of staying visible with a disabled button, which is the
              behavior `ui-seed-dashboard.test.tsx`'s own probe-pass
              test already relies on. */}
          <SeedTicker
            testid={`${testidBase}-ticker-account`}
            lit={subRow.accountMatch && viewSeedDisabled !== true}
            color={SEED_TICKER_COLORS.account}
          />
          <SeedTicker testid={`${testidBase}-ticker-payment`} lit={subRow.paymentMatch} color={SEED_TICKER_COLORS.payment} />
          <SeedTicker
            testid={`${testidBase}-ticker-guard`}
            lit={subRow.guardCount > 0}
            color={SEED_TICKER_COLORS.guard}
            count={subRow.guardCount}
          />
        </div>
        <SeedTicker testid={`${testidBase}-ticker-arweave`} lit={subRow.arweaveMatch} color={SEED_TICKER_COLORS.arweave} />
        <span style={stepParagraphStyle}>{card.seedName} ({subRow.label})</span>
      </div>
      <SeedRevealModal
        open={revealOpen}
        onClose={() => setRevealOpen(false)}
        seed={seed}
        getPassword={getPassword}
      />
    </div>
  );
}

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
 *    Finalize is a real action, not Page 2/3's selection-only UI. Does
 *    NOT require `originSeedTab !== undefined` — that provenance tag is
 *    stamped only at account-SPAWN time, never derived from or verified
 *    against the actual stored secret, so its absence proves nothing;
 *    the REAL decrypt attempt right above this comment's own code is the
 *    only gate. An account whose decrypt genuinely fails still cannot be
 *    finalized — that failure surfaces as a plain error, not a
 *    pre-emptive "no known words" refusal.
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
/**
 * Which of the TWO password failures Finalize can hit
 * (`docs/work/wizard-unlock-lifecycle/design.md`). Same two names, and the
 * same meanings, the Account step's own `probeNeedsPassword` already uses —
 * deliberately, so the wizard speaks about this one problem in one vocabulary:
 *
 *   "locked" — `getPassword()` threw (no cache / the absolute TTL expired
 *              mid-wizard, which for a flow this long is the normal case).
 *   "wrong"  — `getPassword()` SUCCEEDED, but what it returned does not
 *              decrypt this account. `authenticate()` caches whatever it is
 *              handed and never validates it, so a stale/typo'd password sits
 *              in the cache looking perfectly healthy.
 *
 * Neither is terminal: both ask for the password where the user stands, via
 * {@link InlineUnlockPrompt}, and re-run the attempt.
 */
type FinalizePasswordProblem = "locked" | "wrong";

type FinalizeDerivationResult =
  | { ok: true; accountId: string; bitString: string; words: readonly string[]; method: "stoic-dalos" | "advanced-native" }
  /** `passwordProblem` set ⇒ recoverable by re-entering the password, so the
   *  finalize panel prompts instead of rendering `error` as a red dead end.
   *  `error` is still carried for both: it is the honest fallback text if a
   *  caller cannot prompt (e.g. no store to authenticate against). */
  | { ok: false; error: string; passwordProblem?: FinalizePasswordProblem };

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
  // owner (live testing, this session): a real "AncientHodler" account with
  // a genuinely working, chain-verified seed (confirmed via the Codex ID
  // page's own "View Seed" + chain-match indicators) still failed here with
  // "no known recovery words on record". Root cause: `originSeedTab` is a
  // provenance tag stamped only at account-SPAWN time (`SpawnAccountModal`'s
  // own write path) — it is never derived from, or verified against, the
  // actual stored secret, and this file's OWN Page-2 probe comments already
  // document it as unreliable both ways ("accounts they know are ungated
  // stamped as gated (or not stamped at all)"). A hard gate on
  // `=== undefined` before ever attempting the real decrypt treated a
  // missing PROVENANCE tag as proof of "no recoverable words", which is
  // exactly backwards for the legacy accounts this wizard exists to rescue.
  // The real decrypt attempt immediately below is the actual test — this
  // never needed a second, less-informed one in front of it.
  //
  // The two password failures are classified SEPARATELY (wizard-unlock-
  // lifecycle, T2), by splitting what used to be a single
  // `smartDecrypt(secret, getPassword())` expression in one try block. That
  // single block is exactly what made Finalize a dead end: a locked codex and
  // a cached-but-wrong password both arrived here as one red line
  // ("Could not decrypt this account's words: AES-GCM auth-tag failure" —
  // what the owner actually saw), with no way forward from where they stood.
  // Which failure it is decides which question the user is asked, so the
  // `getPassword()` call gets its own try.
  let password: string;
  try {
    password = getPassword();
  } catch (e) {
    return {
      ok: false,
      passwordProblem: "locked",
      error: e instanceof Error ? e.message : "This codex is locked.",
    };
  }
  let wordsPlain: string;
  try {
    wordsPlain = await smartDecrypt(targetAccount.secret, password);
  } catch (e) {
    return {
      ok: false,
      passwordProblem: "wrong",
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

/**
 * THE ONE PLACE the Arweave-accounts predicate's input is assembled. Both
 * callers in this file — the Arweave STEP's own check
 * (`docs/work/wizard-arweave-step/design.md`) and `runFinalize`'s
 * before/after evaluation — go through here, deliberately: a second copy of
 * this input is precisely how the violet ticker and the finalize gate ended
 * up asking different questions about the same fact (that topic's design.md
 * §"The violet ticker and the eligibility gate ask different questions").
 * The step and the commit must agree by construction, not by two
 * independently-maintained expressions happening to match.
 *
 * `readCodexState` is a FUNCTION, not a snapshot: both callers need the
 * codex's CURRENT `arweaveSeeds`/`foreignKeys`, read at evaluation time —
 * `runFinalize` to observe writes `ensurePrimeArweaveSeed` made during its
 * own run, and the step to observe writes its Generate button just made. A
 * captured render-closure array cannot see either.
 *
 * The password degradation is the same everywhere it appears in this file:
 * `getPassword()` throwing means "locked", which reaches the predicate as a
 * `null` password — reported as "not proven", never as a free pass.
 * `fallbackPassword` is the one the caller may already hold in hand (the
 * finalize prompt's freshly-typed, already-proven password) for the case
 * where the unlock window closed mid-run.
 */
function evaluateMasterArweaveAccounts(args: {
  masterBitString: string | null;
  readCodexState: () => Pick<CodexHoldsMasterArweaveAccountsInput, "arweaveSeeds" | "foreignKeys"> | null;
  getPassword?: () => string;
  fallbackPassword?: string | null;
}): Promise<CodexHoldsMasterArweaveAccountsResult> {
  const state = args.readCodexState();
  const fallback = args.fallbackPassword ?? null;
  let password: string | null;
  try {
    password = args.getPassword ? args.getPassword() : fallback;
  } catch {
    password = fallback;
  }
  return codexHoldsMasterArweaveAccounts({
    masterBitString: args.masterBitString,
    arweaveSeeds: state?.arweaveSeeds ?? [],
    foreignKeys: state?.foreignKeys ?? [],
    password,
    smartDecrypt,
  });
}

/**
 * THE ONE PIPELINE behind "does this codex hold Arweave accounts #0 and #1
 * under the Codex Master Seed" — resolve the CHOSEN ACCOUNT's bitstring
 * ({@link resolveFinalizeDerivation}, the only thing in this file that knows
 * what the master bitstring IS), then ask
 * {@link evaluateMasterArweaveAccounts}. All three consumers go through here:
 * the Settling Dashboard's violet ticker, the Arweave STEP's own check, and
 * `runFinalize`'s before/after evaluation.
 *
 * That is the entire point (`docs/work/wizard-arweave-step/design.md` §"One
 * predicate, actually"). The ticker used to ask a DIFFERENT question —
 * `resolveArweaveMatchSeedId`, "does any Arweave seed's bitstring match some
 * CHAINWEB seed's?", which never looked at accounts #0/#1 at all — so an
 * Arweave seed row with zero Arweave accounts lit the square while finalize
 * (correctly) refused, and the owner reported the contradiction twice. Two
 * expressions of one fact is how that happened; this is the structural answer
 * rather than a third expression kept in sync by hand.
 *
 * The `derivation` is returned alongside the verdict because the STEP needs
 * it for more than the bitstring: it reports WHY the master could not be
 * resolved (locked codex vs. wrong password vs. no account chosen), and
 * Generate derives from this exact resolution rather than taking a second one
 * of its own. The ticker ignores it — a master it cannot resolve is simply a
 * square it cannot light.
 *
 * Never throws: `getPassword` being absent is passed on as a thrower that
 * {@link resolveFinalizeDerivation} catches into `passwordProblem: "locked"`,
 * {@link evaluateMasterArweaveAccounts} swallows its own `getPassword()`
 * failure into a `null` password, and the predicate reports a null password as
 * "nothing proven". A locked codex therefore degrades to an unlit square and
 * an honest "could not be checked", never to a crash or a prompt.
 */
async function resolveMasterArweaveHeld(args: {
  accountChoice: LegacyPrimeMigrationAccountChoice | null;
  keysChoice: LegacyPrimeMigrationKeysChoice | null;
  currentPrimeAccount: IOuroAccount | null;
  allAccounts: readonly IOuroAccount[];
  getPassword?: () => string;
  readCodexState: () => Pick<CodexHoldsMasterArweaveAccountsInput, "arweaveSeeds" | "foreignKeys"> | null;
}): Promise<{
  derivation: FinalizeDerivationResult;
  result: CodexHoldsMasterArweaveAccountsResult;
}> {
  const derivation = await resolveFinalizeDerivation({
    accountChoice: args.accountChoice,
    keysChoice: args.keysChoice,
    currentPrimeAccount: args.currentPrimeAccount,
    allAccounts: args.allAccounts,
    // The `getPassword()`-in-a-try idiom this file uses everywhere else: no
    // store means no password, which resolves to "locked" INSIDE
    // `resolveFinalizeDerivation` rather than throwing out of an effect.
    getPassword:
      args.getPassword
      ?? (() => { throw new Error("this wizard has no connection to the codex"); }),
  });
  const result = await evaluateMasterArweaveAccounts({
    masterBitString: derivation.ok ? derivation.bitString : null,
    readCodexState: args.readCodexState,
    getPassword: args.getPassword,
  });
  return { derivation, result };
}

/** Page 7's own internal status machine — starts `"awaiting-settle"` (idle,
 *  nothing attempted), goes `"running"` while
 *  {@link resolveFinalizeDerivation}/`ensurePrimeSeedAccountPairingAndPromote`/
 *  `ensurePrimeArweaveSeed`/`recordMigrationPending` are in flight, and
 *  settles into exactly one of the other four terminal states. */
/**
 * `"committed-pending-transactions"` replaces the old `"sweep-needed"` dead
 * end. The difference is real, not cosmetic: the old state meant "nothing
 * was written and nothing will be", while this one means "every local
 * decision IS written; only the money has still to move". Stage 3 resumes
 * from exactly that state.
 */
type FinalizeStatus =
  /**
   * THE IDLE STATE, and the INITIAL one (`migration-pending-apply` T4).
   *
   * Nothing has been attempted and nothing has been written: the step is
   * showing the {@link SETTLE_CHOICES_LABEL} button and waiting for the user
   * to press it. This status existing at all is the fix — `finalizeStatus`
   * used to initialise to `"running"`, so the panel structurally assumed the
   * commit was already in flight by the time it mounted, which is exactly
   * what it meant for the commit to be a side effect of the step transition.
   *
   * Owner: *"the wizard has to end with a finalize button 'Settle Choices'…
   * clicking it is the final action that settles the selected choices."*
   *
   * It is the ONLY status from which {@link handleBack} will leave finalize —
   * see that function's `"finalize"` branch.
   */
  | "awaiting-settle"
  | "running"
  /** A recoverable PASSWORD problem, not a failure (wizard-unlock-lifecycle,
   *  T2): the panel shows {@link InlineUnlockPrompt} and the run resumes from
   *  here once a working password is entered. Deliberately NOT `"error"` — it
   *  is reached by the same codex that would have finalized fine a minute
   *  earlier, and nothing has been abandoned. Not `"running"` either: the only
   *  thing in flight is the user's typing, and the shared "Close" button below
   *  must be available as the way out (closing leaves every staged selection
   *  recorded, so reopening resumes exactly here). */
  | "needs-password"
  /** Eligible — stage 2 is complete and the codex really can be restored
   *  from its words — but the key changes the user CHOSE are not on chain
   *  yet (stage 3A). Distinct from `"success"` so the screen can say so
   *  rather than implying a rotation that has not happened. */
  | "eligible-rotation-outstanding"
  | "arweave-unavailable"
  | "error"
  | "success";

/** The two questions Finalize can ask (wizard-unlock-lifecycle, T2). Phrased
 *  as "to finish", not "to unlock": the user is mid-action, and what they want
 *  to know is that typing this completes the thing they already started. */
const FINALIZE_LOCKED_PROMPT_TEXT =
  "Your codex is locked — enter your password to finish.";
const FINALIZE_WRONG_PASSWORD_PROMPT_TEXT =
  "The password this codex currently holds could not decrypt this account. Re-enter it to finish.";

/** The owner's own words for the wizard's last action, used verbatim. */
const SETTLE_CHOICES_LABEL = "Settle Choices";

/** What the idle finalize screen says ABOVE the button, so the user knows
 *  what pressing it costs. Deliberately plain about irreversibility: this is
 *  the click that promotes an account and makes keys non-removable. */
const SETTLE_CHOICES_INTRO_TEXT =
  "Nothing has been written yet. Pressing " + SETTLE_CHOICES_LABEL +
  " settles every choice you made: it pairs your " + OURONET_CODEX_MASTER + " with its " +
  "Master Chainweb Seed, records the Codex Master Seed row, makes the keys your master " +
  "depends on non-removable, and writes the plan the Apply button will seal.";

/** What the idle screen says when the codex is LOCKED — the one case where
 *  the squares are dark for a reason pressing the button actually FIXES.
 *  See {@link LegacyPrimeMigrationWizard}'s `settleBlockedReason` for why
 *  this is a notice rather than a block. */
const SETTLE_LOCKED_NOTICE_TEXT =
  "Your codex is locked, so this screen cannot read your account's keys — that is why some of "
  + "the squares are dark. Press " + SETTLE_CHOICES_LABEL
  + " anyway: it will ask for your password here, and then settle your choices.";

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

/** Page 7 ("finalize") — renders exactly one of the states
 *  {@link FinalizeStatus} can be in, starting at the IDLE
 *  `"awaiting-settle"` one, which offers {@link SETTLE_CHOICES_LABEL} and
 *  has written nothing.
 *
 *  A single shared "Close" button renders in every state but `"running"`.
 *  That used to mean "every TERMINAL state" and now ALSO covers the idle one
 *  — deliberately, not by oversight: closing from idle has written nothing,
 *  every staged selection is already recorded, and reopening the wizard
 *  resumes exactly here, so it is the same honest "nothing is lost by
 *  closing this" the `"needs-password"` state already promises. The only
 *  state with no way out remains the one where writes are genuinely in
 *  flight. */
function FinalizeStep({
  status,
  errorMessage,
  onClose,
  committed,
  needsPassword,
  onUnlock,
  arweaveProgress,
  settleBlockedReason,
  settleLockedNotice,
  onSettle,
  onBack,
}: {
  status: FinalizeStatus;
  errorMessage: string | null;
  onClose: () => void;
  /** Why {@link SETTLE_CHOICES_LABEL} cannot be pressed, or `null` when it
   *  can — the wizard's own `settleBlockedReason()`, already evaluated. Shown
   *  as a visible line AND as the button's `title`: a disabled control that
   *  says nothing is indistinguishable from a broken one. */
  settleBlockedReason: string | null;
  /** {@link SETTLE_LOCKED_NOTICE_TEXT} when the codex is locked, else
   *  `null`. Separate from `settleBlockedReason` because a locked codex does
   *  NOT block settling — pressing the button is what brings up the password
   *  prompt — but the user still has to be told why the squares are dark. */
  settleLockedNotice: string | null;
  /** The commit. The ONE action that starts stage 2. */
  onSettle: () => void;
  /** Back to the Arweave step. Offered ONLY in the idle state, where nothing
   *  has been written — it is the way out of a colour that can never light
   *  (a guard resolving to `"none"`, a payment key this codex cannot
   *  attribute), which would otherwise strand the user here. */
  onBack: () => void;
  /** The in-flight Arweave derivation's own latest event, or `null` when no
   *  derivation is running (`arweave-master-accounts` T3). Driven ONLY by
   *  `ensurePrimeArweaveSeed`'s `onProgress` callback — never a timer — so the
   *  line cannot claim progress that is not really happening. */
  arweaveProgress?: ArweaveDerivationProgress | null;
  /** What stage 2 actually wrote, so the result screen reports facts rather
   *  than a generic "done". */
  committed?: MigrationCommitRecord;
  /** Which password question to ask while `status === "needs-password"`. */
  needsPassword?: FinalizePasswordProblem | null;
  /** Re-attempt the finalize with the typed password. Resolves the
   *  `{ok, error}` shape {@link InlineUnlockPrompt} expects. */
  onUnlock?: (password: string) => Promise<{ ok: boolean; error?: string }>;
}): React.ReactElement {
  return (
    <div
      data-testid="legacy-prime-migration-finalize"
      style={{ display: "flex", flexDirection: "column", gap: 14 }}
    >
      {/* THE IDLE STATE (`migration-pending-apply` T4) — the wizard's last
          screen before anything is written. The button lives HERE, in the
          step body, rather than in `navRow()`: that row is two icon-only
          chevrons in the modal's title bar, with no precedent for a
          text-labelled action, and `headerExtra` is `undefined` on finalize
          by design (the "no Back/Continue on finalize" contract). */}
      {status === "awaiting-settle" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <p style={stepParagraphStyle}>{SETTLE_CHOICES_INTRO_TEXT}</p>
          {settleLockedNotice !== null ? (
            <p
              data-testid="legacy-prime-migration-settle-locked"
              style={{ ...stepParagraphStyle, color: "#ceac5f", margin: 0 }}
            >
              {settleLockedNotice}
            </p>
          ) : null}
          {settleBlockedReason !== null ? (
            <p
              data-testid="legacy-prime-migration-settle-blocked"
              style={{ ...stepParagraphStyle, color: "#8b8b96", margin: 0 }}
            >
              {settleBlockedReason}
            </p>
          ) : null}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              type="button"
              data-testid="legacy-prime-migration-settle-choices"
              onClick={onSettle}
              disabled={settleBlockedReason !== null}
              title={settleBlockedReason ?? undefined}
              style={{
                padding: "10px 20px",
                borderRadius: 8,
                border: "none",
                fontWeight: 700,
                fontSize: 13,
                backgroundColor: settleBlockedReason === null ? ACCENT : "#1a1a1a",
                color: settleBlockedReason === null ? "#0a0a0a" : "#555",
                cursor: settleBlockedReason === null ? "pointer" : "not-allowed",
              }}
            >
              {SETTLE_CHOICES_LABEL}
            </button>
            {/* The escape hatch. See `onBack`'s own doc comment and
                `handleBack`'s `"finalize"` branch for why this exists only
                while the status is idle. */}
            <button
              type="button"
              data-testid="legacy-prime-migration-settle-back"
              onClick={onBack}
              style={{
                padding: "10px 16px", borderRadius: 8,
                border: "1px solid #262626", backgroundColor: "transparent",
                color: "#8b8b96", fontSize: 12, cursor: "pointer",
              }}
            >
              Back — change a choice
            </button>
          </div>
        </div>
      ) : null}

      {status === "running" ? (
        <p data-testid="legacy-prime-migration-finalize-running" style={stepParagraphStyle}>
          Finalizing your Prime trio…
        </p>
      ) : null}

      {/* The one genuinely slow step: each Arweave key is a full RSA-4096
          derivation costing seconds, so the panel shows the SAME bar the
          Arweave step and the Arweave tab show
          ({@link ArweaveDerivationProgressBar}) — position in flight, live
          prime search, count delivered. Rendered only while a derivation is
          actually reporting events, and it disappears the moment that
          derivation settles. */}
      {arweaveProgress ? (
        <ArweaveDerivationProgressBar
          progress={arweaveProgress}
          testId="legacy-prime-migration-finalize-arweave-progress"
        />
      ) : null}

      {/* wizard-unlock-lifecycle (T2): the recoverable password states. The
          prompt replaces the red terminal box these two used to render — the
          staged selections stay exactly as they are, and submitting resumes
          the SAME finalize attempt rather than restarting the wizard. */}
      {status === "needs-password" && needsPassword && onUnlock ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <InlineUnlockPrompt
            message={
              needsPassword === "locked"
                ? FINALIZE_LOCKED_PROMPT_TEXT
                : FINALIZE_WRONG_PASSWORD_PROMPT_TEXT
            }
            submitLabel="Unlock & Finish"
            onUnlock={onUnlock}
          />
          <p style={{ ...stepParagraphStyle, color: "#8b8b96" }}>
            Nothing is lost by closing this: every choice you made is saved, and
            reopening picks up exactly here.
          </p>
        </div>
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
  // Not defaulted to `[]` directly here (unlike `allSeeds`/`allAccounts`)
  // — `undefined` must stay distinguishable from an explicitly-passed `[]`
  // so the merge with this component's own store-sourced fallback (below,
  // next to `pureKeypairs`'s other store reads) can tell "caller omitted
  // this prop entirely" from "caller passed zero pure keypairs on
  // purpose". See `LegacyPrimeMigrationWizardProps.pureKeypairs`'s own doc
  // comment.
  pureKeypairs: pureKeypairsProp,
  onStateChange,
  ensurePrimeArweaveSeed,
  describeKeyset,
  probeDecrypt,
  probeWatchdogMs,
}: LegacyPrimeMigrationWizardProps): React.ReactElement | null {
  const [step, setStep] = useState<LegacyPrimeMigrationWizardStep>("intro");
  // Owner (live testing, this round): the Settling Dashboard's "View
  // seed" button must stay disabled while the account step's own
  // candidate-probe is still scanning — `AccountStep` reports its own
  // settle state up via `onProbeSettledChange` below. Defaults to
  // `false` (disabled) so a fresh mount of the account step never shows
  // a prematurely-enabled button before the probe effect has even had a
  // chance to run once.
  const [accountProbeSettled, setAccountProbeSettled] = useState(false);
  // Page 2's own resolved choice — Page 3 (T5, same file) reads this
  // directly to build its key choices. Selection UI only: no account
  // activation or other side effect happens from setting this.
  //
  // Owner (`wizard-seed-dashboard-refinements`, this round): "In the very
  // beginning... by default the codex prime account is selected (there is
  // no state of no account selected)." Defaults to `{kind:"keep-current"}`
  // — matching `paymentChoice`/`guardChoice`/`keysChoice` below, which
  // already default to their own recommended choice rather than starting
  // unchosen. This is a LOCAL preview-state default only; it does NOT
  // call `recordSelectionIfComplete` or write anything to the store on
  // its own — the "writes nothing merely by arriving" invariant
  // (`ui-wizard-stage-boundaries.test.tsx`) governs RECORDING, which still
  // only ever happens from an explicit `onChoose` handler, never from
  // this initial value.
  const [accountChoice, setAccountChoice] = useState<LegacyPrimeMigrationAccountChoice | null>(
    { kind: "keep-current" },
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
  // IDLE on arrival (`migration-pending-apply` T4). This used to be
  // `"running"`, which is what made the commit a side effect of a step
  // transition: the panel could not render any other way, so `handleContinue`
  // had to fire `runFinalize()` the moment it set the step.
  const [finalizeStatus, setFinalizeStatus] = useState<FinalizeStatus>("awaiting-settle");
  const [finalizeError, setFinalizeError] = useState<string | null>(null);
  /** Which password question Finalize is asking, or `null` when it is not
   *  asking one (wizard-unlock-lifecycle, T2). Mirrors the Account step's own
   *  `probeNeedsPassword`, same two values, same meanings — see
   *  {@link FinalizePasswordProblem}. */
  const [finalizeNeedsPassword, setFinalizeNeedsPassword] =
    useState<FinalizePasswordProblem | null>(null);
  /** The in-flight Arweave derivation's latest reported event, or `null` when
   *  none is running (`arweave-master-accounts` T3). Set ONLY from
   *  `ensurePrimeArweaveSeed`'s own `onProgress` callback and cleared the
   *  moment that call settles — there is no timer behind it, so the panel can
   *  never show movement the derivation is not actually making. */
  const [finalizeArweaveProgress, setFinalizeArweaveProgress] =
    useState<ArweaveDerivationProgress | null>(null);
  /** The Arweave STEP's own check (`docs/work/wizard-arweave-step/
   *  design.md`) — what its three rows render and what gates Continue out
   *  of it. Starts `"checking"`: "not yet known" must never render as
   *  "missing". */
  const [arweaveCheck, setArweaveCheck] = useState<ArweaveCheckState>({ status: "checking" });
  /** The Arweave STEP's own derivation, in flight (`wizard-arweave-step` T2).
   *  Same three pieces of state the finalize panel keeps for the same work,
   *  kept separately because the two screens can be in different places: the
   *  step's progress line is driven ONLY by `ensurePrimeArweaveSeed`'s
   *  `onProgress`, and cleared the moment that call settles either way. */
  const [arweaveStepProgress, setArweaveStepProgress] =
    useState<ArweaveDerivationProgress | null>(null);
  const [arweaveGenerating, setArweaveGenerating] = useState(false);
  /** How the last Generate ENDED, or `null` when none has run since the
   *  codex last satisfied the check. Deliberately not a sentence: the
   *  sentence is derived from the current verdict
   *  ({@link arweaveGenerateErrorText}) so this line and the three rows
   *  cannot drift apart. `"settled"` means the derivation resolved — which is
   *  not the same as having delivered anything. */
  const [arweaveGenerateOutcome, setArweaveGenerateOutcome] =
    useState<ArweaveGenerateOutcome | null>(null);
  /** A password the user typed into the Arweave step's own unlock prompt that
   *  then PROVED itself by decrypting the chosen account's words
   *  (`wizard-arweave-step` T2).
   *
   *  It takes precedence over the codex's cached password for this step's
   *  check, deliberately: the "wrong held password" case is exactly a codex
   *  that is unlocked and whose cached password is useless here, so re-reading
   *  the cache would fail the same way forever on a password the user has
   *  already corrected. Held in state (not a ref) because the check effect
   *  below must RE-RUN the moment one is proven.
   *
   *  Not written into the codex's cache: `authenticate()` may only be called
   *  on a genuinely LOCKED codex, or it silently restarts an absolute window
   *  (`src/zbom/hooks/useEnsureCodexUnlocked.ts`). That is decided in
   *  `handleArweaveStepUnlock`, once, under a `wasUnlocked` snapshot. */
  const [arweaveProvenPassword, setArweaveProvenPassword] = useState<string | null>(null);
  /** The master derivation the Arweave step's CURRENT verdict was computed
   *  from — what Generate hands to `ensurePrimeArweaveSeed`. A ref, not
   *  state: it carries the account's plaintext words, which have no business
   *  being passed down into a presentational component's props, and nothing
   *  renders from it. Written by the check effect below (under its own
   *  request token), so Generate and the three rows can only ever be talking
   *  about the same account. */
  const arweaveDerivationRef = useRef<{ bitString: string; words: readonly string[] } | null>(null);

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
  // owner (live testing, this session): needed to tell a KEPT payment key
  // that's a standalone "PureKey" apart from one genuinely not in this
  // codex at all (`detectPaymentKeyOrigin`'s second lookup pass).
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const pureKeypairsFromStore = codexStore ? codexStore((s: CodexStoreState) => s.pureKeypairs) : [];
  // `wizard-keyset-scale-and-sidebar` T3: `pureKeypairs` is now also a
  // real, explicit PROP (`allAccounts`'s own pattern) — a caller that
  // supplies it (even an empty array, explicitly) wins; `undefined`
  // (every current caller, including `CodexIdPage.tsx`, which does not
  // pass this prop yet) falls back to the pre-existing store read above,
  // so nothing already relying on it regresses.
  const pureKeypairs = pureKeypairsProp !== undefined ? pureKeypairsProp : pureKeypairsFromStore;
  const arweaveSeeds = codexStore ? codexStore((s: CodexStoreState) => s.arweaveSeeds) : [];
  // SUBSCRIBED (not read through `getState()`) for the same reason
  // `arweaveSeeds` above is: the Arweave step's check must RE-RUN when the
  // codex's Arweave accounts actually change, so a write landing while that
  // step is on screen (Generate, or any other panel) updates its three rows
  // instead of leaving a stale verdict behind. The evaluation itself still
  // reads `getState()` at call time — see `evaluateMasterArweaveAccounts`.
  const foreignKeys = codexStore ? codexStore((s: CodexStoreState) => s.foreignKeys) : [];

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
    // `passwordCache?.expiresAt` ALSO in deps (`wizard-seed-dashboard-
    // refinements`, this round): `accountChoice` now defaults to
    // `{kind:"keep-current"}` instead of `null` (no more "nothing
    // selected" state), so `chosenSecretForPreview` is non-null from the
    // very FIRST render — often BEFORE the codex has been authenticated
    // yet. Without this, the effect fires once, hits a locked
    // `getPassword()`, records the error, and then NEVER retries once
    // authentication actually happens, because `chosenSecretForPreview`
    // itself never changes value again — the effect's only prior
    // dependency gives it no reason to re-run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosenSecretForPreview, passwordCache?.expiresAt ?? null]);

  // LIFTED guard resolution — same reasoning as the preview effect just
  // above, plus one more: `runFinalize`'s "keep" lock (see that function's
  // own note) needs the SAME resolved value the guard page displayed, not
  // a second, possibly-different chain read taken later. Unfolds whatever
  // shape `currentPrimeAccount.guard` is — `null` while in flight, never
  // rendered as "no guard", which would be a different and wrong statement.
  //
  // code review (review.md, deferred findings #1/#4): this MUST read the
  // Page-2-CHOSEN account's own guard (`chosenAccountForPreview`, the SAME
  // account `resolveFinalizeDerivation`'s own `targetAccount` resolves to),
  // never unconditionally `currentPrimeAccount`'s — Page 2's "choose an
  // existing account" option is a first-class path, and reading the OLD
  // account's guard while displaying/locking it for the NEWLY-chosen one
  // is exactly the CRITICAL bug this fix closes: "keep" would otherwise
  // permanently lock keys belonging to the wrong account, while the real
  // guard of the account actually being promoted goes unprotected.
  const [guardResolution, setGuardResolution] = useState<GuardKeyResolution | null>(null);
  // Owner (live testing, asked MANY times, and the real reason every
  // previous attempt failed): "you still havent shown that the current
  // guard is a keyset-ref… In the codex it is properly recognised as a
  // keyset ref. WHY can't you do it here as well."
  //
  // Because this screen was reading a DIFFERENT VALUE than the Codex tab,
  // not rendering the same value differently. `OuronetAccountsTab`
  // displays `hydrate(account, byAddress[account.address])`, which
  // OVERLAYS live URC_0027 chain state — `d["ouronet-account-guard"]` —
  // on top of the stored record ("chain fields win when present", per
  // that function's own doc). The LIVE guard is the real
  // `{keysetref:{ns,ksn}}` shape; the codex's own at-rest
  // `account.guard` copy is an older EXPANDED `{pred, keys}` snapshot
  // carrying no reference annotation at all. So no amount of fixing the
  // DISPLAY here could ever surface a reference that wasn't in the value
  // being displayed.
  //
  // This reads the same live field, with `hydrate`'s own exact
  // precedence rule (present-and-not-`false` wins, else the stored
  // value), so the wizard and the Codex tab can no longer disagree about
  // what an account's guard even is. The stored copy remains the
  // fallback for an offline/unreadable chain — never a silent downgrade
  // to "no guard".
  const chosenAccountAddresses = useMemo(
    () => (chosenAccountForPreview?.address ? [chosenAccountForPreview.address] : []),
    [chosenAccountForPreview?.address],
  );
  // `loading` IS read (`migration-pending-apply` T4) — it used to be
  // discarded. The chain read below is what `currentGuardForResolution`
  // overlays, so while it is in flight the guard this screen is about is not
  // yet known, and the Settle gate must say "still reading" rather than
  // measure a half-resolved guard. The hook short-circuits for non-Dalos
  // addresses without ever setting this, so it costs nothing where there is
  // no read to wait for.
  const { byAddress: liveGuardByAddress, loading: liveGuardLoading } =
    useAccountChainData(chosenAccountAddresses);
  const liveAccountGuard = chosenAccountForPreview
    ? liveGuardByAddress[chosenAccountForPreview.address]?.["ouronet-account-guard"]
    : undefined;
  const currentGuardForResolution: unknown =
    liveAccountGuard != null && liveAccountGuard !== false
      ? liveAccountGuard
      : chosenAccountForPreview?.guard ?? null;
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

  // Seed Dashboard inputs (docs/work/wizard-seed-dashboard/design.md) — the
  // SAME settled values the Payment/Guard/Review steps already render,
  // resolved once here rather than re-derived per step.
  const seedDashboardPaymentPublicKey = settledPaymentKeyOf(
    paymentChoice, reviewPreview, currentPaymentKeyOf(chosenAccountForPreview),
  );
  // Owner (live testing, `wizard-page2-and-dashboard-fixes` round 8):
  // "Keep this guard as is, would have to show the Seed Words that are
  // responsible for the two keys the guard currently has." —
  // `summarizeGuardChoice`'s own "keep" branch never resolves the
  // CURRENT keys at all (`{headline:"Unchanged.", keys:null, pred:""}`)
  // — it's the REVIEW page's own "what will this produce" ternary, which
  // has no reason to re-derive keys that aren't changing. The Settling
  // Dashboard needs the OPPOSITE: for "keep" specifically, the keys that
  // ARE already in effect, which `guardResolution` (the live, decrypt-
  // free chain-shape read already happening for the guard step's own
  // CURRENT display) already has on hand via `keysOf`.
  const seedDashboardGuardPublicKeys = guardChoice?.kind === "keep"
    ? (guardResolution ? keysOf(guardResolution) : null)
    : summarizeGuardChoice(guardChoice, reviewPreview)?.keys ?? null;

  // The violet (Arweave) ticker — async (decrypt-and-compare), so it is
  // resolved separately from the other three, which are plain public-key
  // string matches. `false` until proven (every row's violet ticker simply
  // starts unlit, same graceful-degradation precedent as this file's other
  // "can't prove it yet" spots). Guarded by a monotonically-incrementing
  // request token (same discipline `ExistingKeysetPicker`'s own
  // `requestIdRef`/`bumpRequest` already uses elsewhere in this file) so a
  // slow, now-superseded decrypt can never overwrite a newer result.
  //
  // WHAT IT MEANS (`docs/work/wizard-arweave-step/design.md` §"One predicate,
  // actually"): the codex HOLDS Arweave accounts #0 AND #1 under the Codex
  // Master Seed — the verdict of `resolveMasterArweaveHeld`, i.e. the exact
  // same predicate, fed from the exact same resolution, as the Arweave step
  // and `runFinalize`. It used to be `resolveArweaveMatchSeedId`, which asked
  // whether any Arweave seed's bitstring matched some CHAINWEB seed's and
  // never looked at accounts #0/#1 at all — so an Arweave seed row holding
  // ZERO accounts lit this square while finalize refused, which is the
  // contradiction the owner reported twice. `resolveArweaveMatchSeedId`
  // itself is untouched and still exported (other callers test it); it just
  // no longer drives this ticker.
  //
  // A BOOLEAN, not a seed id, because the predicate's own `seedId` is the
  // ARWEAVE seed's id and the dashboard's cards are keyed by CHAINWEB seed
  // id — it is not a card id and must never be handed to
  // `computeSeedDashboardCards` as the old function's return value was. Which
  // CARD the square belongs on is a separate question with an exact answer:
  // the Codex Master Seed's card, which is by definition the card the chosen
  // ACCOUNT resolved to (`seedDashboardAccountSeedId` — the blue ticker's
  // card), or the account's own fallback card when it matches no Chainweb
  // seed at all. Composed below, where that id is in scope.
  const [seedDashboardArweaveAccountsHeld, setSeedDashboardArweaveAccountsHeld] = useState(false);
  /**
   * Whether the boolean above is still being WORKED OUT
   * (`migration-pending-apply` T4). Owner, on the Settle gate: *"there might
   * be some moment where the squares are not lit, as readings are being
   * done."*
   *
   * The violet role was the one with no in-flight flag at all:
   * `seedDashboardArweaveAccountsHeld` starts `false`, so "not yet asked",
   * "asked, and no" and "a locked codex that cannot be asked" were a single
   * indistinguishable value — fine for a square that is simply unlit, fatal
   * for a gate, which would read a re-read in progress as a settled "no" and
   * block with the wrong reason.
   *
   * Starts `true` for exactly that reason (nothing has been asked yet), and
   * is set/cleared by the SAME request-id-guarded effect below, under the
   * same token — a superseded resolution must not clear a newer one's flag
   * any more than it may overwrite its verdict.
   */
  const [seedDashboardArweaveResolving, setSeedDashboardArweaveResolving] = useState(true);
  const seedDashboardRequestIdRef = useRef(0);
  const arweaveSeedsSnapshotKey = JSON.stringify(arweaveSeeds.map((s: IArweaveSeed) => [s.id, s.isPrime === true, s.secret]));
  const candidateSeedsSnapshotKey = JSON.stringify(allSeeds.map((s) => [s.id, s.secret]));
  // Shared with the Arweave STEP's own check below — both now watch the
  // codex's Arweave ACCOUNTS (`(seedId, index)` foreign-key entries), not
  // merely its Arweave seed rows, so both must re-run when those change.
  const foreignKeysSnapshotKey = JSON.stringify(
    foreignKeys.map((k: ForeignKeyEntry) => [k.seedId ?? null, k.index ?? null]),
  );
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    const myRequestId = ++seedDashboardRequestIdRef.current;
    // Synchronously, before the first await: the gate downstream of this must
    // never see a stale `held` value without also seeing that a fresh answer
    // is on its way.
    setSeedDashboardArweaveResolving(true);
    // The password degradation is unchanged in substance, only in location:
    // `getPassword` is handed over as a FUNCTION and the two shared seams
    // (`resolveFinalizeDerivation`, `evaluateMasterArweaveAccounts`) each
    // swallow its failure into "locked"/`null` — so a locked codex still
    // leaves this square dark and still never prompts, exactly as the
    // `try { … } catch { password = null }` here used to guarantee
    // (`docs/work/wizard-unlock-lifecycle/design.md` T4: "left alone").
    void resolveMasterArweaveHeld({
      accountChoice,
      keysChoice,
      currentPrimeAccount: currentPrimeAccount ?? null,
      allAccounts,
      getPassword: actions?.getPassword,
      readCodexState: () => codexStore?.getState() ?? null,
    }).then(
      ({ result }) => {
        if (seedDashboardRequestIdRef.current !== myRequestId) return; // superseded — discard
        setSeedDashboardArweaveAccountsHeld(result.ok);
        setSeedDashboardArweaveResolving(false);
      },
      () => {
        // `resolveMasterArweaveHeld` is documented never to reject (every
        // password/decrypt failure inside it degrades to "nothing proven"),
        // and this handler exists so that promise contract can never be the
        // thing that strands the Settle gate: an unanswerable question is an
        // unlit square, not an eternal "still checking".
        if (seedDashboardRequestIdRef.current !== myRequestId) return; // superseded — discard
        setSeedDashboardArweaveAccountsHeld(false);
        setSeedDashboardArweaveResolving(false);
      },
    );
    // Keyed on PRIMITIVE identities of everything the verdict actually reads
    // (`allAccounts`/`accountChoice` are re-created by callers on every
    // render, so depending on them directly would re-run this forever) —
    // which account is chosen (`chosenSecretForPreview`/`keysChoice?.kind`,
    // since the master bitstring comes from THAT account's own words), the
    // codex's Arweave seeds AND accounts, and the password epoch.
    // `candidateSeedsSnapshotKey` is deliberately NOT here any more: the
    // Chainweb seed list was only ever an input to the OLD question.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    chosenSecretForPreview,
    keysChoice?.kind,
    arweaveSeedsSnapshotKey,
    foreignKeysSnapshotKey,
    passwordCache?.expiresAt ?? null,
  ]);

  // ── THE ARWEAVE STEP'S OWN CHECK (docs/work/wizard-arweave-step/design.md).
  //
  // Runs ONLY while that step is on screen: it decrypts every Arweave seed
  // the codex holds (a 600,000-iteration PBKDF2 each) plus the chosen
  // account's own secret, which is not work to do on a step that is not
  // asking the question.
  //
  // The master bitstring comes from `resolveFinalizeDerivation` — the SAME
  // resolution `runFinalize` uses, not a second decrypt path: this step must
  // be asking about the CHOSEN account's bitstring, which is exactly what
  // that function (and nothing else in this file) resolves. A resolution
  // failure is passed on as a `null` bitstring, which the predicate reports
  // as "nothing proven", with the real reason rendered beside the rows.
  //
  // Same monotonic request-token discipline as the two effects above: a slow,
  // now-superseded check must never overwrite a newer verdict — the gate on
  // Continue is downstream of this state, so a stale `ok: true` landing late
  // would unlock Finalize for a codex that no longer qualifies.
  const arweaveCheckRequestIdRef = useRef(0);

  /**
   * ONE implementation of the step's check, run by the effect below on
   * arrival and by Generate again afterwards (`wizard-arweave-step` T2).
   *
   * The re-run after a derivation is the ACTUAL guarantee behind Generate's
   * success — `ensurePrimeArweaveSeed` RESOLVING proves nothing, because a
   * partial delivery resolves and only a zero-key run rejects. So it has to
   * be the same question, asked the same way, as the one that settled the
   * three rows in the first place; a second expression of it is exactly how
   * the violet ticker and the finalize gate came to disagree (this topic's
   * design.md). Returns the verdict it applied, or `null` if it was
   * superseded (`requestId`, the same monotonic token every other async
   * resolution in this component uses).
   *
   * THE PASSWORD: a password PROVEN here (the step's own unlock prompt, which
   * only resolves after a successful decrypt) wins over the codex's cached
   * one, which may be the very thing that is wrong. `evaluateMasterArweave-
   * Accounts`'s own precedence is the opposite (cache first, caller's
   * password as the fallback) because `runFinalize` wants exactly that — the
   * generator it calls encrypts under the CACHED password — so this passes
   * the proven one AS the `getPassword`, rather than widening that shared
   * function with a second policy.
   */
  async function runArweaveStepCheck(
    requestId: number,
  ): Promise<CodexHoldsMasterArweaveAccountsResult | null> {
    const provenPassword = arweaveProvenPassword;
    const getPassword: (() => string) | undefined =
      provenPassword !== null ? () => provenPassword : actions?.getPassword;
    // The SAME pipeline the violet ticker runs, by construction — see
    // `resolveMasterArweaveHeld`'s own doc comment for why that matters.
    const { derivation: resolved, result } = await resolveMasterArweaveHeld({
      accountChoice,
      keysChoice,
      currentPrimeAccount,
      allAccounts,
      getPassword,
      readCodexState: () => codexStore?.getState() ?? null,
    });
    if (arweaveCheckRequestIdRef.current !== requestId) return null; // superseded — discard
    // Generate derives from the SAME resolution these rows were computed
    // from, never a second one of its own.
    arweaveDerivationRef.current = resolved.ok
      ? { bitString: resolved.bitString, words: resolved.words }
      : null;
    setArweaveCheck({
      status: "settled",
      result,
      masterUnresolved: resolved.ok ? null : resolved.error,
      masterPasswordProblem: resolved.ok ? null : resolved.passwordProblem ?? null,
    });
    return result;
  }

  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (step !== "arweave") return;
    const myRequestId = ++arweaveCheckRequestIdRef.current;
    setArweaveCheck({ status: "checking" });
    void (async () => {
      const result = await runArweaveStepCheck(myRequestId);
      // A satisfied codex has nothing still missing, so the last attempt's
      // complaint is retired rather than left to resurface if the verdict
      // ever goes the other way again.
      if (result !== null && result.ok) setArweaveGenerateOutcome(null);
    })();
    // Keyed on PRIMITIVE identities of everything the check actually reads —
    // `allAccounts`/`accountChoice` are re-created by callers on every render
    // (including this file's own tests, which pass array literals), so
    // depending on them directly would re-run this effect forever, each run
    // setting state that triggers the next.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    step,
    chosenSecretForPreview,
    keysChoice?.kind,
    arweaveSeedsSnapshotKey,
    foreignKeysSnapshotKey,
    passwordCache?.expiresAt ?? null,
    // A password PROVEN at this step's own prompt re-arms the check — that is
    // what makes the prompt a way forward rather than a notice. It is the
    // only trigger on the "unlocked but holding a useless password" path,
    // where nothing about the cache (and so nothing about `expiresAt`)
    // changes at all.
    arweaveProvenPassword,
  ]);

  // The blue (account) ticker's own seed — owner correction (this round,
  // real-data screenshot: "as soon as i select the Ouronet Account it
  // dissapeared"): a real Prime account's own stored key is known to
  // drift from any seed's recorded key list on legacy/imported codices
  // (the class of account this wizard exists to rescue) — true for
  // "keep current" (fixed two rounds ago via the `currentPrimeSeed`
  // structural shortcut below) AND equally true for "existing" (picking a
  // DIFFERENT, non-prime account), which had NO equivalent fallback until
  // now: `resolveAccountSeedId` decrypts the chosen account's own words
  // and compares the resulting bitstring against each candidate seed's
  // own decrypted secret — reliable for ANY chosen account, not just the
  // structurally-known prime one. `currentPrimeSeed?.id` stays the
  // synchronous, zero-decrypt first choice for "keep current" when
  // supplied; every other case (and "keep current" without that prop)
  // falls through to the async match. Same request-token discipline as
  // the Arweave effect just above.
  const [seedDashboardAccountSeedId, setSeedDashboardAccountSeedId] = useState<string | null>(null);
  // Owner (live testing, this round): "clicking reveal seed, still
  // showed the seed of the prime codex account. But after closing it,
  // waiting a bit, clicking view seed again, finally was showing its
  // correct seed... it had to get a time to switch what it shows and i
  // clicked reveal seed to fast." The request-id guard above already
  // stops a STALE resolution from clobbering a newer one once it
  // settles — but it never stopped the dashboard from showing the OLD
  // card, with a perfectly clickable "View seed" button, for the whole
  // window WHILE a newly-chosen account's own resolution is still in
  // flight. `true` for the entire async gap (set right before the
  // decrypt-and-compare starts, cleared once its result — whichever
  // request turns out to be the LATEST one — is actually applied);
  // always `false` on the synchronous "keep current" path, which has no
  // such gap to guard. Threaded into `viewSeedDisabled` below alongside
  // the account-step's own probe-settle gate, so every "View seed"
  // button in the dashboard (including the unmatched-account fallback
  // card) stays disabled until the content it would show is actually
  // current.
  const [accountSeedResolving, setAccountSeedResolving] = useState(false);
  const accountSeedRequestIdRef = useRef(0);
  // Owner (`settled-master-identity/design.md` §2): "why is there a
  // latency period between when i choose the Ouronet Account and when the
  // Blue square gets light up? i dont get it?" Every account switch
  // re-ran the WHOLE candidate scan — up to N serial 600,000-iteration
  // PBKDF2 decrypts of the very same seeds, whose bitstrings cannot have
  // changed since the previous switch. This memo (CALLER-owned by
  // contract — `resolveAccountSeedId` keeps that module pure and
  // React-free, so a module-level cache there would leak across callers
  // and tests) lives for this wizard's mounted lifetime, making a return
  // visit to an already-resolved account decrypt-free.
  const seedBitsCacheRef = useRef<Map<string, string | null>>(new Map());
  // The epoch the live memo belongs to. Discarding it on an epoch change
  // is explicitly the caller's job (`ResolveAccountSeedIdInput.
  // seedBitsCache`'s own doc): the map is keyed by seed id ALONE, with no
  // password and no seed-revision identity in the key, so the function
  // cannot tell a stale entry from a fresh one.
  const seedBitsCacheEpochRef = useRef<string | null>(null);
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    // Owner (live testing, this round): "as i changed the selected
    // Ouronet Account, the displayed seed didnt change. moreover when i
    // change again to the prime codex ouronet account from selecting
    // AncientHodler account, the settle dashboard dissapeared." Root
    // cause: this request id MUST be bumped on every effect run,
    // UNCONDITIONALLY — including the synchronous "keep current" path
    // below, which used to `return` before ever touching it. Without
    // that bump, switching "existing" → "keep current" left the OLD
    // "existing" selection's still-in-flight async request holding the
    // SAME request id the (synchronous) new one would have used, so
    // when that stale request finally settled, its result sailed
    // straight past the `!== myRequestId` guard below and clobbered the
    // correct, already-applied synchronous value.
    const myRequestId = ++accountSeedRequestIdRef.current;
    // EPOCH CHECK, before the synchronous shortcut below can `return` —
    // a password change that lands while "keep current" is selected must
    // still throw the memo away, or the next "existing" selection would
    // be answered from entries belonging to the previous unlock.
    //
    // What makes an epoch:
    // - The PASSWORD (`passwordCache.expiresAt`, which changes on every
    //   fresh `authenticate()` anywhere in the app — see `AccountStep`'s
    //   own `passwordEpoch` prop). A SUCCESSFUL bitstring is actually
    //   password-independent (it is a property of the seed), but a
    //   memoised `null` is NOT: it may mean nothing worse than "the
    //   password in force at the time was wrong", and replaying it after
    //   the user has unlocked correctly would report a perfectly good
    //   seed as unresolvable — the exact silent-failure class the
    //   probe's own `passwordEpoch` re-arm exists to kill.
    // - The SEED LIST (`candidateSeedsSnapshotKey`, already a dependency
    //   here, already hashing `[id, secret]` for every seed). A seed's
    //   bitstring is immutable for a given seed id, but a seed id is NOT
    //   a promise that the ROW behind it is the same row: a re-import or
    //   restore can legitimately put a DIFFERENT secret under a reused
    //   id, and answering that forever from the old bitstring would
    //   mis-attribute the seed behind a funds-bearing account — the same
    //   class of error §2 refuses to risk by trusting `parentSeedId`.
    //   Folding it in costs nothing that matters: switching accounts
    //   does not touch this key, so the decrypt-free return visit is
    //   unaffected.
    //
    // REPLACED, never `.clear()`ed: a superseded resolution may still be
    // in flight, holding the Map it was handed by reference, and it will
    // keep writing results derived under the OLD epoch into it after it
    // settles. Swapping in a new object means those stale writes land in
    // a map nobody reads any more; clearing in place would let them
    // repopulate the live one. Done here, synchronously in the effect
    // body rather than in a separate epoch-watching effect, so the
    // resolution started below is guaranteed the map matching its own
    // epoch with no window in between.
    const seedBitsEpoch = `${passwordCache?.expiresAt ?? "locked"}|${candidateSeedsSnapshotKey}`;
    if (seedBitsCacheEpochRef.current !== seedBitsEpoch) {
      seedBitsCacheEpochRef.current = seedBitsEpoch;
      seedBitsCacheRef.current = new Map();
    }
    if ((accountChoice === null || accountChoice.kind === "keep-current") && currentPrimeSeed) {
      setSeedDashboardAccountSeedId(currentPrimeSeed.id);
      setAccountSeedResolving(false);
      return;
    }
    setAccountSeedResolving(true);
    let password: string | null = null;
    try {
      password = actions?.getPassword ? actions.getPassword() : null;
    } catch {
      password = null;
    }
    void resolveAccountSeedId({
      account: chosenAccountForPreview, candidateSeeds: allSeeds, password, smartDecrypt,
      // Read (not captured as a ref) at call time, so this resolution is
      // bound to the epoch's map that existed when it STARTED — the same
      // discipline as `myRequestId` above.
      seedBitsCache: seedBitsCacheRef.current,
    }).then((result) => {
      if (accountSeedRequestIdRef.current !== myRequestId) return; // superseded — discard
      setSeedDashboardAccountSeedId(result);
      setAccountSeedResolving(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountChoice, currentPrimeSeed, chosenAccountForPreview, candidateSeedsSnapshotKey, passwordCache?.expiresAt ?? null]);

  // Owner (live testing, `wizard-page2-and-dashboard-fixes` round 5):
  // "Master Chainweb seed becomes the seed that is responsible for the
  // Payment Key. It shifted. This musnt be possible... with the default
  // selection, this same Master Seed would be responsible for the
  // generation of the payment key... thus also green ticker." A freshly-
  // DERIVED payment/guard key (the "derive a new one"/"recommended-
  // single-key" DEFAULT choices) is never recorded in any seed's own
  // `accounts[]` yet, so a key search (`findSeedIdForKey`) could never
  // attribute it anywhere — it must instead be attributed directly to
  // whichever id the ACCOUNT role itself resolved to, since deriving
  // happens FROM that exact same account material. An EXISTING,
  // already-recorded key (the "keep" choices) still resolves via
  // `findSeedIdForKey`, exactly as before.
  // Owner (live testing, round 6): "at every stage we show only the
  // tickers that have been settled up to that step." Payment/guard
  // default to a real, non-null choice from the moment the wizard
  // mounts — that default existing is NOT the same thing as the user
  // having actually reached (and therefore settled) that step. Gating
  // on `STEP_ORDER` — not merely "is there a choice value" — is what
  // makes a card/fallback's payment/guard ticker stay dark while still
  // on an earlier step, and go dark again on navigating BACK past that
  // step (no separate "furthest reached" ratchet — see `STEP_ORDER`'s
  // own doc comment).
  const paymentStepReached = STEP_ORDER[step] >= STEP_ORDER.payment;
  const guardStepReached = STEP_ORDER[step] >= STEP_ORDER.guard;

  // WHICH CARD the violet square lights on, now that the predicate behind it
  // answers a yes/no about the codex rather than naming a Chainweb seed (see
  // `seedDashboardArweaveAccountsHeld` above). The square belongs to the
  // CODEX MASTER SEED, and in this dashboard that is — by the owner's own
  // definition, round 5: "The Master Seed is the seed responsible for the
  // Selected Ouronet Account. PERIOD." — whichever card the ACCOUNT resolved
  // to, i.e. the blue ticker's own card. Composed here rather than inside the
  // effect so the two resolutions stay independent: the account's card can
  // change (a different account chosen) without re-asking the Arweave
  // question, and vice versa, each still guarded by its own request token.
  const seedDashboardArweaveMatchSeedId =
    seedDashboardArweaveAccountsHeld ? seedDashboardAccountSeedId : null;
  // ... and when the chosen account matches NO Chainweb seed — the common
  // case for the legacy/imported accounts this wizard exists to rescue — the
  // master role is played by the account's own fallback card (titled with the
  // literal `CODEX_MASTER_SEED`), which has no seed id to compare against,
  // exactly like `accountFallbackPaymentMatch` below.
  const accountFallbackArweaveMatch =
    seedDashboardArweaveAccountsHeld
    && seedDashboardAccountSeedId === null && chosenAccountForPreview !== null;

  const paymentIsStoicDerived = paymentChoice?.kind === "stoic-dalos-position-0";
  const seedDashboardPaymentSeedId = !paymentStepReached
    ? null
    : paymentIsStoicDerived
      ? seedDashboardAccountSeedId
      : findSeedIdForKey(seedDashboardPaymentPublicKey, allSeeds);
  const guardIsStoicDerived =
    guardChoice?.kind === "recommended-single-key" || guardChoice?.kind === "update-keyset-recommended";
  const seedDashboardGuardSeedIds = !guardStepReached
    ? null
    : guardIsStoicDerived
      ? [seedDashboardAccountSeedId]
      : (seedDashboardGuardPublicKeys ?? []).map((k) => findSeedIdForKey(k, allSeeds));

  // The chosen account's own fallback card (`SeedDashboard`'s
  // `chosenAccount`/`AccountFallbackCardView`, `wizard-page2-and-
  // dashboard-fixes` round 4) has no `seedId` of its own to compare
  // against — it exists precisely BECAUSE `seedDashboardAccountSeedId`
  // is `null`. Deriving payment/guard from that SAME (seed-less)
  // account's own words must still light its own payment/guard
  // tickers, so this is tracked directly rather than via id equality
  // (which, both being `null`, would otherwise always spuriously
  // "match") — gated on the SAME step-reached rule as above.
  const accountFallbackPaymentMatch =
    paymentStepReached
    && seedDashboardAccountSeedId === null && chosenAccountForPreview !== null && paymentIsStoicDerived;
  // Owner (live testing, this round, real-data report): "the guard is
  // made of 2 keys, so it should say 2 instead of 1... If a keyset is
  // made of 9 keys, the total numbers shown would have to add up to 9."
  // The DERIVE case (`guardIsStoicDerived`) was already counted (always
  // exactly 1 — a freshly-derived key never has siblings). The gap: a
  // KEPT guard (not derived) can include the seed-less account's own
  // direct `publicKey` as one of its members (a real self-guard pattern —
  // the account's STOA payment/identity key, included in its own guard
  // keyset) — that key is neither in any seed's `accounts[]` nor in
  // `pureKeypairs[]`, so without this it silently fell through
  // unattributed, and the total shown across every card undercounted the
  // real keyset size. Counts every such self-matching member, not just
  // one — a keyset could in principle name the account's own key more
  // than once (degenerate, but the count must still be honest).
  const accountFallbackGuardCount = !guardStepReached || seedDashboardAccountSeedId !== null
    || chosenAccountForPreview === null
    ? 0
    : guardIsStoicDerived
      ? 1
      : (seedDashboardGuardPublicKeys ?? [])
          .filter((k) => accountOwnKeyBacksRole(k, chosenAccountForPreview)).length;

  // The Settling Dashboard's "Pure Keys" attribution card
  // (`docs/work/wizard-keyset-scale-and-sidebar/design.md`'s "G") — a bare
  // pure keypair has no seed to attribute to at all, so it is checked
  // directly against `pureKeypairs` here, alongside the seed search above,
  // gated by the SAME `paymentStepReached`/`guardStepReached` booleans
  // every other role already obeys (`false`/`0` before that step is
  // reached, matching `accountFallbackPaymentMatch`/
  // `accountFallbackGuardCount` just above).
  const pureKeysPaymentMatch =
    paymentStepReached && pureKeypairBacksRole(seedDashboardPaymentPublicKey, pureKeypairs);
  const pureKeysGuardCount = !guardStepReached
    ? 0
    : (seedDashboardGuardPublicKeys ?? []).filter((k) => pureKeypairBacksRole(k, pureKeypairs)).length;

  // Owner (live testing, said three separate times now): "the guard is
  // made of 2 keys, so it should say 2 instead of 1... If a keyset is
  // made of 9 keys, the total numbers shown would have to add up to 9."
  //
  // Every attribution bucket above answers "which card does THIS key
  // belong to" — seed (`findSeedIdForKey`), pure keypair
  // (`pureKeypairBacksRole`), or the chosen seed-less account's own two
  // key fields (`accountOwnKeyBacksRole`). A key matching NONE of them
  // used to simply vanish from the dashboard, silently breaking that
  // invariant — and chasing it one newly-discovered key field at a time
  // (first `publicKey`, then `stoaChainLedger`…) is exactly how it kept
  // coming back. This is the structural answer instead: whatever is left
  // over after every real bucket has claimed its own gets counted HERE,
  // so the totals add up to the real keyset size NO MATTER WHAT a given
  // key turns out to be — including a genuinely foreign key this codex
  // has never held, which is itself worth showing rather than hiding.
  const unattributedGuardCount = !guardStepReached || guardIsStoicDerived
    ? 0
    : (seedDashboardGuardPublicKeys ?? []).filter((k) =>
        findSeedIdForKey(k, allSeeds) === null
        && !pureKeypairBacksRole(k, pureKeypairs)
        && !(seedDashboardAccountSeedId === null && accountOwnKeyBacksRole(k, chosenAccountForPreview)),
      ).length;

  // ── THE SETTLE GATE'S FOUR COLOURS (`migration-pending-apply` T4) ──────
  //
  // Owner: *"This button must be clickable once all the squares are lit."*
  // Asked what that means: *"all squares lit, by this i mean, one blue one
  // red one brown one pink, in the sense that we have all the colour lit."*
  //
  // So: each ROLE lit SOMEWHERE in the Settling Dashboard — never every
  // square on every card. Roles legitimately split across cards (the owner's
  // own screenshot has blue+violet on one card and green+gold on another),
  // and both the "Pure Keys" and "Keys Not In This Codex" cards hardcode
  // three of their four squares dark by design (see `SeedTicker lit={false}`
  // at those call sites) — a per-square rule would therefore never pass at
  // all.
  //
  // ONE named value, derived once from the very same inputs `SeedDashboard`
  // is handed below, so the gate and the squares cannot disagree: a second
  // expression of "is this lit" is exactly how the violet ticker and the
  // finalize gate came to contradict each other before
  // (`docs/work/wizard-arweave-step/design.md`).
  const settleRolesLit = {
    /** BLUE. Either a Chainweb seed was matched to the chosen account, or —
     *  the common case for the legacy/imported accounts this wizard exists
     *  to rescue — the account's own fallback card plays the Codex Master
     *  Seed's part and carries the square itself. */
    account: seedDashboardAccountSeedId !== null || chosenAccountForPreview !== null,
    /** GREEN. A seed's card, the chosen account's own fallback card, or the
     *  Pure Keys card — whichever one claimed the payment key. */
    payment:
      seedDashboardPaymentSeedId !== null
      || accountFallbackPaymentMatch
      || pureKeysPaymentMatch,
    /** GOLD/BROWN. ONE attributed member is enough: a keyset's members are
     *  spread across whichever cards hold them, and `unattributedGuardCount`
     *  is itself a lit square (the "Keys Not In This Codex" card), which is
     *  a real answer about the guard rather than an absent one. */
    guard:
      (seedDashboardGuardSeedIds ?? []).some((id) => id !== null)
      || accountFallbackGuardCount > 0
      || pureKeysGuardCount > 0
      || unattributedGuardCount > 0,
    /** VIOLET. The one yes/no about the codex itself rather than about a
     *  key: does it hold Arweave accounts #0 AND #1 under the Codex Master
     *  Seed. Whichever card the square renders on
     *  (`seedDashboardArweaveMatchSeedId` / `accountFallbackArweaveMatch`),
     *  this is the fact behind it. */
    arweave: seedDashboardArweaveAccountsHeld,
  } as const;

  /** Whether this codex currently holds a usable password. The same
   *  `cache !== null && cache.expiresAt > Date.now()` test
   *  `handleArweaveStepUnlock` already takes its `wasUnlocked` snapshot
   *  with — kept identical deliberately, so "locked" means one thing in
   *  this file. */
  const codexLocked = passwordCache === null || passwordCache.expiresAt <= Date.now();

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
  // full call sequence this implements. Triggered by `handleSettleChoices`
  // below (the "Settle Choices" button) or by the inline unlock prompt's
  // retry, and by nothing else; `handleSettleChoices`'s own idle-status
  // guard is what keeps it non-re-entrant.
  /**
   * STAGE 2 — THE COMMIT.
   *
   * Five writes. The first four are each recorded in
   * `migrationProgress.committed` as they land, so a resumed commit skips one
   * instead of redoing it; the fifth is the PENDING PLAN, and it goes LAST so
   * a codex never offers to apply a partial commit.
   *
   *   1. pair + promote the seed   -> committed.seedId / .accountId
   *   2. the Codex Master Seed row -> committed.rowWritten
   *   3. the master-key locks      -> committed.locksWritten
   *   4. the ArWeave face          -> committed.arweaveSeedId
   *   5. the pending plan          -> migrationProgress.pending
   *
   * Recording is best-effort throughout: it makes a resume cheaper, and must
   * never be what fails a migration that otherwise succeeded.
   *
   * ## What Write 5 used to be, and why it is not that any more
   *
   * `docs/work/migration-pending-apply/design.md`. Write 5 used to be the
   * ALIGNMENT STAMP, and the `"success"` path then called
   * `completeMigration()`, which deletes the recorded run outright (persists
   * `null`, so the adapter removes the shard). Both halves contradicted the
   * owner's model — *"using the wizard for the first time places the codex in
   * a pending state. This pending state can be placed in a new pending state
   * forever, until the apply button seals it forever. The finalize at the end
   * simply writes a new pending state."*
   *
   *  - The stamp is the SEAL. Once `primeAlignment` is `"aligned"` both
   *    `ensurePrimeSeedAccountPairingAndPromote` and
   *    `promoteSeedAndAccountToPrime` throw permanently, and nothing anywhere
   *    un-stamps it — so stamping here dead-ended Write 1 of every later run.
   *    It moved to `sealMigration()`, which Apply calls. The store-side guards
   *    are unchanged; they simply now trip at Apply.
   *  - The record IS the pending state, so deleting it left nothing to apply.
   *
   * So Finalize now REPLACES the pending plan (a new finalize is a new plan)
   * and seals nothing.
   */
  /**
   * `passwordOverride` — a password the user JUST typed into the finalize
   * panel's own prompt (wizard-unlock-lifecycle, T2). Used in place of the
   * cached one for the decrypt, because the "wrong" case is precisely a codex
   * that is unlocked and whose cached password is useless here: re-reading the
   * cache would fail the same way forever. Returns which password problem
   * stopped the run, or `null` — so the prompt can report the attempt without
   * reading state it cannot see yet.
   */
  async function runFinalize(passwordOverride?: string): Promise<FinalizePasswordProblem | null> {
    // A RETRY from the inline prompt must leave the panel showing that prompt
    // while it works, rather than flipping back to "Finalizing your Prime
    // trio…": unrendering the prompt UNMOUNTS it, which throws away the
    // password the user typed AND the "Incorrect password — try again." line
    // the retry is about to produce (its state lives in the component, per
    // `InlineUnlockPrompt`'s auth-free design). The prompt shows its own
    // in-flight state ("Checking…") meanwhile.
    const isPromptRetry = passwordOverride !== undefined;
    if (!isPromptRetry) {
      setFinalizeStatus("running");
      setFinalizeNeedsPassword(null);
    }
    setFinalizeError(null);
    // A retry must not open showing the previous attempt's last derivation
    // event — nothing is deriving yet.
    setFinalizeArweaveProgress(null);
    void actions?.beginMigrationCommit().catch(() => {});

    if (!actions) {
      setFinalizeStatus("error");
      setFinalizeError(
        "Finalize is not available right now — this wizard has no connection to the codex.",
      );
      return null;
    }

    const resolved = await resolveFinalizeDerivation({
      accountChoice,
      keysChoice,
      currentPrimeAccount,
      allAccounts,
      getPassword:
        passwordOverride !== undefined ? () => passwordOverride : actions.getPassword,
    });
    if (!resolved.ok) {
      // A PASSWORD problem is a question, not a verdict: ask it inline and
      // leave every staged selection untouched, so submitting an answer
      // resumes this same attempt (the old behaviour — one red line and a
      // "Close" button — was the owner's reported dead end).
      if (resolved.passwordProblem) {
        setFinalizeNeedsPassword(resolved.passwordProblem);
        setFinalizeStatus("needs-password");
        return resolved.passwordProblem;
      }
      setFinalizeStatus("error");
      setFinalizeError(resolved.error);
      return null;
    }

    // The password question (if there was one) is answered — the rest of the
    // run is real work again.
    if (isPromptRetry) {
      setFinalizeNeedsPassword(null);
      setFinalizeStatus("running");
    }

    // A freshly-typed password that genuinely decrypts. Start the codex's
    // unlock window ONLY if it was really locked — the window is ABSOLUTE,
    // not sliding (`zbom/hooks/useEnsureCodexUnlocked.ts` documents the bug
    // that unconditional `authenticate()` calls caused: every operation
    // silently reset the TTL, so the visible "re-authenticate in X" countdown
    // was a lie). The snapshot is taken here, from the store, immediately
    // before the decision — same rule, same shape, as that hook's
    // `wasUnlocked`.
    //
    // This runs AFTER the decrypt proved the password right, deliberately:
    // caching a wrong one would leave the codex "unlocked" with a password
    // that decrypts nothing — the exact `"wrong"` state above — and would then
    // suppress its own fix, since the window would no longer be startable.
    // The authentication must also land BEFORE the writes below:
    // `ensurePrimeArweaveSeed` calls `getPassword()` inside its own package
    // (packages/codex-arweave) and only ever reads the cache.
    if (isPromptRetry) {
      const cache = codexStore?.getState().passwordCache ?? null;
      const wasUnlocked = cache !== null && cache.expiresAt > Date.now();
      if (!wasUnlocked) {
        actions.authenticate(passwordOverride, codexStore?.getState().uiSettings?.passwordCacheMinutes);
      }
    }

    /**
     * THE LEGACY PRIME, read HERE because Write 1 is about to destroy it.
     *
     * `ensurePrimeSeedAccountPairingAndPromote` (below) ends in
     * `promoteSeedAndAccountToPrime`, which clears `isPrime` on every OTHER
     * account; Write 2 — the Codex Master Seed row — runs after that. So this
     * is the LAST point at which the account that was this codex's CodexPrime
     * can be identified at all. Nothing later can reconstruct it: the flag is
     * gone, the row has never named it, and its stored name is not a signal
     * either (the v0.2 kickstart path takes a caller-supplied name, which is
     * why a real codex's account reads "Initial Seed" rather than the v0.3 literal
     * `"CodexPrime"` — and name-matching is exactly what `codex/masterNames.ts`
     * forbids).
     *
     * Read from the STORE, not from `allAccounts`: the flag is store state,
     * and the props are a caller-supplied view that need not contain every
     * account. It cannot throw — no store, or no account carrying the flag,
     * simply yields `undefined` and the field is omitted, leaving Write 2
     * byte-identical to what it was.
     *
     * WRITE-ONCE IS NOT ENFORCED HERE, deliberately. This wizard is
     * re-runnable, and on a retry this reading is the PREVIOUS CANDIDATE, not
     * the owner's original account — so a second guard here would be guarding
     * the wrong value anyway. The rule lives in `recordFormerMasterIds`
     * (codex-core), which `setCodexMasterSeed` routes every row write through:
     * an id already on the row wins over anything this run names. See
     * `CodexMasterSeed.legacyPrimeOuroAccountId` for the full reasoning.
     */
    const legacyPrimeOuroAccountId = codexStore
      ?.getState()
      .ouroAccounts.find((a: IOuroAccount) => a.isPrime)?.id;

    let guardRotationNeeded: boolean;
    /**
     * The Chainweb seed Write 1 paired this account with — hoisted out of the
     * `try` (same shape `guardRotationNeeded` already uses) because WRITE 2
     * needs it and `result` is block-scoped to the pairing itself.
     *
     * Owner-reported bug: Write 2 used to read this id back out of
     * `migrationProgress.committed.seedId`, which Write 1 publishes through a
     * deliberately FIRE-AND-FORGET `recordMigrationCommit` — and that
     * recording is best-effort by design (it must never fail a migration that
     * otherwise succeeded, and it is a plain no-op whenever there is no
     * recorded run to merge into). Whenever the read came up empty the `if`
     * fell through, the Codex Master Seed row was silently never written, and
     * the codex went on to be stamped eligible while the Codex ID page kept
     * saying "This codex has not settled on a Codex Master Seed yet".
     *
     * So the id now comes from the value already in hand. The store read
     * stays only as the RESUMED-commit fallback — a run whose Write 1 landed
     * in an earlier session has no `result` this time, but does have the id
     * recorded.
     */
    let pairedSeedId: string | undefined;
    try {
      const result = await actions.ensurePrimeSeedAccountPairingAndPromote(resolved.accountId, {
        bitString: resolved.bitString,
        words: resolved.words,
        method: resolved.method,
      });
      guardRotationNeeded = result.guardRotationNeeded;
      pairedSeedId = result.seedId;
      // Write 1 landed.
      void actions.recordMigrationCommit({
        seedId: result.seedId,
        accountId: resolved.accountId,
      }).catch(() => {});
    } catch (e) {
      setFinalizeStatus("error");
      setFinalizeError(e instanceof Error ? e.message : "Could not finalize this codex's Prime trio.");
      return null;
    }
    // ── Write 2: the Codex Master Seed row. ALWAYS — nothing about which
    //    three entities are the faces of this seed depends on a sweep.
    //
    //    `chainwebSeedId` is NOT optional on a `CodexMasterSeed` (and
    //    `setCodexMasterSeed` refuses a row that cannot name both faces), so
    //    the id genuinely has to come from somewhere: the pairing's own
    //    result first, the recorded run second (a resumed commit).
    const chainwebSeedId =
      pairedSeedId ?? codexStore?.getState().migrationProgress?.committed?.seedId;
    /**
     * A row that did not land must leave EVIDENCE, not silence. It stays
     * non-fatal — the row is descriptive and re-runnable, and a failure here
     * must not throw away a migration that otherwise succeeded — but the old
     * bare `catch {}` is half of why the reported bug was invisible: a row
     * that genuinely failed looked exactly like one that was never needed.
     *
     * `rowWritten: false` is the durable half (a later reader or a resumed
     * commit can tell "attempted and failed" from "not attempted"), recorded
     * best-effort like every other commit record; the console report is the
     * half that survives even when there is no recorded run to merge into,
     * which is precisely the state this bug occurred in.
     */
    function noteCodexMasterSeedRowMissed(cause: unknown): void {
      // eslint-disable-next-line no-console
      console.error(
        "[LegacyPrimeMigrationWizard] the Codex Master Seed row did not land — " +
          "this codex may still read as having no Codex Master Seed",
        cause,
      );
      void actions?.recordMigrationCommit({ rowWritten: false }).catch(() => {});
    }
    try {
      if (chainwebSeedId) {
        await actions.setCodexMasterSeed({
          ouroAccountId: resolved.accountId,
          chainwebSeedId,
          establishedAt: new Date().toISOString(),
          // Only when it names someone ELSE: a finalize that re-confirms the
          // account already holding the role displaced nobody and must not
          // claim it did.
          ...(legacyPrimeOuroAccountId && legacyPrimeOuroAccountId !== resolved.accountId
            ? { legacyPrimeOuroAccountId }
            : {}),
        });
        void actions.recordMigrationCommit({ rowWritten: true }).catch(() => {});
      } else {
        // Unreachable in practice — the pairing above returns a seed id on
        // every success — but a skipped row must say so rather than vanish.
        noteCodexMasterSeedRowMissed(
          new Error("no Chainweb seed id available to name in the Codex Master Seed row"),
        );
      }
    } catch (e) {
      noteCodexMasterSeedRowMissed(e);
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
    //
    // The three values this write settles are HOISTED out of the `try` (same
    // shape `pairedSeedId` already uses) because Write 5's pending plan has to
    // name them, and `migration-pending-apply` T2's own rule is that the plan
    // reuses what is in scope rather than re-deriving — two code paths
    // answering "which keys did this run choose?" is exactly how this file's
    // earlier bugs came about. They are assigned where they are COMPUTED
    // rather than after `secureMasterAccount` resolves: the plan records what
    // this finalize DECIDED (which is what Apply would execute), while
    // `committed.locksWritten` stays the separate record of what landed.
    // `null`, not `undefined`, on both key fields: that is the "unresolved"
    // value `secureMasterAccount` and `computeMasterKeyLockDelta` are defined
    // over (see `masterKeyLockDelta.ts`), and narrowing it here would make
    // this hoist change behaviour rather than just widen a scope.
    let paymentPublicKey: string | null = null;
    let guardPublicKeys: readonly string[] | null = null;
    /** Only from a choice that genuinely carries one — a derived single-key
     *  guard names no predicate of its own here. */
    let guardPred: string | undefined;
    try {
      // guard-step-variants (docs/work/guard-step-variants/design.md): the
      // three newest kinds lock the SAME way "recommended-single-key"/
      // "custom" already do — the intended final key set, regardless of
      // whether a Stage 3 transaction is still needed to make it true on
      // chain. "update-keyset-recommended" derives the SAME position-1 key
      // "recommended-single-key" does (the difference is only WHICH
      // on-chain action eventually applies it — updating the reference vs.
      // switching away from it — and neither executes here, see
      // `outstandingKeyChanges.ts`'s own note). "update-keyset-custom"
      // already carries its own real `keys` directly — they are the
      // codex's OWN keys, with no externally-mutable reference to drift
      // from, so no re-verification risk applies to it the way it does
      // below for "use-existing-keyset".
      const guardKeys =
        guardChoice?.kind === "custom" || guardChoice?.kind === "update-keyset-custom"
          ? guardChoice.keys
          // review.md (deferred finding #3): a "use-existing-keyset" choice
          // names an EXTERNAL, independently-mutable on-chain keyset — the
          // resolved `keys` snapshot can be stale by the time this write
          // runs, especially across a resumed session (the resume path
          // restores the choice verbatim, with no chain re-check). Locking
          // a snapshot that no longer matches what the keyset actually
          // names would be exactly the "lock/offer the wrong keys" hazard
          // this file's own "absence of evidence must not unlock or
          // mis-lock" rule exists to prevent — so re-verify right here,
          // immediately before the lock, and treat ANY mismatch or failed
          // re-check as "not yet resolved" (`null`), never "use the old
          // value anyway".
          : guardChoice?.kind === "use-existing-keyset"
            ? await (async (): Promise<readonly string[] | null> => {
                try {
                  if (!describeKeyset) throw new Error("no chain connection available on this screen");
                  const fresh = await describeKeyset(`${guardChoice.ns}.${guardChoice.ksn}`);
                  const sameKeySet =
                    fresh.keys.length === guardChoice.keys.length &&
                    guardChoice.keys.every((k) => fresh.keys.includes(k));
                  if (!sameKeySet || fresh.pred !== guardChoice.pred) return null;
                  return guardChoice.keys;
                } catch {
                  return null;
                }
              })()
            : guardChoice?.kind === "recommended-single-key"
            || guardChoice?.kind === "update-keyset-recommended"
            ? [deriveStoaDalosKeypairAtIndex(resolved.bitString, 1).publicKey]
            // code review (review.md, deferred finding #4): "keep" (or any
            // choice that falls through to here) must lock what the chosen
            // account's guard ACTUALLY is right now, not the
            // `guardResolution` state the guard page captured at step-
            // mount time — review, password re-entry, and the Arweave-seed
            // step can all elapse between that snapshot and this write.
            // Re-resolving here, synchronously before the lock, is the
            // same `resolveGuardKeys` call `guardResolution`'s own effect
            // uses, just taken at the moment that actually matters.
            //
            // It reads `currentGuardForResolution` — the LIVE-chain-first
            // value (see its own doc above), not the codex's at-rest
            // `account.guard` copy this used to read. Locking the stale
            // copy was the sharper edge of the same bug that hid the
            // keyset-ref badge: "keep" would pin whatever keys the codex
            // last wrote down, which is exactly NOT "what the guard
            // actually is right now" when the two have diverged.
            : keysOf(await resolveGuardKeys(currentGuardForResolution, {
                describeKeyset:
                  describeKeyset ??
                  (async () => { throw new Error("no chain connection available on this screen"); }),
              }));
      guardPublicKeys = guardKeys;
      guardPred =
        guardKeys && guardChoice && "pred" in guardChoice ? guardChoice.pred : undefined;
      paymentPublicKey =
        paymentChoice?.kind === "stoic-dalos-position-0"
          ? deriveStoaDalosKeypairAtIndex(resolved.bitString, 0).publicKey
          : currentPaymentKeyOf(chosenAccountForPreview);
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
    //
    // REWRITTEN (`arweave-master-accounts` T3, owner-reported bug): this used
    // to set `arweaveOutstanding` ONLY when the prop was absent or threw —
    // i.e. it inferred eligibility from "the call didn't throw" and never
    // checked whether the codex ended up holding the Arweave accounts at all.
    // It did not: the derivation was discarding its key, so the codex gained
    // an Arweave seed row and ZERO accounts while this screen printed "This
    // codex is now eligible." next to a DARK violet ticker — the Settling
    // Dashboard's independent read of the very same fact. Owner: *"it says it
    // made my codex eligible, but it never did check if the codex has arweave
    // accounts... it first has to have shown a purple square box on the Codex
    // Master Seed... And if it doesn't it would have to make it on the spot."*
    //
    // So eligibility is now a VERIFIED PREDICATE over the codex's end state,
    // evaluated TWICE around the derivation:
    //   BEFORE — a codex that already holds #0 and #1 derives nothing (two
    //            RSA-4096 keys it already has cost the user seconds for no
    //            change at all), and a codex holding only one of them asks
    //            for only the other;
    //   AFTER  — the derivation RESOLVING proves nothing on its own, because
    //            a PARTIAL delivery resolves (only a zero-key derivation
    //            rejects, see `ensurePrimeArweaveSeed`'s own contract). The
    //            re-evaluation is the actual guarantee behind the claim, not
    //            a formality.
    // It is the SAME predicate the violet ticker reads
    // (`codexHoldsMasterArweaveAccounts`), so the two can no longer disagree.
    let arweaveOutstanding = false;
    /**
     * Re-read from `getState()` every time, never from this render's closure:
     * the whole point of the second evaluation is to observe writes that
     * `ensurePrimeArweaveSeed` made DURING this run, which a captured
     * `arweaveSeeds`/`foreignKeys` snapshot cannot see.
     *
     * The password is the codex's own held one — the same `getPassword()` the
     * generator encrypts the seed it writes under, so the two agree by
     * construction. `passwordOverride` is the fallback for the window closing
     * mid-run (it is the password that just proved itself on the decrypt
     * above); a predicate with no password simply reports "not proven",
     * never a free pass.
     *
     * Both of those rules now live in ONE place,
     * {@link evaluateMasterArweaveAccounts}, shared with the Arweave STEP's
     * own check (`docs/work/wizard-arweave-step/design.md`) — the step and
     * the commit must be asking the identical question, and two copies of
     * this input is how the ticker and this gate came to disagree.
     */
    const evaluateArweaveAccounts = () => evaluateMasterArweaveAccounts({
      masterBitString: resolved.bitString,
      readCodexState: () => codexStore?.getState() ?? null,
      getPassword: actions.getPassword,
      fallbackPassword: passwordOverride ?? null,
    });

    const heldBeforeDerivation = await evaluateArweaveAccounts();
    /**
     * THE AUTHORITATIVE verdict on the Arweave face, and the single source of
     * the seed id Write 4b stamps below: the post-derivation re-check whenever
     * a derivation ran, the pre-check when the codex was already complete and
     * nothing was derived.
     *
     * It is deliberately the SAME evaluation `arweaveOutstanding` is set from,
     * never a fresh scan of its own. The predicate already identifies the
     * matching seed (`seedId`) on its way to the verdict, and this file's own
     * history is what the rule comes from: two code paths answering "which
     * Arweave seed is the master's?" is exactly how the violet ticker and the
     * eligibility claim came to disagree.
     *
     * Left at `heldBeforeDerivation` on both failing branches (no derivation
     * available, derivation threw), where it carries `ok: false` and is
     * therefore not stampable — which is the intended answer there.
     */
    let masterArweaveHeld = heldBeforeDerivation;
    if (heldBeforeDerivation.ok) {
      // Already complete — write nothing, derive nothing, claim it honestly.
    } else if (!ensurePrimeArweaveSeed) {
      arweaveOutstanding = true;
    } else {
      try {
        await ensurePrimeArweaveSeed(
          { bitString: resolved.bitString, words: resolved.words },
          {
            missingIndexes: heldBeforeDerivation.missingIndexes,
            onProgress: setFinalizeArweaveProgress,
          },
        );
        // THE CHECK THE REPORTED BUG WAS MISSING.
        const heldAfterDerivation = await evaluateArweaveAccounts();
        masterArweaveHeld = heldAfterDerivation;
        if (!heldAfterDerivation.ok) {
          arweaveOutstanding = true;
          setFinalizeError(ARWEAVE_MASTER_ACCOUNTS_NOT_HELD_TEXT);
        }
      } catch (e) {
        arweaveOutstanding = true;
        setFinalizeError(e instanceof Error ? e.message : ARWEAVE_SEED_NOT_AVAILABLE_TEXT);
      } finally {
        // The progress line reports an IN-FLIGHT derivation; this one has
        // settled, whichever way it went.
        setFinalizeArweaveProgress(null);
      }
    }

    // ── Write 4b: the master Arweave seed's ID onto the Codex Master Seed
    //    row, completing its third face.
    //
    // Owner, after finalizing: *"The newly made Master Arweave Seed should be
    // on position one colour golden, and the one existing as Master Arweave
    // Seed, should have become Arweave Seed One."* The RENAMING was already
    // fixed; the ordering and the gold still followed `isPrime`, which is a
    // "first Arweave seed ever added" provenance marker and deliberately does
    // NOT move (`addArweaveSeed` refuses a second explicit prime with
    // `CodexKickstartError("id-conflict")`). On a codex that already had an
    // Arweave seed that made the DEMOTED seed keep gold and position one while
    // the real master sat grey further down — the inverse of the requirement.
    //
    // So the display follows an authoritative IDENTITY field instead, exactly
    // as `codex/masterNames.ts` already does for account names — and this is
    // the one write that establishes it. `CodexMasterSeed.arweaveSeedId` was
    // declared, persisted and exported, but nothing in the codebase ever set
    // it.
    //
    // Three rules, all of them the surrounding block's own:
    //  * the id comes from `masterArweaveHeld` — the ONE authoritative
    //    evaluation above — never from a second scan (see its doc);
    //  * only on `ok: true` with a real `seedId`: a codex that is not actually
    //    holding #0 and #1 under that seed must not be stamped as having a
    //    master Arweave seed, same "verify the end state, do not trust that
    //    the call returned" rule the whole block exists for;
    //  * non-fatal, because a seed-id stamp must never fail a migration that
    //    otherwise succeeded — but REPORTED, never swallowed.
    //
    // `setCodexMasterSeed` MERGES this partial into the existing row and
    // THROWS if the result cannot name both mandatory faces, so the write is
    // safe here only because Write 2 established the row earlier in this same
    // run. Write 2 is itself non-fatal: when it missed (`rowWritten: false`),
    // this throws — which is handled the same observable way rather than
    // weakening the action's two-mandatory-faces guard.
    /** The master Arweave seed Write 5's plan names — the SAME authoritative
     *  value this block stamps, hoisted rather than re-read (see the block's
     *  own "never a second scan" rule above). Set from the VERIFIED
     *  evaluation, not from the row write landing: a stamp that failed to
     *  persist does not change which seed this codex proved it holds. */
    let masterArweaveSeedId: string | undefined;
    if (masterArweaveHeld.ok && masterArweaveHeld.seedId) {
      const arweaveSeedId = masterArweaveHeld.seedId;
      masterArweaveSeedId = arweaveSeedId;
      try {
        await actions.setCodexMasterSeed({ arweaveSeedId });
        // Best-effort, like every other commit record here — and into the
        // `arweaveSeedId` field `MigrationCommitRecord` already declares for
        // exactly this, so a resumed commit can see what landed.
        void actions.recordMigrationCommit({ arweaveSeedId }).catch(() => {});
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error(
          "[LegacyPrimeMigrationWizard] the Codex Master Seed row's Arweave seed id did not land — " +
            "this codex's Arweave seed list may keep ordering and colouring by `isPrime`",
          e,
        );
      }
    }

    // ── Write 5: the PENDING PLAN.
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
    // The ArWeave face is the one real precondition, and — since
    // `arweave-master-accounts` — specifically the Arweave ACCOUNTS #0 and #1
    // under the Codex Master Seed, not merely a seed row: without them there
    // is no prime ArWeave address to compare against, so eligibility
    // genuinely cannot be claimed. `arweaveOutstanding` above is now set from
    // the VERIFIED end state, never from "the derivation call returned".
    //
    // It is also what keeps an INCOMPLETE migration out of the pending state:
    // an unfinished commit has nothing to apply, and a plan written here would
    // let Apply stamp alignment over a codex that is not eligible at all. The
    // early return below therefore stays exactly where it is — ahead of the
    // plan write, as it was ahead of the stamp it replaced.
    if (arweaveOutstanding) {
      setFinalizeStatus("arweave-unavailable");
      return null;
    }

    /**
     * The plan Apply will execute and seal, REPLACING any previous one (see
     * `recordMigrationPending`'s own contract — a new finalize is a new plan,
     * exactly as re-partitioning replaces the previous layout).
     *
     * Written on BOTH remaining terminal statuses, deliberately.
     * `"eligible-rotation-outstanding"` and `"success"` are the same completed
     * commit; they differ only in whether the user's chosen key changes are
     * already on chain — which Apply's own popup computes separately, from
     * `computeOutstandingKeyChanges`. Writing the plan on only one of them
     * would deny the Apply button to precisely the users who have something to
     * execute.
     *
     * Non-fatal and REPORTED, the same rule Writes 2 and 4b already follow
     * here: a persistence failure must not throw away a migration that
     * otherwise succeeded, but it must not be silent either — without the plan
     * there is no Apply button, and the user has to run the wizard again.
     */
    try {
      await actions.recordMigrationPending({
        finalizedAt: new Date().toISOString(),
        accountId: resolved.accountId,
        ...(chainwebSeedId ? { seedId: chainwebSeedId } : {}),
        ...(masterArweaveSeedId ? { arweaveSeedId: masterArweaveSeedId } : {}),
        ...(paymentPublicKey ? { paymentPublicKey } : {}),
        ...(guardPublicKeys ? { guardPublicKeys: [...guardPublicKeys] } : {}),
        ...(guardPred ? { guardPred } : {}),
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(
        "[LegacyPrimeMigrationWizard] the pending migration plan did not land — " +
          "this codex will not offer an Apply button for this run",
        e,
      );
    }

    if (guardRotationNeeded) {
      // Eligible, but the user's CHOSEN key changes are not on chain yet.
      // The run is deliberately NOT cleared: it records what was chosen, and
      // Apply resumes from exactly this.
      setFinalizeStatus("eligible-rotation-outstanding");
      return null;
    }

    setFinalizeStatus("success");
    return null;
  }

  /**
   * The finalize panel's own `InlineUnlockPrompt` submit (wizard-unlock-
   * lifecycle, T2) — re-runs the interrupted finalize with the typed password
   * and reports the outcome in the `{ok, error}` shape that component expects.
   *
   * Note what is NOT here: no `authenticate()` call of its own. Whether the
   * codex's absolute unlock window may be started is decided inside
   * `runFinalize`, once the password has actually proved itself, under the
   * `wasUnlocked` snapshot — see the comment at that call.
   */
  async function handleFinalizeUnlock(password: string): Promise<{ ok: boolean; error?: string }> {
    const problem = await runFinalize(password);
    if (problem !== null) {
      // Both problems reduce to the same thing from here: this password did
      // not work. Same wording the Account step's own prompt uses.
      return { ok: false, error: "Incorrect password — try again." };
    }
    return { ok: true };
  }

  /**
   * The ARWEAVE STEP's own `InlineUnlockPrompt` submit (`wizard-arweave-step`
   * T2) — the way out of the dead end T1 reported, where a locked codex (or
   * one holding a password that decrypts nothing) left three unreadable rows,
   * a blocked Continue, and closing the wizard as the only option.
   *
   * It PROVES the password the only way a password can be proven — by
   * decrypting the chosen account with it, through the same
   * `resolveFinalizeDerivation` the check itself uses — and only then:
   *
   *   - starts the codex's unlock window IF the codex was genuinely locked.
   *     The window is ABSOLUTE, never sliding: an already-unlocked codex must
   *     keep counting down from where it was, or the visible "re-authenticate
   *     in X" countdown becomes a lie (`src/zbom/hooks/useEnsureCodexUnlocked
   *     .ts` documents exactly that bug). The `wasUnlocked` snapshot is taken
   *     from the store immediately before the decision, same shape as that
   *     hook's and as `runFinalize`'s.
   *   - records it as this step's proven password, which re-arms the check
   *     (see that effect's deps) and is what Generate's own password-
   *     agreement guard is measured against.
   *
   * Authenticating BEFORE the decrypt would be the worse mistake available
   * here: `authenticate()` caches whatever it is handed without validating
   * it, so a wrong password would leave the codex "unlocked" with a password
   * that decrypts nothing — and then suppress its own fix, since the window
   * would no longer be startable.
   */
  async function handleArweaveStepUnlock(password: string): Promise<{ ok: boolean; error?: string }> {
    const resolved = await resolveFinalizeDerivation({
      accountChoice,
      keysChoice,
      currentPrimeAccount,
      allAccounts,
      getPassword: () => password,
    });
    if (!resolved.ok) {
      // A password failure gets the prompt's own default wording ("Incorrect
      // password — try again.", same as Finalize's); anything else is a
      // problem this password cannot fix, so it is quoted as-is.
      if (resolved.passwordProblem) return { ok: false };
      return { ok: false, error: resolved.error };
    }
    const cache = codexStore?.getState().passwordCache ?? null;
    const wasUnlocked = cache !== null && cache.expiresAt > Date.now();
    if (!wasUnlocked) {
      actions?.authenticate(password, codexStore?.getState().uiSettings?.passwordCacheMinutes);
    }
    setArweaveProvenPassword(password);
    return { ok: true };
  }

  /**
   * Why Generate cannot be pressed, or `null` when it can
   * (`wizard-arweave-step` T2). Shaped exactly like
   * {@link continueBlockedReason}, for the same reason: a control that looks
   * live and ignores clicks is a bug, and a disabled one that says nothing is
   * barely better.
   */
  function arweaveGenerateUnavailableReason(): string | null {
    if (!ensurePrimeArweaveSeed) return ARWEAVE_STEP_GENERATE_UNAVAILABLE_TEXT;
    if (arweaveCheck.status !== "settled" || arweaveDerivationRef.current === null) {
      return "This codex's Arweave accounts are still being checked — generating waits for that answer.";
    }
    // THE PASSWORD-AGREEMENT GUARD. The generator encrypts what it writes
    // under the password the CODEX holds (it calls `getPassword()` inside
    // `packages/codex-arweave` and takes no password argument), while this
    // step reads with the password it actually proved. When those differ,
    // deriving would write a real Arweave seed that nothing can read back —
    // see {@link ARWEAVE_STEP_GENERATE_PASSWORD_MISMATCH_TEXT}.
    if (arweaveProvenPassword !== null) {
      const held =
        passwordCache !== null && passwordCache.expiresAt > Date.now() ? passwordCache.value : null;
      if (held !== arweaveProvenPassword) return ARWEAVE_STEP_GENERATE_PASSWORD_MISMATCH_TEXT;
    }
    return null;
  }

  /**
   * What the step says went wrong with the LAST Generate, or `null`.
   *
   * DERIVED from the current verdict rather than stored as a sentence: the
   * rows and this line must never be able to disagree, and the re-check that
   * follows a derivation can be superseded by the effect's own re-run (the
   * writes it just made re-arm it). Computing the text from whatever verdict
   * is current means whichever check lands last is the one being described.
   */
  function arweaveGenerateErrorText(): string | null {
    if (arweaveGenerateOutcome === null) return null;
    if (arweaveCheck.status !== "settled" || arweaveCheck.result.ok) return null;
    return arweaveGenerateOutcome.kind === "rejected"
      ? arweaveGenerateOutcome.message
      : arweaveStillMissingText(arweaveCheck.result);
  }

  /**
   * Generate (`wizard-arweave-step` T2) — the step's one action.
   *
   * Same three-beat shape `runFinalize`'s own Arweave block has (search
   * `heldBeforeDerivation`), interactively: the positions to derive come from
   * THIS step's current evaluation, the derivation's own `onProgress` events
   * drive the progress line, and then — the beat the reported bug was missing
   * — the predicate is RE-EVALUATED. A resolved promise is not a finished
   * derivation: a partial delivery resolves, and only a zero-key run rejects.
   * So nothing here treats the call coming back as success; success is the
   * re-evaluated verdict, which is also what unblocks Continue.
   */
  async function handleArweaveGenerate(): Promise<void> {
    if (arweaveGenerating || arweaveGenerateUnavailableReason() !== null) return;
    const derivation = arweaveDerivationRef.current;
    if (!ensurePrimeArweaveSeed || derivation === null || arweaveCheck.status !== "settled") return;
    // Exactly what is missing — never a blanket [0, 1]: re-deriving an
    // RSA-4096 key the codex already holds costs the user seconds for no
    // change at all.
    const missingIndexes = arweaveCheck.result.missingIndexes;
    setArweaveGenerateOutcome(null);
    setArweaveStepProgress(null);
    setArweaveGenerating(true);
    let rejected: string | null = null;
    try {
      await ensurePrimeArweaveSeed(
        { bitString: derivation.bitString, words: derivation.words },
        { missingIndexes, onProgress: setArweaveStepProgress },
      );
    } catch (e) {
      rejected = e instanceof Error ? e.message : ARWEAVE_SEED_NOT_AVAILABLE_TEXT;
    }
    // The progress line reports an IN-FLIGHT derivation; this one has
    // settled, whichever way it went.
    setArweaveStepProgress(null);
    // THE CHECK THAT DECIDES IT — the same one the rows came from, asked
    // again against the codex as it is NOW.
    await runArweaveStepCheck(++arweaveCheckRequestIdRef.current);
    setArweaveGenerateOutcome(
      rejected !== null ? { kind: "rejected", message: rejected } : { kind: "settled" },
    );
    setArweaveGenerating(false);
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
    // Owner (live testing): "i resumed a started session, it seems there
    // is no blue box for Ouronet Account, it hasnt loaded… while the
    // codex still looks keys up and the blue box isnt fixed, the next
    // button on the wizard must be disabled."
    //
    // This gate used to live INSIDE the `"account"` branch, so it only
    // ever fired on the step where the user picks an account. A RESUMED
    // session restores its choices and lands straight on a LATER step
    // (payment/guard/review) with that same resolution still in flight —
    // the dashboard shows its "Checking…" line and an unlit account
    // ticker, while Continue sat fully enabled. Hoisted above the
    // per-step branches so it holds on EVERY step past intro: until we
    // know which seed backs the chosen account, nothing downstream of it
    // can be trusted enough to advance past.
    if (accountChoice?.kind === "existing" && accountSeedResolving) {
      return "Checking this account's details — hang tight…";
    }
    if (step === "account") {
      if (accountChoice == null) return `Choose which account becomes your ${OURONET_CODEX_MASTER} first.`;
      return null;
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
    // THE ARWEAVE GATE (docs/work/wizard-arweave-step/design.md). Continue is
    // bound to the CHECK, never to "the user pressed Generate": a derivation
    // that ran is not the same fact as a codex that holds the accounts (a
    // partial delivery resolves), and inferring one from the other is the bug
    // the whole topic exists to close. So Finalize stays unreachable until
    // the predicate itself says `ok` — the owner's *"after successfully
    // adding them or detected that they exist... the finalize button THEN
    // becomes available."*
    if (step === "arweave") {
      // A derivation in flight is its own reason, ahead of the verdict it is
      // about to change: the positions it has already delivered can make the
      // check pass while the rest are still deriving, and leaving the step
      // mid-derivation would abandon work the user is watching.
      if (arweaveGenerating) {
        return "Deriving this codex's Arweave accounts — hang tight…";
      }
      return arweaveStepBlockedReason(arweaveCheck);
    }
    return null;
  }

  /**
   * Why {@link SETTLE_CHOICES_LABEL} cannot be pressed, or `null` when it
   * can (`migration-pending-apply` T4). Shaped exactly like
   * {@link continueBlockedReason} and {@link arweaveGenerateUnavailableReason},
   * for the same reason those exist: a control that looks live and ignores
   * clicks is a bug, and a disabled one that says nothing is barely better.
   *
   * THE GATE is the owner's: *"This button must be clickable once all the
   * squares are lit (there might be some moment where the squares are not
   * lit, as readings are being done)."* That parenthetical is half the
   * requirement — "still being read" and "settled dark" are different facts
   * and the user is owed the difference, so every in-flight resolution is
   * reported as such BEFORE any colour is judged. A colour that is dark
   * because its answer has not arrived yet is not a colour that cannot
   * light.
   *
   * THE LOCKED CODEX IS THE ONE DELIBERATE NON-BLOCK, and it is not a hole
   * in the gate — it is the only way the gate is not a trap. A locked codex
   * cannot resolve its Arweave accounts at all (`resolveMasterArweaveHeld`
   * degrades a locked `getPassword()` to "nothing proven", by design — it
   * must never prompt from a ticker: `ui-seed-dashboard.test.tsx` pins blue
   * and violet staying dark there with no prompt), so the colour rules below
   * could never pass and would leave the user on the last step with a
   * permanently dead button. `runFinalize` itself is the thing that CAN ask:
   * it reaches `"needs-password"` and the panel renders
   * {@link InlineUnlockPrompt}, whose submit resumes this very commit. So
   * pressing Settle IS the route to the password prompt, and the visible line
   * beside the button says exactly that rather than a bare "not ready".
   */
  function settleBlockedReason(): string | null {
    if (codexLocked) {
      return null;
    }
    // ── "readings are being done" ──────────────────────────────────────
    if (accountSeedResolving) {
      return "Still checking which seed backs this account — the blue square is not lit yet.";
    }
    if (liveGuardLoading) {
      return "Still checking this account's live guard on chain — the brown square is not lit yet.";
    }
    if (reviewPreview.status === "loading") {
      return "Still checking this account's derived keys — the green and brown squares are not lit yet.";
    }
    if (guardResolution === null) {
      return "Still checking what this account's guard is made of — the brown square is not lit yet.";
    }
    if (seedDashboardArweaveResolving) {
      return "Still checking this codex's Arweave accounts — the violet square is not lit yet.";
    }
    // ── settled, and dark ──────────────────────────────────────────────
    if (!settleRolesLit.account) {
      return "The BLUE (account) square is not lit: no account is chosen for your "
        + OURONET_CODEX_MASTER + " yet. Go back and choose one.";
    }
    if (!settleRolesLit.payment) {
      return "The GREEN (payment key) square is not lit: the payment key you chose belongs to no "
        + "seed, no pure keypair, and not to the account itself, so this codex cannot show where "
        + "it comes from. Go back and choose a payment key this codex holds.";
    }
    if (!settleRolesLit.guard) {
      return "The BROWN (guard) square is not lit: this account's guard names no keys this codex "
        + "can account for — a capability/user guard, or a keyset reference that could not be "
        + "read. Go back and choose a guard instead of keeping this one.";
    }
    if (!settleRolesLit.arweave) {
      return "The VIOLET (Arweave) square is not lit: this codex does not hold Arweave accounts "
        + "#0 and #1 under its Codex Master Seed. Go back to the Arweave step and generate them.";
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
  // review.md (deferred finding #2): a guard choice can be non-null and
  // still genuinely INCOMPLETE — clicking "Define a custom guard" (or
  // switching to the "use an existing keyset" sub-tab) records
  // `{kind:"custom"|..., keys:[], ...}` the instant it's clicked, before
  // the user has picked/resolved any key. `continueBlockedReason`'s guard
  // branch already treats this as incomplete and keeps the user on this
  // page; `recordSelectionIfComplete` must agree, or a user who clicks
  // into the custom option and abandons the wizard mid-pick leaves a
  // half-made guard choice persisted as if it were a deliberate final one.
  function isGuardChoiceComplete(guard: LegacyPrimeMigrationGuardChoice): boolean {
    if (
      (guard.kind === "custom" || guard.kind === "update-keyset-custom" || guard.kind === "use-existing-keyset")
      && guard.keys.length === 0
    ) {
      return false;
    }
    return true;
  }

  function recordSelectionIfComplete(
    nextAccount: LegacyPrimeMigrationAccountChoice | null,
    nextPayment: LegacyPrimeMigrationPaymentChoice | null,
    nextGuard: LegacyPrimeMigrationGuardChoice | null,
  ): void {
    if (!actions) return;
    if (nextAccount == null || nextPayment == null || nextGuard == null) return;
    if (!isGuardChoiceComplete(nextGuard)) return;
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
      // The Arweave verification step comes between the review and the
      // commit (design.md: generating Arweave accounts WRITES, so it belongs
      // after the "nothing has been written yet" boundary, and the commit
      // belongs after the accounts are proven present).
      setStep("arweave");
      notifyStateChange({ step: "arweave", accountChoice, keysChoice });
      return;
    }
    if (step === "arweave") {
      // Blocked until the check passes — `disabled` on the button is the
      // visible half, this is the half that holds for a programmatic or
      // keyboard activation too.
      if (continueBlockedReason() !== null) return;
      // NAVIGATION ONLY (`migration-pending-apply` T4). This used to also
      // `void runFinalize()`, which made stage 2 a side effect of a step
      // transition — the owner: *"the wizard has to end with a finalize
      // button 'Settle Choices'… clicking it is the final action that settles
      // the selected choices. Right now I don't think it works this way."*
      // Finalize now arrives IDLE (`finalizeStatus: "awaiting-settle"`) and
      // starts nothing; {@link handleSettleChoices} is the boundary.
      setStep("finalize");
      notifyStateChange({ step: "finalize", accountChoice, keysChoice });
    }
  }

  /**
   * STAGE 1 -> 2, AS AN EXPLICIT ACT (`migration-pending-apply` T4) — the
   * "Settle Choices" button's one job.
   *
   * Re-checks {@link settleBlockedReason} rather than trusting the button's
   * `disabled` attribute, exactly as every `handleContinue` branch re-checks
   * `continueBlockedReason()`: the gate has to hold for a keyboard or
   * programmatic activation too, and this is the click that promotes an
   * account and makes keys non-removable.
   *
   * Also non-re-entrant: only the idle status may start a commit, so a second
   * click (or one landing while `runFinalize` is mid-flight) cannot start a
   * second one.
   */
  function handleSettleChoices(): void {
    if (finalizeStatus !== "awaiting-settle") return;
    if (settleBlockedReason() !== null) return; // disabled; defensive only
    void runFinalize();
  }

  // Post-build fix round, Issue 4: the "Back" counterpart to
  // `handleContinue` above — "account" -> "intro", "payment" -> "account",
  // "guard" -> "payment", "review" -> "guard", "arweave" -> "review", and —
  // ONLY while the commit has not started — "finalize" -> "arweave" (see
  // that branch's own comment for why that exception exists and where it
  // stops). Never reachable from "intro"
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
      return;
    }
    if (step === "arweave") {
      // Still free: the Arweave step CHECKS on arrival and only writes when
      // Generate is pressed, so backing out of it to revise a decision costs
      // nothing.
      setStep("review");
      notifyStateChange({ step: "review", accountChoice, keysChoice });
      return;
    }
    if (step === "finalize") {
      // THE ONE EXCEPTION, and why it exists (`migration-pending-apply` T4).
      //
      // `"finalize"` used to be strictly forward-only, and that was right as
      // long as ARRIVING there meant the commit had already run: there is no
      // backing out of an account that has been promoted and keys that have
      // been made non-removable. It arrives IDLE now, with nothing written at
      // all, so backing out of THAT is as free as backing out of the review
      // step — and it is the only escape from a Settle gate that can
      // legitimately never open.
      //
      // Several colours can be permanently dark through no fault of the
      // user: a guard whose `resolveGuardKeys` yields `"none"` /
      // `"unsupported"` / `"keyset-ref-unresolved"` / `"unknown"`, or a kept
      // payment key belonging to no seed, no pure keypair and not to the
      // account itself. Without this branch, such a user reads the reason on
      // the last screen and has nowhere to act on it. With it, the reason
      // names the colour and Back is how they change the choice behind it.
      //
      // STRICTLY idle-only: once `runFinalize` has started (any other
      // status), the writes are real and there is nothing safe to go back
      // to — `FinalizeStep` renders this button only in the idle state, and
      // this guard is the half that holds for a programmatic call.
      if (finalizeStatus !== "awaiting-settle") return;
      setStep("arweave");
      notifyStateChange({ step: "arweave", accountChoice, keysChoice });
    }
  }

  function handleChooseAccount(next: LegacyPrimeMigrationAccountChoice): void {
    setAccountChoice(next);
    notifyStateChange({ step, accountChoice: next, keysChoice });
    // review.md (deferred finding #5, unrelated to guard-step-variants but
    // repaired alongside it): `onChoosePayment`/`onChooseGuard` always
    // re-sync the persisted selection on every change — this handler was
    // the one exception. A user who completes Stage 1 once, then goes Back
    // and picks a DIFFERENT account without also re-touching the
    // (already-complete) payment/guard pages, left the OLD account id
    // persisted; a resume after closing the wizard at that point would
    // silently revert to the account the user had explicitly moved away
    // from.
    //
    // Gated on a selection ALREADY existing — picking the account for the
    // very first time must NOT record anything on its own (an established
    // invariant from an earlier topic: "recording happens only through
    // the explicit payment/guard onChoose callbacks, never from the
    // account default alone" — `ui-wizard-stage-boundaries.test.tsx`'s own
    // "writes NOTHING merely by arriving at Step 3" test). This only
    // re-syncs an EXISTING selection; it never creates the first one.
    if (recordedRun?.selection) {
      recordSelectionIfComplete(next, paymentChoice, guardChoice);
    }
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
          : `Step ${STEP_DISPLAY_NUMBER[step]} of ${STEP_DISPLAY_TOTAL} — ${STEP_LABELS[step]}`
      }
      onClose={onClose}
      accent={ACCENT}
      // `docs/work/wizard-keyset-scale-and-sidebar/design.md`'s "F" — the
      // modal widens once the Settling Dashboard moves into `sidebar`
      // (every step except "intro", the same gate `sidebar`/`topBar`
      // below already use), sized to comfortably fit `sidebarWidth`
      // plus the existing step content width. `"intro"`'s own width is
      // unaffected — there's nothing to show in a sidebar yet on that
      // step.
      //
      // Owner (live testing, this round): the default 260px sidebar was
      // too narrow for a card's "View seed" button + 4-ticker group +
      // account-name label to share one row — the label wrapped word-by-
      // word instead of dropping cleanly to its own line. Widened to
      // 320px here (this wizard's own call site only — `CodexModalShell`'s
      // own default, used by every other caller that never sets this
      // prop, stays 260) and `maxWidth` grown by the same +60 so the step
      // content column's own width is unaffected.
      sidebarWidth={320}
      maxWidth={step !== "intro" ? 920 : 560}
      dialogTestId="legacy-prime-migration-wizard-modal"
      closeTestId="legacy-prime-migration-wizard-close"
      headerExtra={step !== "finalize" ? navRow() : undefined}
      // Owner (live testing, this round, issue 3): "i scroll down... you
      // can see the title with the next prev buttons, as well as the
      // Settle Dashboard Move. They have to be fixed, non movable." A
      // manual `position: sticky` wrapper around the blocked-reason line
      // + Settling Dashboard (tried first, two rounds ago) did NOT fix
      // this: `CodexModalShell`'s own title-bar row lives in the SAME
      // scrolling box as everything in `children` whenever `footerSplit`
      // is false — the case for THIS call site on desktop, since nothing
      // here used to supply `footer`/`topBar`/`fillBody` — so `position:
      // sticky`'s "nearest scrolling ancestor" was the WHOLE card,
      // header included, not a dedicated scroll region; the header (not
      // itself sticky) scrolled away, dragging the visual anchor the
      // sticky block was pinned relative to along with it. Handing this
      // content to `topBar` instead pins it STRUCTURALLY — rendered
      // outside the scrolling `-body` element by `CodexModalShell`
      // itself, not merely styled to look fixed. `splitOnDesktop` (new,
      // opt-in — every other `CodexModalShell` caller is unaffected)
      // extends that split to desktop, matching where the owner's own
      // repro happened.
      splitOnDesktop
      topBar={
        step !== "intro" && step !== "finalize" && continueBlockedReason() !== null ? (
          <div
            data-testid="legacy-prime-migration-continue-blocked"
            style={{ ...stepParagraphStyle, color: "#8b8b96", marginBottom: 10 }}
          >
            {continueBlockedReason()}
          </div>
        ) : undefined
      }
      // Settling Dashboard (docs/work/wizard-seed-dashboard-refinements/
      // design.md, moved into `CodexModalShell`'s own `sidebar` column by
      // `docs/work/wizard-keyset-scale-and-sidebar/design.md`'s "F") —
      // every step except "intro" (nothing is chosen yet there; this
      // whole `sidebar` is `undefined` on that step, so `CodexModalShell`
      // doesn't even engage the split there).
      sidebar={
        step !== "intro" ? (
          <SeedDashboard
            seeds={allSeeds}
            accountSeedId={seedDashboardAccountSeedId}
            paymentSeedId={seedDashboardPaymentSeedId}
            paymentIsStoicDerived={paymentIsStoicDerived}
            guardSeedIds={seedDashboardGuardSeedIds}
            guardIsStoicDerived={guardIsStoicDerived}
            arweaveMatchSeedId={seedDashboardArweaveMatchSeedId}
            getPassword={actions?.getPassword}
            viewSeedDisabled={(step === "account" && !accountProbeSettled) || accountSeedResolving}
            chosenAccount={chosenAccountForPreview}
            accountFallbackPaymentMatch={accountFallbackPaymentMatch}
            accountFallbackGuardCount={accountFallbackGuardCount}
            accountFallbackArweaveMatch={accountFallbackArweaveMatch}
            pureKeysPaymentMatch={pureKeysPaymentMatch}
            pureKeysGuardCount={pureKeysGuardCount}
            unattributedGuardCount={unattributedGuardCount}
          />
        ) : undefined
      }
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
                setAccountChoice({ kind: "keep-current" });
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
            onProbeSettledChange={setAccountProbeSettled}
            probeDecrypt={probeDecrypt}
            probeWatchdogMs={probeWatchdogMs}
          />
        ) : null}
        {step === "payment" ? (
          <PaymentStep
            accountChoice={accountChoice}
            currentPrimeAccount={currentPrimeAccount}
            allAccounts={allAccounts}
            allSeeds={allSeeds}
            pureKeypairs={pureKeypairs}
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
            pureKeypairs={pureKeypairs}
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
            currentPaymentKey={currentPaymentKeyOf(chosenAccountForPreview)}
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
        {step === "arweave" ? (
          <ArweaveStep
            check={arweaveCheck}
            progress={arweaveStepProgress}
            generating={arweaveGenerating}
            generateError={arweaveGenerateErrorText()}
            generateUnavailableReason={arweaveGenerateUnavailableReason()}
            onGenerate={() => { void handleArweaveGenerate(); }}
            onUnlock={handleArweaveStepUnlock}
          />
        ) : null}
        {step === "finalize" ? (
          <FinalizeStep
            status={finalizeStatus}
            errorMessage={finalizeError}
            onClose={onClose}
            committed={recordedRun?.committed}
            needsPassword={finalizeNeedsPassword}
            onUnlock={handleFinalizeUnlock}
            arweaveProgress={finalizeArweaveProgress}
            settleBlockedReason={settleBlockedReason()}
            settleLockedNotice={codexLocked ? SETTLE_LOCKED_NOTICE_TEXT : null}
            onSettle={handleSettleChoices}
            onBack={handleBack}
          />
        ) : null}
      </div>
    </CodexModalShell>
  );

  /**
   * Back / Continue. Owner (this round): "make back and next button part
   * of the region where the steps are presented as simple secure buttons
   * with arrows... making the prev and next button part of the title
   * dashboard the one that presents the steps." Rendered via
   * `CodexModalShell`'s `headerExtra` prop (passed at this component's own
   * `<CodexModalShell>` call site above) — the modal's title bar is
   * ALREADY outside the scrolling body by construction, so these no
   * longer need their own `position: sticky` wrapper the way the old
   * bordered nav rectangle did; `legacy-prime-migration-nav` (that
   * rectangle's own testid) is retired. `legacy-prime-migration-back`/
   * `-continue` are PRESERVED on these buttons — dozens of pre-existing
   * tests throughout this file call them by name. The blocked-reason text
   * (`legacy-prime-migration-continue-blocked`) moved out of this
   * function entirely — it now renders as its own line in the wizard's
   * sticky wrapper, above the Settling Dashboard (see that call site).
   */
  function navRow(): React.ReactElement {
    const blockedReason = continueBlockedReason();
    return (
      <React.Fragment>
        {step !== "intro" ? (
          <button
            type="button"
            data-testid="legacy-prime-migration-back"
            onClick={handleBack}
            aria-label="Back"
            style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              width: 30, height: 30, borderRadius: 8, flexShrink: 0,
              background: "#141414", border: "1px solid #262626", color: "#888", cursor: "pointer",
            }}
          >
            <ChevronLeft size={16} />
          </button>
        ) : null}
        <button
          type="button"
          data-testid="legacy-prime-migration-continue"
          onClick={handleContinue}
          disabled={blockedReason !== null}
          title={blockedReason ?? undefined}
          aria-label="Continue"
          style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 30, height: 30, borderRadius: 8, flexShrink: 0,
            border: "none",
            backgroundColor: blockedReason === null ? ACCENT : "#1a1a1a",
            color: blockedReason === null ? "#0a0a0a" : "#555",
            cursor: blockedReason === null ? "pointer" : "not-allowed",
          }}
        >
          <ChevronRight size={16} />
        </button>
      </React.Fragment>
    );
  }
}

export default LegacyPrimeMigrationWizard;
