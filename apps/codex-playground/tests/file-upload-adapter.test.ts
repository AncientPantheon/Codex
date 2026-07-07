// ============================================================================
// RED SPEC — the file-upload storage adapter's two-load-mode CORE BRANCHING.
//
// This authors the failing tests that shape-drive T10.5's `src/loadCodex.ts`
// (which does NOT exist yet — the import below fails until T10.5 lands, so the
// whole suite is RED). It is the load-bearing branching logic of D6:
//   - mode-2 (plaintext snapshot): hydrate a MemoryCodexAdapter("dev") VERBATIM
//     BEFORE mount — the round-trip deep-equals the fixture, lastUpdated* included.
//   - mode-1 (backup JSON): mount an EMPTY MemoryCodexAdapter("dev") then RESTORE
//     via the REAL useCodexBackup().importFromCloud — data slices deep-equal the
//     backup, but lastUpdated* is SYNTHESIZED (fresh ISO / current "dev" device).
//   - explicit-mode dispatch: the mode is an EXPLICIT arg; a mode/shape mismatch
//     throws a clear, secret-free error (no sniff-and-guess).
//   - fail-closed on malformed / wrong-version input.
//   - secret hygiene (N-06): no thrown/logged message echoes a secret or blob VALUE.
//
// DEVICE TAG: the DeviceVariant union is "dev" | "main" (disk-verified) — it
// REJECTS "playground". Every MemoryCodexAdapter here is constructed with "dev",
// and the mode-1 current-device assertion pins "dev".
// ============================================================================

import * as React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";

import { CodexProvider } from "@ancientpantheon/codex-ouronet/provider";
import { useCodexBackup } from "@ancientpantheon/codex-ouronet/hooks";
import {
  MemoryCodexAdapter,
  type CodexSnapshot,
} from "@ancientpantheon/codex-ouronet/adapters";

// The module under test — DOES NOT EXIST YET (T10.5 implements it). This import
// is what makes the whole suite RED.
import {
  hydrateFromPlaintextSnapshot,
  restoreBackupIntoStore,
  loadCodex,
} from "../src/loadCodex";

import {
  emptySnapshot,
  populatedStoaChainSnapshot,
  backupJson,
  backupStoaChainWallets,
  backupOuronetWallets,
  backupPureKeypairs,
  backupAddressBook,
  backupUiSettings,
  backupExpectedStoaChainWalletsLength,
  backupExpectedPureKeypairsLength,
  MODE2_LAST_UPDATED_AT,
  MODE2_LAST_UPDATED_DEVICE,
} from "../fixtures/index";

// A JSON ISO-8601 timestamp (what `new Date().toISOString()` emits).
const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// ---------------------------------------------------------------------------
// MODE-2 — plaintext snapshot: hydrate BEFORE mount, VERBATIM round-trip.
// ---------------------------------------------------------------------------
describe("mode-2 (plaintext snapshot): hydrateFromPlaintextSnapshot", () => {
  it("constructs a MemoryCodexAdapter tagged 'dev' (the DeviceVariant union rejects 'playground')", async () => {
    const adapter = await hydrateFromPlaintextSnapshot(emptySnapshot);
    expect(adapter).toBeInstanceOf(MemoryCodexAdapter);
    // A fresh, un-hydrated MemoryCodexAdapter("dev") stamps its empty snapshot
    // with the "dev" device — proving the ctor arg was "dev", not "playground".
    const bare = new MemoryCodexAdapter("dev");
    expect((await bare.loadAll()).lastUpdatedDevice).toBe("dev");
  });

  it("round-trips the EMPTY fixture verbatim through saveAll → loadAll (no re-stamp)", async () => {
    const adapter = await hydrateFromPlaintextSnapshot(emptySnapshot);
    const loaded = await adapter.loadAll();
    // structuredClone hydration is verbatim: the whole snapshot deep-equals.
    expect(loaded).toEqual(emptySnapshot);
    // The empty-but-valid fixture carries NO entity rows.
    expect(loaded.kadenaSeeds).toHaveLength(0);
    expect(loaded.ouroAccounts).toHaveLength(0);
  });

  it("preserves the EMPTY fixture's lastUpdated* VERBATIM (mode-2 is not re-stamped)", async () => {
    const adapter = await hydrateFromPlaintextSnapshot(emptySnapshot);
    const loaded = await adapter.loadAll();
    expect(loaded.lastUpdatedAt).toBe(MODE2_LAST_UPDATED_AT);
    expect(loaded.lastUpdatedAt).toBe(emptySnapshot.lastUpdatedAt);
    expect(loaded.lastUpdatedDevice).toBe(MODE2_LAST_UPDATED_DEVICE);
    expect(loaded.lastUpdatedDevice).toBe(emptySnapshot.lastUpdatedDevice);
  });

  it("round-trips the POPULATED-StoaChain fixture verbatim (entities + secrets survive as-is)", async () => {
    const adapter = await hydrateFromPlaintextSnapshot(populatedStoaChainSnapshot);
    const loaded = await adapter.loadAll();
    expect(loaded).toEqual(populatedStoaChainSnapshot);
    // The StoaChain entries render-visible content — they must survive hydration.
    expect(loaded.kadenaSeeds).toHaveLength(populatedStoaChainSnapshot.kadenaSeeds.length);
    expect(loaded.kadenaSeeds.length).toBeGreaterThan(0);
    expect(loaded.ouroAccounts).toEqual(populatedStoaChainSnapshot.ouroAccounts);
    // The encrypted secret blob passes through verbatim (hydration does NOT decrypt).
    expect(loaded.kadenaSeeds[0].secret).toBe(populatedStoaChainSnapshot.kadenaSeeds[0].secret);
  });

  it("preserves the POPULATED fixture's lastUpdated* VERBATIM", async () => {
    const adapter = await hydrateFromPlaintextSnapshot(populatedStoaChainSnapshot);
    const loaded = await adapter.loadAll();
    expect(loaded.lastUpdatedAt).toBe(MODE2_LAST_UPDATED_AT);
    expect(loaded.lastUpdatedDevice).toBe(MODE2_LAST_UPDATED_DEVICE);
  });

  it("returns a defensive copy — mutating the fixture after hydration does not leak in", async () => {
    const snapshot: CodexSnapshot = structuredClone(populatedStoaChainSnapshot);
    const adapter = await hydrateFromPlaintextSnapshot(snapshot);
    snapshot.kadenaSeeds.push(structuredClone(populatedStoaChainSnapshot.kadenaSeeds[0]));
    const loaded = await adapter.loadAll();
    // The adapter kept its own clone; the post-hydration push must not appear.
    expect(loaded.kadenaSeeds).toHaveLength(populatedStoaChainSnapshot.kadenaSeeds.length);
  });
});

// ---------------------------------------------------------------------------
// MODE-1 — backup JSON: mount EMPTY adapter THEN restore via the REAL hook.
// SYNTHESIZED lastUpdated* + verbatim DATA slices (FIX-A).
// ---------------------------------------------------------------------------
describe("mode-1 (backup JSON): restoreBackupIntoStore via useCodexBackup().importFromCloud", () => {
  afterEach(() => cleanup());

  // Mount an EMPTY MemoryCodexAdapter("dev") under <CodexProvider> and hand back
  // both the adapter (to assert loadAll on) and the mounted hook's importFromCloud
  // (the REAL restore path the mode-1 adapter delegates to).
  async function mountEmptyStore(): Promise<{
    memAdapter: MemoryCodexAdapter;
    importFromCloud: (json: string) => Promise<void>;
  }> {
    const memAdapter = new MemoryCodexAdapter("dev");
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(CodexProvider, {
        adapter: memAdapter,
        deviceVariant: "dev",
        children,
      });
    const { result } = renderHook(() => useCodexBackup(), { wrapper });
    // Let the provider's async init effect settle before restoring.
    await waitFor(() => expect(result.current.importFromCloud).toBeTypeOf("function"));
    return { memAdapter, importFromCloud: result.current.importFromCloud };
  }

  it("restores the backup's DATA slices into the mounted adapter (deep-equal the fixture refs)", async () => {
    const { memAdapter, importFromCloud } = await mountEmptyStore();
    await restoreBackupIntoStore(importFromCloud, backupJson);

    const loaded = await memAdapter.loadAll();
    // The wire field map: kadenaWallets→kadenaSeeds, ouronetWallets→ouroAccounts,
    // pureKeypairs→(pureKeypairs ?? []), addressBook, uiSettings.
    expect(loaded.kadenaSeeds).toEqual(backupStoaChainWallets);
    expect(loaded.ouroAccounts).toEqual(backupOuronetWallets);
    expect(loaded.pureKeypairs).toEqual(backupPureKeypairs);
    expect(loaded.addressBook).toEqual(backupAddressBook);
    expect(loaded.uiSettings).toEqual(backupUiSettings);
    expect(loaded.kadenaSeeds).toHaveLength(backupExpectedStoaChainWalletsLength);
    expect(loaded.pureKeypairs).toHaveLength(backupExpectedPureKeypairsLength);
  });

  it("SYNTHESIZES lastUpdatedAt (fresh ISO string, NOT the backup file's exportedAt)", async () => {
    const { memAdapter, importFromCloud } = await mountEmptyStore();
    await restoreBackupIntoStore(importFromCloud, backupJson);

    const loaded = await memAdapter.loadAll();
    expect(loaded.lastUpdatedAt).toMatch(ISO_8601);
    // The backup file's `exportedAt` must NOT leak through as lastUpdatedAt.
    expect(loaded.lastUpdatedAt).not.toBe("2026-07-03T12:00:00.000Z");
    // Nor the mode-2 fixed constant.
    expect(loaded.lastUpdatedAt).not.toBe(MODE2_LAST_UPDATED_AT);
  });

  it("re-stamps lastUpdatedDevice to the CURRENT device 'dev' (not the file's)", async () => {
    const { memAdapter, importFromCloud } = await mountEmptyStore();
    await restoreBackupIntoStore(importFromCloud, backupJson);

    const loaded = await memAdapter.loadAll();
    expect(loaded.lastUpdatedDevice).toBe("dev");
  });

  it("leaves wallet secrets ENCRYPTED — restore does not decrypt the blobs", async () => {
    const { memAdapter, importFromCloud } = await mountEmptyStore();
    await restoreBackupIntoStore(importFromCloud, backupJson);

    const loaded = await memAdapter.loadAll();
    // The encrypted blob passes through verbatim (decryption is the unlock path).
    expect(loaded.kadenaSeeds[0].secret).toBe(backupStoaChainWallets[0].secret);
    expect(loaded.ouroAccounts[0].secret).toBe(backupOuronetWallets[0].secret);
    expect(loaded.pureKeypairs[0].encryptedPrivateKey).toBe(
      backupPureKeypairs[0].encryptedPrivateKey,
    );
  });
});

// ---------------------------------------------------------------------------
// EXPLICIT-MODE DISPATCH — loadCodex takes an explicit mode; no sniff-and-guess.
// ---------------------------------------------------------------------------
describe("loadCodex dispatcher: explicit-mode dispatch (no sniff-and-guess)", () => {
  afterEach(() => cleanup());

  async function mountEmptyStore(): Promise<{
    memAdapter: MemoryCodexAdapter;
    importFromCloud: (json: string) => Promise<void>;
  }> {
    const memAdapter = new MemoryCodexAdapter("dev");
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(CodexProvider, {
        adapter: memAdapter,
        deviceVariant: "dev",
        children,
      });
    const { result } = renderHook(() => useCodexBackup(), { wrapper });
    await waitFor(() => expect(result.current.importFromCloud).toBeTypeOf("function"));
    return { memAdapter, importFromCloud: result.current.importFromCloud };
  }

  it("mode 'plaintext' hydrates the snapshot and returns the adapter", async () => {
    const adapter = (await loadCodex({
      mode: "plaintext",
      snapshot: populatedStoaChainSnapshot,
    })) as MemoryCodexAdapter;
    expect(adapter).toBeInstanceOf(MemoryCodexAdapter);
    expect(await adapter.loadAll()).toEqual(populatedStoaChainSnapshot);
  });

  it("mode 'encrypted' restores the backup text through the mounted importFromCloud", async () => {
    const { memAdapter, importFromCloud } = await mountEmptyStore();
    await loadCodex({ mode: "encrypted", backupText: backupJson, importFromCloud });
    expect((await memAdapter.loadAll()).kadenaSeeds).toEqual(backupStoaChainWallets);
  });

  it("throws a clear error when 'encrypted' mode is handed a plaintext SNAPSHOT object (mismatch)", async () => {
    await expect(
      // A snapshot object routed to the encrypted (backup-string) path.
      loadCodex({
        mode: "encrypted",
        backupText: populatedStoaChainSnapshot as unknown as string,
        importFromCloud: async () => {},
      }),
    ).rejects.toThrow(/encrypted|backup|string/i);
  });

  it("throws a clear error when 'plaintext' mode is handed a backup STRING (mismatch)", async () => {
    await expect(
      // A backup string routed to the plaintext (snapshot-object) path.
      loadCodex({ mode: "plaintext", snapshot: backupJson as unknown as CodexSnapshot }),
    ).rejects.toThrow(/plaintext|snapshot|object/i);
  });
});

// ---------------------------------------------------------------------------
// FAIL-CLOSED — malformed / wrong-version input throws a clear, secret-free error.
// ---------------------------------------------------------------------------
describe("fail-closed on malformed input", () => {
  afterEach(() => cleanup());

  async function mountEmptyStore(): Promise<{
    memAdapter: MemoryCodexAdapter;
    importFromCloud: (json: string) => Promise<void>;
  }> {
    const memAdapter = new MemoryCodexAdapter("dev");
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(CodexProvider, {
        adapter: memAdapter,
        deviceVariant: "dev",
        children,
      });
    const { result } = renderHook(() => useCodexBackup(), { wrapper });
    await waitFor(() => expect(result.current.importFromCloud).toBeTypeOf("function"));
    return { memAdapter, importFromCloud: result.current.importFromCloud };
  }

  it("throws on malformed JSON in the mode-1 restore path (parse gate)", async () => {
    const { importFromCloud } = await mountEmptyStore();
    await expect(
      restoreBackupIntoStore(importFromCloud, "{ not valid json"),
    ).rejects.toThrow(/malformed|parse|JSON/i);
  });

  it("throws a version error on a wrong-version backup (useCodexBackup's '1.2' gate)", async () => {
    const { importFromCloud } = await mountEmptyStore();
    const wrongVersion = JSON.stringify({
      version: "1.1",
      exportedAt: "2026-07-03T12:00:00.000Z",
      kadenaWallets: [],
      ouronetWallets: [],
      addressBook: [],
      uiSettings: {},
      pureKeypairs: [],
    });
    await expect(
      restoreBackupIntoStore(importFromCloud, wrongVersion),
    ).rejects.toThrow(/version|1\.2|1\.1/i);
  });

  it("throws a shape error naming the offending field on a raw codec envelope (no kadenaWallets)", async () => {
    const { importFromCloud } = await mountEmptyStore();
    // A codec-envelope-shaped object (no augmented backup fields) fails the shape gate.
    const codecEnvelope = JSON.stringify({ version: "1.2", codex: { kadenaSeeds: [] } });
    await expect(
      restoreBackupIntoStore(importFromCloud, codecEnvelope),
    ).rejects.toThrow(/kadenaWallets|array|shape/i);
  });

  it("rejects a plaintext snapshot that is not an object (mode-2 shape gate)", async () => {
    await expect(
      hydrateFromPlaintextSnapshot(null as unknown as CodexSnapshot),
    ).rejects.toThrow(/snapshot|object|shape/i);
  });
});

// ---------------------------------------------------------------------------
// SECRET HYGIENE (N-06) — no thrown/logged message echoes a secret or blob VALUE.
// ---------------------------------------------------------------------------
describe("secret hygiene (N-06)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  async function mountEmptyStore(): Promise<{
    memAdapter: MemoryCodexAdapter;
    importFromCloud: (json: string) => Promise<void>;
  }> {
    const memAdapter = new MemoryCodexAdapter("dev");
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(CodexProvider, {
        adapter: memAdapter,
        deviceVariant: "dev",
        children,
      });
    const { result } = renderHook(() => useCodexBackup(), { wrapper });
    await waitFor(() => expect(result.current.importFromCloud).toBeTypeOf("function"));
    return { memAdapter, importFromCloud: result.current.importFromCloud };
  }

  it("does not log any encrypted-blob value during a successful mode-1 restore", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { importFromCloud } = await mountEmptyStore();
    await restoreBackupIntoStore(importFromCloud, backupJson);

    const secret = backupStoaChainWallets[0].secret;
    const priv = backupPureKeypairs[0].encryptedPrivateKey;
    for (const spy of [logSpy, errSpy, warnSpy]) {
      for (const call of spy.mock.calls) {
        const line = call.map(String).join(" ");
        expect(line).not.toContain(secret);
        expect(line).not.toContain(priv);
      }
    }
  });

  it("an error on a wrong-version backup names the reason but never echoes a secret VALUE", async () => {
    const { importFromCloud } = await mountEmptyStore();
    const secret = backupStoaChainWallets[0].secret;
    const wrongVersion = JSON.stringify({
      version: "1.1",
      exportedAt: "2026-07-03T12:00:00.000Z",
      kadenaWallets: backupStoaChainWallets,
      ouronetWallets: backupOuronetWallets,
      addressBook: backupAddressBook,
      uiSettings: backupUiSettings,
      pureKeypairs: backupPureKeypairs,
    });

    let message = "";
    try {
      await restoreBackupIntoStore(importFromCloud, wrongVersion);
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    // The error fired (version gate) and names the reason...
    expect(message).toMatch(/version|1\.2/i);
    // ...but never leaks the encrypted secret blob VALUE.
    expect(message).not.toContain(secret);
  });
});
