/**
 * `createLocalDryRunGatewayApiFactory` — a shippable (production, not
 * test-only) local/no-op gateway, built for `arweave-upload-dry-run` T1.
 *
 * PURPOSE: both of this project's real posting paths (classic native upload,
 * `nativeUpload.ts`'s `UploadGatewayApi`; streaming upload,
 * `createStreamingTransaction.ts`'s `StreamingUploadGatewayApi`) reach the
 * network ONLY through their respective injectable per-endpoint factory seam
 * — `UploadGatewayApiFactory`/`StreamingUploadGatewayApiFactory`. Every
 * existing implementation of those seams lives either in production code as
 * an arweave-js-backed default (`defaultApiFactory`/
 * `createDefaultStreamingUploadGatewayApiFactory`) or in TEST-ONLY fakes
 * (`tests/upload-native.test.ts`, `codex-arweave/tests/e3-helpers.ts`,
 * `codex-arweave/tests/streaming-post.test.ts`). This module is a THIRD kind:
 * a real, shippable, no-op stand-in a caller can inject in place of the real
 * factory — e.g. behind a "Test this upload" button — so the real upload
 * code runs unmodified, but every tx/chunk POST is captured in memory
 * instead of ever reaching a gateway.
 *
 * ONE SHARED FACTORY, not two separate ones: `UploadGatewayApi` and
 * `StreamingUploadGatewayApi` share an identical `getAnchor`/`getPrice`
 * signature and otherwise have ZERO overlapping (and zero conflicting)
 * member names (`getUploader` vs. `postTransaction`/`postChunk`) — so a
 * single object literal implementing the UNION of both interfaces'
 * members is structurally a subtype of EACH interface individually.
 * TypeScript's structural typing allows a function whose return type is
 * that union-shaped object to be assigned to EITHER narrower factory type
 * (`UploadGatewayApiFactory` or `StreamingUploadGatewayApiFactory`) — the
 * excess-property check that would otherwise flag extra members only
 * applies to object-literal expressions assigned directly, never to a
 * function-typed value being assigned through a wider-to-narrower function
 * type relation. This is proven structurally, not via `any`, in
 * `tests/local-dry-run-gateway.test.ts` (both real factory types are
 * imported fresh from their real source modules and the SAME `factory`
 * value is assigned to each).
 *
 * CAPTURE MODEL: one shared in-memory ledger per `createLocalDryRunGatewayApiFactory()`
 * call (deliberately NOT per-endpoint — a real pool rotating across
 * configured endpoints must still accumulate into one place a caller
 * inspects by tx id), keyed in two steps:
 *   - `getUploader(tx)` (classic) / `postTransaction(tx)` (streaming) record
 *     the posted tx itself under `tx.id`.
 *   - Posted bytes are recorded under the tx's OWN `data_root` — the one
 *     field both the classic and streaming paths already carry on `tx`
 *     before it reaches this gateway (streaming sets it directly;
 *     `signTransaction`'s `getSignatureData()` call computes it for the
 *     classic path before this gateway is ever reached) — because
 *     `StreamingUploadGatewayApi.postChunk`'s own body shape carries
 *     `data_root` but NOT a tx id. `getCapturedChunks(id)` resolves the tx
 *     for `id` first, then looks up its `data_root`'s captured bytes — so a
 *     caller never needs to know about this internal indirection.
 *   - Within one `data_root`, posted bytes are ADDRESSED BY THEIR OWN
 *     PAYLOAD OFFSET (`postChunk`'s `body.offset` — the chunk's last-byte
 *     index, which every `/chunk` POST body already self-describes), NOT
 *     accumulated into an arrival-ordered list. This mirrors a real
 *     gateway's actual semantics: chunks are stored at their offset, so
 *     re-POSTing an already-accepted offset is idempotent. It is also
 *     REQUIRED for correctness, not a nicety — `gateway/pool.ts`'s
 *     `execute` runs its whole operation up to `maxAttemptsPerEndpoint`
 *     (default 3) times per endpoint, and the streaming post loop wraps
 *     "post the tx + every chunk from index 0" in ONE such call, so any
 *     attempt that fails partway WILL re-post every chunk it had already
 *     posted. An arrival-ordered list reported those re-posts as extra
 *     payload, inflating a caller's reassembly by one full chunk per
 *     retried attempt (`arweave-streaming-resume-opfs-corruption`); keyed
 *     by offset, the reassembly is exact under any number of retries,
 *     rotations, or resumes.
 *
 * ZERO NETWORK, BY CONSTRUCTION: this file imports no `fetch`, no `Api`
 * (or any other value) from the `arweave` package, no `http`/`https`/
 * `XMLHttpRequest` — only TYPE-ONLY imports from this package's own gateway
 * contracts (erased at compile time) and the package's existing, already
 * Buffer-free `base64urlDecode` helper (`../keys/encoding.js`) to turn a
 * posted chunk's base64url `chunk` field back into raw bytes for capture.
 * Self-check: `grep -nE "fetch|\\bApi\\b|\\bhttp\\b|\\bhttps\\b|XMLHttpRequest" src/upload/localDryRunGateway.ts`
 * must match nothing outside this comment.
 *
 * RESPONSE REALISM: `getAnchor`/`getPrice` return fixed, structurally
 * plausible values (a 43-char base64url-alphabet anchor; a decimal Winston
 * price string) — mirroring the fixed `ANCHOR`/`PRICE` fixture convention
 * every existing fake gateway in this project already uses
 * (`tests/upload-native.test.ts`, `codex-arweave/tests/e3-helpers.ts`).
 */

import type Transaction from "arweave/node/lib/transaction";

import { base64urlDecode } from "../keys/encoding.js";
import type { ChunkedUploader, UploadGatewayApi } from "./nativeUpload.js";
import type {
  SignedStreamingTransaction,
  StreamingChunkPostBody,
  StreamingUploadGatewayApi,
} from "./streaming/createStreamingTransaction.js";

/** A structurally-plausible 43-char base64url anchor. Fixed, never fetched —
 *  this gateway issues zero network calls. */
const DRY_RUN_ANCHOR = "LocalDryRunAnchor".padEnd(43, "0");

/** A structurally-plausible decimal Winston price quote. Fixed, same
 *  fixed-fixture convention as every existing test fake in this project. */
const DRY_RUN_PRICE = "1000000000";

/** Either path's posted tx, captured verbatim — `SignedStreamingTransaction`
 *  is already a type alias of the real `arweave-js` `Transaction` the
 *  classic path's `getUploader(tx: Transaction)` also receives, so one
 *  captured-tx type covers both. */
export type CapturedDryRunTx = SignedStreamingTransaction;

/** The value {@link createLocalDryRunGatewayApiFactory} returns. */
export interface LocalDryRunGateway {
  /**
   * A single value structurally satisfying BOTH the classic
   * `UploadGatewayApiFactory` and the streaming
   * `StreamingUploadGatewayApiFactory` — see this module's doc comment for
   * why one shared implementation covers both contracts cleanly.
   */
  factory: (endpointBaseUrl: string) => UploadGatewayApi & StreamingUploadGatewayApi;
  /**
   * The captured tx for `id` (the classic `getUploader` call's or the
   * streaming `postTransaction` call's `tx`, verbatim) — `undefined` if
   * nothing with that id was ever posted, or `reset()` ran since.
   */
  getCapturedTx(id: string): CapturedDryRunTx | undefined;
  /**
   * Every DISTINCT chunk the gateway holds for `id`'s tx, in ascending
   * PAYLOAD-OFFSET order (decoded back to raw bytes) — so concatenating the
   * result reconstructs exactly the payload posted, once. The classic path
   * captures `tx.data` as a single entry at `getUploader(tx)` time; the
   * streaming path records one entry per distinct `postChunk` offset.
   *
   * NOT arrival order, and NOT one entry per `postChunk` CALL: a chunk
   * re-POSTed at an offset already captured (which a retried `pool.execute`
   * attempt does by design) appears exactly once, matching a real gateway's
   * own offset-addressed, idempotent store. See this module's "CAPTURE
   * MODEL" doc paragraph.
   *
   * Empty if `id` was never posted (or after `reset()`).
   */
  getCapturedChunks(id: string): Uint8Array[];
  /** Clears every captured tx/chunk back to empty. */
  reset(): void;
}

/**
 * Builds the shippable local/no-op gateway: every method on the returned
 * client accepts its real input, records it in memory, and resolves a
 * realistic success response — nothing it does can ever reach a real
 * network or spend real AR.
 */
export function createLocalDryRunGatewayApiFactory(): LocalDryRunGateway {
  let txsById = new Map<string, CapturedDryRunTx>();
  let chunksByDataRoot = new Map<string, Map<number, Uint8Array>>();

  function captureTx(tx: CapturedDryRunTx): void {
    txsById.set(tx.id, tx);
  }

  /** Records `bytes` AT its own declared payload `offset` — see this module's
   *  "CAPTURE MODEL" doc paragraph for why this is offset-addressed (a real
   *  gateway's own semantics, idempotent under re-POST) rather than an
   *  append-ordered list. A repeat POST for an offset already captured
   *  overwrites it with identical bytes: a no-op, exactly as on a real
   *  gateway. */
  function captureChunkAt(dataRoot: string, offset: number, bytes: Uint8Array): void {
    let byOffset = chunksByDataRoot.get(dataRoot);
    if (!byOffset) {
      byOffset = new Map<number, Uint8Array>();
      chunksByDataRoot.set(dataRoot, byOffset);
    }
    byOffset.set(offset, bytes);
  }

  function factory(_endpointBaseUrl: string): UploadGatewayApi & StreamingUploadGatewayApi {
    return {
      async getAnchor() {
        return DRY_RUN_ANCHOR;
      },
      async getPrice(_byteSize: number, _target?: string) {
        return DRY_RUN_PRICE;
      },

      // --- classic `UploadGatewayApi` ---
      async getUploader(tx: Transaction): Promise<ChunkedUploader> {
        const captured = tx as unknown as CapturedDryRunTx;
        captureTx(captured);
        // The classic path posts the payload as ONE entry; its offset is that
        // single chunk's own last-byte index, the same convention a streaming
        // `postChunk` body's `offset` field carries.
        captureChunkAt(captured.data_root, captured.data.byteLength - 1, captured.data);

        let done = false;
        return {
          get isComplete(): boolean {
            return done;
          },
          async uploadChunk(): Promise<void> {
            done = true;
          },
        };
      },

      // --- streaming `StreamingUploadGatewayApi` ---
      async postTransaction(tx: SignedStreamingTransaction): Promise<void> {
        captureTx(tx);
      },
      async postChunk(body: StreamingChunkPostBody): Promise<void> {
        captureChunkAt(body.data_root, Number(body.offset), base64urlDecode(body.chunk));
      },
    };
  }

  return {
    factory,
    getCapturedTx(id: string): CapturedDryRunTx | undefined {
      return txsById.get(id);
    },
    getCapturedChunks(id: string): Uint8Array[] {
      const tx = txsById.get(id);
      if (!tx) {
        return [];
      }
      const byOffset = chunksByDataRoot.get(tx.data_root);
      if (!byOffset) {
        return [];
      }
      // Payload order = ascending offset. Each offset appears exactly once,
      // so concatenating the result reconstructs the payload the gateway
      // holds — however many times any individual chunk was re-POSTed.
      return [...byOffset.entries()].sort((a, b) => a[0] - b[0]).map(([, bytes]) => bytes);
    },
    reset(): void {
      txsById = new Map();
      chunksByDataRoot = new Map();
    },
  };
}
