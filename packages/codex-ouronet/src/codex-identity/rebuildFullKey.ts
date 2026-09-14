/**
 * `rebuildFullKey` — re-derive a DALOS-family `FullKey` from the decrypted
 * plaintext of an Ouronet account's `secret`, its origin mode and its curve.
 *
 * Lifted verbatim out of `src/ui/internal/DalosSecretReveal.tsx` (which still
 * owns the tabbed reveal UI and now imports this helper). It is reusable
 * because the Arweave seed flow needs the SAME re-derivation to obtain an
 * account's 1600-bit DALOS bitstring — the single input to the deterministic
 * RSA-4096 search — without decrypting through the reveal modal.
 *
 * APOLLO (₱./Π.) accounts re-derive on the 1024-bit curve (32×32 bitmap);
 * DALOS Genesis (Ѻ./Σ.) on 1600 bits (40×40). The registry is built per call
 * (`createDefaultRegistry` + `register(Apollo)` when the curve is apollo) —
 * the same construction OuronetUI's `getOuronetRegistry` uses.
 *
 * Returns `null` (never throws) when the plaintext cannot be parsed under the
 * given mode, so callers can render an error state instead of unmounting.
 */

import {
  Apollo,
  createDefaultRegistry,
  createOuronetAccount,
  parseAsciiBitmap,
  type CreateAccountOptions,
  type FullKey,
} from "@stoachain/stoa-core/dalos";
import type { IOuroAccount, OuroOriginMode, OuronetOriginCurve } from "../types/entities.js";

export function rebuildFullKey(plaintext: string, originMode: OuroOriginMode, originCurve: OuronetOriginCurve): FullKey | null {
  try {
    const primitiveId = originCurve === "apollo" ? "dalos-apollo" : "dalos-gen-1";
    const registry = createDefaultRegistry();
    if (originCurve === "apollo") registry.register(Apollo);

    let options: CreateAccountOptions;
    switch (originMode) {
      case "seedWords": {
        const words = plaintext.trim().split(/\s+/).filter(Boolean);
        if (!words.length) return null;
        options = { mode: "seedWords", data: words, primitiveId };
        break;
      }
      case "bitmap": {
        const lines = plaintext.split(",");
        if (originCurve === "apollo") {
          let bits = "";
          for (const row of lines) for (const ch of row) bits += (ch === "#" || ch === "1") ? "1" : "0";
          options = { mode: "bitString", data: bits, primitiveId };
        } else {
          const bmp = parseAsciiBitmap(lines);
          options = { mode: "bitmap", data: bmp, primitiveId };
        }
        break;
      }
      case "bitString": options = { mode: "bitString", data: plaintext, primitiveId }; break;
      case "integerBase10": options = { mode: "integerBase10", data: plaintext, primitiveId }; break;
      case "integerBase49": options = { mode: "integerBase49", data: plaintext, primitiveId }; break;
      default: {
        const words = plaintext.trim().split(/\s+/).filter(Boolean);
        options = { mode: "seedWords", data: words, primitiveId };
      }
    }
    return createOuronetAccount(registry, options);
  } catch (err) {
    console.error("rebuildFullKey failed:", err);
    return null;
  }
}

/** The minimum an account must carry for `bitStringOf` to re-derive it.
 *  Structurally satisfied by `IOuroAccount`. */
export type BitStringAccount = Pick<IOuroAccount, "address"> &
  Partial<Pick<IOuroAccount, "originMode" | "originCurve">>;

/** DALOS Genesis address prefixes — standard (Ѻ.) and smart (Σ.). Everything
 *  else in the family is APOLLO (₱. / Π.). */
const DALOS_ADDRESS_PREFIXES = ["Ѻ.", "Σ."] as const;

/** Resolve an account's curve: the recorded `originCurve` when present, else
 *  inferred from the address prefix (`originCurve` is optional on
 *  `IOuroAccount`, so accounts written before it existed have none). */
export function curveOf(account: BitStringAccount): OuronetOriginCurve {
  if (account.originCurve) return account.originCurve;
  return DALOS_ADDRESS_PREFIXES.some((p) => account.address.startsWith(p)) ? "dalos" : "apollo";
}

/** The account's private-key bitstring (1600 bits on DALOS Genesis, 1024 on
 *  APOLLO), re-derived from its decrypted `secret` plaintext. `null` when the
 *  plaintext cannot be rebuilt. */
export function bitStringOf(account: BitStringAccount, plaintext: string): string | null {
  const full = rebuildFullKey(plaintext, account.originMode ?? "seedWords", curveOf(account));
  return full ? full.privateKey.bitString : null;
}
