/**
 * urStoaOps — steps D and E of the migration chain (and C's superseded
 * primitive), callable with no React anywhere in the call stack.
 *
 * `coin.C_URV|Unstake`, `coin.C_UR|Transfer` and `coin.C_URV|Stake` all
 * shipped long ago, but until now each was reachable only by mounting a modal
 * (`ui/internal/UnstakeUrStoaModal.tsx`, `TransferUrStoaModal.tsx`,
 * `StakeUrStoaModal.tsx`) and having a human press Execute. This module is the
 * SINGLE place the migration engine makes the `@ouronet/ouronet-core` calls
 * for **D and E**.
 *
 * ## STEP C HAS MOVED. `unstakeUrStoa` below is SUPERSEDED — do not call it
 *
 * `./collectUnstakeUrStoa.ts`'s `collectAndUnstakeUrStoa` is step C's home as
 * of docs/work/migration-execute-keyset: it sends `(coin.C_URV|Collect …)`
 * ahead of `(coin.C_URV|Unstake …)` in ONE gas-station-sponsored transaction
 * (two `(coin.C_` forms — `DALOS.GAS_PAYER`'s Case 2,
 * `01_DALOS.pact:487-496`), so a key with pending rewards does not have them
 * stranded by the unstake. `PendingKeyChangesSection.tsx`'s
 * `submitUnstakeUrStoa` points there, and it was this function's last caller.
 *
 * {@link unstakeUrStoa} therefore has NO production caller and is the LOSSY
 * variant: it unstakes and leaves whatever `URC_URV|ClaimableRewards` reports
 * behind on a key the account stops naming at step F. A new caller must take
 * the collecting one. It survives here only because
 * `tests/execute-engine.test.ts:1487-1499` pins the `zbom/execute` barrel's
 * export inventory BY NAME and lists `"unstakeUrStoa"`, and that spec is
 * outside the `- files:` list of the task that moved C — so removing the
 * function needs that lock amended in the same change. Its own tests below
 * stay: it is still live, reachable code.
 *
 * ## The injected chain edge — read before adding an import here
 *
 * The executors submit REAL transactions through
 * `getFailoverClient(...).submit`
 * (`@ouronet/ouronet-core/dist/interactions/urStoaFunctions.js:359,393,463` —
 * `:359` is the transfer, `:393` the stake, `:463` the unstake whose caller
 * has moved), and the receiver probe reads through `pactRead`, which
 * initialises to the LIVE network. The engine fires these unattended, so NONE
 * of them is imported here: each function takes its executor, its `getKeypair`
 * and its receiver probe on an explicit `deps` argument, exactly as
 * `guards/resolveGuardKeys.ts` takes `describeKeyset`. Production names the
 * real functions once, at the React boundary;
 * `tests/execute-urstoa-ops.test.ts` passes synthetic ones and contains not
 * one `vi.mock` — a dropped mock fails open onto mainnet, an injected seam
 * cannot.
 *
 * The only runtime import is `formatDecimalForPact`: pure string
 * canonicalisation, no network of any kind. `URSTOA_PRECISION` is exported
 * from here and imported by `./collectUnstakeUrStoa.ts`, so the 3-decimal
 * truncation rule stays one constant across both of C's shapes.
 *
 * ## C→D→E is forced, not chosen
 *
 * `UnstakeUrStoaParams` and `StakeUrStoaParams` are
 * `{ paymentKeyAddress, amount, gasStationKey }` and carry **no destination** —
 * staking acts on the account itself. No primitive moves staked urSTOA between
 * keys, so moving it is necessarily unstake at the source, transfer, re-stake
 * at the destination (design.md §2). These signatures deliberately do not
 * pretend otherwise: neither `unstakeUrStoa` nor `stakeUrStoa` accepts a
 * receiver.
 *
 * ## Patronless
 *
 * Per docs/work/stoa-urstoa-vault-actions/design.md decision #1 there is no
 * gas station and no Ouronet patron in this family: the payment key signs both
 * the `DALOS.GAS_PAYER` capability and the `coin.URV|*` capability, so
 * `gasStationKey` is a misleadingly-named parameter that receives the
 * account's OWN decrypted keypair. For the transfer the same keypair is
 * therefore both `paymentKeypair` and the sole `senderGuardKeys` entry (the
 * owning key of a patronless sender's own guard), and `paymentKeyAddress` is
 * the sender itself — which is why `TransferUrStoaInput` has no separate payer
 * field to get wrong.
 *
 * Per decision #2 the keypair is resolved through `getKeypair` at call time,
 * per call, and never cached: the engine's later steps sign with a different
 * key, and a cached keypair would also outlive the codex lock.
 *
 * ## Relationship to the three modals
 *
 * The modals are NOT re-pointed at this module by this task; their ~90
 * existing tests stay green byte-for-byte and a follow-up topic can collapse
 * the call sites if anyone wants one copy. What that leaves duplicated is a
 * CALL SHAPE — which argument object to build — not a decision: the
 * receiver-existence rule, the `k:`-only refusal and the 3-decimal truncation
 * now exist in exactly one place for every headless caller.
 */

import { formatDecimalForPact } from "@stoachain/stoa-core/pact";
import type {
  StakeUrStoaParams,
  UnstakeUrStoaParams,
  ExecuteNativeUrStoaParams,
} from "@ouronet/ouronet-core/interactions/urStoaFunctions";
import type { GetKeypairFn } from "@ancientpantheon/codex-ui/hooks";

/** urSTOA carries 3 decimal places. A fourth is a chain-side failure, and
 *  `formatDecimalForPact` TRUNCATES rather than rounds — rounding up could ask
 *  the vault for more than is staked. Same constant all three modals declare
 *  (`UnstakeUrStoaModal.tsx:24`, `TransferUrStoaModal.tsx:35`,
 *  `StakeUrStoaModal.tsx:34`). */
export const URSTOA_PRECISION = 3;

/** The refusal for a receiver that does not exist and cannot be created.
 *  Exported so the engine and the UI report the same words the modal already
 *  shows (`TransferUrStoaModal.tsx:146`) rather than inventing a second
 *  phrasing of one rule. */
export const RECEIVER_NOT_FOUND_MESSAGE =
  "Receiver account not found. Only k: addresses can be created automatically.";

/** What a submitted urSTOA operation hands back. `requestKey` is the handle
 *  the engine's confirmation gate polls; it is NOT evidence the transaction
 *  landed. */
export interface UrStoaSubmission {
  readonly requestKey: string;
}

/**
 * Canonicalise an amount for Pact. Amounts arrive as STRINGS, never numbers —
 * `@stoachain/stoa-core/pact`'s own number-hygiene contract: a chain amount
 * round-tripped through float64 silently loses digits. A caller holding a
 * number (a balance read, say) stringifies it deliberately at its own boundary.
 */
function urStoaAmount(amount: string): string {
  return formatDecimalForPact(amount, URSTOA_PRECISION);
}

export interface UnstakeUrStoaInput {
  /** The account doing the unstaking — also the payer, and the only address
   *  involved: unstake has no destination. */
  readonly paymentKeyAddress: string;
  /** Resolved to the signing keypair through `deps.getKeypair` at call time. */
  readonly paymentPublicKey: string;
  readonly amount: string;
}

export interface UnstakeUrStoaDeps {
  /** `executeUnstakeUrStoa` from
   *  `@ouronet/ouronet-core/interactions/urStoaFunctions`. Injected — see this
   *  module's header. */
  readonly executeUnstakeUrStoa: (params: UnstakeUrStoaParams) => Promise<UrStoaSubmission>;
  readonly getKeypair: GetKeypairFn;
}

/**
 * `(coin.C_URV|Unstake <account> <amount>)` alone. Moves urSTOA from the vault
 * to liquid on the SAME account.
 *
 * **SUPERSEDED — see this module's header.** Step C is
 * `collectAndUnstakeUrStoa` (`./collectUnstakeUrStoa.ts`), which prepends the
 * Collect row so no reward dust is stranded. This one-expression variant has
 * no production caller.
 */
export async function unstakeUrStoa(
  input: UnstakeUrStoaInput,
  deps: UnstakeUrStoaDeps,
): Promise<UrStoaSubmission> {
  const keypair = await deps.getKeypair(input.paymentPublicKey);
  return deps.executeUnstakeUrStoa({
    paymentKeyAddress: input.paymentKeyAddress,
    amount: urStoaAmount(input.amount),
    // Patronless: the payment key pays its own gas AND satisfies
    // coin.URV|UNSTAKE. Never an Ouronet patron.
    gasStationKey: keypair,
  });
}

export interface StakeUrStoaInput {
  /** The account being staked ON — for step E, the NEW payment key, which is
   *  only fundable because D already moved the liquid urSTOA there. */
  readonly paymentKeyAddress: string;
  readonly paymentPublicKey: string;
  readonly amount: string;
}

export interface StakeUrStoaDeps {
  /** `executeStakeUrStoa` from
   *  `@ouronet/ouronet-core/interactions/urStoaFunctions`. Injected. */
  readonly executeStakeUrStoa: (params: StakeUrStoaParams) => Promise<UrStoaSubmission>;
  readonly getKeypair: GetKeypairFn;
}

/** Step E — `(coin.C_URV|Stake <account> <amount>)`. */
export async function stakeUrStoa(
  input: StakeUrStoaInput,
  deps: StakeUrStoaDeps,
): Promise<UrStoaSubmission> {
  const keypair = await deps.getKeypair(input.paymentPublicKey);
  return deps.executeStakeUrStoa({
    paymentKeyAddress: input.paymentKeyAddress,
    amount: urStoaAmount(input.amount),
    gasStationKey: keypair,
  });
}

export interface TransferUrStoaInput {
  /** The sender — and, patronless, the payer too. */
  readonly senderAddress: string;
  readonly senderPublicKey: string;
  /** For step D this is the NEW payment key's address, which on a fresh codex
   *  has never existed on chain — hence the probe below. */
  readonly receiverAddress: string;
  readonly amount: string;
}

export interface TransferUrStoaDeps {
  /** `executeNativeUrStoaTransfer` from
   *  `@ouronet/ouronet-core/interactions/urStoaFunctions`. Injected. */
  readonly executeNativeUrStoaTransfer: (
    params: ExecuteNativeUrStoaParams,
  ) => Promise<UrStoaSubmission>;
  /** `checkCoinAccountExists` from the same module: `true` = exists, `null` =
   *  absent OR RPC error. Injected because it reads the live chain. */
  readonly checkCoinAccountExists: (account: string) => Promise<boolean | null>;
  readonly getKeypair: GetKeypairFn;
}

/**
 * Step D — the `coin.C_UR|Transfer` family. Moves LIQUID urSTOA between
 * accounts (OuronetUI's separate Transmit family is out of scope, so
 * `isTransferFamily` is always `true` here).
 *
 * Carries the branch logic lifted out of `TransferUrStoaModal.tsx:142-154`:
 *
 *  - the probe's `null` ("absent OR RPC error") collapses to **does not
 *    exist** — assuming existence on uncertainty picks the plain-Transfer
 *    branch, which fails on chain for a receiver that is not there, whereas
 *    TransferAnew is correct either way;
 *  - a non-existent receiver that is not a `k:` address is REFUSED here,
 *    before any transaction is built: only `k:` accounts can be created
 *    automatically from a bare public key, and there is no keyset to derive
 *    for anything else. An EXISTING non-`k:` receiver is fine — the refusal is
 *    about account CREATION, not about the address shape;
 *  - a non-existent `k:` receiver gets the single-key keyset derived from the
 *    address with the `k:` prefix stripped (ship the prefix and the new
 *    account is guarded by a key nobody holds).
 */
export async function transferUrStoa(
  input: TransferUrStoaInput,
  deps: TransferUrStoaDeps,
): Promise<UrStoaSubmission> {
  const amount = urStoaAmount(input.amount);
  const keypair = await deps.getKeypair(input.senderPublicKey);

  const receiverExists = (await deps.checkCoinAccountExists(input.receiverAddress)) === true;
  let receiverKeyset: { keys: string[]; pred: string } | undefined;
  if (!receiverExists) {
    if (!input.receiverAddress.startsWith("k:")) {
      throw new Error(RECEIVER_NOT_FOUND_MESSAGE);
    }
    receiverKeyset = { keys: [input.receiverAddress.slice(2)], pred: "keys-all" };
  }

  return deps.executeNativeUrStoaTransfer({
    senderAddress: input.senderAddress,
    receiverAddress: input.receiverAddress,
    amount,
    // Patronless: the sender IS its own payment key, and the SAME decrypted
    // keypair carries both the payer role and the sender's own guard.
    paymentKeyAddress: input.senderAddress,
    paymentKeypair: keypair,
    senderGuardKeys: [keypair],
    isTransferFamily: true,
    receiverExists,
    // Spread, not an explicit `undefined`: an existing receiver takes the
    // plain Transfer branch and carries no keyset key at all.
    ...(receiverKeyset !== undefined ? { receiverKeyset } : {}),
  });
}
