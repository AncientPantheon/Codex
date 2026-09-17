/**
 * RED matrix for the Arweave panel PURE KEYS area (E-10, N-06/N-10 —
 * funds/secret-critical).
 *
 * Replaces `e4-panel-keyring.test.tsx`, which pinned the OLD `KeyringArea`:
 * single-entry-only rename/export/delete (a real bug — every row acted on
 * `foreignKeys[0]`) and a paste-into-a-visible-textarea import flow (a
 * plaintext-on-screen leak the rest of this project has been eliminating).
 *
 * `PureKeysArea` fixes both: every action is targeted by the CLICKED row's
 * own `entry.id`, and import happens via a hidden `<input type="file">` (the
 * file's contents are read once, handed to `importArweaveKey`, and dropped —
 * never rendered). All protocol calls are FAKES; the throwaway keyfile
 * fixture is the only key material used, and its private JWK fields
 * (`d/p/q/dp/dq/qi`) are asserted ABSENT from the DOM at every point.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, within, waitFor, cleanup, fireEvent, act } from "@testing-library/react";

import { PureKeysArea } from "../src/panel/PureKeysArea";
import type { PureKeysAreaProps } from "../src/panel/PureKeysArea";

import { ArweavePanel } from "../src/panel/ArweavePanel";
import { ArweavePanelProvider, type ArweavePanelDeps } from "../src/panel/context";
import { ARWEAVE_CHAIN_ID } from "../src/address-book/chainId";
import type { LibraryEntry, LibraryStore } from "../src/library/types";

import { CodexLockedError } from "@ancientpantheon/codex-ouronet/errors";
import { CodexProvider } from "@ancientpantheon/codex-ouronet/provider";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import type { ForeignKeyEntry } from "@ancientpantheon/codex-core";
import type { ArweaveJwk, GatewayPool } from "@ancientpantheon/arweave-core";

import throwawayKeyfile from "./fixtures/throwaway-arweave-keyfile.json" assert { type: "json" };

/** The canonical address of the throwaway fixture (43-char base64url). */
const THROWAWAY_ADDRESS = "tzXauR_QBlPW3ZRey3xBzaiDqPqLfiqWk1SWmk2BjM4";
/** A second, distinct seedless key's id/address — for the per-row regression
 *  tests (the exact bug: every handler used to hardcode `foreignKeys[0]`). */
const SECOND_ADDRESS = "second-pure-key-address-0000000000000000000";

/** The private JWK fields that must NEVER reach the DOM. */
const PRIVATE_JWK_FIELDS = ["d", "p", "q", "dp", "dq", "qi"] as const;

const fixtureJwk = throwawayKeyfile as unknown as ArweaveJwk;
/** A second, distinguishable RSA-4096 JWK for the "reroll before save" tests
 *  (design.md §5's most important regression: `pendingKey` must be freely
 *  overwritable pre-save). Same length/alphabet as `fixtureJwk.n` (so it still
 *  decodes to the canonical 512-byte modulus `addressOf` requires) with one
 *  character flipped — real, distinct `addressOf` output, not a stub. */
const fixtureJwk2: ArweaveJwk = {
  ...fixtureJwk,
  n: `${fixtureJwk.n.slice(0, 10)}${fixtureJwk.n[10] === "A" ? "B" : "A"}${fixtureJwk.n.slice(11)}`,
};

/**
 * Real PKCS#8/SPKI PEM strings, derived ONCE (here, in `beforeAll`) from the
 * SAME throwaway RSA-4096 fixture the rest of this file already uses —
 * exactly the reusable fixture the PEM-import tests need, so nothing here
 * pays the cost of a fresh 4096-bit `generateKey()`. Built with the SAME
 * WebCrypto pkcs8/spki export `ArweaveSeedsArea.tsx`'s own `downloadKeyArtefact`
 * uses, so a real round-trip through the exact production PEM-parsing code
 * under test is exercised, not a stub.
 */
const RSA_ALG = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;

function abToB64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) out += String.fromCharCode(bytes[i]!);
  return btoa(out);
}

function pem(buffer: ArrayBuffer, label: string): string {
  const body = abToB64(buffer).match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${body.join("\n")}\n-----END ${label}-----\n`;
}

/** The throwaway fixture's own private-key PEM. */
let PRIVATE_PEM: string;
/** The throwaway fixture's own MATCHING public-key PEM. */
let PUBLIC_PEM: string;
/** `fixtureJwk2`'s public-key PEM — a real, validly-formed public key, just
 *  NOT the one that pairs with `PRIVATE_PEM` (real mismatch, not malformed
 *  input). */
let MISMATCHED_PUBLIC_PEM: string;

beforeAll(async () => {
  const privateKey = await crypto.subtle.importKey(
    "jwk",
    { ...fixtureJwk, ext: true } as JsonWebKey,
    RSA_ALG,
    true,
    ["sign"],
  );
  PRIVATE_PEM = pem(await crypto.subtle.exportKey("pkcs8", privateKey), "PRIVATE KEY");

  const publicKey = await crypto.subtle.importKey(
    "jwk",
    { kty: fixtureJwk.kty, n: fixtureJwk.n, e: fixtureJwk.e, ext: true } as JsonWebKey,
    RSA_ALG,
    true,
    ["verify"],
  );
  PUBLIC_PEM = pem(await crypto.subtle.exportKey("spki", publicKey), "PUBLIC KEY");

  const mismatchedPublicKey = await crypto.subtle.importKey(
    "jwk",
    { kty: fixtureJwk2.kty, n: fixtureJwk2.n, e: fixtureJwk2.e, ext: true } as JsonWebKey,
    RSA_ALG,
    true,
    ["verify"],
  );
  MISMATCHED_PUBLIC_PEM = pem(
    await crypto.subtle.exportKey("spki", mismatchedPublicKey),
    "PUBLIC KEY",
  );
});

/** A fake KeygenRunner matching the real `runKeygen(onProgress): Promise<ArweaveJwk>` seam. */
function makeFakeKeygenRunner(opts: { reject?: boolean } = {}) {
  return {
    runKeygen: vi.fn(async (onProgress: (p: { state: string }) => void): Promise<ArweaveJwk> => {
      onProgress({ state: "start" });
      onProgress({ state: "working" });
      if (opts.reject) {
        onProgress({ state: "error" });
        throw new Error("keygen failed");
      }
      onProgress({ state: "done" });
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
    label: "Pure Key One",
    address: THROWAWAY_ADDRESS,
    ...overrides,
  };
}

function makeSecondEntry(overrides: Partial<ForeignKeyEntry> = {}): ForeignKeyEntry {
  return {
    id: SECOND_ADDRESS,
    chainId: "arweave",
    encryptedKeyfile: "CIPHERTEXT-NOT-A-JWK-2",
    label: "Pure Key Two",
    address: SECOND_ADDRESS,
    ...overrides,
  };
}

/** The injected seam bundle `PureKeysArea` consumes. Fakes throughout. */
function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    foreignKeys: [makeEntry()],
    keygenRunner: makeFakeKeygenRunner(),
    generateArweaveKey: vi.fn(async () => makeEntry()),
    importArweaveKey: vi.fn(async () => makeEntry()),
    decryptArweaveKey: vi.fn(async () => fixtureJwk),
    addForeignKey: vi.fn(async (_entry: ForeignKeyEntry) => {}),
    renameForeignKey: vi.fn(async () => {}),
    deleteForeignKey: vi.fn(async () => {}),
    ...overrides,
  };
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PureKeysArea — list scope", () => {
  it("renders each SEEDLESS key with its label collapsed, and its address once expanded", () => {
    const entry = makeEntry();
    render(<PureKeysArea {...(makeProps({ foreignKeys: [entry] }) as unknown as PureKeysAreaProps)} />);
    expect(screen.getByText("Pure Key One")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId(`arweave-pure-key-toggle-${entry.id}`));
    expect(screen.getByText(THROWAWAY_ADDRESS)).toBeInTheDocument();
  });

  it("excludes a key that carries a seedId — that is Seeds'/Accounts' territory, not Pure Keys'", () => {
    const seeded = makeEntry({
      id: "seeded-key-id",
      label: "Seed-derived key",
      seedId: "seed-1",
    });
    render(
      <PureKeysArea
        {...(makeProps({ foreignKeys: [makeEntry(), seeded] }) as unknown as PureKeysAreaProps)}
      />,
    );
    expect(screen.getByText("Pure Key One")).toBeInTheDocument();
    expect(screen.queryByText("Seed-derived key")).not.toBeInTheDocument();
  });

  it("shows a visible empty state when zero seedless keys exist, even if seed-derived ones do", () => {
    const seeded = makeEntry({ id: "seeded-key-id", label: "Seed-derived key", seedId: "seed-1" });
    render(<PureKeysArea {...(makeProps({ foreignKeys: [seeded] }) as unknown as PureKeysAreaProps)} />);
    expect(screen.queryByText("Seed-derived key")).not.toBeInTheDocument();
    const empty = screen.getByTestId("arweave-pure-keys-empty");
    expect(empty.textContent).toMatch(/no pure keys yet/i);
  });
});

describe("PureKeysArea — collapsed/expand row presentation (Chainweb-style restyle)", () => {
  it("shows only collapsed headers (no address, no action icons) until a row is expanded, and expanding one row leaves the others collapsed", () => {
    const first = makeEntry();
    const second = makeSecondEntry();
    const props = makeProps({ foreignKeys: [first, second] });
    render(<PureKeysArea {...(props as unknown as PureKeysAreaProps)} />);

    // Collapsed: both labels show, but nothing else does — no address, no
    // action-icon affordances for either row.
    expect(screen.getByText("Pure Key One")).toBeInTheDocument();
    expect(screen.getByText("Pure Key Two")).toBeInTheDocument();
    expect(screen.queryByText(THROWAWAY_ADDRESS)).not.toBeInTheDocument();
    expect(screen.queryByText(SECOND_ADDRESS)).not.toBeInTheDocument();
    expect(screen.queryByTestId(`arweave-pure-key-copy-${first.id}`)).not.toBeInTheDocument();
    expect(screen.queryByTestId(`arweave-pure-key-rename-${first.id}`)).not.toBeInTheDocument();
    expect(screen.queryByTestId(`arweave-pure-key-export-${first.id}`)).not.toBeInTheDocument();
    expect(screen.queryByTestId(`arweave-pure-key-delete-${first.id}`)).not.toBeInTheDocument();
    expect(screen.queryByTestId(`arweave-pure-key-copy-${second.id}`)).not.toBeInTheDocument();

    // Expanding the FIRST row only reveals ITS address + action icons.
    fireEvent.click(screen.getByTestId(`arweave-pure-key-toggle-${first.id}`));
    expect(screen.getByText(THROWAWAY_ADDRESS)).toBeInTheDocument();
    expect(screen.getByTestId(`arweave-pure-key-copy-${first.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`arweave-pure-key-rename-${first.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`arweave-pure-key-export-${first.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`arweave-pure-key-delete-${first.id}`)).toBeInTheDocument();

    // The SECOND row, never toggled, stays fully collapsed.
    expect(screen.queryByText(SECOND_ADDRESS)).not.toBeInTheDocument();
    expect(screen.queryByTestId(`arweave-pure-key-copy-${second.id}`)).not.toBeInTheDocument();
    expect(screen.queryByTestId(`arweave-pure-key-rename-${second.id}`)).not.toBeInTheDocument();
    expect(screen.queryByTestId(`arweave-pure-key-export-${second.id}`)).not.toBeInTheDocument();
    expect(screen.queryByTestId(`arweave-pure-key-delete-${second.id}`)).not.toBeInTheDocument();
  });
});

describe("PureKeysArea — persistent 3-pill subtab bar (design.md §6)", () => {
  it("defaults to the list subtab, and each pill switches which body is visible", () => {
    const props = makeProps();
    render(<PureKeysArea {...(props as unknown as PureKeysAreaProps)} />);

    // Defaults to "list": the entry renders, and it's the only body mounted.
    expect(screen.getByText("Pure Key One")).toBeInTheDocument();
    expect(screen.queryByTestId("arweave-pure-key-generate-panel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("arweave-pure-key-import-open")).not.toBeInTheDocument();
    expect(screen.getByTestId("arweave-pure-keys-subtab-list")).toHaveAttribute("aria-pressed", "true");
    // The pill bar itself is always visible, regardless of the active subtab.
    expect(screen.getByTestId("arweave-pure-keys-subtab-generate")).toBeInTheDocument();
    expect(screen.getByTestId("arweave-pure-keys-subtab-import")).toBeInTheDocument();
    // The Keys pill's own label carries the live entry count.
    expect(screen.getByTestId("arweave-pure-keys-subtab-list")).toHaveTextContent("Keys (1)");

    // Clicking Generate hides the list and shows the empty-generate state.
    fireEvent.click(screen.getByTestId("arweave-pure-keys-subtab-generate"));
    expect(screen.queryByText("Pure Key One")).not.toBeInTheDocument();
    expect(screen.getByTestId("arweave-pure-key-generate-panel")).toBeInTheDocument();
    expect(screen.getByTestId("arweave-pure-keys-subtab-generate")).toHaveAttribute("aria-pressed", "true");

    // Clicking back to Keys returns to the list.
    fireEvent.click(screen.getByTestId("arweave-pure-keys-subtab-list"));
    expect(screen.getByText("Pure Key One")).toBeInTheDocument();
    expect(screen.queryByTestId("arweave-pure-key-generate-panel")).not.toBeInTheDocument();

    // Clicking Import shows the file-upload trigger and hides the list.
    fireEvent.click(screen.getByTestId("arweave-pure-keys-subtab-import"));
    expect(screen.getByTestId("arweave-pure-key-import-open")).toBeInTheDocument();
    expect(screen.queryByText("Pure Key One")).not.toBeInTheDocument();
  });
});

describe("PureKeysArea — Generate subtab state resets on navigation away (secret-hygiene, design.md §6)", () => {
  it("generating a candidate, switching to Keys WITHOUT saving, then back to Generate shows the EMPTY state again", async () => {
    const props = makeProps({ foreignKeys: [] });
    render(<PureKeysArea {...(props as unknown as PureKeysAreaProps)} />);

    fireEvent.click(screen.getByTestId("arweave-pure-keys-subtab-generate"));
    fireEvent.click(screen.getByTestId("arweave-pure-key-generate-start"));
    await waitFor(() => expect(screen.getByText(THROWAWAY_ADDRESS)).toBeInTheDocument());
    fireEvent.change(screen.getByTestId("arweave-pure-key-generate-label"), {
      target: { value: "Half-typed label" },
    });

    // Navigate away WITHOUT saving — this unmounts GenerateSubtab, discarding
    // its `pendingKey`/`label` state (no unsaved plaintext JWK lingers).
    fireEvent.click(screen.getByTestId("arweave-pure-keys-subtab-list"));
    expect(screen.getByTestId("arweave-pure-keys-empty")).toBeInTheDocument();

    // Coming back to Generate shows a genuinely fresh, empty panel — no
    // leftover pendingKey/address/label from the discarded candidate.
    fireEvent.click(screen.getByTestId("arweave-pure-keys-subtab-generate"));
    expect(screen.getByTestId("arweave-pure-key-generate-start")).toHaveTextContent(/generate random key/i);
    expect(screen.queryByText(THROWAWAY_ADDRESS)).not.toBeInTheDocument();
    expect(screen.queryByTestId("arweave-pure-key-generate-label")).not.toBeInTheDocument();
    expect(screen.queryByTestId("arweave-pure-key-generate-save")).not.toBeInTheDocument();
    expect(props.generateArweaveKey).not.toHaveBeenCalled();
    expect(props.addForeignKey).not.toHaveBeenCalled();
  });
});

describe("PureKeysArea — create random key (design.md §5 Generate/Save two-step flow)", () => {
  it("clicking the Generate pill opens the panel EMPTY — no key generated yet, list hidden", () => {
    const props = makeProps({ foreignKeys: [] });
    render(<PureKeysArea {...(props as unknown as PureKeysAreaProps)} />);

    fireEvent.click(screen.getByTestId("arweave-pure-keys-subtab-generate"));

    expect(screen.getByTestId("arweave-pure-key-generate-panel")).toBeInTheDocument();
    expect(screen.getByTestId("arweave-pure-key-generate-start")).toHaveTextContent(/generate random key/i);
    // No key yet: no address text, no RSA section, no label input, no Save button.
    expect(screen.queryByTestId("arweave-pure-key-generate-label")).not.toBeInTheDocument();
    expect(screen.queryByTestId("arweave-pure-key-generate-save")).not.toBeInTheDocument();
    // The import subtab's own body (its "Choose Keyfile" trigger) and the list
    // body are not visible at the same time as the Generate subtab (mirrors
    // Chainweb's List↔Generate switch) — but the persistent pill bar itself is.
    expect(screen.queryByTestId("arweave-pure-key-import-open")).not.toBeInTheDocument();
    expect(screen.queryByTestId("arweave-pure-keys-empty")).not.toBeInTheDocument();
    expect(screen.getByTestId("arweave-pure-keys-subtab-list")).toBeInTheDocument();
    expect(screen.getByTestId("arweave-pure-keys-subtab-import")).toBeInTheDocument();
  });

  it("clicking Generate Random Key shows progress, then reveals the address + label input + Save button on resolve", async () => {
    const keygenRunner = makeFakeKeygenRunner();
    const props = makeProps({ keygenRunner, foreignKeys: [] });
    render(<PureKeysArea {...(props as unknown as PureKeysAreaProps)} />);
    fireEvent.click(screen.getByTestId("arweave-pure-keys-subtab-generate"));

    const generateBtn = screen.getByTestId("arweave-pure-key-generate-start");
    fireEvent.click(generateBtn);

    await waitFor(() =>
      expect(screen.getByTestId("arweave-pure-key-progress-bar")).toBeInTheDocument(),
    );
    expect(generateBtn).toBeDisabled();
    await waitFor(() => expect(keygenRunner.runKeygen).toHaveBeenCalledTimes(1));

    await waitFor(() => expect(screen.getByText(THROWAWAY_ADDRESS)).toBeInTheDocument());
    expect(screen.getByTestId("arweave-pure-key-generate-label")).toBeInTheDocument();
    expect(screen.getByTestId("arweave-pure-key-generate-save")).toBeInTheDocument();
    expect(screen.getByTestId("arweave-pure-key-generate-start")).toHaveTextContent(/generate another/i);
    // Neither generateArweaveKey nor addForeignKey has run yet — generating is
    // NOT persisting (the entire point of the two-step rework).
    expect(props.generateArweaveKey).not.toHaveBeenCalled();
    expect(props.addForeignKey).not.toHaveBeenCalled();
    assertNoPrivateJwkInDom();
  });

  it("Generate Another TWICE, then Save, persists only the SECOND candidate JWK — free reroll before commit", async () => {
    const runKeygen = vi
      .fn()
      .mockResolvedValueOnce(fixtureJwk)
      .mockResolvedValueOnce(fixtureJwk2);
    const keygenRunner = { runKeygen };
    const generateArweaveKey = vi.fn(async () => makeEntry());
    const props = makeProps({ keygenRunner, generateArweaveKey, foreignKeys: [] });
    render(<PureKeysArea {...(props as unknown as PureKeysAreaProps)} />);
    fireEvent.click(screen.getByTestId("arweave-pure-keys-subtab-generate"));

    fireEvent.click(screen.getByTestId("arweave-pure-key-generate-start"));
    await waitFor(() => expect(runKeygen).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId("arweave-pure-key-generate-save")).toBeInTheDocument());

    // Generate Another — free, repeatable, no gate — overwrites the first candidate.
    fireEvent.click(screen.getByTestId("arweave-pure-key-generate-start"));
    await waitFor(() => expect(runKeygen).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByTestId("arweave-pure-key-generate-save")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("arweave-pure-key-generate-save"));

    await waitFor(() => expect(generateArweaveKey).toHaveBeenCalledTimes(1));
    expect(generateArweaveKey).toHaveBeenCalledWith(
      expect.objectContaining({ jwk: fixtureJwk2 }),
    );
    expect(generateArweaveKey).not.toHaveBeenCalledWith(
      expect.objectContaining({ jwk: fixtureJwk }),
    );
  });

  it("typing a label and clicking Save calls generateArweaveKey with that label, then addForeignKey", async () => {
    const props = makeProps({ foreignKeys: [] });
    render(<PureKeysArea {...(props as unknown as PureKeysAreaProps)} />);
    fireEvent.click(screen.getByTestId("arweave-pure-keys-subtab-generate"));
    fireEvent.click(screen.getByTestId("arweave-pure-key-generate-start"));
    await waitFor(() => expect(screen.getByTestId("arweave-pure-key-generate-save")).toBeInTheDocument());

    fireEvent.change(screen.getByTestId("arweave-pure-key-generate-label"), {
      target: { value: "My Cold Key" },
    });
    fireEvent.click(screen.getByTestId("arweave-pure-key-generate-save"));

    await waitFor(() =>
      expect(props.generateArweaveKey).toHaveBeenCalledWith({ jwk: fixtureJwk, label: "My Cold Key" }),
    );
    await waitFor(() => expect(props.addForeignKey).toHaveBeenCalledTimes(1));
    const appended = props.addForeignKey.mock.calls[0][0] as ForeignKeyEntry;
    expect(appended).not.toHaveProperty("d");
    // Saved successfully → panel closes back to the list.
    await waitFor(() =>
      expect(screen.queryByTestId("arweave-pure-key-generate-panel")).not.toBeInTheDocument(),
    );
    assertNoPrivateJwkInDom();
  });

  it("leaving the label blank falls back to 'Random Key <last6 of the derived address>' (design.md §2)", async () => {
    const generateArweaveKey = vi.fn(async () => makeEntry());
    const props = makeProps({ foreignKeys: [], generateArweaveKey });
    render(<PureKeysArea {...(props as unknown as PureKeysAreaProps)} />);
    fireEvent.click(screen.getByTestId("arweave-pure-keys-subtab-generate"));
    fireEvent.click(screen.getByTestId("arweave-pure-key-generate-start"));
    await waitFor(() => expect(screen.getByTestId("arweave-pure-key-generate-save")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("arweave-pure-key-generate-save"));

    await waitFor(() =>
      expect(generateArweaveKey).toHaveBeenCalledWith({
        jwk: fixtureJwk,
        label: `Random Key ${THROWAWAY_ADDRESS.slice(-6)}`,
      }),
    );
  });

  it("Cancel after generating discards the pending key and returns to the list WITHOUT saving", async () => {
    const props = makeProps({ foreignKeys: [] });
    render(<PureKeysArea {...(props as unknown as PureKeysAreaProps)} />);
    fireEvent.click(screen.getByTestId("arweave-pure-keys-subtab-generate"));
    fireEvent.click(screen.getByTestId("arweave-pure-key-generate-start"));
    await waitFor(() => expect(screen.getByTestId("arweave-pure-key-generate-save")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("arweave-pure-key-generate-cancel"));

    expect(screen.queryByTestId("arweave-pure-key-generate-panel")).not.toBeInTheDocument();
    // Back on the list subtab (empty state, since `foreignKeys` is empty).
    expect(screen.getByTestId("arweave-pure-keys-empty")).toBeInTheDocument();
    expect(props.generateArweaveKey).not.toHaveBeenCalled();
    expect(props.addForeignKey).not.toHaveBeenCalled();
  });

  it("Cancel is available before any key has been generated, closing the empty panel", () => {
    const props = makeProps({ foreignKeys: [] });
    render(<PureKeysArea {...(props as unknown as PureKeysAreaProps)} />);
    fireEvent.click(screen.getByTestId("arweave-pure-keys-subtab-generate"));

    fireEvent.click(screen.getByTestId("arweave-pure-key-generate-cancel"));

    expect(screen.queryByTestId("arweave-pure-key-generate-panel")).not.toBeInTheDocument();
    expect(screen.getByTestId("arweave-pure-keys-empty")).toBeInTheDocument();
  });

  it("a runKeygen rejection shows the existing create-error copy and keeps the panel open, retryable", async () => {
    const keygenRunner = makeFakeKeygenRunner({ reject: true });
    const props = makeProps({ keygenRunner, foreignKeys: [] });
    render(<PureKeysArea {...(props as unknown as PureKeysAreaProps)} />);
    fireEvent.click(screen.getByTestId("arweave-pure-keys-subtab-generate"));
    fireEvent.click(screen.getByTestId("arweave-pure-key-generate-start"));

    await waitFor(() =>
      expect(screen.getByTestId("arweave-pure-key-create-error")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("arweave-pure-key-generate-panel")).toBeInTheDocument();
    expect(props.generateArweaveKey).not.toHaveBeenCalled();
    // Retryable: the generate button is not left disabled after the failure.
    expect(screen.getByTestId("arweave-pure-key-generate-start")).not.toBeDisabled();
  });

  it("a generateArweaveKey/addForeignKey rejection during Save shows an error and preserves pendingKey + label for retry", async () => {
    const generateArweaveKey = vi.fn(async () => {
      throw new Error("save failed");
    });
    const props = makeProps({ foreignKeys: [], generateArweaveKey });
    render(<PureKeysArea {...(props as unknown as PureKeysAreaProps)} />);
    fireEvent.click(screen.getByTestId("arweave-pure-keys-subtab-generate"));
    fireEvent.click(screen.getByTestId("arweave-pure-key-generate-start"));
    await waitFor(() => expect(screen.getByTestId("arweave-pure-key-generate-save")).toBeInTheDocument());
    fireEvent.change(screen.getByTestId("arweave-pure-key-generate-label"), {
      target: { value: "Keep me" },
    });

    fireEvent.click(screen.getByTestId("arweave-pure-key-generate-save"));

    await waitFor(() =>
      expect(screen.getByTestId("arweave-pure-key-generate-save-error")).toBeInTheDocument(),
    );
    // pendingKey + typed label survive the failure so Save can be retried
    // without regenerating — no fresh keygenRunner.runKeygen call happened.
    expect(screen.getByText(THROWAWAY_ADDRESS)).toBeInTheDocument();
    expect((screen.getByTestId("arweave-pure-key-generate-label") as HTMLInputElement).value).toBe(
      "Keep me",
    );
    expect(screen.getByTestId("arweave-pure-key-generate-save")).not.toBeDisabled();
    expect(props.addForeignKey).not.toHaveBeenCalled();
  });

  it("mounts RsaParamsSection for the pending key, reveal-gated exactly like a stored row's", async () => {
    const props = makeProps({ foreignKeys: [] });
    render(<PureKeysArea {...(props as unknown as PureKeysAreaProps)} />);
    fireEvent.click(screen.getByTestId("arweave-pure-keys-subtab-generate"));
    fireEvent.click(screen.getByTestId("arweave-pure-key-generate-start"));
    await waitFor(() => expect(screen.getByTestId("arweave-pure-key-generate-save")).toBeInTheDocument());
    assertNoPrivateJwkInDom();

    fireEvent.click(
      screen.getByTestId(`arweave-pure-key-generate-params-toggle-${THROWAWAY_ADDRESS}`),
    );
    expect(
      screen.getByTestId(`arweave-pure-key-generate-params-${THROWAWAY_ADDRESS}`),
    ).toBeInTheDocument();
    assertNoPrivateJwkInDom();

    // The panel-wide reveal toggle exists (same reveal-gate `RsaParamsSection`'s
    // own tests rely on) — clicking it still never puts a raw base64url private
    // field value in the DOM (it renders decoded decimals behind the gate).
    fireEvent.click(screen.getByTestId(`arweave-pure-key-generate-reveal-${THROWAWAY_ADDRESS}`));
    assertNoPrivateJwkInDom();
  });
});

describe("PureKeysArea — import via file upload", () => {
  it("has no textarea/visible-paste import path", () => {
    render(<PureKeysArea {...(makeProps() as unknown as PureKeysAreaProps)} />);
    fireEvent.click(screen.getByTestId("arweave-pure-keys-subtab-import"));
    fireEvent.click(screen.getByTestId("arweave-pure-key-import-open"));
    expect(document.querySelector("textarea")).toBeNull();
    const fileInput = screen.getByTestId("arweave-pure-key-import-input");
    expect(fileInput).toHaveAttribute("type", "file");
  });

  it("reads a valid JSON keyfile file, imports it, and shows the resulting entry in the list", async () => {
    const importedEntry = makeSecondEntry();
    const props = makeProps({
      foreignKeys: [],
      importArweaveKey: vi.fn(async () => importedEntry),
    });
    render(<PureKeysArea {...(props as unknown as PureKeysAreaProps)} />);

    fireEvent.click(screen.getByTestId("arweave-pure-keys-subtab-import"));
    fireEvent.click(screen.getByTestId("arweave-pure-key-import-open"));
    const file = new File([JSON.stringify(fixtureJwk)], "keyfile.json", {
      type: "application/json",
    });
    fireEvent.change(screen.getByTestId("arweave-pure-key-import-input"), {
      target: { files: [file] },
    });

    await waitFor(() => expect(props.importArweaveKey).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(props.addForeignKey).toHaveBeenCalledWith(importedEntry));
    assertNoPrivateJwkInDom();
  });

  it("shows a distinct error for a file that isn't valid JSON, and imports nothing", async () => {
    const props = makeProps({ foreignKeys: [] });
    render(<PureKeysArea {...(props as unknown as PureKeysAreaProps)} />);

    fireEvent.click(screen.getByTestId("arweave-pure-keys-subtab-import"));
    fireEvent.click(screen.getByTestId("arweave-pure-key-import-open"));
    const badFile = new File(["not { json"], "bad.json", { type: "application/json" });
    fireEvent.change(screen.getByTestId("arweave-pure-key-import-input"), {
      target: { files: [badFile] },
    });

    await waitFor(() =>
      expect(screen.getByTestId("arweave-pure-key-import-invalid-json")).toBeInTheDocument(),
    );
    expect(props.importArweaveKey).not.toHaveBeenCalled();
    expect(props.addForeignKey).not.toHaveBeenCalled();
  });

  it("shows a distinct error carrying importArweaveKey's own message when it rejects valid JSON", async () => {
    const importArweaveKey = vi.fn(async () => {
      throw new Error("keyfile field 'd' is malformed");
    });
    const props = makeProps({ foreignKeys: [], importArweaveKey });
    render(<PureKeysArea {...(props as unknown as PureKeysAreaProps)} />);

    fireEvent.click(screen.getByTestId("arweave-pure-keys-subtab-import"));
    fireEvent.click(screen.getByTestId("arweave-pure-key-import-open"));
    const file = new File([JSON.stringify(fixtureJwk)], "keyfile.json", {
      type: "application/json",
    });
    fireEvent.change(screen.getByTestId("arweave-pure-key-import-input"), {
      target: { files: [file] },
    });

    const err = await screen.findByTestId("arweave-pure-key-import-rejected");
    expect(err.textContent).toMatch(/keyfile field 'd' is malformed/);
    expect(props.addForeignKey).not.toHaveBeenCalled();
  });
});

describe("PureKeysArea — PEM import (Part B, additive to the JSON-keyfile import)", () => {
  function openPemImport(): void {
    fireEvent.click(screen.getByTestId("arweave-pure-keys-subtab-import"));
  }

  function choosePrivatePem(text: string, name = "private.pem"): void {
    const file = new File([text], name, { type: "application/x-pem-file" });
    fireEvent.click(screen.getByTestId("arweave-pure-key-import-pem-private-open"));
    fireEvent.change(screen.getByTestId("arweave-pure-key-import-pem-private-input"), {
      target: { files: [file] },
    });
  }

  function choosePublicPem(text: string, name = "public.pem"): void {
    const file = new File([text], name, { type: "application/x-pem-file" });
    fireEvent.click(screen.getByTestId("arweave-pure-key-import-pem-public-open"));
    fireEvent.change(screen.getByTestId("arweave-pure-key-import-pem-public-input"), {
      target: { files: [file] },
    });
  }

  it("a valid matching PEM pair shows a live preview of the derived address, and Save persists the assembled JWK", async () => {
    const importArweaveKey = vi.fn(async () => makeEntry({ label: undefined }));
    const props = makeProps({ foreignKeys: [], importArweaveKey });
    render(<PureKeysArea {...(props as unknown as PureKeysAreaProps)} />);
    openPemImport();

    choosePrivatePem(PRIVATE_PEM);
    choosePublicPem(PUBLIC_PEM);

    await waitFor(() =>
      expect(screen.getByTestId("arweave-pure-key-import-pem-status")).toHaveAttribute(
        "data-state",
        "ok",
      ),
    );
    // The address is derived on the spot, from the assembled JWK — the same
    // `addressOf` the random-generate flow already uses for its own preview.
    await waitFor(() =>
      expect(screen.getByTestId("arweave-pure-key-import-pem-preview-address").textContent).toBe(
        THROWAWAY_ADDRESS,
      ),
    );

    fireEvent.change(screen.getByTestId("arweave-pure-key-import-pem-label"), {
      target: { value: "My PEM key" },
    });
    expect(screen.getByTestId("arweave-pure-key-import-pem-save")).not.toBeDisabled();
    fireEvent.click(screen.getByTestId("arweave-pure-key-import-pem-save"));

    // The assembled 9-field JWK, byte-for-byte the fixture it was derived
    // from — proof the PKCS#8/SPKI round-trip lost nothing.
    await waitFor(() =>
      expect(importArweaveKey).toHaveBeenCalledWith(fixtureJwk, { label: "My PEM key" }),
    );
    await waitFor(() => expect(props.addForeignKey).toHaveBeenCalledTimes(1));
    assertNoPrivateJwkInDom();

    // Success closes back to the list (Generate subtab's own pattern).
    await waitFor(() =>
      expect(screen.queryByTestId("arweave-pure-key-import-pem-panel")).not.toBeInTheDocument(),
    );
  });

  it("a mismatched PEM pair blocks Save with a clear error, and never calls importArweaveKey", async () => {
    const importArweaveKey = vi.fn(async () => makeEntry());
    const props = makeProps({ foreignKeys: [], importArweaveKey });
    render(<PureKeysArea {...(props as unknown as PureKeysAreaProps)} />);
    openPemImport();

    choosePrivatePem(PRIVATE_PEM);
    choosePublicPem(MISMATCHED_PUBLIC_PEM);

    const status = await screen.findByTestId("arweave-pure-key-import-pem-status");
    await waitFor(() => expect(status).toHaveAttribute("data-state", "err"));
    expect(status.textContent).toMatch(/mismatch/i);
    expect(screen.queryByTestId("arweave-pure-key-import-pem-preview-address")).not.toBeInTheDocument();
    expect(screen.getByTestId("arweave-pure-key-import-pem-save")).toBeDisabled();

    fireEvent.click(screen.getByTestId("arweave-pure-key-import-pem-save"));
    expect(importArweaveKey).not.toHaveBeenCalled();
    expect(props.addForeignKey).not.toHaveBeenCalled();
  });

  it("a malformed (non-PEM) file shows a per-file error without crashing, for either half independently", async () => {
    const props = makeProps({ foreignKeys: [] });
    render(<PureKeysArea {...(props as unknown as PureKeysAreaProps)} />);
    openPemImport();

    choosePrivatePem("this is not a pem file at all");
    const privateError = await screen.findByTestId("arweave-pure-key-import-pem-private-error");
    expect(privateError).toBeInTheDocument();
    // The panel is still fully rendered — a bad file never crashes the tree.
    expect(screen.getByTestId("arweave-pure-key-import-pem-panel")).toBeInTheDocument();

    choosePublicPem("also not a pem file");
    const publicError = await screen.findByTestId("arweave-pure-key-import-pem-public-error");
    expect(publicError).toBeInTheDocument();
    expect(screen.getByTestId("arweave-pure-key-import-pem-save")).toBeDisabled();
  });

  it("replacing one half after a successful match re-validates against the new pair (free reroll)", async () => {
    const props = makeProps({ foreignKeys: [] });
    render(<PureKeysArea {...(props as unknown as PureKeysAreaProps)} />);
    openPemImport();

    choosePrivatePem(PRIVATE_PEM);
    choosePublicPem(PUBLIC_PEM);
    await waitFor(() =>
      expect(screen.getByTestId("arweave-pure-key-import-pem-status")).toHaveAttribute(
        "data-state",
        "ok",
      ),
    );
    await screen.findByTestId("arweave-pure-key-import-pem-preview-address");

    // Replace the public half with one that does NOT match — re-validation
    // must run against the CURRENT private half, flipping to "err" and
    // dropping the now-stale preview.
    choosePublicPem(MISMATCHED_PUBLIC_PEM);

    await waitFor(() =>
      expect(screen.getByTestId("arweave-pure-key-import-pem-status")).toHaveAttribute(
        "data-state",
        "err",
      ),
    );
    expect(screen.queryByTestId("arweave-pure-key-import-pem-preview-address")).not.toBeInTheDocument();
    expect(screen.getByTestId("arweave-pure-key-import-pem-save")).toBeDisabled();
  });

  it("shows visible per-file feedback the instant EACH half is imported — before the other half is chosen at all", async () => {
    const props = makeProps({ foreignKeys: [] });
    render(<PureKeysArea {...(props as unknown as PureKeysAreaProps)} />);
    openPemImport();

    // Nothing loaded yet — no feedback of either kind.
    expect(screen.queryByTestId("arweave-pure-key-import-pem-private-loaded")).not.toBeInTheDocument();
    expect(screen.queryByTestId("arweave-pure-key-import-pem-public-loaded")).not.toBeInTheDocument();

    // Import ONLY the private half — it must show its own confirmation right
    // away, with no dependency on the public half existing at all.
    choosePrivatePem(PRIVATE_PEM);
    const privateLoaded = await screen.findByTestId("arweave-pure-key-import-pem-private-loaded");
    expect(privateLoaded.textContent).toMatch(/private key loaded/i);
    expect(screen.queryByTestId("arweave-pure-key-import-pem-public-loaded")).not.toBeInTheDocument();
    // Still not enough to save — the combined cross-check is still idle.
    expect(screen.getByTestId("arweave-pure-key-import-pem-save")).toBeDisabled();

    // Now import the public half too — it gets its OWN confirmation, and the
    // private one's is still there (importing one half never disturbs the other).
    choosePublicPem(PUBLIC_PEM);
    const publicLoaded = await screen.findByTestId("arweave-pure-key-import-pem-public-loaded");
    expect(publicLoaded.textContent).toMatch(/public key loaded/i);
    expect(screen.getByTestId("arweave-pure-key-import-pem-private-loaded")).toBeInTheDocument();
  });

  it("a Clear button discards ONE already-picked half without touching the other, before or after a match", async () => {
    const props = makeProps({ foreignKeys: [] });
    render(<PureKeysArea {...(props as unknown as PureKeysAreaProps)} />);
    openPemImport();

    // Clear while only the private half is loaded.
    choosePrivatePem(PRIVATE_PEM);
    await screen.findByTestId("arweave-pure-key-import-pem-private-loaded");
    fireEvent.click(screen.getByTestId("arweave-pure-key-import-pem-private-clear"));
    expect(screen.queryByTestId("arweave-pure-key-import-pem-private-loaded")).not.toBeInTheDocument();
    // The Clear button itself disappears once there's nothing left to clear.
    expect(screen.queryByTestId("arweave-pure-key-import-pem-private-clear")).not.toBeInTheDocument();

    // Load both, confirm a match, then Clear the public half — the match
    // must be revoked (Save disabled again) without needing to touch the
    // still-loaded private half.
    choosePrivatePem(PRIVATE_PEM);
    choosePublicPem(PUBLIC_PEM);
    await waitFor(() =>
      expect(screen.getByTestId("arweave-pure-key-import-pem-status")).toHaveAttribute(
        "data-state",
        "ok",
      ),
    );
    fireEvent.click(screen.getByTestId("arweave-pure-key-import-pem-public-clear"));
    expect(screen.queryByTestId("arweave-pure-key-import-pem-public-loaded")).not.toBeInTheDocument();
    expect(screen.getByTestId("arweave-pure-key-import-pem-private-loaded")).toBeInTheDocument();
    expect(screen.getByTestId("arweave-pure-key-import-pem-save")).toBeDisabled();
    expect(screen.queryByTestId("arweave-pure-key-import-pem-preview-address")).not.toBeInTheDocument();
  });
});

describe("PureKeysArea — per-row rename (regression: the old bug hardcoded foreignKeys[0])", () => {
  it("renaming the SECOND row calls renameForeignKey with the SECOND entry's id, not the first", async () => {
    const first = makeEntry();
    const second = makeSecondEntry();
    const props = makeProps({ foreignKeys: [first, second] });
    render(<PureKeysArea {...(props as unknown as PureKeysAreaProps)} />);

    fireEvent.click(screen.getByTestId(`arweave-pure-key-toggle-${second.id}`));
    fireEvent.click(screen.getByTestId(`arweave-pure-key-rename-${second.id}`));
    fireEvent.change(screen.getByTestId(`arweave-pure-key-rename-input-${second.id}`), {
      target: { value: "Renamed second key" },
    });
    fireEvent.click(screen.getByTestId(`arweave-pure-key-rename-submit-${second.id}`));

    await waitFor(() =>
      expect(props.renameForeignKey).toHaveBeenCalledWith(second.id, "Renamed second key"),
    );
    expect(props.renameForeignKey).not.toHaveBeenCalledWith(first.id, expect.anything());
  });
});

describe("PureKeysArea — per-row export (regression + secret-critical)", () => {
  it("exporting the SECOND row calls decryptArweaveKey with the SECOND entry and delivers a transient download", async () => {
    const createObjectURL = vi.fn(() => "blob:fake-object-url");
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    const first = makeEntry();
    const second = makeSecondEntry();
    const decryptArweaveKey = vi.fn(async () => fixtureJwk);
    const props = makeProps({ foreignKeys: [first, second], decryptArweaveKey });
    render(<PureKeysArea {...(props as unknown as PureKeysAreaProps)} />);

    fireEvent.click(screen.getByTestId(`arweave-pure-key-toggle-${second.id}`));
    fireEvent.click(screen.getByTestId(`arweave-pure-key-export-${second.id}`));
    expect(screen.getByTestId(`arweave-pure-key-export-warning-${second.id}`)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId(`arweave-pure-key-export-confirm-${second.id}`));

    await waitFor(() => expect(decryptArweaveKey).toHaveBeenCalledWith(second));
    expect(decryptArweaveKey).not.toHaveBeenCalledWith(first);
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith("blob:fake-object-url"));
    expect(clickSpy).toHaveBeenCalled();

    assertNoPrivateJwkInDom();
    clickSpy.mockRestore();
  });

  it("a CodexLockedError from decryptArweaveKey on that row shows the lock prompt scoped to that row only", async () => {
    const first = makeEntry();
    const second = makeSecondEntry();
    const decryptArweaveKey = vi.fn(async (entry: ForeignKeyEntry) => {
      if (entry.id === second.id) throw new CodexLockedError("decryptArweaveKey");
      return fixtureJwk;
    });
    const props = makeProps({ foreignKeys: [first, second], decryptArweaveKey });
    render(<PureKeysArea {...(props as unknown as PureKeysAreaProps)} />);

    fireEvent.click(screen.getByTestId(`arweave-pure-key-toggle-${second.id}`));
    fireEvent.click(screen.getByTestId(`arweave-pure-key-export-${second.id}`));
    fireEvent.click(screen.getByTestId(`arweave-pure-key-export-confirm-${second.id}`));

    await waitFor(() =>
      expect(screen.getByTestId(`arweave-pure-key-locked-${second.id}`)).toBeInTheDocument(),
    );
    expect(screen.queryByTestId(`arweave-pure-key-locked-${first.id}`)).not.toBeInTheDocument();
    assertNoPrivateJwkInDom();
  });
});

describe("PureKeysArea — per-row delete (regression: the old bug hardcoded foreignKeys[0])", () => {
  it("deleting the SECOND row's two-step confirm calls deleteForeignKey with the SECOND entry's id", async () => {
    const first = makeEntry();
    const second = makeSecondEntry();
    const props = makeProps({ foreignKeys: [first, second] });
    render(<PureKeysArea {...(props as unknown as PureKeysAreaProps)} />);

    fireEvent.click(screen.getByTestId(`arweave-pure-key-toggle-${second.id}`));
    fireEvent.click(screen.getByTestId(`arweave-pure-key-delete-${second.id}`));
    const confirmPanel = screen.getByTestId(`arweave-pure-key-delete-confirm-panel-${second.id}`);
    fireEvent.click(within(confirmPanel).getByTestId(`arweave-pure-key-delete-confirm-${second.id}`));

    await waitFor(() => expect(props.deleteForeignKey).toHaveBeenCalledWith(second.id));
    expect(props.deleteForeignKey).not.toHaveBeenCalledWith(first.id);
  });

  it("cancel closes the confirm panel without deleting", () => {
    const first = makeEntry();
    const second = makeSecondEntry();
    const props = makeProps({ foreignKeys: [first, second] });
    render(<PureKeysArea {...(props as unknown as PureKeysAreaProps)} />);

    fireEvent.click(screen.getByTestId(`arweave-pure-key-toggle-${second.id}`));
    fireEvent.click(screen.getByTestId(`arweave-pure-key-delete-${second.id}`));
    fireEvent.click(screen.getByTestId(`arweave-pure-key-delete-cancel-${second.id}`));

    expect(screen.queryByTestId(`arweave-pure-key-delete-confirm-panel-${second.id}`)).not.toBeInTheDocument();
    expect(props.deleteForeignKey).not.toHaveBeenCalled();
  });
});

describe("PureKeysArea — copy", () => {
  it("copies the row's own address to the clipboard", async () => {
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    const first = makeEntry();
    const second = makeSecondEntry();
    const props = makeProps({ foreignKeys: [first, second] });
    render(<PureKeysArea {...(props as unknown as PureKeysAreaProps)} />);

    fireEvent.click(screen.getByTestId(`arweave-pure-key-toggle-${second.id}`));
    fireEvent.click(screen.getByTestId(`arweave-pure-key-copy-${second.id}`));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(SECOND_ADDRESS));
    expect(writeText).not.toHaveBeenCalledWith(THROWAWAY_ADDRESS);
  });
});

describe("PureKeysArea — RSA parameters (reused RsaParamsSection)", () => {
  it("mounts the RsaParamsSection toggle for a row and decrypts via the injected decryptArweaveKey on open", async () => {
    const entry = makeEntry();
    const decryptArweaveKey = vi.fn(async () => fixtureJwk);
    const props = makeProps({ foreignKeys: [entry], decryptArweaveKey });
    render(<PureKeysArea {...(props as unknown as PureKeysAreaProps)} />);

    fireEvent.click(screen.getByTestId(`arweave-pure-key-toggle-${entry.id}`));
    fireEvent.click(screen.getByTestId(`arweave-pure-key-params-toggle-${entry.id}`));

    await waitFor(() => expect(decryptArweaveKey).toHaveBeenCalledWith(entry));
    await waitFor(() =>
      expect(screen.getByTestId(`arweave-pure-key-params-${entry.id}`)).toBeInTheDocument(),
    );
    // Public field `n` renders as a decoded decimal, never the raw base64url.
    expect(screen.queryByText(fixtureJwk.n)).not.toBeInTheDocument();
    assertNoPrivateJwkInDom();
  });

  it("places the RSA-parameters toggle on the SAME row as the action icons, before them, so an unopened panel costs no extra row", () => {
    const entry = makeEntry();
    const props = makeProps({ foreignKeys: [entry] });
    render(<PureKeysArea {...(props as unknown as PureKeysAreaProps)} />);

    fireEvent.click(screen.getByTestId(`arweave-pure-key-toggle-${entry.id}`));

    const toggle = screen.getByTestId(`arweave-pure-key-params-toggle-${entry.id}`);
    const copyIcon = screen.getByTestId(`arweave-pure-key-copy-${entry.id}`);
    // Same flex row: they share an immediate parent...
    expect(toggle.parentElement).toBe(copyIcon.parentElement?.parentElement);
    // ...and the toggle comes BEFORE the icon group in DOM order (address —
    // toggle — icons), per the requested layout.
    expect(
      toggle.compareDocumentPosition(copyIcon) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Collapsed by default: the panel body is not mounted alongside it.
    expect(screen.queryByTestId(`arweave-pure-key-params-${entry.id}`)).not.toBeInTheDocument();
  });

  it("expands the RSA-parameters panel on its own row below once the inline toggle is clicked", async () => {
    const entry = makeEntry();
    const decryptArweaveKey = vi.fn(async () => fixtureJwk);
    const props = makeProps({ foreignKeys: [entry], decryptArweaveKey });
    render(<PureKeysArea {...(props as unknown as PureKeysAreaProps)} />);

    fireEvent.click(screen.getByTestId(`arweave-pure-key-toggle-${entry.id}`));
    const toggle = screen.getByTestId(`arweave-pure-key-params-toggle-${entry.id}`);
    fireEvent.click(toggle);

    const panel = await screen.findByTestId(`arweave-pure-key-params-${entry.id}`);
    // The panel is NOT inside the address/icons row the toggle lives in — it
    // sits on its own row below, as a sibling of that row.
    expect(panel.parentElement).not.toBe(toggle.parentElement);
    expect(
      toggle.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe("PureKeysArea — distinct default labels (design.md §2)", () => {
  // The random-generate half of this behaviour moved to the "create random
  // key" describe block above (design.md §5's Generate/Save two-step flow):
  // "leaving the label blank falls back to 'Random Key <last6 of the derived
  // address>'" now covers it directly against the new panel, since the
  // default label is derived from `pendingKey.address` (from `addressOf`),
  // not from whatever `generateArweaveKey`'s mock happens to return — the old
  // one-click test below asserted the OLD immediate-persist shape and no
  // longer applies. The import half is untouched by this task and stays here.

  it("defaults an imported entry with no label to 'Imported Key <last6 of its address>'", async () => {
    const address = "imported-address-cccccccccccccccccccccCCC333";
    const importedEntry: ForeignKeyEntry = {
      id: address,
      chainId: "arweave",
      encryptedKeyfile: "CT",
      address,
    };
    const importArweaveKey = vi.fn(async () => importedEntry);
    const addForeignKey = vi.fn(async (_entry: ForeignKeyEntry) => {});
    const props = makeProps({ foreignKeys: [], importArweaveKey, addForeignKey });
    render(<PureKeysArea {...(props as unknown as PureKeysAreaProps)} />);

    fireEvent.click(screen.getByTestId("arweave-pure-keys-subtab-import"));
    fireEvent.click(screen.getByTestId("arweave-pure-key-import-open"));
    const file = new File([JSON.stringify(fixtureJwk)], "keyfile.json", {
      type: "application/json",
    });
    fireEvent.change(screen.getByTestId("arweave-pure-key-import-input"), {
      target: { files: [file] },
    });

    await waitFor(() => expect(addForeignKey).toHaveBeenCalledTimes(1));
    const appended = addForeignKey.mock.calls[0]![0] as ForeignKeyEntry;
    expect(appended.label).toBe(`Imported Key ${address.slice(-6)}`);
  });

  it("never overwrites a label the seam itself already supplied (import case, unchanged from before)", async () => {
    // Regression guard for the existing behaviour: `makeSecondEntry()` already
    // carries "Pure Key Two" — the default-label logic must be a no-op here.
    const importedEntry = makeSecondEntry();
    const props = makeProps({
      foreignKeys: [],
      importArweaveKey: vi.fn(async () => importedEntry),
    });
    render(<PureKeysArea {...(props as unknown as PureKeysAreaProps)} />);

    fireEvent.click(screen.getByTestId("arweave-pure-keys-subtab-import"));
    fireEvent.click(screen.getByTestId("arweave-pure-key-import-open"));
    const file = new File([JSON.stringify(fixtureJwk)], "keyfile.json", {
      type: "application/json",
    });
    fireEvent.change(screen.getByTestId("arweave-pure-key-import-input"), {
      target: { files: [file] },
    });

    await waitFor(() => expect(props.addForeignKey).toHaveBeenCalledWith(importedEntry));
  });
});

describe("PureKeysArea — balance-aware delete guard (design.md §3, Unprotected tier)", () => {
  it("behaves exactly as before (plain confirm/cancel) when getBalance is omitted", () => {
    const entry = makeEntry();
    const props = makeProps({ foreignKeys: [entry] });
    render(<PureKeysArea {...(props as unknown as PureKeysAreaProps)} />);

    fireEvent.click(screen.getByTestId(`arweave-pure-key-toggle-${entry.id}`));
    fireEvent.click(screen.getByTestId(`arweave-pure-key-delete-${entry.id}`));
    expect(screen.getByTestId(`arweave-pure-key-delete-confirm-panel-${entry.id}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`arweave-pure-key-delete-checking-${entry.id}`)).not.toBeInTheDocument();
  });

  it("shows a checking-balance state while getBalance is pending, then the plain confirm panel once it resolves 0n", async () => {
    const entry = makeEntry();
    let resolveBalance: (value: bigint) => void = () => {};
    const getBalance = vi.fn(
      () => new Promise<bigint>((resolve) => { resolveBalance = resolve; }),
    );
    const props = makeProps({ foreignKeys: [entry], getBalance });
    render(<PureKeysArea {...(props as unknown as PureKeysAreaProps)} />);

    fireEvent.click(screen.getByTestId(`arweave-pure-key-toggle-${entry.id}`));
    fireEvent.click(screen.getByTestId(`arweave-pure-key-delete-${entry.id}`));
    expect(screen.getByTestId(`arweave-pure-key-delete-checking-${entry.id}`)).toBeInTheDocument();
    expect(getBalance).toHaveBeenCalledWith(entry.address);

    await act(async () => {
      resolveBalance(0n);
    });

    expect(screen.getByTestId(`arweave-pure-key-delete-confirm-panel-${entry.id}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`arweave-pure-key-delete-checking-${entry.id}`)).not.toBeInTheDocument();
  });

  it("falls back to the plain confirm panel when getBalance rejects — a balance-read failure must never block deletion", async () => {
    const entry = makeEntry();
    const getBalance = vi.fn(async (): Promise<bigint> => {
      throw new Error("network unreachable");
    });
    const props = makeProps({ foreignKeys: [entry], getBalance });
    render(<PureKeysArea {...(props as unknown as PureKeysAreaProps)} />);

    fireEvent.click(screen.getByTestId(`arweave-pure-key-toggle-${entry.id}`));
    fireEvent.click(screen.getByTestId(`arweave-pure-key-delete-${entry.id}`));

    await waitFor(() =>
      expect(screen.getByTestId(`arweave-pure-key-delete-confirm-panel-${entry.id}`)).toBeInTheDocument(),
    );
  });

  it("blocks deletion with no delete affordance when balance resolves > 0n, even if the dismiss button is the only click available", async () => {
    const entry = makeEntry();
    const getBalance = vi.fn(async () => 5_000_000_000_000n); // 5 AR in winston
    const props = makeProps({ foreignKeys: [entry], getBalance });
    render(<PureKeysArea {...(props as unknown as PureKeysAreaProps)} />);

    fireEvent.click(screen.getByTestId(`arweave-pure-key-toggle-${entry.id}`));
    fireEvent.click(screen.getByTestId(`arweave-pure-key-delete-${entry.id}`));

    const blocked = await screen.findByTestId(`arweave-pure-key-delete-blocked-${entry.id}`);
    expect(blocked.textContent).toMatch(/5 AR/);
    expect(blocked.textContent).toMatch(/can never be regenerated/i);
    expect(screen.queryByTestId(`arweave-pure-key-delete-confirm-${entry.id}`)).not.toBeInTheDocument();
    expect(screen.queryByTestId(`arweave-pure-key-delete-confirm-panel-${entry.id}`)).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId(`arweave-pure-key-delete-dismiss-${entry.id}`));
    expect(screen.queryByTestId(`arweave-pure-key-delete-blocked-${entry.id}`)).not.toBeInTheDocument();
    expect(props.deleteForeignKey).not.toHaveBeenCalled();
  });
});

describe("PureKeysArea — random keygen elapsed-time progress bar (design.md §4)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("ramps its data-percent upward as fake elapsed time advances, capped at 92", async () => {
    vi.useFakeTimers();
    let resolveKeygen: (jwk: ArweaveJwk) => void = () => {};
    const keygenRunner = {
      runKeygen: vi.fn(() => new Promise<ArweaveJwk>((resolve) => { resolveKeygen = resolve; })),
    };
    const props = makeProps({ keygenRunner, foreignKeys: [] });
    render(<PureKeysArea {...(props as unknown as PureKeysAreaProps)} />);

    fireEvent.click(screen.getByTestId("arweave-pure-keys-subtab-generate"));
    fireEvent.click(screen.getByTestId("arweave-pure-key-generate-start"));

    const bar = screen.getByTestId("arweave-pure-key-progress-bar");
    expect(screen.getByTestId("arweave-pure-key-progress-status")).toHaveTextContent(
      /generating a random rsa-4096 key/i,
    );
    const startPercent = Number(bar.getAttribute("data-percent"));

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    const midPercent = Number(screen.getByTestId("arweave-pure-key-progress-bar").getAttribute("data-percent"));
    expect(midPercent).toBeGreaterThan(startPercent);

    act(() => {
      vi.advanceTimersByTime(20000);
    });
    const cappedPercent = Number(
      screen.getByTestId("arweave-pure-key-progress-bar").getAttribute("data-percent"),
    );
    expect(cappedPercent).toBe(92);

    resolveKeygen(fixtureJwk);
  });
});

// ── Mounting into the real panel ──

const ARWEAVE_ADDRESS = THROWAWAY_ADDRESS;
const fakePool = { pick: () => ARWEAVE_ADDRESS } as unknown as GatewayPool;

function makeLibraryStore(): LibraryStore {
  return {
    append: vi.fn(async () => {}),
    get: vi.fn(async () => undefined),
    updateStatus: vi.fn(async () => {}),
    list: vi.fn(async () => []),
  } as unknown as LibraryStore;
}

function makePanelDeps(overrides: Partial<ArweavePanelDeps> = {}): ArweavePanelDeps {
  const libraryRows: LibraryEntry[] = [];
  return {
    address: ARWEAVE_ADDRESS,
    foreignKeys: [makeEntry()],
    keygenRunner: makeFakeKeygenRunner(),
    generateArweaveKey: vi.fn(async () => makeEntry()),
    importArweaveKey: vi.fn(async () => makeEntry()),
    decryptArweaveKey: vi.fn(async () => fixtureJwk),
    addForeignKey: vi.fn(async () => {}),
    renameForeignKey: vi.fn(async () => {}),
    deleteForeignKey: vi.fn(async () => {}),
    getBalance: vi.fn(async () => 0n),
    send: vi.fn(async () => ({ id: ARWEAVE_ADDRESS, reward: 0n })),
    sendFrom: vi.fn(async () => ({ id: ARWEAVE_ADDRESS, reward: 0n })),
    estimateFee: vi.fn(async () => 100_000_000n),
    pollStatus: vi.fn(async () => "final" as const),
    uploadAndTrack: vi.fn(async () => ({
      id: "id",
      itemId: "item",
      ownerAddress: ARWEAVE_ADDRESS,
      tags: [],
    })),
    listLibrary: vi.fn(async () => libraryRows),
    openUrl: vi.fn((id: string) => `https://arweave.net/${id}`),
    rebuildLibrary: vi.fn(async () => {}),
    libraryStore: makeLibraryStore(),
    pool: fakePool,
    addressBook: [],
    ...overrides,
  };
}

describe("PureKeysArea — mounted for real inside ArweavePanel's pure-keys category", () => {
  it("replaces the generic placeholder with the real PureKeysArea", () => {
    const deps = makePanelDeps();
    // `SendArweaveModal` (Accounts category) calls `useEnsureCodexUnlocked`
    // (`codex-ouronet/zbom`), which requires a `<CodexProvider>` ancestor —
    // the SAME one `apps/codex-playground` always wraps `ArweavePanel` in.
    render(
      <CodexProvider adapter={new MemoryCodexAdapter("dev")}>
        <ArweavePanelProvider deps={deps}>
          <ArweavePanel id={ARWEAVE_CHAIN_ID} />
        </ArweavePanelProvider>
      </CodexProvider>,
    );
    fireEvent.click(screen.getByTestId("arweave-subtab-pure-keys"));
    expect(screen.queryByTestId("arweave-category-empty-pure-keys")).toBeNull();
    expect(screen.getByTestId("arweave-pure-keys-area")).toBeInTheDocument();
  });

  it("degrades to a visible 'not available' state rather than crashing when no provider is wired", () => {
    render(<ArweavePanel id={ARWEAVE_CHAIN_ID} />);
    fireEvent.click(screen.getByTestId("arweave-subtab-pure-keys"));
    expect(screen.getByTestId("arweave-pure-keys-unavailable")).toBeInTheDocument();
  });
});
