/**
 * nativeStoaTransfer — step B of the migration chain
 * (docs/work/migration-execute/design.md §2): chain 0, OLD payment key → NEW
 * payment key, native STOA. Headless: no React anywhere in the call stack.
 *
 * Two halves, lifted out of `ui/internal/SendStoaModal.tsx`'s `handleSubmit`
 * `useCallback`:
 *
 *   1. **The pact-code builder** (`SendStoaModal.tsx:532-535` before this
 *      lift) — `(coin.C_Transfer …)` when the receiver account already
 *      exists, `(coin.C_TransferAnew … (read-keyset "ks") …)` (create +
 *      transfer, `k:` receivers only) when it does not. **The modal imports
 *      it from here**, so there is exactly ONE copy of the two strings
 *      `tests/ui-send-stoa-modal.test.tsx:243-297` pins.
 *   2. **A self-contained submit** the modal never had, in
 *      `../rotatePaymentKeyLive.ts:120-146`'s style: `getFailoverClient(chainId)`
 *      → `dirtyRead` → `calculateAutoGasLimit` → rebuild → sign → `submit`.
 *
 * ## Why this operation does NOT go through `CodexSigningStrategy.execute()`
 *
 * The modal's same-chain path does, and keeps doing so — a human watches the
 * result and decides. The ENGINE is a thing the user RE-PRESSES (design §4),
 * and `execute()`'s own doc comment rules it out for that
 * (`@stoachain/stoa-core/dist/signing/codexStrategy.js:39-56`):
 *
 *   "Unlike `getFailoverClient.submit` (which captures the same signed-tx
 *    reference across primary+fallback attempts to preserve mempool dedup),
 *    this seam deliberately runs without failover (REQ-04) and therefore has
 *    NO built-in dedup safety on retry. … Better: use `getFailoverClient`
 *    directly for non-codex submit flows so the dedup contract handles this
 *    for you."
 *
 * A `TIMEOUT` on submit may already have reached chainweb; a re-press rebuilds
 * with a fresh `creationTime`, the two copies hash differently, chainweb
 * cannot dedup them, and BOTH land. For a transfer that is paying twice. That
 * design decision — not convenience — is why this file is a new
 * transaction-building site and why `tests/tx-gas-meta-surface.test.ts` lists
 * it under `SELF_CONTAINED_TX_SITES`. (That scan inventories files by plain
 * source-text search and extracts each hit's following object literal, so the
 * literal text it greps for must appear in this file EXACTLY once: at the real
 * call. Do not write it in a comment.)
 *
 * ## The injected chain edge — read before adding an import here
 *
 * `getFailoverClient(chainId).submit` is a REAL mainnet broadcast, and this is
 * the step that moves a user's entire chain-0 STOA balance. It is therefore
 * NOT reachable through a module-level import a test cannot displace:
 * {@link submitNativeStoaTransfer} takes its client factory and its signer on
 * a REQUIRED {@link NativeStoaChainEdge} argument. Production names the real
 * functions in exactly one place — {@link liveNativeStoaChainEdge}, called at
 * the React boundary — and `tests/execute-stoa-transfers.test.ts` passes a
 * synthetic edge and contains not one `vi.mock`. A dropped mock fails OPEN
 * onto mainnet; a required seam with no default cannot.
 *
 * ## Two security-relevant details carried over verbatim
 *
 * - Gas is paid by the Ouronet Gas Station: `senderAccount:
 *   STOA_AUTONOMIC_OURONETGASSTATION` with the `DALOS.GAS_PAYER` capability on
 *   the caps signer (`SendStoaModal.tsx:245-247`).
 * - The sender's own signer carries an **explicit** `coin.TRANSFER` clist
 *   (`SendStoaModal.tsx:551-558`). This is not cosmetic.
 *   `buildGasStationTransaction`'s doc comment records the live-reported
 *   "Managed capability coin.TRANSFER was not installed" that omitting it
 *   produced: an unscoped guard signer authorizes a plain `enforce-guard`
 *   check, but Pact only pre-installs a `@managed` capability when SOME
 *   signer's `clist` declares it with matching arguments. That helper made
 *   `guardCapabilities` REQUIRED specifically so a third caller could not
 *   reintroduce the gap. This module is that third caller.
 */

import { calculateAutoGasLimit, stoaGasMeta } from "@stoachain/stoa-core/gas";
import { formatDecimalForPact, safeCreationTime } from "@stoachain/stoa-core/pact";
import { Pact } from "@stoachain/kadena-stoic-legacy/client";
import { createSimulationError, logDetailedError } from "@stoachain/stoa-core/errors";
import { KADENA_NETWORK as STOACHAIN_NETWORK } from "@stoachain/stoa-core/constants";
import {
  KADENA_NAMESPACE as STOACHAIN_NAMESPACE,
  STOA_AUTONOMIC_OURONETGASSTATION,
} from "@ouronet/ouronet-core/constants";
import type { IKeyset } from "@stoachain/stoa-core/guard";

// ─── Account-name rules (shared with crossChainStoaTransfer.ts) ──────────────

/** `k:<64 hex>` — the only receiver shape that can be auto-created, because
 *  its keyset is derivable from the address itself. Same regex
 *  `SendStoaModal.tsx:107` declares; ONE copy, imported by both movers and by
 *  the modal, so the rule cannot drift between them. */
export const K_ACCOUNT_RX = /^k:[0-9a-fA-F]{64}$/;

/** Every real Pact/Chainweb account name is drawn from this charset (see
 *  `coin-live.pact`'s own `validate-account` regex, `^[a-zA-Z0-9_:-]{3,}$`,
 *  slightly widened here to also allow `.` for namespaced `c:`/`w:`-style
 *  accounts). The receiver is spliced directly into a Pact code STRING
 *  LITERAL below — a receiver containing a `"` could otherwise break out of
 *  that literal and append arbitrary Pact expressions, authorized by this
 *  same transaction's own signers. The engine's receiver comes from codex
 *  state rather than a text field and "cannot" be hostile; removing a defence
 *  because the current caller cannot trip it is how it gets tripped. */
export const SAFE_ACCOUNT_RX = /^[A-Za-z0-9_:.-]+$/;

/** The modal's own wording for a receiver that fails {@link SAFE_ACCOUNT_RX}
 *  (`SendStoaModal.tsx:388`), kept beside the regex so the two cannot drift. */
export const UNSAFE_RECEIVER_MESSAGE =
  "Receiver address contains characters that aren't allowed in an account name.";

/** The modal's own wording for a receiver that does not exist and is not a
 *  `k:` account (`SendStoaModal.tsx:508` before this lift). */
export const RECEIVER_NOT_AUTOCREATABLE_MESSAGE =
  "Receiver account not found — only k: accounts can be auto-created.";

/**
 * The keyset a `k:` account's address encodes. Required for the on-chain
 * `(read-keyset "ks")` in `C_TransferAnew`, and for every cross-chain
 * transfer's receiver guard. Caller must have already checked
 * {@link K_ACCOUNT_RX}.
 */
export function deriveKAccountKeyset(kAccount: string): IKeyset {
  return { keys: [kAccount.slice(2)], pred: "keys-all" };
}

// ─── How much a drain moves ──────────────────────────────────────────────────

/** Native STOA (Kadena `coin`) carries 12 decimal places. */
export const STOA_DECIMALS = 12;

/**
 * The amount a "move everything" drain sends.
 *
 * **No gas reserve is withheld, and none is needed.** Gas is paid by the
 * Ouronet Gas Station — `senderAccount: STOA_AUTONOMIC_OURONETGASSTATION`
 * holds the `DALOS.GAS_PAYER` capability on this transaction's caps signer
 * (and off chain 0 the cross-chain mover's gas comes from `stoa-xchain-gas`
 * instead). The draining account's own STOA balance is never debited for gas,
 * so withholding a reserve would strand funds on a key the account is about to
 * stop naming, with nothing left in the chain to move them: design §2's whole
 * point is that A-E run while the OLD key is still the registered one.
 *
 * **It TRUNCATES, never rounds.** `formatDecimalForPact` truncates by
 * contract, and this function hands it one more digit than STOA carries so the
 * float→decimal step cannot round the amount UP: a drain for even 1e-13 more
 * than the account holds is rejected on chain as insufficient funds, which
 * strands the whole step. Truncating leaves at most one unrepresentable
 * sub-precision crumb behind. (The modal's own display helper `fmt12` uses
 * `toFixed(12)` — fine for DISPLAY, wrong for an amount that must be payable.)
 *
 * Prefer passing the balance as a STRING, which is `@stoachain/stoa-core/pact`'s
 * own number-hygiene contract: a chain decimal round-tripped through float64
 * loses digits, and for a large balance the loss can exceed STOA's precision.
 * A `number` is accepted because `ChainStateSnapshot` carries numbers, and is
 * rendered in fixed notation first — `String(1e-7)` is `"1e-7"`, which Pact's
 * decimal lexer rejects outright.
 *
 * @throws if the balance truncates to zero. A `0.0` transfer burns gas and
 *   moves nothing; a loud refusal beats a step that reports success forever
 *   while the predicate that selected it stays true.
 */
export function drainAmountForPact(balance: number | string): string {
  const raw = typeof balance === "string" ? balance.trim() : fixedNotation(balance);
  const amount = formatDecimalForPact(raw, STOA_DECIMALS);
  if (Number(amount) === 0) {
    throw new Error(
      `Balance ${raw} is below native STOA's ${STOA_DECIMALS}-decimal minimum — there is nothing transferable to drain.`,
    );
  }
  return amount;
}

/** A non-negative finite number in plain decimal notation, carrying one digit
 *  more than STOA's precision so {@link drainAmountForPact}'s truncation has a
 *  digit to drop rather than a rounding to inherit. */
function fixedNotation(balance: number): string {
  if (!Number.isFinite(balance) || balance < 0) {
    throw new Error(`Drain balance must be a finite, non-negative number — got ${balance}.`);
  }
  return balance.toFixed(STOA_DECIMALS + 1);
}

// ─── The pact code ───────────────────────────────────────────────────────────

/**
 * `(coin.C_Transfer <sender> <receiver> <amount>)` when the receiver account
 * already exists on chain, `(coin.C_TransferAnew <sender> <receiver>
 * (read-keyset "ks") <amount>)` (create + transfer) when it does not.
 *
 * `amount` is already a Pact decimal literal — see {@link drainAmountForPact}
 * (or the modal's `formatDecimalForPact(amount)`); this builder does not
 * reformat it, so the string the signer's `coin.TRANSFER` capability declares
 * and the string in the code are provably the same one.
 */
export function buildNativeStoaTransferPactCode(args: {
  sender: string;
  receiver: string;
  amount: string;
  receiverExists: boolean;
}): string {
  return args.receiverExists
    ? `(coin.C_Transfer "${args.sender}" "${args.receiver}" ${args.amount})`
    : `(coin.C_TransferAnew "${args.sender}" "${args.receiver}" (read-keyset "ks") ${args.amount})`;
}

// ─── The submit ──────────────────────────────────────────────────────────────

/** A signing-ready keypair. Structurally `IKadenaKeypair`
 *  (`@stoachain/stoa-core/dist/signing/types.d.ts:20`), narrowed to the two
 *  fields this module passes through, so a test builds one as a literal. */
export interface NativeStoaKeypair {
  readonly publicKey: string;
  readonly privateKey: string;
}

/** The two `getFailoverClient(chainId)` members this flow uses. */
export interface NativeStoaClient {
  dirtyRead(tx: unknown): Promise<{ result: { status: string; error?: unknown }; gas?: number }>;
  submit(tx: unknown): Promise<unknown>;
}

/** The injected chain edge. REQUIRED — there is deliberately no default, so a
 *  caller that forgets it fails closed rather than reaching mainnet. */
export interface NativeStoaChainEdge {
  /** `getFailoverClient` — per chain, because the dedup contract lives in it. */
  readonly getClient: (chainId: string) => NativeStoaClient;
  /** `universalSignTransaction`, with the keypairs already resolved. */
  readonly signTransaction: (tx: unknown, keypairs: readonly NativeStoaKeypair[]) => Promise<unknown>;
}

export interface NativeStoaTransferRequest {
  /** The draining account — also the `coin.TRANSFER` capability's sender. */
  readonly sender: string;
  readonly receiver: string;
  /** Already a Pact decimal literal — see {@link drainAmountForPact}. */
  readonly amount: string;
  readonly chainId: string;
  /** From chain state, never assumed: it selects `C_Transfer` vs
   *  `C_TransferAnew`, and a wrong guess fails the whole step on chain. */
  readonly receiverExists: boolean;
  /** Signs the `coin.TRANSFER` capability for its own account. */
  readonly senderKey: NativeStoaKeypair;
  /** Signs `DALOS.GAS_PAYER` for the Ouronet Gas Station account. */
  readonly gasStationKey: NativeStoaKeypair;
}

/** The initial gas-limit guess the simulation replaces — same figure
 *  `rotatePaymentKeyLive.ts:70` starts from. */
const INITIAL_GAS_LIMIT = 2000000;

/**
 * Step B: move native STOA on one chain, through the dedup-safe pipeline.
 *
 * Returns the request key, which is a HANDLE, not evidence the transfer
 * landed — the caller gates on `awaitTxVerdict` (`./awaitConfirmation.ts`).
 *
 * Throws, rather than returning a verdict, for the two things that are not
 * flow outcomes: a refused receiver (a programming or state error — nothing
 * was submitted) and a failed simulation (the transaction cannot land, and
 * `createSimulationError` already carries the chain's own diagnosis).
 */
export async function submitNativeStoaTransfer(
  req: NativeStoaTransferRequest,
  edge: NativeStoaChainEdge,
): Promise<{ requestKey: string }> {
  if (!SAFE_ACCOUNT_RX.test(req.receiver)) throw new Error(UNSAFE_RECEIVER_MESSAGE);
  if (!req.receiverExists && !K_ACCOUNT_RX.test(req.receiver)) {
    throw new Error(RECEIVER_NOT_AUTOCREATABLE_MESSAGE);
  }

  const pactCode = buildNativeStoaTransferPactCode({
    sender: req.sender,
    receiver: req.receiver,
    amount: req.amount,
    receiverExists: req.receiverExists,
  });
  const keysetData = req.receiverExists ? undefined : deriveKAccountKeyset(req.receiver);

  const buildTransaction = (gasLimit: number): unknown => {
    let builder: any = Pact.builder.execution(pactCode);
    if (keysetData) builder = builder.addData("ks", keysetData);
    builder = builder
      .setMeta({
        senderAccount: STOA_AUTONOMIC_OURONETGASSTATION,
        chainId: req.chainId,
        gasLimit,
        // A self-contained site reads the clock itself — there is no
        // `execute()` ctx to take `creationTime` from. The second read on the
        // calibrated rebuild is harmless here (unlike a ctx-injected site,
        // where sim/real hash parity is load-bearing): `dirtyRead` is a
        // simulation, not a preflight, so only the SUBMITTED command's hash
        // matters, and `getFailoverClient.submit` reuses that one signed
        // reference across primary and fallback. Same shape as
        // `../rotatePaymentKeyLive.ts:91-96`.
        ...stoaGasMeta(safeCreationTime()),
      })
      .setNetworkId(STOACHAIN_NETWORK)
      .addSigner(req.gasStationKey.publicKey, (withCapability: any) => [
        withCapability(`${STOACHAIN_NAMESPACE}.DALOS.GAS_PAYER`, "", { int: 0 }, { decimal: "0.0" }),
      ])
      // (coin.TRANSFER sender receiver amount) — coin-live.pact's own
      // `defcap TRANSFER`, the capability BOTH `C_Transfer` and
      // `C_TransferAnew` require underneath (both wrap their body in
      // `(with-capability (TRANSFER …))`). Explicit, never bare — see this
      // module's header.
      .addSigner(req.senderKey.publicKey, (withCapability: any) => [
        withCapability("coin.TRANSFER", req.sender, req.receiver, { decimal: req.amount }),
      ]);
    return builder.createTransaction();
  };

  const { dirtyRead, submit } = edge.getClient(req.chainId);

  let transaction = buildTransaction(INITIAL_GAS_LIMIT);
  const simulation = await dirtyRead(transaction);
  if (simulation.result.status === "failure") {
    const error = createSimulationError(
      "Drain native STOA",
      simulation.result as never,
      `Sender: ${req.sender} | Receiver: ${req.receiver} | Chain: ${req.chainId} | Amount: ${req.amount}`,
    );
    logDetailedError(error);
    throw error;
  }
  if (simulation.gas) transaction = buildTransaction(calculateAutoGasLimit(simulation.gas));

  const signed = await edge.signTransaction(transaction, [req.gasStationKey, req.senderKey]);
  const descriptor = (await submit(signed)) as { requestKey?: string } | null;
  return { requestKey: descriptor?.requestKey ?? "" };
}

/**
 * The PRODUCTION wiring of {@link NativeStoaChainEdge} — the ONLY place this
 * module names the real chain functions, and a function rather than a const so
 * importing this file never touches the network. Assembled at the React
 * boundary and handed in; see this module's header for why it is not a
 * default.
 */
export function liveNativeStoaChainEdge(): NativeStoaChainEdge {
  return {
    getClient: (chainId: string): NativeStoaClient => {
      // Lazy, the same way `../toast/toastManager.ts:299` reaches its chain
      // imports: a consumer that never drains never pulls the network layer in.
      let client: NativeStoaClient | null = null;
      const resolve = async (): Promise<NativeStoaClient> => {
        if (!client) {
          const { getFailoverClient } = await import("@stoachain/stoa-core/network");
          client = getFailoverClient(chainId) as unknown as NativeStoaClient;
        }
        return client;
      };
      return {
        dirtyRead: async (tx) => (await resolve()).dirtyRead(tx),
        submit: async (tx) => (await resolve()).submit(tx),
      };
    },
    signTransaction: async (tx, keypairs) => {
      const { universalSignTransaction, fromKeypair } = await import("@stoachain/stoa-core/signing");
      return universalSignTransaction(tx as never, keypairs.map((k) => fromKeypair(k as never)));
    },
  };
}
