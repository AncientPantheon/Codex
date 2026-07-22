/**
 * CODEC VERSION-GATE guard: the WRITER is pinned at "1.2"; the READER runs
 * ahead of it.
 *
 * The Codex backup-JSON codec lives in the PUBLISHED registry dist
 * `@ouronet/ouronet-core/codex` — it was NOT moved into this monorepo. As of
 * core 4.4.0 the codec `deserializeCodex` accepts BOTH "1.2" and "1.3", while
 * `buildCodexExport` still stamps "1.2".
 *
 * That asymmetry is the whole point, and it is what this guard protects:
 *
 *   - The WRITER must stay at "1.2" until the entire ecosystem reads "1.3".
 *     A writer running ahead produces backups this app's own siblings cannot
 *     open. That is the funds-loss direction.
 *   - The READER accepting "1.3" is not a leak, it is the prerequisite for a
 *     safe future bump. A reader narrower than the writer is the failure mode;
 *     a reader wider than the writer is the goal.
 *
 * This file used to assert the opposite — that "1.3" must throw — on the
 * premise that this scope pinned a frozen 1.2-only dist. Core 4.3.6/4.3.7
 * briefly shipped a 1.3 WRITER, which broke the ordering and is exactly what
 * this guard caught; 4.4.0 restored the writer to "1.2" and kept the widened
 * reader. The load-bearing assertion is therefore the writer case, not a
 * closed reader.
 *
 * The provenance check below still matters: the guard pins WHERE the codec
 * resolves from (published dist, not a mutable sibling working tree) before it
 * trusts what the codec does.
 */

import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { realpathSync, existsSync, readFileSync } from "node:fs";
import { sep, dirname, resolve, join } from "node:path";
import {
  deserializeCodex,
  serializeCodex,
  buildCodexExport,
} from "@ouronet/ouronet-core/codex";

// A well-formed "1.2" envelope: the four collection/settings fields the codec
// shape-validates, carrying identifiable values so the accept case can prove a
// real round-trip (not a bare "did not throw").
const WELL_FORMED_1_2 = {
  version: "1.2",
  exportedAt: "2026-07-04T00:00:00.000Z",
  kadenaWallets: [{ id: "kw-1" }],
  ouronetWallets: [{ id: "ow-1" }],
  addressBook: [{ alias: "friend" }],
  uiSettings: { theme: "dark", locale: "en" },
} as const;

describe("codec version-gate provenance (the guard's validity depends on this)", () => {
  it("resolves @ouronet/ouronet-core/codex to the published registry dist under this monorepo, not the stoa-js source tree", () => {
    // FAIL-VISIBLE C1 precondition: the whole guard is meaningless if the
    // package can't be located. The `./codex` subpath is `import`-only (no
    // `require`/`default` condition), so NEITHER `require.resolve` NOR vitest's
    // vite-node runner (which lacks `import.meta.resolve`) can resolve it. So we
    // resolve it deterministically from disk instead: find the installed
    // package (local or hoisted node_modules), read its exports["./codex"].import
    // target, and realpath it — exactly what a conformant resolver would land on.
    const here = dirname(fileURLToPath(import.meta.url));
    const pkgDir = [
      resolve(here, "../node_modules/@ouronet/ouronet-core"),
      resolve(here, "../../../node_modules/@ouronet/ouronet-core"),
    ].find((d) => existsSync(join(d, "package.json")));
    expect(pkgDir, "@ouronet/ouronet-core not found in node_modules").toBeTruthy();
    const codexTarget = JSON.parse(
      readFileSync(join(pkgDir as string, "package.json"), "utf8"),
    ).exports["./codex"].import as string;
    const real = realpathSync(resolve(pkgDir as string, codexTarget));

    // Must be the built dist (…/dist/codex/…), proving we read the shipped
    // artifact and not a `src/` file: link into a working tree.
    expect(real).toContain(`${sep}dist${sep}codex${sep}`);

    // HALT condition: if the realpath points into the sibling stoa-js source
    // tree, the guard is asserting frozen-ness against a file another
    // sub-program is free to mutate — a provenance violation. `src` under a
    // `stoa-js` path is the tell.
    const underStoaJsSource =
      real.includes(`${sep}stoa-js${sep}`) && real.includes(`${sep}src${sep}`);
    expect(
      underStoaJsSource,
      "codec provenance violation: guard is resolving mutated source, not the published dist",
    ).toBe(false);
  });
});

describe('frozen "1.2" codec version gate', () => {
  it("accepts a well-formed 1.2 envelope and round-trips its fields", () => {
    const json = JSON.stringify(WELL_FORMED_1_2);
    const out = deserializeCodex<
      { id: string },
      { id: string },
      { alias: string },
      { theme: string; locale: string }
    >(json);

    // Drive expectations from the input payload, not constants baked into the
    // assertion: if the codec dropped or mangled a field the round-trip breaks.
    expect(out.version).toBe("1.2");
    expect(out.kadenaWallets).toEqual(WELL_FORMED_1_2.kadenaWallets);
    expect(out.ouronetWallets).toEqual(WELL_FORMED_1_2.ouronetWallets);
    expect(out.addressBook).toEqual(WELL_FORMED_1_2.addressBook);
    expect(out.uiSettings).toEqual(WELL_FORMED_1_2.uiSettings);
  });

  it("round-trips serializeCodex / buildCodexExport output through deserializeCodex (the codec's own 1.2 writer feeds its reader)", () => {
    const codex = {
      kadenaWallets: [{ id: "kw-2" }],
      ouronetWallets: [{ id: "ow-2" }],
      pureKeypairs: [],
      addressBook: [{ alias: "self" }],
      uiSettings: { theme: "light" },
    };

    const built = buildCodexExport(codex as unknown as Parameters<typeof buildCodexExport>[0]);
    expect(built.version).toBe("1.2");

    const out = deserializeCodex(serializeCodex(codex as unknown as Parameters<typeof serializeCodex>[0]));
    expect(out.version).toBe("1.2");
    expect(out.kadenaWallets).toEqual(codex.kadenaWallets);
    expect(out.uiSettings).toEqual(codex.uiSettings);
  });

  // The reader is FORWARD-compatible on purpose: it accepts "1.3" even though
  // the writer still stamps "1.2". That ordering — reader widened first, writer
  // advanced later — is what makes a format bump safe, so a 1.3 file produced
  // by some other tool (or by a future writer) can already be restored here.
  //
  // This case previously asserted the opposite, that 1.3 must throw. That was
  // right while this scope pinned a 1.2-only dist, and wrong once the published
  // core widened its reader. What actually protects the invariant is the WRITER
  // assertion above (`built.version === "1.2"`), not a closed reader: a reader
  // narrower than the writer is the funds-loss direction, never the reverse.
  it("accepts a well-formed 1.3 envelope — the reader runs ahead of the writer", () => {
    const wire = JSON.stringify({ ...WELL_FORMED_1_2, version: "1.3" });
    const out = deserializeCodex(wire);
    expect(out.version).toBe("1.3");
    expect(out.kadenaWallets).toEqual(WELL_FORMED_1_2.kadenaWallets);
    expect(out.uiSettings).toEqual(WELL_FORMED_1_2.uiSettings);
  });

  // "1.3" is deliberately NOT in this table any more — see the accept case
  // above. Everything the codec genuinely does not understand must still be
  // rejected with the frozen message shape.
  const rejectedVersions: ReadonlyArray<[label: string, version: unknown]> = [
    ["1.1 (older format)", "1.1"],
    ["2.0 (future major)", "2.0"],
    ["missing/undefined", undefined],
    ["non-string number", 1.2],
  ];

  for (const [label, version] of rejectedVersions) {
    it(`hard-throws on version ${label} with the frozen "expected \\"1.2\\"" message`, () => {
      const payload: Record<string, unknown> = {
        kadenaWallets: [],
        ouronetWallets: [],
        addressBook: [],
        uiSettings: {},
      };
      if (version !== undefined) {
        payload.version = version;
      }
      const json = JSON.stringify(payload);

      // Pin the frozen message shape, not merely "some throw": the gate must
      // reject on the VERSION check ("expected \"1.2\"") and not incidentally
      // on a shape check, otherwise a future codec could stop version-gating
      // while this test still passed.
      expect(() => deserializeCodex(json)).toThrow(/unsupported version/);
      expect(() => deserializeCodex(json)).toThrow(/expected "1\.2"/);
    });
  }
});
