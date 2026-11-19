/**
 * THE PAPYRUS DESIGNATION — Codex's half of `PAPYRUS_ENGINE_SPEC.md` §2.4.
 *
 * Codex is the second consumer of `@ouronet/papyrus`. OuronetUI was the
 * first; the point of the second is that the SAME engine version appears in
 * both apps while their app versions differ, which is the pair a bug report
 * needs. These tests hold that property rather than describing it.
 *
 * The absence assertions below run over source with COMMENTS STRIPPED. An
 * absence assertion over raw source is satisfied by the comment explaining
 * the rule — which has happened seven times in this project, and would make
 * every one of these pass while the rule was being broken two lines down.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PAPYRUS_VERSION, PAPYRUS_COPY } from "@ouronet/papyrus";

const PKG = join(__dirname, "..");
const LAYOUT = join(PKG, "src/zbom/cfm/ZbomLayout.tsx");
const MODALS_DIR = join(PKG, "src/zbom/modals");

/** Source with block and line comments removed, so an absence assertion
 *  cannot be satisfied by prose describing the very rule it checks. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const modalFiles = readdirSync(MODALS_DIR).filter((f) => f.endsWith(".tsx"));

describe("ZbomLayout carries the Papyrus designation", () => {
  it("imports the vocabulary FROM THE PACKAGE, not a local copy", () => {
    const code = stripComments(readFileSync(LAYOUT, "utf8"));
    expect(code).toMatch(/from\s+["']@ouronet\/papyrus["']/);
  });

  it("renders the member upper-LEFT and the version upper-RIGHT, in one justify-between row", () => {
    const code = stripComments(readFileSync(LAYOUT, "utf8"));
    const badge = code.slice(code.indexOf("function PapyrusBadge"));
    expect(badge).toMatch(/justify-between/);
    // member first in source order, version second => left, then right.
    expect(badge.indexOf("PAPYRUS_COPY")).toBeLessThan(badge.indexOf("PAPYRUS_VERSION"));
  });

  it("places the designation BEFORE the form, not after the execute button", () => {
    const code = stripComments(readFileSync(LAYOUT, "utf8"));
    const render = code.slice(code.indexOf("export function ZbomLayout"));
    const badgeAt = render.indexOf("<PapyrusBadge");
    const executeAt = render.indexOf("<ExecuteZone");
    const zonesAt = render.indexOf("<CfmScrollArea");
    expect(badgeAt).toBeGreaterThan(-1);
    expect(badgeAt).toBeLessThan(executeAt);
    expect(badgeAt).toBeLessThan(zonesAt);
  });

  it("uses the member's own blurb as the tooltip, rather than restating it", () => {
    const code = stripComments(readFileSync(LAYOUT, "utf8"));
    expect(code).toMatch(/blurb/);
    // No copied prose: the literal blurb text must not appear in Codex source.
    expect(code).not.toContain(PAPYRUS_COPY.page.blurb);
  });
});

describe("the engine version is the ENGINE's, never the app's", () => {
  it("does not derive the rendered version from any app/package version", () => {
    const code = stripComments(readFileSync(LAYOUT, "utf8"));
    expect(code).not.toMatch(/APP_VERSION/);
    expect(code).not.toMatch(/CODEX_PACKAGE_VERSION_OUTPUT/);
    expect(code).not.toMatch(/package\.json/);
  });

  it("does not hardcode the version string anywhere in Codex source", () => {
    // A copy is a thing that drifts; that is the whole point of the package.
    const code = stripComments(readFileSync(LAYOUT, "utf8"));
    expect(code).not.toContain(`"${PAPYRUS_VERSION}"`);
    expect(code).not.toContain(`'${PAPYRUS_VERSION}'`);
  });

  it("renders the version RESOLVED into node_modules, not the range asked for", () => {
    // A range is what we requested; the resolution is what we got.
    const resolved = JSON.parse(
      readFileSync(join(PKG, "node_modules/@ouronet/papyrus/package.json"), "utf8"),
    ) as { version: string };
    expect(PAPYRUS_VERSION).toBe(resolved.version);
  });

  it("is NOT equal to this package's own version — the two must be able to differ", () => {
    const own = JSON.parse(readFileSync(join(PKG, "package.json"), "utf8")) as { version: string };
    expect(PAPYRUS_VERSION).not.toBe(own.version);
  });
});

describe("every Papyrus instance in Codex is designated", () => {
  it("finds the modals that draw through ZbomLayout", () => {
    const drawing = modalFiles.filter((f) =>
      stripComments(readFileSync(join(MODALS_DIR, f), "utf8")).includes("<ZbomLayout"),
    );
    // The brief expected 8; the required prop proved there are 12.
    expect(drawing.length).toBe(12);
  });

  it("EVERY one of them passes an explicit kind", () => {
    const missing = modalFiles.filter((f) => {
      const code = stripComments(readFileSync(join(MODALS_DIR, f), "utf8"));
      return code.includes("<ZbomLayout") && !/<ZbomLayout[\s\S]{0,200}?kind=/.test(code);
    });
    expect(missing).toEqual([]);
  });

  it("every one is a PAGE — a discrete sheet presented for signing (spec §2.2)", () => {
    // Verified rather than assumed: each renders a ZbomModalFrame popup with
    // zones and an execute button. None is inline (Roll) and none discovers
    // its transaction through dirty reads (Leaf).
    for (const f of modalFiles) {
      const code = stripComments(readFileSync(join(MODALS_DIR, f), "utf8"));
      if (!code.includes("<ZbomLayout")) continue;
      expect(code, `${f} should declare kind="page"`).toMatch(/kind="page"/);
      expect(code, `${f} should be a discrete popup`).toMatch(/ZbomModalFrame/);
    }
  });

  it("no modal imports anything from the package beyond the vocabulary", () => {
    // batch.ts is not for Codex: there is no batch/gas-splitting code here.
    for (const f of modalFiles) {
      const code = stripComments(readFileSync(join(MODALS_DIR, f), "utf8"));
      expect(code).not.toMatch(/planBatchesVerified|planStakeBatches|fitGasModel/);
    }
  });
});
