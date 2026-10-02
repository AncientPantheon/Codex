/**
 * Regression: `CodexBackupArea` needs a LIVE `getExportJson()` getter, not a
 * static `exportJson` string captured at whatever render produced the panel
 * deps — otherwise a codex backup silently uploads a stale snapshot instead
 * of the codex's CURRENT state at the moment the user actually clicks
 * confirm.
 *
 * Pins the app-side wiring of that getter through the three seams that used
 * to carry the stale static string:
 *   - `buildRealPanelDeps` — real mode's "not wired" refusal now names
 *     `getExportJson`, and the getter it exposes on `ArweavePanelDeps` is the
 *     SAME function object the caller supplied (never re-wrapped into a
 *     value snapshotted at build time).
 *   - `buildMockPanelDeps` — same identity/threading discipline, mock mode.
 *   - `buildArweaveWiring` — threads `getExportJson`/`onBackupSuccess`
 *     through to `panelDeps` in BOTH the real and mock branches.
 */
import { describe, it, expect, vi } from "vitest";
import { encryptStringV2 } from "@stoachain/stoa-core/crypto";
import type { ForeignKeyEntry } from "@ancientpantheon/codex-core";
import { ARWEAVE_CHAIN_ID } from "@ancientpantheon/codex-arweave/address-book";
// Type-only — gives the hoisted `uploadAndTrackMock` below the REAL
// `uploadAndTrack`'s own (params, opts) => Promise<UploadResult |
// UploadBundleResult> shape, so `.mock.calls[0]` actually has a `[0]` to
// destructure and `mockResolvedValueOnce` accepts the bundle shape too —
// without this, `vi.fn(async () => ({ id, status }))`'s own INFERRED
// zero-arg, single-shape type was all either call site had to type-check
// against.
import type { uploadAndTrack as RealUploadAndTrack } from "@ancientpantheon/codex-arweave";
import { buildRealPanelDeps } from "../src/realArweaveAdapter";
import { buildMockPanelDeps } from "../src/mockArweaveAdapter";
import {
  buildArweaveWiring,
  ARWEAVE_WIRING_MODE_MOCK,
  ARWEAVE_WIRING_MODE_REAL,
} from "../src/ForeignChainsWiring";

// Network-touching seams `bufferedFeeCap`/`backupCodexToLibrary` reach for in
// `buildRealPanelDeps().backupCodex` — faked at the MODULE boundary (mirrors
// `arweave-restore-eligibility-wiring.test.ts`'s own convention) so the
// "owner address actually resolves to the codex's one configured key" spec
// below exercises the REAL `buildArweaveWiring` -> `buildRealPanelDeps` ->
// `findEntryForAddress` composition without touching a live gateway. Every
// OTHER test in this file drives either mock-mode's self-contained
// `backupCodex` (never imports these real functions) or only the
// `getExportJson` getter itself (never calls `backupCodex` far enough to
// reach them), so mocking them here does not change those tests' behavior.
// The two fake shapes this file's tests actually resolve `uploadAndTrackMock`
// with — the classic single-file `{ id, status }` placeholder (never the real
// `UploadResult`'s `ownerAddress`/`itemId`/`tags`, which these tests never
// assert on) and T7's bundle `{ manifestId, fileIds, uploadId }`. Kept as its
// own loose local type rather than the real `UploadAndTrackResult` so the
// fake's simpler shape doesn't fight the real library type it stands in for.
type FakeUploadAndTrackResult =
  | { id: string; status: string }
  | { manifestId: string; fileIds: { path: string; id: string }[]; uploadId: string };

const { backupCodexToLibraryMock, uploadAndTrackMock } = vi.hoisted(() => {
  return {
    backupCodexToLibraryMock: vi.fn(async () => ({ id: "fake-backup-id" })),
    uploadAndTrackMock: vi.fn(
      async (..._args: Parameters<typeof RealUploadAndTrack>): Promise<FakeUploadAndTrackResult> => ({
        id: "fake-upload-id",
        status: "pending",
      }),
    ),
  };
});
vi.mock("@ancientpantheon/arweave-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ancientpantheon/arweave-core")>();
  return { ...actual, estimateFee: vi.fn(async () => 1_000_000n) };
});
vi.mock("@ancientpantheon/codex-arweave", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ancientpantheon/codex-arweave")>();
  return {
    ...actual,
    backupCodexToLibrary: backupCodexToLibraryMock,
    uploadAndTrack: uploadAndTrackMock,
  };
});

describe("buildRealPanelDeps — getExportJson wiring", () => {
  it("backupCodex refuses with a clear error naming getExportJson when it was never wired", async () => {
    const deps = buildRealPanelDeps({ gatewayUrl: "https://arweave.example.invalid" });
    await expect(deps.backupCodex("{}")).rejects.toThrow(/getExportJson/);
  });

  it("exposes the SAME getExportJson function object the caller supplied — never re-wrapped into a value snapshotted at build time", async () => {
    const getExportJson = vi.fn(async () => '{"live":"state"}');
    const deps = buildRealPanelDeps({
      gatewayUrl: "https://arweave.example.invalid",
      getExportJson,
    });
    await expect(deps.getExportJson()).resolves.toBe('{"live":"state"}');
    expect(getExportJson).toHaveBeenCalledTimes(1);
  });
});

describe("buildMockPanelDeps — getExportJson wiring", () => {
  it("threads a caller-supplied getExportJson through instead of always resolving the fixed mock placeholder", async () => {
    const getExportJson = vi.fn(async () => '{"live":"mock-state"}');
    const deps = buildMockPanelDeps({ getExportJson });
    await expect(deps.getExportJson()).resolves.toBe('{"live":"mock-state"}');
  });

  it("falls back to a deterministic placeholder when the caller supplies no getExportJson", async () => {
    const deps = buildMockPanelDeps();
    await expect(deps.getExportJson()).resolves.toEqual(expect.any(String));
  });
});

describe("buildArweaveWiring — getExportJson/onBackupSuccess threading", () => {
  it("mock mode: threads getExportJson through to panelDeps and calls onBackupSuccess after a successful backup", async () => {
    const getExportJson = vi.fn(async () => '{"live":"wired"}');
    const onBackupSuccess = vi.fn();
    const { panelDeps } = buildArweaveWiring({
      mode: ARWEAVE_WIRING_MODE_MOCK,
      getExportJson,
      onBackupSuccess,
    });

    await expect(panelDeps.getExportJson()).resolves.toBe('{"live":"wired"}');
    await panelDeps.backupCodex(await panelDeps.getExportJson());
    expect(onBackupSuccess).toHaveBeenCalledTimes(1);
  });

  it("real mode: threads getExportJson through to panelDeps (the real-mode refusal is disarmed once wired)", async () => {
    const getExportJson = vi.fn(async () => '{"live":"real-wired"}');
    const { panelDeps } = buildArweaveWiring({
      mode: ARWEAVE_WIRING_MODE_REAL,
      gatewayUrl: "https://arweave.example.invalid",
      getExportJson,
    });

    await expect(panelDeps.getExportJson()).resolves.toBe('{"live":"real-wired"}');
  });
});

/**
 * `arweave-non-removable-account` T5: the same identity/threading discipline
 * as `getExportJson` above, for `ArweavePanelDeps.onAccountUsedForEncryption`
 * (T4's dead-letter-closing signal — fired by the real `UploadWizard` mount
 * once an Encrypted upload succeeds). The HOST APP is responsible for
 * pointing this at `codex-ouronet`'s `markOuroAccountEncryptedArweaveUpload`
 * store action (design.md: "the HOST APP ... is responsible for pointing
 * this at a real codex-ouronet store action that flips the new field").
 * These tests pin that the seam actually REACHES `panelDeps` unchanged in
 * both wiring modes — the full real-store proof (the real action flips the
 * real `IOuroAccount.hasEncryptedArweaveUpload` flag, driven through the
 * real `ForeignChainsWiring` → `ArweavePanel` → `UploadWizard` mount) lives
 * in `e5-foreign-chains-mock.test.tsx`, which already owns the full-tree
 * CodexProvider harness this seam needs.
 */
describe("buildRealPanelDeps — onAccountUsedForEncryption wiring", () => {
  it("exposes the SAME onAccountUsedForEncryption function object the caller supplied — never re-wrapped into a value snapshotted at build time", () => {
    const onAccountUsedForEncryption = vi.fn();
    const deps = buildRealPanelDeps({
      gatewayUrl: "https://arweave.example.invalid",
      onAccountUsedForEncryption,
    });

    deps.onAccountUsedForEncryption?.("ouro-account-under-test");
    expect(onAccountUsedForEncryption).toHaveBeenCalledWith("ouro-account-under-test");
    expect(onAccountUsedForEncryption).toHaveBeenCalledTimes(1);
  });

  it("leaves onAccountUsedForEncryption undefined when the caller wires none — never a synthesized no-op the panel would believe is a real signal", () => {
    const deps = buildRealPanelDeps({ gatewayUrl: "https://arweave.example.invalid" });
    expect(deps.onAccountUsedForEncryption).toBeUndefined();
  });
});

describe("buildMockPanelDeps — onAccountUsedForEncryption wiring", () => {
  it("threads a caller-supplied onAccountUsedForEncryption through unchanged", () => {
    const onAccountUsedForEncryption = vi.fn();
    const deps = buildMockPanelDeps({ onAccountUsedForEncryption });

    deps.onAccountUsedForEncryption?.("ouro-account-under-test");
    expect(onAccountUsedForEncryption).toHaveBeenCalledWith("ouro-account-under-test");
  });

  it("leaves onAccountUsedForEncryption undefined when the caller supplies none", () => {
    const deps = buildMockPanelDeps();
    expect(deps.onAccountUsedForEncryption).toBeUndefined();
  });
});

describe("buildArweaveWiring — onAccountUsedForEncryption threading", () => {
  it("mock mode: threads onAccountUsedForEncryption through to panelDeps", () => {
    const onAccountUsedForEncryption = vi.fn();
    const { panelDeps } = buildArweaveWiring({
      mode: ARWEAVE_WIRING_MODE_MOCK,
      onAccountUsedForEncryption,
    });

    panelDeps.onAccountUsedForEncryption?.("ouro-account-under-test");
    expect(onAccountUsedForEncryption).toHaveBeenCalledWith("ouro-account-under-test");
  });

  it("real mode: threads onAccountUsedForEncryption through to panelDeps", () => {
    const onAccountUsedForEncryption = vi.fn();
    const { panelDeps } = buildArweaveWiring({
      mode: ARWEAVE_WIRING_MODE_REAL,
      gatewayUrl: "https://arweave.example.invalid",
      onAccountUsedForEncryption,
    });

    panelDeps.onAccountUsedForEncryption?.("ouro-account-under-test");
    expect(onAccountUsedForEncryption).toHaveBeenCalledWith("ouro-account-under-test");
  });
});

/**
 * Bug report (verbatim, live screenshot): clicking "Confirm & Upload" in the
 * real Arweave upload wizard failed with `No Arweave key found for the
 * selected address "" — import or generate one first.` even though the codex
 * has exactly one configured Arweave key (the wizard's own "Account: #0" step
 * showed it, with nothing else to pick from).
 *
 * Root cause: `ForeignChainsWiring.tsx`'s real-mode branch called
 * `buildRealPanelDeps({ ... })` WITHOUT ever passing `address` — so
 * `buildRealPanelDeps`'s `ownerAddress = address ?? ""` was unconditionally
 * `""`, and every real `uploadAndTrack`/`uploadFilesAndTrack`/`backupCodex`
 * call's `findEntryForAddress(foreignKeys, ownerAddress)` (realArweaveAdapter.ts)
 * threw exactly this error, regardless of how many keys the codex actually
 * held.
 *
 * This drives the REAL composition path the bug lived in — `buildArweaveWiring`
 * (real mode) -> `buildRealPanelDeps` -> `backupCodex` -> `findEntryForAddress`
 * — rather than a narrower unit test of `findEntryForAddress` alone.
 */
describe("buildArweaveWiring (real mode) — the panel's owner address resolves to the codex's configured Arweave key", () => {
  const TEST_PASSWORD = "correct horse battery staple";
  const ADDRESS = "the-one-configured-arweave-address";
  const FAKE_JWK = { kty: "RSA", n: "fake", e: "AQAB" };

  async function makeEntry(): Promise<ForeignKeyEntry> {
    const encryptedKeyfile = await encryptStringV2(JSON.stringify(FAKE_JWK), TEST_PASSWORD);
    return {
      id: ADDRESS,
      chainId: ARWEAVE_CHAIN_ID,
      encryptedKeyfile,
      address: ADDRESS,
    };
  }

  it("a codex with exactly ONE configured Arweave key no longer reports 'No Arweave key found for the selected address \"\"' on backupCodex", async () => {
    backupCodexToLibraryMock.mockClear();
    const entry = await makeEntry();
    const { panelDeps } = buildArweaveWiring({
      mode: ARWEAVE_WIRING_MODE_REAL,
      gatewayUrl: "https://arweave.example.invalid",
      foreignKeys: [entry],
      getPassword: () => TEST_PASSWORD,
      getExportJson: async () => '{"codex":"export"}',
    });

    // Before the fix this rejects with the exact reported message; after the
    // fix it resolves (the faked network seams above stand in for the live
    // gateway, so this proves the OWNER-ADDRESS resolution, not the network).
    await expect(panelDeps.backupCodex('{"codex":"export"}')).resolves.toEqual({
      id: "fake-backup-id",
    });
    expect(backupCodexToLibraryMock).toHaveBeenCalledTimes(1);
  });

  it("the exact reported symptom — Confirm & Upload — a codex with exactly ONE configured Arweave key no longer reports 'No Arweave key found for the selected address \"\"' on uploadAndTrack", async () => {
    uploadAndTrackMock.mockClear();
    const entry = await makeEntry();
    const { panelDeps } = buildArweaveWiring({
      mode: ARWEAVE_WIRING_MODE_REAL,
      gatewayUrl: "https://arweave.example.invalid",
      foreignKeys: [entry],
      getPassword: () => TEST_PASSWORD,
    });
    const file = new File(["hello"], "hello.txt", { type: "text/plain" });

    // Before the fix this rejects with the exact reported message; after the
    // fix it resolves (`libraryUploadAndTrack` faked above stands in for the
    // live gateway, so this proves the OWNER-ADDRESS resolution, not the
    // network) — this is the literal "Confirm & Upload" click path. The
    // THIRD argument is the wizard's own chosen account id
    // (`arweave-upload-wizard-account-wiring`, Bug 1) — here it happens to
    // equal the codex's one configured key, the same case this spec already
    // covers; the NEXT describe block below proves a DIFFERENT chosen id
    // actually changes which key resolves.
    await expect(
      panelDeps.uploadAndTrack(file, { category: "personal-documents" }, ADDRESS),
    ).resolves.toEqual({
      id: "fake-upload-id",
      status: "pending",
    });
    expect(uploadAndTrackMock).toHaveBeenCalledTimes(1);
  });
});

/**
 * Bug 1 (owner-reported, the real gap): the Upload Wizard's Account step
 * selection used to be purely cosmetic for the REAL signing/paying key —
 * `buildRealPanelDeps`'s `uploadAndTrack`/`uploadFilesAndTrack` always
 * resolved the key from the single `ownerAddress` closed over at
 * CONSTRUCTION time (`findEntryForAddress(foreignKeys, ownerAddress)`),
 * never from whichever account the wizard actually showed as selected. So
 * picking a DIFFERENT account in a multi-account codex silently did
 * nothing — the upload still went out under the original bound address.
 *
 * This drives the REAL composition path the bug lived in —
 * `buildRealPanelDeps`'s `uploadAndTrack`/`uploadFilesAndTrack` closures —
 * with TWO configured keys, asserting the key that actually gets decrypted
 * (and therefore signs) tracks the PASSED-IN account id, not the
 * construction-time default.
 */
describe("buildRealPanelDeps — uploadAndTrack/uploadFilesAndTrack resolve the PASSED-IN account, not the construction-time default", () => {
  const TEST_PASSWORD = "correct horse battery staple";
  const ADDRESS_DEFAULT = "the-construction-time-default-address";
  const ADDRESS_CHOSEN = "the-wizard-chosen-non-default-address";
  const JWK_DEFAULT = { kty: "RSA", n: "default-key-fake", e: "AQAB" };
  const JWK_CHOSEN = { kty: "RSA", n: "chosen-key-fake", e: "AQAB" };

  async function makeTwoEntries(): Promise<ForeignKeyEntry[]> {
    const defaultEntry: ForeignKeyEntry = {
      id: ADDRESS_DEFAULT,
      chainId: ARWEAVE_CHAIN_ID,
      encryptedKeyfile: await encryptStringV2(JSON.stringify(JWK_DEFAULT), TEST_PASSWORD),
      address: ADDRESS_DEFAULT,
    };
    const chosenEntry: ForeignKeyEntry = {
      id: ADDRESS_CHOSEN,
      chainId: ARWEAVE_CHAIN_ID,
      encryptedKeyfile: await encryptStringV2(JSON.stringify(JWK_CHOSEN), TEST_PASSWORD),
      address: ADDRESS_CHOSEN,
    };
    return [defaultEntry, chosenEntry];
  }

  it("uploadAndTrack decrypts and signs with the PASSED-IN accountId's key, even though `address` (the construction-time default) names a DIFFERENT entry", async () => {
    uploadAndTrackMock.mockClear();
    const foreignKeys = await makeTwoEntries();
    const deps = buildRealPanelDeps({
      gatewayUrl: "https://arweave.example.invalid",
      // The construction-time default resolves to ADDRESS_DEFAULT's entry —
      // exactly the role `ForeignChainsWiring.tsx`'s own "first configured
      // Arweave-chain foreign key" fallback plays. If `uploadAndTrack`
      // resolved its key from THIS instead of the passed `accountId`, the
      // test below would observe `JWK_DEFAULT`, not `JWK_CHOSEN`.
      address: ADDRESS_DEFAULT,
      foreignKeys,
      getPassword: () => TEST_PASSWORD,
    });
    const file = new File(["hello"], "hello.txt", { type: "text/plain" });

    await deps.uploadAndTrack(file, { category: "personal-documents" }, ADDRESS_CHOSEN);

    expect(uploadAndTrackMock).toHaveBeenCalledTimes(1);
    const [params] = uploadAndTrackMock.mock.calls[0]!;
    expect((params as { jwk: unknown }).jwk).toEqual(JWK_CHOSEN);
  });

  it("uploadFilesAndTrack decrypts and signs with the PASSED-IN accountId's key too (bundle path)", async () => {
    uploadAndTrackMock.mockClear();
    // The shared module-level mock's default resolution is the single-file
    // shape (`{ id, status }`) — override it ONCE here with the bundle shape
    // `uploadFilesAndTrack`'s own "files.length >= 2 always takes the bundle
    // path" assertion requires, without touching the fixture every other
    // test in this file relies on.
    uploadAndTrackMock.mockResolvedValueOnce({
      manifestId: "fake-manifest-id",
      fileIds: [{ path: "a.txt", id: "fake-a-id" }, { path: "b.txt", id: "fake-b-id" }],
      uploadId: "fake-bundle-upload-id",
    });
    const foreignKeys = await makeTwoEntries();
    const deps = buildRealPanelDeps({
      gatewayUrl: "https://arweave.example.invalid",
      address: ADDRESS_DEFAULT,
      foreignKeys,
      getPassword: () => TEST_PASSWORD,
    });
    const files = [
      new File(["a"], "a.txt", { type: "text/plain" }),
      new File(["b"], "b.txt", { type: "text/plain" }),
    ];

    await deps.uploadFilesAndTrack(files, { category: "personal-documents" }, ADDRESS_CHOSEN);

    expect(uploadAndTrackMock).toHaveBeenCalledTimes(1);
    const [params] = uploadAndTrackMock.mock.calls[0]!;
    expect((params as { jwk: unknown }).jwk).toEqual(JWK_CHOSEN);
  });

  it("refuses with a clear error naming the UNRESOLVABLE passed-in accountId when it matches no configured key — never silently falling back to the default", async () => {
    const foreignKeys = await makeTwoEntries();
    const deps = buildRealPanelDeps({
      gatewayUrl: "https://arweave.example.invalid",
      address: ADDRESS_DEFAULT,
      foreignKeys,
      getPassword: () => TEST_PASSWORD,
    });
    const file = new File(["hello"], "hello.txt", { type: "text/plain" });

    await expect(
      deps.uploadAndTrack(file, { category: "personal-documents" }, "no-such-account-id"),
    ).rejects.toThrow(/no-such-account-id/);
  });
});
