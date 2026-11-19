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
 *   - On full completion, stamps `Codex_Shape_Version` to the current
 *     target value, enforced as a postcondition exactly like
 *     `applyMigrations` (`src/state/migrations.ts`) already enforces
 *     `schemaVersion` — a run that doesn't reach the declared target fails
 *     loudly, never silently.
 *
 * Algorithm per checked entry (a kadenaSeeds entry with
 * `seedType === "stoic"`, or any arweaveSeeds entry):
 *   1. Empty/undefined `secret` → skip silently (nothing to migrate).
 *   2. Decrypt `secret` with the codex password. A decrypt failure is
 *      routed through the SAME reconciliation path as step 5 below (it is
 *      just another "unresolvable automatically" case) rather than being
 *      recorded directly — this lets a caller-supplied `requestMissingData`
 *      value rescue even an undecryptable entry.
 *   3. Plaintext already matches the current bitstring shape
 *      (`/^[01]+$/`, length 1024 or 1600) → no-op; not counted anywhere.
 *   4. Plaintext is a valid DALOS word list (`validateSeedWords` does not
 *      throw) → this is the legacy-shape bug: encrypt the original words
 *      into `wordsSecret` (only if not already set — never overwrite real
 *      data), then encrypt `seedWordsToBitString(words)` into `secret`.
 *      Record the id in `fixedSeedIds`.
 *   5. Neither shape, and no caller-supplied value resolves it → record a
 *      `{ slice, id, reason }` entry in `skipped`; the original ciphertext
 *      (and any existing `wordsSecret`) is left completely untouched.
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

/** Step 4's fix: encrypt the original words into `wordsSecret` (unless one
 *  is already set), then encrypt the derived bitstring into `secret`. Same
 *  password both times — this is a shape fix, not a password rotation. */
async function applyWordsFix(ref: StructuralSeedRef, words: readonly string[], password: string): Promise<void> {
  if (!ref.readWordsSecret()) {
    ref.writeWordsSecret(await encryptStringV2(words.join(" "), password));
  }
  ref.writeSecret(await encryptStringV2(seedWordsToBitString(words), password));
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
  if (options?.requestMissingData) {
    let supplied: string | undefined;
    try {
      supplied = await options.requestMissingData(need);
    } catch {
      supplied = undefined;
    }
    if (supplied) {
      const words = toWords(supplied);
      if (invalidWordsReason(words) === null) {
        await applyWordsFix(ref, words, password);
        fixedSeedIds.push(ref.id);
        return;
      }
    }
  }
  skipped.push({ slice: need.slice, id: need.id, reason: need.reason });
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

  for (const ref of iterateStructuralSeedRefs(next)) {
    options?.onProgress?.(`Checking ${ref.slice} seed ${ref.id}…`);

    const ciphertext = ref.readSecret();
    if (!ciphertext) {
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
      options?.onProgress?.(`Seed ${ref.id} is already the current shape.`);
      continue; // step 3: already current shape
    }

    const words = toWords(plaintext);
    if (invalidWordsReason(words) === null) {
      // step 4: legacy-shape bug confirmed — fix it.
      await applyWordsFix(ref, words, password);
      fixedSeedIds.push(ref.id);
      options?.onProgress?.(`Fixed seed ${ref.id}.`);
      continue;
    }

    // step 5: decrypted fine, but neither a bitstring nor valid DALOS words.
    await resolveUnresolvable(
      ref,
      {
        slice: ref.slice,
        id: ref.id,
        reason: "decrypted value is neither a valid bitstring nor a valid DALOS word list",
      },
      password,
      options,
      fixedSeedIds,
      skipped,
    );
    options?.onProgress?.(`Seed ${ref.id} resolved: ${fixedSeedIds.includes(ref.id) ? "fixed" : "skipped"}.`);
  }

  next.Codex_Shape_Version = STRUCTURAL_SHAPE_TARGET_VERSION;
  if (next.Codex_Shape_Version !== STRUCTURAL_SHAPE_TARGET_VERSION) {
    throw new CodexStructuralMigrationError(
      "post-condition-failed",
      `Expected Codex_Shape_Version "${STRUCTURAL_SHAPE_TARGET_VERSION}" after a completed run, got "${String(next.Codex_Shape_Version)}".`,
    );
  }

  return { snapshot: next, fixedSeedIds, skipped };
}
