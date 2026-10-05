/**
 * The Web Worker entry for off-main-thread dry-run uploads
 * (`arweave-upload-dry-run` T3 — a SCOPE DEVIATION from this task's own
 * `- files:` list, added after the real-browser capstone found the same bug
 * `arweave-streaming-worker-wiring` found for the REAL upload path: see this
 * module's own "WHY" paragraph below).
 *
 * Mirrors `uploadWorker.ts`'s own thin-plumbing convention exactly (TDD-exempt
 * for the identical reason that file documents: "the seam, the fake, and the
 * typed narrowing carry the tested logic" — here, T2's own already-tested
 * `runUploadDryRun`). This file's only job is: install the Worker `Buffer`
 * polyfill `uploadWorker.ts` already needs for the identical reason
 * (`arbundles`' signer construction, reached internally by the SAME streaming
 * engines T2's dry-run engine composes), reconstruct the two things that
 * cannot cross `postMessage` (a live `GatewayPool`'s own functions; a live
 * `StreamingPostResumeStore`'s own `IDBDatabase` handle), call the
 * already-tested `runUploadDryRun`, and translate its resolved
 * {@link DryRunResult} (or any throw) into a typed {@link StreamingDryRunWorkerMsg}
 * post.
 *
 * WHY this must run inside a dedicated Worker at all: calling
 * `runUploadDryRun` directly on the main document thread (which is what T3's
 * own plan entry, read literally, describes) makes
 * `isStreamingUploadSupported()` — called FIRST, inside `runUploadDryRun`
 * itself — always resolve `false` in a real browser (`createSyncAccessHandle()`
 * is Worker-only; `arweave-streaming-worker-wiring`'s own design.md documents
 * this exact finding for the REAL upload path). `runUploadDryRun` is built to
 * react to that HONESTLY (`streamingSupported: false`, `success: false`, a
 * clear `errors` message — never a silent, meaningless fallback-path dry run),
 * which means a main-thread-only wiring would make the "Test this upload"
 * button report failure EVERY SINGLE TIME in a real browser, regardless of
 * how valid the selection actually is — defeating the entire feature's
 * purpose ("press a button... and see his actual files pass or fail", per
 * `docs/work/arweave-upload-dry-run/design.md`'s own "Problem" section).
 * Routing through this Worker, exactly the way the REAL upload path already
 * had to, is the fix — confirmed directly against a real browser by this
 * task's own real-browser capstone check (see its build report).
 *
 * Message protocol (mirrors `StreamingUploadWorkerMsg`'s own shape, trimmed
 * to what a dry run needs — no `route`/`progress`/`appendLibraryEntry`
 * messages at all: `runUploadDryRun` never calls `store.append` by
 * construction, and reports its own `streamingSupported`/progress-shaped
 * fields INSIDE the one resolved {@link DryRunResult}, not as a message
 * stream). The main thread posts ONE `{ kind: "start", params, resolvedKey?,
 * decryptionKey?, opts }` message; this worker posts exactly one of `{ kind:
 * "done", result }` / `{ kind: "error", message }` in reply. An uncaught
 * exception anywhere in the run is caught and ALWAYS yields a posted `error`
 * message — this worker never lets a message-less throw escape, same
 * discipline as `uploadWorker.ts`.
 */

// TYPE-ONLY, and deliberately so: erased at compile time, so naming these
// here costs this light entry nothing at runtime — the heavy implementation
// behind them still loads only via the LAZY `await import(...)` in
// `runDryRun` below (mirrors `uploadWorker.ts`'s own E-12 discipline).
import type { UploadAndTrackParams } from "../flow.js";
import type { DryRunResult } from "./dryRunUpload.js";

/**
 * The worker's global `postMessage`, typed to the message protocol — the
 * `MessageEvent.data` boundary is narrowed on `.kind`, never read as `any`.
 */
declare const self: {
  postMessage(msg: StreamingDryRunWorkerMsg): void;
  onmessage: ((ev: { data: unknown }) => void) | null;
};

/** The typed worker→main message protocol, discriminated on `.kind` — see
 *  this module's own doc comment for why it carries only `done`/`error`
 *  (no `route`/`progress`/`appendLibraryEntry`, unlike `StreamingUploadWorkerMsg`). */
export type StreamingDryRunWorkerMsg =
  /** The terminal success message — carries the SAME {@link DryRunResult}
   *  `runUploadDryRun` itself resolves with (it never rejects, but this
   *  worker still only posts `done` from inside a `try`, mirroring
   *  `uploadWorker.ts`'s own "never let a throw escape un-posted" rule). */
  | { kind: "done"; result: DryRunResult }
  /** The terminal failure message — only the message STRING crosses back,
   *  same JWK/stack hygiene discipline as `StreamingUploadWorkerMsg.error`. */
  | { kind: "error"; message: string };

/** The WIRE-SAFE options a `{ kind: "start" }` message carries — just the
 *  one thing a live `GatewayPool` cannot cross `postMessage` as (its own
 *  member functions) replaced by its configured endpoint URLs, mirroring
 *  `StreamingUploadWorkerStartOpts`'s identical `poolEndpoints` field for the
 *  identical reason. `resumeStore`/`openFile`/`deleteFile`/
 *  `isStreamingSupported` are deliberately NOT carried here at all: a real
 *  caller never needs to override any of them for a genuine dry run (they
 *  all default to the REAL implementations inside `runUploadDryRun`, which
 *  — now genuinely running inside a dedicated Worker — have real OPFS/IndexedDB
 *  access), and none of them could cross `postMessage` even if a caller
 *  wanted to (each is either a function or wraps one). */
export interface StreamingDryRunWorkerStartOpts {
  /** The main thread's `GatewayPool`'s own configured endpoint URLs. */
  poolEndpoints: string[];
}

/** The ONE inbound message shape this worker handles to START a dry run. */
export interface StreamingDryRunWorkerStartMsg {
  kind: "start";
  params: UploadAndTrackParams;
  /** The already-derived AES key (or `undefined` for an unencrypted dry
   *  run) — a `CryptoKey`, structured-clone-safe (confirmed already working
   *  this way for `StreamingUploadWorkerStartMsg.resolvedKey`). */
  resolvedKey?: CryptoKey;
  /** The self-verify decrypt check's own key override — see
   *  `RunUploadDryRunOptions.decryptionKey`'s own doc comment for why this
   *  exists at all (a real caller should normally never set it to anything
   *  other than `resolvedKey`, which is exactly what omitting this field
   *  achieves). */
  decryptionKey?: CryptoKey;
  opts: StreamingDryRunWorkerStartOpts;
}

function post(msg: StreamingDryRunWorkerMsg): void {
  self.postMessage(msg);
}

/**
 * Installs the guarded Worker-scope `Buffer` polyfill — see `uploadWorker.ts`'s
 * own identically-named helper's doc comment for the full "why a lazy
 * dynamic import, not a static one" reasoning (the SAME `e2-stoachain-
 * isolation.test.ts` static-import-scan gate applies to this file too, since
 * it lives under `src/library/streaming`). MUST complete before any other
 * import that might reference the bare `Buffer` global.
 */
async function ensureBufferPolyfill(): Promise<void> {
  const { Buffer } = await import("buffer");
  globalThis.Buffer = globalThis.Buffer ?? Buffer;
}

/** The stable IndexedDB database name this worker opens a REAL
 *  `StreamingPostResumeStore` against — a NAME DISTINCT from
 *  `uploadWorker.ts`'s own `STREAMING_RESUME_DB_NAME`, so a dry run's
 *  throwaway resume records are never written into the same database a real
 *  upload's genuine in-flight resume record lives in, even though
 *  `runUploadDryRun` already deletes its own record unconditionally on
 *  completion (defense in depth, not reliance on that cleanup alone). */
const DRY_RUN_RESUME_DB_NAME = "codex-arweave-dry-run-resume";

/**
 * Runs one dry-run action to completion, posting exactly one of the two
 * terminal messages documented on {@link StreamingDryRunWorkerMsg}. Never
 * lets a throw escape un-posted.
 */
async function runDryRun(
  params: UploadAndTrackParams,
  resolvedKey: CryptoKey | undefined,
  decryptionKey: CryptoKey | undefined,
  opts: StreamingDryRunWorkerStartOpts,
): Promise<void> {
  try {
    // FIRST — before any import that might reference the bare `Buffer`
    // global, same ordering discipline as `uploadWorker.ts`'s own `runUpload`.
    await ensureBufferPolyfill();

    const { runUploadDryRun } = await import("./dryRunUpload.js");
    const { createGatewayPool } = await import("@ancientpantheon/arweave-core");
    const { StreamingPostResumeStore } = await import("./streamingPostResumeStore.js");

    const pool = createGatewayPool({ endpoints: opts.poolEndpoints });
    const resumeStore = await StreamingPostResumeStore.open({
      indexedDB: (
        self as unknown as { indexedDB: Parameters<typeof StreamingPostResumeStore.open>[0]["indexedDB"] }
      ).indexedDB,
      databaseName: DRY_RUN_RESUME_DB_NAME,
    });

    const result = await runUploadDryRun(params, {
      pool,
      resolvedKey,
      ...(decryptionKey !== undefined ? { decryptionKey } : {}),
      resumeStore,
    });

    post({ kind: "done", result });
  } catch (err) {
    // Only the message string crosses back — never a stack/err object the
    // caller never asked for, same as `uploadWorker.ts`.
    const message = err instanceof Error ? err.message : String(err);
    post({ kind: "error", message });
  }
}

self.onmessage = (ev): void => {
  const data = ev.data;
  const kind =
    typeof data === "object" && data !== null ? (data as { kind?: unknown }).kind : undefined;

  if (kind === "start") {
    const msg = data as StreamingDryRunWorkerStartMsg;
    void runDryRun(msg.params, msg.resolvedKey, msg.decryptionKey, msg.opts);
  }
};
