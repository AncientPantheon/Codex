/**
 * Gateway pool configuration and public interface types.
 *
 * The Arweave gateway pool is a config-driven, dependency-free funnel: a
 * caller-supplied per-endpoint async operation is routed across an ordered
 * endpoint list, rotating on failure. Switching to a self-run gateway is a
 * config change ONLY (the endpoint list is used verbatim); the pool carries
 * no cross-chain abstraction, adapter interface, or consumer wiring.
 */

/** Sleep seam: a delay function the pool awaits between retries. Injectable
 *  so tests stay instant and deterministic (no real timers). Defaults to a
 *  real `setTimeout`-backed delay. Backoff delays are wired to this seam by
 *  the health/backoff layer. */
export type SleepFn = (ms: number) => Promise<void>;

/** Monotonic-ish clock seam: returns the current time in milliseconds.
 *  Injectable so health cooldown comparisons are deterministic in tests.
 *  Defaults to `Date.now`. Consumed by the health layer. */
export type NowFn = () => number;

/** Opaque handle a scheduled request-timeout timer returns, passed back to
 *  {@link ClearRequestTimerFn} to cancel it. Its concrete type is the timer
 *  seam's business (a `setTimeout` handle by default) — the pool treats it as
 *  a token. */
export type RequestTimerHandle = unknown;

/** Cancelable request-timeout timer seam: schedules `onTimeout` to fire after
 *  `ms` and returns a handle. Injectable so the never-settles abort is
 *  deterministic in tests (a fake fires it synchronously); defaults to a real
 *  `setTimeout`. Distinct from {@link SleepFn} because the request-timeout timer
 *  MUST be cancelable (cleared when the op settles in time) — a fire-and-forget
 *  `sleep` promise cannot be. */
export type SetRequestTimerFn = (
  onTimeout: () => void,
  ms: number,
) => RequestTimerHandle;

/** Cancels a timer scheduled by {@link SetRequestTimerFn}. Defaults to
 *  `clearTimeout`. */
export type ClearRequestTimerFn = (handle: RequestTimerHandle) => void;

/** The per-attempt context handed to a {@link GatewayOperation} as its second
 *  argument: carries the `AbortSignal` that fires when the attempt's
 *  request-timeout elapses, so a black-holed gateway can be abandoned. */
export interface GatewayOperationContext {
  /** Aborts when this attempt's `requestTimeoutMs` elapses. Consumers thread it
   *  into `fetch(url, { signal })` (or race it against a non-abortable call) so
   *  a never-settling request is bounded and the pool rotates. */
  readonly signal: AbortSignal;
}

/**
 * Configuration for a gateway pool. Every field has a spec-defined behavior:
 * rotation/retry fields are honored by the core funnel; backoff/health fields
 * are declared here as the single config surface and wired to delays and
 * health-aware selection by the backoff/health layer. No dangling fields.
 */
export interface GatewayPoolConfig {
  /** Ordered list of gateway base URLs. Used verbatim. Defaults to
   *  `["https://arweave.net"]`. Each entry MUST be `new URL(...)`-parseable
   *  (parseability only — a self-run `http://localhost:1984` is valid). */
  endpoints?: string[];

  /** How many times EACH endpoint is attempted before the pool call is
   *  considered exhausted. Defaults to `3` — a transient hiccup on the
   *  default single-endpoint config does not terminally fail the call. */
  maxAttemptsPerEndpoint?: number;

  /** Delay seam awaited between successive failed attempts. Defaults to a
   *  real `setTimeout`-backed delay. Backoff delays are wired to this seam. */
  sleep?: SleepFn;

  /** Clock seam for health cooldown comparisons. Defaults to `Date.now`.
   *  Consumed by the health layer. */
  now?: NowFn;

  /** Base backoff delay in milliseconds between successive failed attempts.
   *  Consumed by the backoff layer. */
  backoffBaseMs?: number;

  /** Cap on the exponentially-growing backoff delay in milliseconds.
   *  Consumed by the backoff layer. */
  backoffMaxMs?: number;

  /** How long a failed endpoint is skipped in selection ordering before it
   *  becomes eligible again, in milliseconds. Consumed by the health layer. */
  healthCooldownMs?: number;

  /** Per-endpoint-attempt request timeout in milliseconds. Each attempt is
   *  bounded by an `AbortSignal` that fires after this many ms, so a black-holed
   *  gateway (connection accepted, response never sent) is abandoned and the
   *  pool rotates instead of stalling. Must be a positive integer when provided.
   *  Defaults to `15000`. */
  requestTimeoutMs?: number;

  /** Cancelable request-timeout timer seam. Defaults to a real `setTimeout`.
   *  Injected in tests to fire the abort deterministically (no real wall time). */
  setRequestTimer?: SetRequestTimerFn;

  /** Cancels a scheduled request-timeout timer. Defaults to `clearTimeout`. */
  clearRequestTimer?: ClearRequestTimerFn;
}

/** A caller-supplied operation run against one endpoint base URL. The single
 *  funnel through which every gateway post and read flows. Receives a
 *  {@link GatewayOperationContext} whose `signal` aborts when the attempt's
 *  request-timeout elapses; consumers thread it into their network call so a
 *  hung request is bounded. */
export type GatewayOperation<T> = (
  endpointBaseUrl: string,
  context: GatewayOperationContext,
) => Promise<T>;

/** One endpoint's health record, as observed through the pool's snapshot
 *  accessor. Eagerly initialized at construction — one entry per configured
 *  endpoint, verbatim string, configured order. `healthy` transitions are
 *  driven by the health layer. */
export interface EndpointHealth {
  /** The configured endpoint base URL, verbatim. */
  readonly endpoint: string;
  /** Whether the endpoint is currently eligible for preferred selection. */
  readonly healthy: boolean;
  /** Whether this endpoint is the pool's currently active (preferred) one. */
  readonly active: boolean;
}

/** The gateway pool's public surface. */
export interface GatewayPool {
  /** Run `operation` against the pool's endpoints, rotating on failure until
   *  every endpoint has been attempted `maxAttemptsPerEndpoint` times. Resolves
   *  with the first successful result; on exhaustion rejects with exactly one
   *  `GatewayPoolExhaustedError` carrying every per-attempt failure. Each attempt
   *  is bounded by `requestTimeoutMs` — the `operation` receives an
   *  {@link GatewayOperationContext} whose `signal` aborts on timeout. */
  execute<T>(operation: GatewayOperation<T>): Promise<T>;

  /** The observable per-endpoint health surface. Returns exactly one entry per
   *  configured endpoint, verbatim string, in configured order — eagerly
   *  available from construction, before any call. */
  getHealthSnapshot(): ReadonlyArray<EndpointHealth>;

  /** The endpoint the next call prefers to start from (active-endpoint
   *  preference — the only shared instance state besides health records). */
  getActiveEndpoint(): string;
}
