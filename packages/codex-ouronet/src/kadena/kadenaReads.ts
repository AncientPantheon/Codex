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

/** The real, public Kadena mainnet node — the same default
 *  `@stoachain/kadena-stoic-legacy`'s own built-in host generator resolves
 *  `"mainnet01"` to (`dist/client/client/utils/utils.cjs`). Surfaced (not a
 *  hidden default) — fully user-editable via the Network tab's new Kadena
 *  row, mirroring `STOACHAIN_DEFAULT_NODE_URL`'s own convention. */
export const KADENA_MAINNET_DEFAULT_NODE_URL = "https://api.chainweb.com";

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

/** Build the chainweb Pact base path for a Kadena node origin + chain. */
function kadenaPactUrl(nodeUrl: string, chainId: string): string {
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
 * The shared dirty-read primitive every function below calls: hand-builds
 * an unsigned transaction with an EXPLICIT `mainnet01` networkId (never
 * `"stoa"`), then posts it via `createClient(url).dirtyRead(...)` — the
 * exact primitive stoa-core's own failover client is built on, just pointed
 * at Kadena instead of Stoa. `preflight`/`signatureVerification` are both
 * `false` (a dirty read — no gas estimation, no signature check), matching
 * every other read-only call in this package.
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
  return dirtyRead(transaction as any);
}

/** Pact decimals arrive as number | string | { decimal }. Coerce to number. */
function coerce(b: unknown): number {
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
    if (res?.result?.status !== "success") return null;
    return coerce(res.result.data);
  } catch {
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
    if (res?.result?.status !== "success") return null;
    const data = res.result.data as { account?: string; balance?: unknown; guard?: unknown } | null;
    if (!data) return null;
    return {
      account: String(data.account ?? account),
      balance: coerce(data.balance),
      guard: data.guard ?? null,
    };
  } catch {
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
    if (res?.result?.status !== "success") return [];
    const data = res.result.data;
    if (!Array.isArray(data)) return [];
    return (data as Array<{ account?: string; balance?: unknown; exists?: boolean }>).map((row) => ({
      account: String(row.account ?? ""),
      balance: coerce(row.balance),
      exists: row.exists === true,
    }));
  } catch {
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
    if (res?.result?.status !== "success") return null;
    return res.result.data !== false;
  } catch {
    return null;
  }
}
