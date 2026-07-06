// @vitest-environment node
/**
 * E4 RED matrix — the ARWEAVE ADDRESS-BOOK VALIDATOR registration (E-11 — FIX-8).
 *
 * Arweave registers its canonical-address validator into D5's per-chain address
 * validator registry via `registerChainAddressValidator(ARWEAVE_CHAIN_ID, ...)`.
 * The validator DELEGATES to arweave-core `isCanonicalAddress` / `ARWEAVE_ADDRESS_RE`
 * — it NEVER re-spells the 43-char base64url regex.
 *
 * PINNED CONTRACT (so T14.9 GREEN matches):
 *   - module path: `../src/address-book` (its `index.ts` barrel)
 *   - `ARWEAVE_CHAIN_ID` — the single-source const (from `../src/address-book/chainId`,
 *     re-exported through the barrel; equals the literal `"arweave"`)
 *   - `arweaveValidator(addr: string, type?: unknown): boolean` — delegates to
 *     `isCanonicalAddress`; ignores `type`
 *   - `registerArweaveAddressValidator(): void` — registers the validator on D5's
 *     module-level default registry via `registerChainAddressValidator`
 *
 * D5 registry (from `@ancientpantheon/codex-ouronet/hooks`, D5 T9.7/T9.8):
 *   `registerChainAddressValidator` / `validateAddress` / `getRegisteredChains` /
 *   `resetAddressValidators` / `KADENA_CHAIN_ID`.
 *
 * `// @vitest-environment node` (FIX-9): pure node-logic, no DOM.
 *
 * RED: `../src/address-book` (its barrel + `arweaveValidator` /
 * `registerArweaveAddressValidator`) does not exist yet (T14.9 GREEN).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync, globSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { isCanonicalAddress, ARWEAVE_ADDRESS_RE } from "@ancientpantheon/arweave-core";

import {
  registerChainAddressValidator,
  validateAddress,
  getRegisteredChains,
  resetAddressValidators,
  KADENA_CHAIN_ID,
} from "@ancientpantheon/codex-ouronet/hooks";

// RED: none of these exist yet (T14.9 GREEN provisions `../src/address-book`).
import {
  ARWEAVE_CHAIN_ID,
  arweaveValidator,
  registerArweaveAddressValidator,
} from "../src/address-book";

const THIS_FILE = fileURLToPath(import.meta.url);
const SRC_ROOT = join(dirname(THIS_FILE), "..", "src");

/** The throwaway fixture's KNOWN deterministic 43-char address (canonical). */
const CANONICAL_ADDR = "tzXauR_QBlPW3ZRey3xBzaiDqPqLfiqWk1SWmk2BjM4";

describe("arweave validator — the file carries the node-env pragma (FIX-9)", () => {
  it("has `// @vitest-environment node` on line 1", () => {
    const src = readFileSync(THIS_FILE, "utf8");
    expect(src.split("\n")[0].trim()).toBe("// @vitest-environment node");
  });
});

describe("Arweave address validator registration (E-11)", () => {
  beforeEach(() => {
    // Isolate the module-level default registry between tests: re-register the
    // Kadena validator (D5 registers it at its own module init) is out of scope;
    // resetAddressValidators clears everything, then we register Arweave fresh.
    resetAddressValidators();
    // D5's Kadena validator must be re-registered for the "no-disturb" row — the
    // D5 hooks module registers it on import; a reset clears it, so we re-register
    // a Kadena validator explicitly to model the co-existence.
    registerChainAddressValidator(KADENA_CHAIN_ID, (addr) => addr.startsWith("k:"));
    registerArweaveAddressValidator();
  });

  it("(a) a canonical 43-char base64url address validates TRUE; a non-canonical validates FALSE", () => {
    expect(validateAddress(ARWEAVE_CHAIN_ID, CANONICAL_ADDR)).toBe(true);

    // Wrong length (too short), bad chars, and empty all reject.
    expect(validateAddress(ARWEAVE_CHAIN_ID, "too-short")).toBe(false);
    expect(validateAddress(ARWEAVE_CHAIN_ID, "!".repeat(43))).toBe(false);
    expect(validateAddress(ARWEAVE_CHAIN_ID, "")).toBe(false);
    // 44 chars (one over) also rejects.
    expect(validateAddress(ARWEAVE_CHAIN_ID, "A".repeat(44))).toBe(false);
  });

  it("(b) the validator IGNORES the `type` argument — same result regardless of type", () => {
    expect(validateAddress(ARWEAVE_CHAIN_ID, CANONICAL_ADDR, "stoa")).toBe(true);
    expect(validateAddress(ARWEAVE_CHAIN_ID, CANONICAL_ADDR, "anything")).toBe(true);
    expect(validateAddress(ARWEAVE_CHAIN_ID, "too-short", "stoa")).toBe(false);
  });

  it("(c) registering Arweave does NOT disturb the Kadena validator", () => {
    // Kadena still validates its own form after Arweave registered.
    expect(validateAddress(KADENA_CHAIN_ID, "k:abc123")).toBe(true);
    expect(validateAddress(KADENA_CHAIN_ID, "not-kadena")).toBe(false);
  });

  it("(d) getRegisteredChains() includes BOTH the Arweave and the Kadena chain ids", () => {
    const chains = getRegisteredChains();
    expect(chains).toContain(ARWEAVE_CHAIN_ID);
    expect(chains).toContain(KADENA_CHAIN_ID);
  });

  it("(e) the validator delegates to arweave-core isCanonicalAddress / ARWEAVE_ADDRESS_RE — same verdict as the core predicate for every probe", () => {
    // The validator MUST agree with the core predicate on every case (it delegates,
    // never re-spells the regex). This fails if the validator hardcodes a different
    // regex or length.
    const probes = [
      CANONICAL_ADDR,
      "too-short",
      "!".repeat(43),
      "",
      "A".repeat(44),
      "ZzYyXxWwVvUuTtSsRrQqPpOoNnMmLlKkJjIiHhGgFfE",
    ];
    for (const p of probes) {
      expect(arweaveValidator(p)).toBe(isCanonicalAddress(p));
      expect(arweaveValidator(p)).toBe(ARWEAVE_ADDRESS_RE.test(p));
    }
  });
});

describe("ARWEAVE_CHAIN_ID single-literal grep gate (FIX-8)", () => {
  it("(f) EXACTLY ONE `\"arweave\"` chain-id string literal in src/** — only src/address-book/chainId.ts defines it; every other module value-imports the const", () => {
    // Scan every src/**/*.ts(x) for a bare-string chain-id literal `"arweave"`
    // (single OR double quoted). The ONLY legitimate site is chainId.ts's
    // `export const ARWEAVE_CHAIN_ID = "arweave"`. A second literal anywhere in
    // adapter/panel/address-book (the arweaveValidator module) means a consumer
    // re-spelled the id instead of importing the const — a FIX-8 violation.
    const files = globSync("**/*.{ts,tsx}", { cwd: SRC_ROOT }).map((f) =>
      join(SRC_ROOT, f),
    );

    const LITERAL_RE = /["']arweave["']/g;
    const hits: Array<{ file: string; line: number; text: string }> = [];

    for (const file of files) {
      const text = readFileSync(file, "utf8");
      text.split("\n").forEach((line, i) => {
        if (LITERAL_RE.test(line)) {
          hits.push({ file, line: i + 1, text: line.trim() });
        }
        LITERAL_RE.lastIndex = 0;
      });
    }

    // Exactly one hit, and it lives in chainId.ts.
    expect(hits).toHaveLength(1);
    expect(hits[0].file.replace(/\\/g, "/")).toMatch(/src\/address-book\/chainId\.ts$/);

    // Defensive: no second literal specifically in the heavy/validator modules.
    const forbiddenDirs = ["adapter", "panel"];
    for (const h of hits.slice(1)) {
      for (const dir of forbiddenDirs) {
        expect(h.file.replace(/\\/g, "/")).not.toContain(`/src/${dir}/`);
      }
    }
  });

  it("(f-value) ARWEAVE_CHAIN_ID equals the literal `\"arweave\"` (the single source)", () => {
    expect(ARWEAVE_CHAIN_ID).toBe("arweave");
  });
});
