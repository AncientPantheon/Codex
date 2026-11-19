// @vitest-environment node
/**
 * The browser-safety guard's own gate (browser-safe-release §2).
 *
 * `scripts/browser-safety-guard.mjs` exists because TWO previous guards were
 * structurally incapable of seeing the bug they were supposed to catch, and
 * both of them "passed" every single run until a consumer's build broke. So
 * the first thing this file pins is that the new guard BITES: the fixtures
 * below reproduce every blind spot of the CI grep it replaces, and the guard
 * must report them. A guard that only ever passes is worth less than none,
 * because it is believed.
 *
 * `// @vitest-environment node` — esbuild emit is node-only.
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  bundleEntryForBrowser,
  publishedJsEntries,
  isBrowserUnsafeBuiltin,
  runBrowserSafetyGuard,
  formatGuardReport,
  PACKAGE_DIR,
  // @ts-expect-error — plain-JS build script, no .d.ts (same arrangement as
  // codex-arweave's `scripts/treeshake-bundle.mjs` and its E4 gate).
} from "../scripts/browser-safety-guard.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "fixtures", "browser-guard");

type Finding = { specifier: string; importer: string };

const specifiers = (findings: Finding[]): string[] =>
  findings.map((f) => f.specifier);

describe("the guard BITES — every blind spot of the grep it replaces", () => {
  it("reports a `node:`-prefixed, DYNAMICALLY-imported, double-quoted builtin that lives one hop away from the entry — the exact three things the CI grep could not match", async () => {
    const { violations, buildErrors } = await bundleEntryForBrowser(
      join(FIXTURES, "offender-entry.js"),
    );

    // (i) `node:` prefix, (ii) `import("…")` with double quotes, (iii) in a
    // TRANSITIVE module, not the entry — i.e. in the dependency's bytes, which
    // is where turbo-sdk's `node:stream/promises` actually lived. Any one of
    // these alone defeated `grep -rlE "from '(fs|…)'" dist/`.
    expect(specifiers(violations)).toContain("node:stream/promises");
    expect(specifiers(violations)).toContain("node:fs/promises");

    // The importer is reported, not just the specifier: the single most useful
    // line in the consumer's bug report was the import chain.
    expect(violations[0].importer).toContain("transitive-dep.js");

    // The bundle itself must still have emitted — violations are collected and
    // the build completes, so one run reports ALL of them instead of dying on
    // the first.
    expect(buildErrors).toEqual([]);
  });

  it("does NOT flag builtins that every browser bundler substitutes for real (`node:buffer`, `crypto`) — otherwise the guard is red forever and gets switched off", async () => {
    const { violations, buildErrors } = await bundleEntryForBrowser(
      join(FIXTURES, "clean-entry.js"),
    );

    expect(violations).toEqual([]);
    expect(buildErrors).toEqual([]);
  });

  it("classifies by SUBPATH, not by the root builtin name: `stream` is substitutable, `stream/promises` is not — that single distinction is the whole 1.6.0 bug", () => {
    expect(isBrowserUnsafeBuiltin("stream")).toBe(false);
    expect(isBrowserUnsafeBuiltin("node:stream")).toBe(false);
    expect(isBrowserUnsafeBuiltin("stream/promises")).toBe(true);
    expect(isBrowserUnsafeBuiltin("node:stream/promises")).toBe(true);

    // The allow-list is an ALLOW-list: a builtin nobody thought of fails by
    // default. The old grep named seven forbidden builtins, so `http2`'s
    // cousins all passed.
    expect(isBrowserUnsafeBuiltin("fs")).toBe(true);
    expect(isBrowserUnsafeBuiltin("node:worker_threads")).toBe(true);
    expect(isBrowserUnsafeBuiltin("node:sqlite")).toBe(true);

    // Not a builtin at all — a dependency named `stream-browserify` or an npm
    // package called `crypto-js` must never be mistaken for one.
    expect(isBrowserUnsafeBuiltin("stream-browserify")).toBe(false);
    expect(isBrowserUnsafeBuiltin("@ardrive/turbo-sdk")).toBe(false);
  });
});

describe("what the guard checks — the exports map, and nothing less", () => {
  it("derives EVERY JS entry from the real package.json exports map (so a subpath added later is guarded automatically) and skips ./ui.css", async () => {
    const pkgJson = JSON.parse(
      (await import("node:fs")).readFileSync(
        join(PACKAGE_DIR, "package.json"),
        "utf8",
      ),
    );
    const entries = publishedJsEntries(pkgJson);
    const subpaths = entries.map((e: { subpath: string }) => e.subpath);

    // Every JS subpath a consumer can import. The grep this replaces ran over
    // a directory, so "which entries are covered" was never a stated property
    // at all; here it is derived, so adding `./ui/wired` tomorrow cannot
    // quietly go unchecked.
    const declaredJsSubpaths = Object.entries(pkgJson.exports as Record<string, unknown>)
      .filter(([, v]) => typeof v === "object" && v !== null)
      .map(([k]) => k);
    expect(subpaths.sort()).toEqual(declaredJsSubpaths.sort());

    // A stylesheet cannot import a Node builtin; feeding it to a JS bundler
    // only produces noise.
    expect(subpaths).not.toContain("./ui.css");
    expect(
      entries.every((e: { target: string }) => e.target.endsWith(".js")),
    ).toBe(true);
  });

  it("an ABSENT dist/ is a FAILURE, never a quiet skip — the failure mode that would silently retire the guard on a fresh checkout", async () => {
    // A package whose exports map points at a dist/ that was never built.
    const dir = mkdtempSync(join(tmpdir(), "codex-guard-nodist-"));
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        name: "@ancientpantheon/fake",
        exports: { ".": { import: "./dist/index.js" } },
      }),
    );

    const result = await runBrowserSafetyGuard({ packageDir: dir });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("dist-missing");
    expect(formatGuardReport(result)).toContain("npm run build");
  });
});

describe("the real published package", () => {
  it("bundles every published entry for the browser with no unshimmable Node builtin (acceptance 8)", async () => {
    // Runs against the REAL `dist/`, because that is what a consumer resolves.
    // Requires a prior `npm run build` — both CI workflows build before tests
    // for exactly this reason. If dist/ is missing this fails with
    // `reason: "dist-missing"` rather than passing.
    const result = await runBrowserSafetyGuard();
    const report = formatGuardReport(result);

    expect(result.reason, report).toBeUndefined();

    const offenders = result.entries.flatMap(
      (e: { subpath: string; violations: Finding[] }) =>
        e.violations.map((v) => `${e.subpath}: ${v.specifier} ← ${v.importer}`),
    );
    expect(offenders, report).toEqual([]);
    expect(result.ok, report).toBe(true);
  });

  it("no published entry reaches @ardrive/turbo-sdk — the 1.6.0 regression, pinned at the package boundary", async () => {
    // codex-arweave's tree-shake gate pins the same absence at ITS boundary;
    // this pins it at the one the consumer actually resolves, which is where
    // the break was observed. The specifier is checked as UNRESOLVED-or-walked
    // agnostic: if it ever returns, either it resolves (and its `node:stream`
    // imports become violations above) or it does not (and it is listed here).
    const result = await runBrowserSafetyGuard();
    const everyFinding = result.entries.flatMap(
      (e: { violations: Finding[]; unresolved: Finding[] }) => [
        ...e.violations,
        ...e.unresolved,
      ],
    );
    expect(
      everyFinding.filter(
        (f: Finding) =>
          f.specifier.includes("@ardrive/turbo-sdk") ||
          f.importer.includes("@ardrive/turbo-sdk"),
      ),
    ).toEqual([]);
  });
});
