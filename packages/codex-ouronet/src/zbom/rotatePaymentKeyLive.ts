/**
 * rotatePaymentKeyLive — LOCAL replacement for `@ouronet/ouronet-core`'s
 * `rotateKadenaPaymentKey` (`interactions/ouroRotateFunctions.js`), confirmed
 * broken against the NOW-DEPLOYED `ouronet-ns.TS01-C1.DALOS|C_RotateStoa`,
 * found 2026-09-26 auditing every Ouronet execute flow's wiring after an
 * owner-reported failure on a sibling modal (Release StoicTag's own EXECUTE
 * call, see `stoicTagExecOps.ts`, was hit by the SAME "patron/executor
 * canon" rehaul).
 *
 * ROOT CAUSE, confirmed directly against mainnet via `describe-module
 * "ouronet-ns.TS01-C1"` (chain 0): `DALOS|C_RotateKadena` was RENAMED to
 * `DALOS|C_RotateStoa` (part of the broader Kadena→Stoa rename this rehaul
 * carried out across the module) — arg count/order UNCHANGED
 * `(patron executor stoa)`, only the function name moved. Confirmed live:
 *   `(…C_RotateKadena "k:test" "k:test2" "k:test3")` →
 *     `"Module ouronet-ns.TS01-C1 has no such member: DALOS|C_RotateKadena"`
 *
 * `@ouronet/ouronet-core`'s `rotateKadenaPaymentKey`, confirmed at latest
 * published version, still emits `C_RotateKadena` — every submit would fail
 * as a RESOLUTION error at the `dirtyRead` simulation step, before ever
 * reaching signing. This had been MASKED until now: the modal's own INFO
 * read (`getRotateKadenaInfo`, ALSO stale — see `ouroSelectorReads.ts`'s
 * `getRotateStoaChainInfoLive`) kept `canExecute` permanently false, so this
 * function was never actually invoked.
 *
 * This is a byte-for-byte mirror of the external function's ENTIRE flow
 * (gas estimation, `.addData` keyset payloads, signer collection, dirty-read
 * simulation, universal sign, submit) — only the one Pact-code line is
 * fixed. Delete this file (and re-point `RotatePaymentKeyModal` back to
 * `@ouronet/ouronet-core/interactions/ouroRotateFunctions`) the day that
 * package ships a `C_RotateStoa`-compatible release.
 */

import { calculateAutoGasLimit, stoaGasMeta } from "@stoachain/stoa-core/gas";
import { safeCreationTime } from "@stoachain/stoa-core/pact";
import { Pact } from "@stoachain/kadena-stoic-legacy/client";
import { getFailoverClient } from "@stoachain/stoa-core/network";
import { universalSignTransaction, fromKeypair } from "@stoachain/stoa-core/signing";
import { createSimulationError, logDetailedError } from "@stoachain/stoa-core/errors";
import { KADENA_CHAIN_ID as STOACHAIN_CHAIN_ID, KADENA_NETWORK as STOACHAIN_NETWORK } from "@stoachain/stoa-core/constants";
import { KADENA_NAMESPACE as STOACHAIN_NAMESPACE, STOA_AUTONOMIC_OURONETGASSTATION } from "@ouronet/ouronet-core/constants";
import type { ICommand } from "@stoachain/kadena-stoic-legacy/client";
import type { IKadenaKeypair as RotateKeypair } from "@stoachain/stoa-core/signing";

interface RotateGuardLike {
  keys?: string[];
  pred?: string;
}

/**
 * Rotate the Stoa Chain payment key (formerly "Kadena Ledger") of an
 * Ouronet account.
 *
 *   (ouronet-ns.TS01-C1.DALOS|C_RotateStoa <patron> <executor> <new-payment-key>)
 *
 * Requires two signers: the patron's guard key (pays IGNIS, holds
 * GAS_PAYER) and the target account's guard key (ownership proof) — the
 * same as before this fix; only the Pact function name changed.
 */
export async function rotateStoaChainPaymentKeyLive(
  patronAddress: string,
  accountAddress: string,
  newPaymentKey: string,
  gasStationKey: RotateKeypair,
  patronGuardKeys: RotateKeypair[],
  accountGuardKeys: RotateKeypair[],
  patronGuard?: RotateGuardLike | null,
  accountGuard?: RotateGuardLike | null,
): Promise<{ requestKey?: string;[k: string]: unknown }> {
  let gasLimit = 2000000;

  const allSigners: RotateKeypair[] = [gasStationKey];
  const addedPubs = new Set<string>([gasStationKey.publicKey]);
  for (const k of [...patronGuardKeys, ...accountGuardKeys]) {
    if (!addedPubs.has(k.publicKey)) {
      allSigners.push(k);
      addedPubs.add(k.publicKey);
    }
  }

  const buildTransaction = (gasLimitOverride?: number) => {
    let builder: any = Pact.builder
      .execution(`(${STOACHAIN_NAMESPACE}.TS01-C1.DALOS|C_RotateStoa "${patronAddress}" "${accountAddress}" "${newPaymentKey}")`);

    if (patronGuard) {
      builder = builder.addData("ks", { keys: patronGuard.keys, pred: patronGuard.pred });
    }
    if (accountGuard && accountAddress !== patronAddress) {
      builder = builder.addData("ks-account", { keys: accountGuard.keys, pred: accountGuard.pred });
    }

    builder = builder
      .setMeta({
        senderAccount: STOA_AUTONOMIC_OURONETGASSTATION,
        chainId:       STOACHAIN_CHAIN_ID,
        gasLimit:      gasLimitOverride || gasLimit,
        ...stoaGasMeta(safeCreationTime()),
      })
      .setNetworkId(STOACHAIN_NETWORK)
      .addSigner(gasStationKey.publicKey, (withCapability: any) => [
        withCapability(`${STOACHAIN_NAMESPACE}.DALOS.GAS_PAYER`, "", { int: 0 }, { decimal: "0.0" }),
      ]);

    const addedSignerPubs = new Set<string>([gasStationKey.publicKey]);
    for (const k of patronGuardKeys) {
      if (!addedSignerPubs.has(k.publicKey)) {
        builder = builder.addSigner(k.publicKey);
        addedSignerPubs.add(k.publicKey);
      }
    }
    for (const k of accountGuardKeys) {
      if (!addedSignerPubs.has(k.publicKey)) {
        builder = builder.addSigner(k.publicKey);
        addedSignerPubs.add(k.publicKey);
      }
    }
    return builder.createTransaction();
  };

  const { dirtyRead, submit } = getFailoverClient(STOACHAIN_CHAIN_ID);
  let transaction = buildTransaction();
  const simulation = await dirtyRead(transaction);
  if (simulation.result.status === "failure") {
    const error = createSimulationError(
      "Rotate Payment Key",
      simulation.result,
      `Patron: ${patronAddress} | Account: ${accountAddress} | New Key: ${newPaymentKey}`,
    );
    logDetailedError(error);
    throw error;
  }
  const requiredGas = simulation.gas;
  if (requiredGas) {
    gasLimit = calculateAutoGasLimit(requiredGas);
    transaction = buildTransaction(gasLimit);
  }

  const signedTransaction = await universalSignTransaction(
    transaction,
    allSigners.map((s) => fromKeypair(s as any)),
  );
  // universalSignTransaction's return type is the union `IUnsignedCommand |
  // ICommand` (it can't statically know every signer resolved), but every
  // signer here IS resolved by construction — mirrors the external
  // function's own untyped JS behavior.
  return await submit(signedTransaction as ICommand) as any;
}
