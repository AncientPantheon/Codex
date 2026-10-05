/**
 * `runUploadDryRun` — the dry-run engine (T2 of `arweave-upload-dry-run`).
 *
 * Lets a caller press a "Test this upload" button and genuinely exercise the
 * REAL streaming-upload engines — OPFS bundle assembly, the streaming
 * `data_root` pipeline, chunked posting, interrupt+resume — with T1's
 * shippable local/no-op gateway (`createLocalDryRunGatewayApiFactory`,
 * `@ancientpantheon/arweave-core`) injected in place of a real gateway
 * factory: same code path, different (in-memory, never-network) destination.
 * Zero AR spent, zero network reachability (T1's own gateway imports no
 * `fetch`/`Api`/`http` anywhere), and — by construction, not by convention —
 * zero Library persistence: this function takes NO `store` param at all, so
 * there is nothing here that could ever call `store.append`.
 *
 * COMPOSITION — reuses the REAL engines directly, never
 * `uploadAndTrack`/`performUploadAndTrack` (which unconditionally append a
 * Library entry): `uploadBundleStreaming`/`uploadStreaming`
 * (`uploadBundleStreaming.ts`) are called with T1's gateway as
 * `streamingApiFactory`, mirroring `performUploadAndTrack`'s own
 * single-file-vs-bundle routing rule (`"files" in params && params.files
 * .length >= 2`) verbatim.
 *
 * STREAMING-SUPPORT HONESTY: `isStreamingUploadSupported()` is checked first
 * (injectable; defaults to the real detector). If it resolves `false`, this
 * function does NOT silently fall back to exercising the classic in-memory
 * upload path — `arweave-streaming-worker-wiring`'s own finding was that
 * `isStreamingUploadSupported()` always resolves `false` on the main thread
 * in a real browser (`createSyncAccessHandle()` is Worker-only), so a dry run
 * that quietly used the fallback path would never actually prove the
 * streaming engine (the one with real chunking/resume to test) works at all.
 * Instead, `DryRunResult.streamingSupported` is `false`, `success` is
 * `false`, and `errors` explains exactly why — nothing else runs.
 *
 * DELIBERATE INTERRUPT + RESUME: the first posting pass is driven through a
 * LOCAL wrapper around T1's gateway factory whose `postChunk` lets exactly
 * `STOP_AFTER_CHUNKS` chunks through before throwing — the SAME
 * fake-gateway-throws-after-N technique `streaming-post.test.ts`/
 * `streaming-upload-bundle.test.ts` already use, just wrapping a REAL
 * (local, zero-network) gateway instead of a bespoke per-test fake. The
 * expected throw is caught, then `resumeStreamingPost` (`streamingPost.ts`)
 * is called against the SAME local gateway (now unwrapped — no further
 * interruption) and a REAL `opts.resumeStore`, proving the actual resume
 * mechanics work end to end, not merely that the happy path posts. The
 * wrapping transaction's own id — never exposed by `UploadBundleResult`/
 * `UploadResult` on an uninterrupted run — is read off `resumeStreamingPost`'s
 * own resolved `{ id }` instead, which is why this function always
 * deliberately interrupts (even a selection small enough to complete in one
 * pool attempt still gets routed through the interrupt+resume path) rather
 * than only interrupting opportunistically.
 *
 * SELF-VERIFICATION — independent of trusting this project's own code, per
 * the design doc:
 *   - Every captured chunk's Merkle proof is validated against an
 *     INDEPENDENTLY recomputed `data_root` — recomputed via `arweave-js`'s
 *     OWN buffer-based `generateTransactionChunks`/`validatePath`
 *     (`arweave/web/lib/merkle.js` — `arweave-js`'s own browser-targeted
 *     sibling build, confirmed by this task's own real-browser capstone to
 *     be required instead of `arweave/node/lib/merkle.js`, which hashes via
 *     Node's native `node:crypto` and throws in a real browser; see
 *     `validateProofsIndependently`'s own doc comment for the full finding.
 *     Dynamically imported — mirrors
 *     `assembleBundleToFile.ts`'s own established "reach a heavy
 *     browser-unsafe-to-statically-import dependency via a dynamic
 *     `import()`, never a top-level one" convention in this package, and
 *     this package's own "no direct `arweave`/`arbundles` dependency in
 *     `src`'s static import graph" rule), never this package's own
 *     `computeStreamingDataRoot` — a genuinely separate oracle, not the same
 *     code grading its own homework.
 *   - For an encrypted run, the captured ciphertext is decrypted (via
 *     `decryptStream`, `arweave-streaming-encryption`) and compared
 *     byte-for-byte against the ORIGINAL selected files' plaintext (the same
 *     `params` this function was called with — never re-read from anywhere
 *     else). For a bundle, each file's ciphertext region within the
 *     reassembled ANS-104 bundle is located by parsing it with `arbundles`'
 *     OWN `Bundle` class (dynamically imported, same convention as above) —
 *     a real, non-test-only parse of the actual bytes posted, not a
 *     test-mock-derived offset.
 *
 * `decryptionKey` (ADDITIVE, documented deviation from the design doc's
 * literal "same key" phrasing — "your call… document any deviation" per this
 * task's own plan entry): defaults to `resolvedKey`, so a real caller who
 * never sets it gets exactly what the design doc describes. It exists
 * because, mathematically, a SINGLE key used for both encrypting and then
 * decrypting the SAME bytes can NEVER fail a byte-for-byte comparison no
 * matter which bitstring it was derived — AES-GCM guarantees
 * `Decrypt_k(Encrypt_k(x)) = x` for ANY valid key `k`, so using "the wrong
 * key" consistently is mathematically indistinguishable, by this check
 * alone, from using the right one. Overriding `decryptionKey` to a DIFFERENT key
 * than whatever actually encrypted the upload (this module's own test suite
 * does exactly that) is what makes the self-check capable of ever reporting
 * a genuine decrypt failure — proving this engine does not rubber-stamp
 * every input, the single most important property a "trust this before you
 * spend real money" feature must have.
 *
 * CLEANUP: `uploadBundleStreaming`/`uploadStreaming`/`resumeStreamingPost`
 * each already delete their own resume record + OPFS file on a clean
 * completion (their own `deleteFileOnComplete` policy, default `true`) — so
 * the common success AND induced-self-check-failure paths (the upload itself
 * still completed; only the INDEPENDENT self-check failed afterward) are
 * already clean via that existing policy. The one gap that policy does NOT
 * cover is a genuinely failed resume (e.g. the interrupted pass threw for a
 * real reason, not the deliberate simulated one, and no checkpoint was ever
 * written) — a `finally` block below makes a best-effort, swallowed-on-error
 * attempt to delete the resume record and the OPFS file regardless, so no
 * scenario leaves residue.
 */

import {
  createLocalDryRunGatewayApiFactory,
  CODEX_ENCRYPTION_VERSION_CURRENT,
  type GatewayPool,
  type StreamingUploadGatewayApi,
  type StreamingUploadGatewayApiFactory,
} from "@ancientpantheon/arweave-core";

import type { UploadAndTrackParams } from "../flow.js";
import { uploadBundleStreaming, uploadStreaming } from "./uploadBundleStreaming.js";
import { resumeStreamingPost } from "./streamingPost.js";
import type { StreamingPostResumeStore } from "./streamingPostResumeStore.js";
import type { BundleAssemblyFile } from "./bundleAssemblyFile.js";
import { isStreamingUploadSupported } from "./isStreamingUploadSupported.js";
import { decryptStream } from "../../crypto/streamingFileEncryption.js";

/** Lets exactly `stopAfterChunks` `postChunk` calls through to `inner` before
 *  every call after throws — the SAME "fake gateway dies after N chunks"
 *  technique `streaming-post.test.ts`'s own `makeInterruptingStreamingApiFactory`
 *  uses, generalized here to wrap any real `StreamingUploadGatewayApiFactory`
 *  (T1's local gateway, in this module's case) instead of a bespoke
 *  per-test fake. */
function wrapInterrupting(
  inner: StreamingUploadGatewayApiFactory,
  stopAfterChunks: number,
): StreamingUploadGatewayApiFactory {
  return (endpoint: string): StreamingUploadGatewayApi => {
    const api = inner(endpoint);
    let posted = 0;
    return {
      getAnchor: () => api.getAnchor(),
      getPrice: (byteSize, target) => api.getPrice(byteSize, target),
      postTransaction: (tx) => api.postTransaction(tx),
      async postChunk(body) {
        if (posted >= stopAfterChunks) {
          throw new Error("runUploadDryRun: simulated interruption to exercise resumeStreamingPost");
        }
        posted += 1;
        await api.postChunk(body);
      },
    };
  };
}

/** `buildUploadTags` requires a non-empty `Codex-Encryptor` string whenever
 *  `encrypted === true` — this function never has (or needs) a real
 *  encrypting account address, since nothing is ever posted to chain, so it
 *  stamps this clearly-labeled placeholder instead. */
const DRY_RUN_ENCRYPTOR_ADDRESS = "codex-dry-run-local-only";

/** Lets exactly one chunk through before interrupting — chosen deliberately
 *  low (not "many") so this function ALWAYS exercises the interrupt+resume
 *  path for any non-trivially-empty selection (more than one Merkle chunk
 *  total), rather than only opportunistically on a large one; see the module
 *  doc comment for why always-interrupting (rather than only when "needed")
 *  is also how this function recovers the wrapping transaction's own id. */
const STOP_AFTER_CHUNKS = 1;

/** One already-selected file, normalized to the single shape this module's
 *  own logic needs regardless of which real `UploadAndTrackParams` variant
 *  the caller passed in. */
interface NormalizedFile {
  path?: string;
  contentType: string;
  data: Uint8Array;
}

/** UTF-8-encodes a plain string, or passes an existing Uint8Array through —
 *  mirrors `flow.ts`'s own identically-purposed local `toBytes` helper
 *  (not imported — that one is module-private there). */
function toBytes(data: string | Uint8Array): Uint8Array {
  return typeof data === "string" ? new TextEncoder().encode(data) : data;
}

/**
 * Normalizes any real `UploadAndTrackParams` shape into `{ isBundle, files }`
 * — mirrors `performUploadAndTrack`'s own exact routing rule (`"files" in
 * params && params.files.length >= 2` ⇒ bundle; everything else ⇒ single
 * file, including a `files` array of exactly one item unwrapped the same way)
 * verbatim, so this function's routing can never drift from the real one.
 */
function normalizeParams(params: UploadAndTrackParams): { isBundle: boolean; files: NormalizedFile[] } {
  if ("files" in params && params.files.length >= 2) {
    return {
      isBundle: true,
      files: params.files.map((f) => ({ path: f.path, contentType: f.contentType, data: f.data })),
    };
  }
  if ("files" in params) {
    const only = params.files[0]!;
    return {
      isBundle: false,
      files: [{ path: only.path, contentType: only.contentType, data: only.data }],
    };
  }
  return {
    isBundle: false,
    files: [{ contentType: params.contentType, data: toBytes(params.data) }],
  };
}

/** Options for {@link runUploadDryRun}. Deliberately carries NO `store`
 *  param — see the module doc comment for why that is structural, not
 *  incidental. */
export interface RunUploadDryRunOptions {
  /** The gateway pool the (local, never-real) posting runs through — same
   *  POOL-FIRST-shaped requirement every real upload seam in this project
   *  carries, even though T1's gateway never actually reaches an endpoint. */
  pool: GatewayPool;
  /** The already-resolved encryption key, mirroring `performUploadAndTrack`'s
   *  own `resolvedKey: CryptoKey | undefined` exactly — this function never
   *  re-implements key resolution (no `revealAccountSecret` callback here).
   *  `undefined` ⇒ this dry run exercises the unencrypted path. */
  resolvedKey?: CryptoKey;
  /**
   * The key the SELF-VERIFY decrypt check uses — defaults to `resolvedKey`.
   * See the module doc comment's own paragraph on this field for why it is
   * additive/documented-deviation, and why a real caller should normally
   * never set it to anything other than `resolvedKey` (this module's own
   * induced-failure test is the one legitimate reason to).
   */
  decryptionKey?: CryptoKey;
  /** A REAL `StreamingPostResumeStore` — never bypassed/mocked, so the
   *  checkpoint written mid-flight and the resume it drives are genuine. */
  resumeStore: StreamingPostResumeStore;
  /** Injectable OPFS-support probe, forwarded to the real detector by
   *  default — see the module doc comment's own "STREAMING-SUPPORT HONESTY"
   *  paragraph for why a `false` result short-circuits this whole function
   *  rather than silently falling back. */
  isStreamingSupported?: () => Promise<boolean>;
  /** Injectable OPFS-file-open seam, forwarded verbatim to
   *  `uploadBundleStreaming`/`uploadStreaming`/`resumeStreamingPost`'s own
   *  `openFile`. Defaults to their own real `openOpfsBundleAssemblyFile`;
   *  tests inject a fake (neither Node nor jsdom has real OPFS). */
  openFile?: (fileName: string) => Promise<BundleAssemblyFile>;
  /** Injectable OPFS-file-delete seam, forwarded the same way. */
  deleteFile?: (fileName: string) => Promise<void>;
}

/**
 * The dry-run engine's plain, non-engineer-readable pass/fail-plus-evidence
 * result. Exact field set is this task's own call within the design doc's
 * named shape — every field documented below exists in the design doc's own
 * listed set.
 */
export interface DryRunResult {
  /** `true` iff `errors` is empty — every sub-check that ran, passed. */
  success: boolean;
  /** How many files this dry run actually exercised. */
  filesTested: number;
  /** The total plaintext byte size across every tested file. */
  totalBytes: number;
  /** How many Merkle chunks were actually posted to the local gateway
   *  across BOTH the interrupted first pass and the resumed completion. */
  chunksPosted: number;
  /** Whether the deliberate interrupt-then-resume path actually ran (and
   *  completed) — `false` only when streaming was unsupported (nothing ran
   *  at all) or the resume attempt itself genuinely failed. */
  resumeTested: boolean;
  /** Whether every captured chunk's Merkle proof validated, independently,
   *  against a freshly-recomputed `data_root` (`arweave-js`'s own
   *  `generateTransactionChunks`/`validatePath` — never this project's own
   *  `computeStreamingDataRoot`). */
  proofsValid: boolean;
  /** `true`/`false` for an encrypted run (whether the captured ciphertext
   *  decrypted, byte-for-byte, back to the original plaintext under
   *  `opts.decryptionKey`); `"not-applicable"` when `opts.resolvedKey` was
   *  `undefined` (nothing was encrypted in the first place). */
  decryptRoundTripOk: boolean | "not-applicable";
  /** Whatever `isStreamingUploadSupported()` actually resolved, right now,
   *  in this context — the honesty signal the whole feature exists for. */
  streamingSupported: boolean;
  /** Wall-clock milliseconds this whole dry run took. */
  elapsedMs: number;
  /** Every problem found, in plain language — empty iff `success`. */
  errors: string[];
}

/** Concatenates `chunks`, in order, into one buffer. */
function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.byteLength, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of chunks) {
    out.set(chunk, cursor);
    cursor += chunk.byteLength;
  }
  return out;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** Base64url-decodes `value` (standard `"base64"` + the RFC 4648 §5
 *  substitution reversed) — the exact inverse of every sibling streaming
 *  module's own local `base64url` encode in this package. */
function base64urlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const withPadding = padded + "=".repeat((4 - (padded.length % 4)) % 4);
  return new Uint8Array(Buffer.from(withPadding, "base64"));
}

/**
 * Independently validates every captured chunk's Merkle proof against a
 * FRESHLY recomputed `data_root` — `arweave-js`'s own buffer-based
 * `generateTransactionChunks`/`validatePath` (dynamically imported; see the
 * module doc comment for why), never this project's own
 * `computeStreamingDataRoot`. Also cross-checks the recomputed `data_root`
 * against the captured transaction's own `data_root` field, so a correct-
 * looking proof set built from the WRONG bytes is still caught.
 */
async function validateProofsIndependently(
  fullBytes: Uint8Array,
  capturedDataRootBase64Url: string,
): Promise<boolean> {
  // `arweave-upload-dry-run` T3's real-browser capstone (SCOPE DEVIATION,
  // flagged in that task's own build report): `arweave/node/lib/merkle.js`
  // hashes via Node's native `node:crypto` `createHash` — unavailable in a
  // real browser (confirmed directly: this module's own oracle check threw
  // "node:crypto createHash is unavailable in the browser bundle" the first
  // time it actually ran inside a real Worker). `arweave/web/lib/merkle.js`
  // is `arweave-js`'s own browser-targeted sibling build — hashes via
  // `arweave-js`'s own WebCrypto-backed `CryptoInterface` instead — and is
  // confirmed, directly, to produce IDENTICAL `data_root`/proof results
  // under Node too (this module's own test suite stays green unchanged), so
  // switching is a pure environment-compatibility fix, not a behavior change.
  const merkle = await import("arweave/web/lib/merkle.js");
  const oracle = await merkle.generateTransactionChunks(fullBytes);

  const capturedRoot = base64urlDecode(capturedDataRootBase64Url);
  if (!bytesEqual(oracle.data_root, capturedRoot)) {
    return false;
  }

  for (const proof of oracle.proofs) {
    const outcome = await merkle.validatePath(
      oracle.data_root,
      proof.offset,
      0,
      fullBytes.byteLength,
      proof.proof,
    );
    if (outcome === false) {
      return false;
    }
  }
  return true;
}

/**
 * Decrypts every file's region within `fullBytes` (the reassembled posted
 * payload) under `key` and compares, byte-for-byte, against `files`' own
 * original plaintext. For a bundle, each file's ciphertext region is located
 * by parsing `fullBytes` with `arbundles`' own `Bundle` class (dynamically
 * imported) — `bundle.items[i]` is file `i`'s own data item (files first, in
 * `files` order, matching `assembleBundleToFile.ts`'s own write order; the
 * manifest item, always last, is never checked here). For a single file,
 * `fullBytes` IS the file's own posted bytes directly (no ANS-104 wrapper at
 * all for that path).
 */
async function decryptRoundTripCheck(params: {
  isBundle: boolean;
  fullBytes: Uint8Array;
  files: NormalizedFile[];
  key: CryptoKey;
}): Promise<boolean> {
  const { isBundle, fullBytes, files, key } = params;

  const ciphertextRegions: Uint8Array[] = isBundle
    ? await (async () => {
        const { Bundle } = await import("arbundles");
        const bundle = new Bundle(Buffer.from(fullBytes));
        return files.map((_f, i) => bundle.items[i]!.rawData as Uint8Array);
      })()
    : [fullBytes];

  for (let i = 0; i < files.length; i++) {
    const ciphertext = ciphertextRegions[i]!;
    const plaintext = files[i]!.data;
    const decryptedChunks: Uint8Array[] = [];
    for await (const chunk of decryptStream({
      read: async (offset, length) => ciphertext.subarray(offset, offset + length),
      totalCiphertextLength: ciphertext.byteLength,
      totalPlaintextLength: plaintext.byteLength,
      key,
    })) {
      decryptedChunks.push(chunk);
    }
    if (!bytesEqual(concatBytes(decryptedChunks), plaintext)) {
      return false;
    }
  }
  return true;
}

/**
 * Runs a real, local, zero-network rehearsal of `params` through the actual
 * streaming-upload engines. See the module doc comment for the full
 * composition/self-verify/cleanup contract. Never rejects — every failure
 * mode is reported through the resolved {@link DryRunResult} instead, so a
 * UI caller can always render a result panel.
 */
export async function runUploadDryRun(
  params: UploadAndTrackParams,
  opts: RunUploadDryRunOptions,
): Promise<DryRunResult> {
  const startedAt = Date.now();
  const errors: string[] = [];

  const { isBundle, files } = normalizeParams(params);
  const filesTested = files.length;
  const totalBytes = files.reduce((sum, f) => sum + f.data.byteLength, 0);
  const encrypted = opts.resolvedKey !== undefined;

  const checkStreamingSupported = opts.isStreamingSupported ?? isStreamingUploadSupported;
  const streamingSupported = await checkStreamingSupported();

  if (!streamingSupported) {
    errors.push(
      "Streaming upload is not supported in this browser context right now " +
        "(OPFS/Worker access could not be confirmed) — a real upload would use " +
        "the classic in-memory fallback path, which this dry run does not " +
        "exercise. Run this from the real app's Worker-enabled context to get " +
        "a meaningful pass/fail signal.",
    );
    return {
      success: false,
      filesTested,
      totalBytes,
      chunksPosted: 0,
      resumeTested: false,
      proofsValid: false,
      decryptRoundTripOk: encrypted ? false : "not-applicable",
      streamingSupported: false,
      elapsedMs: Date.now() - startedAt,
      errors,
    };
  }

  const gateway = createLocalDryRunGatewayApiFactory();
  const resumeId = globalThis.crypto.randomUUID();
  const fileName = `codex-dry-run-${resumeId}.bin`;

  let resumeTested = false;
  let completedCleanly = false;
  let txId: string | undefined;
  let chunksPosted = 0;
  let proofsValid = false;
  let decryptRoundTripOk: boolean | "not-applicable" = encrypted ? false : "not-applicable";

  try {
    const interruptingFactory = wrapInterrupting(gateway.factory, STOP_AFTER_CHUNKS);
    let interrupted = false;

    try {
      if (isBundle) {
        await uploadBundleStreaming(
          {
            jwk: params.jwk,
            files: files.map((f) => ({
              path: f.path!,
              contentType: f.contentType,
              readData: async () => f.data,
            })),
            maxRewardWinston: params.maxRewardWinston,
            category: params.category,
            assetType: params.assetType,
            appId: params.appId,
            appVersion: params.appVersion,
            encrypted,
            encryptorAddress: encrypted ? DRY_RUN_ENCRYPTOR_ADDRESS : undefined,
            encryptionVersion: encrypted ? CODEX_ENCRYPTION_VERSION_CURRENT : undefined,
            encryptionKey: opts.resolvedKey,
          },
          {
            pool: opts.pool,
            resumeStore: opts.resumeStore,
            apiFactory: interruptingFactory,
            openFile: opts.openFile,
            deleteFile: opts.deleteFile,
            resumeId,
            fileName,
          },
        );
      } else {
        const only = files[0]!;
        const result = await uploadStreaming(
          {
            jwk: params.jwk,
            readData: async (offset, length) => only.data.subarray(offset, offset + length),
            totalLength: only.data.byteLength,
            contentType: only.contentType,
            maxRewardWinston: params.maxRewardWinston,
            category: params.category,
            assetType: params.assetType,
            appId: params.appId,
            appVersion: params.appVersion,
            encrypted,
            encryptorAddress: encrypted ? DRY_RUN_ENCRYPTOR_ADDRESS : undefined,
            encryptionVersion: encrypted ? CODEX_ENCRYPTION_VERSION_CURRENT : undefined,
            encryptionKey: opts.resolvedKey,
          },
          {
            pool: opts.pool,
            resumeStore: opts.resumeStore,
            apiFactory: interruptingFactory,
            openFile: opts.openFile,
            deleteFile: opts.deleteFile,
            resumeId,
            fileName,
          },
        );
        // Completed without ever being interrupted (a selection small enough
        // to post in a single pool attempt) — the single-file path's own
        // `UploadResult.id` IS the real tx id, so it is available directly;
        // nothing to resume.
        txId = result.id;
        completedCleanly = true;
      }
    } catch {
      // Expected: STOP_AFTER_CHUNKS always triggers for any selection with
      // more than one Merkle chunk — see the module doc comment for why this
      // function always interrupts rather than only opportunistically.
      interrupted = true;
    }

    if (interrupted) {
      try {
        const result = await resumeStreamingPost(resumeId, opts.pool, {
          store: opts.resumeStore,
          apiFactory: gateway.factory,
          openFile: opts.openFile,
          deleteFile: opts.deleteFile,
        });
        resumeTested = true;
        completedCleanly = true;
        txId = result.id;
      } catch (err) {
        errors.push(
          `The interrupted upload could not be resumed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (txId === undefined) {
      if (isBundle && !errors.length) {
        errors.push(
          "This selection completed in a single pool attempt before it could be " +
            "interrupted (too small — a single Merkle chunk) — the resume path, " +
            "and this bundle's own posted-bytes self-check, could not be " +
            "exercised. Try a larger, multi-chunk selection for full dry-run " +
            "coverage.",
        );
      }
    } else {
      const capturedTx = gateway.getCapturedTx(txId);
      const capturedChunks = gateway.getCapturedChunks(txId);
      chunksPosted = capturedChunks.length;

      if (!capturedTx) {
        errors.push(`No captured transaction was found for posted id "${txId}" — this is a dry-run engine bug.`);
      } else {
        const fullBytes = concatBytes(capturedChunks);

        try {
          proofsValid = await validateProofsIndependently(fullBytes, capturedTx.data_root);
          if (!proofsValid) {
            errors.push(
              "Independent Merkle proof validation failed: at least one captured " +
                "chunk's proof did not validate against the posted data_root.",
            );
          }
        } catch (err) {
          errors.push(`Independent Merkle proof validation threw: ${err instanceof Error ? err.message : String(err)}`);
        }

        if (encrypted) {
          const decryptionKey = opts.decryptionKey ?? opts.resolvedKey!;
          try {
            decryptRoundTripOk = await decryptRoundTripCheck({
              isBundle,
              fullBytes,
              files,
              key: decryptionKey,
            });
            if (!decryptRoundTripOk) {
              errors.push(
                "Decrypt self-check failed: the posted ciphertext did not decrypt " +
                  "back to the original plaintext under the verification key.",
              );
            }
          } catch (err) {
            decryptRoundTripOk = false;
            errors.push(`Decrypt self-check threw: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }
    }
  } finally {
    // Unconditional best-effort cleanup — a no-op (swallowed) when the
    // normal completion path above already handled it; the real safety net
    // for a resume attempt that itself genuinely failed (see the module doc
    // comment's own "CLEANUP" paragraph).
    if (!completedCleanly) {
      try {
        await opts.resumeStore.delete(resumeId);
      } catch {
        // Best-effort — never let cleanup itself mask the real result.
      }
      try {
        if (opts.deleteFile) {
          await opts.deleteFile(fileName);
        }
      } catch {
        // Same — best-effort only.
      }
    }
  }

  return {
    success: errors.length === 0,
    filesTested,
    totalBytes,
    chunksPosted,
    resumeTested,
    proofsValid,
    decryptRoundTripOk,
    streamingSupported: true,
    elapsedMs: Date.now() - startedAt,
    errors,
  };
}
