/**
 * The ArWeave restore surface, and the two gaps that remain around it.
 *
 * Context measured this session: the dual-source envelope is BUILT — every
 * backup wraps its two data keys under both the Master Seed and the Codex
 * Stoic Identity's Standard-Apollo half, and posts four tags saying so. What
 * was missing is smaller than it looks and larger than it looks at once:
 *
 *   1. the restore function existed but was exported from NOTHING  -> fixed here
 *   2. the identity can DECRYPT but not LOCATE a backup             -> open
 *   3. no backup records WHICH codex it belongs to                  -> open, and
 *      blocked on an owner privacy decision, not on effort
 *
 * Gaps 2 and 3 are pinned below as executable facts rather than prose, so a
 * future change cannot half-fix them silently — each test says what would
 * have to become true for it to flip.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// Imported from `library/flow.js`, NOT the package index: the index also
// re-exports `SqliteLibraryStore`, whose `node:sqlite` import vite cannot
// bundle for the jsdom environment (the same pre-existing limitation that
// keeps `e3-library-store.test.ts` from loading). The runtime values come
// from the module that defines them; that the BARRELS re-export them — which
// is the actual subject of this suite — is asserted over their source below.
import {
  restoreCodexFromBackupEnvelope,
  determineBackupSourceRouting,
  BackupPinRequiredError,
  BackupSourceNotUsedError,
} from "../src/library/flow.js";

describe("the restore surface is reachable", () => {
  it("exports the restore entry point from BOTH barrels", () => {
    // Before this topic it was defined in library/flow.ts and exported from
    // no barrel at all, so no restore flow could be written against it.
    expect(typeof restoreCodexFromBackupEnvelope).toBe("function");
    const libBarrel = readFileSync(join(__dirname, "../src/library/index.ts"), "utf8");
    const pkgIndex = readFileSync(join(__dirname, "../src/index.ts"), "utf8");
    for (const barrel of [libBarrel, pkgIndex]) {
      expect(barrel).toMatch(/restoreCodexFromBackupEnvelope/);
      expect(barrel).toMatch(/determineBackupSourceRouting/);
      expect(barrel).toMatch(/BackupPinRequiredError/);
      expect(barrel).toMatch(/BackupSourceNotUsedError/);
      expect(barrel).toMatch(/BackupUnlockSource/);
    }
  });

  it("exports the routing helper a caller needs to decide PIN vs default", () => {
    expect(typeof determineBackupSourceRouting).toBe("function");
  });

  it("exports both refusal types, so a UI can tell the two apart", () => {
    // "you need a PIN" and "this source was never used to wrap this backup"
    // are different problems and must not collapse into one error.
    expect(typeof BackupPinRequiredError).toBe("function");
    expect(typeof BackupSourceNotUsedError).toBe("function");
    expect(new BackupPinRequiredError("standardApollo").source).toBe("standardApollo");
    expect(new BackupSourceNotUsedError("masterSeed").source).toBe("masterSeed");
  });
});

describe("GAP: the Stoic Identity can unlock a backup, but cannot find one", () => {
  it("offers exactly two unlock sources, and both are UNLOCK keys", () => {
    // `BackupUnlockSource` is a decrypt-side concept only. Locating a backup
    // means querying ArWeave by owner address, and that address derives from
    // the Master Seed's ArWeave account at index 0 — never from the identity.
    //
    // THIS TEST FLIPS when a lookup path is added: a third source, or a
    // locator that takes an identity, would both land here first.
    const flow = readFileSync(join(__dirname, "../src/library/flow.ts"), "utf8");
    const decl = /export type BackupUnlockSource\s*=\s*([^;]+);/.exec(flow);
    expect(decl, "BackupUnlockSource should still be declared in flow.ts").toBeTruthy();
    const members = (decl![1] ?? "")
      .split("|")
      .map((m) => m.trim().replace(/['"]/g, ""))
      .filter(Boolean);
    expect(members.sort()).toEqual(["masterSeed", "standardApollo"]);
  });
});

describe("GAP: no backup records which codex it belongs to", () => {
  it("the export payload carries no codexIdentity, so Codex-App-Id is never written", () => {
    // `deriveBackupLineage` sets the `Codex-App-Id` tag from
    // `codexIdentity.formatted`, but `buildBackupPayload` never emits
    // `codexIdentity` — a deliberate privacy decision (codec.ts). The tag is
    // therefore dead in the real app path, which means an identity-based
    // lookup would have nothing to match on even if it existed.
    //
    // THIS TEST FLIPS the moment the payload starts carrying an identity, at
    // which point the privacy decision below has been made and should be
    // recorded in docs/work/arweave-identity-restore/plan.md.
    const hook = readFileSync(
      join(__dirname, "../../codex-ui/src/hooks/useCodexBackup.ts"),
      "utf8",
    );
    const start = hook.indexOf("function buildBackupPayload");
    expect(start).toBeGreaterThan(-1);
    const body = hook.slice(start, hook.indexOf("\n}", start));
    expect(body).not.toMatch(/\bcodexIdentity\s*:/);
  });

  it("deriveBackupLineage still READS codexIdentity, so wiring it is a one-line change", () => {
    // Worth pinning: the consumer side is already built and waiting. The
    // decision is whether to feed it, not whether to write it.
    const flow = readFileSync(join(__dirname, "../src/library/flow.ts"), "utf8");
    expect(flow).toMatch(/function deriveBackupLineage/);
    expect(flow).toMatch(/codexIdentity/);
  });
});
