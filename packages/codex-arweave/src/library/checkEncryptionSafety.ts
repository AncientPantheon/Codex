/**
 * `checkAccountEncryptedArweaveUploads` — the chain-query safety net for the
 * `arweave-non-removable-account` invariant (Topic 1 of
 * `arweave-account-safety`).
 *
 * **This is a normative contract, not a description.** This module exists
 * because this project has TWICE now seen a host app silently skip exactly
 * this kind of sanctioned seam — nothing about this check is enforced by the
 * type system; it only works if the caller actually calls it.
 *
 * ## The one sanctioned entry point
 *
 * `checkAccountEncryptedArweaveUploads(pool, address, opts?)` is the
 * **entire** chain-query surface for this invariant. It answers exactly one
 * question: "has ANY confirmed Arweave upload ever been tagged
 * `Codex-Encryptor: <address>`?" — i.e. did this account ever encrypt data
 * that now permanently depends on it.
 *
 * **MUST:** a future "delete this Ouronet account" UI MUST call this
 * function — and await `true`/`false` from it — before invoking
 * `codex-ouronet`'s `deleteOuroAccount` whenever the LOCAL
 * `hasEncryptedArweaveUpload` flag on the account (a `codex-ouronet`-owned
 * field this function never reads, writes, or otherwise touches) is absent
 * or cannot be trusted. `deleteOuroAccount`'s own local-flag guard is fast,
 * synchronous, and offline — it catches the common case, but a flag that was
 * never set (e.g. an account imported from a backup taken before this
 * invariant existed, or restored on a new device that never replayed the
 * encryption event) tells you nothing. Only this chain query can answer for
 * the truly unknown case.
 *
 * **MUST NOT:**
 * - Treat an absent local flag as "safe to delete" without running this
 *   check first (or without the user having explicitly set
 *   `codex-ouronet`'s `allowDeletingArweaveEncryptedAccounts` override,
 *   which bypasses ONLY this chain-query step, never the local-flag guard).
 * - Re-implement this query by hand against `arweave-core`'s
 *   `queryUploadsByTag`/`queryOwnerUploads` directly. This function already
 *   pins the correct tag name (`Codex-Encryptor`) and the correct
 *   existence-check shape (`first: 1`); a hand-rolled call site is exactly
 *   the kind of drift this contract exists to prevent.
 * - Treat `false` as a *global* guarantee the address never encrypted
 *   anything — it means only "this gateway pool's query found no match right
 *   now." A genuine network/gateway failure (a non-2xx response, an
 *   unparseable body, pool exhaustion) is NEVER swallowed into `false` here;
 *   it propagates, so a caller can distinguish "confirmed clear" from
 *   "couldn't check" and fail safe (block deletion) in the latter case. A
 *   fail-open safety check is worse than no safety check at all.
 *
 * `codex-arweave` never imports `codex-ouronet` (the isolation this whole
 * project has maintained throughout) — this function takes the Ouronet
 * account's public address as a plain string and never touches the
 * `hasEncryptedArweaveUpload` flag itself; wiring this result back into that
 * flag or into a real delete flow is the host app's job, one layer up.
 */

import { queryUploadsByTag, TAG_CODEX_ENCRYPTOR, type GatewayPool } from "@ancientpantheon/arweave-core";

/** Options for {@link checkAccountEncryptedArweaveUploads}. */
export interface CheckAccountEncryptedArweaveUploadsOptions {
  /** Injectable fetch seam, forwarded verbatim to `queryUploadsByTag` — tests
   *  inject a fake; omitted, it defaults to the runtime-global `fetch`. */
  fetchFn?: typeof fetch;
}

/**
 * Query the chain for any confirmed Arweave upload tagged
 * `Codex-Encryptor: <address>` — i.e. "did this account ever encrypt data
 * that is now permanently on chain?"
 *
 * Delegates to `queryUploadsByTag(pool, TAG_CODEX_ENCRYPTOR, address, {
 * first: 1, fetchFn })` — `first: 1` because this is an existence check, not
 * a full list; one matching record is sufficient to answer `true`. Resolves
 * `true` iff at least one record is returned, `false` for a well-formed,
 * empty result ("no matches" is never an error). A genuine network/gateway
 * failure propagates unwrapped — see this module's own doc comment for why
 * that is deliberate, not an oversight.
 */
export async function checkAccountEncryptedArweaveUploads(
  pool: GatewayPool,
  address: string,
  opts?: CheckAccountEncryptedArweaveUploadsOptions,
): Promise<boolean> {
  const records = await queryUploadsByTag(pool, TAG_CODEX_ENCRYPTOR, address, {
    first: 1,
    fetchFn: opts?.fetchFn,
  });
  return records.length > 0;
}
