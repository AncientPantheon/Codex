/**
 * The Arweave `ForeignChainAdapter` — a thin conformance wrapper over the
 * shipped `arweave-core` primitives.
 *
 * D3 (`@ancientpantheon/codex-core`) owns the chain-agnostic `ForeignChainAdapter`
 * CONTRACT: it declares each method opaquely as `(...args: unknown[])` so the
 * generic package bakes in no Arweave concepts. E1 REFINES those placeholders
 * into concrete Arweave shapes here — generate/import/address/balance delegate to
 * `arweave-core`, and the transaction signer (`sign`/`post`/`buildSend`) is
 * stubbed until E2/Phase 12.
 *
 * getBalance ARITY (FIX-8): arweave-core's `getBalance(pool, address, opts?)`
 * needs a `GatewayPool`, but the refined PUBLIC surface is `getBalance(address)`
 * (arity 1). Rather than leak a pool into every call site, the pool is
 * CONSTRUCTOR-INJECTED via `createArweaveAdapter({ pool })` and closed over —
 * matching arweave-core's no-module-global-state discipline. An optional
 * `fetchFn` is likewise closed over and forwarded to arweave-core's injectable
 * fetch seam (so a consumer/test drives balance reads with zero real network).
 *
 * FUNDS-CRITICAL: no method here logs, echoes, or serializes any JWK private
 * field (`d`/`p`/`q`/`dp`/`dq`/`qi`). Errors surface UNWRAPPED from arweave-core
 * (which names the offending field only) so `instanceof` catches stay intact.
 */

import {
  generateKey,
  importKeyfile,
  addressOf,
  getBalance,
  sendTransfer,
  uploadData,
  arToWinston,
  isCanonicalAddress,
  InvalidTransferError,
  type ArweaveJwk,
  type GatewayPool,
  type TransferResult,
  type TransferGatewayApiFactory,
  type UploadParams,
  type UploadResult,
  type UploadOptions,
} from "@ancientpantheon/arweave-core";
import type Transaction from "arweave/node/lib/transaction";
import type {
  ForeignChainAdapter,
  ForeignChainRegistry,
} from "@ancientpantheon/codex-core";

import { signArweaveTransaction } from "../signer/index.js";
import { NotImplementedError } from "./errors.js";

/**
 * The stable id the Arweave adapter registers under. Shares the string namespace
 * with `ForeignKeyEntry.chainId`, so a stored foreign key resolves to this driver.
 * Sourced from the single-source const module so the id is spelled exactly once
 * across the package; re-exported to preserve the adapter's public surface.
 */
export { ARWEAVE_CHAIN_ID } from "../address-book/chainId.js";
import { ARWEAVE_CHAIN_ID } from "../address-book/chainId.js";

/** Construction-time dependencies for the Arweave adapter. */
export interface ArweaveAdapterDeps {
  /** The gateway pool balance reads run through. Constructor-injected so the
   *  public `getBalance` stays `(address)` (arity 1). Required to read a
   *  balance; the adapter otherwise operates without it. */
  pool?: GatewayPool;
  /** Injectable fetch seam forwarded to arweave-core's `getBalance`; lets a
   *  consumer/test resolve balance reads with no real network. */
  fetchFn?: typeof fetch;
}

/**
 * Display-or-base-unit inputs to `buildSend`. AR strings (`amountAr`/
 * `maxRewardAr`) are converted to winston EXACTLY via arweave-core `arToWinston`;
 * winston bigints (`quantityWinston`/`maxRewardWinston`), if supplied, are taken
 * verbatim. The AR path is the primary shape; the bigint path is additive for a
 * caller that already holds base units. `maxReward` (either form) is MANDATORY —
 * the fee cap.
 */
export interface BuildSendParams {
  /** The recipient — canonical 43-char base64url. */
  target: string;
  /** The amount to send, as a display AR string (converted via `arToWinston`). */
  amountAr?: string;
  /** The amount to send, already in winston (taken verbatim). */
  quantityWinston?: bigint;
  /** The fee cap, as a display AR string (converted via `arToWinston`). */
  maxRewardAr?: string;
  /** The fee cap, already in winston (taken verbatim). */
  maxRewardWinston?: bigint;
}

/**
 * The validated, jwk-LESS transfer intent `buildSend` produces and `post`
 * consumes. Deliberately carries NO key: buildSend does no decrypt, so the
 * unlock gate stays meaningful — the JWK is merged in only at `post` time.
 */
export interface BuiltArweaveSend {
  readonly target: string;
  readonly quantity: bigint;
  readonly maxRewardWinston: bigint;
}

/** Per-call options for `post`. Forwards the injectable per-endpoint gateway
 *  seam into arweave-core `sendTransfer` so tests drive the send with zero real
 *  network (without it, arweave-core's default factory hits the real network). */
export interface PostOptions {
  apiFactory?: TransferGatewayApiFactory;
}

/**
 * Resolve a winston `bigint` from either a display AR string (via the strict
 * `arToWinston` gate — rejects floats/`1e3`/`0x`/>12 fractional digits/negatives
 * with `InvalidAmountError`) or a verbatim winston bigint. Returns `undefined`
 * when neither is supplied so the caller decides whether the field is required.
 */
function resolveWinston(
  ar: string | undefined,
  winston: bigint | undefined,
): bigint | undefined {
  if (winston !== undefined) {
    return winston;
  }
  if (ar !== undefined) {
    return arToWinston(ar);
  }
  return undefined;
}

/**
 * Create an Arweave `ForeignChainAdapter`. `generate`/`import`/`address`/`balance`
 * delegate to `arweave-core`; `sign` delegates to the isolated sibling signer
 * (`signArweaveTransaction` → arweave-core `signTransaction`). `post`/`buildSend`
 * run the native send. `upload` delegates to arweave-core `uploadData` — a
 * permaweb data write (E3); the JWK rides `params.jwk` per-call and the Turbo
 * client is injected via `opts.clientFactory`.
 */
export function createArweaveAdapter(
  deps: ArweaveAdapterDeps = {},
): ForeignChainAdapter {
  const { pool, fetchFn } = deps;

  return {
    id: ARWEAVE_CHAIN_ID,

    generateKey: () => generateKey(),

    importKey: async (raw: unknown) => importKeyfile(raw),

    addressOf: (jwk: ArweaveJwk) => addressOf(jwk),

    getBalance: (address: string): Promise<bigint> => {
      if (pool === undefined) {
        throw new NotImplementedError("getBalance (no gateway pool injected)");
      }
      return getBalance(pool, address, fetchFn ? { fetchFn } : undefined);
    },

    buildSend: async (params: BuildSendParams): Promise<BuiltArweaveSend> => {
      // Target FIRST — a bad recipient must fail before any amount math and
      // before any network (buildSend is fully offline).
      if (!isCanonicalAddress(params.target)) {
        throw new InvalidTransferError("bad-target", params.target);
      }

      // AR→winston is EXACT via arweave-core `arToWinston` ONLY — a malformed
      // amount surfaces `InvalidAmountError` (never a silent float coercion).
      const quantity = resolveWinston(params.amountAr, params.quantityWinston);
      if (quantity === undefined) {
        throw new InvalidTransferError("non-positive-quantity");
      }

      // The fee cap is MANDATORY — an absent max-reward is rejected here, before
      // any network (an untrusted gateway quotes the reward that is signed and
      // paid verbatim, so the caller MUST state their ceiling).
      const maxRewardWinston = resolveWinston(
        params.maxRewardAr,
        params.maxRewardWinston,
      );
      if (maxRewardWinston === undefined) {
        throw new InvalidTransferError("missing-max-reward");
      }

      return { target: params.target, quantity, maxRewardWinston };
    },

    sign: (tx: Transaction, jwk: ArweaveJwk): Promise<Transaction> =>
      signArweaveTransaction(tx, jwk),

    post: async (
      built: BuiltArweaveSend,
      jwk: ArweaveJwk,
      opts?: PostOptions,
    ): Promise<TransferResult> => {
      if (pool === undefined) {
        throw new NotImplementedError("post (no gateway pool injected)");
      }
      // The JWK is a PER-CALL TRANSIENT arg (never a constructor dep, never
      // cached/closed-over) — a re-locked codex must not sign with a stale key.
      // Merged with the built intent here, at call time.
      // arweave-core `sendTransfer` is POOL-FIRST (pool, params, opts); it runs
      // the full anchor→price→fee-cap→build→sign→post recipe and inherits the
      // pool's rotation. `RewardExceedsCapError` surfaces to the caller.
      return sendTransfer(pool, { jwk, ...built }, opts);
    },

    upload: (
      params: UploadParams,
      opts?: UploadOptions,
    ): Promise<UploadResult> => {
      // A thin delegate to arweave-core `uploadData`. The JWK is a PER-CALL
      // transient carried inside `params.jwk` (mirroring `post`'s per-call key,
      // never a constructor dep, never cached) so a re-locked codex cannot sign
      // an upload with a stale key. `uploadData` owns the whole recipe —
      // key-validate → owner-address → required tag schema → the INJECTED Turbo
      // client → id validation — so this adapter re-authors none of it. The
      // `clientFactory` seam is forwarded verbatim: tests inject a fake so no
      // real, permanent Turbo upload is ever made. arweave-core's typed errors
      // (`InvalidUploadParamsError`, `UploadFailedError`) propagate UNWRAPPED,
      // and the JWK never reaches a log, tag, or error.
      return uploadData(params, opts);
    },
  };
}

/**
 * Register the Arweave adapter into an instance-scoped D3 registry. A helper
 * (not a module-global singleton) so the consumer owns the registry and a second
 * foreign chain co-registers without touching generic code (N-05).
 */
export function registerArweave(
  registry: ForeignChainRegistry,
  deps: ArweaveAdapterDeps = {},
): void {
  registry.register(createArweaveAdapter(deps));
}
