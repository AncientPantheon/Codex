/**
 * kadenaBalanceSource — the pluggable seam behind `useKadenaBalances`: ONE interface,
 * TWO implementations, never hardwired into the UI or the hook.
 *
 * WHY THIS FILE EXISTS (2026-09-27 diagnosis, in order):
 *
 *   1. `api.chainweb.com` — the widely-documented "official" Kadena mainnet endpoint —
 *      does not exist. Not unreachable, not filtered: `dig @ns-1159.awsdns-16.org
 *      api.chainweb.com A` returns NXDOMAIN with an AUTHORITATIVE answer. The
 *      `chainweb.com` domain is real (AWS SOA); that specific subdomain simply has no
 *      record. Dropped entirely — no fallback references it.
 *
 *   2. There is no free public Kadena Pact service API to fall back to. Checked against
 *      our own node's live peer list, not guessed: every `*.chainweb-community.org`
 *      mainnet peer answers `/chainweb/0.0/mainnet01/cut` (200 — that's P2P) but 404s on
 *      `/pact/api/v1/local`. `api.chainweb.io` resolves but its TLS cert doesn't cover
 *      that name. `rpc.kadena.io` / `mainnet.kadena.io` / `node.kadena.io` /
 *      `api.kadena.io` have no DNS at all. Public Kadena nodes expose P2P; the Pact
 *      service API is deliberately not open. That is not an oversight to keep searching
 *      past.
 *
 *   3. `https://denascan.ancientholdings.eu` — our own Kadena explorer backend — IS a
 *      real, working, public REST gateway: HTTPS (no mixed-content problem), stable DNS
 *      (no dynamic-IP problem), CORS wide open (`access-control-allow-origin: *`,
 *      confirmed via a live OPTIONS preflight), and verified against the direct node at
 *      the same instant (identical balance to the last digit). This is `restKadenaBalanceSource`
 *      — the DEFAULT.
 *
 *   4. `bytales.duckdns.org:31849` (the direct Pact node this package's `kadenaReads.ts`
 *      talks to) is real and correct — confirmed live, `status: success`, `gas: 16` — but
 *      hairpin-NATs from a machine on the SAME LAN as the node (the router will not loop
 *      traffic addressed to its own public IP back to itself), while working fine from
 *      anywhere else. Kept as `pactKadenaBalanceSource` — a SELECTABLE option, not the
 *      default, and the seam this whole module exists to make swappable without touching
 *      the UI: if the owner later stands up a true Pact proxy (`https://kadena.<domain>`
 *      → the node's `:31849`), or the REST gateway's data source changes, only this file
 *      (or a `setActiveKadenaBalanceSource` call) needs to change.
 *
 * The REST gateway does not (and, being read-only, never will) serve signing/broadcast —
 * `createKadenaConnection.ts` already notes that is separate, future work the Pact path
 * alone can eventually carry. That is the other reason this stays two implementations
 * behind one seam rather than a full REST replacement: only the Pact path can grow into
 * transfers later.
 */

import {
  KADENA_CHAINS,
  KADENA_READ_TIMEOUT_MS,
  getActiveKadenaNodeUrl,
  getKadenaBalancesBatch,
  checkKadenaAccountExists,
  coerce,
  logKadenaReadError,
} from "./kadenaReads.js";

/** One chain's balance for one address, in the shape `useKadenaBalances` already renders. */
export interface KadenaChainBalanceEntry {
  balance: number;
  exists: boolean;
}

/** address -> chainId -> balance. A chainId absent from an address's map means "no data
 *  for that chain" — the caller (today, `useKadenaBalances`) treats that identically to
 *  an explicit `{exists:false, balance:0}` for every chain it cares about. */
export type KadenaPerAddressBalances = Record<string, Record<string, KadenaChainBalanceEntry>>;

export interface KadenaBalanceSource {
  /** For diagnostics/UI — which implementation is actually answering right now. */
  readonly name: "rest" | "pact";
  /** Fetch balances (all chains) for every given address. Never throws — a failed or
   *  absent address comes back with an empty (or partial) per-chain map, exactly like
   *  every other read in this package's Kadena surface. */
  fetchBalances(addresses: string[]): Promise<KadenaPerAddressBalances>;
  /**
   * Does this account exist ON THIS SPECIFIC CHAIN — a genuine 3-way answer,
   * UNLIKE `fetchBalances`: `true`/`false` is a confident answer (a clean
   * "yes, real data" or "no, cleanly confirmed absent" — a 404 from the REST
   * gateway, or a successful Pact read returning `false`), `null` means the
   * check itself failed (network/timeout/parse/non-404 HTTP error) and the
   * caller must NOT treat that as "does not exist" — this is the live bug
   * this method exists to fix: a caller gating whether to submit a real
   * transaction (e.g. `SendKadenaModal.tsx`'s own receiver check) that
   * conflated "the read timed out" with "this account doesn't exist" would
   * either wrongly refuse a valid receiver or wrongly attempt a
   * `transfer-create` against an account that already exists.
   * `fetchBalances`'s own "empty map either way" contract is fine for a
   * passive balance DISPLAY (show 0/dash on failure) but not here.
   */
  checkAccountExists(account: string, chainId: string): Promise<boolean | null>;
}

// ── REST gateway (default) ──────────────────────────────────────────────────

/** Our own Kadena explorer backend — see this file's own doc comment for why this,
 *  not `api.chainweb.com` (does not exist) or a free public Pact API (does not exist). */
export const KADENA_REST_GATEWAY_DEFAULT_URL = "https://denascan.ancientholdings.eu";

/** The ACTIVE REST gateway base URL — a module-level global, mirroring
 *  `kadenaReads.ts`'s own `activeKadenaNodeUrl` pattern exactly (same reasoning: one
 *  lever, surfaced in the Network tab, reached by every deeply-nested Kadena read
 *  without prop drilling). */
let activeKadenaRestGatewayUrl: string = KADENA_REST_GATEWAY_DEFAULT_URL;

/** Read the currently active REST gateway base URL. */
export function getActiveKadenaRestGatewayUrl(): string {
  return activeKadenaRestGatewayUrl;
}

/** Set the active REST gateway base URL. A blank/whitespace-only value is ignored —
 *  falls back to the last good value rather than silently going dead. */
export function setActiveKadenaRestGatewayUrl(url: string): void {
  const trimmed = url.trim();
  if (trimmed) activeKadenaRestGatewayUrl = trimmed;
}

/** The verified-live response row shape from `/api/v1/accounts/<address>/balances` —
 *  `chainId` arrives as a JSON NUMBER, not the string this package uses everywhere
 *  else for chain ids, so every row gets coerced with `String(row.chainId)`. */
interface KadenaRestBalanceRow {
  chainId: number | string;
  balance: unknown;
  guard?: unknown;
}

async function fetchOneAddressRest(
  address: string,
  baseUrl: string,
): Promise<Record<string, KadenaChainBalanceEntry>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), KADENA_READ_TIMEOUT_MS);
  try {
    const url = `${baseUrl.replace(/\/+$/, "")}/api/v1/accounts/${encodeURIComponent(address)}/balances`;
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      // A 404 for a never-funded account is the gateway's normal "no data" answer, not
      // a real failure — matches `kadenaReads.ts`'s own "a missing account is not an
      // error" convention. Anything else (502, 500, ...) is a real problem, logged.
      if (res.status !== 404) {
        logKadenaReadError("restKadenaBalanceSource", new Error(`HTTP ${res.status} for ${address}`));
      }
      return {};
    }
    const rows = (await res.json()) as KadenaRestBalanceRow[];
    const perChain: Record<string, KadenaChainBalanceEntry> = {};
    for (const row of rows) {
      perChain[String(row.chainId)] = { balance: coerce(row.balance), exists: true };
    }
    return perChain;
  } catch (error) {
    logKadenaReadError("restKadenaBalanceSource", error);
    return {};
  } finally {
    clearTimeout(timer);
  }
}

/**
 * `checkAccountExists`'s REST implementation. Reuses the SAME
 * `/api/v1/accounts/<address>/balances` endpoint `fetchOneAddressRest`
 * already calls, but — unlike that function, which collapses "cleanly no
 * data" and "the fetch itself failed" into the same `{}` (fine for a
 * passive balance display) — this preserves the distinction: a clean 404
 * means "genuinely no rows for this address, on any chain" (`false`, a
 * chain-id absent from a real response also means "no row on THIS chain",
 * same `false`); any other outcome (non-404 HTTP error, network failure,
 * JSON parse failure, timeout) returns `null`, the honest "could not check"
 * answer this interface method exists to make possible.
 */
async function checkAccountExistsRest(
  account: string,
  chainId: string,
  baseUrl: string,
): Promise<boolean | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), KADENA_READ_TIMEOUT_MS);
  try {
    const url = `${baseUrl.replace(/\/+$/, "")}/api/v1/accounts/${encodeURIComponent(account)}/balances`;
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      if (res.status === 404) return false; // confidently absent, everywhere
      logKadenaReadError("restKadenaBalanceSource.checkAccountExists", new Error(`HTTP ${res.status} for ${account}`));
      return null;
    }
    const rows = (await res.json()) as KadenaRestBalanceRow[];
    return rows.some((row) => String(row.chainId) === chainId);
  } catch (error) {
    logKadenaReadError("restKadenaBalanceSource.checkAccountExists", error);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export const restKadenaBalanceSource: KadenaBalanceSource = {
  name: "rest",
  async fetchBalances(addresses) {
    if (addresses.length === 0) return {};
    const baseUrl = getActiveKadenaRestGatewayUrl();
    const entries = await Promise.all(
      addresses.map(async (addr) => [addr, await fetchOneAddressRest(addr, baseUrl)] as const),
    );
    return Object.fromEntries(entries);
  },
  checkAccountExists(account, chainId) {
    return checkAccountExistsRest(account, chainId, getActiveKadenaRestGatewayUrl());
  },
};

// ── Direct Pact node (selectable, not default — see this file's own doc comment) ──

export const pactKadenaBalanceSource: KadenaBalanceSource = {
  name: "pact",
  async fetchBalances(addresses) {
    if (addresses.length === 0) return {};
    const nodeUrl = getActiveKadenaNodeUrl();
    // Mirrors what `useKadenaBalances.ts` used to do inline: one read per chain, each
    // batching every address in a single Pact `map` call — then transposed below into
    // this seam's per-address shape.
    const perChainResults = await Promise.all(
      KADENA_CHAINS.map(async (chainId) => ({
        chainId,
        rows: await getKadenaBalancesBatch(addresses, { nodeUrl, chainId }),
      })),
    );
    const result: KadenaPerAddressBalances = {};
    for (const addr of addresses) {
      const perChain: Record<string, KadenaChainBalanceEntry> = {};
      for (const { chainId, rows } of perChainResults) {
        const row = rows.find((r) => r.account === addr);
        const exists = row?.exists === true;
        perChain[chainId] = { balance: exists ? (row?.balance ?? 0) : 0, exists };
      }
      result[addr] = perChain;
    }
    return result;
  },
  checkAccountExists(account, chainId) {
    // Delegates straight to `kadenaReads.ts`'s own, already fully-tested
    // `checkKadenaAccountExists` — same node URL lever (`getActiveKadenaNodeUrl`),
    // same true/false/null contract, unchanged behavior for anyone who
    // explicitly selects the Pact source.
    return checkKadenaAccountExists(account, { chainId, nodeUrl: getActiveKadenaNodeUrl() });
  },
};

// ── Active source selector ──────────────────────────────────────────────────

/** The ACTIVE balance source — a module-level global, same pattern as the node-URL and
 *  gateway-URL globals above. DEFAULTS TO REST: it is the one that actually works from
 *  a browser, from any machine, today (see this file's own doc comment, point 3). */
let activeKadenaBalanceSource: KadenaBalanceSource = restKadenaBalanceSource;

/** Read the currently active balance source. */
export function getActiveKadenaBalanceSource(): KadenaBalanceSource {
  return activeKadenaBalanceSource;
}

/** Set the active balance source (e.g. a future Network-tab row offering "REST Gateway"
 *  vs. "Direct Node (Pact)"). Not wired to any UI yet — the seam exists so that wiring,
 *  whenever it happens, is a call to this function, not a rewrite of the hook. */
export function setActiveKadenaBalanceSource(source: KadenaBalanceSource): void {
  activeKadenaBalanceSource = source;
}

/**
 * Live bug fix: `SendKadenaModal.tsx`'s receiver-existence gate used to call
 * `kadenaReads.ts`'s `checkKadenaAccountExists` directly, which ALWAYS hits
 * the direct Pact node (`bytales.duckdns.org:31849`) regardless of the
 * active balance source — the exact node this file's own doc comment
 * documents as hairpin-NATting from its own LAN and (being plain HTTP, not
 * HTTPS) a mixed-content-block risk from a browser. A live-reported failure
 * ("Could not verify the receiver account") on a same-chain send matched
 * this exactly: chain forwarding was correct, the node itself was simply
 * unreachable from the browser. Routing through the ACTIVE source (REST by
 * default — the one already proven to work from a browser, per this file's
 * own doc comment) fixes it the same way `useKadenaBalances` was already
 * fixed; `setActiveKadenaBalanceSource(pactKadenaBalanceSource)` still
 * makes this follow that explicit choice, exactly like `fetchBalances`
 * already does.
 */
export function checkKadenaAccountExistsActive(account: string, chainId: string): Promise<boolean | null> {
  return activeKadenaBalanceSource.checkAccountExists(account, chainId);
}
