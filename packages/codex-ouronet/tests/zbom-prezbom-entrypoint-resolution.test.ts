/**
 * Every `entrypoint=` value used across the 3 ZBOM-launcher files resolves
 * against the REAL installed `@ouronet/talos-registry` (no mock) — so a
 * future chain rename that stops matching one of these keys fails this
 * suite, not a user's silently-broken tooltip.
 *
 * Covers both forms: a bare string literal (`entrypoint="..."`, the 8
 * not-yet-migrated launchers) and an imported `_KEY` constant
 * (`entrypoint={SOME_KEY}`, the 4 already-migrated Pythia launchers) — plus
 * the one dynamic case (`entrypoint={account.isSmart ? "..." : "..."}`,
 * OuronetAccountsTab's single Activate button, which resolves to one of TWO
 * entrypoints depending on runtime state — both literals inside that
 * expression are extracted and checked).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { tryGetEntrypoint, getPreview } from "@ouronet/talos-registry";
import { DEPLOY_API_KEY_KEY } from "../src/zbom/pythia/deployApiKey.js";
import { LINK_DUAL_API_KEY_KEY } from "../src/zbom/pythia/linkDualApiKey.js";
import { RENAME_DUAL_LANE_KEY, REVOKE_DUAL_LINK_KEY } from "../src/zbom/pythia/dualLinkOps.js";

const SRC = resolve(__dirname, "../src");
const FILES = [
  resolve(SRC, "ui/tabs/OuronetAccountsTab.tsx"),
  resolve(SRC, "ui/tabs/SingleApiPanel.tsx"),
  resolve(SRC, "ui/tabs/DualApiPanel.tsx"),
];

/** Every string literal appearing inside an `entrypoint="..."` or
 *  `entrypoint={...}` JSX attribute across the given source text. */
function extractEntrypointLiterals(source: string): string[] {
  const literals: string[] = [];
  const attrRe = /entrypoint=(?:"([^"]+)"|\{([^}]*)\})/g;
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(source))) {
    if (m[1]) {
      literals.push(m[1]);
    } else if (m[2]) {
      const inner = m[2];
      const strRe = /"([^"]+)"/g;
      let s: RegExpExecArray | null;
      while ((s = strRe.exec(inner))) literals.push(s[1]);
    }
  }
  return literals;
}

describe("Pre-ZBOM tooltip entrypoint resolution", () => {
  it("every entrypoint literal used across the 3 launcher files resolves against the live registry", () => {
    const literals = FILES.flatMap((f) => extractEntrypointLiterals(readFileSync(f, "utf8")));

    // The 8 not-yet-migrated launchers' literal keys, expected present.
    const expectedLiterals = [
      "TS01-C1.DALOS|C_RotateStoa",
      "TS01-C1.DALOS|C_RotateGuard",
      "TS01-C4.CODEX|C_ReleaseStoicTag",
      "TS01-C4.CODEX|C_RegisterStoicTag",
      "TS01-C1.DALOS|C_RotateSovereign",
      "TS01-C1.DALOS|C_RotateGovernor",
      "TS01-C1.DALOS|C_DeployStandardAccount",
      "TS01-C1.DALOS|C_DeploySmartAccount",
    ];
    for (const key of expectedLiterals) {
      expect(literals, `expected ${key} to appear as an entrypoint= literal`).toContain(key);
    }

    for (const literal of literals) {
      const ep = tryGetEntrypoint(literal);
      expect(ep, `entrypoint "${literal}" did not resolve`).not.toBeNull();
      // Registry drift can happen on EITHER side: the exec key itself going
      // stale (caught above), or its declared `preview` key going stale
      // while the exec key stays valid (PreZbomHint warns on this at runtime
      // via `warnUnresolvedPreviewOnce` — this pins it at build time too, so
      // it fails this suite rather than silently dropping the cost section).
      if (ep!.preview) {
        expect(
          getPreview(ep!.preview),
          `entrypoint "${literal}" declares preview "${ep!.preview}", which did not resolve`,
        ).not.toBeNull();
      }
    }
  });

  it("every imported registry-key constant used as an entrypoint= resolves against the live registry", () => {
    for (const key of [DEPLOY_API_KEY_KEY, LINK_DUAL_API_KEY_KEY, RENAME_DUAL_LANE_KEY, REVOKE_DUAL_LINK_KEY]) {
      const ep = tryGetEntrypoint(key);
      expect(ep, `entrypoint "${key}" did not resolve`).not.toBeNull();
      if (ep!.preview) {
        expect(
          getPreview(ep!.preview),
          `entrypoint "${key}" declares preview "${ep!.preview}", which did not resolve`,
        ).not.toBeNull();
      }
    }
  });
});
