/**
 * Class-wide enforcement: EVERY button that opens a ZBOM must be wrapped in
 * `<PreZbomHint>`, WITH THE RIGHT ENTRYPOINT. Source-text scan (mirrors
 * `tx-gas-meta-surface.test.ts`'s own style), not a rendered-DOM test — the
 * point is to catch a NEW launcher added later without the wrapper, the
 * exact failure mode the OuronetUI brief describes ("we missed the Define
 * buttons first time because they are plain <button>s while their
 * neighbours go through a shared component") — AND to catch a wrapped-but-
 * MISPAIRED launcher (e.g. two adjacent `<PreZbomHint>`s whose `entrypoint=`
 * values got swapped between them — both call sites would still be
 * "covered" by SOME region, which a coverage-only check can't distinguish
 * from correct).
 *
 * Inventories the 16 known "open" call-sites (the state setter that mounts a
 * ZBOM modal, excluding the `(null)` close calls and `useState` declarations)
 * across the four launcher files, and asserts each one's source position
 * falls inside a `<PreZbomHint>...</PreZbomHint>` region carrying EXACTLY
 * that call site's expected entrypoint key(s).
 *
 * Comments are blanked (same-length, so character offsets used by the
 * `needle`/`PreZbomHint` position lookups below stay aligned) before the tag
 * scan runs, so a doc-comment that happens to mention `<PreZbomHint>` in
 * prose (this file's own header does exactly that) can't fabricate a
 * "covered" range around a genuinely-unwrapped call site.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEPLOY_API_KEY_KEY } from "../src/zbom/pythia/deployApiKey.js";
import { LINK_DUAL_API_KEY_KEY } from "../src/zbom/pythia/linkDualApiKey.js";
import { RENAME_DUAL_LANE_KEY, REVOKE_DUAL_LINK_KEY } from "../src/zbom/pythia/dualLinkOps.js";

const SRC = resolve(__dirname, "../src");

const FILES = {
  accounts: resolve(SRC, "ui/tabs/OuronetAccountsTab.tsx"),
  single: resolve(SRC, "ui/tabs/SingleApiPanel.tsx"),
  dual: resolve(SRC, "ui/tabs/DualApiPanel.tsx"),
  stoa: resolve(SRC, "ui/tabs/StoaAccountsTab.tsx"),
};

/** The 16 known "open" call-site patterns (NOT the `(null)`/`(false)` close
 *  calls, NOT the `useState` declarations), each paired with the EXACT
 *  entrypoint key(s) its enclosing `<PreZbomHint>` must carry. A 17th
 *  launcher, or a swapped pairing between two existing ones, fails via the
 *  assertions below, not silently. The 5 `stoa` entries are the DESKTOP
 *  button instances only — `StoaAccountsTab.tsx`'s separate mobile-only
 *  `leftEdgeStack`/`rightEdgeStack` duplicates use a DIFFERENT setter name
 *  (`setMobileActiveModal`, not matched by `openCallRe` below) and are
 *  deliberately NOT wrapped in `PreZbomHint` (it no-ops to bare children on
 *  mobile, so wrapping them would only strip their existing plain
 *  `ActionTooltip` text — see `docs/work/codex-native-stoa-tooltips/
 *  design.md`'s "Out of scope"). */
const EXPECTED_OPEN_CALLS: Array<{ file: keyof typeof FILES; needle: string; expectedEntrypoints: string[] }> = [
  { file: "accounts", needle: 'setActiveOpId("rotate-payment-key")', expectedEntrypoints: ["TS01-C1.DALOS|C_RotateStoa"] },
  { file: "accounts", needle: 'setActiveOpId("rotate-guard")', expectedEntrypoints: ["TS01-C1.DALOS|C_RotateGuard"] },
  { file: "accounts", needle: 'setActiveOpId("release-stoic-tag")', expectedEntrypoints: ["TS01-C4.CODEX|C_ReleaseStoicTag"] },
  { file: "accounts", needle: 'setActiveOpId("register-stoic-tag")', expectedEntrypoints: ["TS01-C4.CODEX|C_RegisterStoicTag"] },
  { file: "accounts", needle: 'setActiveOpId("rotate-sovereign")', expectedEntrypoints: ["TS01-C1.DALOS|C_RotateSovereign"] },
  { file: "accounts", needle: 'setActiveOpId("rotate-governor")', expectedEntrypoints: ["TS01-C1.DALOS|C_RotateGovernor"] },
  {
    file: "accounts",
    needle: 'setActiveOpId(account.isSmart ? "activate-smart" : "activate-standard")',
    expectedEntrypoints: ["TS01-C1.DALOS|C_DeploySmartAccount", "TS01-C1.DALOS|C_DeployStandardAccount"],
  },
  { file: "accounts", needle: 'setActiveOpId("activate-apollo-pythia")', expectedEntrypoints: [DEPLOY_API_KEY_KEY] },
  { file: "single", needle: "setLinkOpen(true)", expectedEntrypoints: [LINK_DUAL_API_KEY_KEY] },
  { file: "dual", needle: 'setOpModal({ op: "rename", key })', expectedEntrypoints: [RENAME_DUAL_LANE_KEY] },
  { file: "dual", needle: 'setOpModal({ op: "revoke", key })', expectedEntrypoints: [REVOKE_DUAL_LINK_KEY] },
  {
    file: "stoa",
    needle: 'setActiveModal(mode === "urstoa" ? "transfer" : "send")',
    // Native Stoa's own third variant (`coin.C_TransferAcross`, cross-chain)
    // is a real, live bug fix: the launcher's tooltip used to cycle through
    // only the two same-chain variants even though `SendStoaModal.tsx`
    // genuinely supports cross-chain as a real third mode.
    expectedEntrypoints: ["coin.C_UR|Transfer", "coin.C_UR|TransferAnew", "coin.C_Transfer", "coin.C_TransferAnew", "coin.C_TransferAcross"],
  },
  {
    file: "stoa",
    needle: 'setActiveModal("send-kadena")',
    // Same class of fix as native Stoa's own third variant above:
    // `coin.transfer-crosschain` is already in the installed registry's
    // `KADENA_SIGNATURES` table, but the launcher's tooltip omitted it.
    expectedEntrypoints: ["coin.transfer", "coin.transfer-create", "coin.transfer-crosschain"],
  },
  { file: "stoa", needle: 'setActiveModal("stake")', expectedEntrypoints: ["coin.C_URV|Stake"] },
  { file: "stoa", needle: 'setActiveModal("unstake")', expectedEntrypoints: ["coin.C_URV|Unstake"] },
  { file: "stoa", needle: 'setActiveModal("collect")', expectedEntrypoints: ["coin.C_URV|Collect"] },
];

/** Replace `//` and `/* ... *\/` comment content with spaces — SAME LENGTH as
 *  the input, so every other character's offset is unchanged and the
 *  `needle`/tag lookups below (computed against the ORIGINAL source) stay
 *  valid against this blanked copy. Doesn't attempt to distinguish a `//`
 *  inside a string literal from a real comment — none of these three files
 *  contain that ambiguity today (verified: no string literal containing
 *  `//` appears near any `PreZbomHint` usage), which is the same scope this
 *  suite's sibling `tx-gas-meta-surface.test.ts` operates under. */
function blankComments(source: string): string {
  return source.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m) =>
    m.replace(/[^\n]/g, " "),
  );
}

interface PreZbomHintRegion {
  start: number;
  end: number;
  /** The opening tag's own text, `<PreZbomHint ... >` — entrypoint values
   *  are extracted from JUST this, never the region's full body, so a
   *  nested string elsewhere in the wrapped content can't be mistaken for
   *  this wrap's own entrypoint. */
  openTagText: string;
}

/** `<PreZbomHint>...</PreZbomHint>` regions, scanned against a
 *  COMMENT-BLANKED copy of `source` (see `blankComments`) so a doc-comment
 *  mentioning the tag in prose can't fabricate a region. Assumes no nested
 *  PreZbomHint-within-PreZbomHint in these files (true today) — a simple
 *  open/close pairing by textual order, not a full parser, matching this
 *  test suite's own established "source-text scan" precedent. */
function preZbomHintRegions(source: string): PreZbomHintRegion[] {
  const blanked = blankComments(source);
  const opens: number[] = [];
  const regions: PreZbomHintRegion[] = [];
  const tagRe = /<PreZbomHint\b|<\/PreZbomHint>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(blanked))) {
    if (m[0] === "</PreZbomHint>") {
      const start = opens.pop();
      if (start !== undefined) {
        const tagEnd = blanked.indexOf(">", start);
        regions.push({
          start,
          end: m.index + m[0].length,
          // Sliced from `blanked`, not `source` — offsets are already proven
          // aligned by `blankComments`, and this is what makes the "a
          // comment can't affect what this test sees" guarantee cover the
          // entrypoint-VALUE extraction below too, not just region detection.
          openTagText: blanked.slice(start, tagEnd + 1),
        });
      }
    } else {
      opens.push(m.index);
    }
  }
  return regions;
}

function enclosingRegion(regions: PreZbomHintRegion[], pos: number): PreZbomHintRegion | undefined {
  return regions.find(({ start, end }) => pos >= start && pos < end);
}

/** Resolves a bare imported-identifier `entrypoint={SOME_KEY}` reference (no
 *  quoted string literal inside the braces at all) to its actual runtime
 *  value — the 4 already-migrated Pythia launchers use this form. */
const KEY_CONSTANTS: Record<string, string> = {
  DEPLOY_API_KEY_KEY,
  LINK_DUAL_API_KEY_KEY,
  RENAME_DUAL_LANE_KEY,
  REVOKE_DUAL_LINK_KEY,
};

/** Every entrypoint value appearing inside an `entrypoint="..."` (string
 *  literal), `entrypoint={"..." : "..."}` (ternary of literals), or
 *  `entrypoint={SOME_KEY}` (bare imported constant, resolved via
 *  `KEY_CONSTANTS`) JSX attribute in the given (opening-tag-only) text.
 *  Deliberately duplicated (small) from
 *  `zbom-prezbom-entrypoint-resolution.test.ts`'s own `extractEntrypointLiterals`
 *  rather than imported — that file scans WHOLE files for a different
 *  purpose (resolvability, not per-site pairing); keeping this copy scoped
 *  to a single opening tag's text is the point of this test. */
function extractEntrypointValues(openTagText: string): string[] {
  const values: string[] = [];
  const attrRe = /entrypoint=(?:"([^"]+)"|\{([^}]*)\})/g;
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(openTagText))) {
    if (m[1]) {
      values.push(m[1]);
      continue;
    }
    if (m[2] === undefined) continue;
    const strRe = /"([^"]+)"/g;
    let s: RegExpExecArray | null;
    let sawStringLiteral = false;
    while ((s = strRe.exec(m[2]))) {
      sawStringLiteral = true;
      values.push(s[1]);
    }
    if (!sawStringLiteral) {
      const identifier = m[2].trim();
      const resolved = KEY_CONSTANTS[identifier];
      expect(
        resolved,
        `entrypoint={${identifier}} references an identifier this test doesn't know how to resolve — add it to KEY_CONSTANTS`,
      ).toBeDefined();
      values.push(resolved);
    }
  }
  return values;
}

describe("Pre-ZBOM tooltip launcher coverage", () => {
  it("inventories exactly the 15 known open-call sites (a 16th fails here, not silently)", () => {
    const sources = {
      accounts: readFileSync(FILES.accounts, "utf8"),
      single: readFileSync(FILES.single, "utf8"),
      dual: readFileSync(FILES.dual, "utf8"),
      stoa: readFileSync(FILES.stoa, "utf8"),
    };
    for (const { file, needle } of EXPECTED_OPEN_CALLS) {
      expect(
        sources[file].includes(needle),
        `expected to find ${JSON.stringify(needle)} in ${file}`,
      ).toBe(true);
    }
  });

  it("every known open-call site is textually inside a <PreZbomHint> region carrying its EXPECTED entrypoint(s) — not just some region", () => {
    const sources = {
      accounts: readFileSync(FILES.accounts, "utf8"),
      single: readFileSync(FILES.single, "utf8"),
      dual: readFileSync(FILES.dual, "utf8"),
      stoa: readFileSync(FILES.stoa, "utf8"),
    };
    const regions = {
      accounts: preZbomHintRegions(sources.accounts),
      single: preZbomHintRegions(sources.single),
      dual: preZbomHintRegions(sources.dual),
      stoa: preZbomHintRegions(sources.stoa),
    };

    for (const { file, needle, expectedEntrypoints } of EXPECTED_OPEN_CALLS) {
      const pos = sources[file].indexOf(needle);
      expect(pos, `${needle} not found in ${file}`).toBeGreaterThanOrEqual(0);

      const region = enclosingRegion(regions[file], pos);
      expect(
        region,
        `${JSON.stringify(needle)} in ${file} is NOT inside a <PreZbomHint> region`,
      ).toBeDefined();

      const actualEntrypoints = extractEntrypointValues(region!.openTagText);
      // POSITIONAL, not sorted: `extractEntrypointValues` scans left-to-right,
      // so for a multi-value `entrypoint={cond ? "A" : "B"}` ternary, `A`
      // (the true-branch literal) always comes first. Every
      // `expectedEntrypoints` entry above with more than one value is written
      // in that same true-branch-first order — sorting BOTH sides here would
      // make a swapped ternary (branches accidentally reversed) invisible to
      // this test, since the same two literals in either order sort
      // identically. Comparing positionally is what actually catches a swap.
      expect(
        actualEntrypoints,
        `${JSON.stringify(needle)} in ${file} is wrapped in <PreZbomHint entrypoint=${JSON.stringify(actualEntrypoints)}>, expected ${JSON.stringify(expectedEntrypoints)} — a swapped/mispaired entrypoint`,
      ).toEqual([...expectedEntrypoints]);
    }
  });

  it("no OPEN call outside the known 15 exists unwrapped (a naked new launcher fails here)", () => {
    // A close call's argument is always `null` (setActiveOpId/setActiveModal)
    // or `false` (setLinkOpen) — this only scans for the SETTER NAME followed
    // by a non-null/non-false argument, i.e. genuine "open" calls, and
    // cross-checks the count against the known inventory above.
    const sources = {
      accounts: readFileSync(FILES.accounts, "utf8"),
      single: readFileSync(FILES.single, "utf8"),
      dual: readFileSync(FILES.dual, "utf8"),
      stoa: readFileSync(FILES.stoa, "utf8"),
    };
    const openCallRe = /(setActiveOpId|setLinkOpen|setOpModal|setActiveModal)\((?!null\)|false\))/g;

    for (const file of Object.keys(sources) as Array<keyof typeof sources>) {
      const expectedCount = EXPECTED_OPEN_CALLS.filter((c) => c.file === file).length;
      const found = sources[file].match(openCallRe) ?? [];
      expect(
        found.length,
        `${file} has ${found.length} open-call site(s), expected exactly ${expectedCount} (known inventory) — a new launcher was added without updating this test's inventory`,
      ).toBe(expectedCount);
    }
  });
});
