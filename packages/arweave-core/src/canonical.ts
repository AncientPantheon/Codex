/**
 * The canonical Arweave address / transaction-id predicate — the ONE shared home
 * for the fund-relevant 43-character base64url gate.
 *
 * An Arweave address and a transaction id are both SHA-256 digests rendered as
 * UNPADDED base64url: exactly 43 characters drawn from `[A-Za-z0-9_-]`. Reads,
 * transfer, upload, and rebuild all gate untrusted wire strings (addresses,
 * txids, node ids) against this exact form; hoisting the predicate here keeps
 * that gate byte-identical across every module instead of copy-pasting the
 * literal, so it can never drift on one path while the others tighten.
 */

/** Canonical Arweave address / txid form: exactly 43 unpadded base64url chars. */
export const ARWEAVE_ADDRESS_RE = /^[A-Za-z0-9_-]{43}$/;

/**
 * Whether `value` is a canonical Arweave address / transaction id: exactly 43
 * base64url characters (`[A-Za-z0-9_-]`), no padding. Consumers validating ids
 * before composing gateway URLs or embedding them in a signed tx SHOULD gate on
 * this.
 */
export function isCanonicalAddress(value: string): boolean {
  return ARWEAVE_ADDRESS_RE.test(value);
}
