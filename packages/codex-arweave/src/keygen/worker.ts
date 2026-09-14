/**
 * The Web Worker entry for off-main-thread RSA-4096 keygen (E-10, N-10).
 *
 * Thin postMessage plumbing (TDD-exempt — the seam, the fake, and the typed
 * narrowing carry the tested logic in `KeygenRunner.ts`). On a `start` message it
 * LAZY-imports arweave-core `generateKey` (the E-12 lazy path — the heavy RSA/
 * WebCrypto surface must not load statically on the light entry), runs it, and
 * posts back typed {@link KeygenWorkerMsg} values.
 *
 * Two independent jobs share this worker, selected by the incoming message:
 *
 *   - `{ kind: "start" }`      → the RANDOM path: arweave-core's seedless
 *                               `generateKey()`, terminating in `done`.
 *   - `{ kind: "start-seeded" }` → the SEEDED path: dalos-crypto's
 *                               `generateFromBitStringAtRangesAsync` over a
 *                               1600-bit DALOS bitstring, posting one `key`
 *                               message per index AS IT FINISHES and
 *                               terminating in `batch-done` (or `cancelled`).
 *
 * Per-key posting is not an optimisation: generation costs ~6.7 s per key, so a
 * batch that only reported at the end would lose every completed prime search to
 * a cancel or a closed tab. Index 0 is posted like any other index —
 * `rsa4096/ranges.js` force-generates it on every call regardless of `ranges`,
 * and the never-clobber guard belongs to the main thread at the storage step.
 *
 * The seeded path reports on TWO independent channels: the coarse
 * `{ kind: "progress" }` phases (start/working/done/error) that the random path
 * also uses, and `{ kind: "batch-progress" }` carrying the library's own
 * `BatchProgressEvent` VERBATIM — the only channel that can drive a live
 * progress line, since a coarse `working` never changes for the whole run.
 *
 * JWK hygiene (N-06): a generated JWK crosses ONLY via the discrete `done` /
 * `key` messages. No branch logs or serializes the key; the error branch posts
 * only a string message, and the progress event carries counters only.
 */

import type { ArweaveJwk } from "@ancientpantheon/arweave-core";

import type { KeygenWorkerMsg } from "./KeygenRunner.js";
import type { IndexRange } from "../seeds/planIndexRanges.js";

/** The worker's global `postMessage`, typed to the message protocol. */
declare const self: {
  postMessage(msg: KeygenWorkerMsg): void;
  onmessage: ((ev: { data: unknown }) => void) | null;
};

function post(msg: KeygenWorkerMsg): void {
  self.postMessage(msg);
}

async function runKeygen(): Promise<void> {
  post({ kind: "progress", state: { state: "working" } });
  try {
    // LAZY heavy import — arweave-core's RSA/WebCrypto surface loads here, off
    // the light entry (E-12).
    const { generateKey } = await import("@ancientpantheon/arweave-core");
    const jwk = await generateKey();
    post({ kind: "progress", state: { state: "done" } });
    post({ kind: "done", jwk });
  } catch (err) {
    // Only the message string crosses back — never the (partial) key material.
    const message = err instanceof Error ? err.message : "keygen failed";
    post({ kind: "error", message });
  }
}

/**
 * Set by a `cancel` message. The library has no cancel parameter, so the run is
 * stopped cooperatively: `onResult` throws {@link CANCELLED} at the next
 * completed index, which propagates straight out (the library calls `onResult`
 * outside its own try/catch).
 */
let cancelled = false;

/** The cooperative-cancel sentinel — never an error condition to report. */
const CANCELLED = Symbol("seeded keygen cancelled");

async function runSeededBatch(
  bits: string,
  ranges: readonly IndexRange[],
): Promise<void> {
  cancelled = false;
  post({ kind: "progress", state: { state: "working" } });
  try {
    // LAZY heavy import — the deterministic RSA-4096 surface loads here, off the
    // light entry (E-12), exactly as the random path lazy-loads arweave-core.
    const { generateFromBitStringAtRangesAsync } = await import(
      "@ouronet/dalos-crypto/rsa4096"
    );
    await generateFromBitStringAtRangesAsync(
      bits,
      ranges,
      // The library's rich progress event crosses RAW — the worker neither
      // summarises nor renames it, exactly as the shipped Crypto Lab worker
      // does (`post({ type: 'progress', ev })`). Flattening it here is what
      // left the UI with nothing but an unchanging `working` for ~6.7 s per
      // key. The event is observational counters only: no key material.
      (ev) => {
        post({ kind: "batch-progress", ev });
      },
      (index, result) => {
        if (cancelled) throw CANCELLED;
        // Posted the instant this index finishes — never accumulated.
        post({
          kind: "key",
          index,
          // The library types `JWK.kty` as `string`; `toJWK` only ever emits
          // `'RSA'` (rsa4096/jwk.js), so the narrowing to `ArweaveJwk` holds.
          jwk: result.jwk as ArweaveJwk,
          address: result.address,
        });
      },
    );
    post({ kind: "progress", state: { state: "done" } });
    post({ kind: "batch-done" });
  } catch (err) {
    if (err === CANCELLED) {
      post({ kind: "cancelled" });
      return;
    }
    // Only the message string crosses back — never the (partial) key material.
    const message = err instanceof Error ? err.message : "seeded keygen failed";
    post({ kind: "error", message });
  }
}

/** The seeded request shape, narrowed off the untyped `MessageEvent.data`. */
function asSeededStart(
  data: unknown,
): { bits: string; ranges: readonly IndexRange[] } | null {
  if (typeof data !== "object" || data === null) return null;
  const msg = data as { kind?: unknown; bits?: unknown; ranges?: unknown };
  if (msg.kind !== "start-seeded") return null;
  if (typeof msg.bits !== "string" || !Array.isArray(msg.ranges)) return null;
  return { bits: msg.bits, ranges: msg.ranges as readonly IndexRange[] };
}

self.onmessage = (ev): void => {
  const data = ev.data;
  const kind =
    typeof data === "object" && data !== null
      ? (data as { kind?: unknown }).kind
      : undefined;

  if (kind === "start") {
    void runKeygen();
    return;
  }

  if (kind === "cancel") {
    cancelled = true;
    return;
  }

  const seeded = asSeededStart(data);
  if (seeded !== null) {
    void runSeededBatch(seeded.bits, seeded.ranges);
  }
};
