/**
 * RED matrix for the Arweave panel KEYRING area (E-10, N-06/N-10 — funds/secret-critical).
 *
 * Pins the `KeyringArea` component contract that T14.7 (shell/context) provisions
 * and T14.8 fills. ALL protocol calls are FAKES — no real keyring, no real worker,
 * no real network. The throwaway keyfile fixture is the ONLY key material used, and
 * its private JWK fields (`d/p/q/dp/dq/qi`) are asserted ABSENT from the DOM at
 * every point (FIX-5/FIX-6).
 *
 * These tests FAIL RED because `../src/panel/KeyringArea` does not exist yet.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor, cleanup, fireEvent } from "@testing-library/react";

// The not-yet-existing panel area (provisioned by T14.7, filled by T14.8). The
// import resolution failure is the RED signal.
import { KeyringArea } from "../src/panel/KeyringArea";

import { CodexLockedError } from "@ancientpantheon/codex-ouronet/errors";
import type { ForeignKeyEntry } from "@ancientpantheon/codex-core";
import type { ArweaveJwk } from "@ancientpantheon/arweave-core";

import throwawayKeyfile from "./fixtures/throwaway-arweave-keyfile.json" assert { type: "json" };

/** The canonical address of the throwaway fixture (43-char base64url). */
const THROWAWAY_ADDRESS = "tzXauR_QBlPW3ZRey3xBzaiDqPqLfiqWk1SWmk2BjM4";

/** The private JWK fields that must NEVER reach the DOM. */
const PRIVATE_JWK_FIELDS = ["d", "p", "q", "dp", "dq", "qi"] as const;

const fixtureJwk = throwawayKeyfile as unknown as ArweaveJwk;

/** A minimal coarse KeygenProgress the fake runner scripts. */
type KeygenProgress = { phase: "start" | "working" | "done" | "error" };

/** A fake KeygenRunner matching the real `runKeygen(onProgress): Promise<ArweaveJwk>`
 *  seam — resolves the fixture JWK after emitting coarse progress, or rejects. */
function makeFakeKeygenRunner(opts: { reject?: boolean } = {}) {
  return {
    runKeygen: vi.fn(async (onProgress: (p: KeygenProgress) => void): Promise<ArweaveJwk> => {
      onProgress({ phase: "start" });
      onProgress({ phase: "working" });
      if (opts.reject) {
        onProgress({ phase: "error" });
        throw new Error("keygen failed");
      }
      onProgress({ phase: "done" });
      return fixtureJwk;
    }),
  };
}

/** Assert NO private JWK field value appears anywhere in the rendered tree. */
function assertNoPrivateJwkInDom(): void {
  const html = document.body.innerHTML;
  for (const field of PRIVATE_JWK_FIELDS) {
    const value = (fixtureJwk as unknown as Record<string, string>)[field];
    expect(html).not.toContain(value);
  }
}

function makeEntry(overrides: Partial<ForeignKeyEntry> = {}): ForeignKeyEntry {
  return {
    id: THROWAWAY_ADDRESS,
    chainId: "arweave",
    encryptedKeyfile: "CIPHERTEXT-NOT-A-JWK",
    label: "My Arweave key",
    ...overrides,
  };
}

/** The injected seam bundle the KeyringArea consumes. Fakes throughout. */
function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    foreignKeys: [makeEntry()],
    keygenRunner: makeFakeKeygenRunner(),
    generateArweaveKey: vi.fn(async () => makeEntry()),
    importArweaveKey: vi.fn(async () => makeEntry()),
    decryptArweaveKey: vi.fn(async () => fixtureJwk),
    addForeignKey: vi.fn(async () => {}),
    renameForeignKey: vi.fn(async () => {}),
    deleteForeignKey: vi.fn(async () => {}),
    ...overrides,
  };
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("KeyringArea — list", () => {
  it("renders each foreign key with its label and full 43-char address", () => {
    render(<KeyringArea {...makeProps()} />);
    expect(screen.getByText("My Arweave key")).toBeInTheDocument();
    // The full canonical address is shown (not truncated to fewer chars).
    expect(screen.getByText(THROWAWAY_ADDRESS)).toBeInTheDocument();
    expect(THROWAWAY_ADDRESS).toHaveLength(43);
  });

  it("shows an empty-state when the keyring has no entries", () => {
    render(<KeyringArea {...makeProps({ foreignKeys: [] })} />);
    // No key label rendered; an explicit empty affordance is present.
    expect(screen.queryByText("My Arweave key")).not.toBeInTheDocument();
    expect(screen.getByTestId("keyring-empty")).toBeInTheDocument();
  });

  it("exposes a copy control that writes the 43-char address to the clipboard", async () => {
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    render(<KeyringArea {...makeProps()} />);
    fireEvent.click(screen.getByTestId("keyring-copy-address"));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(THROWAWAY_ADDRESS));
  });
});

describe("KeyringArea — create via off-thread keygen", () => {
  it("runs the injected KeygenRunner, shows coarse progress while pending, and disables re-entry", async () => {
    const keygenRunner = makeFakeKeygenRunner();
    const props = makeProps({ keygenRunner });
    render(<KeyringArea {...props} />);

    const createBtn = screen.getByTestId("keyring-create");
    fireEvent.click(createBtn);

    // Coarse-progress indicator visible + button non-re-entrant while pending.
    await waitFor(() => expect(screen.getByTestId("keygen-progress")).toBeInTheDocument());
    expect(createBtn).toBeDisabled();

    await waitFor(() => expect(keygenRunner.runKeygen).toHaveBeenCalledTimes(1));
  });

  it("on resolve hands the plaintext JWK to generateArweaveKey/addForeignKey then clears it", async () => {
    const props = makeProps();
    render(<KeyringArea {...props} />);
    fireEvent.click(screen.getByTestId("keyring-create"));

    // The resolved JWK is handed to the encrypt-at-rest keyring seam (the spy
    // receives the plaintext material), which persists the ciphertext entry.
    await waitFor(() =>
      expect(props.generateArweaveKey).toHaveBeenCalledWith(
        expect.objectContaining({ jwk: fixtureJwk }),
      ),
    );
    await waitFor(() => expect(props.addForeignKey).toHaveBeenCalledTimes(1));

    // The ciphertext entry — never a plaintext JWK — is what addForeignKey persists.
    const appended = props.addForeignKey.mock.calls[0][0] as ForeignKeyEntry;
    expect(appended).not.toHaveProperty("d");
    expect(appended.encryptedKeyfile).toBe("CIPHERTEXT-NOT-A-JWK");
  });

  it("on keygen reject renders an error state and adds NO key", async () => {
    const keygenRunner = makeFakeKeygenRunner({ reject: true });
    const props = makeProps({ keygenRunner });
    render(<KeyringArea {...props} />);
    fireEvent.click(screen.getByTestId("keyring-create"));

    await waitFor(() => expect(screen.getByTestId("keygen-error")).toBeInTheDocument());
    expect(props.addForeignKey).not.toHaveBeenCalled();
  });
});

describe("KeyringArea — JWK hygiene (FIX-5)", () => {
  it("never renders any private JWK field value at any point in the create flow", async () => {
    const props = makeProps();
    render(<KeyringArea {...props} />);
    assertNoPrivateJwkInDom();

    fireEvent.click(screen.getByTestId("keyring-create"));
    await waitFor(() => expect(props.addForeignKey).toHaveBeenCalled());

    // The plaintext JWK was handed to the keyring seam and dropped — no re-render
    // exposes it in the DOM.
    assertNoPrivateJwkInDom();
  });
});

describe("KeyringArea — import", () => {
  it("validates a pasted keyfile via importArweaveKey and adds it encrypted", async () => {
    const props = makeProps();
    render(<KeyringArea {...props} />);

    fireEvent.click(screen.getByTestId("keyring-import-open"));
    fireEvent.change(screen.getByTestId("keyring-import-input"), {
      target: { value: JSON.stringify(fixtureJwk) },
    });
    fireEvent.click(screen.getByTestId("keyring-import-submit"));

    await waitFor(() => expect(props.importArweaveKey).toHaveBeenCalledTimes(1));
    assertNoPrivateJwkInDom();
  });

  it("surfaces an InvalidKeyfileError as a clean UI error that does not echo the pasted value", async () => {
    class InvalidKeyfileError extends Error {
      override readonly name = "InvalidKeyfileError";
    }
    const importArweaveKey = vi.fn(async () => {
      throw new InvalidKeyfileError("keyfile field 'd' is malformed");
    });
    const props = makeProps({ importArweaveKey });
    render(<KeyringArea {...props} />);

    fireEvent.click(screen.getByTestId("keyring-import-open"));
    const secret = "SUPER-SECRET-PASTED-VALUE-abc123";
    fireEvent.change(screen.getByTestId("keyring-import-input"), {
      target: { value: secret },
    });
    fireEvent.click(screen.getByTestId("keyring-import-submit"));

    const err = await screen.findByTestId("keyring-import-error");
    // The error is shown but must NOT echo the pasted secret value.
    expect(within(err).queryByText(new RegExp(secret))).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(secret);
  });
});

describe("KeyringArea — rename", () => {
  it("calls renameForeignKey with the entry id and the new label", async () => {
    const props = makeProps();
    render(<KeyringArea {...props} />);

    fireEvent.click(screen.getByTestId("keyring-rename-open"));
    fireEvent.change(screen.getByTestId("keyring-rename-input"), {
      target: { value: "Renamed key" },
    });
    fireEvent.click(screen.getByTestId("keyring-rename-submit"));

    await waitFor(() =>
      expect(props.renameForeignKey).toHaveBeenCalledWith(THROWAWAY_ADDRESS, "Renamed key"),
    );
  });
});

describe("KeyringArea — export (FIX-6, secret-critical)", () => {
  it("is warning-gated and unlock-gated: decryptArweaveKey drives it, a lock prompt surfaces on CodexLockedError", async () => {
    const decryptArweaveKey = vi.fn(async () => {
      throw new CodexLockedError("decryptArweaveKey");
    });
    const props = makeProps({ decryptArweaveKey });
    render(<KeyringArea {...props} />);

    fireEvent.click(screen.getByTestId("keyring-export-open"));
    // The warning about exposing the private keyfile gates the action.
    expect(screen.getByTestId("keyring-export-warning")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("keyring-export-confirm"));

    // A locked codex surfaces a lock prompt (not a crash, not the key).
    await waitFor(() => expect(screen.getByTestId("keyring-locked-prompt")).toBeInTheDocument());
    assertNoPrivateJwkInDom();
  });

  it("delivers the keyfile as a transient object-URL download, revoked after, never in a copyable DOM node", async () => {
    const createObjectURL = vi.fn(() => "blob:fake-object-url");
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    const props = makeProps();
    render(<KeyringArea {...props} />);

    fireEvent.click(screen.getByTestId("keyring-export-open"));
    fireEvent.click(screen.getByTestId("keyring-export-confirm"));

    await waitFor(() => expect(props.decryptArweaveKey).toHaveBeenCalledTimes(1));
    // The download uses a transient object-URL that is revoked immediately after.
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith("blob:fake-object-url"));
    expect(clickSpy).toHaveBeenCalled();

    // The plaintext keyfile is NEVER placed in an input/textarea/copyable node.
    for (const el of Array.from(document.querySelectorAll("input, textarea"))) {
      const value = (el as HTMLInputElement | HTMLTextAreaElement).value;
      for (const field of PRIVATE_JWK_FIELDS) {
        expect(value).not.toContain((fixtureJwk as unknown as Record<string, string>)[field]);
      }
    }
    assertNoPrivateJwkInDom();
    clickSpy.mockRestore();
  });
});

describe("KeyringArea — delete", () => {
  it("confirms then calls deleteForeignKey with the entry id", async () => {
    const props = makeProps();
    render(<KeyringArea {...props} />);

    fireEvent.click(screen.getByTestId("keyring-delete-open"));
    fireEvent.click(screen.getByTestId("keyring-delete-confirm"));

    await waitFor(() =>
      expect(props.deleteForeignKey).toHaveBeenCalledWith(THROWAWAY_ADDRESS),
    );
  });
});
