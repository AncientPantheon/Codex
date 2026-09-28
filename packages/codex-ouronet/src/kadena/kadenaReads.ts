/**
 * kadenaReads — raw Pact-constructor reads against REAL Kadena mainnet,
 * bypassing `@stoachain/stoa-core`'s `pactRead` entirely.
 *
 * WHY THIS FILE EXISTS, AND WHY IT DOES NOT REUSE `pactRead`. Confirmed
 * 2026-09-26, reading `@stoachain/stoa-core`'s own source
 * (`dist/network/nodeFailover.js`, `dist/constants/kadena.js`,
 * `dist/reads/rawCalibratedRead.js`): every transaction `pactRead` builds is
 * stamped `.setNetworkId(KADENA_NETWORK)` where `KADENA_NETWORK = "stoa"` —
 * hardcoded, with NO override seam anywhere (no setter, no per-call option,
 * no env var). A transaction built this way and sent to a real Kadena
 * mainnet node would be rejected node-side as a network-id mismatch, no
 * matter which host it's addressed to. Owner directive, 2026-09-26: "for
 * this we need directly pact constructors, there arent any modules we can
 * call the reading functions from" — confirmed independently: real Kadena
 * mainnet has none of Ouronet's custom deployed contracts (DALOS/CODEX/
 * PYTHIA/DPTF/etc — all `ouronet-ns`-namespaced, Stoa-only), only the
 * standard `coin` (fungible-v2 KDA) module every Chainweb-family chain
 * ships with. So every read here is a bare, hand-built `coin.get-balance`/
 * `coin.details` Pact-code string — no module/builder to call into, exactly
 * as instructed.
 *
 * THE MECHANISM. `createClient(url).dirtyRead(tx)`, from
 * `@stoachain/kadena-stoic-legacy/client`, is the SAME low-level primitive
 * stoa-core's own `getFailoverClient` is built on internally
 * (`dist/network/failoverClient.js`: `import { createClient } from
 * "@stoachain/kadena-stoic-legacy/client"`, then
 * `createClient(url).dirtyRead(transaction, ...)`) — this module calls it
 * directly with Kadena's own host + `networkId: "mainnet01"` instead of
 * letting stoa-core's wrapper inject its hardcoded Stoa ones. No new
 * fetch/error-handling code: `createClient`'s `dirtyRead` already does the
 * HTTP POST to `{base}/api/v1/local?preflight=false&signatureVerification=false`
 * and parses the `{result: {status, data}}` response envelope.
 *
 * SCOPE: reads only. Signing/submitting a transaction against real Kadena
 * mainnet needs its own wiring (a Kadena-compatible signer, a GAS_PAYER
 * equivalent or a self-paying sender, etc.) — owner directive: "when doing
 * transfer for kadena wed need to wire other functions... lets wire first
 * the kadena switch, and read functions" — so that is explicit, separate,
 * future work, not attempted here.
 */

import { Pact, createClient } from "@stoachain/kadena-stoic-legacy/client";

/** The Pact networkId real Kadena mainnet nodes expect — NOT `"stoa"`. */
export const KADENA_MAINNET_NETWORK_ID = "mainnet01";

/**
 * Our own Kadena mainnet node — mirrors `STOACHAIN_DEFAULT_NODE_URL`'s own
 * convention (a house-operated node as the real default, not a third-party
 * public one). Surfaced, not hidden — fully user-editable via the Network
 * tab's Kadena row.
 *
 * HISTORY, in order:
 *   1. `"https://api.chainweb.com"` — the documented official Kadena
 *      mainnet01 endpoint per Kadena's own docs — turned out to be an
 *      AUTHORITATIVE NXDOMAIN (confirmed against chainweb.com's own AWS
 *      nameservers, `aa` flag set): the domain is real, that specific host
 *      never existed. Dropped 2026-09-27, no fallback ever referenced it.
 *   2. `"http://bytales.duckdns.org:31849"` — the direct Pact node,
 *      confirmed live and correct, but PLAIN HTTP (mixed-content-blocked
 *      from any HTTPS page) and independently confirmed to hairpin-NAT for
 *      anyone on the node's own LAN — a live-reported "Kadena simulation
 *      timed out after 10000ms" traced to exactly this: the node was
 *      genuinely unreachable (confirmed via a raw TCP connect test from an
 *      unrelated network, not a code bug) from BOTH the tester's own
 *      machine and a completely separate sandbox. Kept below as a
 *      SELECTABLE option, no longer the default.
 *   3. `"https://denascan.ancientholdings.eu"` (2026-09-28, CURRENT) — a
 *      transparent Chainweb passthrough gateway, deployed specifically to
 *      unblock this: same `/chainweb/0.0/mainnet01/chain/<id>/pact/api/v1/
 *      {local,send,poll,listen}` + `/pact/spv` path shape `kadenaPactUrl`
 *      already builds (confirmed — this file's own `kadenaPactUrl` needed
 *      NO changes, only this origin), HTTPS (no mixed-content issue), CORS
 *      open (`access-control-allow-origin: *`), and — critically, unlike
 *      the REST-only `kadenaBalanceSource.ts` gateway endpoints — a REAL
 *      passthrough that also forwards `/send`, so signing and broadcasting
 *      a real transaction works through it too, not just reads. Verified
 *      live from inside the node's own LAN (the exact case #2 above
 *      failed). Unauthenticated, rate-limited 100 req/min/IP by design —
 *      answerless (not necessarily erroring) if the underlying node itself
 *      is ever down, since the gateway only proxies, it doesn't cache.
 */
export const KADENA_MAINNET_DEFAULT_NODE_URL = "https://denascan.ancientholdings.eu";

/** The direct Pact node — real and correct, but plain HTTP (mixed-content
 *  risk from an HTTPS page) and hairpin-NATs for anyone on its own LAN (see
 *  `KADENA_MAINNET_DEFAULT_NODE_URL`'s own doc comment, history #2). Kept as
 *  a SELECTABLE Network-tab option for whoever is actually on that LAN and
 *  wants to bypass the gateway, never the default. */
export const KADENA_DIRECT_NODE_URL = "http://bytales.duckdns.org:31849";

/** The conventional default chain for a single-chain balance read. Real
 *  Kadena mainnet has 20 chains (0-19) — see `KADENA_CHAINS` below for the
 *  full topology used by the multi-chain balance grid. */
export const KADENA_MAINNET_DEFAULT_CHAIN_ID = "0";

/** Kadena mainnet's chain count — 20 (0-19), vs. StoaChain's 10 (`STOA_CHAIN_COUNT`
 *  in `@stoachain/stoa-core/constants`). Real chain topology, not a guess:
 *  Kadena mainnet has run 20 chains since the 2020 "Chain 10-19" expansion. */
export const KADENA_CHAIN_COUNT = 20;
/** `["0", "1", ..., "19"]` — mirrors `STOA_CHAINS`'s own shape/naming. */
export const KADENA_CHAINS: readonly string[] = Array.from(
  { length: KADENA_CHAIN_COUNT },
  (_, i) => String(i),
);

/**
 * The ACTIVE Kadena node URL — a module-level global, deliberately mirroring
 * `@stoachain/stoa-core`'s own `setNodeConfig`/`getActiveHost` pattern
 * (`createStoaChainConnection.ts`'s own doc comment: "there is exactly one
 * lever... and pulling it redirects reads"). This lets the Network tab's
 * Kadena row (owned by the CONSUMING app, e.g. `apps/codex-playground`) set
 * the node once, and every deeply-nested Kadena read (`useKadenaBalances`,
 * `StoaAccountsTab`'s Kadena mode) picks it up transparently — no prop
 * drilling through `ForeignChainsTab` → `ChainwebPanel` → `StoaAccountsTab`
 * needed for the URL itself, matching how the SAME Network tab's StoaChain
 * row already reaches deeply-nested Stoa reads via stoa-core's own global.
 * Defaults to the real, public `KADENA_MAINNET_DEFAULT_NODE_URL` — a
 * SURFACED default (shown + editable in the Network tab), not a hidden one.
 */
let activeKadenaNodeUrl: string = KADENA_MAINNET_DEFAULT_NODE_URL;

/** Read the currently active Kadena node URL. */
export function getActiveKadenaNodeUrl(): string {
  return activeKadenaNodeUrl;
}

/** Set the active Kadena node URL (the Network tab's Kadena row calls this
 *  on mount/change). A blank/whitespace-only value is ignored — falls back
 *  to the last good value rather than silently going dead. */
export function setActiveKadenaNodeUrl(url: string): void {
  const trimmed = url.trim();
  if (trimmed) activeKadenaNodeUrl = trimmed;
}

/** Build the chainweb Pact base path for a Kadena node origin + chain.
 *  Exported (2026-09-28) so `SendKadenaModal.tsx`'s own sign/submit pipeline
 *  can build the SAME URL a read already does — one canonical template, not
 *  a second hand-duplicated copy, matching this whole project's "reuse, don't
 *  re-derive" rule. */
export function kadenaPactUrl(nodeUrl: string, chainId: string): string {
  const origin = nodeUrl.replace(/\/+$/, "");
  return `${origin}/chainweb/0.0/${KADENA_MAINNET_NETWORK_ID}/chain/${chainId}/pact`;
}

export interface KadenaReadOptions {
  /** The Kadena node URL. Defaults to the real public mainnet node. */
  nodeUrl?: string;
  /** The chain to read against. Defaults to "0". */
  chainId?: string;
}

/**
 * Bound every read to this long, no more. `createClient(...).dirtyRead()` has no timeout of
 * its own (confirmed by reading `@stoachain/kadena-stoic-legacy`'s own source: no `timeout`/
 * `AbortController`/`signal` anywhere in its client) — a connection that hangs rather than
 * rejects (a firewalled or silently-dropped host:port, which is a REAL, observed failure mode
 * against a self-hosted node) would otherwise wait on the browser's own OS-level connection
 * timeout, which can run to minutes. Every caller below already treats a rejection as "no
 * data, render 0/dash" via its own try/catch — this makes a hang produce that SAME rejection
 * instead of spinning the loading state forever, which is exactly the "spins and spins and
 * nothing is shown" symptom this constant exists to prevent.
 */
export const KADENA_READ_TIMEOUT_MS = 10_000;

/**
 * Races `promise` against `KADENA_READ_TIMEOUT_MS` — exported so ANY Kadena
 * network call can get the same protection `kadenaDirtyRead` (below) gives
 * every read, not just this file's own read-only functions.
 * `createClient(...)`'s `dirtyRead`/`submitOne`/`getStatus` all share the
 * identical "no built-in timeout" gap (see `KADENA_READ_TIMEOUT_MS`'s own
 * doc comment) — `SendKadenaModal.tsx`'s own simulate/submit/poll calls
 * (real signed-and-submitted transactions, not just reads) reuse this exact
 * helper rather than re-deriving the same race, matching this project's
 * "one canonical implementation" rule (the same rule `kadenaPactUrl`'s own
 * export exists for). Without this, a hang on the same documented-flaky
 * node (`KADENA_MAINNET_DEFAULT_NODE_URL`) during a real submit would leave
 * a caller's `await` — and any `submitting`-style UI state gating it —
 * stuck forever instead of producing a catchable rejection.
 */
export function withKadenaTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error(`${label} timed out after ${KADENA_READ_TIMEOUT_MS}ms`)),
        KADENA_READ_TIMEOUT_MS,
      );
    }),
  ]);
}

/**
 * The shared dirty-read primitive every function below calls: hand-builds
 * an unsigned transaction with an EXPLICIT `mainnet01` networkId (never
 * `"stoa"`), then posts it via `createClient(url).dirtyRead(...)` — the
 * exact primitive stoa-core's own failover client is built on, just pointed
 * at Kadena instead of Stoa. `preflight`/`signatureVerification` are both
 * `false` (a dirty read — no gas estimation, no signature check), matching
 * every other read-only call in this package.
 *
 * Raced against `KADENA_READ_TIMEOUT_MS` (via `withKadenaTimeout`) — see
 * that constant's own doc comment for why an unbounded read is a real bug,
 * not a hypothetical one.
 */
async function kadenaDirtyRead(pactCode: string, options?: KadenaReadOptions): Promise<any> {
  const nodeUrl = options?.nodeUrl ?? getActiveKadenaNodeUrl();
  const chainId = options?.chainId ?? KADENA_MAINNET_DEFAULT_CHAIN_ID;

  const transaction = Pact.builder
    .execution(pactCode)
    .setMeta({ chainId, gasLimit: 150000 } as any)
    .setNetworkId(KADENA_MAINNET_NETWORK_ID)
    .createTransaction();

  const { dirtyRead } = createClient(kadenaPactUrl(nodeUrl, chainId));

  return withKadenaTimeout(dirtyRead(transaction as any), `Kadena read (chain ${chainId}, ${nodeUrl})`);
}

/**
 * Every read below catches its own exception and returns `null`/`[]` so a caller can
 * render "0/dash" instead of crashing — deliberate, and correct per the handoff this
 * module follows ("a missing account is not an error"). But catching and DISCARDING the
 * exception made a DNS failure, a connection timeout, and a genuinely-absent account all
 * produce the exact same `null` — which is why an unreachable node presented as
 * "can't talk to the node" instead of "can't resolve that host" (2026-09-27 diagnosis).
 * This keeps the same null/[] contract for callers but puts the REASON on the console,
 * once per distinct message (not once per address — a 20-chain batch hitting the same
 * dead host would otherwise spam 20+ identical lines).
 */
const _warnedKadenaErrors = new Set<string>();
export function logKadenaReadError(fn: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const key = `${fn}:${message}`;
  if (_warnedKadenaErrors.has(key)) return;
  _warnedKadenaErrors.add(key);
  console.warn(`[kadenaReads.${fn}] read failed, rendering as empty/absent: ${message}`);
}

/** Pact decimals arrive as number | string | { decimal }. Coerce to number. */
export function coerce(b: unknown): number {
  if (b == null) return 0;
  if (typeof b === "number") return b;
  if (typeof b === "string") return parseFloat(b) || 0;
  if (typeof b === "object" && b !== null && "decimal" in (b as Record<string, unknown>)) {
    return parseFloat(String((b as { decimal: unknown }).decimal)) || 0;
  }
  return 0;
}

/**
 * `(coin.get-balance "account")` — the real KDA balance on one chain, raw
 * Pact constructor. Returns `null` on any failure/refusal (a non-existent
 * account is a Pact-level error, not a thrown one here — matches
 * `checkKadenaAccountExists`'s own `(try ...)` pattern below for the
 * exists-aware variant).
 */
export async function getKadenaBalance(
  account: string,
  options?: KadenaReadOptions,
): Promise<number | null> {
  try {
    // `(try 0.0 ...)` mirrors this codebase's own established convention for
    // this exact question — `@ouronet/ouronet-core`'s `getPaymentKeyBalance`
    // uses the identical `(try 0.0 (coin.get-balance ...))` shape, treating
    // "no such account row" the same as "zero balance" for a plain balance
    // read. A caller that needs to distinguish "real zero" from "never
    // funded" should call `checkKadenaAccountExists` instead.
    const code = `(try 0.0 (coin.get-balance "${account}"))`;
    const res = await kadenaDirtyRead(code, options);
    if (res?.result?.status !== "success") {
      // A non-success ENVELOPE here (as opposed to the thrown-exception
      // catch below) used to return null silently — indistinguishable from
      // a dead host or a timeout, which is documented (2026-09-28 handoff)
      // as the actual reason a real node-reachability problem presented as
      // "can't talk to the node" for so long. Logged the same way the catch
      // branch already does, so the REASON is never swallowed either way.
      logKadenaReadError("getKadenaBalance", new Error(res?.result?.error?.message ?? "non-success response envelope"));
      return null;
    }
    return coerce(res.result.data);
  } catch (error) {
    logKadenaReadError("getKadenaBalance", error);
    return null;
  }
}

/**
 * `(coin.details "account")` — the full account row (balance + guard), raw
 * Pact constructor. `null` when the account does not exist on this chain or
 * the read otherwise fails.
 */
export async function getKadenaAccountDetails(
  account: string,
  options?: KadenaReadOptions,
): Promise<{ account: string; balance: number; guard: unknown } | null> {
  try {
    const code = `(coin.details "${account}")`;
    const res = await kadenaDirtyRead(code, options);
    if (res?.result?.status !== "success") {
      // See getKadenaBalance's own comment on this exact shape — a
      // non-success envelope used to return null silently, indistinguishable
      // from a dead host/timeout.
      logKadenaReadError("getKadenaAccountDetails", new Error(res?.result?.error?.message ?? "non-success response envelope"));
      return null;
    }
    const data = res.result.data as { account?: string; balance?: unknown; guard?: unknown } | null;
    if (!data) return null;
    return {
      account: String(data.account ?? account),
      balance: coerce(data.balance),
      guard: data.guard ?? null,
    };
  } catch (error) {
    logKadenaReadError("getKadenaAccountDetails", error);
    return null;
  }
}

/**
 * Batched multi-account `coin.get-balance` read for ONE chain — one Pact
 * call for every address on that chain, mirrors `useStoaChainBalances.ts`'s
 * own inline `map`/`try` batch shape exactly (same compound-object pattern,
 * same `{account, balance, exists}` row shape), just against a Kadena node
 * with `mainnet01` instead of Stoa's default node + `"stoa"`. The multi-chain
 * balance grid (`useKadenaBalances.ts`) calls this once per `KADENA_CHAINS`
 * entry, exactly as its Stoa counterpart does per `STOA_CHAINS` entry.
 */
export async function getKadenaBalancesBatch(
  addresses: string[],
  options?: KadenaReadOptions,
): Promise<Array<{ account: string; balance: number; exists: boolean }>> {
  if (addresses.length === 0) return [];
  try {
    const list = addresses.map((a) => `"${a}"`).join(" ");
    const code =
      `(map (lambda (a) (try { "account": a, "balance": 0.0, "exists": false } ` +
      `{ "account": a, "balance": (coin.get-balance a), "exists": true })) [${list}])`;
    const res = await kadenaDirtyRead(code, options);
    if (res?.result?.status !== "success") {
      // See getKadenaBalance's own comment on this exact shape.
      logKadenaReadError("getKadenaBalancesBatch", new Error(res?.result?.error?.message ?? "non-success response envelope"));
      return [];
    }
    const data = res.result.data;
    if (!Array.isArray(data)) return [];
    return (data as Array<{ account?: string; balance?: unknown; exists?: boolean }>).map((row) => ({
      account: String(row.account ?? ""),
      balance: coerce(row.balance),
      exists: row.exists === true,
    }));
  } catch (error) {
    logKadenaReadError("getKadenaBalancesBatch", error);
    return [];
  }
}

/**
 * `(try false (coin.get-balance "account"))` — existence probe, raw Pact
 * constructor. Mirrors `@ouronet/ouronet-core`'s own `checkCoinAccountExists`
 * pattern (same `(try false ...)` shape) — kept as a SEPARATE function from
 * `getKadenaBalance` rather than overloading its sentinel, since "does this
 * row exist" and "what is the balance" are different questions a caller may
 * need independently (e.g. showing "0 KDA" for a real, empty account vs.
 * "account not found" for one that was never funded).
 */
export async function checkKadenaAccountExists(
  account: string,
  options?: KadenaReadOptions,
): Promise<boolean | null> {
  try {
    const code = `(try false (coin.get-balance "${account}"))`;
    const res = await kadenaDirtyRead(code, options);
    if (res?.result?.status !== "success") {
      // See getKadenaBalance's own comment on this exact shape.
      logKadenaReadError("checkKadenaAccountExists", new Error(res?.result?.error?.message ?? "non-success response envelope"));
      return null;
    }
    return res.result.data !== false;
  } catch (error) {
    logKadenaReadError("checkKadenaAccountExists", error);
    return null;
  }
}
