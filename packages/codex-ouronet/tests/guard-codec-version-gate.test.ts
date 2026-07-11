/**
 * FROZEN "1.2" CODEC VERSION-GATE guard.
 *
 * The Codex backup-JSON codec lives in the PUBLISHED registry dist
 * `@stoachain/ouronet-core/codex` (4.3.6) — it was NOT moved into this
 * monorepo. Its gate is frozen: `deserializeCodex` accepts ONLY
 * `version:"1.2"` and hard-throws on anything else. This guard asserts that
 * frozen behavior stays frozen. It does NOT widen the codec or add a "1.3"
 * path — that is a later sub-program's work on the SOURCE codec, not here.
 *
 * Why this guard's provenance matters: a later sub-program widens the codec
 * SOURCE (in the sibling stoa-js working tree) to accept "1.3". If this
 * guard ever resolved that mutable source instead of the published dist, its
 * "1.3-must-throw" case would silently invert and stop protecting the C-scope
 * "codec frozen at 1.2" invariant. So the guard first pins WHERE the codec
 * resolves from before it trusts what the codec does.
 */

import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { realpathSync, existsSync, readFileSync } from "node:fs";
import { sep, dirname, resolve, join } from "node:path";
import {
  deserializeCodex,
  serializeCodex,
  buildCodexExport,
} from "@stoachain/ouronet-core/codex";

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
  it("resolves @stoachain/ouronet-core/codex to the published registry dist under this monorepo, not the stoa-js source tree", () => {
    // FAIL-VISIBLE C1 precondition: the whole guard is meaningless if the
    // package can't be located. The `./codex` subpath is `import`-only (no
    // `require`/`default` condition), so NEITHER `require.resolve` NOR vitest's
    // vite-node runner (which lacks `import.meta.resolve`) can resolve it. So we
    // resolve it deterministically from disk instead: find the installed
    // package (local or hoisted node_modules), read its exports["./codex"].import
    // target, and realpath it — exactly what a conformant resolver would land on.
    const here = dirname(fileURLToPath(import.meta.url));
    const pkgDir = [
      resolve(here, "../node_modules/@stoachain/ouronet-core"),
      resolve(here, "../../../node_modules/@stoachain/ouronet-core"),
    ].find((d) => existsSync(join(d, "package.json")));
    expect(pkgDir, "@stoachain/ouronet-core not found in node_modules").toBeTruthy();
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

  // Every non-"1.2" version discriminator MUST be rejected with the frozen
  // message shape. "1.3" is the load-bearing case: it is the format a later
  // sub-program teaches the SOURCE codec to accept, and the frozen C-scope dist
  // MUST still reject it — proving no 1.3 widening leaked into this scope.
  const rejectedVersions: ReadonlyArray<[label: string, version: unknown]> = [
    ["1.1 (older format)", "1.1"],
    ["1.3 (D-phase format — must STILL be rejected here)", "1.3"],
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
