/**
 * defineKeysetOps — the keyset-ref update
 * (docs/work/migration-execute-keyset/design.md §2), headless.
 *
 *   (define-keyset "<ns>.<ksn>" (read-keyset "ks"))
 *
 * with `ks` carrying the NEW `{ keys, pred }`. The target is derivable from
 * the account's live guard: when that guard is a keyset-REF, the reference it
 * names is exactly the keyset being updated (the planner reads it as
 * `registeredKeysetRef`). This is a DIFFERENT transaction from
 * `TS01-C1.DALOS|C_RotateGuard`, not a new `rotateGuard` mode —
 * `rotateOps.ts`'s refusal of `{ mode: "define-keyset" }` is still correct,
 * because `C_RotateGuard` cannot express a keyset-DEFINITION update.
 *
 * ## Gas: SELF-PAID. The Ouronet gas station cannot pay for this.
 *
 * `DALOS.GAS_PAYER` (`1_SOVEREIGN/STAGE_01/2_Core/01_DALOS.pact:456-526`,
 * re-read and confirmed for this module) inspects the transaction's own
 * top-level forms and races exactly three cases:
 *
 *   1. `:470-485` ONE form starting `(coin.C_`, `(ouronet-ns.TS`,
 *      `(ouronet-ns.DSP` or `(ouronet-ns.STOAICO.`;
 *   2. `:487-496` exactly TWO forms, BOTH starting `(coin.C_`;
 *   3. `:514-524` THREE+ forms: `(namespace "ouronet-ns")`, then a ≥25-IGNIS
 *      `(TS01-C1.DPTF|C_Transmute…` donation, then a `(let…`.
 *
 * `(define-keyset …)` is one form that starts with none of Case 1's prefixes,
 * so it matches NO case. Design §2 records this step's gas as "settled by the
 * owner: gas-station sponsorship applies"; against this contract that is
 * false. The two real routes are (a) **self-paid gas** — an ordinary
 * transaction whose `senderAccount` is the payer's own STOA account, with a
 * `coin.GAS` signer — and (b) Case 3, which costs the patron a ≥25-IGNIS
 * `C_Transmute` donation and requires the `define-keyset` to sit inside a
 * `(let …)`. **This module implements (a).** (b) stays available as the
 * owner's fallback if paying IGNIS is preferred to spending STOA on gas; it
 * would need a donation row and a `(let …)` wrapper, i.e. a different builder,
 * not a flag here.
 *
 * ## Signers: the CURRENT keyset, up to its threshold
 *
 * A `define-keyset` over an existing keyset must be satisfied by that
 * keyset's CURRENT definition. Those signers come from
 * `collectGuardSigners` (`./rotateOps.ts`) — the once-only threshold walk,
 * including its manual-key map — so this module does not write a second one.
 * They are added as PURE signers (no clist): `define-keyset` is gated by
 * `enforce-keyset` over the transaction's signer set, not by a capability.
 *
 * ## Simulate before signing, and refuse loudly
 *
 * `dirtyRead` first, always. Whether the chain accepts the redefinition at
 * all depends on facts this codex does not model — the keyset's own current
 * definition, and the NAMESPACE the keyset lives in
 * (`0_Stoa/genesis/stoa-genesis-1.pact:110-113`: `ouronet-ns` and `stoa-ns`
 * are defined with `(keyset-ref-guard "ns-operate-keyset")`, a protocol
 * keyset, as their user guard, while `free` and `user` are `GUARD_SUCCESS`).
 * A refusal therefore costs ONE READ and NO SIGNATURE, and the caller gets
 * the chain's own message. The engine reports a failure here and continues:
 * nothing else in the migration chain depends on this step.
 *
 * ### What the local Pact REPL says, and the version caveat
 *
 * Verified with `~/.local/bin/pact` (**Pact 5.4.1**), local REPL only — no
 * submit, no read, zero mainnet exposure:
 *
 *   - the single QUALIFIED form above is accepted ("Keyset write success"),
 *     so the `(namespace "<ns>")` + unqualified-name pair is unnecessary —
 *     and that pair would be TWO top-level forms, neither `(coin.C_`, which
 *     independently rules out any gas-station case;
 *   - redefining an EXISTING keyset enforces the OLD definition: the same
 *     call fails with `Keyset failure` for a signer set that does not satisfy
 *     it, and succeeds once it does, after which the NEW definition is what
 *     `enforce-keyset` checks;
 *   - in 5.4.1 the namespace's USER guard was NOT observed to gate either a
 *     fresh qualified define or a `(namespace …)` entry.
 *
 * The REPL binary is Pact 5.4.1 and chainweb runs its own version, so these
 * are strong evidence and NOT a guarantee — in particular the last point may
 * differ on the deployed node, which is precisely why this module simulates
 * instead of deciding for itself.
 *
 * ## The injected chain edge — read before adding an import here
 *
 * `getFailoverClient(chainId).submit` is a REAL mainnet broadcast, and this
 * is the one operation in this topic that changes WHO CONTROLS A KEYSET. So
 * it is NOT reachable through a module-level import a test cannot displace:
 * {@link submitDefineKeyset} takes its client factory, its signer and its
 * `getKeypair` on a REQUIRED {@link DefineKeysetDeps} argument with no
 * default, and `tests/execute-define-keyset.test.ts` passes synthetic ones and
 * contains not one `vi.mock`. A dropped mock fails OPEN onto mainnet; a
 * required seam with no default cannot.
 *
 * Like `nativeStoaTransfer.ts` and `collectUnstakeUrStoa.ts` this is a
 * SELF-CONTAINED submit site (`getFailoverClient` → `dirtyRead` →
 * `calculateAutoGasLimit` → rebuild → sign → submit) rather than a
 * `CodexSigningStrategy.execute()` one, for the reason those headers record:
 * `execute()` has NO dedup safety on retry
 * (`@stoachain/stoa-core/dist/signing/codexStrategy.js:39-56`) and the
 * migration chain is a thing the user RE-PRESSES.
 * `tests/tx-gas-meta-surface.test.ts` lists this file under
 * `SELF_CONTAINED_TX_SITES`. (That scan inventories files by plain
 * source-text search for the meta-setting call and extracts the following
 * object literal, so that literal text must appear here EXACTLY once: at the
 * real call. Do not write it in a comment.)
 */

import { calculateAutoGasLimit, stoaGasMeta } from "@stoachain/stoa-core/gas";
import { safeCreationTime } from "@stoachain/stoa-core/pact";
import { Pact } from "@stoachain/kadena-stoic-legacy/client";
import { createSimulationError, logDetailedError } from "@stoachain/stoa-core/errors";
import { KADENA_NETWORK as STOACHAIN_NETWORK } from "@stoachain/stoa-core/constants";

import {
  collectGuardSigners,
  type GetGuardKeypairFn,
  type GuardSignerAnalysis,
} from "./rotateOps.js";
import { liveNativeStoaChainEdge, type NativeStoaChainEdge } from "./nativeStoaTransfer.js";

/**
 * A qualified `"<ns>.<ksn>"` keyset reference, or a bare `"<ksn>"` for a
 * keyset defined outside any namespace.
 *
 * The reference is spliced directly into a Pact code STRING LITERAL, so a
 * reference containing a `"` could otherwise close that literal and append
 * arbitrary Pact expressions — authorized by this same transaction's signers,
 * which are the keys that control the account's keyset. The reference comes
 * from a chain read (`keysetRefNameOf`, `guards/resolveGuardKeys.ts:93-105`)
 * and "cannot" be hostile; `nativeStoaTransfer.ts:90-99` records why that is
 * not a reason to drop the defence. Deliberately narrower than Pact's own
 * name rules: every reference this codex has ever seen on StoaChain is
 * alphanumerics, `-` and `_` in at most two dotted segments
 * (`"ouronet-ns.dh_ah-keyset"`), and the cost of being too strict is a loud
 * refusal the engine reports, not a silent wrong transaction.
 */
export const SAFE_KEYSET_REF_RX = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)?$/;

/** The refusal for a reference that fails {@link SAFE_KEYSET_REF_RX}. */
export const UNSAFE_KEYSET_REF_MESSAGE =
  "Keyset reference contains characters that aren't allowed in a keyset name.";

/** The NEW definition the keyset becomes — the `ks` payload, and ONLY
 *  `{ keys, pred }`. A RESOLVED guard (`getStoaChainAccountGuard`'s answer)
 *  also carries a `keysetRef` annotation, which is not part of a keyset; this
 *  type exists so the annotation cannot be posted as one. */
export interface DefineKeysetDefinition {
  readonly keys: readonly string[];
  readonly pred: string;
}

/** A signing-ready keypair, narrowed to the two fields this module passes
 *  through (structurally `IKadenaKeypair`). Narrowing the TYPE strips nothing
 *  at runtime: the object itself reaches `fromKeypair`, so a
 *  chainweaver/ecko keypair keeps its extra fields. */
export interface DefineKeysetKeypair {
  readonly publicKey: string;
  readonly privateKey: string;
}

/** The two `getFailoverClient(chainId)` members this flow uses. */
export interface DefineKeysetClient {
  dirtyRead(tx: unknown): Promise<{ result: { status: string; error?: unknown }; gas?: number }>;
  submit(tx: unknown): Promise<unknown>;
}

/** The injected chain edge. REQUIRED — there is deliberately no default, so a
 *  caller that forgets it fails closed rather than reaching mainnet. */
export interface DefineKeysetChainEdge {
  /** `getFailoverClient` — per chain, because the dedup contract lives in it. */
  readonly getClient: (chainId: string) => DefineKeysetClient;
  /** `universalSignTransaction`, with the keypairs already resolved. */
  readonly signTransaction: (
    tx: unknown,
    keypairs: readonly DefineKeysetKeypair[],
  ) => Promise<unknown>;
}

export interface DefineKeysetRequest {
  /** The keyset being redefined — the account's own guard reference. */
  readonly keysetRef: string;
  /** What it becomes. NEVER the current keyset: redefining a keyset as itself
   *  succeeds, costs gas and achieves nothing. */
  readonly newKeyset: DefineKeysetDefinition;
  /** Pays the gas, and is this transaction's `senderAccount` — the account's
   *  registered payment address. */
  readonly payerAddress: string;
  /** Signs `coin.GAS` for {@link payerAddress}. */
  readonly payerKey: DefineKeysetKeypair;
  /** Keysets are per-chain in Pact, so the caller names the chain rather than
   *  inheriting one. */
  readonly chainId: string;
  /** The CURRENT keyset's analysis, resolved BEFORE the press by the keyset
   *  gate (design §3) — `analyzeGuard(currentKeyset, codexPubs, manualKeys)`.
   *  Its `threshold` is where {@link collectGuardSigners} stops. */
  readonly currentKeysetAnalysis: GuardSignerAnalysis;
  /** Private keys the user supplied by hand for keys the codex does not hold,
   *  by public key. Passed straight to {@link collectGuardSigners}, which
   *  prefers them over `getKeypair` for the same public key. */
  readonly manualKeys?: Record<string, string>;
}

export interface DefineKeysetDeps {
  /** Resolves one public key of the current keyset to its keypair. A falsy
   *  answer means "this codex does not hold it" and is skipped. */
  readonly getKeypair: GetGuardKeypairFn;
  /** REQUIRED. No default — see this module's mainnet-hazard header. */
  readonly edge: DefineKeysetChainEdge;
}

/** The initial gas-limit guess the simulation replaces — the same figure
 *  `rotatePaymentKeyLive.ts:70` and `nativeStoaTransfer.ts:244` start from. */
const INITIAL_GAS_LIMIT = 2000000;

/** The one qualified form, with the reference spliced in. Caller must have
 *  already checked {@link SAFE_KEYSET_REF_RX}. */
export function buildDefineKeysetPactCode(keysetRef: string): string {
  return `(define-keyset "${keysetRef}" (read-keyset "ks"))`;
}

/**
 * Redefine the keyset the account's guard refers to, through the dedup-safe
 * pipeline.
 *
 * Returns the request key, which is a HANDLE, not evidence the transaction
 * landed — the caller gates on `awaitTxVerdict` (`./awaitConfirmation.ts`).
 *
 * Throws, rather than returning a verdict, for the two things that are not
 * flow outcomes: an unsafe reference (a programming or state error — nothing
 * was submitted) and a failed simulation (the transaction cannot land, and
 * `createSimulationError` already carries the chain's own diagnosis — the
 * `Keyset failure` of an unsatisfied current keyset, or a namespace whose
 * user guard this codex cannot satisfy).
 */
export async function submitDefineKeyset(
  req: DefineKeysetRequest,
  deps: DefineKeysetDeps,
): Promise<{ requestKey: string }> {
  if (!SAFE_KEYSET_REF_RX.test(req.keysetRef)) throw new Error(UNSAFE_KEYSET_REF_MESSAGE);

  const pactCode = buildDefineKeysetPactCode(req.keysetRef);
  // Exactly `{ keys, pred }`, rebuilt rather than spread: see
  // DefineKeysetDefinition.
  const keysetData = { keys: [...req.newKeyset.keys], pred: req.newKeyset.pred };

  const currentKeysetSigners = await collectGuardSigners(
    req.currentKeysetAnalysis,
    deps.getKeypair,
    req.manualKeys ?? {},
  );
  // The payer may itself be one of the current keyset's keys — the common
  // case for an account whose payment key is in its own keyset. One public
  // key must appear as ONE signer (carrying `coin.GAS`) and be handed to the
  // signer exactly once, or the command's signatures and signers stop
  // corresponding. Dedup pattern lifted from `../rotatePaymentKeyLive.ts:72-79`.
  const coSigners = currentKeysetSigners.filter(
    (k) => k.publicKey !== req.payerKey.publicKey,
  );
  const signingKeys: DefineKeysetKeypair[] = [req.payerKey, ...coSigners];

  const buildTransaction = (gasLimit: number): unknown => {
    let builder: any = Pact.builder.execution(pactCode).addData("ks", keysetData);
    builder = builder
      .setMeta({
        // SELF-PAID: the payer's own account, because `DALOS.GAS_PAYER`
        // matches no case for this form — see this module's header.
        senderAccount: req.payerAddress,
        chainId: req.chainId,
        gasLimit,
        // A self-contained site reads the clock itself — there is no
        // `execute()` ctx to take `creationTime` from. The second read on the
        // calibrated rebuild is harmless: `dirtyRead` is a simulation, not a
        // preflight, so only the SUBMITTED command's hash matters, and
        // `getFailoverClient.submit` reuses that one signed reference across
        // primary and fallback. Same shape as `nativeStoaTransfer.ts:290`.
        ...stoaGasMeta(safeCreationTime()),
      })
      .setNetworkId(STOACHAIN_NETWORK)
      .addSigner(req.payerKey.publicKey, (withCapability: any) => [withCapability("coin.GAS")]);
    for (const key of coSigners) builder = builder.addSigner(key.publicKey);
    return builder.createTransaction();
  };

  const { dirtyRead, submit } = deps.edge.getClient(req.chainId);

  let transaction = buildTransaction(INITIAL_GAS_LIMIT);
  const simulation = await dirtyRead(transaction);
  if (simulation.result.status === "failure") {
    const chainMessage =
      (simulation.result.error as { message?: string } | undefined)?.message ??
      "Unknown simulation error";
    const error = createSimulationError(
      "Update keyset definition",
      simulation.result as never,
      `Keyset: ${req.keysetRef} | Payer: ${req.payerAddress} | Chain: ${req.chainId} | ` +
        `Signers: ${signingKeys.length} of ${req.currentKeysetAnalysis.threshold} required | ` +
        `Chain says: ${chainMessage}`,
    );
    logDetailedError(error);
    // Re-surface the chain's OWN words, which is the one thing this module's
    // caller cannot do without. `createSimulationError` classifies any
    // message containing "keyset" or "guard" as `KEYSET_ERROR` and REPLACES
    // the message with a generic sentence
    // (`@stoachain/stoa-core/dist/errors/transactionErrors.js`'s KEYSET_ERROR
    // branch), keeping the original only on `originalError` — and EVERY
    // failure mode of a `define-keyset` lands in that bucket. "Keyset
    // failure" because the current keyset was not satisfied and "Keyset
    // failure" because the namespace's user guard is protocol-held are
    // different problems with different fixes, and the engine reports
    // `err.message`. The classified error stays attached as `cause`, with its
    // code and suggestions intact. The sibling builders throw the factory's
    // error directly, legitimately: their failures ("Debit Amount must be
    // positive", "At least 1.0 URSTOA must remain in the URSTOA-Vault")
    // reach the generic branch, which keeps the chain's text in the message.
    throw new Error(`${error.message}: ${chainMessage}`, { cause: error });
  }
  if (simulation.gas) transaction = buildTransaction(calculateAutoGasLimit(simulation.gas));

  const signed = await deps.edge.signTransaction(transaction, signingKeys);
  const descriptor = (await submit(signed)) as { requestKey?: string } | null;
  return { requestKey: descriptor?.requestKey ?? "" };
}

/**
 * The PRODUCTION wiring of {@link DefineKeysetChainEdge}. It DELEGATES to
 * `nativeStoaTransfer.ts`'s factory rather than copying its lazy-import body:
 * the real chain functions stay named in exactly ONE place for this whole
 * directory, which is the property the mainnet-hazard rule actually wants. A
 * function rather than a const, so importing this file never touches the
 * network; assembled at the React boundary and handed in.
 */
export function liveDefineKeysetChainEdge(): DefineKeysetChainEdge {
  const edge: NativeStoaChainEdge = liveNativeStoaChainEdge();
  return edge;
}
