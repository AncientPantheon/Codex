/**
 * publish-files.test.ts — locks the published-tarball contents to `dist` +
 * docs only.
 *
 * The test fixture (`tests/fixtures/test-keyfile.ts`) is a real, committed RSA
 * private key. It must NEVER ship in the published npm package, and neither
 * must any other source or test file. The `files` field in package.json is the
 * source of truth for what npm packs, so this test pins that field: if a future
 * edit adds `tests`, `src`, or `fixtures` to the publish set, this test fails
 * before the secret-bearing fixture can leak into a released tarball.
 */

import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

interface PackageManifest {
  files?: string[];
}

const manifest: PackageManifest = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

/** The only paths allowed in the published tarball. */
const EXPECTED_PUBLISH_SET = ["dist", "CHANGELOG.md", "README.md"];

/** Paths that would leak source/test material (incl. the committed keyfile). */
const FORBIDDEN_PUBLISH_ENTRIES = ["tests", "src", "fixtures"];

describe("published package contents (files field)", () => {
  it("declares an explicit files allow-list (never publishes the whole dir)", () => {
    expect(Array.isArray(manifest.files)).toBe(true);
    expect(manifest.files!.length).toBeGreaterThan(0);
  });

  it("excludes tests, src, and fixtures so the committed keyfile never ships", () => {
    const files = manifest.files ?? [];
    for (const forbidden of FORBIDDEN_PUBLISH_ENTRIES) {
      expect(files).not.toContain(forbidden);
    }
    // Guard substring/glob forms too (e.g. "tests/**", "src/*").
    for (const entry of files) {
      expect(entry).not.toMatch(/(^|\/)tests(\/|$)/);
      expect(entry).not.toMatch(/(^|\/)src(\/|$)/);
      expect(entry).not.toMatch(/fixtures/);
    }
  });

  it("ships exactly the expected publish set (dist + CHANGELOG + README)", () => {
    expect([...(manifest.files ?? [])].sort()).toEqual(
      [...EXPECTED_PUBLISH_SET].sort(),
    );
  });
});
