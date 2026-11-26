/**
 * collectUnstakeUrStoa — step C of the migration chain, as ONE transaction
 * (docs/work/migration-execute-keyset/design.md §1).
 *
 *   (coin.C_URV|Collect "<old payment address>")
 *   (coin.C_URV|Unstake "<old payment address>" <staked amount>)
 *
 * The engine used to send only the second line (`urStoaOps.ts`'s
 * `unstakeUrStoa`), so the rewards it had already READ
 * (`URC_URV|ClaimableRewards`) were left on a key the account was about to
 * stop naming. Modelled on `executeCollectUrStoa`
 * (`@ouronet/ouronet-core/dist/interactions/urStoaFunctions.js:436-475`), the
 * in-repo precedent for a multi-expression gas-station-sponsored transaction.
 *
 * ## The four contract facts this shape is built on
 *
 * All four were re-verified against the checked-out on-chain Pact source for
 * this module (NOT taken on faith from the design), and all four are
 * load-bearing:
 *
 * 1. **Collect does NOT change the staked balance**, so the amount read
 *    BEFORE the transaction is still correct when Unstake runs inside it.
 *    `C_URV|Collect`'s whole body (`coin-live.pact:1467-1488`) is
 *    `C_Transmit` + `ResetPendingRewards` + `UpdateUnclaimedCount` +
 *    `UpdateUserRPS` + `UpdateVaultSupply`; it never calls
 *    `XI_URV|UpdateUserScore` (`:1609-1625`), which is the ONLY writer of the
 *    `user-supply` field `UR_URV|UserSupply` (`:1300-1307`) reads — and that
 *    writer is called from exactly two places, `C_URV|Stake:1426` and
 *    `C_URV|Unstake:1454`. (The remaining `"user-supply"` occurrences are a
 *    `with-default-read` at `:1303-1304`, the pure object constructor
 *    `UDC_URV|UserData:1356`, and genesis's own `insert` at `:1515`.)
 *    Design §1's open question, closed by evidence.
 * 2. **The Collect row is CONDITIONAL on `collectRewards`.** `C_Transmit`
 *    (`:593-598`) reaches `debit` (`:708-721`), which enforces `UEV_Amount`
 *    (`:414-418`, `(enforce (> amount 0.0))`). A Collect with ZERO claimable
 *    rewards therefore fails the whole transaction and would take the unstake
 *    down with it — i.e. an unconditional merge would break step C for every
 *    account with no pending rewards, which is the common case.
 * 3. **Two forms, both `(coin.C_`, is the ONLY sponsored shape this fits, and
 *    `C_CreateAccount` can NEVER be bundled.** `DALOS.GAS_PAYER`
 *    (`1_SOVEREIGN/STAGE_01/2_Core/01_DALOS.pact:456-526`) races three cases:
 *    ONE form starting `(coin.C_`/`(ouronet-ns.TS`/`(ouronet-ns.DSP`/
 *    `(ouronet-ns.STOAICO.` (`:470-485`); exactly TWO forms, BOTH `(coin.C_`
 *    (`:487-496`, whose own comment names the example "CreateAccount +
 *    Collect"); or THREE+ beginning `(namespace "ouronet-ns")` plus a
 *    ≥25-IGNIS `DPTF|C_Transmute` donation plus a `(let` (`:514-524`). So
 *    Collect+Unstake is Case 2 and Unstake alone is Case 1 — but THREE
 *    `(coin.C_` forms match no case at all. `executeCollectUrStoa` prepends
 *    `(coin.C_CreateAccount …)` when the coin account is absent
 *    (`urStoaFunctions.js:441-443`) because `C_Transmit` → `credit` →
 *    `UR_Guard` (`coin-live.pact:335-337`) is a bare `read` that THROWS on a
 *    missing row; that repair is unavailable here. The CALLER therefore
 *    passes `collectRewards: false` when the old payment address has no coin
 *    account: unstake-only is one form, and the rewards stay claimable for
 *    later rather than taking the unstake down.
 * 4. **Both capabilities on one signer is correct.** `URV|UNSTAKE`
 *    (`coin-live.pact:1251`) and `URV|COLLECT` (`:1269`) are both `@managed`
 *    with no manager function, so each is brought into scope once per
 *    transaction.
 *
 * For the reader who sees step C fail on chain: `URV|UNSTAKE` itself enforces
 * `vault-remaining >= 1.0` (`:1261`), so a FULL unstake by the vault's last
 * staker is refused by the contract, not by this code. The engine reports it
 * like any other failure.
 *
 * ## "Gas station" means the gas-station ACCOUNT, not a gas-station secret
 *
 * `senderAccount` is `STOA_AUTONOMIC_OURONETGASSTATION` and the signer holds
 * `DALOS.GAS_PAYER`, so the transaction is genuinely sponsored — but this
 * family is PATRONLESS (docs/work/stoa-urstoa-vault-actions/design.md
 * decision 1, restated at `urStoaOps.ts:39-49`): the key that SIGNS
 * `DALOS.GAS_PAYER` is the ACCOUNT'S OWN payment keypair. Upstream calls that
 * parameter `gasStationKey`, which has sent more than one reader looking for a
 * station secret that does not exist; here it is {@link
 * CollectUnstakeRequest.paymentKey}. Design §1's "the gas-station key carrying
 * all three" and "sponsored by the gas station" are both true, of two
 * different things.
 *
 * ## The injected chain edge — read before adding an import here
 *
 * `getFailoverClient(chainId).submit` is a REAL mainnet broadcast, and this
 * one moves a user's entire staked urSTOA plus their claimable rewards. So it
 * is NOT reachable through a module-level import a test cannot displace:
 * {@link collectAndUnstakeUrStoa} takes its client factory and its signer on
 * a REQUIRED {@link CollectUnstakeChainEdge} argument with no default, and
 * `tests/execute-collect-unstake-urstoa.test.ts` passes a synthetic edge and
 * contains not one `vi.mock`. A dropped mock fails OPEN onto mainnet; a
 * required seam with no default cannot.
 *
 * Like `nativeStoaTransfer.ts`, this is a SELF-CONTAINED submit site
 * (`getFailoverClient` → `dirtyRead` → `calculateAutoGasLimit` → rebuild →
 * sign → submit) rather than a `CodexSigningStrategy.execute()` one, for the
 * reason that file's header records: `execute()`'s own doc comment
 * (`@stoachain/stoa-core/dist/signing/codexStrategy.js:39-56`) says it has NO
 * dedup safety on retry, and the migration chain is a thing the user
 * RE-PRESSES. `tests/tx-gas-meta-surface.test.ts` lists this file under
 * `SELF_CONTAINED_TX_SITES`. (That scan inventories files by plain
 * source-text search for the meta-setting call and extracts the following
 * object literal, so that literal text must appear here EXACTLY once: at the
 * real call. Do not write it in a comment.)
 */

import { calculateAutoGasLimit, stoaGasMeta } from "@stoachain/stoa-core/gas";
import { formatDecimalForPact, safeCreationTime } from "@stoachain/stoa-core/pact";
import { Pact } from "@stoachain/kadena-stoic-legacy/client";
import { createSimulationError, logDetailedError } from "@stoachain/stoa-core/errors";
import {
  KADENA_CHAIN_ID as STOACHAIN_CHAIN_ID,
  KADENA_NETWORK as STOACHAIN_NETWORK,
} from "@stoachain/stoa-core/constants";
import {
  KADENA_NAMESPACE as STOACHAIN_NAMESPACE,
  STOA_AUTONOMIC_OURONETGASSTATION,
} from "@ouronet/ouronet-core/constants";

import { URSTOA_PRECISION } from "./urStoaOps.js";
import {
  SAFE_ACCOUNT_RX,
  liveNativeStoaChainEdge,
  type NativeStoaChainEdge,
} from "./nativeStoaTransfer.js";

/** The refusal for an account name that cannot be safely spliced into a Pact
 *  string literal. Same rule (`SAFE_ACCOUNT_RX`) and same wording shape as
 *  `nativeStoaTransfer.ts:103`'s receiver refusal — one regex, two messages,
 *  because the roles differ. The address here comes from codex state rather
 *  than a text field and "cannot" be hostile; removing a defence because the
 *  current caller cannot trip it is how it gets tripped. */
export const UNSAFE_VAULT_ACCOUNT_MESSAGE =
  "Account address contains characters that aren't allowed in an account name.";

/** A signing-ready keypair, narrowed to the two fields this module passes
 *  through (structurally `IKadenaKeypair`), so a test builds one as a
 *  literal. Narrowing the TYPE strips nothing at runtime: the object itself
 *  reaches `fromKeypair`, so a chainweaver/ecko keypair keeps its extra
 *  fields. */
export interface CollectUnstakeKeypair {
  readonly publicKey: string;
  readonly privateKey: string;
}

/** The two `getFailoverClient(chainId)` members this flow uses. */
export interface CollectUnstakeClient {
  dirtyRead(tx: unknown): Promise<{ result: { status: string; error?: unknown }; gas?: number }>;
  submit(tx: unknown): Promise<unknown>;
}

/** The injected chain edge. REQUIRED — there is deliberately no default, so a
 *  caller that forgets it fails closed rather than reaching mainnet. */
export interface CollectUnstakeChainEdge {
  /** `getFailoverClient` — per chain, because the dedup contract lives in it. */
  readonly getClient: (chainId: string) => CollectUnstakeClient;
  /** `universalSignTransaction`, with the keypairs already resolved. */
  readonly signTransaction: (
    tx: unknown,
    keypairs: readonly CollectUnstakeKeypair[],
  ) => Promise<unknown>;
}

export interface CollectUnstakeRequest {
  /** The OLD payment address — the only address involved: unstake has no
   *  destination, and Collect credits the account itself. */
  readonly paymentKeyAddress: string;
  /** The staked figure, as a STRING (`@stoachain/stoa-core/pact`'s
   *  number-hygiene contract: a chain decimal round-tripped through float64
   *  loses digits). Truncated to urSTOA's 3 decimals here — see
   *  {@link buildCollectUnstakePactCode}. */
  readonly amount: string;
  /**
   * Whether to prepend the Collect row. `true` ONLY when the caller knows
   * there are rewards to collect AND the address has a coin account — see
   * facts 2 and 3 in this module's header. It is NOT an amount: Collect takes
   * no argument and pays out whatever is claimable at execution time.
   */
  readonly collectRewards: boolean;
  /** The account's OWN payment keypair: it signs `DALOS.GAS_PAYER` *and* both
   *  `coin.URV|*` capabilities. Patronless — see this module's header. */
  readonly paymentKey: CollectUnstakeKeypair;
}

/** The initial gas-limit guess the simulation replaces — the same figure
 *  `urStoaFunctions.js:386` and `nativeStoaTransfer.ts:244` start from. */
const INITIAL_GAS_LIMIT = 2000000;

/**
 * Step C's pact code: Collect THEN Unstake when `collectRewards`, Unstake
 * alone when not.
 *
 * The ORDER is the whole point and a swapped pair is a silent regression:
 * Collect pays out NATIVE STOA (`C_Transmit` is `debit`+`credit` on the
 * coin-table), so the rewards must be released before the chain's later rows
 * drain that balance.
 *
 * `amount` is already a Pact decimal literal, truncated to
 * {@link URSTOA_PRECISION} decimals by {@link collectAndUnstakeUrStoa} (one
 * imported constant, not a second literal 3; `formatDecimalForPact` truncates
 * rather than rounds, because rounding UP would ask the vault for more than is
 * staked). This builder does not reformat it — the same discipline
 * `nativeStoaTransfer.ts:185-188` states for the same reason: the string in
 * the code and the string the signer's `coin.URV|UNSTAKE` capability declares
 * are then provably the same one.
 */
export function buildCollectUnstakePactCode(args: {
  account: string;
  amount: string;
  collectRewards: boolean;
}): string {
  const unstake = `(coin.C_URV|Unstake "${args.account}" ${args.amount})`;
  return args.collectRewards
    ? `(coin.C_URV|Collect "${args.account}")\n${unstake}`
    : unstake;
}

/**
 * Step C: collect the pending rewards and unstake, in ONE
 * gas-station-sponsored transaction.
 *
 * Returns the request key, which is a HANDLE, not evidence the transaction
 * landed — the caller gates on `awaitTxVerdict` (`./awaitConfirmation.ts`).
 *
 * Throws, rather than returning a verdict, for the two things that are not
 * flow outcomes: an unsafe account name (a programming or state error —
 * nothing was submitted) and a failed simulation (the transaction cannot
 * land, and `createSimulationError` already carries the chain's own
 * diagnosis, including `URV|UNSTAKE`'s "At least 1.0 URSTOA must remain" and
 * Collect's zero-reward `debit` refusal).
 */
export async function collectAndUnstakeUrStoa(
  req: CollectUnstakeRequest,
  edge: CollectUnstakeChainEdge,
): Promise<{ requestKey: string }> {
  if (!SAFE_ACCOUNT_RX.test(req.paymentKeyAddress)) throw new Error(UNSAFE_VAULT_ACCOUNT_MESSAGE);

  const amount = formatDecimalForPact(req.amount, URSTOA_PRECISION);
  const pactCode = buildCollectUnstakePactCode({
    account: req.paymentKeyAddress,
    amount,
    collectRewards: req.collectRewards,
  });

  const buildTransaction = (gasLimit: number): unknown =>
    Pact.builder
      .execution(pactCode)
      .setMeta({
        // The gas-station ACCOUNT, sponsoring under `DALOS.GAS_PAYER`'s
        // Case 2 (two forms, both `(coin.C_`) or Case 1 (one such form).
        senderAccount: STOA_AUTONOMIC_OURONETGASSTATION,
        // urSTOA lives on chain 0 only — every `UR_URV|*` read enforces
        // `UEV_ChainZero` — so this is a constant, not a parameter a caller
        // can get wrong.
        chainId: STOACHAIN_CHAIN_ID,
        gasLimit,
        // A self-contained site reads the clock itself: there is no
        // `execute()` ctx to take `creationTime` from. The second read on the
        // calibrated rebuild is harmless — `dirtyRead` is a simulation, not a
        // preflight, so only the SUBMITTED command's hash matters, and
        // `getFailoverClient.submit` reuses that one signed reference across
        // primary and fallback. Same shape as `nativeStoaTransfer.ts:290`.
        ...stoaGasMeta(safeCreationTime()),
      })
      .setNetworkId(STOACHAIN_NETWORK)
      // ONE signer, two or three capabilities — `urStoaFunctions.js:388-391`'s
      // unstake block with `:453-456`'s Collect capability folded in.
      // `coin.URV|COLLECT` is omitted exactly when the Collect row is: an
      // uninstalled managed capability on the wire is a signature over
      // something the code never requires.
      .addSigner(req.paymentKey.publicKey, (withCapability: any) => [
        withCapability(`${STOACHAIN_NAMESPACE}.DALOS.GAS_PAYER`, "", { int: 0 }, { decimal: "0.0" }),
        ...(req.collectRewards
          ? [withCapability("coin.URV|COLLECT", req.paymentKeyAddress)]
          : []),
        withCapability("coin.URV|UNSTAKE", req.paymentKeyAddress, { decimal: amount }),
      ])
      .createTransaction();

  const { dirtyRead, submit } = edge.getClient(STOACHAIN_CHAIN_ID);

  let transaction = buildTransaction(INITIAL_GAS_LIMIT);
  const simulation = await dirtyRead(transaction);
  if (simulation.result.status === "failure") {
    const error = createSimulationError(
      req.collectRewards ? "Collect + Unstake UrStoa" : "Unstake UrStoa",
      simulation.result as never,
      `Account: ${req.paymentKeyAddress} | Amount: ${amount} | Collect: ${req.collectRewards}`,
    );
    logDetailedError(error);
    throw error;
  }
  if (simulation.gas) transaction = buildTransaction(calculateAutoGasLimit(simulation.gas));

  const signed = await edge.signTransaction(transaction, [req.paymentKey]);
  const descriptor = (await submit(signed)) as { requestKey?: string } | null;
  return { requestKey: descriptor?.requestKey ?? "" };
}

/**
 * The PRODUCTION wiring of {@link CollectUnstakeChainEdge}. It DELEGATES to
 * `nativeStoaTransfer.ts`'s factory rather than copying its lazy-import body:
 * the real chain functions stay named in exactly ONE place for this whole
 * directory, which is the property the mainnet-hazard rule actually wants. A
 * function rather than a const, so importing this file never touches the
 * network; assembled at the React boundary and handed in.
 */
export function liveCollectUnstakeChainEdge(): CollectUnstakeChainEdge {
  const edge: NativeStoaChainEdge = liveNativeStoaChainEdge();
  return edge;
}
