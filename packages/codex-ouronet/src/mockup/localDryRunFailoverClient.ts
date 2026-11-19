/**
 * `createLocalDryRunFailoverClient` — a shippable (production, not test-only)
 * local/no-op StoaChain/Kadena transaction client, built for
 * `legacy-prime-migration-mockup` T2.
 *
 * PURPOSE: the real chain-call seam every signing flow in this package goes
 * through is `@stoachain/stoa-core/network`'s `getFailoverClient(chainId)`,
 * which returns `{ dirtyRead, submit, listen, pollOne }` (confirmed by
 * reading `@stoachain/stoa-core/dist/network/failoverClient.js` directly —
 * see `rotatePaymentKeyLive.ts` for a real consumer: `const { dirtyRead,
 * submit } = getFailoverClient(STOACHAIN_CHAIN_ID)`, then `dirtyRead(tx)`
 * to simulate before signing and `submit(signedTx)` to post). This module
 * is a drop-in stand-in for the `{ dirtyRead, submit }` slice of that same
 * shape — a caller injects it in place of the real factory's return (e.g.
 * the mockup wizard's Page 4/5 execution path) so the real construction/
 * signing code runs completely unmodified, but every `submit` is captured
 * in memory instead of ever reaching a Kadena node.
 *
 * CAPTURE MODEL: one shared in-memory log per `createLocalDryRunFailoverClient()`
 * call (not module-global — a fresh client per mockup session, mirroring
 * `createLocalDryRunGatewayApiFactory`'s own per-call-scoped maps), exposed
 * directly on the returned object as `getSubmittedTransactions()` — chosen
 * over a bare module-level export so inspection stays scoped to the one
 * client instance a caller actually holds, the same discipline
 * `localDryRunGateway.ts` uses for its own `getCapturedTx`/`getCapturedChunks`.
 * Each `submit` call appends one `{ requestKey, transaction }` entry,
 * keeping the SAME `transaction` reference passed in — no rebuild, no
 * clone, no re-create, mirroring the real `getFailoverClient`'s own
 * request-key dedup contract (see `failoverClient.js`'s doc comment on
 * `submit`), even though this client never actually dedups against a
 * mempool.
 *
 * ZERO NETWORK, BY CONSTRUCTION: this file imports no `fetch`, no
 * `createClient` (or any other value) from `@stoachain/kadena-stoic-legacy/
 * client` or `@stoachain/stoa-core` — only TYPE-ONLY imports (erased at
 * compile time) for the real `IUnsignedCommand`/`ICommand`/`ICommandResult`
 * shapes. Self-check: `grep -nE "fetch|createClient|\\bhttp\\b|\\bhttps\\b|
 * XMLHttpRequest" src/mockup/localDryRunFailoverClient.ts` must match
 * nothing outside this comment.
 *
 * RESPONSE REALISM:
 *   - `dirtyRead` resolves a full `ICommandResult` — `reqKey` echoes the
 *     given transaction's own `hash` (exactly what a real simulation's
 *     `reqKey` would be, since it's always the submitted command's hash),
 *     `result` is a fixed `{ status: "success", data: <plausible string> }`,
 *     and `gas` is a fixed, plausible gas-unit count. This client does not
 *     run the real Pact simulator, so it cannot detect a genuinely
 *     malformed transaction the way a real `dirtyRead` would — every
 *     well-formed-shaped input it's given resolves successfully.
 *   - `submit` resolves `{ requestKey }`: a synthetic-but-realistic,
 *     base64url-alphabet, 43-char string (the same length convention
 *     `localDryRunGateway.ts`'s own `DRY_RUN_ANCHOR` fixture uses), made
 *     distinct per call via an internal counter so no two submissions in
 *     the same client ever collide.
 */

import type { IUnsignedCommand, ICommand, ICommandResult } from "@stoachain/kadena-stoic-legacy/client";

/** Fixed, plausible gas-unit count — this client never runs a real Pact
 *  simulation, so it cannot compute a genuine gas estimate. */
const SYNTHETIC_GAS_UNITS = 1500;

/** Prefix for synthetic `requestKey`s, padded to the real request-key's
 *  43-char base64url-alphabet length (mirrors `DRY_RUN_ANCHOR`'s own
 *  padding convention in `localDryRunGateway.ts`). */
const REQUEST_KEY_PREFIX = "LocalDryRunRequestKey";

/** One `submit` call, captured verbatim for later inspection. */
export interface SubmittedDryRunTransaction {
  requestKey: string;
  transaction: ICommand;
}

/** The value {@link createLocalDryRunFailoverClient} returns. */
export interface LocalDryRunFailoverClient {
  /**
   * Simulates `transaction` without contacting any real node — resolves a
   * realistic `ICommandResult` whose `result.status` is always `"success"`.
   * See this module's "RESPONSE REALISM" doc paragraph for exactly which
   * fields are real-echoed (`reqKey`) vs. fixed (`result`/`gas`).
   */
  dirtyRead(transaction: IUnsignedCommand, callOpts?: { readTimeoutMs?: number }): Promise<ICommandResult>;
  /**
   * Never touches the network. Records `transaction` verbatim (the same
   * reference, not a clone) into this client's in-memory log and resolves a
   * synthetic-but-realistic `requestKey`, distinct per call.
   */
  submit(transaction: ICommand, callOpts?: { submitTimeoutMs?: number }): Promise<{ requestKey: string }>;
  /**
   * Every `submit` call this client has recorded so far, in call order.
   * Empty if `submit` was never called (or after `reset()`).
   */
  getSubmittedTransactions(): SubmittedDryRunTransaction[];
  /** Clears the submitted-transaction log back to empty. */
  reset(): void;
}

/**
 * Builds the shippable local/no-op StoaChain/Kadena client: `dirtyRead`
 * resolves a realistic success simulation, `submit` resolves a synthetic
 * `requestKey` and records the call — nothing it does can ever reach a real
 * Kadena node or spend real KDA.
 */
export function createLocalDryRunFailoverClient(): LocalDryRunFailoverClient {
  let submittedTransactions: SubmittedDryRunTransaction[] = [];
  let requestKeyCounter = 0;

  return {
    async dirtyRead(transaction: IUnsignedCommand): Promise<ICommandResult> {
      return {
        reqKey: transaction.hash,
        txId: null,
        result: {
          status: "success",
          data: "Local dry run: no real node contacted",
        },
        gas: SYNTHETIC_GAS_UNITS,
        logs: null,
        continuation: null,
        metaData: null,
      };
    },

    async submit(transaction: ICommand): Promise<{ requestKey: string }> {
      requestKeyCounter += 1;
      const requestKey = `${REQUEST_KEY_PREFIX}${requestKeyCounter}`.padEnd(43, "0");
      submittedTransactions.push({ requestKey, transaction });
      return { requestKey };
    },

    getSubmittedTransactions(): SubmittedDryRunTransaction[] {
      return [...submittedTransactions];
    },

    reset(): void {
      submittedTransactions = [];
      requestKeyCounter = 0;
    },
  };
}
