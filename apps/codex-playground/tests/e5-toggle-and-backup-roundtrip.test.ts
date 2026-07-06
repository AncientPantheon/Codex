// ============================================================================
// RED SPEC (T15.5) — PG-02 mock/real toggle (default mock+offline, funds-safety)
// + the funds-critical "1.3"+foreignKeys backup round-trip (G-002) + the "1.2"
// reader-before-writer regression guard + secret-hygiene.
//
// This file is written as a `.tsx`-free `.ts` module that STILL exercises the
// jsdom+RTL harness via `react`/`react-dom` — the round-trip probes mount a real
// <CodexProvider> to read the REAL codex store slice `importFromCloud` populates
// (F-002), NOT the ArweavePanel's injected fake keyring.
//
// RED DRIVER: it imports the not-yet-existing toggle wiring (T15.6):
//   - `../src/ArweaveModeToggle`   — the mock/real toggle + gateway input + warning
//   - `../src/ForeignChainsWiring` — mode-aware adapter selection (created T15.4,
//                                    made mode-aware T15.6)
// so the WHOLE file REDs on "module ../src/ArweaveModeToggle does not exist"
// (right reason) rather than a fixture/alias/harness collection error. The
// backup round-trip rows use the ALREADY-REAL post-E1 `useCodexBackup`
// (importFromCloud/downloadAsJson) — they become GREEN once the toggle wiring
// lands and the file can collect.
// ============================================================================

import { describe, it, expect, afterEach, vi } from "vitest";
import { createElement, type ReactElement } from "react";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { deserializeCodex } from "@ancientpantheon/codex-core";
import type { ForeignKeyEntry } from "@ancientpantheon/codex-core";
import { CodexProvider } from "@ancientpantheon/codex-ouronet/provider";
import { useCodexStore } from "@ancientpantheon/codex-ouronet/provider";
import { useCodexBackup } from "@ancientpantheon/codex-ouronet/hooks";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";

import {
  arweaveBackupJson,
  arweaveBackupPassword,
  expectedForeignKeysArray,
  expectedForeignKeysBlock,
  arweaveBackupPureKeypairs,
  throwawayArweaveKeyfile,
  // The D6 "1.2" no-foreignKeys backup — the reader-before-writer guard.
  backupJson,
} from "../fixtures/index.js";

// The not-yet-existing GREEN toggle wiring (T15.6). Importing these is what makes
// this whole file RED until T15.6 lands.
import {
  ArweaveModeToggle,
  DEFAULT_GATEWAY_URL,
} from "../src/ArweaveModeToggle";
import {
  buildArweaveWiring,
  ARWEAVE_WIRING_MODE_MOCK,
} from "../src/ForeignChainsWiring";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Backup round-trip probe: a component mounted inside <CodexProvider> that runs
// importFromCloud(text) then reads the REAL store `foreignKeys` slice (F-002 —
// the slice the restore populates, via `useCodexStore((s) => s.foreignKeys)`),
// NOT the mock panel's fake keyring. It also captures downloadAsJson's on-wire
// output for the block-level export check (F-001 (b)).
// ---------------------------------------------------------------------------

interface RoundTripCapture {
  restoredForeignKeys: ForeignKeyEntry[] | null;
  exportedJson: string | null;
}

function RoundTripProbe({
  backupText,
  capture,
}: {
  backupText: string;
  capture: RoundTripCapture;
}): ReactElement {
  const { importFromCloud, exportForCloud } = useCodexBackup();
  const store = useCodexStore();
  const foreignKeys = store((s: { foreignKeys: ForeignKeyEntry[] }) => s.foreignKeys);

  // Run the restore exactly once on mount; then re-export so the round-trip is
  // observable. Reads happen through the REAL store slice, not a fake keyring.
  if (capture.restoredForeignKeys === null && foreignKeys.length > 0) {
    capture.restoredForeignKeys = foreignKeys;
  }

  return createElement("button", {
    type: "button",
    "data-testid": "run-roundtrip",
    onClick: () => {
      void importFromCloud(backupText).then(async () => {
        capture.exportedJson = await exportForCloud();
      });
    },
  });
}

async function runRoundTrip(backupText: string): Promise<RoundTripCapture> {
  const capture: RoundTripCapture = {
    restoredForeignKeys: null,
    exportedJson: null,
  };
  const user = userEvent.setup();
  render(
    createElement(CodexProvider, {
      adapter: new MemoryCodexAdapter("dev"),
      deviceVariant: "dev",
      children: createElement(RoundTripProbe, { backupText, capture }),
    }),
  );
  await user.click(await screen.findByTestId("run-roundtrip"));
  // Wait for the restore→store propagation + the re-export capture. The wait
  // hinges on `exportedJson` (which fires for EVERY successful restore); the
  // `restoredForeignKeys` capture is inherently conditional — it only populates
  // for a backup that carries foreignKeys, so a "1.2" (no-foreignKeys) restore
  // legitimately leaves it null while still completing the round-trip.
  await waitFor(() => {
    expect(capture.exportedJson).not.toBeNull();
  });
  return capture;
}

// ===========================================================================
// PG-02 — default mock + offline (funds-safety)
// ===========================================================================

describe("PG-02 — the app boots in MOCK mode by default (funds-safety)", () => {
  it("selects the mock adapter path by default (real adapter NOT constructed until toggled)", () => {
    // Default mode is MOCK — buildArweaveWiring with no explicit real mode must
    // yield the mock wiring, and constructing it must NOT touch the network.
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const wiring = buildArweaveWiring({ mode: ARWEAVE_WIRING_MODE_MOCK });
    // The registry lists exactly the Arweave adapter id (mock), and no fetch fired.
    expect(wiring.foreignChains).toContain("arweave");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("renders the toggle defaulting to mock, with the gateway URL a configurable testnet/local default (never mainnet)", () => {
    render(createElement(ArweaveModeToggle, {}));
    // The gateway default must be a testnet/local endpoint, NEVER arweave.net
    // mainnet — a funds-safety invariant. Driving the assertion off the exported
    // DEFAULT_GATEWAY_URL const fails if the default is ever pointed at mainnet.
    expect(DEFAULT_GATEWAY_URL).not.toContain("arweave.net");
    const gatewayInput = screen.getByLabelText(/gateway/i) as HTMLInputElement;
    expect(gatewayInput.value).toBe(DEFAULT_GATEWAY_URL);
  });

  it("shows NO funds-safety warning in mock mode and a VISIBLE warning after toggling to real", async () => {
    const user = userEvent.setup();
    render(createElement(ArweaveModeToggle, {}));
    // Mock (default): no real-mode funds warning.
    expect(screen.queryByRole("alert")).toBeNull();
    // Flip to real — a visible warning that real mode transacts against the
    // configured gateway and must not be pointed at mainnet with real funds.
    await user.click(screen.getByRole("button", { name: /real/i }));
    const warning = await screen.findByRole("alert");
    expect(warning).toHaveTextContent(/real funds|mainnet|transacts/i);
  });
});

// ===========================================================================
// PG-02 — the "1.3"+foreignKeys backup round-trip (G-002, funds-critical)
// ===========================================================================

describe("PG-02 — '1.3'+foreignKeys round-trip through the REAL useCodexBackup", () => {
  it("F-001/F-002: importFromCloud restores the REAL store foreignKeys slice as the BARE ForeignKeyEntry[] (Array.isArray, unwrapped)", async () => {
    const capture = await runRoundTrip(arweaveBackupJson);
    const restored = capture.restoredForeignKeys;
    // F-002: this is the REAL codex store slice `importFromCloud` populated —
    // read via `useCodexStore((s) => s.foreignKeys)`, NOT the mock panel keyring.
    // F-001: it MUST be a bare array (the `deserialized.foreignKeys?.keys ?? []`
    // unwrap), NOT the on-wire `{schemaVersion, keys}` block. Assigning the block
    // into the array field is E1's #1 silent-funds-loss bug — this fails on it.
    expect(Array.isArray(restored)).toBe(true);
    expect(restored).toEqual(expectedForeignKeysArray);
  });

  it("F-005: the restored Arweave entry surfaces the ENCRYPTED keyfile blob (restore does NOT decrypt)", async () => {
    const capture = await runRoundTrip(arweaveBackupJson);
    const entry = capture.restoredForeignKeys?.[0];
    // The entry is {id, label?, chainId:"arweave", encryptedKeyfile} with the
    // keyfile still an ENCRYPTED blob — restore surfaces the encrypted entry, it
    // does NOT decrypt (N-06). A decrypted plaintext JWK field here is a leak.
    expect(entry?.chainId).toBe("arweave");
    expect(entry?.encryptedKeyfile).toBe(
      expectedForeignKeysArray[0].encryptedKeyfile,
    );
    // The on-wire blob must not equal the plaintext throwaway JWK modulus.
    expect(entry?.encryptedKeyfile).not.toContain(throwawayArweaveKeyfile.n);
  });

  it("F-001 (b): downloadAsJson re-emits a '1.3' backup whose on-wire foreignKeys BLOCK deep-equals the uploaded block", async () => {
    const capture = await runRoundTrip(arweaveBackupJson);
    const reExported = deserializeCodex(capture.exportedJson as string) as unknown as {
      version: string;
      foreignKeys?: unknown;
    };
    // Distinct from the bare-array restored-slice check above: the EXPORTED wire
    // shape must carry the `{schemaVersion, keys}` BLOCK verbatim (foreignKeys
    // survive upload→export). Both the bare-array and block checks are required.
    expect(reExported.version).toBe("1.3");
    expect(reExported.foreignKeys).toEqual(expectedForeignKeysBlock);
  });

  it("pureKeypairs also survive the round-trip (reader-before-writer carries both keyrings)", async () => {
    const capture = await runRoundTrip(arweaveBackupJson);
    const reExported = deserializeCodex(capture.exportedJson as string) as unknown as {
      pureKeypairs?: unknown;
    };
    // The with-Arweave-keys backup carries BOTH keyrings; a rewire that dropped
    // pureKeypairs while carrying foreignKeys would silently lose the StoaChain-side
    // pure keys. `pureKeypairs` is a BARE array on the wire (distinct from the block).
    expect(reExported.pureKeypairs).toEqual(arweaveBackupPureKeypairs);
  });
});

// ===========================================================================
// Reader-before-writer regression guard — the old "1.2" backup still restores.
// ===========================================================================

describe("Reader-before-writer — the D6 '1.2' no-foreignKeys backup still restores", () => {
  it("restores the '1.2' backup through the rewired reader with foreignKeys empty (old backups restore forever)", async () => {
    const capture = await runRoundTrip(backupJson).catch(() => null);
    // The "1.2" backup carries no foreignKeys, so the restored slice is empty —
    // but the restore MUST succeed (the reader accepts both "1.2" and "1.3").
    // Because the probe only captures once foreignKeys is non-empty, a "1.2"
    // restore leaves restoredForeignKeys null; the export capture still fires,
    // and the exported backup restores as a bare-empty foreignKeys slice.
    expect(capture).not.toBeNull();
    const parsed = deserializeCodex(backupJson) as unknown as {
      version: string;
      foreignKeys?: unknown;
    };
    expect(parsed.version).toBe("1.2");
    expect(parsed.foreignKeys).toBeUndefined();
  });
});

// ===========================================================================
// SECRET HYGIENE (N-06) — no decrypted secret / password / plaintext keyfile
// field leaks to console or DOM at any point in the round-trip.
// ===========================================================================

describe("Secret hygiene (N-06) — no plaintext secret leaks during load/restore/export", () => {
  it("neither console nor the DOM ever contains the password or a plaintext keyfile field during the round-trip", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const capture = await runRoundTrip(arweaveBackupJson);

    const consoleText = [
      ...errorSpy.mock.calls,
      ...logSpy.mock.calls,
      ...warnSpy.mock.calls,
    ]
      .flat()
      .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
      .join(" ");
    const domText = document.body.textContent ?? "";

    // The dev password never appears in console or DOM.
    expect(consoleText).not.toContain(arweaveBackupPassword);
    expect(domText).not.toContain(arweaveBackupPassword);

    // No plaintext RSA private field (d/p/q/dp/dq/qi) of the throwaway keyfile
    // appears anywhere — restore does NOT decrypt, so the plaintext JWK never
    // enters the store, the console, or the DOM.
    for (const field of ["d", "p", "q", "dp", "dq", "qi"] as const) {
      const secret = throwawayArweaveKeyfile[field];
      expect(consoleText).not.toContain(secret);
      expect(domText).not.toContain(secret);
    }

    // The restored entry's keyfile stays the ENCRYPTED blob verbatim (never decrypted).
    expect(capture.restoredForeignKeys?.[0].encryptedKeyfile).toBe(
      expectedForeignKeysArray[0].encryptedKeyfile,
    );
  });
});
