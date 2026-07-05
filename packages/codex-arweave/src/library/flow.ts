/**
 * The Library COMPOSITION flows (E-07) — the upload→track→poll→open path.
 *
 * Composes the two shipped seams WITHOUT re-authoring either: the adapter
 * `upload` (arweave-core `uploadData`) for the write, the `LibraryStore` seam
 * for persistence, and arweave-core `getTransactionStatus` / the `GatewayPool`
 * for the confirmation and open paths.
 *
 * N-07: this module imports ONLY the `LibraryStore` seam + arweave-core + the
 * adapter upload. It NEVER touches the codec / `saveAll` / `foreignKeys` — the
 * Library is a separate store from the codex backup and holds only public,
 * on-chain metadata (no JWK, no ciphertext, no password ever reaches an entry).
 *
 * The finality gate is DELEGATED, not re-derived: arweave-core owns
 * `final = confirmations >= depth`; this module flips an entry to `final` ONLY
 * when arweave-core reports `confirmed && final === true`, and forwards an
 * omitted `confirmationDepth` as `undefined` so arweave-core's exported
 * `DEFAULT_CONFIRMATION_DEPTH` applies — never a hardcoded local value.
 */

import {
  uploadData,
  isCanonicalAddress,
  type UploadParams,
  type UploadResult,
  type TurboUploadClientFactory,
  type GatewayPool,
} from "@ancientpantheon/arweave-core";
// Namespace import so `vi.spyOn(arweaveCore, "getTransactionStatus")` in the
// test intercepts THIS call site: a destructured local binding would capture
// the original function reference and defeat the spy.
import * as arweaveCore from "@ancientpantheon/arweave-core";

import { MANIFEST_CONTENT_TYPE } from "./constants.js";
import type { LibraryEntry, LibraryStore } from "./types.js";

/** Options for {@link uploadAndTrack}. */
export interface UploadAndTrackOptions {
  /** The Library persistence seam the pending entry is appended to. */
  store: LibraryStore;
  /** Injectable Turbo client factory forwarded to `uploadData` — tests inject a
   *  fake so no real, permanent upload is ever made. */
  clientFactory?: TurboUploadClientFactory;
  /** Injectable wall clock for the entry's `createdAt`; defaults to `Date.now`.
   *  Pinned as a seam so tests are deterministic. */
  now?: () => number;
}

/** Options for {@link pollStatus}. */
export interface PollStatusOptions {
  /** The gateway pool the status read runs through (POOL-FIRST arg). */
  pool: GatewayPool;
  /** The Library seam whose entry is flipped to `final` on deep confirmation. */
  store: LibraryStore;
  /** Injectable fetch seam forwarded to arweave-core — tests inject a fake. */
  fetchFn?: typeof fetch;
  /** Confirmations at/above which the tx is final. When omitted, `undefined` is
   *  forwarded so arweave-core applies its `DEFAULT_CONFIRMATION_DEPTH`. */
  confirmationDepth?: number;
}

/** Options for {@link openUrl}. */
export interface OpenUrlOptions {
  /** The gateway pool whose healthy endpoint the link is composed against. */
  pool: GatewayPool;
}

/** Whether a content type is the Arweave path-manifest type (one entry / one link). */
function isManifestContentType(contentType: string): boolean {
  return contentType === MANIFEST_CONTENT_TYPE;
}

/**
 * Upload `params` and, ONLY after the upload RESOLVES, append a `pending`
 * {@link LibraryEntry} to the store.
 *
 * The append is upload-THEN-append: a throwing Turbo client rejects and leaves
 * the store EMPTY (no phantom-pending placeholder). The JWK rides
 * `params.jwk` as a per-call transient and is NEVER persisted in the entry.
 */
export async function uploadAndTrack(
  params: UploadParams,
  opts: UploadAndTrackOptions,
): Promise<UploadResult> {
  const { store, clientFactory, now = Date.now } = opts;

  // Upload FIRST. A rejection propagates here, before any store write — so the
  // failure path never leaves an orphan pending entry.
  const result = await uploadData(
    params,
    clientFactory ? { clientFactory } : undefined,
  );

  const entry: LibraryEntry = {
    id: result.id,
    owner: result.ownerAddress,
    itemId: result.itemId,
    contentType: params.contentType,
    status: "pending",
    createdAt: now(),
    tags: [...result.tags],
    ...(isManifestContentType(params.contentType)
      ? { manifest: { isManifest: true } as const }
      : {}),
  };

  await store.append(entry);
  return result;
}

/**
 * Poll `id`'s confirmation status through the pool and flip its entry to `final`
 * ONLY when arweave-core reports `confirmed && final === true`.
 *
 * Every other result LEAVES the entry pending with no throw: a shallow
 * `confirmed && final:false`, a `pending`, and a `not-found` all no-op. Finality
 * is arweave-core's decision — this function does not re-derive it.
 */
export async function pollStatus(
  id: string,
  opts: PollStatusOptions,
): Promise<void> {
  const { pool, store, fetchFn, confirmationDepth } = opts;

  // POOL-FIRST arity: getTransactionStatus(pool, id, opts). `confirmationDepth`
  // is forwarded verbatim — when omitted it is `undefined`, so arweave-core's
  // DEFAULT_CONFIRMATION_DEPTH governs (never a local 10).
  const status = await arweaveCore.getTransactionStatus(pool, id, {
    fetchFn,
    confirmationDepth,
  });

  if (status.status === "confirmed" && status.final === true) {
    await store.updateStatus(id, "final");
  }
}

/**
 * Compose the gateway URL for `id` against a HEALTHY endpoint.
 *
 * Selection: prefer a `healthy && active` endpoint; else any `healthy`; else
 * fall back to `getActiveEndpoint()` (active is NOT guaranteed healthy). A
 * non-canonical id throws before any URL is composed. Never hardcodes a gateway.
 */
export function openUrl(id: string, opts: OpenUrlOptions): string {
  if (!isCanonicalAddress(id)) {
    throw new Error(`openUrl: non-canonical arweave id "${id}"`);
  }

  const { pool } = opts;
  const snapshot = pool.getHealthSnapshot();

  const healthyActive = snapshot.find((e) => e.healthy && e.active);
  const healthy = healthyActive ?? snapshot.find((e) => e.healthy);
  const endpoint = healthy ? healthy.endpoint : pool.getActiveEndpoint();

  // Strip a trailing slash so a caller-configured endpoint like
  // "https://arweave.net/" yields a single-slash join, not "//<id>".
  const base = endpoint.replace(/\/+$/, "");
  return `${base}/${id}`;
}
