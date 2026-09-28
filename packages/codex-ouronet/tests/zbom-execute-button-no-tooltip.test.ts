/**
 * The ZBOM's own EXECUTE button must never carry a hover tooltip. Owner
 * ruling (restated after a live regression — a screenshot showed
 * `ExecutionTooltip` hovering the green "Release StoicTag" execute button,
 * drawing over the modal it was meant to annotate): inside an open ZBOM the
 * information is already on the page — Zone 2 lists every parameter with
 * its declared type, the INFO panel shows the live cost. A tooltip there is
 * a duplicate that occludes the thing it duplicates. The pre-open tooltip
 * (`PreZbomHint`, on the LAUNCHER) exists precisely so nothing needs to
 * duplicate that information once the modal is already open.
 *
 * Source-text scan (mirrors this suite's own `tx-gas-meta-surface.test.ts`
 * style): `ZbomLayout.tsx`'s `ExecuteZone` must never import or reference
 * `ExecutionTooltip`/`ExecutionSpec` at all — the feature was removed
 * entirely, not merely left unused, so a future re-add is caught here
 * rather than silently reintroducing the bug.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const SRC = resolve(__dirname, "../src");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

describe("ZBOM execute button — no hover tooltip", () => {
  it("ZbomLayout.tsx does not import or reference ExecutionTooltip/ExecutionSpec at all", () => {
    const source = readFileSync(resolve(SRC, "zbom/cfm/ZbomLayout.tsx"), "utf8");
    expect(source).not.toMatch(/ExecutionTooltip/);
    expect(source).not.toMatch(/ExecutionSpec/);
    expect(source).not.toMatch(/executionSpec/);
  });

  it("no file anywhere in src passes an executionSpec prop to ZbomLayout's executeButton (the removed feature can't be silently reintroduced from ANY caller, wherever it's later added)", () => {
    // Whole `src` tree, not just `zbom/modals/` — a future ZbomLayout caller
    // could legitimately live somewhere else (a new feature directory, a
    // relocated modal), and this guard must still catch it there.
    const allFiles = walk(SRC);
    // `\bexecutionSpec\b` (word-boundary, no trailing colon requirement) also
    // catches a shorthand-property reintroduction (`{ ...rest, executionSpec }`),
    // not just the object-literal-key form (`executionSpec: {...}`) the
    // narrower `executionSpec\s*:` pattern would miss. Confirmed the lowercase
    // token doesn't appear anywhere in src today (only the capitalized
    // `ExecutionSpec` TYPE name does, in ExecutionTooltip.tsx/Zone2Wrapper.tsx/
    // PreZbomHint.tsx's doc comment — a case-sensitive `\b` regex doesn't
    // match those), so this scan has zero legitimate exclusions to carve out.
    for (const file of allFiles) {
      const source = readFileSync(file, "utf8");
      expect(source, `${file} still references executionSpec`).not.toMatch(/\bexecutionSpec\b/);
    }
  });
});
