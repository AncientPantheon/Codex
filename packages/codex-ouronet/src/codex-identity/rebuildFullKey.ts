/**
 * `rebuildFullKey` — re-derive a DALOS-family `FullKey` from the decrypted
 * plaintext of an Ouronet account's `secret`, its origin mode and its curve.
 *
 * Lifted verbatim out of `src/ui/internal/DalosSecretReveal.tsx` (which still
 * owns the tabbed reveal UI and now imports this helper). It is reusable
 * because the Arweave seed flow needs the SAME re-derivation to obtain an
 * account's 1600-bit DALOS bitstring — the single input to the deterministic
 * RSA-4096 search — without decrypting through the reveal modal.
 *
 * APOLLO (₱./Π.) accounts re-derive on the 1024-bit curve (32×32 bitmap);
 * DALOS Genesis (Ѻ./Σ.) on 1600 bits (40×40). The registry is built per call
 * (`createDefaultRegistry` + `register(Apollo)` when the curve is apollo) —
 * the same construction OuronetUI's `getOuronetRegistry` uses.
 *
 * Returns `null` (never throws) when the plaintext cannot be parsed under the
 * given mode, so callers can render an error state instead of unmounting.
 *
 * TWO SURFACES, ONE DERIVATION (honest-failure-reporting §4):
 *
 *  - `rebuildFullKey` keeps the `FullKey | null` contract every existing
 *    consumer reads (`bitStringOf` → `seedDashboard.ts`, codex-arweave's
 *    `LibraryArea` / `ArweaveSeedsArea`, the playground's Arweave adapter).
 *  - `rebuildFullKeyWithReason` returns the SAME key, or a typed
 *    {@link RebuildFailure} saying what the stored value actually looks like.
 *    The old `null` discarded a precisely-typed `InvalidBitStringError` whose
 *    message already read "invalid bitstring (length 153, expected 1600) ...
 *    non-binary character "b" at position 0", and the reveal could only print
 *    "Could not derive bitstring." — a dead end. The real case is ordinary: a
 *    `stoic` seed whose `secret` still holds its word phrase while
 *    `wordsSecret` is absent (the pre-repair state), so words are routed
 *    through the bitstring path.
 *
 * NOTHING HERE CONVERTS ANYTHING. Detecting that a stored secret is a word
 * phrase is NOT licence to rewrite it as a bitstring: the reveal is a
 * read-only view, and an over-eager conversion can overwrite the only copy of
 * a key. Converting belongs to the structural repair engine alone; this module
 * measures, reports, and points at that repair.
 */

import {
  Apollo,
  createDefaultRegistry,
  createOuronetAccount,
  parseAsciiBitmap,
  type CreateAccountOptions,
  type FullKey,
} from "@stoachain/stoa-core/dalos";
import type { IOuroAccount, OuroOriginMode, OuronetOriginCurve } from "../types/entities.js";

// ---------------------------------------------------------------------------
// What the stored value actually looks like
// ---------------------------------------------------------------------------

/** The measured shape of a decrypted `secret` plaintext — what it IS, read
 *  independently of the `originMode` it was stored under. `length` is always
 *  the TRIMMED character count, so stored whitespace never inflates a number
 *  shown to a user. */
export type SecretShape =
  | { kind: "empty"; length: number }
  | { kind: "binary"; length: number }
  | { kind: "digits"; length: number }
  | { kind: "bitmapRows"; rows: number; length: number }
  | { kind: "words"; tokens: number; length: number }
  | { kind: "unknown"; length: number };

/** A DALOS rune token: the format's alphabet is `[0-9A-Za-z]` plus accented
 *  glyphs, but a positive word-shape test only needs the plain-Latin core to
 *  recognise a stored phrase. */
const WORD_TOKEN = /^[0-9A-Za-z]+$/;

/** Measure a decrypted plaintext. Deliberately conservative: anything that
 *  matches nothing comes back `"unknown"` with its length rather than being
 *  guessed into a category — a wrong guess in a diagnostic is worse than
 *  "neither binary nor seed words". */
export function describeSecretShape(plaintext: string): SecretShape {
  const value = plaintext.trim();
  const length = value.length;
  if (length === 0) return { kind: "empty", length: 0 };
  if (/^[01]+$/.test(value)) return { kind: "binary", length };
  if (/^[0-9]+$/.test(value)) return { kind: "digits", length };
  // The bitmap modes serialise as comma-separated rows (`parseAsciiBitmap`'s
  // own input), so a comma is the one unambiguous marker available.
  if (value.includes(",")) return { kind: "bitmapRows", rows: value.split(",").length, length };
  const tokens = value.split(/\s+/);
  // Two or more rune tokens is the positive word-shape test. A SINGLE token
  // is not called "words": a base-49 integer is also one run of runes.
  if (tokens.length >= 2 && tokens.every((t) => WORD_TOKEN.test(t))) {
    return { kind: "words", tokens: tokens.length, length };
  }
  return { kind: "unknown", length };
}

// ---------------------------------------------------------------------------
// The typed failure
// ---------------------------------------------------------------------------

/** Why a re-derivation did not produce a key.
 *
 *  - `empty` — there is nothing stored to read.
 *  - `shapeMismatch` — the stored value is a different KIND of thing than the
 *    mode asks for (the owner's case: 24 words in the bitstring slot). A
 *    repair can fix this.
 *  - `rejected` — the value has the right shape and the DALOS private-key
 *    check still refused it. A repair cannot fix this, so none is offered. */
export type RebuildFailureCode = "empty" | "shapeMismatch" | "rejected";

export interface RebuildFailure {
  code: RebuildFailureCode;
  /** The measured shape of the stored plaintext. */
  shape: SecretShape;
  /** The mode the plaintext was read under. */
  attemptedMode: OuroOriginMode;
  /** One sentence for a person: what the stored value looks like, what was
   *  expected, and — only when a repair actually applies — which repair. */
  message: string;
  /** `name: message` of the underlying thrown error, kept for logs and bug
   *  reports. Absent when nothing was thrown (an empty secret). NOT for
   *  display: a crypto library's internal string is not a user sentence. */
  cause?: string;
}

export type RebuildOutcome =
  | { ok: true; key: FullKey }
  | { ok: false; failure: RebuildFailure };

/** Bits on the curve: 1600 on DALOS Genesis (40×40), 1024 on APOLLO (32×32). */
function bitsOf(curve: OuronetOriginCurve): number {
  return curve === "apollo" ? 1024 : 1600;
}

/** What the mode asks the stored value to be, as a noun phrase. */
function expectationOf(mode: OuroOriginMode, curve: OuronetOriginCurve): string {
  switch (mode) {
    case "bitString": return `a ${bitsOf(curve)}-bit bitstring`;
    case "bitmap": return curve === "apollo" ? "a 32×32 bitmap" : "a 40×40 bitmap";
    case "integerBase10": return "a base-10 integer";
    case "integerBase49": return "a base-49 integer";
    default: return "seed words";
  }
}

/** The measured shape as a noun phrase, never starting with an article so it
 *  reads correctly after any number. */
function shapeOf(shape: SecretShape): string {
  switch (shape.kind) {
    case "empty": return "empty";
    case "binary": return `${shape.length} characters of binary (0 and 1)`;
    case "digits": return `${shape.length} digits`;
    case "bitmapRows": return `${shape.rows} comma-separated bitmap rows (${shape.length} characters)`;
    case "words": return `${shape.tokens} seed words (${shape.length} characters)`;
    case "unknown": return `${shape.length} characters that are neither binary nor seed words`;
  }
}

/** Could the mode read a value of this shape at all? False means the failure
 *  is structural (a different kind of thing), not a key-validation refusal. */
function shapeFitsMode(shape: SecretShape, mode: OuroOriginMode, curve: OuronetOriginCurve): boolean {
  if (shape.kind === "empty") return false;
  switch (mode) {
    case "bitString": return shape.kind === "binary" && shape.length === bitsOf(curve);
    case "bitmap": return shape.kind === "bitmapRows" || shape.kind === "binary";
    case "integerBase10": return shape.kind === "digits" || shape.kind === "binary";
    // A base-49 integer is ONE run of DALOS runes, which `describeSecretShape`
    // reports as `unknown` (it refuses to call a single token "words").
    case "integerBase49": return shape.kind === "unknown" || shape.kind === "digits" || shape.kind === "binary";
    default: return true;
  }
}

/** The structural repair that fixes a word phrase sitting in a non-words slot
 *  — and ONLY that. Named after the button that runs it. */
const REPAIR_HINT = 'Run "Upgrade Codex Now" on the Codex ID page to repair this seed.';

function failureMessage(code: RebuildFailureCode, shape: SecretShape, mode: OuroOriginMode, curve: OuronetOriginCurve): string {
  if (code === "empty") return "This seed's stored secret is empty — there is nothing to reveal.";
  if (code === "rejected") {
    return `This seed's stored secret has the right shape for ${expectationOf(mode, curve)} (${shapeOf(shape)}), but the DALOS key check refused it as a private key.`;
  }
  const head = `This seed's stored secret is not ${expectationOf(mode, curve)} — it looks like ${shapeOf(shape)}.`;
  return shape.kind === "words" && mode !== "seedWords" ? `${head} ${REPAIR_HINT}` : head;
}

// ---------------------------------------------------------------------------
// The derivation
// ---------------------------------------------------------------------------

/** Mode → `createOuronetAccount` options. The single place the per-mode
 *  parsing lives; both public surfaces go through it. */
function accountOptions(plaintext: string, originMode: OuroOriginMode, originCurve: OuronetOriginCurve, primitiveId: string): CreateAccountOptions {
  switch (originMode) {
    case "bitmap": {
      const lines = plaintext.split(",");
      if (originCurve === "apollo") {
        let bits = "";
        for (const row of lines) for (const ch of row) bits += (ch === "#" || ch === "1") ? "1" : "0";
        return { mode: "bitString", data: bits, primitiveId };
      }
      return { mode: "bitmap", data: parseAsciiBitmap(lines), primitiveId };
    }
    case "bitString": return { mode: "bitString", data: plaintext, primitiveId };
    case "integerBase10": return { mode: "integerBase10", data: plaintext, primitiveId };
    case "integerBase49": return { mode: "integerBase49", data: plaintext, primitiveId };
    // `seedWords` and any account written before `originMode` existed.
    default: return { mode: "seedWords", data: plaintext.trim().split(/\s+/).filter(Boolean), primitiveId };
  }
}

/** Re-derive the key, or say — in one sentence a person can act on — what the
 *  stored value actually is. See this module's header for why the `null`
 *  surface below is kept alongside this one, and why neither converts. */
export function rebuildFullKeyWithReason(plaintext: string, originMode: OuroOriginMode, originCurve: OuronetOriginCurve): RebuildOutcome {
  const shape = describeSecretShape(plaintext);
  const fail = (code: RebuildFailureCode, cause?: string): RebuildOutcome => ({
    ok: false,
    failure: { code, shape, attemptedMode: originMode, message: failureMessage(code, shape, originMode, originCurve), ...(cause === undefined ? {} : { cause }) },
  });

  if (shape.kind === "empty") return fail("empty");

  try {
    const primitiveId = originCurve === "apollo" ? "dalos-apollo" : "dalos-gen-1";
    const registry = createDefaultRegistry();
    if (originCurve === "apollo") registry.register(Apollo);
    return { ok: true, key: createOuronetAccount(registry, accountOptions(plaintext, originMode, originCurve, primitiveId)) };
  } catch (err) {
    // Still logged: the library's own diagnostic is the best forensic record
    // there is. It is no longer the ONLY record — `cause` carries it back to
    // the caller, and `message` carries the part a user can act on.
    console.error("rebuildFullKey failed:", err);
    const cause = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    return fail(shapeFitsMode(shape, originMode, originCurve) ? "rejected" : "shapeMismatch", cause);
  }
}

export function rebuildFullKey(plaintext: string, originMode: OuroOriginMode, originCurve: OuronetOriginCurve): FullKey | null {
  const outcome = rebuildFullKeyWithReason(plaintext, originMode, originCurve);
  return outcome.ok ? outcome.key : null;
}

/** The minimum an account must carry for `bitStringOf` to re-derive it.
 *  Structurally satisfied by `IOuroAccount`. */
export type BitStringAccount = Pick<IOuroAccount, "address"> &
  Partial<Pick<IOuroAccount, "originMode" | "originCurve">>;

/** DALOS Genesis address prefixes — standard (Ѻ.) and smart (Σ.). Everything
 *  else in the family is APOLLO (₱. / Π.). */
const DALOS_ADDRESS_PREFIXES = ["Ѻ.", "Σ."] as const;

/** Resolve an account's curve: the recorded `originCurve` when present, else
 *  inferred from the address prefix (`originCurve` is optional on
 *  `IOuroAccount`, so accounts written before it existed have none). */
export function curveOf(account: BitStringAccount): OuronetOriginCurve {
  if (account.originCurve) return account.originCurve;
  return DALOS_ADDRESS_PREFIXES.some((p) => account.address.startsWith(p)) ? "dalos" : "apollo";
}

/** The account's private-key bitstring (1600 bits on DALOS Genesis, 1024 on
 *  APOLLO), re-derived from its decrypted `secret` plaintext. `null` when the
 *  plaintext cannot be rebuilt. */
export function bitStringOf(account: BitStringAccount, plaintext: string): string | null {
  const full = rebuildFullKey(plaintext, account.originMode ?? "seedWords", curveOf(account));
  return full ? full.privateKey.bitString : null;
}
