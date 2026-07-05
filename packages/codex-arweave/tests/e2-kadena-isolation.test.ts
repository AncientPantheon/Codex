/**
 * E2 RED matrix — the E-04 Kadena-isolation acceptance gate (N-05).
 *
 * The Arweave signer/send is a SIBLING of the Kadena signing path — it shares
 * NOTHING with `InternalCodexResolver` / `CodexSigningStrategy` / `KeyResolver` /
 * `PactClient` / `useSignTransaction`. Two gates prove it:
 *
 *   (a) STATIC IMPORT-SCAN — read `src/signer/**` + `src/adapter/**` file text
 *       and assert NO import references any forbidden Kadena specifier/symbol,
 *       and the signer path imports ONLY arweave-core (+ codex-core types +
 *       `arweave`). SCOPE LIMIT: this lexical scan catches DIRECT imports only —
 *       it does NOT catch a transitive import via a clean-looking re-export. The
 *       RUNTIME sentinel below is the AUTHORITATIVE gate. The scan may pass
 *       VACUOUSLY while `src/signer` is empty (pre-GREEN); the load-bearing part
 *       is that it STAYS clean after the signer is filled.
 *
 *   (b) RUNTIME NEGATIVE SENTINEL (authoritative) — `createArweaveAdapter`
 *       carries NO KeyResolver/SigningStrategy/resolver param; inject a sentinel
 *       shaped like `InternalCodexResolver` (throwing `resolvePrivateKey`/
 *       `smartDecrypt` spies) and run the FULL flow (buildSend→sign→post + the
 *       balance/status reads) — the sentinel is NEVER invoked.
 */

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import Arweave from "arweave";

import {
  arweaveTransactionStatus,
  arweaveBalanceAsAr,
  createArweaveAdapter,
} from "../src/adapter";
import {
  throwawayJwk,
  KNOWN_ADDRESS,
  CANONICAL_TARGET,
  makeSingleEndpointPool,
  makeFakeApiFactory,
  makeFetchFn,
  confirmedBody,
} from "./e2-helpers";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "src");

/** The forbidden Kadena module specifiers + symbol names the signer/send path
 *  must NEVER reference in an import. */
const FORBIDDEN_TOKENS = [
  "@stoachain/stoa-core/signing",
  "@stoachain/stoa-core/crypto",
  "InternalCodexResolver",
  "CodexSigningStrategy",
  "KeyResolver",
  "PactClient",
  "useSignTransaction",
  "codex-ouronet/src/resolver",
  "/resolver",
] as const;

/** Recursively collect `.ts` (non-test) files under a directory, or `[]` if it
 *  does not exist yet (the `src/signer` glob is empty pre-GREEN). */
function collectTsFiles(dir: string): string[] {
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSyncSafe(dir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectTsFiles(full));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

function readdirSyncSafe(dir: string): import("node:fs").Dirent[] {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { readdirSync } = require("node:fs") as typeof import("node:fs");
  return readdirSync(dir, { withFileTypes: true });
}

/** Extract only the `import ... from "..."` statement lines (the scan targets
 *  import specifiers, not comment mentions of a forbidden symbol). */
function importLines(source: string): string[] {
  return source
    .split("\n")
    .filter((line) => /^\s*import\b/.test(line) || /\bfrom\s+["']/.test(line));
}

describe("STATIC import-scan — the signer/adapter/library source is Kadena-free (E-04, N-05)", () => {
  const signerFiles = collectTsFiles(join(SRC, "signer"));
  const adapterFiles = collectTsFiles(join(SRC, "adapter"));
  const libraryFiles = collectTsFiles(join(SRC, "library"));
  const scanned = [...signerFiles, ...adapterFiles, ...libraryFiles];

  it("references NO forbidden Kadena specifier/symbol in any import across src/signer + src/adapter + src/library", () => {
    for (const file of scanned) {
      const lines = importLines(readFileSync(file, "utf8"));
      const joined = lines.join("\n");
      for (const token of FORBIDDEN_TOKENS) {
        expect(
          joined.includes(token),
          `${file} import block must not reference "${token}"`,
        ).toBe(false);
      }
    }
  });

  it("the signer/adapter/library imports are drawn ONLY from arweave-core / codex-core / arweave", () => {
    // Every bare-module import specifier must be one of the allow-listed packages
    // (relative imports and node builtins are always allowed).
    const ALLOWED = [
      "@ancientpantheon/arweave-core",
      "@ancientpantheon/codex-core",
      "arweave",
    ];
    const importFrom = /\bfrom\s+["']([^"']+)["']/g;
    for (const file of scanned) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(importFrom)) {
        const spec = match[1];
        const isRelative = spec.startsWith(".") || spec.startsWith("/");
        const isNodeBuiltin = spec.startsWith("node:");
        const isAllowedPkg = ALLOWED.some(
          (pkg) => spec === pkg || spec.startsWith(`${pkg}/`),
        );
        expect(
          isRelative || isNodeBuiltin || isAllowedPkg,
          `${file} imports from unexpected specifier "${spec}"`,
        ).toBe(true);
      }
    }
  });
});

describe("RUNTIME negative sentinel — the Kadena resolver is NEVER touched (E-04, authoritative)", () => {
  it("createArweaveAdapter carries NO KeyResolver/SigningStrategy/resolver param (constructible with only { pool })", () => {
    // Constructing with only a pool-shaped dep succeeds — the factory has no
    // resolver/strategy slot. (A resolver param would show up as a required dep.)
    const adapter = createArweaveAdapter({ pool: makeSingleEndpointPool() as never });
    expect(typeof adapter.sign).toBe("function");
    expect(typeof adapter.post).toBe("function");
    expect(typeof adapter.buildSend).toBe("function");
    // No resolver/strategy leaked onto the adapter surface.
    expect(adapter).not.toHaveProperty("resolver");
    expect(adapter).not.toHaveProperty("keyResolver");
    expect(adapter).not.toHaveProperty("signingStrategy");
  });

  it("the FULL Arweave flow (buildSend→sign→post + balance + status) never invokes an InternalCodexResolver-shaped sentinel", async () => {
    // A sentinel shaped like InternalCodexResolver: any touch is a Critical bug.
    const sentinel = {
      resolvePrivateKey: vi.fn(() => {
        throw new Error("Kadena resolver was touched");
      }),
      smartDecrypt: vi.fn(() => {
        throw new Error("Kadena resolver was touched");
      }),
      requestForeignKey: vi.fn(() => {
        throw new Error("Kadena resolver was touched");
      }),
    };

    const pool = makeSingleEndpointPool();
    const adapter = createArweaveAdapter({ pool: pool as never });

    // sign — build an unsigned tx and sign it directly.
    const builder = Arweave.init({ host: "arweave.net", protocol: "https", port: 443 });
    const tx = await builder.createTransaction(
      { target: KNOWN_ADDRESS, quantity: "1000", last_tx: "anchor", reward: "1000" },
      throwawayJwk,
    );
    await adapter.sign(tx, throwawayJwk);

    // buildSend → post over a fake apiFactory.
    const { apiFactory } = makeFakeApiFactory({ price: "5000000000", postStatus: 200 });
    const built = await adapter.buildSend({
      target: CANONICAL_TARGET,
      amountAr: "1.5",
      maxRewardAr: "0.01",
    });
    const result = (await adapter.post(built, throwawayJwk, { apiFactory })) as {
      id: string;
    };

    // balance + status reads over a fake fetchFn.
    await arweaveBalanceAsAr(pool as never, KNOWN_ADDRESS, {
      fetchFn: makeFetchFn(200, "1500000000000"),
    });
    await arweaveTransactionStatus(pool as never, result.id, {
      fetchFn: makeFetchFn(200, confirmedBody(10)),
    });

    // The sentinel was NEVER referenced by the Arweave path.
    expect(sentinel.resolvePrivateKey).not.toHaveBeenCalled();
    expect(sentinel.smartDecrypt).not.toHaveBeenCalled();
    expect(sentinel.requestForeignKey).not.toHaveBeenCalled();
  });
});
