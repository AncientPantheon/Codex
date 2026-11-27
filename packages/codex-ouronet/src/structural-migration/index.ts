/**
 * `runStructuralMigration` — the Structural Migration Engine
 * (docs/work/structural-migration-engine/design.md, Topic 2 of the
 * `codex-versioning` project-level design).
 *
 * Fixes a codex's internal *shape* only — never to be confused with the
 * separate, deferred Permaweb Eligibility Migration Engine, which later
 * makes a structurally-current codex eligible for Arweave upload.
 * Structural migration always runs first; eligibility migration assumes a
 * structurally-sound input and never fixes shape itself.
 *
 * Fixes the real, confirmed bug: a legacy `"stoic"` kadenaSeeds entry (or
 * any arweaveSeeds entry — `IArweaveSeed` has no `seedType` at all, every
 * entry uses the identical `secret`/`wordsSecret` bitstring convention per
 * that field's own doc comment) whose `secret` decrypts to raw DALOS words
 * instead of the pre-converted 1024/1600-char bitstring every current call
 * site (`deriveStoaDalosKeypairAtIndex`, etc.) assumes.
 *
 * Mirrors `rekeyCodex`'s proven shape (`src/rekey/index.ts`), the one
 * established precedent in this package for "password-aware, whole-codex,
 * pure `snapshot → snapshot`, skip-not-drop":
 *   - Works on a `structuredClone` of the input snapshot; the caller's
 *     snapshot is never mutated, even on a mid-way throw.
 *   - Skip-not-drop: an entry this engine cannot resolve automatically
 *     keeps its ORIGINAL ciphertext and is recorded in `skipped` — never
 *     silently dropped.
 *   - Stamps `Codex_Shape_Version` to the current target value ONLY when
 *     nothing was skipped, and clears an inherited stamp when something
 *     was — the stamp is the claim `useNeedsStructuralUpgrade` reads, so
 *     making it over an unresolved seed marks a broken codex current and
 *     takes away the retry (honest-failure-reporting/design.md §2).
 *
 * Algorithm per checked entry (a kadenaSeeds entry with
 * `seedType === "stoic"`, or any arweaveSeeds entry):
 *   1. Empty/undefined `secret` → nothing to migrate; counted in
 *      `result.emptySecret`.
 *   2. Decrypt `secret` with the codex password. A decrypt failure is
 *      routed through the SAME reconciliation path as step 5 below (it is
 *      just another "unresolvable automatically" case) rather than being
 *      recorded directly — this lets a caller-supplied `requestMissingData`
 *      value rescue even an undecryptable entry.
 *   3. Plaintext already matches the current bitstring shape
 *      (`/^[01]+$/`, length 1024 or 1600) → no-op; counted in
 *      `result.alreadyCurrent`.
 *   4. Plaintext passes `validateSeedWords` AND the positive
 *      `seedPhraseShapeReason` test AND its original can be preserved →
 *      this is the legacy-shape bug: preserve the plaintext VERBATIM in
 *      `wordsSecret` (never overwriting an existing one), then encrypt
 *      `seedWordsToBitString(words)` into `secret`. Record the id in
 *      `fixedSeedIds`.
 *   5. Anything step 4 refuses, and no caller-supplied value resolves it →
 *      record a `{ slice, id, reason }` entry in `skipped` carrying the
 *      refusal; the original ciphertext (and any existing `wordsSecret`) is
 *      left completely untouched. Nothing is ever converted on a guess:
 *      `validateSeedWords` alone admits almost any alphanumeric plaintext,
 *      and writing a bitstring derived from a non-phrase over `secret`
 *      destroys the only copy of the real key (design.md §3).
 */

import { smartDecrypt, encryptStringV2 } from "@stoachain/stoa-core/crypto";
import { validateSeedWords, seedWordsToBitString } from "@ouronet/dalos-crypto/gen1";
import type { CodexSnapshot } from "../adapters/types.js";
import { CodexStructuralMigrationError } from "../errors/index.js";

/** The shape version this run of the engine brings every checked snapshot
 *  up to. Stamped onto `result.snapshot.Codex_Shape_Version` on every
 *  completed run (see the postcondition check at the end of
 *  `runStructuralMigration`). */
export const STRUCTURAL_SHAPE_TARGET_VERSION = "1.0.0" as const;

/** Describes exactly which seed/field needs the user's input, handed to an
 *  injected `requestMissingData` callback. */
export interface StructuralMigrationNeedsInput {
  slice: "kadenaSeeds" | "arweaveSeeds";
  id: string;
  reason: string;
}

/** One seed that could not be resolved automatically (and the caller either
 *  declined or was not asked) — kept verbatim, never dropped. */
export interface StructuralMigrationSkip {
  slice: "kadenaSeeds" | "arweaveSeeds";
  id: string;
  reason: string;
}

export interface StructuralMigrationOptions {
  /** Invoked once per unresolvable entry. Resolve to the real seed words
   *  (space-joined) to rescue that entry in the same run; resolve to
   *  `undefined` (or reject) to decline — the entry is then recorded in
   *  `skipped` and the run continues with the rest of the codex. Never
   *  called a second time for the same entry, even if the supplied value
   *  turns out to be invalid. */
  requestMissingData?: (need: StructuralMigrationNeedsInput) => Promise<string | undefined>;
  /** OPTIONAL and purely additive — same backward-compatible contract as
   *  `ChangePasswordCard`'s own `onProgress`
   *  (`packages/codex-ui/src/ui/settings/ChangePasswordCard.tsx`): call it
   *  as many times as you like with a human-readable step string while the
   *  run proceeds; omitting it changes no other return value. Called at
   *  least once per checked entry (every `kadenaSeeds` entry with
   *  `seedType === "stoic"`, every `arweaveSeeds` entry) as that entry is
   *  checked/resolved, so a caller can show live progress through a
   *  multi-seed run instead of a single static "please wait". */
  onProgress?: (step: string) => void;
}

export interface StructuralMigrationResult {
  snapshot: CodexSnapshot;
  fixedSeedIds: string[];
  skipped: StructuralMigrationSkip[];
  /** How many entries this engine was RESPONSIBLE for and actually walked
   *  (stoic `kadenaSeeds` entries + every `arweaveSeeds` entry). `0` means
   *  "this run examined nothing", which is a completely different statement
   *  from "everything was already fine" — before these counters existed both
   *  reached the UI as the single line `Fixed 0 seeds.`
   *  (honest-failure-reporting/design.md §2).
   *
   *  Accounting invariant, enforced over every walked entry:
   *  `examined === fixedSeedIds.length + skipped.length + alreadyCurrent +
   *  emptySecret`. */
  examined: number;
  /** Of `examined`, how many already held the current 1024/1600-char
   *  bitstring (step 3's no-op). */
  alreadyCurrent: number;
  /** Of `examined`, how many had an empty/absent `secret` — nothing to
   *  migrate (step 1's no-op), which is NOT the same as already-current. */
  emptySecret: number;
  /** Entries deliberately NOT walked: non-stoic `kadenaSeeds` entries, whose
   *  `secret` already IS the real mnemonic. Never examined, never fixed,
   *  never skipped — and, until these counters existed, invisible. */
  notEligible: number;
}

/** A locator for one checked seed's `secret`/`wordsSecret` pair — read it,
 *  write it back. Mirrors `rekey/index.ts`'s own `SecretRef` shape. */
interface StructuralSeedRef {
  slice: "kadenaSeeds" | "arweaveSeeds";
  id: string;
  readSecret(): string | undefined;
  writeSecret(value: string): void;
  readWordsSecret(): string | undefined;
  writeWordsSecret(value: string): void;
}

/**
 * Walk every entry this engine is responsible for: `kadenaSeeds` entries
 * with `seedType === "stoic"` only (other seed types' `secret` already IS
 * the real mnemonic — no shape drift there), and EVERY `arweaveSeeds` entry
 * (that type has no `seedType` field at all; every entry uses the
 * bitstring convention).
 */
function* iterateStructuralSeedRefs(snapshot: CodexSnapshot): Generator<StructuralSeedRef> {
  for (const s of snapshot.kadenaSeeds ?? []) {
    if (s.seedType !== "stoic") continue;
    yield {
      slice: "kadenaSeeds",
      id: s.id,
      readSecret: () => s.secret,
      writeSecret: (v) => { s.secret = v; },
      readWordsSecret: () => s.wordsSecret,
      writeWordsSecret: (v) => { s.wordsSecret = v; },
    };
  }
  for (const a of snapshot.arweaveSeeds ?? []) {
    yield {
      slice: "arweaveSeeds",
      id: a.id,
      readSecret: () => a.secret,
      writeSecret: (v) => { a.secret = v; },
      readWordsSecret: () => a.wordsSecret,
      writeWordsSecret: (v) => { a.wordsSecret = v; },
    };
  }
}

const CURRENT_BITSTRING_RE = /^[01]+$/;

/** Step 3's shape test: already the current 1024/1600-char DALOS bitstring. */
function isCurrentBitstring(plaintext: string): boolean {
  return (plaintext.length === 1024 || plaintext.length === 1600) && CURRENT_BITSTRING_RE.test(plaintext);
}

/** Space-separated plaintext → the word array `validateSeedWords`/
 *  `seedWordsToBitString` expect. */
function toWords(plaintext: string): string[] {
  return plaintext.trim().split(/\s+/).filter(Boolean);
}

/** Token-count bounds for the §3 positive phrase-shape test. Calibrated on
 *  the only two genuine DALOS phrases this project can point at:
 *  the owner's real exported codex (24 tokens / 154 chars, measured in
 *  honest-failure-reporting/design.md) and this repo's own long-standing
 *  24-token test fixture (144 chars). Every phrase-producing surface in the
 *  codebase emits exactly 12 or 24 tokens
 *  (`StoaChainWalletBuilder.generateMnemonic(12|24)`,
 *  `CreateStoaChainSeedModal`'s `option.words`, `ArweaveSeedsArea`'s
 *  `RestrictedWordCount`), so 12 is a hard floor — below it, an alphanumeric
 *  plaintext is prose, not a phrase. The ceiling is 2x the largest observed
 *  count: generous headroom for a hand-written DALOS phrase without
 *  approaching `validateSeedWords`' own 256-token limit, at which point
 *  "tokens of runes" and "a paragraph of text" are indistinguishable. */
export const SEED_PHRASE_MIN_TOKENS = 12;
export const SEED_PHRASE_MAX_TOKENS = 48;

/** Per-token glyph bounds. The BIP39 English wordlist — the single wordlist
 *  every phrase-producing surface here draws from — is 2048 words, each 3-8
 *  characters, all lowercase `a-z`; both measured real phrases above sit
 *  inside that envelope exactly. `validateSeedWords` instead admits 1-256
 *  glyphs out of a 256-glyph set that includes all of `[0-9A-Za-z]`, which
 *  is why it cannot tell a phrase from a sentence or a password. */
export const SEED_PHRASE_MIN_TOKEN_GLYPHS = 3;
export const SEED_PHRASE_MAX_TOKEN_GLYPHS = 8;

const SEED_PHRASE_TOKEN_RE = /^[a-z]+$/;

/**
 * The §3 POSITIVE phrase-shape test: `null` when `words` genuinely looks
 * like a DALOS seed phrase, a human-readable reason otherwise.
 *
 * Deliberately stricter than `validateSeedWords`, and deliberately
 * asymmetric in its failure cost. A false NEGATIVE (a real but unusually
 * shaped phrase refused here) costs the user one prompt: the entry is routed
 * through `requestMissingData`, its original ciphertext kept verbatim, and
 * the upgrade stays on offer. A false POSITIVE converts a non-phrase
 * plaintext into a well-formed but WRONG key and writes it over the only
 * copy of the real one. The second is irreversible, so this test refuses
 * anything it cannot positively recognise.
 */
export function seedPhraseShapeReason(words: readonly string[]): string | null {
  if (words.length < SEED_PHRASE_MIN_TOKENS || words.length > SEED_PHRASE_MAX_TOKENS) {
    return (
      `expected a seed phrase of ${SEED_PHRASE_MIN_TOKENS}-${SEED_PHRASE_MAX_TOKENS} words, ` +
      `got ${words.length} — this does not look like a seed phrase`
    );
  }
  for (let i = 0; i < words.length; i++) {
    const word = words[i] ?? "";
    const glyphs = Array.from(word);
    if (
      glyphs.length < SEED_PHRASE_MIN_TOKEN_GLYPHS ||
      glyphs.length > SEED_PHRASE_MAX_TOKEN_GLYPHS ||
      !SEED_PHRASE_TOKEN_RE.test(word)
    ) {
      return (
        `word ${i + 1} (${JSON.stringify(word)}) is not ${SEED_PHRASE_MIN_TOKEN_GLYPHS}-` +
        `${SEED_PHRASE_MAX_TOKEN_GLYPHS} lowercase letters — this does not look like a seed phrase`
      );
    }
  }
  return null;
}

/** `null` when `words` is a valid DALOS seed-word list, a human-readable
 *  reason string otherwise. Thin wrapper over `validateSeedWords`, which
 *  throws rather than returning a sentinel. */
function invalidWordsReason(words: readonly string[]): string | null {
  try {
    validateSeedWords(words);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "Invalid seed words.";
  }
}

/**
 * The ONE write path: `null` when the fix was applied, a human-readable
 * refusal reason when it was not (in which case NOTHING was written).
 *
 * `plaintext` is the exact string the fix is derived FROM — step 4's
 * decrypted `secret`, or step 5's caller-supplied words. It is preserved
 * VERBATIM in `wordsSecret` before `secret` is overwritten, so the original
 * survives the conversion byte-for-byte rather than as a re-join of its
 * parsed tokens.
 *
 * Three gates, in order, all of them before the first write
 * (honest-failure-reporting/design.md §3 — "DATA LOSS RISK"):
 *   1. `validateSeedWords` — the DALOS library contract.
 *   2. `seedPhraseShapeReason` — the positive phrase-shape test. Without it
 *      almost any alphanumeric plaintext was converted into a well-formed
 *      but WRONG key and written over the only copy of the real one.
 *   3. Preserve-or-refuse. An existing `wordsSecret` is never clobbered, so
 *      when it holds something OTHER than `plaintext` there is nowhere to
 *      keep the original and the entry is refused instead of overwritten.
 *
 * Same password throughout — this is a shape fix, not a password rotation.
 */
async function tryApplyWordsFix(
  ref: StructuralSeedRef,
  plaintext: string,
  password: string,
): Promise<string | null> {
  const words = toWords(plaintext);

  const libraryReason = invalidWordsReason(words);
  if (libraryReason !== null) return libraryReason;

  const shapeReason = seedPhraseShapeReason(words);
  if (shapeReason !== null) return shapeReason;

  const existingWordsSecret = ref.readWordsSecret();
  if (existingWordsSecret) {
    let existingPlaintext: string;
    try {
      existingPlaintext = await smartDecrypt(existingWordsSecret, password);
    } catch (err) {
      return (
        "this seed already carries a wordsSecret that cannot be read " +
        `(${err instanceof Error ? err.message : String(err)}), so the original words ` +
        "could not be confirmed preserved — secret left untouched"
      );
    }
    if (toWords(existingPlaintext).join(" ") !== words.join(" ")) {
      return (
        "this seed already carries a wordsSecret holding DIFFERENT words; overwriting " +
        "secret would destroy one of the two — secret left untouched"
      );
    }
  } else {
    ref.writeWordsSecret(await encryptStringV2(plaintext, password));
  }

  ref.writeSecret(await encryptStringV2(seedWordsToBitString(words), password));
  return null;
}

/**
 * Step 5's reconciliation: an entry this engine cannot resolve on its own
 * (decrypt failure, or plaintext that is neither bitstring- nor
 * words-shaped). Gives the caller's `requestMissingData` exactly one shot
 * at rescuing it; records a skip otherwise. Never throws — any rejection
 * from `requestMissingData` is treated as a decline.
 */
async function resolveUnresolvable(
  ref: StructuralSeedRef,
  need: StructuralMigrationNeedsInput,
  password: string,
  options: StructuralMigrationOptions | undefined,
  fixedSeedIds: string[],
  skipped: StructuralMigrationSkip[],
): Promise<void> {
  let refusal: string | null = null;
  if (options?.requestMissingData) {
    let supplied: string | undefined;
    try {
      supplied = await options.requestMissingData(need);
    } catch {
      supplied = undefined;
    }
    if (supplied) {
      refusal = await tryApplyWordsFix(ref, supplied, password);
      if (refusal === null) {
        fixedSeedIds.push(ref.id);
        return;
      }
    }
  }
  // A refused rescue says WHY it was refused rather than repeating only the
  // original complaint — the user typed something and is entitled to know it
  // was not used, and what the engine made of it.
  skipped.push({
    slice: need.slice,
    id: need.id,
    reason: refusal === null ? need.reason : `${need.reason}; the words supplied were not used: ${refusal}`,
  });
}

/**
 * Walk every stoic `kadenaSeeds` entry and every `arweaveSeeds` entry in
 * `snapshot`, fixing any whose `secret` holds raw DALOS words instead of
 * the pre-converted bitstring. Pure: returns a NEW snapshot; the input is
 * never mutated, even on a mid-way throw.
 *
 * @throws {CodexStructuralMigrationError} with reason `"post-condition-
 *   failed"` if the completed run's output snapshot does not carry
 *   `STRUCTURAL_SHAPE_TARGET_VERSION` — unreachable by construction, a
 *   loud guard against a future refactor silently breaking the stamp.
 */
export async function runStructuralMigration(
  snapshot: CodexSnapshot,
  password: string,
  options?: StructuralMigrationOptions,
): Promise<StructuralMigrationResult> {
  // Work on a deep clone so the caller's snapshot is never touched, even on
  // a mid-way throw. structuredClone is isomorphic (Node 17+ / browsers) and
  // the snapshot is pure data.
  const next = structuredClone(snapshot);
  const fixedSeedIds: string[] = [];
  const skipped: StructuralMigrationSkip[] = [];
  // Every walked entry increments exactly one of these, so "examined
  // nothing" and "everything was already fine" are no longer the same
  // answer (design.md §2).
  let examined = 0;
  let alreadyCurrent = 0;
  let emptySecret = 0;
  const notEligible = (next.kadenaSeeds ?? []).filter((s) => s.seedType !== "stoic").length;

  for (const ref of iterateStructuralSeedRefs(next)) {
    examined += 1;
    options?.onProgress?.(`Checking ${ref.slice} seed ${ref.id}…`);

    const ciphertext = ref.readSecret();
    if (!ciphertext) {
      emptySecret += 1;
      options?.onProgress?.(`Seed ${ref.id} has nothing to migrate, skipping.`);
      continue; // step 1: nothing to migrate
    }

    let plaintext: string;
    try {
      plaintext = await smartDecrypt(ciphertext, password);
    } catch (err) {
      // step 2: a decrypt failure is just another "unresolvable
      // automatically" case — route it through the same reconciliation
      // path step 5 uses, so a caller-supplied value can still rescue it.
      await resolveUnresolvable(
        ref,
        { slice: ref.slice, id: ref.id, reason: err instanceof Error ? err.message : String(err) },
        password,
        options,
        fixedSeedIds,
        skipped,
      );
      options?.onProgress?.(`Seed ${ref.id} resolved: ${fixedSeedIds.includes(ref.id) ? "fixed" : "skipped"}.`);
      continue;
    }

    if (isCurrentBitstring(plaintext)) {
      alreadyCurrent += 1;
      options?.onProgress?.(`Seed ${ref.id} is already the current shape.`);
      continue; // step 3: already current shape
    }

    // step 4: try the legacy-shape fix. `tryApplyWordsFix` writes NOTHING
    // unless the plaintext passes the DALOS contract AND the positive
    // phrase-shape test AND the original can be preserved; anything it
    // refuses routes through step 5 instead of being converted, so the
    // original ciphertext is never destroyed on a guess.
    const refusal = await tryApplyWordsFix(ref, plaintext, password);
    if (refusal === null) {
      fixedSeedIds.push(ref.id);
      options?.onProgress?.(`Fixed seed ${ref.id}.`);
      continue;
    }

    // step 5: decrypted fine, but not something this engine may convert.
    await resolveUnresolvable(
      ref,
      {
        slice: ref.slice,
        id: ref.id,
        reason: `decrypted value was not converted: ${refusal}`,
      },
      password,
      options,
      fixedSeedIds,
      skipped,
    );
    options?.onProgress?.(`Seed ${ref.id} resolved: ${fixedSeedIds.includes(ref.id) ? "fixed" : "skipped"}.`);
  }

  // The stamp is a CLAIM, not a formality: it is the single value
  // `useNeedsStructuralUpgrade` reads to decide whether `CodexIdPage` keeps
  // offering "Upgrade Codex Now" or settles on "✓ Versioned" forever. It may
  // therefore only be made when nothing was left unresolved. An INHERITED
  // stamp is cleared for the same reason — the same discipline
  // `LocalStorageCodexAdapter`'s `codex_shape_version` shard already states
  // for itself ("absent -> removeItem … leaving a stale claim over freshly-
  // written legacy-shaped data would mark unmigrated data as migrated").
  if (skipped.length === 0) {
    next.Codex_Shape_Version = STRUCTURAL_SHAPE_TARGET_VERSION;
  } else {
    delete next.Codex_Shape_Version;
  }

  // The real postcondition: the stamp on the output snapshot and the skip
  // list must agree. Two INDEPENDENTLY derived quantities — unlike the
  // previous check, which compared the field to the literal assigned on the
  // line above and so could never fire whatever the engine did.
  const stamped = next.Codex_Shape_Version === STRUCTURAL_SHAPE_TARGET_VERSION;
  if (stamped !== (skipped.length === 0)) {
    throw new CodexStructuralMigrationError(
      "post-condition-failed",
      `Codex_Shape_Version is "${String(next.Codex_Shape_Version)}" while ${skipped.length} ` +
        `seed(s) were skipped — a completion stamp may only be made when nothing was skipped.`,
    );
  }

  return { snapshot: next, fixedSeedIds, skipped, examined, alreadyCurrent, emptySecret, notEligible };
}
