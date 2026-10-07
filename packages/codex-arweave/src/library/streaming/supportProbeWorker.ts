/**
 * The Web Worker entry for the OPFS-streaming-support probe
 * (`arweave-streaming-ui-support-probe-worker`).
 *
 * Thin postMessage plumbing (TDD-exempt — mirrors `uploadWorker.ts`'s/
 * `dryRunWorker.ts`'s own convention: "the seam, the fake, and the typed
 * narrowing carry the tested logic", here `isStreamingUploadSupported.ts`
 * itself, already fully tested). This file's only job is: call the
 * already-tested `isStreamingUploadSupported()` and translate its resolved
 * boolean into a typed {@link SupportProbeWorkerMsg} post.
 *
 * WHY this must run inside a dedicated Worker at all (the whole reason this
 * sub-topic exists): `isStreamingUploadSupported()` internally calls
 * `FileSystemFileHandle.createSyncAccessHandle()`, which, by Web spec, only
 * succeeds inside a Worker — calling it from the main document thread (as
 * `UploadWizard.tsx`'s own mount-time `useEffect` did before this sub-topic)
 * makes it always throw internally and always resolve `false`, in EVERY real
 * browser, regardless of genuine OPFS support — exactly the bug this
 * sub-topic's own bug-report.md documents (confirmed directly against a real
 * 6 GB-folder upload in Vivaldi). `uploadWorker.ts`/`dryRunWorker.ts` already
 * had to solve this identical problem for the real-upload and dry-run call
 * sites; this worker solves it for `UploadWizard`'s own Files-step banner/cap
 * call site, the one remaining place that still called the probe on the main
 * thread.
 *
 * DEDICATED worker, not a new message kind bolted onto `uploadWorker.ts`:
 * `uploadWorker.ts`'s own `{ kind: "start" }` handler already computes this
 * exact same probe result as ITS first step, but doing so pulls in the
 * Buffer polyfill, a reconstructed `GatewayPool`, a `LibraryStore` append
 * proxy, and (on the streaming route) a real `StreamingPostResumeStore` —
 * none of which a bare "is streaming even supported" check has any use for,
 * and all of which would have to be either faked or skipped by a new
 * early-exit branch grafted into that already-dense file. `dryRunWorker.ts`
 * already established the precedent this file follows: when a call site
 * needs ONLY the probe (or, there, only a dry run) and nothing else
 * `uploadWorker.ts`'s `runUpload` does, it gets its OWN thin worker entry
 * rather than a new conditional path threaded through the real upload
 * worker. This worker is the thinnest of the three: no Buffer polyfill
 * (never touches `arbundles`/signing), no lazy heavy imports beyond the
 * probe itself.
 *
 * Message protocol: the main thread posts ONE `{ kind: "check" }` message;
 * this worker posts exactly one `{ kind: "result", supported: boolean }` in
 * reply — the real `isStreamingUploadSupported()` itself never throws (its
 * own doc comment: "this function never throws", every failure path folds
 * into a `false` resolution), so there is no `error` message in this
 * protocol, unlike `uploadWorker.ts`'s/`dryRunWorker.ts`'s own richer ones.
 */

import { isStreamingUploadSupported } from "./isStreamingUploadSupported.js";

/**
 * The worker's global `postMessage`, typed to the message protocol — the
 * `MessageEvent.data` boundary is narrowed on `.kind`, never read as `any`.
 */
declare const self: {
  postMessage(msg: SupportProbeWorkerMsg): void;
  onmessage: ((ev: { data: unknown }) => void) | null;
};

/** The typed worker→main message protocol, discriminated on `.kind` —
 *  exported for `SupportProbeRunner.ts` to import directly (its own
 *  `WorkerLike.onmessage` narrows on this exact union, mirroring
 *  `StreamingUploadWorkerMsg`/`StreamingDryRunWorkerMsg`'s own convention). */
export type SupportProbeWorkerMsg = {
  kind: "result";
  supported: boolean;
};

/** The ONE inbound message shape this worker handles. Not part of the
 *  exported {@link SupportProbeWorkerMsg} union (that type is the
 *  worker→main direction only, mirroring `StreamingUploadWorkerStartMsg`'s
 *  own scope). */
export interface SupportProbeWorkerCheckMsg {
  kind: "check";
}

function post(msg: SupportProbeWorkerMsg): void {
  self.postMessage(msg);
}

self.onmessage = (ev): void => {
  const data = ev.data;
  const kind =
    typeof data === "object" && data !== null ? (data as { kind?: unknown }).kind : undefined;

  if (kind === "check") {
    void isStreamingUploadSupported().then((supported) => {
      post({ kind: "result", supported });
    });
  }
};
