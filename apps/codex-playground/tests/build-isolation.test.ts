/**
 * BUILD-ISOLATION guard (N-11 / D-12) — the codex-playground app is a workspace
 * MEMBER (so its deps resolve + it hot-reloads against workspace source) but is
 * ABSENT from the LIBRARY `tsc --build` graph (so a `.tsx`/JSX/DOM app never
 * pollutes the publishable library type-compile, and a broken app never blocks a
 * library build/typecheck/test/clean).
 *
 * This is a STATIC config-scan guard (the D5 T9.9 idiom): it parses the on-disk
 * root + app manifests and tsconfigs and asserts membership/absence — it authors
 * NO config. A failure here is a MIS-WIRE in T10.2's scaffold (the config owner),
 * NOT a defect to patch in this test. If an assertion fails, the isolation
 * invariant regressed at its source; fix T10.2's config, never this guard.
 *
 * The load-bearing FIX-1 assertion: ALL FOUR root `--workspaces`-shaped scripts
 * (`typecheck`, `test`, `test:watch`, `clean`) must NOT fan the app into the
 * library `tsc --build` graph. T10.2 resolved this via Option A — per-package
 * ENUMERATION (no `--workspaces`, no `apps` reference). A regression on ANY of the
 * four (e.g. a re-introduced `--workspaces` fan-out that would pull the app's
 * `tsc --noEmit` — or hard-error a missing script — into a library loop) fails
 * here. `test:watch` (the iter-2 F-001 miss) is enumerated explicitly so it is
 * covered, not silently dropped.
 */

import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";

const testDir = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(testDir, "..");
const repoRoot = resolve(appRoot, "..", "..");

const readJson = (path: string): Record<string, unknown> => {
  expect(existsSync(path), `expected config to exist at ${path}`).toBe(true);
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
};

const rootPkg = readJson(resolve(repoRoot, "package.json"));
const rootTsconfig = readJson(resolve(repoRoot, "tsconfig.json"));
const appPkg = readJson(resolve(appRoot, "package.json"));

const rootScripts = (rootPkg.scripts ?? {}) as Record<string, string>;

// The four root scripts that historically fanned over `--workspaces`. FIX-1
// requires every one of them to exclude the app from the library `tsc --build`.
// Enumerated as a const so a regression on ANY single script fails its own case.
const WORKSPACE_FAN_SCRIPTS = ["typecheck", "test", "test:watch", "clean"] as const;

describe("N-11 · codex-playground is a WORKSPACE MEMBER (deps resolve + hot reload)", () => {
  it("lists `apps/*` in the root package.json workspaces (so the app resolves in the workspace)", () => {
    // Workspace membership is ORTHOGONAL to `tsc --build` membership: the app must
    // resolve its workspace deps and hot-reload against source, which requires the
    // glob. Absence here would break `npm install` dep resolution for the app.
    const workspaces = rootPkg.workspaces as string[];
    expect(Array.isArray(workspaces), "root package.json `workspaces` must be an array").toBe(true);
    expect(
      workspaces,
      "root `workspaces` must include `apps/*` so the codex-playground app resolves as a workspace",
    ).toContain("apps/*");
  });
});

describe("N-11 / FIX-1 · codex-playground is ABSENT from the LIBRARY tsc --build graph", () => {
  it("keeps the root tsconfig `include` to `packages/*` only (never matching `apps/**`)", () => {
    // The root tsconfig drives the publishable-library `tsc --build`. If its
    // `include` matched `apps/**`, the app's `.tsx`/JSX/DOM sources would compile
    // into the library type-check — exactly the N-11 leak. It must stay packages-only.
    const include = rootTsconfig.include as string[];
    expect(include, "root tsconfig `include` should stay packages-scoped").toEqual([
      "packages/*/src/**/*.ts",
      "packages/*/tests/**/*.ts",
    ]);
    for (const pattern of include) {
      expect(
        pattern.includes("apps"),
        `root tsconfig include pattern "${pattern}" must NOT reference apps — that would pull the app into the library tsc --build`,
      ).toBe(false);
    }
  });

  it("enumerates ONLY the `packages/*` builds in the root `build` script (no app fan-in)", () => {
    // The root `build` produces publishable library artifacts. Referencing the app
    // (or `apps/*`) would try to `vite build` / compile the dev playground as part
    // of a library release — the app must never enter the release build.
    const build = rootScripts.build;
    expect(build, "root package.json must define a `build` script").toBeTypeOf("string");
    expect(
      /\bapps?\b|apps\/\*/.test(build),
      `root \`build\` script must NOT reference the app / apps: ${build}`,
    ).toBe(false);
    expect(
      build.includes("codex-playground"),
      "root `build` script must NOT reference the codex-playground app",
    ).toBe(false);
  });

  it.each(WORKSPACE_FAN_SCRIPTS)(
    "root `%s` script excludes the app from the library tsc --build (FIX-1: no `--workspaces`, no `apps` reference)",
    (scriptName) => {
      // THE FIX-1 ASSERTION. `--workspaces` would fan the script across EVERY
      // workspace member — including the app — pulling the app's `tsc --noEmit`
      // (or hard-erroring on a missing script) into a library loop. Option A (the
      // resolution T10.2 applied) enumerates each `packages/*` target explicitly,
      // so neither `--workspaces` nor any `apps` reference may appear. `test:watch`
      // (the iter-2 F-001 miss) is enumerated so this covers ALL FOUR, not three.
      const script = rootScripts[scriptName];
      expect(script, `root package.json must define a \`${scriptName}\` script`).toBeTypeOf("string");
      expect(
        script.includes("--workspaces"),
        `root \`${scriptName}\` must NOT use \`--workspaces\` (FIX-1) — it would fan the app into the library tsc --build: ${script}`,
      ).toBe(false);
      expect(
        /\bapps?\b|apps\/\*/.test(script),
        `root \`${scriptName}\` must NOT reference the app / apps (FIX-1): ${script}`,
      ).toBe(false);
      expect(
        script.includes("codex-playground"),
        `root \`${scriptName}\` must NOT reference the codex-playground app (FIX-1)`,
      ).toBe(false);
    },
  );
});

describe("N-11 · codex-playground is PRIVATE and NEVER published", () => {
  it("marks the app package.json `private: true`", () => {
    // A dev-only playground must never accidentally publish. `private: true` is npm's
    // hard publish block; its absence would let `npm publish` push the app.
    expect(
      appPkg.private,
      "apps/codex-playground/package.json must set `private: true` (N-11 — never published)",
    ).toBe(true);
  });

  it("declares NO publishConfig / registry publish target", () => {
    // Even with `private: true`, a `publishConfig` with a registry signals intent to
    // publish. The app must carry none — there is no registry target for a devtool.
    expect(
      "publishConfig" in appPkg,
      "apps/codex-playground/package.json must NOT declare a `publishConfig` (N-11 — no registry target)",
    ).toBe(false);
  });
});

describe("FIX-6 · codex-playground has its OWN app tsconfig (not the library root's)", () => {
  const appTsconfigPath = resolve(appRoot, "tsconfig.json");

  it("exists as an app-local tsconfig", () => {
    expect(
      existsSync(appTsconfigPath),
      "apps/codex-playground/tsconfig.json must exist (the app compiles under its own config, not the root tsc --build)",
    ).toBe(true);
  });

  it("EXTENDS the shared `../../tsconfig.base.json` (single-source base — FIX-6)", () => {
    // The app must inherit the base compiler contract (moduleResolution, strict,
    // paths) rather than fork it, while adding its own app-only options. A different
    // `extends` target would drift the app off the single-source base.
    const appTsconfig = readJson(appTsconfigPath);
    expect(
      appTsconfig.extends,
      "app tsconfig must extend the shared base at ../../tsconfig.base.json (FIX-6)",
    ).toBe("../../tsconfig.base.json");
  });

  it("is app-local: `noEmit` + `jsx` (compiles under Vite, NOT the root tsc --build)", () => {
    // `noEmit` proves the app never emits library artifacts; `jsx` proves it is a
    // React app config Vite drives — both mark it as OUTSIDE the emitting library
    // `tsc --build`. Their absence would mean the app config mirrors the library's.
    const appTsconfig = readJson(appTsconfigPath);
    const compilerOptions = (appTsconfig.compilerOptions ?? {}) as Record<string, unknown>;
    expect(
      compilerOptions.noEmit,
      "app tsconfig must set compilerOptions.noEmit (it never emits library artifacts — Vite bundles it)",
    ).toBe(true);
    expect(
      typeof compilerOptions.jsx === "string" && compilerOptions.jsx.length > 0,
      "app tsconfig must set compilerOptions.jsx (it is a React app compiled under Vite, not the library tsc --build)",
    ).toBe(true);
  });
});
