/**
 * `zbom/execute/rotateOps.ts` — the ONE copy of the guard signer resolution,
 * and the headless entry points for the migration chain's last two steps:
 *
 *   F — rotate payment key   `TS01-C1.DALOS|C_RotateStoa`
 *   G — rotate guard         `TS01-C1.DALOS|C_RotateGuard`   (LAST)
 *
 * ── Why this module exists ──────────────────────────────────────────────────
 * Both operations already shipped and are mainnet-verified, but neither was
 * callable without mounting a React modal and a human pressing Execute:
 * `rotateStoaChainPaymentKeyLive` (`../rotatePaymentKeyLive.ts`) is exported
 * from no index and had exactly one non-test importer, and `rotateGuard`'s
 * eleven-field argument object was assembled inline inside
 * `RotateGuardModal`'s `handleExecute`. This module is the headless surface
 * over both — no React, no store, no hooks.
 *
 * ── MAINNET HAZARD: inject, never default ───────────────────────────────────
 * F and G are the two operations that change WHO CONTROLS THE ACCOUNT. Both
 * real implementations reach `getFailoverClient(...).submit` — a real
 * broadcast — through a module-scope import no test can displace
 * (`../rotatePaymentKeyLive.ts:120`,
 * `@ouronet/ouronet-core/interactions/guardFunctions.js:103`). So the
 * submitters here are REQUIRED injected dependencies with **no default**: a
 * forgotten mock fails open onto mainnet and rotates real keys, a required
 * seam cannot. The real functions are named in exactly one place each —
 * `liveRotatePaymentKeySubmitter` / `liveRotateGuardSubmitter` below — which
 * a caller must opt into explicitly.
 *
 * Both of those are `const` ALIASES, not adapters, and they are annotated
 * with this module's own submitter types. That is deliberate: the assignment
 * itself typechecks the positional/named contract, so an upstream signature
 * drift fails `npm run typecheck` here instead of at runtime on chain.
 *
 * ── Submit pipeline ─────────────────────────────────────────────────────────
 * Both submitters go through `getFailoverClient`, never
 * `CodexSigningStrategy.execute()`, whose own doc comment
 * (`@stoachain/stoa-core/dist/signing/codexStrategy.js:39-56`) states it has
 * NO built-in dedup safety on retry. The migration chain is a thing the user
 * re-presses; a pipeline without dedup would let a re-press land a second
 * rotation.
 */

import { rotateStoaChainPaymentKeyLive } from "../rotatePaymentKeyLive.js";
import { rotateGuard } from "@ouronet/ouronet-core/interactions/guardFunctions";
import type { RotateGuardParams } from "@ouronet/ouronet-core/interactions/guardFunctions";
import type { IKadenaKeypair as IStoaChainKeypair } from "@stoachain/stoa-core/signing";

// ─── Signer resolution — the once-only copy ─────────────────────────────────

/**
 * The slice of `@stoachain/stoa-core/guard`'s `GuardAnalysis` the signer walk
 * actually reads. Structural on purpose: a `GuardAnalysis` satisfies it, and
 * so does a headless caller's own three-field object, without this module
 * taking a value dependency on `analyzeGuard`.
 */
export interface GuardSignerAnalysis {
  /** Keys immediately signable from the Codex. */
  readonly codexKeys: readonly string[];
  /** Foreign keys the user has resolved by pasting a private key. */
  readonly resolvedForeignKeys: readonly string[];
  /** Minimum signatures the guard's predicate requires. */
  readonly threshold: number;
}

/**
 * Resolve one public key to its keypair. A falsy answer means "this codex
 * does not hold it" and is SKIPPED; a throw (the real resolver's
 * `CodexLockedError` / `CodexKeyMissingError`) propagates, exactly as it did
 * from the modals' own inline copy.
 */
export type GetGuardKeypairFn = (
  publicKey: string,
) => Promise<IStoaChainKeypair | null | undefined>;

/**
 * Collect the signing keys for ONE guard, stopping at the guard's threshold.
 *
 * Lifted verbatim out of `zbom/modals/RotatePaymentKeyModal.tsx:255-264` and
 * `zbom/modals/RotateGuardModal.tsx:255-264`, where it existed as two
 * byte-identical `collectKeys` closures (verified identical before the lift).
 * Both modals now call this, and so do F and G below, so the engine never
 * re-derives a signer set.
 *
 * **The threshold stop is the load-bearing part.** Signing with more keys
 * than the guard requires is how a transaction gets rejected for an
 * unexpected signer set, and two independently-editable copies of that rule
 * was one copy too many.
 *
 * Walk order is `codexKeys` then `resolvedForeignKeys` — unchanged from the
 * lifted copies, and observable: it decides WHICH keys survive the threshold
 * cut when more are available than are needed.
 */
export async function collectGuardSigners(
  analysis: GuardSignerAnalysis,
  getKeypair: GetGuardKeypairFn,
  manualKeys: Record<string, string> = {},
): Promise<IStoaChainKeypair[]> {
  const keys: IStoaChainKeypair[] = [];
  const candidates = [...analysis.codexKeys, ...analysis.resolvedForeignKeys];
  for (const pub of candidates) {
    if (keys.length >= analysis.threshold) break;
    if (manualKeys[pub]) keys.push({ publicKey: pub, privateKey: manualKeys[pub] });
    else { const kp = await getKeypair(pub); if (kp) keys.push(kp); }
  }
  return keys;
}

// ─── Shared shapes ──────────────────────────────────────────────────────────

/**
 * A resolved `{ pred, keys }` keyset — the shape that reaches the `ks` /
 * `ks-account` `.addData` payloads. NOT an `IOuroAccount.guard`, which is an
 * UNRESOLVED keyset-ref object (`{ keysetref: { ns, ksn } }`) carrying no
 * `.keys`; callers resolve it first (the modals do so through
 * `getStoaChainAccountGuard`) or the rotation ships an empty keyset.
 */
export interface ResolvedKeysetLike {
  readonly keys?: string[];
  readonly pred?: string;
}

/**
 * What a rotate submit resolves to. The submitter's own result is returned
 * verbatim — this is the narrowest shape BOTH real submitters satisfy
 * (`rotateStoaChainPaymentKeyLive`'s loose `{ requestKey?, …}` and
 * `rotateGuard`'s `ITransactionDescriptor`), deliberately with no index
 * signature so those two aliases typecheck against it. `requestKey` is
 * optional because the former declares it so; a caller that polls
 * confirmation must treat its absence as "not confirmable", never as `""`.
 */
export interface RotateSubmitResult {
  readonly requestKey?: string;
}

// ─── F — rotate payment key (TS01-C1.DALOS|C_RotateStoa) ────────────────────

/**
 * The injected submitter for F, positionally identical to
 * `rotateStoaChainPaymentKeyLive` (`../rotatePaymentKeyLive.ts:60-68`) so the
 * live alias below needs no adapter and cannot drift from it.
 */
export type RotatePaymentKeySubmitter = (
  patronAddress: string,
  accountAddress: string,
  newPaymentKey: string,
  gasStationKey: IStoaChainKeypair,
  patronGuardKeys: IStoaChainKeypair[],
  accountGuardKeys: IStoaChainKeypair[],
  patronGuard?: ResolvedKeysetLike | null,
  accountGuard?: ResolvedKeysetLike | null,
) => Promise<RotateSubmitResult>;

/** Named arguments for F — the eight positional parameters of the underlying
 *  call are a trap for a nine-argument caller, so nothing outside this module
 *  passes them by position. The two guard ANALYSES (not pre-collected key
 *  arrays) are the inputs: F resolves its own signers through
 *  `collectGuardSigners`, so the engine never re-derives a signer set. */
export interface RotatePaymentKeyRequest {
  readonly patronAddress: string;
  readonly accountAddress: string;
  /** The account string the Ouronet account's payment key becomes. */
  readonly newPaymentKey: string;
  readonly gasStationKey: IStoaChainKeypair;
  readonly patronAnalysis: GuardSignerAnalysis;
  readonly accountAnalysis: GuardSignerAnalysis;
  readonly patronGuard?: ResolvedKeysetLike | null;
  readonly accountGuard?: ResolvedKeysetLike | null;
  /** pub → private-key hex for foreign keys the user resolved by hand. */
  readonly manualKeys?: Record<string, string>;
}

export interface RotatePaymentKeyDeps {
  readonly getKeypair: GetGuardKeypairFn;
  /** REQUIRED. No default — see this module's mainnet-hazard header. */
  readonly submitRotatePaymentKey: RotatePaymentKeySubmitter;
}

/**
 * F — rotate the Ouronet account's StoaChain payment key, headlessly.
 *
 *   `(ouronet-ns.TS01-C1.DALOS|C_RotateStoa <patron> <account> <new-key>)`
 *
 * Runs AFTER the drain (A-E): every earlier step is signed by the OLD payment
 * key, which must still be the one the account names.
 */
export async function executeRotatePaymentKey(
  req: RotatePaymentKeyRequest,
  deps: RotatePaymentKeyDeps,
): Promise<RotateSubmitResult> {
  const patronGuardKeys = await collectGuardSigners(req.patronAnalysis, deps.getKeypair, req.manualKeys);
  const accountGuardKeys = await collectGuardSigners(req.accountAnalysis, deps.getKeypair, req.manualKeys);

  // `rotatePaymentKeyLive.ts:88` attaches the `ks-account` payload only when
  // the account differs from the patron. Making that explicit here means a
  // self-rotation can never ship a redundant second keyset payload.
  const isSelfRotation = req.accountAddress === req.patronAddress;

  return await deps.submitRotatePaymentKey(
    req.patronAddress,
    req.accountAddress,
    req.newPaymentKey,
    req.gasStationKey,
    patronGuardKeys,
    accountGuardKeys,
    req.patronGuard ?? null,
    isSelfRotation ? null : (req.accountGuard ?? null),
  );
}

/** PRODUCTION wiring for F — the ONE place the real broadcasting function is
 *  named. A caller must opt in explicitly; nothing defaults to it. */
export const liveRotatePaymentKeySubmitter: RotatePaymentKeySubmitter =
  rotateStoaChainPaymentKeyLive;

// ─── G — rotate guard (TS01-C1.DALOS|C_RotateGuard) ─────────────────────────

/**
 * Thrown for a guard change this build genuinely cannot execute. A distinct
 * type so a caller can REPORT "not executable" rather than "failed" — design
 * acceptance criterion 9 requires it be reported, never silently skipped.
 */
export class GuardChangeNotExecutableError extends Error {
  /** Always false. Present so a report surface can branch on the fact
   *  without string-matching the message. */
  readonly executable = false;
  constructor(message: string) {
    super(message);
    this.name = "GuardChangeNotExecutableError";
  }
}

/**
 * Why the keyset-ref UPDATE is refused rather than attempted. Design §6:
 * zero code for it exists anywhere in the tree (no `PACT_SIGNATURES` entry,
 * no builder, nothing in `ouronet-core`); it is not an Ouronet `C_*` call, so
 * the Ouronet gas station is not available to pay for it; and it must be
 * satisfied by the keyset's CURRENT keyset, which this codex may not hold.
 */
export const DEFINE_KEYSET_NOT_EXECUTABLE_REASON =
  "The keyset-ref update (`define-keyset`) is not executable: it is not an Ouronet C_* " +
  "call, so the Ouronet gas station cannot pay for it, and it must be satisfied by the " +
  "keyset's CURRENT keyset — which this codex may not hold. No builder for it exists. " +
  "Rotate the Ouronet account's guard directly instead.";

/**
 * WHICH guard change is being requested. The first two are the two forms
 * `rotateGuard` can build, and both are reachable through this API:
 *
 *   - `"define"`   → `(read-keyset "ks")`, with the new keys/pred supplied as
 *                    the `ks` data payload. `safe` is FORCED true (there is
 *                    no field to say otherwise), mirroring
 *                    `RotateGuardModal.tsx:281`.
 *   - `"existing"` → `(keyset-ref-guard "<ref>")`, pointing the account's
 *                    guard at an already-defined keyset. `safe` is the
 *                    caller's, as in the modal's `existingSafe`.
 *
 * The third is REPRESENTED here and explicitly NOT EXECUTABLE — it is the
 * owner's other guard case (update what an existing reference resolves to),
 * and modelling it as a value means a caller cannot have it quietly dropped:
 * `executeRotateGuard` refuses it loudly. See
 * `DEFINE_KEYSET_NOT_EXECUTABLE_REASON`.
 */
export type GuardChangeTarget =
  | { readonly mode: "define"; readonly newKeys: string[]; readonly newPred: string }
  | { readonly mode: "existing"; readonly keysetRef: string; readonly safe: boolean }
  | { readonly mode: "define-keyset"; readonly keysetName?: string };

/** The injected submitter for G, shaped on `ouronet-core`'s own
 *  `RotateGuardParams` so the live alias below needs no adapter. */
export type RotateGuardSubmitter = (params: RotateGuardParams) => Promise<RotateSubmitResult>;

/** Named arguments for G. Like F, it takes guard ANALYSES and resolves its own
 *  signers through `collectGuardSigners`. */
export interface RotateGuardRequest {
  readonly patronAddress: string;
  readonly accountAddress: string;
  readonly gasStationKey: IStoaChainKeypair;
  readonly patronAnalysis: GuardSignerAnalysis;
  readonly accountAnalysis: GuardSignerAnalysis;
  /** The INCOMING guard's analysis, when its keys must co-sign. Absent sends
   *  an empty `newGuardKeys`, as `RotateGuardModal.tsx:268` does. */
  readonly newGuardAnalysis?: GuardSignerAnalysis | null;
  readonly target: GuardChangeTarget;
  readonly manualKeys?: Record<string, string>;
}

export interface RotateGuardDeps {
  readonly getKeypair: GetGuardKeypairFn;
  /** REQUIRED. No default — see this module's mainnet-hazard header. */
  readonly submitRotateGuard: RotateGuardSubmitter;
}

/**
 * G — rotate the Ouronet account's guard (its ownership keyset), headlessly.
 *
 *   `(ouronet-ns.TS01-C1.DALOS|C_RotateGuard <patron> <account> <guard> <safe>)`
 *
 * Runs LAST in the migration chain: the moment it lands, the signing set
 * changes, so every other step must already be done and authorized by the
 * guard that exists today.
 */
export async function executeRotateGuard(
  req: RotateGuardRequest,
  deps: RotateGuardDeps,
): Promise<RotateSubmitResult> {
  // Refuse FIRST — before any key resolution, and long before any submit.
  if (req.target.mode === "define-keyset") {
    throw new GuardChangeNotExecutableError(DEFINE_KEYSET_NOT_EXECUTABLE_REASON);
  }
  const target = req.target;

  const patronGuardKeys = await collectGuardSigners(req.patronAnalysis, deps.getKeypair, req.manualKeys);
  const accountGuardKeys = await collectGuardSigners(req.accountAnalysis, deps.getKeypair, req.manualKeys);
  const newGuardKeys = req.newGuardAnalysis
    ? await collectGuardSigners(req.newGuardAnalysis, deps.getKeypair, req.manualKeys)
    : [];

  return await deps.submitRotateGuard({
    patronAddress:    req.patronAddress,
    accountAddress:   req.accountAddress,
    mode:             target.mode,
    newKeys:          target.mode === "define" ? target.newKeys : undefined,
    newPred:          target.mode === "define" ? target.newPred : undefined,
    keysetRef:        target.mode === "existing" ? target.keysetRef : undefined,
    safe:             target.mode === "define" ? true : target.safe,
    gasStationKey:    req.gasStationKey,
    patronGuardKeys,
    accountGuardKeys,
    newGuardKeys,
  });
}

/** PRODUCTION wiring for G — the ONE place the real broadcasting function is
 *  named. A caller must opt in explicitly; nothing defaults to it. */
export const liveRotateGuardSubmitter: RotateGuardSubmitter = rotateGuard;
