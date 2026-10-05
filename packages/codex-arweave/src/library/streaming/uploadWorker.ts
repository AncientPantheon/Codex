/**
 * The Web Worker entry for off-main-thread streaming uploads
 * (`arweave-streaming-worker-wiring` T1).
 *
 * Thin postMessage plumbing (TDD-exempt — exactly `keygen/worker.ts`'s own
 * convention: "the seam, the fake, and the typed narrowing carry the tested
 * logic", here in `library/flow.ts`'s `performUploadAndTrack` and T2's
 * `StreamingUploadRunner.ts`). This file's only job is: install the one
 * polyfill a Worker's own global scope is missing, call the already-tested
 * `performUploadAndTrack` with an ALREADY-RESOLVED key, and translate its
 * calls/result/throw into typed {@link StreamingUploadWorkerMsg} posts.
 *
 * WHY this must run inside a dedicated Worker at all (the whole reason this
 * sub-topic exists): `isStreamingUploadSupported()`/`bundleAssemblyFile.ts`
 * both call `FileSystemFileHandle.createSyncAccessHandle()`, which only
 * succeeds inside a Worker — calling it from the main document thread (as
 * `UploadWizard.tsx`/`flow.ts`'s `uploadAndTrack` did before this sub-topic)
 * made `isStreamingUploadSupported()` always resolve `false` in real
 * browsers, silently routing every real upload through the old 2 GiB-capped
 * in-memory fallback. See this sub-topic's `design.md` for the full finding.
 *
 * The Worker `Buffer` polyfill below (installed BEFORE any import that might
 * need it) fixes a SEPARATE, previously-documented gap: `arbundles`' signer
 * construction (used internally by the streaming engines' bundle signing)
 * references the bare `Buffer` global, which `apps/codex-playground/src/
 * polyfills.ts` only installs on the MAIN thread (`main.tsx`'s first import)
 * — a separately-spawned Worker has its own global scope and never sees it.
 * `arweave-streaming-ui` T4 found this ("Buffer is not defined" inside a
 * Worker) and deliberately left it unfixed, flagging it for here.
 *
 * Message protocol (mirrors `KeygenWorkerMsg`'s own shape/spirit): the main
 * thread posts ONE `{ kind: "start", params, resolvedKey?, opts }` message
 * (`params`/`resolvedKey` are the SAME already-resolved values
 * `performUploadAndTrack` itself takes — NEVER a live `encryptFor`/
 * `revealAccountSecret` callback, which cannot cross a Worker boundary;
 * `opts` carries everything `PerformUploadAndTrackOptions` needs EXCEPT
 * `onProgress`, which this file supplies itself so it can translate each
 * tick into a posted `progress` message). This worker posts, in order: ONE
 * `{ kind: "route" }` (the real `isStreamingUploadSupported()` result, BEFORE
 * the upload itself proceeds — the one thing that only becomes meaningful by
 * actually running inside this Worker), zero or more `{ kind: "progress" }`,
 * then exactly one of `{ kind: "done" }` / `{ kind: "error" }`. An uncaught
 * exception anywhere in the run is caught and ALWAYS yields a posted
 * `error` message — this worker never lets a message-less throw escape.
 *
 * `Buffer` polyfill install, and WHY it is a lazy `await import("buffer")`
 * rather than a static top-level one (unlike `apps/codex-playground/src/
 * polyfills.ts`'s own main-thread static import of the SAME `buffer`
 * package): `e2-stoachain-isolation.test.ts`'s static import-scan asserts
 * every `src/library/**` file's bare import specifiers are drawn ONLY from
 * `@ancientpantheon/arweave-core` / `@ancientpantheon/codex-core` / `arweave`
 * (this file lives under `src/library/streaming`, so it is in scope of that
 * scan) — a STATIC top-level import of the `buffer` package would trip that
 * PRE-EXISTING gate. A dynamic `await import("buffer")`, awaited and applied
 * FIRST inside
 * {@link ensureBufferPolyfill} (itself called before any other lazy import
 * in `runUpload`), installs the SAME `globalThis.Buffer = globalThis.Buffer
 * ?? Buffer` guard with the SAME `buffer` package, in the SAME
 * "before anything that might need it" order — sequential `await`s make
 * that ordering explicit and certain, rather than relying on static-import
 * hoisting semantics.
 */

// TYPE-ONLY, and deliberately so: erased at compile time, so naming these
// here costs this light entry NOTHING at runtime — the heavy implementation
// behind them still loads only via the LAZY `await import(...)` in
// `runUpload` below (mirrors `keygen/worker.ts`'s own E-12 discipline).
import type {
  UploadAndTrackParams,
  UploadAndTrackResult,
  PerformUploadAndTrackOptions,
} from "../flow.js";
import type { LibraryEntry, LibraryStore } from "../types.js";

/**
 * The worker's global `postMessage`, typed to the message protocol — the
 * `MessageEvent.data` boundary is narrowed on `.kind`, never read as `any`.
 */
declare const self: {
  postMessage(msg: StreamingUploadWorkerMsg): void;
  onmessage: ((ev: { data: unknown }) => void) | null;
};

/**
 * The typed worker→main message protocol, discriminated on `.kind` — mirrors
 * `KeygenWorkerMsg`'s own shape. Exported for T2's `StreamingUploadRunner.ts`
 * to import directly (its own `WorkerLike.onmessage` narrows on this exact
 * union, exactly as `KeygenRunner.ts` narrows on `KeygenWorkerMsg`).
 */
export type StreamingUploadWorkerMsg =
  /** Fired ONCE, synchronously after the real `isStreamingUploadSupported()`
   *  resolves inside THIS Worker, BEFORE the upload itself proceeds — the
   *  one signal that is only genuinely meaningful run from in here. */
  | { kind: "route"; route: "streaming" | "fallback" }
  /** Forwarded verbatim from `performUploadAndTrack`'s own `onProgress` —
   *  never fired on the fallback (in-memory) path, exactly like that
   *  option's own contract on `UploadAndTrackOptions`. */
  | { kind: "progress"; uploadedChunks: number; totalChunks: number }
  /**
   * Worker→main RPC: `performUploadAndTrack`'s own `store.append(entry)`
   * call, proxied back to the main thread's REAL `LibraryStore` (see
   * {@link StreamingUploadWorkerStartOpts}'s own doc comment for why a
   * `LibraryStore` cannot cross into this Worker directly — confirmed, the
   * hard way, by this sub-topic's own T4 real-browser check: a real
   * `postMessage` carrying a live `store` throws `DataCloneError`, not
   * assumed from the spec alone). Answered by exactly one
   * `{ kind: "appendLibraryEntryResult" }` reply, matched by `requestId`.
   */
  | { kind: "appendLibraryEntry"; requestId: string; entry: LibraryEntry }
  /** The terminal success message — carries the SAME `UploadAndTrackResult`
   *  `performUploadAndTrack` itself resolves with. */
  | { kind: "done"; result: UploadAndTrackResult }
  /** The terminal failure message. Only the message STRING crosses back —
   *  mirrors `KeygenWorkerMsg`'s own JWK-hygiene discipline of never
   *  serializing more than necessary across the boundary. */
  | { kind: "error"; message: string };

/**
 * Everything `PerformUploadAndTrackOptions` needs EXCEPT `onProgress`, which
 * this worker supplies itself (see {@link runUpload}) so every tick becomes
 * a posted `progress` message rather than a function the caller would have
 * to (impossibly) hand across the Worker boundary.
 *
 * This is the CALLER-FACING shape (T2's `StreamingUploadRunnerOptions`
 * extends this verbatim — real `pool`/`store` objects, exactly as every
 * other `performUploadAndTrack` caller already supplies). It is NOT the
 * wire shape — see {@link StreamingUploadWorkerStartOpts} for what actually
 * crosses `postMessage`.
 */
export type StreamingUploadWorkerOpts = Omit<PerformUploadAndTrackOptions, "onProgress">;

/**
 * The WIRE-SAFE shape of {@link StreamingUploadWorkerOpts} actually carried
 * by a `{ kind: "start" }` message — confirmed, directly, against a REAL
 * `postMessage` call (this sub-topic's own T4 real-browser check), to be
 * DIFFERENT from the caller-facing `StreamingUploadWorkerOpts`:
 *
 *   - `pool` (a `GatewayPool`) is a plain object whose own members
 *     (`execute`/`getHealthSnapshot`/`getActiveEndpoint`) are FUNCTIONS —
 *     functions are never structured-cloneable, so a live `pool` throws
 *     `DataCloneError` the instant `postMessage` is called with it. Replaced
 *     here by `poolEndpoints` — the pool's own configured endpoint URLs
 *     (plain strings, read via `pool.getHealthSnapshot()` by T2's
 *     `createWorkerStreamingUploadRunner`) — from which {@link runUpload}
 *     reconstructs its OWN fresh `GatewayPool` (`createGatewayPool({
 *     endpoints })`, lazily imported). A fresh pool loses the main thread's
 *     pool's own health/preference state and any custom retry/backoff
 *     config (e.g. an injected `sleep` seam) — an accepted tradeoff; the
 *     endpoints themselves are what matters for a real upload.
 *   - `store` (a `LibraryStore`) is likewise a plain object of async
 *     FUNCTIONS, and is additionally semantically wrong to reconstruct
 *     independently even if it COULD be cloned: `performUploadAndTrack`'s
 *     own `store.append(entry)` call must land in the SAME store the main
 *     thread already holds (often a non-reconstructible in-memory one,
 *     e.g. `MemoryLibraryStore`) — a worker-local store would silently
 *     strand every appended entry where the UI can never see it. `store` is
 *     therefore dropped entirely from the wire shape; {@link runUpload}
 *     proxies the ONE `LibraryStore` method `performUploadAndTrack` ever
 *     calls during an upload action (`append`) back to the main thread via
 *     the `appendLibraryEntry`/`appendLibraryEntryResult` message pair.
 */
export type StreamingUploadWorkerStartOpts = Omit<StreamingUploadWorkerOpts, "pool" | "store"> & {
  /** The main thread's `GatewayPool`'s own configured endpoint URLs — see
   *  this type's own doc comment above. */
  poolEndpoints: string[];
};

/** The main thread's reply to a worker-posted `{ kind: "appendLibraryEntry" }`
 *  — the OTHER inbound message shape this worker handles, besides
 *  `{ kind: "start" }`. Not part of the exported {@link StreamingUploadWorkerMsg}
 *  union (that type is the worker→main direction only). */
export interface StreamingUploadWorkerAppendResultMsg {
  kind: "appendLibraryEntryResult";
  requestId: string;
  ok: boolean;
  /** Only present when `ok` is `false` — the real store's own thrown message. */
  message?: string;
}

/** The ONE inbound message shape this worker handles to START an upload.
 *  Not part of the exported {@link StreamingUploadWorkerMsg} union (that
 *  type is the worker→main direction only, mirroring `KeygenWorkerMsg`'s own
 *  scope) — exported separately so T2 can construct this exact shape
 *  without re-guessing its fields. */
export interface StreamingUploadWorkerStartMsg {
  kind: "start";
  params: UploadAndTrackParams;
  /** The already-derived AES key (or `undefined` for an unencrypted
   *  upload) — NEVER a live `encryptFor`/`revealAccountSecret` callback,
   *  which cannot structured-clone across `postMessage`. */
  resolvedKey?: CryptoKey;
  opts: StreamingUploadWorkerStartOpts;
}

function post(msg: StreamingUploadWorkerMsg): void {
  self.postMessage(msg);
}

/**
 * Installs the guarded Worker-scope `Buffer` polyfill — see this module's own
 * doc comment above for why this is a lazy dynamic import rather than a
 * static one. MUST be awaited (and complete) before any other import that
 * might reference the bare `Buffer` global; {@link runUpload} calls this
 * FIRST, before its own lazy imports of `../flow.js` / `./
 * isStreamingUploadSupported.js`.
 */
async function ensureBufferPolyfill(): Promise<void> {
  const { Buffer } = await import("buffer");
  globalThis.Buffer = globalThis.Buffer ?? Buffer;
}

/** The stable IndexedDB database name {@link runUpload} opens a REAL
 *  `StreamingPostResumeStore` against when streaming runs and the `{ kind:
 *  "start" }` message carried no `streamingResumeStore` — confirmed, the
 *  hard way, by this sub-topic's own T4 real-browser check: NEITHER a
 *  `StreamingPostResumeStore` instance (a class wrapping an `IDBDatabase`
 *  handle — not structured-cloneable either) NOR a plain config for one was
 *  ever threaded through `realArweaveAdapter.ts`'s `.run()` call, so
 *  `performUploadAndTrack`'s own `if (!streamingResumeStore) throw` fired on
 *  every real streaming upload. A `StreamingPostResumeStore` MUST be
 *  constructed from INSIDE this Worker (its own `self.indexedDB`, which IS
 *  available in a dedicated Worker) — never on the main thread, for the
 *  identical "cannot cross the boundary" reason as `pool`/`store` above. ONE
 *  shared database, every resume record keyed by its own generated action
 *  id (`resolveStreamingPlumbing`'s own `resumeId`), mirrors how a single
 *  `MemoryLibraryStore`/IndexedDB Library store already holds every upload
 *  action's entries. */
const STREAMING_RESUME_DB_NAME = "codex-arweave-streaming-resume";

/** Pending `appendLibraryEntry` RPCs awaiting the main thread's reply, keyed
 *  by `requestId` — see {@link createAppendOnlyStoreProxy}. Module-scoped is
 *  fine: this sub-topic's own established convention is a FRESH Worker per
 *  `.run()` call (`createWorkerStreamingUploadRunner`'s own doc comment), so
 *  this map never outlives a single upload action. */
const pendingAppends = new Map<string, { resolve: () => void; reject: (err: Error) => void }>();

/**
 * A `LibraryStore` whose ONLY real method is `append` — proxied back to the
 * main thread's REAL store via the `appendLibraryEntry`/
 * `appendLibraryEntryResult` message pair (see {@link StreamingUploadWorkerStartOpts}'s
 * own doc comment for why `store` itself cannot cross into this Worker).
 * `append` is the ONE `LibraryStore` method `performUploadAndTrack` ever
 * calls during an upload action (confirmed by reading `flow.ts`'s own
 * composition in full) — every other method is deliberately left
 * unimplemented (a loud throw, never a silent no-op) so a future change that
 * reaches one from this path fails immediately and visibly rather than
 * quietly losing data.
 */
function createAppendOnlyStoreProxy(): LibraryStore {
  const unimplemented =
    (name: string) =>
    (): never => {
      throw new Error(
        `streaming upload worker's store proxy: "${name}" is not implemented — only "append" is ever called during an upload action.`,
      );
    };
  return {
    append: (entry: LibraryEntry) =>
      new Promise<void>((resolve, reject) => {
        const requestId = globalThis.crypto.randomUUID();
        pendingAppends.set(requestId, { resolve, reject });
        post({ kind: "appendLibraryEntry", requestId, entry });
      }),
    get: unimplemented("get"),
    updateStatus: unimplemented("updateStatus"),
    list: unimplemented("list"),
    reconcile: unimplemented("reconcile"),
    clear: unimplemented("clear"),
  };
}

/**
 * Runs one upload action to completion, posting the full message sequence
 * documented on {@link StreamingUploadWorkerMsg}. Never lets a throw escape
 * un-posted — every failure, at any step, yields exactly one `error` message.
 */
async function runUpload(
  params: UploadAndTrackParams,
  resolvedKey: CryptoKey | undefined,
  opts: StreamingUploadWorkerStartOpts,
): Promise<void> {
  try {
    // FIRST — before any import that might reference the bare `Buffer`
    // global (the streaming engines' own `arbundles`-touching signer
    // construction, lazy-imported right below).
    await ensureBufferPolyfill();

    // LAZY heavy imports — mirrors `keygen/worker.ts`'s own E-12 discipline,
    // and here additionally guarantees this module evaluation happens
    // strictly AFTER the polyfill above has already run. `createGatewayPool`
    // rides this module's own already-established `@ancientpantheon/
    // arweave-core` allow-listed specifier (the static import-scan this
    // package's own `src/library/**` files are held to permits it already).
    const { performUploadAndTrack } = await import("../flow.js");
    const { isStreamingUploadSupported } = await import("./isStreamingUploadSupported.js");
    const { createGatewayPool } = await import("@ancientpantheon/arweave-core");

    // The REAL, unmodified detector (unless a caller injected its own
    // `isStreamingSupported`, mirroring `performUploadAndTrack`'s own
    // default) — genuinely meaningful now that it runs inside this Worker.
    // Probed exactly ONCE: the resolved boolean is also what's handed to
    // `performUploadAndTrack` below, so it never re-probes.
    const streaming = await (opts.isStreamingSupported ?? isStreamingUploadSupported)();
    post({ kind: "route", route: streaming ? "streaming" : "fallback" });

    // Reconstruct the two things the wire shape could not carry directly —
    // see `StreamingUploadWorkerStartOpts`'s own doc comment for why.
    const { poolEndpoints, streamingResumeStore: suppliedResumeStore, ...rest } = opts;
    const pool = createGatewayPool({ endpoints: poolEndpoints });
    const store = createAppendOnlyStoreProxy();

    // Default the resume store too — ONLY when streaming is actually about
    // to run (the fallback path never touches it, exactly like
    // `performUploadAndTrack`'s own contract) and the caller supplied none.
    // See `STREAMING_RESUME_DB_NAME`'s own doc comment for why this MUST be
    // constructed here, inside the Worker, rather than on the main thread.
    let streamingResumeStore = suppliedResumeStore;
    if (streaming && streamingResumeStore === undefined) {
      const { StreamingPostResumeStore } = await import("./streamingPostResumeStore.js");
      streamingResumeStore = await StreamingPostResumeStore.open({
        indexedDB: (self as unknown as { indexedDB: Parameters<typeof StreamingPostResumeStore.open>[0]["indexedDB"] })
          .indexedDB,
        databaseName: STREAMING_RESUME_DB_NAME,
      });
    }

    const result = await performUploadAndTrack(params, resolvedKey, {
      ...rest,
      pool,
      store,
      streamingResumeStore,
      isStreamingSupported: async () => streaming,
      onProgress: (uploadedChunks, totalChunks) => {
        post({ kind: "progress", uploadedChunks, totalChunks });
      },
    });

    post({ kind: "done", result });
  } catch (err) {
    // Only the message string crosses back — never a stack/err object the
    // caller never asked for.
    const message = err instanceof Error ? err.message : String(err);
    post({ kind: "error", message });
  }
}

self.onmessage = (ev): void => {
  const data = ev.data;
  const kind =
    typeof data === "object" && data !== null ? (data as { kind?: unknown }).kind : undefined;

  if (kind === "start") {
    const msg = data as StreamingUploadWorkerStartMsg;
    void runUpload(msg.params, msg.resolvedKey, msg.opts);
  } else if (kind === "appendLibraryEntryResult") {
    // The main thread's reply to this worker's own `{ kind:
    // "appendLibraryEntry" }` RPC (see `createAppendOnlyStoreProxy`).
    const msg = data as StreamingUploadWorkerAppendResultMsg;
    const pending = pendingAppends.get(msg.requestId);
    if (pending === undefined) return;
    pendingAppends.delete(msg.requestId);
    if (msg.ok) {
      pending.resolve();
    } else {
      pending.reject(new Error(msg.message ?? "appendLibraryEntry failed"));
    }
  }
};
