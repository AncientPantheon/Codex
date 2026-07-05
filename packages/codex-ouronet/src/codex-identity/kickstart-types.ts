/**
 * v0.3 `kickstartCodex` input/output shapes + a pure runtime validator.
 *
 * The v0.3 kickstart drives a three-question flow (design doc §4.2):
 *   1. `codexIdSeed`     — the seed the double-Apollo Codex Identity derives from
 *   2. `codexPrimeSeed`  — how the CodexPrime Standard Ouronet account is seeded
 *   3. `duoPrime`        — how CodexPrime is backed by two StoaChain keys
 *
 * The legacy v0.2 `KickstartArgs` (`{ seed, primeOuroAccount }`) stays defined
 * in `src/state/store.ts`; the action dispatches between the two shapes at
 * runtime. These v0.3 types are the new surface.
 */

import type {
  ICodexIdentity,
  IPureKeypair,
  IOuroAccount,
  IKadenaSeed,
} from "../types/entities.js";
import { CodexKickstartError } from "../errors/types.js";

/** The five seed encodings the Codex Identity can be derived from. */
export type CodexIdSeedMode = "words" | "bitstring" | "bitmap" | "base10" | "base49";

/** Step 1 — Codex Identity seed material. */
export interface CodexIdSeedInput {
  /** Encoding of `value`. */
  mode: CodexIdSeedMode;
  /** Encoded seed per `mode`:
   *    words      → space-separated UTF-8 string (2..512 words, 1..256 glyphs each)
   *    bitstring  → "0"/"1" string, length 2048 (split in half at bit 1024)
   *    bitmap     → 32-row × 64-column '#'/'.' grid string
   *    base10     → decimal string
   *    base49     → base-49 string in Apollo's natural charset */
  value: string;
  // `wordCount` (F-011): REMOVED — it was redundant with `value.split(/\s+/).length`
  // and would invite drift between the user-supplied value and the computed count.
  // The word count is computed at runtime inside the validator / kickstart action.
  /** Override the split point. Only meaningful when `mode === "words"`; the
   *  validator rejects it for other modes (F-010 — for bitstring/bitmap/base10/
   *  base49 the split is fixed at bit 1024). */
  splitIndex?: number;
}

/** Step 2 — how the CodexPrime Standard Ouronet account is seeded. */
export type CodexPrimeSeedSource =
  | { source: "reuse-codexid-whole" } // valid only if codexIdSeed wordCount ≤ 256 (checked in the action)
  | { source: "reuse-codexid-standard" } // re-derive from the first half of codexIdSeed
  | { source: "reuse-codexid-smart" } // re-derive from the second half of codexIdSeed
  | { source: "fresh-dalos"; words: string }; // fresh DALOS-default seed

/** Step 3 — how CodexPrime is backed by two StoaChain keys. */
export type DuoPrimeMode =
  | { mode: "kadena-seed"; seedType: "koala" | "chainweaver" | "eckowallet"; mnemonic: string }
  | { mode: "auto-pure-keys" };

/** v0.3 KickstartArgs — the three mandatory question groups plus optional audit. */
export interface KickstartArgsV3 {
  codexIdSeed: CodexIdSeedInput;
  codexPrimeSeed: CodexPrimeSeedSource;
  duoPrime: DuoPrimeMode;
  /** Mnemosyne account username that initiated the kickstart. Stored on
   *  `ICodexIdentity.createdBy` for audit; never used for authorization. */
  createdByUsername?: string;
}

/** v0.3 KickstartResult — every entity the atomic kickstart produced. */
export interface KickstartResultV3 {
  /** Generated double-Apollo identity, fully cached + stored. */
  codexIdentity: ICodexIdentity;
  /** Generated CodexGuard pure keypair (first pure key, `isCodexGuard: true`). */
  codexGuard: IPureKeypair;
  /** The CodexPrime Standard Ouronet account (`isPrime: true`). */
  codexPrime: IOuroAccount;
  /** Present iff `duoPrime.mode === "kadena-seed"`. */
  primeCodexSeed?: IKadenaSeed;
  /** Present iff `duoPrime.mode === "auto-pure-keys"` — the two pure keypairs
   *  backing CodexPrime (`isDuoPurePrime: true`, payment + guard roles). */
  duoPurePrime?: [IPureKeypair, IPureKeypair];
  /** Present iff `codexPrimeSeed.source === "fresh-dalos"` — the fresh DALOS
   *  seed generated for CodexPrime, persisted non-prime for future recovery. */
  primeOuroAccountSeed?: IKadenaSeed;
}

const SEED_MODES: ReadonlySet<string> = new Set<CodexIdSeedMode>([
  "words",
  "bitstring",
  "bitmap",
  "base10",
  "base49",
]);
const PRIME_SOURCES: ReadonlySet<string> = new Set<CodexPrimeSeedSource["source"]>([
  "reuse-codexid-whole",
  "reuse-codexid-standard",
  "reuse-codexid-smart",
  "fresh-dalos",
]);
const SEED_TYPES: ReadonlySet<string> = new Set(["koala", "chainweaver", "eckowallet"]);

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

function fail(detail: string): never {
  throw new CodexKickstartError("invalid-args", detail);
}

/**
 * Pure runtime validator — narrows `unknown` to `KickstartArgsV3` (asserts-style
 * signature so call sites get full type safety after the call). Throws
 * `CodexKickstartError("invalid-args", detail)` naming the failing field on any
 * shape violation.
 *
 * SCOPE: SHAPE-only. The cross-field constraints that depend on the derived word
 * count — the words-mode `2..512` count and the `reuse-codexid-whole` ↔
 * `wordCount ≤ 256` rule (design doc §4.2 line 330) — are enforced in the
 * kickstart action (T7.3), after tokenisation, NOT here.
 */
export function validateKickstartArgs(args: unknown): asserts args is KickstartArgsV3 {
  if (!isObject(args)) fail(`args must be a non-null object, got ${typeof args}`);

  // codexIdSeed
  const seed = (args as Record<string, unknown>).codexIdSeed;
  if (!isObject(seed)) fail("codexIdSeed must be an object");
  if (typeof seed.mode !== "string" || !SEED_MODES.has(seed.mode)) {
    fail(`codexIdSeed.mode must be one of {words,bitstring,bitmap,base10,base49}, got ${JSON.stringify(seed.mode)}`);
  }
  if (typeof seed.value !== "string" || seed.value.length === 0) {
    fail("codexIdSeed.value must be a non-empty string");
  }
  if (seed.splitIndex !== undefined) {
    if (typeof seed.splitIndex !== "number" || !Number.isInteger(seed.splitIndex) || seed.splitIndex < 0) {
      fail("codexIdSeed.splitIndex must be a non-negative integer");
    }
    if (seed.mode !== "words") {
      fail("splitIndex only valid for mode='words'; for bitstring/bitmap/base10/base49 the split is fixed at bit 1024");
    }
  }

  // codexPrimeSeed
  const prime = (args as Record<string, unknown>).codexPrimeSeed;
  if (!isObject(prime)) fail("codexPrimeSeed must be an object");
  if (typeof prime.source !== "string" || !PRIME_SOURCES.has(prime.source)) {
    fail(`codexPrimeSeed.source must be one of {reuse-codexid-whole,reuse-codexid-standard,reuse-codexid-smart,fresh-dalos}, got ${JSON.stringify(prime.source)}`);
  }
  if (prime.source === "fresh-dalos" && (typeof prime.words !== "string" || prime.words.length === 0)) {
    fail("codexPrimeSeed.words must be a non-empty string when source='fresh-dalos'");
  }

  // duoPrime
  const duo = (args as Record<string, unknown>).duoPrime;
  if (!isObject(duo)) fail("duoPrime must be an object");
  if (duo.mode === "kadena-seed") {
    if (typeof duo.seedType !== "string" || !SEED_TYPES.has(duo.seedType)) {
      fail(`duoPrime.seedType must be one of {koala,chainweaver,eckowallet}, got ${JSON.stringify(duo.seedType)}`);
    }
    if (typeof duo.mnemonic !== "string" || duo.mnemonic.length === 0) {
      fail("duoPrime.mnemonic must be a non-empty string when mode='kadena-seed'");
    }
  } else if (duo.mode !== "auto-pure-keys") {
    fail(`duoPrime.mode must be one of {kadena-seed,auto-pure-keys}, got ${JSON.stringify(duo.mode)}`);
  }

  // createdByUsername
  const createdBy = (args as Record<string, unknown>).createdByUsername;
  if (createdBy !== undefined && typeof createdBy !== "string") {
    fail("createdByUsername must be a string when present");
  }
}
