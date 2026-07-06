/**
 * The Web Worker entry for off-main-thread RSA-4096 keygen (E-10, N-10).
 *
 * Thin postMessage plumbing (TDD-exempt — the seam, the fake, and the typed
 * narrowing carry the tested logic in `KeygenRunner.ts`). On a `start` message it
 * LAZY-imports arweave-core `generateKey` (the E-12 lazy path — the heavy RSA/
 * WebCrypto surface must not load statically on the light entry), runs it, and
 * posts back typed {@link KeygenWorkerMsg} values.
 *
 * JWK hygiene (N-06): the generated JWK crosses ONLY via the discrete `done`
 * message. No branch logs or serializes the key; the error branch posts only a
 * string message.
 */

import type { KeygenWorkerMsg } from "./KeygenRunner.js";

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

self.onmessage = (ev): void => {
  const data = ev.data;
  if (
    typeof data === "object" &&
    data !== null &&
    (data as { kind?: unknown }).kind === "start"
  ) {
    void runKeygen();
  }
};
