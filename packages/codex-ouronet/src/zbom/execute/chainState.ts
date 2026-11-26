/**
 * chainState — design §4's predicates, read from chain, headlessly.
 *
 * Design §4 settled the resume question: every migration step is a PREDICATE
 * OVER CHAIN STATE, not a position in a script. That makes the chain
 * idempotent (re-pressing skips what landed, instead of re-sending it) and it
 * makes `MigrationExecutionStep.txHash` a HINT rather than authority. This
 * module is the single read that feeds those predicates — it produces
 * codex-core's `ChainStateSnapshot`, which `planMigrationChain` then turns
 * into the step list.
 *
 * Nothing here mounts anything: no hook, no React, no modal. The three reads
 * it issues are the SAME reads the shipped UI already makes, reused verbatim
 * rather than re-derived — a second, subtly different copy of a balance read
 * is exactly the "two independently-editable copies that can silently
 * disagree" trap this package's conventions warn about:
 *
 *   1. per-chain native STOA — `ui/internal/useStoaChainBalances.ts:102-107`'s
 *      `map`/`try` over `coin.get-balance`, one `pactRead` per entry of
 *      `STOA_CHAINS` with `{ chainId, pactUrl: getPactUrl(chainId), tier }`.
 *   2. urSTOA liquid + staked — `ui/internal/useUrStoaBalances.ts:88-91`'s
 *      single batched read on chain `"0"` ONLY. That is not an oversight:
 *      urSTOA is only deployed on chain 0 (`useUrStoaBalances.ts:4-7`). Both
 *      addresses ride in the one call.
 *   3. the registered payment key and guard — `getAccountSelectorDataLive`
 *      (`../ouroSelectorReads.ts:85-94`), which is already headless. Called,
 *      not re-written: this package has exactly one selector read.
 *
 * ROUND 2 (`docs/work/migration-execute-keyset/`) added two snapshot fields and
 * NOT A SINGLE READ, which is the point:
 *
 *   • `oldKeyUrStoaEarnings` comes out of the `earnings` field read 2 has
 *     requested since round 1 (and threw away). `debouncer-monitor.test.ts:17`
 *     pins `CODEX_READ_REGISTRY.length`, so a new read would have cost a
 *     registry entry for a number already on the wire.
 *   • `registeredKeysetRef` comes out of `keysetRefNameOf` over the SAME raw
 *     `ouronet-account-guard` value `guardOf` reads. Design §2's "the target is
 *     derivable from the account's live guard", for free.
 *
 * `rowsOf` and `coerce` are ported from `useStoaChainBalances.ts:52-69` for
 * the same reason the hooks have them — the Pact decimal arrives as
 * `number | string | { decimal }` and the response envelope shape varies by
 * reader. A snapshot built without those coercions reads a real balance as
 * `0`, and `0` in this topic means "nothing to move": the drain is skipped
 * and the funds stay on the key the account is about to stop naming.
 *
 * A READ FAILURE IS AN ERROR, never a snapshot of zeroes. Every rejection
 * propagates and the account row is REQUIRED — an unknown registered key is
 * not `null`, because `null` would fire predicates F and G off a read that
 * never happened.
 *
 * MAINNET HAZARD (docs/work/migration-execute/plan.md): `pactRead`'s default
 * reader is `rawCalibratedDirtyRead`, a real call to a real node. Both the
 * reader and the selector read are therefore injected on `deps`, defaulting
 * to the live wiring — a test passes synthetics, or registers `setPactReader`
 * (stoa-core's own documented seam), and reaches no network either way. This
 * module signs nothing and submits nothing: there is no write path here.
 */

import { pactRead, type PactReader } from "@stoachain/stoa-core/reads";
import { STOA_CHAINS, getPactUrl } from "@stoachain/stoa-core/constants";
import type { ChainStateSnapshot } from "@ancientpantheon/codex-core";
import { getAccountSelectorDataLive } from "../ouroSelectorReads.js";
import { keysetRefNameOf } from "../../guards/resolveGuardKeys.js";
import { codexClock } from "../debouncer/codexClock.js";

/** urSTOA lives on chain 0 and nowhere else (`useUrStoaBalances.ts:4-7`). */
const URSTOA_CHAIN_ID = "0";

/**
 * `"|"` — the BAR sentinel the post-DPL-UR selector returns for "no payment
 * key on record", in place of the old `""` (see `../ouroSelectorReads.ts`'s
 * header). Both forms mean the same thing and both become `null` here.
 */
const NO_PAYMENT_KEY_SENTINELS: readonly string[] = ["|", ""];

/** Who the snapshot is about. */
export interface ChainStateQuery {
  /** The payment-key ADDRESS funds are being moved OFF (steps A-D sign here). */
  readonly oldPaymentAddress: string;
  /** The payment-key ADDRESS funds are being moved ON TO (step E stakes here). */
  readonly newPaymentAddress: string;
  /** The Ouronet account whose registered payment key + guard F and G change. */
  readonly accountAddress: string;
}

/**
 * The fields this module reads off an `AccountSelectorData` row. Declared
 * structurally (not as the `@ouronet/ouronet-core` type) so a test can build
 * one as a literal; the real `AccountSelectorData` is assignable to it.
 */
export interface AccountSelectorRowSlice {
  readonly "ouronet-account"?: string;
  readonly "payment-key"?: string;
  readonly "ouronet-account-guard"?: unknown;
}

/** The injected chain edge. The production values are {@link liveChainStateDeps}. */
export interface ChainStateReadDeps {
  /** Batched Pact read. Live: `pactRead` from `@stoachain/stoa-core/reads`. */
  readonly pactRead: PactReader;
  /** Live: `getAccountSelectorDataLive` — `O-UI-SEVEN.URC_01|Accounts`. */
  readonly readAccountSelector: (accounts: string[]) => Promise<readonly AccountSelectorRowSlice[]>;
}

/** Pact decimals arrive as number | string | { decimal }. Coerce to number.
 *  (Ported verbatim from `useStoaChainBalances.ts:52-60`.) */
function coerce(b: unknown): number {
  if (b == null) return 0;
  if (typeof b === "number") return b;
  if (typeof b === "string") return parseFloat(b) || 0;
  if (typeof b === "object" && b !== null && "decimal" in (b as Record<string, unknown>)) {
    return parseFloat(String((b as { decimal: unknown }).decimal)) || 0;
  }
  return 0;
}

/** One row of either batched balance read. `earnings` is only ever present on
 *  the urSTOA read's rows; the per-chain `coin.get-balance` read does not ask
 *  for it, and an absent field reads as 0 like any other. */
interface UrStoaRow {
  account?: string;
  balance?: unknown;
  staked?: unknown;
  earnings?: unknown;
  exists?: boolean;
}

/** Unwrap a dirty-read response to its data array (shape varies by reader).
 *  (Ported verbatim from `useStoaChainBalances.ts:62-69`.) */
function rowsOf(res: unknown): UrStoaRow[] {
  const r = res as { result?: { data?: unknown }; data?: unknown } | unknown[];
  const data = (r as { result?: { data?: unknown } })?.result?.data
    ?? (r as { data?: unknown })?.data
    ?? r;
  return Array.isArray(data) ? (data as UrStoaRow[]) : [];
}

/** A row's numeric field, or 0 — never NaN, and never a figure from a row the
 *  chain said does not exist. `NaN > 0` is `false`, so a NaN would silently
 *  skip a step; a NaN reaching a transfer builder is a malformed amount. */
function fieldOf(
  rows: UrStoaRow[],
  address: string,
  field: "balance" | "staked" | "earnings",
): number {
  const row = rows.find((x) => x.account === address);
  if (!row || row.exists !== true) return 0;
  return coerce(row[field]);
}

/** The guard as the predicate-G comparison needs it, or `null` when the chain
 *  has none to report (`false` for an unactivated account). Set-equality and
 *  `pred` comparison belong to codex-core's planner, not to this read. */
function guardOf(raw: unknown): ChainStateSnapshot["registeredGuard"] {
  if (!raw || typeof raw !== "object") return null;
  const g = raw as { keys?: unknown; pred?: unknown };
  if (!Array.isArray(g.keys) || typeof g.pred !== "string") return null;
  return { keys: g.keys.map((k) => String(k)), pred: g.pred };
}

/**
 * The PRODUCTION wiring — the only place the real reader and the real
 * selector read are named. T11 assembles the engine's deps at the React
 * boundary; this is what it hands over.
 */
export const liveChainStateDeps: ChainStateReadDeps = {
  pactRead,
  readAccountSelector: getAccountSelectorDataLive,
};

/**
 * Read everything design §4's predicates need, in three parallel reads.
 *
 * Each read is wrapped in `codexClock.report` with an EXISTING registry id
 * (`"coin.get-balance"`, the unregistered-but-already-used
 * `"urStoa.balances"` string from `useUrStoaBalances.ts:92`, and
 * `"URC_0027"`) so Settings → Read Functions sees the engine's reads exactly
 * as it sees the hooks'. No registry entry is added:
 * `tests/debouncer-monitor.test.ts:17` pins `CODEX_READ_REGISTRY.length`, and
 * the monitor is a display of reads, not a list of permissions.
 *
 * @throws when any read fails, or when the account selector has no row for
 *   `accountAddress` — an unknown registered key/guard must never be
 *   flattened into `null`.
 */
export async function readChainState(
  query: ChainStateQuery,
  deps: ChainStateReadDeps = liveChainStateDeps,
): Promise<ChainStateSnapshot> {
  const { oldPaymentAddress, newPaymentAddress, accountAddress } = query;

  // Read 1 — native STOA, one batched `coin.get-balance` per chain. Only the
  // OLD key's balances are predicates (A(n) and B drain the old key); the new
  // key's native balance decides nothing, so it is not read.
  const perChainRead = Promise.all(
    STOA_CHAINS.map(async (chainId: string) => {
      const list = [oldPaymentAddress].map((a) => `"${a}"`).join(" ");
      const code =
        `(map (lambda (a) (try { "account": a, "balance": 0.0, "exists": false } ` +
        `{ "account": a, "balance": (coin.get-balance a), "exists": true })) [${list}])`;
      const res = await codexClock.report("coin.get-balance", { chainId }, () =>
        deps.pactRead(code, { chainId, pactUrl: getPactUrl(chainId), tier: "T5" }),
      );
      return { chainId, rows: rowsOf(res) };
    }),
  );

  // Read 2 — urSTOA, ONE call on chain 0, both addresses batched. Code reused
  // verbatim from `useUrStoaBalances.ts:88-91`, `earnings` included: it costs
  // nothing extra and keeps this read byte-comparable with the hook's.
  const urStoaList = [oldPaymentAddress, newPaymentAddress].map((a) => `"${a}"`).join(" ");
  const urStoaCode =
    `(map (lambda (a) (try { "account": a, "balance": 0.0, "staked": 0.0, "earnings": 0.0, "exists": false } ` +
    `{ "account": a, "balance": (coin.UR_UR|Balance a), "staked": (coin.UR_URV|UserSupply a), ` +
    `"earnings": (coin.URC_URV|ClaimableRewards a), "exists": true })) [${urStoaList}])`;
  const urStoaRead = codexClock.report("urStoa.balances", { chainId: URSTOA_CHAIN_ID }, () =>
    deps.pactRead(urStoaCode, {
      chainId: URSTOA_CHAIN_ID,
      pactUrl: getPactUrl(URSTOA_CHAIN_ID),
      tier: "T5",
    }),
  );

  // Read 3 — the account's registered payment key + guard (predicates F, G).
  const selectorRead = codexClock.report("URC_0027", undefined, () =>
    deps.readAccountSelector([accountAddress]),
  );

  const [perChainResults, urStoaRes, selectorRows] = await Promise.all([
    perChainRead,
    urStoaRead,
    selectorRead,
  ]);

  const oldKeyStoaPerChain: Record<string, number> = {};
  for (const { chainId, rows } of perChainResults) {
    oldKeyStoaPerChain[chainId] = fieldOf(rows, oldPaymentAddress, "balance");
  }

  const urRows = rowsOf(urStoaRes);
  const row = selectorRows.find((r) => r["ouronet-account"] === accountAddress);
  if (!row) {
    throw new Error(
      `readChainState: the account selector returned no row for ${accountAddress} — ` +
      `the registered payment key and guard are UNKNOWN, not absent. ` +
      `(getAccountSelectorDataLive answers [] on a failed read envelope too, so this ` +
      `is as likely a read failure as a missing account; either way the migration ` +
      `cannot decide whether a rotation is owed.)`,
    );
  }

  const paymentKey = row["payment-key"];
  const rawGuard = row["ouronet-account-guard"];
  return {
    oldKeyStoaPerChain,
    oldKeyUrStoaLiquid: fieldOf(urRows, oldPaymentAddress, "balance"),
    oldKeyUrStoaStaked: fieldOf(urRows, oldPaymentAddress, "staked"),
    newKeyUrStoaLiquid: fieldOf(urRows, newPaymentAddress, "balance"),
    // The OLD key's claimable rewards only: the new key's are a predicate of
    // nothing, and step C acts on the old key alone.
    oldKeyUrStoaEarnings: fieldOf(urRows, oldPaymentAddress, "earnings"),
    registeredPaymentKey:
      typeof paymentKey === "string" && !NO_PAYMENT_KEY_SENTINELS.includes(paymentKey)
        ? paymentKey
        : null,
    registeredGuard: guardOf(rawGuard),
    // The SAME raw value, read a second way. `keysetRefNameOf` accepts either
    // real-world spelling (the camelCase already-qualified string an EXPANDED
    // keyset-ref carries, and the nested lowercase `keysetref: { ns, ksn }` of
    // the raw Pact wire shape) and never throws on a malformed one — see its
    // doc comment at `resolveGuardKeys.ts:66-92` for the owner-reported defect
    // that forced the tolerance.
    registeredKeysetRef: keysetRefNameOf(rawGuard),
  };
}
