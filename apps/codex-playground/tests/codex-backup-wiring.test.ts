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
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it, expect, vi } from "vitest";
import { encryptStringV2 } from "@stoachain/stoa-core/crypto";
import type { ForeignKeyEntry } from "@ancientpantheon/codex-core";
import { ARWEAVE_CHAIN_ID } from "@ancientpantheon/codex-arweave/address-book";
import {
  createGatewayPool,
  type UploadGatewayApi,
  type UploadGatewayApiFactory,
  type ChunkedUploader,
  type ArweaveJwk,
  type Tag,
} from "@ancientpantheon/arweave-core";
import { MemoryLibraryStore } from "@ancientpantheon/codex-arweave";
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
// `arweave-streaming-worker-wiring` T3-revised: the SAME relative-path
// convention `realArweaveAdapter.ts` itself now uses (see that file's own
// import comment) — `FakeStreamingUploadRunner`/`StreamingUploadRunner`
// and `performUploadAndTrack`/`uploadAndTrack` (the real flow.ts composition,
// used below as the shape-parity ORACLE) ride no `package.json` `exports`
// subpath either, grounded the identical way (via `tsc`).
import {
  FakeStreamingUploadRunner,
  type StreamingUploadRunner,
} from "../../../packages/codex-arweave/src/library/streaming/StreamingUploadRunner.js";
import {
  uploadAndTrack as realFlowUploadAndTrack,
  performUploadAndTrack,
  type UploadAndTrackResult,
} from "../../../packages/codex-arweave/src/library/flow.js";
// `arweave-upload-dry-run` T3: the SAME relative-path convention as the
// `StreamingUploadRunner.ts`/`flow.js` imports above — neither rides a
// `package.json` `exports` subpath either, grounded the identical way.
import type { StreamingDryRunRunner } from "../../../packages/codex-arweave/src/library/streaming/StreamingDryRunRunner.js";
import type { DryRunResult } from "../../../packages/codex-arweave/src/library/streaming/dryRunUpload.js";
// `arweave-streaming-ui-support-probe-worker`: the SAME relative-path
// convention as the two imports above — neither rides a `package.json`
// `exports` subpath either, grounded the identical way.
import { FakeSupportProbeRunner, type SupportProbeRunner } from "../../../packages/codex-arweave/src/library/streaming/SupportProbeRunner.js";

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

// ============================================================================
// `arweave-streaming-worker-wiring` T3-revised fixtures — the adapter's
// `uploadAndTrack`/`uploadFilesAndTrack` now go through an INJECTABLE
// `streamingUploadRunner` (`buildRealPanelDeps`'s own option of that name)
// instead of calling `libraryUploadAndTrack` (the module-mocked barrel
// import above) directly. The three PRE-EXISTING tests below that drove
// `uploadAndTrack`/`uploadFilesAndTrack` and asserted on `uploadAndTrackMock`
// no longer exercise that mock at all post-this-task (the call site never
// reaches it any more) — each is updated to inject a runner double instead,
// documented at its own call site; none of their EXPECTED VALUES change.
// ============================================================================

/** Mirrors `UploadWizardUploadCallbacks`'s own shape structurally — a
 *  loose LOCAL type (same "own loose local type" convention this file
 *  already uses for `FakeUploadAndTrackResult` above), so these tests don't
 *  need a cross-package type import just to describe the callback bag. */
interface TestUploadCallbacks {
  onProgress?: (uploadedChunks: number, totalChunks: number) => void;
  onRouteDecided?: (route: "streaming" | "fallback") => void;
}

/**
 * Calls an `ArweavePanelDeps.uploadAndTrack`/`uploadFilesAndTrack`-shaped
 * function WITH a 4th `callbacks` argument its OWN DECLARED (3-param) TYPE
 * omits — `ArweavePanelDeps`'s `uploadAndTrack`/`uploadFilesAndTrack` fields
 * are still typed with only 3 parameters (`context.tsx`, outside this
 * task's file scope); `UploadWizard.tsx`'s own `UploadWizardProps` is where
 * the REAL 4-param type lives, and it is TypeScript's contravariant
 * parameter-count rule (a 3-param function satisfies a 4-param prop type)
 * that let the real bug — the 4th argument silently dropped — compile clean
 * for so long. This is a deliberate, narrow cast so these tests can prove
 * the real closure genuinely READS a 4th argument it was never statically
 * typed, at this call site, to receive.
 */
function callWithCallbacks<Args extends readonly unknown[], R>(
  fn: (...args: Args) => R,
  args: Args,
  callbacks: TestUploadCallbacks,
): R {
  type WithCallbacks = (...args: [...Args, TestUploadCallbacks]) => R;
  return (fn as unknown as WithCallbacks)(...args, callbacks);
}

/** A `StreamingUploadRunner` test double that CAPTURES every `.run()` call
 *  (params/resolvedKey/opts) before resolving with a fixed result — lets a
 *  test assert on exactly what the ADAPTER handed the runner (e.g. which
 *  JWK ended up in `params`), the same thing `uploadAndTrackMock.mock.calls`
 *  proved before this task's call-site switch. */
function makeCapturingStreamingUploadRunner(result: UploadAndTrackResult): {
  runner: StreamingUploadRunner;
  calls: Parameters<StreamingUploadRunner["run"]>[];
} {
  const calls: Parameters<StreamingUploadRunner["run"]>[] = [];
  const runner: StreamingUploadRunner = {
    async run(params, resolvedKey, opts) {
      calls.push([params, resolvedKey, opts]);
      return result;
    },
  };
  return { runner, calls };
}

/**
 * A real throwaway RSA-4096 Arweave keyfile — the SAME fixture
 * `packages/codex-arweave/tests/e3-helpers.ts`'s own `throwawayJwk` reads
 * (`tests/fixtures/throwaway-arweave-keyfile.json`), read directly via `fs`
 * rather than duplicated, so the shape-parity oracle test below can run a
 * REAL `importKeyfile`/sign round trip (never a live network — see
 * `makeFakeUploadApiFactory`/`makeUploadPool` below).
 */
const CODEX_ARWEAVE_TESTS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../packages/codex-arweave/tests",
);
const THROWAWAY_JWK = JSON.parse(
  readFileSync(join(CODEX_ARWEAVE_TESTS_DIR, "fixtures/throwaway-arweave-keyfile.json"), "utf8"),
) as ArweaveJwk;
/** The throwaway fixture's known deterministic 43-char address — mirrors
 *  `e3-helpers.ts`'s own `KNOWN_ADDRESS` constant for the SAME fixture. */
const THROWAWAY_ADDRESS = "tzXauR_QBlPW3ZRey3xBzaiDqPqLfiqWk1SWmk2BjM4";

/** A chunked uploader completing after a single `uploadChunk()` call —
 *  mirrors `e3-library-flow.test.ts`'s own `FakeChunkedUploader`. */
class FakeChunkedUploader implements ChunkedUploader {
  private done = false;
  get isComplete(): boolean {
    return this.done;
  }
  async uploadChunk(): Promise<void> {
    this.done = true;
  }
}

/** A fake {@link UploadGatewayApiFactory}: a fixed anchor and a price
 *  comfortably BELOW both sides' `maxRewardWinston` cap below — mirrors
 *  `e3-library-flow.test.ts`'s own `makeFakeUploadApiFactory`. NO real
 *  network — every upload in the oracle test below posts through this. */
function makeFakeUploadApiFactory(): UploadGatewayApiFactory {
  return (): UploadGatewayApi => ({
    async getAnchor() {
      return "abcdEFGHijkLMNopQRSTuvWXyz0123456789_-ABCDEF".slice(0, 43);
    },
    async getPrice() {
      return "1000";
    },
    async getUploader() {
      return new FakeChunkedUploader();
    },
  });
}

/** A fresh, injected, no-network upload pool — a single fake endpoint, zero
 *  real sleeps between pool retries — mirrors `e3-library-flow.test.ts`'s
 *  own `makeUploadPool`. */
function makeUploadPool() {
  return createGatewayPool({ endpoints: ["https://a.example"], sleep: async () => {} });
}

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
    const entry = await makeEntry();
    // `arweave-streaming-worker-wiring` T3-revised — FLAGGED CALL-SITE CHANGE:
    // this spec used to drive `buildArweaveWiring` (REAL mode) end-to-end,
    // relying on `libraryUploadAndTrack` (module-mocked above) standing in
    // for the live gateway. Post-this-task, `uploadAndTrack`'s
    // upload-performing call goes through an injectable
    // `streamingUploadRunner` instead — but `buildArweaveWiring`
    // (`ForeignChainsWiring.tsx`, OUTSIDE this task's file scope) does not
    // yet forward that option through to `buildRealPanelDeps`, so the REAL
    // default (a genuine Worker-backed runner) would run here, and jsdom has
    // no `Worker` global (confirmed directly) — it would reject with
    // `ReferenceError: Worker is not defined`, unrelated to this spec's own
    // actual subject (the owner-address/`findEntryForAddress` resolution,
    // which never reads `buildArweaveWiring`'s own address-derivation at all
    // — `uploadAndTrack` resolves its key from the explicit `accountId`
    // third argument via `findEntryForAddress`, regardless of `address`).
    // Switched to `buildRealPanelDeps` directly (mirroring the sibling
    // describe block below) with an injected CAPTURING runner so this spec's
    // own real subject — "exactly one configured key resolves cleanly,
    // never 'No Arweave key found'" — stays provable without touching
    // `ForeignChainsWiring.tsx`. The forwarding gap itself (`buildArweaveWiring`
    // not yet exposing a `streamingUploadRunner`/real-Worker override) is a
    // genuine, scoped follow-up this report flags explicitly — this spec's
    // OWN expected value is UNCHANGED (`{ id: "fake-upload-id", status:
    // "pending" }`), only the mechanism producing it (a capturing runner
    // double instead of `uploadAndTrackMock`) differs.
    const { runner, calls } = makeCapturingStreamingUploadRunner({
      id: "fake-upload-id",
      status: "pending",
    } as unknown as UploadAndTrackResult);
    const deps = buildRealPanelDeps({
      gatewayUrl: "https://arweave.example.invalid",
      foreignKeys: [entry],
      getPassword: () => TEST_PASSWORD,
      streamingUploadRunner: runner,
    });
    const file = new File(["hello"], "hello.txt", { type: "text/plain" });

    // Before the fix this rejects with the exact reported message; after the
    // fix it resolves — proving the OWNER-ADDRESS/`accountId` resolution,
    // not the network (no network is reached at all: the injected runner
    // never calls a real gateway). This is the literal "Confirm & Upload"
    // click path. The THIRD argument is the wizard's own chosen account id
    // (`arweave-upload-wizard-account-wiring`, Bug 1) — here it happens to
    // equal the codex's one configured key, the same case this spec already
    // covers; the NEXT describe block below proves a DIFFERENT chosen id
    // actually changes which key resolves.
    await expect(
      deps.uploadAndTrack(file, { category: "personal-documents" }, ADDRESS),
    ).resolves.toEqual({
      id: "fake-upload-id",
      status: "pending",
    });
    expect(calls).toHaveLength(1);
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
    const foreignKeys = await makeTwoEntries();
    // `arweave-streaming-worker-wiring` T3-revised — FLAGGED CALL-SITE
    // CHANGE: `uploadAndTrack`'s upload-performing call no longer reaches
    // `uploadAndTrackMock` at all (it now goes through the injectable
    // `streamingUploadRunner` instead of calling `libraryUploadAndTrack`
    // directly) — a CAPTURING runner double stands in, and the assertion
    // below reads the captured `params.jwk` off ITS calls instead of
    // `uploadAndTrackMock.mock.calls`. The spec's own EXPECTED VALUE
    // (`JWK_CHOSEN`, proving the PASSED-IN `accountId` resolves over the
    // construction-time default) is UNCHANGED — only which double observes
    // the call differs.
    const { runner, calls } = makeCapturingStreamingUploadRunner({
      id: "fake-upload-id",
      status: "pending",
    } as unknown as UploadAndTrackResult);
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
      streamingUploadRunner: runner,
    });
    const file = new File(["hello"], "hello.txt", { type: "text/plain" });

    await deps.uploadAndTrack(file, { category: "personal-documents" }, ADDRESS_CHOSEN);

    expect(calls).toHaveLength(1);
    const [params] = calls[0]!;
    expect((params as { jwk: unknown }).jwk).toEqual(JWK_CHOSEN);
  });

  it("uploadFilesAndTrack decrypts and signs with the PASSED-IN accountId's key too (bundle path)", async () => {
    const foreignKeys = await makeTwoEntries();
    // Same FLAGGED CALL-SITE CHANGE as the single-file spec above — the
    // runner double resolves the BUNDLE result shape
    // `uploadFilesAndTrack`'s own "files.length >= 2 always takes the
    // bundle path" assertion requires, standing in for the old
    // `uploadAndTrackMock.mockResolvedValueOnce(...)` override.
    const { runner, calls } = makeCapturingStreamingUploadRunner({
      manifestId: "fake-manifest-id",
      fileIds: [{ path: "a.txt", id: "fake-a-id" }, { path: "b.txt", id: "fake-b-id" }],
      uploadId: "fake-bundle-upload-id",
    } as unknown as UploadAndTrackResult);
    const deps = buildRealPanelDeps({
      gatewayUrl: "https://arweave.example.invalid",
      address: ADDRESS_DEFAULT,
      foreignKeys,
      getPassword: () => TEST_PASSWORD,
      streamingUploadRunner: runner,
    });
    const files = [
      new File(["a"], "a.txt", { type: "text/plain" }),
      new File(["b"], "b.txt", { type: "text/plain" }),
    ];

    await deps.uploadFilesAndTrack(files, { category: "personal-documents" }, ADDRESS_CHOSEN);

    expect(calls).toHaveLength(1);
    const [params] = calls[0]!;
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

/**
 * `arweave-streaming-worker-wiring` T3-revised — the actual fix this task
 * exists for: `UploadWizard.tsx` already builds an
 * `UploadWizardUploadCallbacks { onProgress?, onRouteDecided? }` object and
 * passes it as an optional 4th argument to `uploadAndTrack`/
 * `uploadFilesAndTrack`, but the REAL adapter's own closures used to take
 * only 3 parameters — TypeScript's contravariant parameter-count
 * assignability rule let that compile clean while silently dropping every
 * callback. This regression-guards that the 4th argument now genuinely
 * reaches the runner and is forwarded to the caller: a real end-to-end
 * proof (not assumed) that the dead-letter gap is closed.
 */
describe("buildRealPanelDeps — uploadAndTrack/uploadFilesAndTrack route through StreamingUploadRunner and forward callbacks", () => {
  const TEST_PASSWORD = "correct horse battery staple";
  const ADDRESS = "callback-wiring-test-address";
  const FAKE_JWK = { kty: "RSA", n: "fake", e: "AQAB" };

  async function makeEntry(): Promise<ForeignKeyEntry> {
    const encryptedKeyfile = await encryptStringV2(JSON.stringify(FAKE_JWK), TEST_PASSWORD);
    return { id: ADDRESS, chainId: ARWEAVE_CHAIN_ID, encryptedKeyfile, address: ADDRESS };
  }

  it("uploadAndTrack: invokes the caller's onRouteDecided/onProgress with the injected runner's own scripted route/progress events, in order", async () => {
    const entry = await makeEntry();
    const fakeRunner = new FakeStreamingUploadRunner({
      result: { id: "scripted-id", status: "pending" } as unknown as UploadAndTrackResult,
      route: "streaming",
      progress: [
        { uploadedChunks: 1, totalChunks: 4 },
        { uploadedChunks: 4, totalChunks: 4 },
      ],
    });
    const deps = buildRealPanelDeps({
      gatewayUrl: "https://arweave.example.invalid",
      foreignKeys: [entry],
      getPassword: () => TEST_PASSWORD,
      streamingUploadRunner: fakeRunner,
    });
    const file = new File(["hello"], "hello.txt", { type: "text/plain" });
    const onRouteDecided = vi.fn();
    const onProgress = vi.fn();

    await callWithCallbacks(
      deps.uploadAndTrack,
      [file, { category: "personal-documents" }, ADDRESS],
      { onRouteDecided, onProgress },
    );

    expect(onRouteDecided).toHaveBeenCalledTimes(1);
    expect(onRouteDecided).toHaveBeenCalledWith("streaming");
    expect(onProgress.mock.calls).toEqual([[1, 4], [4, 4]]);
  });

  it("uploadFilesAndTrack: invokes the caller's onRouteDecided/onProgress too (bundle path)", async () => {
    const entry = await makeEntry();
    const fakeRunner = new FakeStreamingUploadRunner({
      result: {
        manifestId: "scripted-manifest-id",
        fileIds: [{ path: "a.txt", id: "a-id" }, { path: "b.txt", id: "b-id" }],
        uploadId: "scripted-upload-id",
      } as unknown as UploadAndTrackResult,
      route: "fallback",
      progress: [{ uploadedChunks: 2, totalChunks: 2 }],
    });
    const deps = buildRealPanelDeps({
      gatewayUrl: "https://arweave.example.invalid",
      foreignKeys: [entry],
      getPassword: () => TEST_PASSWORD,
      streamingUploadRunner: fakeRunner,
    });
    const files = [
      new File(["a"], "a.txt", { type: "text/plain" }),
      new File(["b"], "b.txt", { type: "text/plain" }),
    ];
    const onRouteDecided = vi.fn();
    const onProgress = vi.fn();

    await callWithCallbacks(
      deps.uploadFilesAndTrack,
      [files, { category: "personal-documents" }, ADDRESS],
      { onRouteDecided, onProgress },
    );

    expect(onRouteDecided).toHaveBeenCalledTimes(1);
    expect(onRouteDecided).toHaveBeenCalledWith("fallback");
    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalledWith(2, 2);
  });

  it("omitting callbacks entirely still resolves normally — the 4th argument is genuinely optional, not a new requirement", async () => {
    const entry = await makeEntry();
    const fakeRunner = new FakeStreamingUploadRunner({
      result: { id: "scripted-id", status: "pending" } as unknown as UploadAndTrackResult,
    });
    const deps = buildRealPanelDeps({
      gatewayUrl: "https://arweave.example.invalid",
      foreignKeys: [entry],
      getPassword: () => TEST_PASSWORD,
      streamingUploadRunner: fakeRunner,
    });
    const file = new File(["hello"], "hello.txt", { type: "text/plain" });

    await expect(
      deps.uploadAndTrack(file, { category: "personal-documents" }, ADDRESS),
    ).resolves.toEqual({ id: "scripted-id", status: "pending" });
  });
});

/**
 * `arweave-streaming-worker-wiring` T3-revised — the SHAPE-PARITY ORACLE:
 * proves an ENCRYPTED upload through the adapter produces the exact same
 * `UploadResult` shape (keys, deterministic tag values) as calling
 * `library/flow.ts`'s own real, unmodified `uploadAndTrack` directly with
 * equivalent inputs — i.e. routing through `resolveEncryptionKey` +
 * `StreamingUploadRunner.run` instead of calling `uploadAndTrack` inline
 * changed NOTHING observable about the result. Both sides run the REAL
 * `performUploadAndTrack`/signing/tagging logic (NOT the module-mocked
 * `uploadAndTrackMock` above — both relative imports bypass that mock
 * entirely, same as the real adapter code does) against a fake, no-network
 * gateway (`makeFakeUploadApiFactory`/`makeUploadPool`) and a real throwaway
 * RSA-4096 keyfile, so this is a genuine, deterministic exercise of the real
 * encryption + tagging pipeline. `id`/`itemId` are NOT compared (RSA-PSS's
 * per-call random salt makes them genuinely different between two
 * independent signs of the same bytes) — mirrors this project's own
 * established "shape, not exact-id, comparison" oracle convention
 * (`packages/codex-arweave/tests/streaming-upload-bundle.test.ts`).
 */
describe("buildRealPanelDeps — an encrypted uploadAndTrack call matches library/flow.ts's own uploadAndTrack shape (oracle)", () => {
  const TEST_PASSWORD = "correct horse battery staple";
  const ENCRYPTOR_ACCOUNT_ID = "ouro-encryptor-account";
  const ENCRYPTOR_ACCOUNT_ADDRESS = "ouro-encryptor-address";
  const BITSTRING = "1".repeat(1600);
  // Mirrors `bufferedFeeCap`'s own formula against this file's module-level
  // mocked `estimateFee` (`1_000_000n`) — so both sides of the comparison
  // use the SAME cap the real adapter would actually compute.
  const MAX_REWARD_WINSTON = (1_000_000n * 12n) / 10n;

  async function makeEntry(): Promise<ForeignKeyEntry> {
    const encryptedKeyfile = await encryptStringV2(JSON.stringify(THROWAWAY_JWK), TEST_PASSWORD);
    return {
      id: THROWAWAY_ADDRESS,
      chainId: ARWEAVE_CHAIN_ID,
      encryptedKeyfile,
      address: THROWAWAY_ADDRESS,
    };
  }

  function tagNames(tags: readonly Tag[]): string[] {
    return tags.map((t) => t.name).sort();
  }
  function tagValue(tags: readonly Tag[], name: string): string | undefined {
    return tags.find((t) => t.name === name)?.value;
  }

  it("single-file encrypted upload: same UploadResult keys + deterministic tag values as the real uploadAndTrack", async () => {
    const entry = await makeEntry();
    const pool = makeUploadPool();
    const apiFactory = makeFakeUploadApiFactory();
    const revealAccountSecret = async (): Promise<string> => BITSTRING;

    // A test-only `StreamingUploadRunner` that skips the Worker boundary
    // entirely and calls the already-tested `performUploadAndTrack`
    // in-process, injecting the SAME fake `apiFactory` the oracle side uses
    // below — proves the ADAPTER's own wiring (resolvedKey/encryptFor/
    // store/pool construction), not `performUploadAndTrack`'s internal
    // logic (already proven by `packages/codex-arweave`'s own suite).
    const directRunner: StreamingUploadRunner = {
      async run(params, resolvedKey, opts) {
        const { onRoute, ...rest } = opts;
        void onRoute;
        return performUploadAndTrack(params, resolvedKey, { ...rest, apiFactory });
      },
    };

    const deps = buildRealPanelDeps({
      gatewayUrl: "https://arweave.example.invalid",
      pool,
      foreignKeys: [entry],
      getPassword: () => TEST_PASSWORD,
      streamingUploadRunner: directRunner,
    });
    const file = new File(["hello oracle"], "hello.txt", { type: "text/plain" });

    const viaAdapter = await deps.uploadAndTrack(
      file,
      {
        category: "personal-documents",
        encryptFor: {
          accountId: ENCRYPTOR_ACCOUNT_ID,
          accountAddress: ENCRYPTOR_ACCOUNT_ADDRESS,
          revealAccountSecret,
        },
      },
      THROWAWAY_ADDRESS,
    );

    const data = new Uint8Array(await file.arrayBuffer());
    const oracleStore = new MemoryLibraryStore();
    const oracleResult = await realFlowUploadAndTrack(
      {
        jwk: THROWAWAY_JWK,
        data,
        contentType: "text/plain",
        maxRewardWinston: MAX_REWARD_WINSTON,
        category: "personal-documents",
      },
      {
        store: oracleStore,
        pool,
        apiFactory,
        encryptFor: {
          accountId: ENCRYPTOR_ACCOUNT_ID,
          accountAddress: ENCRYPTOR_ACCOUNT_ADDRESS,
          revealAccountSecret,
        },
      },
    );

    if ("manifestId" in viaAdapter || "manifestId" in oracleResult) {
      throw new Error("expected both results to be single-file UploadResults for this fixture");
    }
    // `UploadTrackResult.tags` (`panel/UploadArea.tsx`) is deliberately
    // loosely typed `unknown[]`; `oracleResult.tags` is the real `Tag[]`.
    const viaAdapterTags = viaAdapter.tags as Tag[];

    expect(Object.keys(viaAdapter).sort()).toEqual(Object.keys(oracleResult).sort());
    expect(tagNames(viaAdapterTags)).toEqual(tagNames(oracleResult.tags));
    expect(tagValue(viaAdapterTags, "Codex-Owner")).toBe(tagValue(oracleResult.tags, "Codex-Owner"));
    expect(tagValue(viaAdapterTags, "Codex-Encrypted")).toBe("true");
    expect(tagValue(oracleResult.tags, "Codex-Encrypted")).toBe("true");
    expect(tagValue(viaAdapterTags, "Codex-Encryptor")).toBe(ENCRYPTOR_ACCOUNT_ADDRESS);
    expect(tagValue(oracleResult.tags, "Codex-Encryptor")).toBe(ENCRYPTOR_ACCOUNT_ADDRESS);
    expect(viaAdapter.ownerAddress).toBe(oracleResult.ownerAddress);
  });
});

/**
 * `arweave-upload-dry-run` T3: `buildRealPanelDeps`'s new `runDryRunUpload`
 * — the REAL wiring behind `UploadWizard`'s "Test this upload" button.
 * Mirrors `uploadAndTrack`/`uploadFilesAndTrack`'s own established pattern
 * (decrypt the PASSED-IN `accountId`'s key, resolve `encryptFor` into a
 * `CryptoKey` via the SAME `resolveEncryptionKey`), but routes into an
 * INJECTABLE `streamingDryRunRunner` (default: a real Worker-backed
 * `createWorkerStreamingDryRunRunner`) instead of
 * `uploadAndTrack`/`uploadFilesAndTrack`'s own `streamingUploadRunner` — see
 * `StreamingDryRunRunner.ts`'s own doc comment for why a dry run needs its
 * OWN Worker-backed seam (the real-browser capstone finding this task's own
 * build report documents: `runUploadDryRun` must run inside a dedicated
 * Worker, exactly like a real upload, for `isStreamingUploadSupported()` to
 * ever resolve `true`).
 */
describe("buildRealPanelDeps — runDryRunUpload (arweave-upload-dry-run T3)", () => {
  const TEST_PASSWORD = "correct horse battery staple";
  const ADDRESS_CHOSEN = "dry-run-test-address-chosen";
  const ADDRESS_DEFAULT = "dry-run-test-address-default";
  const FAKE_JWK_CHOSEN = { kty: "RSA", n: "chosen-fake-n", e: "AQAB" };
  const FAKE_JWK_DEFAULT = { kty: "RSA", n: "default-fake-n", e: "AQAB" };

  async function makeEntries(): Promise<ForeignKeyEntry[]> {
    const chosen = await encryptStringV2(JSON.stringify(FAKE_JWK_CHOSEN), TEST_PASSWORD);
    const fallback = await encryptStringV2(JSON.stringify(FAKE_JWK_DEFAULT), TEST_PASSWORD);
    return [
      { id: ADDRESS_DEFAULT, chainId: ARWEAVE_CHAIN_ID, encryptedKeyfile: fallback, address: ADDRESS_DEFAULT },
      { id: ADDRESS_CHOSEN, chainId: ARWEAVE_CHAIN_ID, encryptedKeyfile: chosen, address: ADDRESS_CHOSEN },
    ];
  }

  /** A `StreamingDryRunRunner` test double that CAPTURES every `.run()`
   *  call — mirrors `makeCapturingStreamingUploadRunner` above. */
  function makeCapturingStreamingDryRunRunner(result: DryRunResult): {
    runner: StreamingDryRunRunner;
    calls: Parameters<StreamingDryRunRunner["run"]>[];
  } {
    const calls: Parameters<StreamingDryRunRunner["run"]>[] = [];
    const runner: StreamingDryRunRunner = {
      async run(params, resolvedKey, opts) {
        calls.push([params, resolvedKey, opts]);
        return result;
      },
    };
    return { runner, calls };
  }

  const FAKE_DRY_RUN_RESULT: DryRunResult = {
    success: true,
    filesTested: 1,
    totalBytes: 5,
    chunksPosted: 1,
    resumeTested: true,
    proofsValid: true,
    decryptRoundTripOk: "not-applicable",
    streamingSupported: true,
    elapsedMs: 1,
    errors: [],
  };

  it("decrypts and signs-for with the PASSED-IN accountId's key, not the construction-time default address", async () => {
    const entries = await makeEntries();
    const { runner, calls } = makeCapturingStreamingDryRunRunner(FAKE_DRY_RUN_RESULT);
    const deps = buildRealPanelDeps({
      gatewayUrl: "https://arweave.example.invalid",
      address: ADDRESS_DEFAULT,
      foreignKeys: entries,
      getPassword: () => TEST_PASSWORD,
      streamingDryRunRunner: runner,
    });
    const file = new File(["hello"], "hello.txt", { type: "text/plain" });

    const result = await deps.runDryRunUpload([file], { category: "personal-documents" }, ADDRESS_CHOSEN);

    expect(result).toBe(FAKE_DRY_RUN_RESULT);
    expect(calls).toHaveLength(1);
    const [params] = calls[0]!;
    expect((params as { jwk: unknown }).jwk).toEqual(FAKE_JWK_CHOSEN);
  });

  it("a single file builds plain { data, contentType } params (not a 'files' bundle)", async () => {
    const entries = await makeEntries();
    const { runner, calls } = makeCapturingStreamingDryRunRunner(FAKE_DRY_RUN_RESULT);
    const deps = buildRealPanelDeps({
      gatewayUrl: "https://arweave.example.invalid",
      foreignKeys: entries,
      getPassword: () => TEST_PASSWORD,
      streamingDryRunRunner: runner,
    });
    const file = new File(["hello"], "hello.txt", { type: "text/plain" });

    await deps.runDryRunUpload([file], { category: "personal-documents" }, ADDRESS_CHOSEN);

    const [params] = calls[0]!;
    expect("files" in (params as object)).toBe(false);
    expect((params as { contentType: string }).contentType).toBe("text/plain");
  });

  it("two or more files build a bundle-shaped 'files' params array", async () => {
    const entries = await makeEntries();
    const { runner, calls } = makeCapturingStreamingDryRunRunner(FAKE_DRY_RUN_RESULT);
    const deps = buildRealPanelDeps({
      gatewayUrl: "https://arweave.example.invalid",
      foreignKeys: entries,
      getPassword: () => TEST_PASSWORD,
      streamingDryRunRunner: runner,
    });
    const files = [
      new File(["a"], "a.txt", { type: "text/plain" }),
      new File(["b"], "b.txt", { type: "text/plain" }),
    ];

    await deps.runDryRunUpload(files, { category: "personal-documents" }, ADDRESS_CHOSEN);

    const [params] = calls[0]!;
    expect("files" in (params as object)).toBe(true);
    expect((params as { files: unknown[] }).files).toHaveLength(2);
  });

  it("resolves selection.encryptFor into a real CryptoKey, the SAME way the real upload path's resolveEncryptionKey does — and omits it (undefined) for a Public selection", async () => {
    const entries = await makeEntries();
    const BITSTRING = "1".repeat(1600);
    const revealAccountSecret = async (): Promise<string> => BITSTRING;

    const { runner: encryptedRunner, calls: encryptedCalls } =
      makeCapturingStreamingDryRunRunner(FAKE_DRY_RUN_RESULT);
    const encryptedDeps = buildRealPanelDeps({
      gatewayUrl: "https://arweave.example.invalid",
      foreignKeys: entries,
      getPassword: () => TEST_PASSWORD,
      streamingDryRunRunner: encryptedRunner,
    });
    const file = new File(["hello"], "hello.txt", { type: "text/plain" });

    await encryptedDeps.runDryRunUpload(
      [file],
      {
        category: "personal-documents",
        encryptFor: {
          accountId: "ouro-encryptor-account",
          accountAddress: "ouro-encryptor-address",
          revealAccountSecret,
        },
      },
      ADDRESS_CHOSEN,
    );
    const [, resolvedKey] = encryptedCalls[0]!;
    expect(resolvedKey).toBeInstanceOf(CryptoKey);

    const { runner: publicRunner, calls: publicCalls } =
      makeCapturingStreamingDryRunRunner(FAKE_DRY_RUN_RESULT);
    const publicDeps = buildRealPanelDeps({
      gatewayUrl: "https://arweave.example.invalid",
      foreignKeys: entries,
      getPassword: () => TEST_PASSWORD,
      streamingDryRunRunner: publicRunner,
    });
    await publicDeps.runDryRunUpload([file], { category: "personal-documents" }, ADDRESS_CHOSEN);
    const [, publicResolvedKey] = publicCalls[0]!;
    expect(publicResolvedKey).toBeUndefined();
  });

  it("calls the runner with the SAME resolved pool this adapter instance was built against", async () => {
    const entries = await makeEntries();
    const pool = createGatewayPool({ endpoints: ["https://dry-run-pool.example"], sleep: async () => {} });
    const { runner, calls } = makeCapturingStreamingDryRunRunner(FAKE_DRY_RUN_RESULT);
    const deps = buildRealPanelDeps({
      gatewayUrl: "https://arweave.example.invalid",
      pool,
      foreignKeys: entries,
      getPassword: () => TEST_PASSWORD,
      streamingDryRunRunner: runner,
    });
    const file = new File(["hello"], "hello.txt", { type: "text/plain" });

    await deps.runDryRunUpload([file], { category: "personal-documents" }, ADDRESS_CHOSEN);

    const [, , opts] = calls[0]!;
    expect(opts.pool).toBe(pool);
  });

  it("NEVER calls the real network fee-estimate seam (estimateFee) — a dry run must never touch the network even for its own fee-cap bookkeeping", async () => {
    const entries = await makeEntries();
    const { estimateFee } = await import("@ancientpantheon/arweave-core");
    const estimateFeeMock = estimateFee as unknown as ReturnType<typeof vi.fn>;
    estimateFeeMock.mockClear();

    const { runner } = makeCapturingStreamingDryRunRunner(FAKE_DRY_RUN_RESULT);
    const deps = buildRealPanelDeps({
      gatewayUrl: "https://arweave.example.invalid",
      foreignKeys: entries,
      getPassword: () => TEST_PASSWORD,
      streamingDryRunRunner: runner,
    });
    const file = new File(["hello"], "hello.txt", { type: "text/plain" });

    await deps.runDryRunUpload([file], { category: "personal-documents" }, ADDRESS_CHOSEN);

    expect(estimateFeeMock).not.toHaveBeenCalled();
  });
});

/**
 * `arweave-streaming-ui-support-probe-worker` — the fix for the bug report's
 * confirmed root cause: `UploadWizard.tsx`'s own `isStreamingUploadSupported`
 * prop defaults to calling T1's `isStreamingUploadSupported()` directly on
 * the main thread, which ALWAYS resolves `false` in a real browser (that
 * probe's own `createSyncAccessHandle()` call is Worker-only by spec) —
 * exactly the owner-reported false "browser doesn't support this" banner/cap
 * on a genuinely OPFS-capable browser. `buildRealPanelDeps` now constructs a
 * Worker-backed `isStreamingUploadSupported` override the SAME way it
 * already constructs `streamingUploadRunner`/`streamingDryRunRunner` — these
 * specs pin that the override is actually EXPOSED (not the broken main-
 * thread default UploadWizard would otherwise fall back to) and that an
 * injected `supportProbeRunner` double is driven correctly, with zero real
 * Worker (jsdom has none).
 */
describe("buildRealPanelDeps — isStreamingUploadSupported wiring (arweave-streaming-ui-support-probe-worker)", () => {
  it("exposes an isStreamingUploadSupported function — a non-default, Worker-backed override, never left unset", () => {
    const deps = buildRealPanelDeps({ gatewayUrl: "https://arweave.example.invalid" });
    expect(typeof deps.isStreamingUploadSupported).toBe("function");
  });

  it("resolves true when the injected supportProbeRunner reports supported — proves the override, not UploadWizard's own broken main-thread default, decides the answer", async () => {
    const supportProbeRunner: SupportProbeRunner = new FakeSupportProbeRunner({ supported: true });
    const deps = buildRealPanelDeps({
      gatewayUrl: "https://arweave.example.invalid",
      supportProbeRunner,
    });

    await expect(deps.isStreamingUploadSupported()).resolves.toBe(true);
  });

  it("resolves false when the injected supportProbeRunner reports unsupported", async () => {
    const supportProbeRunner: SupportProbeRunner = new FakeSupportProbeRunner({ supported: false });
    const deps = buildRealPanelDeps({
      gatewayUrl: "https://arweave.example.invalid",
      supportProbeRunner,
    });

    await expect(deps.isStreamingUploadSupported()).resolves.toBe(false);
  });
});
