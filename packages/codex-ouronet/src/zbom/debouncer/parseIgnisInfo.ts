/**
 * Pure parsers for a ZBOM INFO read result.
 *
 * An `URC_*`/`INFO_*` dirty-read returns the raw `@kadena/client` response
 * (`{ result: { status, data, ... } }`). My Codex reads the cost straight out
 * of `infoData.ignis["ignis-need"]` (see CoilCFMModal / BrumateCFMModal in
 * OuronetUI: `Number(infoData?.ignis?.["ignis-need"] ?? 0)`). These helpers
 * reproduce that unwrap + coerce so the read hook (and Wave 4's INFO zone) can
 * stay declarative and individually testable.
 */

/** Coerce a Pact-shaped numeric (number | string | `{ decimal }`) to a JS
 *  number, or `null` when absent/unparseable. */
export function coercePactDecimal(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof value === "object" && "decimal" in (value as Record<string, unknown>)) {
    return coercePactDecimal((value as { decimal: unknown }).decimal);
  }
  return null;
}

/** Unwrap the `@kadena/client` dirty-read envelope to its payload object.
 *  Mirrors useT2Read's `data.result.data ?? data.result ?? data` unwrap. */
export function unwrapReadResult(raw: unknown): unknown {
  if (raw == null || typeof raw !== "object") return raw;
  const r = raw as { result?: { data?: unknown } };
  if (r.result && typeof r.result === "object" && "data" in r.result) {
    return r.result.data;
  }
  if ("result" in (raw as Record<string, unknown>)) return r.result;
  return raw;
}

export interface ParsedIgnisInfo {
  /** IGNIS gas the operation needs (0 ⇒ free). `null` when not present. */
  ignisNeed: number | null;
  /** Full (pre-discount) IGNIS cost, when the INFO function reports it. */
  ignisFull: number | null;
  /** Discount fraction/amount, when reported. */
  ignisDiscount: number | null;
  /** Human-readable cost note from the INFO function (`ignis-text`). */
  ignisText: string;
}

/** Parse the `ignis` block out of a (possibly wrapped) INFO read result. */
export function parseIgnisInfo(raw: unknown): ParsedIgnisInfo {
  const payload = unwrapReadResult(raw);
  const ignis =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>).ignis
      : undefined;
  const block = (ignis && typeof ignis === "object" ? ignis : {}) as Record<string, unknown>;
  const text = block["ignis-text"];
  return {
    ignisNeed: coercePactDecimal(block["ignis-need"]),
    ignisFull: coercePactDecimal(block["ignis-full"]),
    ignisDiscount: coercePactDecimal(block["ignis-discount"]),
    ignisText: typeof text === "string" ? text : "",
  };
}

export interface ParsedKadenaInfo {
  /** Native STOA the operation needs (0 ⇒ Gas Station covers it). */
  kadenaNeed: number | null;
  kadenaFull: number | null;
  kadenaDiscount: number | null;
  kadenaText: string;
}

/** Parse the `kadena` (native-STOA) block out of an INFO read result. STOA-cost
 *  ops (Activate, Register StoicTag) report cost here, mirroring OuronetUI's
 *  `KadenaCostDisplay` (`infoData.kadena["kadena-need"]`). */
export function parseKadenaInfo(raw: unknown): ParsedKadenaInfo {
  const payload = unwrapReadResult(raw);
  const kadena =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>).kadena
      : undefined;
  const block = (kadena && typeof kadena === "object" ? kadena : {}) as Record<string, unknown>;
  const text = block["kadena-text"];
  return {
    kadenaNeed: coercePactDecimal(block["kadena-need"]),
    kadenaFull: coercePactDecimal(block["kadena-full"]),
    kadenaDiscount: coercePactDecimal(block["kadena-discount"]),
    kadenaText: typeof text === "string" ? text : "",
  };
}

export interface ParsedKadenaSplit {
  /** Protocol receiver addresses the native-STOA fee pays out to. */
  receivers: string[];
  /** Per-receiver amounts (decimal strings), index-aligned with `receivers`.
   *  The chain pre-computes these with the patron's discount applied — they are
   *  NOT an equal division of `kadena-full`. */
  amounts: string[];
}

/** Extract the native-STOA payment split (receivers + per-receiver amounts) from
 *  a STOA-op INFO read. Mirrors OuronetUI's RegisterStoicTagModal /
 *  ActivateStandardAccountModal: receivers come from the top-level `receivers`
 *  list, amounts from `kadena["kadena-split"]`. Both default to empty so the
 *  execute glue emits zero coin.TRANSFER legs when the read hasn't settled. */
export function parseKadenaSplit(raw: unknown): ParsedKadenaSplit {
  const payload = unwrapReadResult(raw);
  const obj = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;

  const rawReceivers = Array.isArray(obj.receivers) ? obj.receivers : [];
  const receivers = rawReceivers.filter((r): r is string => typeof r === "string");

  const kadena = (obj.kadena && typeof obj.kadena === "object" ? obj.kadena : {}) as Record<string, unknown>;
  const rawSplit = Array.isArray(kadena["kadena-split"]) ? (kadena["kadena-split"] as unknown[]) : [];
  const amounts = rawSplit.map((a) => {
    const n = coercePactDecimal(a);
    return n == null ? "0.0" : String(n);
  });

  return { receivers, amounts };
}
