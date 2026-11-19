/**
 * `detectCodexShapeVersion` / `formatCodexShapeVersionLabel` —
 * `codex-shape-version-stamp` Topic 1's pre-unlock detection utility.
 *
 * `detectCodexShapeVersion` is the ONLY thing a UI needs before a password is
 * ever typed: a defensive, never-throwing probe of the raw export text for a
 * top-level `Codex_Shape_Version` string. It must never throw on malformed
 * input (mirrors `codex-arweave/src/library/flow.ts`'s own
 * `deriveBackupLineage` try/catch discipline) — a real `File`'s raw text can
 * be anything before the user has even picked the right file.
 *
 * The two REAL `Miscellaneous/_Codices/Foreign/*.json` files are read
 * directly off disk (outside this repo, absolute path, via
 * `fs.readFileSync` — NOT resolved relative to the repo) and asserted to
 * detect as `undefined` ("Unversioned") — they predate this field and are
 * the exact real-world case this function exists to recognize correctly.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  detectCodexShapeVersion,
  formatCodexShapeVersionLabel,
} from "../src";

const FOREIGN_CODEX_DIR =
  "/home/ancientbox/ClaudeWS/Miscellaneous/_Codices/Foreign";
const IONUT_CODEX_PATH = `${FOREIGN_CODEX_DIR}/Ionut_OuronetCodex_2026-10-11_13-22-23.json`;
const IOUNUT_LATEST_CODEX_PATH = `${FOREIGN_CODEX_DIR}/Iounut-Latests_OuronetCodex_2026-10-11_13-22-23.json`;

describe("detectCodexShapeVersion", () => {
  it("returns the string value when Codex_Shape_Version is present at the top level", () => {
    const raw = JSON.stringify({
      version: "1.3",
      Codex_Shape_Version: "1.0.0",
      kadenaWallets: [],
    });
    expect(detectCodexShapeVersion(raw)).toBe("1.0.0");
  });

  it("returns undefined on malformed JSON without throwing", () => {
    expect(() => detectCodexShapeVersion("{not json")).not.toThrow();
    expect(detectCodexShapeVersion("{not json")).toBeUndefined();
  });

  it("returns undefined when the parsed JSON is not an object (e.g. a bare number)", () => {
    expect(detectCodexShapeVersion("42")).toBeUndefined();
  });

  it("returns undefined when Codex_Shape_Version is present but not a string", () => {
    const raw = JSON.stringify({ Codex_Shape_Version: 123 });
    expect(detectCodexShapeVersion(raw)).toBeUndefined();
  });

  it("returns undefined for the REAL legacy file Ionut_OuronetCodex_2026-10-11_13-22-23.json (lacks the field)", () => {
    const raw = readFileSync(IONUT_CODEX_PATH, "utf-8");
    expect(detectCodexShapeVersion(raw)).toBeUndefined();
  });

  it("returns undefined for the REAL legacy file Iounut-Latests_OuronetCodex_2026-10-11_13-22-23.json (lacks the field)", () => {
    const raw = readFileSync(IOUNUT_LATEST_CODEX_PATH, "utf-8");
    expect(detectCodexShapeVersion(raw)).toBeUndefined();
  });
});

describe("formatCodexShapeVersionLabel", () => {
  it('formats a defined version as "v<version>"', () => {
    expect(formatCodexShapeVersionLabel("1.0.0")).toBe("v1.0.0");
  });

  it('formats undefined as the literal "Unversioned"', () => {
    expect(formatCodexShapeVersionLabel(undefined)).toBe("Unversioned");
  });
});
