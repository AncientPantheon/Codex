// @vitest-environment node
/**
 * Phase 2 (N-03, Arweave half) — the no-hidden-default endpoint guard.
 *
 * The Codex Arweave path must ALWAYS read/broadcast against an EXPLICITLY
 * provided endpoint sourced from the connection/network-settings — NEVER a hidden
 * `arweave.net` default and NEVER a no-endpoint `createGatewayPool()` (which would
 * silently fall back to arweave-core's library `DEFAULT_ENDPOINT`).
 *
 * This grep-guard scans ALL of `packages/codex-arweave/src/**` (non-test) and
 * asserts:
 *   (a) no REACHABLE hardcoded `arweave.net` outside a comment — a bare-string
 *       gateway literal in code would pin the Codex path to the public gateway;
 *   (b) no `createGatewayPool(` call with NO endpoints argument — that is the
 *       exact expression that triggers arweave-core's `arweave.net` default.
 *
 * arweave-core keeping `DEFAULT_ENDPOINT = "https://arweave.net"` as a library
 * convenience is fine and out of scope here; this guard proves the Codex ADAPTER
 * never triggers it (the endpoint is always injected via createArweaveConnection).
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "src");

/** Recursively collect all `.ts`/`.tsx` production files under `src` (never a
 *  `.test.ts`). */
function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectSourceFiles(full));
    } else if (
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      !entry.name.endsWith(".test.ts") &&
      !entry.name.endsWith(".test.tsx")
    ) {
      out.push(full);
    }
  }
  return out;
}

/** Strip line/block comments so a mention of `arweave.net` inside documentation
 *  (explaining that it is NOT hardcoded) does not trip the reachable-code scan. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

describe("N-03 — the codex-arweave path relies on NO hidden arweave.net default", () => {
  const files = collectSourceFiles(SRC);

  it("scans a non-empty set of src files (the guard is not vacuous)", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("has NO reachable hardcoded `arweave.net` literal in any src file (comments excluded)", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const code = stripComments(readFileSync(file, "utf8"));
      if (code.includes("arweave.net")) {
        offenders.push(file);
      }
    }
    expect(
      offenders,
      `reachable "arweave.net" literal(s) found in: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("makes NO no-endpoint `createGatewayPool(` call (which would default to arweave.net)", () => {
    // A no-endpoint call is `createGatewayPool()` or `createGatewayPool({...})`
    // whose object literal carries no `endpoints:` key. We flag any
    // `createGatewayPool(` occurrence that is NOT immediately given an
    // `endpoints`-bearing config.
    const offenders: string[] = [];
    for (const file of files) {
      const code = stripComments(readFileSync(file, "utf8"));
      const callRe = /createGatewayPool\s*\(([^)]*)/g;
      for (const match of code.matchAll(callRe)) {
        const args = match[1];
        // Empty args OR an argument object with no `endpoints` key relies on the
        // default. `endpoints` sourced from a variable still names the key.
        if (!/endpoints/.test(args)) {
          offenders.push(`${file}: createGatewayPool(${args.trim()})`);
        }
      }
    }
    expect(
      offenders,
      `no-endpoint createGatewayPool call(s): ${offenders.join(" | ")}`,
    ).toEqual([]);
  });
});
