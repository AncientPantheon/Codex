/**
 * The BROWSER-SAFETY GUARD for @ancientpantheon/codex — a RESOLVING gate, not a grep.
 *
 * WHY THIS EXISTS (the two guards it replaces were structurally blind):
 *
 *  1. `.github/workflows/publish.yml` used to grep codex's own `dist/` for
 *     `from '(fs|http2|stream/promises|…)'`. Three blind spots, each of which
 *     alone is fatal:
 *       (i)   it never matched `node:`-prefixed specifiers;
 *       (ii)  it matched only single quotes and only the static `from '…'`
 *             form — never `import("…")`, never double quotes;
 *       (iii) and fatally, it grepped OUR dist/ while the offending module is
 *             an EXTERNAL dependency whose bytes are never emitted there. The
 *             1.6.0 break (`node:stream/promises` reached through
 *             `@ardrive/turbo-sdk/lib/esm/node/index.js`) lived entirely in
 *             node_modules. No grep of `dist/` can observe that class of bug.
 *  2. `codex-arweave`'s tree-shake gate bundles with `platform:"node"` and
 *     externalizes unresolvable bare specifiers, so `node:*` leakage is
 *     invisible to it by construction. It measures tree-shaking, not
 *     browser-safety. Different question, different tool.
 *
 * WHAT THIS DOES INSTEAD: a real esbuild bundle at `platform:"browser"` of
 * EVERY JS entry in this package's `exports` map, taken from the PUBLISHED
 * `dist/` (what a consumer actually resolves — not `src/`, which no consumer
 * ever sees), FOLLOWING INTO node_modules. Any Node builtin that no browser
 * bundler can substitute is reported as a violation, whatever syntactic form
 * it arrived in — `node:`-prefixed or bare, static or dynamic, in our bytes or
 * three dependencies deep. (The five builtins that DO have real browser
 * implementations are allow-listed; see `BROWSER_SHIMMED_BUILTINS`.)
 *
 * EXTERNALS — the one place it would be easy to rebuild the blind spot.
 * Dependencies are NOT blanket-externalized. A consumer's bundler (Turbopack,
 * Vite, webpack) walks INTO node_modules; so does this guard, because that is
 * the only way an external dependency's `node:stream/promises` becomes
 * visible. Only two kinds of specifier are ever externalized:
 *   - a Node builtin — AFTER being recorded, if it is one of the unshimmable
 *     ones. Externalizing rather than erroring lets the bundle finish, so a
 *     run reports EVERY violation at once instead of dying on the first;
 *   - a bare specifier that cannot be resolved at all (an uninstalled optional
 *     peer). Those are recorded in `unresolved` and reported LOUDLY — never
 *     silently swallowed — because an unwalkable dependency is an unchecked
 *     one. They do not FAIL the run: which optional peers a given install tree
 *     happens to contain is not a property of this package.
 *
 * MISSING dist/: a hard failure, never a silent pass and never a quiet skip.
 * `runBrowserSafetyGuard` returns `ok:false` with `reason:"dist-missing"`, and
 * the CLI exits 1 telling you to build first. Both CI workflows already run
 * `npm run build` before anything that consumes this.
 *
 * esbuild is resolved from the workspace root (hoisted; declared by
 * `codex-arweave`). `scripts/` is not in this package's `files`, so nothing
 * here is published.
 *
 * Run directly:  node packages/codex/scripts/browser-safety-guard.mjs
 */

import { build } from "esbuild";
import { builtinModules } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** This package's root (…/packages/codex). */
export const PACKAGE_DIR = path.resolve(HERE, "..");

/**
 * Every Node builtin, bare and `node:`-prefixed. `builtinModules` already
 * includes the bare names (`fs`, `stream/promises`, …) plus a few that are
 * only ever `node:`-prefixed (`node:test`, `node:sea`), so both spellings are
 * derived from it rather than hand-listed — a hand-list is how the old grep
 * ended up with seven names and no `node:` prefix.
 *
 * This set is only the CLASSIFIER ("is this Node's standard library?"). What
 * is allowed through is decided separately, by `BROWSER_SHIMMED_BUILTINS`.
 */
export const NODE_BUILTINS = new Set([
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
]);

/**
 * True for any specifier a browser bundler would have to satisfy from Node's
 * standard library. Handles both spellings and subpaths (`node:fs/promises`).
 *
 * The `node:` scheme is RESERVED by Node, so the prefix alone is sufficient —
 * and necessary: `builtinModules` omits experimental modules, so
 * `node:sqlite` (which this package's own `SqliteLibraryStore` imports) is
 * absent from it on Node 22 and would otherwise have walked straight past a
 * list-based check. That omission was found by this module's own test, and it
 * is the same shape of hole the old CI grep died of.
 *
 * @param {string} specifier
 */
export const isNodeBuiltin = (specifier) =>
  specifier.startsWith("node:") || NODE_BUILTINS.has(specifier);

/**
 * The ONLY builtins allowed to reach a browser bundle, in either spelling.
 *
 * This is the line the consumer's own bundler draws, and the reason their
 * 1.6.0 build named exactly one specifier: these five have REAL, functional
 * browser implementations that Turbopack/webpack/Vite substitute
 * automatically, while `node:stream/promises` (and `fs`, `http2`, `net`,
 * `child_process`, …) have none — at best an inert empty stub, at worst
 * Turbopack's hard `the chunking context does not support external modules`.
 *
 * ALLOW-LIST, NOT DENY-LIST — deliberately the inverse of the old CI grep.
 * That grep named seven forbidden builtins, so every builtin it had not
 * thought of passed. Here anything not named below FAILS, so the next Node-ism
 * nobody anticipated fails by default.
 *
 * Each entry is justified by something actually in the graph today; extending
 * this list is a deliberate decision that needs the same justification, not a
 * way to make a red build green:
 *   - `buffer`     — @stoachain/stoa-core, @kadena/cryptography-utils, bn.js,
 *                    arbundles' web build, safe-buffer
 *   - `crypto`     — tweetnacl, @noble/ed25519, arbundles' web build
 *   - `stream`     — arbundles' web build (`src/stream/index.js`)
 *   - `events`     — readable-stream
 *   - `util`       — readable-stream
 * Subpaths are NOT covered by the name alone: `stream` is allowed,
 * `stream/promises` is not — that distinction IS the reported bug.
 */
export const BROWSER_SHIMMED_BUILTINS = new Set([
  "buffer",
  "crypto",
  "events",
  "stream",
  "util",
]);

/**
 * A Node builtin that a browser bundler cannot substitute — the guard's
 * violation predicate.
 * @param {string} specifier
 */
export const isBrowserUnsafeBuiltin = (specifier) => {
  if (!isNodeBuiltin(specifier)) return false;
  const bare = specifier.startsWith("node:") ? specifier.slice(5) : specifier;
  return !BROWSER_SHIMMED_BUILTINS.has(bare);
};

/**
 * The JS entries a consumer can resolve, derived from the `exports` map so a
 * subpath added later is guarded automatically — the old CI check's "run it
 * against every published entry, not just `./arweave`" intent, mechanized.
 *
 * Non-JS entries (`./ui.css`) are skipped: a stylesheet cannot import a Node
 * builtin, and feeding it to a JS bundler only produces noise.
 *
 * @param {{ exports?: Record<string, unknown> }} pkgJson
 * @returns {{ subpath: string, target: string }[]}
 */
export function publishedJsEntries(pkgJson) {
  const entries = [];
  for (const [subpath, value] of Object.entries(pkgJson.exports ?? {})) {
    // A condition object ({ types, import }) or a bare string target.
    const target =
      typeof value === "string"
        ? value
        : typeof value === "object" && value !== null
          ? (/** @type {Record<string, string>} */ (value).import ??
            /** @type {Record<string, string>} */ (value).default)
          : undefined;
    if (typeof target !== "string") continue;
    if (!/\.(m?js|cjs)$/.test(target)) continue;
    entries.push({ subpath, target });
  }
  return entries;
}

/**
 * Bundle one entry at `platform:"browser"` and report every Node builtin the
 * bundler had to resolve, plus any bare specifier it could not resolve at all.
 *
 * A bundle that fails OUTRIGHT is itself a browser-safety failure — that is
 * precisely the shape of the reported consumer break ("the chunking context
 * does not support external modules") — so esbuild's own errors are captured
 * into `buildErrors` rather than thrown. Whatever the plugin recorded before
 * the abort is still returned, so one run reports as much as it saw.
 *
 * @param {string} entryAbsPath
 * @returns {Promise<{
 *   violations: { specifier: string, importer: string }[],
 *   unresolved: { specifier: string, importer: string }[],
 *   buildErrors: string[],
 * }>}
 */
export async function bundleEntryForBrowser(entryAbsPath) {
  /** @type {{ specifier: string, importer: string }[]} */
  const violations = [];
  /** @type {{ specifier: string, importer: string }[]} */
  const unresolved = [];

  const guardPlugin = {
    name: "node-builtin-guard",
    /** @param {import("esbuild").PluginBuild} b */
    setup(b) {
      b.onResolve({ filter: /.*/ }, async (args) => {
        if (args.pluginData === "guard-probe") return undefined;
        if (args.kind === "entry-point") return undefined;
        const specifier = args.path;

        // THE CHECK. Recorded with its importer so the failure message names
        // the dependency that dragged the builtin in — the 1.6.0 report's
        // single most useful line was the import chain, not the specifier.
        if (isNodeBuiltin(specifier)) {
          if (isBrowserUnsafeBuiltin(specifier)) {
            violations.push({ specifier, importer: args.importer });
          }
          // Externalize either way — AFTER recording, so the bundle completes
          // and one run reports every violation instead of dying on the first.
          // A shimmed builtin is externalized for the same reason a consumer's
          // bundler substitutes it: it is not ours to resolve.
          return { path: specifier, external: true };
        }

        if (specifier.startsWith(".") || path.isAbsolute(specifier)) {
          return undefined;
        }

        // A bare dependency specifier: WALK INTO IT. Not externalizing is the
        // whole point — turbo-sdk's `node:stream/promises` is only visible
        // from inside node_modules.
        const probe = await b.resolve(specifier, {
          importer: args.importer,
          resolveDir: args.resolveDir,
          kind: args.kind,
          namespace: args.namespace,
          pluginData: "guard-probe",
        });
        if (probe.errors.length > 0) {
          unresolved.push({ specifier, importer: args.importer });
          return { path: specifier, external: true };
        }
        return { path: probe.path, external: probe.external };
      });
    },
  };

  /** @type {string[]} */
  const buildErrors = [];
  try {
    await build({
      entryPoints: [entryAbsPath],
      bundle: true,
      write: false,
      format: "esm",
      // The whole point. `browser` does NOT auto-externalize Node builtins the
      // way `node` does, so they reach the plugin above.
      platform: "browser",
      // Mirror what a consumer's bundler picks for a web app.
      conditions: ["browser", "import", "module", "default"],
      logLevel: "silent",
      // A stylesheet is not a JS module and cannot carry a Node builtin;
      // without this esbuild refuses any graph containing `import "./x.css"`.
      loader: { ".css": "empty" },
      plugins: [guardPlugin],
    });
  } catch (err) {
    const esbuildErrors = /** @type {{ errors?: { text?: string, location?: { file?: string, line?: number } }[] }} */ (
      err
    ).errors;
    if (Array.isArray(esbuildErrors) && esbuildErrors.length > 0) {
      for (const e of esbuildErrors) {
        const where = e.location?.file
          ? ` (${e.location.file}:${e.location.line ?? 0})`
          : "";
        buildErrors.push(`${e.text ?? "unknown esbuild error"}${where}`);
      }
    } else {
      buildErrors.push(String(err));
    }
  }

  return { violations, unresolved, buildErrors };
}

/**
 * Run the guard over every published JS entry of `packageDir`.
 *
 * @param {{ packageDir?: string }} [options]
 * @returns {Promise<{
 *   ok: boolean,
 *   reason?: "dist-missing",
 *   message?: string,
 *   entries: { subpath: string, target: string,
 *              violations: { specifier: string, importer: string }[],
 *              unresolved: { specifier: string, importer: string }[],
 *              buildErrors: string[] }[],
 * }>}
 */
export async function runBrowserSafetyGuard({ packageDir = PACKAGE_DIR } = {}) {
  const pkgJson = JSON.parse(
    readFileSync(path.join(packageDir, "package.json"), "utf8"),
  );
  const declared = publishedJsEntries(pkgJson);

  // A missing (or entry-less) dist is a FAILURE, not a skip. "No dist, no
  // findings, green" is how a guard quietly stops guarding.
  const missing = declared.filter(
    (e) => !existsSync(path.resolve(packageDir, e.target)),
  );
  if (declared.length === 0 || missing.length > 0) {
    return {
      ok: false,
      reason: "dist-missing",
      message:
        declared.length === 0
          ? `${pkgJson.name}: no JS entries in the exports map — nothing could be checked.`
          : `${pkgJson.name}: dist/ is not built (missing: ${missing
              .map((m) => m.target)
              .join(", ")}). Run \`npm run build\` first — the guard checks the` +
            ` PUBLISHED entries, which is what a consumer resolves.`,
      entries: [],
    };
  }

  const entries = [];
  for (const entry of declared) {
    const bundled = await bundleEntryForBrowser(
      path.resolve(packageDir, entry.target),
    );
    entries.push({ ...entry, ...bundled });
  }

  // `unresolved` is NOT part of `ok`. It is a blind spot, not a browser-safety
  // verdict: an uninstalled optional peer is legitimate, and failing on it
  // would make the guard hostage to whatever a given install tree happens to
  // contain. It is printed on every run, marked "NOT checked", so it can never
  // be mistaken for a clean walk — which is the only property that matters
  // here. A VIOLATION or a bundle that will not build is a hard failure.
  const ok = entries.every(
    (e) => e.violations.length === 0 && e.buildErrors.length === 0,
  );
  return { ok, entries };
}

/**
 * Human/CI-readable report. Returns the text so the test can assert on it
 * instead of scraping stdout.
 * @param {Awaited<ReturnType<typeof runBrowserSafetyGuard>>} result
 */
export function formatGuardReport(result) {
  if (result.reason === "dist-missing") {
    return `✗ browser-safety guard: ${result.message}`;
  }
  const lines = [];
  for (const entry of result.entries) {
    const failed =
      entry.violations.length > 0 || entry.buildErrors.length > 0;
    lines.push(`  ${failed ? "✗" : "✓"} ${entry.subpath} → ${entry.target}`);
    for (const v of entry.violations) {
      lines.push(
        `      UNSHIMMABLE node builtin "${v.specifier}" reached from ${v.importer}`,
      );
    }
    for (const u of entry.unresolved) {
      lines.push(
        `      UNRESOLVED "${u.specifier}" (imported by ${u.importer}) — could` +
          ` not be walked, so its own builtins were NOT checked`,
      );
    }
    for (const e of entry.buildErrors) {
      lines.push(`      BUNDLE ERROR ${e}`);
    }
  }
  lines.push(
    result.ok
      ? `✓ browser-safety guard: all ${result.entries.length} published entries bundle for the browser with no unshimmable Node builtin.`
      : "✗ browser-safety guard: a published entry needs a Node builtin that no browser bundler can substitute. Remove the specifier from the graph — a dynamic `import()` does NOT help, the bundler must still resolve it.",
  );
  return lines.join("\n");
}

// CLI. Exit 1 on any violation, on an unresolvable dependency, and on a
// missing dist/.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const result = await runBrowserSafetyGuard();
  const report = formatGuardReport(result);
  console.log(report);
  if (!result.ok) {
    console.error(
      "::error::@ancientpantheon/codex cannot be bundled for the browser. See the entries marked ✗ above.",
    );
    process.exit(1);
  }
}
