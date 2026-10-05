/**
 * RED matrix for `UploadWizard` (arweave-upload-wizard, owner correction
 * pass — SECOND round, design.md's "Addendum 2").
 *
 * Pins the REVISED step flow and every behavior the owner's first
 * correction pass demanded, PLUS this second live-tested round's fixes:
 *   - FOUR steps, in order: Account → Category & Mode (combined) → Files →
 *     Review & Cost. One accumulating draft — Back never resets a prior
 *     selection, and each step's Next stays disabled until that step's own
 *     required selection(s) are made.
 *   - Category & Mode: picking a category pre-selects a RECOMMENDED (still
 *     freely changeable) Public/Encrypted default — `nft-data` → Public is
 *     the owner's own explicit case. Choosing Encrypted (by recommendation
 *     or override) reveals the Ouronet-account encryptor sub-picker in the
 *     SAME step, defaulting to the `isDefault`-flagged account.
 *   - Round 2: the category and asset-type pickers are custom ACCENT-styled
 *     controls (a grouped dropdown and a flat pill row, respectively) —
 *     NOT native `<select>` elements. App-Id/App-Version show only for
 *     `software-code`/`website-dapp-hosting`. The dedicated metadata-file
 *     input/disclaimer is gone — a second file for metadata is just a
 *     second file in the normal Files step. `nft-data` gets a clarifying
 *     label near the asset-type picker, "(Recommended)"/"(Not recommended)"
 *     labels on Public/Encrypted, and an nft-data-specific warning when
 *     Encrypted is chosen. An advisory (never blocking) extension-mismatch
 *     warning appears per file whose extension doesn't fit the chosen asset
 *     type.
 *   - Files: "Add File" adds one file per click, capped at 10 with a clear
 *     inline message past the cap; "Add Folder" is repeatable and prefixes
 *     each pick's own (collision-proofed) folder name onto its files' paths
 *     so two folder picks never collide; a running total size updates live
 *     as files/folders are added or removed; both individual files and
 *     whole folders can be removed.
 *   - Review & Cost: a REAL `estimateUploadCostAr` call (loading/success/
 *     error, never a placeholder), the chosen account's live balance (via
 *     the new `getBalance` prop), and a computed estimated remaining
 *     balance that disables Confirm with a clear message when it would go
 *     negative.
 *   - Confirm & Upload gates on the new optional `ensureCodexUnlocked`:
 *     resolves `true` → proceeds; resolves `false` → stays on Review with
 *     no error; omitted → proceeds exactly as before.
 *   - The final Confirm & Upload still threads EVERY draft field into
 *     `uploadAndTrack`/`uploadFilesAndTrack` — category/assetType/appId/
 *     appVersion, and (Encrypted only) the exact `UploadEncryptFor` shape
 *     `library/flow.ts` accepts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent, within, act } from "@testing-library/react";

import { createGatewayPool, CODEX_ENCRYPTION_VERSION_CURRENT } from "@ancientpantheon/arweave-core";
import type { ForeignKeyEntry } from "@ancientpantheon/codex-core";

import { UploadWizard, type UploadWizardSelection } from "../src/panel/UploadWizard.js";
import type { UploadTrackResult } from "../src/panel/UploadArea.js";
import type { ArweaveSeedAccountSource } from "../src/panel/ArweaveSeedsArea.js";
import { UPLOAD_PERMANENCE_WARNING } from "../src/library/constants.js";
// `arweave-upload-dry-run` T3: `DryRunResult` is T2's own plain result
// shape — not re-exported by any barrel (confirmed by reading
// `src/panel/index.ts`/`src/library/index.ts` in full), so it rides the
// SAME relative-path-into-package-source convention this file's own
// `UploadWizard.js` import already uses.
import type { DryRunResult } from "../src/library/streaming/dryRunUpload.js";

const ACCOUNT_A = "acct-address-AAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const ACCOUNT_B = "acct-address-BBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const DATA_ITEM_ID = "aXcDefGhIjKlMnOpQrStUvWxYz0123456789_-ABCDE";
const MANIFEST_ID = "mMnNoOpPqQrRsStTuUvVwWxXyYzZ0123456789_-ABC";

const instantSleep = async () => {};

function makeFile(name = "note.txt", size = 10): File {
  return new File([new Uint8Array(size)], name, { type: "text/plain" });
}

/** A folder-picked file, carrying the non-standard `webkitRelativePath`
 *  real `webkitdirectory` input deliveries set — jsdom's plain `File`
 *  constructor has no such property, so tests simulating a folder pick set
 *  it explicitly, exactly like a real browser's own FileList would. */
function makeFolderFile(relativePath: string, size = 10): File {
  const name = relativePath.slice(relativePath.lastIndexOf("/") + 1);
  const file = new File([new Uint8Array(size)], name, { type: "image/png" });
  Object.defineProperty(file, "webkitRelativePath", { value: relativePath, configurable: true });
  return file;
}

/** A `File` whose reported `.size` is a large value WITHOUT actually
 *  allocating that many bytes (the cap tests — both the streaming-removed
 *  cap and the OPFS-fallback 2 GiB cap, T3 `arweave-streaming-ui` — need
 *  file sizes at and past multi-gigabyte boundaries; allocating real
 *  multi-hundred-MB `Uint8Array`s per test would be slow and memory-heavy
 *  for no benefit, since this component only ever reads `.size`, never the
 *  file's actual bytes, when validating any size cap). Overrides the
 *  otherwise-real (tiny) backing `File`'s own `size` getter via
 *  `Object.defineProperty`, the SAME technique `makeFolderFile` above
 *  already uses for `webkitRelativePath`. */
function makeFileWithSize(name: string, size: number): File {
  const file = new File([new Uint8Array(1)], name, { type: "application/octet-stream" });
  Object.defineProperty(file, "size", { value: size, configurable: true });
  return file;
}

function makeAccounts(): ForeignKeyEntry[] {
  return [
    { id: ACCOUNT_A, chainId: "arweave:mainnet", encryptedKeyfile: "cipher-a", label: "Everyday wallet" },
    { id: ACCOUNT_B, chainId: "arweave:mainnet", encryptedKeyfile: "cipher-b", label: "Savings wallet" },
  ];
}

/** Two Ouronet accounts, neither flagged — the "fall back to the first
 *  entry" case. A separate fixture below flags one, for the "prefers the
 *  flagged entry" case. */
function makeOuronetAccountsNoDefault(): ArweaveSeedAccountSource[] {
  return [
    { id: "ouro-1", label: "Ouro One", account: { address: "Ѻ.ouro-one-address" } },
    { id: "ouro-2", label: "Ouro Two", account: { address: "Ѻ.ouro-two-address" } },
  ];
}

function makeOuronetAccountsWithDefault(): ArweaveSeedAccountSource[] {
  return [
    { id: "ouro-1", label: "Ouro One", account: { address: "Ѻ.ouro-one-address" } },
    { id: "ouro-2", label: "Ouro Two", account: { address: "Ѻ.ouro-two-address" }, isDefault: true },
  ];
}

function makePool() {
  return createGatewayPool({ endpoints: ["https://a.example"], sleep: instantSleep });
}

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    accounts: makeAccounts(),
    ouronetAccounts: makeOuronetAccountsNoDefault(),
    pool: makePool(),
    uploadAndTrack: vi.fn(async (_file: File, _selection: UploadWizardSelection, _accountId: string) => ({
      id: DATA_ITEM_ID,
      itemId: "item-uuid-1",
      ownerAddress: ACCOUNT_A,
      tags: [],
    })),
    uploadFilesAndTrack: vi.fn(async (_files: File[], _selection: UploadWizardSelection, _accountId: string) => ({
      manifestId: MANIFEST_ID,
      fileIds: [
        { path: "a.txt", id: "aAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa" },
        { path: "b.txt", id: "bBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBb" },
      ],
      uploadId: "shared-batch-upload-id",
    })),
    openUrl: vi.fn((id: string) => `https://healthy.example/${id}`),
    onClose: vi.fn(),
    revealAccountSecret: vi.fn(async (_accountId: string) => "revealed-secret"),
    getPrice: vi.fn(async () => "66846281419287301199"),
    // T3 (`arweave-streaming-ui`): deterministic "unsupported" by default —
    // every pre-T3 test (and every test that doesn't care about streaming)
    // keeps exercising the OPFS-fallback 2 GiB cap exactly as before,
    // without depending on jsdom's own (absent) real `navigator.storage`.
    // Tests that specifically exercise the streaming-supported path
    // override this explicitly.
    isStreamingUploadSupported: vi.fn(async () => false),
    ...overrides,
  };
}

/** Awaits the Upload Wizard's own `isStreamingUploadSupported()` mount
 *  effect resolving (and its state update landing) — the OPFS-support probe
 *  runs once per wizard session and is awaited explicitly by every test that
 *  needs its SETTLED result (not whatever transiently renders before it
 *  resolves). Mirrors this file's own `waitFor`-based "wait for the settled
 *  async state" convention used for `getBalance` elsewhere in this suite. */
async function flushStreamingSupportDetection(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Round 2: the category picker is a custom ACCENT-styled dropdown, not a
 *  native `<select>` — open it (clicking its own toggle button), then click
 *  the matching grouped option button. */
function selectCategory(value: string): void {
  fireEvent.click(screen.getByTestId("upload-wizard-category"));
  fireEvent.click(screen.getByTestId(`upload-wizard-category-option-${value}`));
}

/** Steps through Account → Category&Mode, picking account A, category
 *  general-other (recommends Encrypted — overridden to Public so the
 *  simplest path never needs the encryptor sub-picker), landing on Files. */
function advanceToFiles(): void {
  fireEvent.click(screen.getByTestId(`upload-wizard-account-${ACCOUNT_A}`));
  fireEvent.click(screen.getByTestId("upload-wizard-next"));
  selectCategory("general-other");
  fireEvent.click(screen.getByTestId("upload-wizard-mode-public"));
  fireEvent.click(screen.getByTestId("upload-wizard-next"));
}

/** Steps all the way through to the Review & Cost step with one valid file. */
function advanceToReview(): void {
  advanceToFiles();
  fireEvent.change(screen.getByTestId("upload-wizard-add-file-input"), { target: { files: [makeFile()] } });
  fireEvent.click(screen.getByTestId("upload-wizard-next"));
}

/** Reads the Review step's tag-preview rows as `{ name, value }` pairs, in
 *  DOM order — `name` strips the trailing colon the row itself renders
 *  (`<span>{tag.name}:</span>`), so a row whose VALUE happens to contain a
 *  colon (none currently do) can never be mistaken for the separator. Used
 *  to assert the FIXED, CANONICAL row set/order (arweave-tag-schema-spec
 *  T4) independently of each row's displayed value. */
function tagPreviewRows(): { name: string; value: string }[] {
  const container = screen.getByTestId("upload-wizard-tag-preview");
  return Array.from(container.querySelectorAll("li")).map((li) => {
    const spans = li.querySelectorAll("span");
    return {
      name: (spans[0]?.textContent ?? "").replace(/:$/, ""),
      value: spans[1]?.textContent ?? "",
    };
  });
}

/** The Review step's tag-preview row NAMES, in the EXACT canonical order
 *  documented in `packages/codex/ARWEAVE_TAG_SCHEMA.md` §2 (minus
 *  `Codex-Path`, which is a bundle-file-item-only tag never shown on this
 *  per-upload-action preview) — the fixed shape every upload's Review step
 *  must render, regardless of what was chosen. */
const CANONICAL_REVIEW_TAG_ROW_NAMES = [
  "App-Name",
  "Content-Type",
  "Codex-Item-Id",
  "Codex-Owner",
  "Codex-Tag-Schema-Version",
  "Codex-Upload-Id",
  "Codex-Item-Type",
  "Codex-Category",
  "Codex-Asset-Type",
  "Codex-App-Id",
  "Codex-App-Version",
  "Codex-Encrypted",
  "Codex-Encryptor",
  "Codex-Encryption-Version",
];

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("UploadWizard — Step 0 (Account) gating and live balance", () => {
  it("Next stays disabled until exactly one account is picked", () => {
    render(<UploadWizard {...makeProps()} />);
    expect(screen.getByTestId("upload-wizard-next")).toBeDisabled();

    fireEvent.click(screen.getByTestId(`upload-wizard-account-${ACCOUNT_A}`));
    expect(screen.getByTestId("upload-wizard-next")).toBeEnabled();
  });

  it("shows each account's own live balance via the injected getBalance, and a plain dash when getBalance is omitted", async () => {
    const getBalance = vi.fn(async (address: string) =>
      address === ACCOUNT_A ? 5_000_000_000_000n : 0n,
    );
    const { unmount } = render(<UploadWizard {...makeProps({ getBalance })} />);
    await waitFor(() => expect(screen.getByTestId(`upload-wizard-account-balance-${ACCOUNT_A}`).textContent).toBe("5 AR"));
    expect(screen.getByTestId(`upload-wizard-account-balance-${ACCOUNT_B}`).textContent).toBe("0 AR");
    unmount();

    render(<UploadWizard {...makeProps()} />);
    expect(screen.getByTestId(`upload-wizard-account-balance-${ACCOUNT_A}`).textContent).toBe("—");
  });
});

/**
 * Bug 2 (owner-reported): the Account step's picker always rendered
 * `accounts` in whatever order the caller passed them, even though the SAME
 * component already fetches every account's own live balance (the
 * `getBalance`-driven `balances` effect above). The owner wants the list
 * sorted highest-balance-first, so the fullest account is the obvious
 * default pick in a multi-account codex. A balance that hasn't resolved yet,
 * or failed to resolve, must still render (never crash, never silently drop
 * the account) — just placed after every account whose balance IS known.
 */
describe("UploadWizard — Step 0 (Account) list sorted by balance, descending", () => {
  const ACCOUNT_C = "acct-address-CCCCCCCCCCCCCCCCCCCCCCCCCCCCC";

  function threeAccounts(): ForeignKeyEntry[] {
    return [
      // Deliberately NOT in balance order — the lowest balance first, the
      // highest second, the unknown one last — so a passing test actually
      // proves the component reordered them, rather than happening to
      // render the input order verbatim.
      { id: ACCOUNT_A, chainId: "arweave:mainnet", encryptedKeyfile: "cipher-a", label: "Low" },
      { id: ACCOUNT_B, chainId: "arweave:mainnet", encryptedKeyfile: "cipher-b", label: "High" },
      { id: ACCOUNT_C, chainId: "arweave:mainnet", encryptedKeyfile: "cipher-c", label: "Unknown" },
    ];
  }

  /** The Account step's per-account picker buttons, in DOM (render) order —
   *  queried as `<button>` elements specifically so the sibling balance
   *  `<span>` (sharing the same `upload-wizard-account-` testid prefix) is
   *  never mistaken for a second row. */
  function renderedAccountIds(container: HTMLElement): string[] {
    const buttons = container.querySelectorAll('button[data-testid^="upload-wizard-account-"]');
    return Array.from(buttons).map((b) =>
      (b.getAttribute("data-testid") ?? "").replace("upload-wizard-account-", ""),
    );
  }

  it("renders known balances highest-first, with an unknown (failed) balance placed after every known one", async () => {
    const getBalance = vi.fn(async (address: string) => {
      if (address === ACCOUNT_A) return 1_000_000_000_000n; // 1 AR — the lower of the two known balances
      if (address === ACCOUNT_B) return 5_000_000_000_000n; // 5 AR — the higher
      throw new Error("balance read failed"); // ACCOUNT_C — unknown
    });
    const { container } = render(
      <UploadWizard {...makeProps({ accounts: threeAccounts(), getBalance })} />,
    );

    // Wait for every balance read to settle (success or failure) before
    // asserting order — the render-order claim is about the SETTLED state,
    // not whatever transiently renders mid-fetch.
    await waitFor(() => expect(screen.getByTestId(`upload-wizard-account-balance-${ACCOUNT_B}`).textContent).toBe("5 AR"));
    await waitFor(() => expect(screen.getByTestId(`upload-wizard-account-balance-${ACCOUNT_C}`).textContent).toBe("—"));

    expect(renderedAccountIds(container)).toEqual([ACCOUNT_B, ACCOUNT_A, ACCOUNT_C]);
  });

  it("keeps a still-loading balance in a stable, sensible (after-known) position rather than reshuffling unpredictably", () => {
    // `getBalance` never resolves within this test — every account stays
    // "loading" throughout, so the ONLY accounts with a known balance are
    // none; the list must still render every account (never crash, never
    // drop one) in its original relative order while unresolved.
    const getBalance = vi.fn(() => new Promise<bigint>(() => {}));
    const { container } = render(
      <UploadWizard {...makeProps({ accounts: threeAccounts(), getBalance })} />,
    );
    expect(renderedAccountIds(container)).toEqual([ACCOUNT_A, ACCOUNT_B, ACCOUNT_C]);
  });
});

describe("UploadWizard — Step 1 (Category & Mode, combined) gating and recommendation", () => {
  it("Next stays disabled until a category is chosen; nft-data additionally requires an asset type", () => {
    render(<UploadWizard {...makeProps()} />);
    fireEvent.click(screen.getByTestId(`upload-wizard-account-${ACCOUNT_A}`));
    fireEvent.click(screen.getByTestId("upload-wizard-next"));

    expect(screen.getByTestId("upload-wizard-next")).toBeDisabled();
    selectCategory("nft-data");
    // nft-data recommends Public, satisfying the Mode half of the gate, but
    // the asset-type half is still unmet.
    expect(screen.getByTestId("upload-wizard-next")).toBeDisabled();
    fireEvent.click(screen.getByTestId("upload-wizard-asset-type-option-image"));
    expect(screen.getByTestId("upload-wizard-next")).toBeEnabled();
  });

  it("nft-data recommends Public by default (pre-selected, still changeable)", () => {
    render(<UploadWizard {...makeProps()} />);
    fireEvent.click(screen.getByTestId(`upload-wizard-account-${ACCOUNT_A}`));
    fireEvent.click(screen.getByTestId("upload-wizard-next"));
    selectCategory("nft-data");

    expect(screen.getByTestId("upload-wizard-mode-public")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("upload-wizard-mode-encrypted")).toHaveAttribute("aria-pressed", "false");

    // Still freely changeable — overriding to Encrypted reveals the
    // encryptor sub-picker in this SAME step.
    fireEvent.click(screen.getByTestId("upload-wizard-mode-encrypted"));
    expect(screen.getByTestId("upload-wizard-mode-encrypted")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("upload-wizard-encryptor-picker")).toBeInTheDocument();
  });

  it("personal-photos recommends Encrypted by default (a private-data category)", () => {
    render(<UploadWizard {...makeProps()} />);
    fireEvent.click(screen.getByTestId(`upload-wizard-account-${ACCOUNT_A}`));
    fireEvent.click(screen.getByTestId("upload-wizard-next"));
    selectCategory("personal-photos");

    expect(screen.getByTestId("upload-wizard-mode-encrypted")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("upload-wizard-mode-public")).toHaveAttribute("aria-pressed", "false");
  });

  it("defaults the Encrypted sub-picker to the isDefault-flagged account, falling back to the first entry when none is flagged", () => {
    // No entry flagged — falls back to the first ("ouro-1").
    const { unmount } = render(<UploadWizard {...makeProps()} />);
    fireEvent.click(screen.getByTestId(`upload-wizard-account-${ACCOUNT_A}`));
    fireEvent.click(screen.getByTestId("upload-wizard-next"));
    selectCategory("general-other");
    fireEvent.click(screen.getByTestId("upload-wizard-mode-encrypted"));
    expect(screen.getByTestId("upload-wizard-encryptor-ouro-1")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("upload-wizard-next")).toBeEnabled();
    unmount();

    // "ouro-2" flagged isDefault — preferred over the first entry.
    render(<UploadWizard {...makeProps({ ouronetAccounts: makeOuronetAccountsWithDefault() })} />);
    fireEvent.click(screen.getByTestId(`upload-wizard-account-${ACCOUNT_A}`));
    fireEvent.click(screen.getByTestId("upload-wizard-next"));
    selectCategory("general-other");
    fireEvent.click(screen.getByTestId("upload-wizard-mode-encrypted"));
    expect(screen.getByTestId("upload-wizard-encryptor-ouro-2")).toHaveAttribute("aria-pressed", "true");
  });

  it("an explicit encryptor pick overrides the default", () => {
    render(<UploadWizard {...makeProps()} />);
    fireEvent.click(screen.getByTestId(`upload-wizard-account-${ACCOUNT_A}`));
    fireEvent.click(screen.getByTestId("upload-wizard-next"));
    selectCategory("general-other");
    fireEvent.click(screen.getByTestId("upload-wizard-mode-encrypted"));
    fireEvent.click(screen.getByTestId("upload-wizard-encryptor-ouro-2"));
    expect(screen.getByTestId("upload-wizard-encryptor-ouro-2")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("upload-wizard-encryptor-ouro-1")).toHaveAttribute("aria-pressed", "false");
  });
});

describe("UploadWizard — round 2: no native form controls anywhere in the component", () => {
  it("renders zero native <select> elements, before or after opening the category dropdown", () => {
    const { container } = render(<UploadWizard {...makeProps()} />);
    fireEvent.click(screen.getByTestId(`upload-wizard-account-${ACCOUNT_A}`));
    fireEvent.click(screen.getByTestId("upload-wizard-next"));
    expect(container.querySelectorAll("select")).toHaveLength(0);

    selectCategory("nft-data");
    expect(container.querySelectorAll("select")).toHaveLength(0);
  });
});

describe("UploadWizard — round 2: App-Id/App-Version shown only for software-code/website-dapp-hosting", () => {
  it("shows App-Id/App-Version for software-code, hides them (and clears the draft) for nft-data and every other category", () => {
    render(<UploadWizard {...makeProps()} />);
    fireEvent.click(screen.getByTestId(`upload-wizard-account-${ACCOUNT_A}`));
    fireEvent.click(screen.getByTestId("upload-wizard-next"));

    selectCategory("software-code");
    expect(screen.getByTestId("upload-wizard-app-id")).toBeInTheDocument();
    expect(screen.getByTestId("upload-wizard-app-version")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("upload-wizard-app-id"), { target: { value: "will-be-cleared" } });

    selectCategory("nft-data");
    expect(screen.queryByTestId("upload-wizard-app-id")).not.toBeInTheDocument();
    expect(screen.queryByTestId("upload-wizard-app-version")).not.toBeInTheDocument();

    // Switching back to a category that shows the fields again proves the
    // draft was actually cleared (not merely hidden) while away.
    selectCategory("website-dapp-hosting");
    expect(screen.getByTestId("upload-wizard-app-id")).toHaveValue("");
  });

  it("shows App-Id/App-Version for website-dapp-hosting too", () => {
    render(<UploadWizard {...makeProps()} />);
    fireEvent.click(screen.getByTestId(`upload-wizard-account-${ACCOUNT_A}`));
    fireEvent.click(screen.getByTestId("upload-wizard-next"));
    selectCategory("website-dapp-hosting");
    expect(screen.getByTestId("upload-wizard-app-id")).toBeInTheDocument();
    expect(screen.getByTestId("upload-wizard-app-version")).toBeInTheDocument();
  });
});

describe("UploadWizard — round 2: the dedicated metadata input/disclaimer is gone entirely", () => {
  it("never renders a metadata-specific file input or disclaimer, even for nft-data", () => {
    render(<UploadWizard {...makeProps()} />);
    fireEvent.click(screen.getByTestId(`upload-wizard-account-${ACCOUNT_A}`));
    fireEvent.click(screen.getByTestId("upload-wizard-next"));
    selectCategory("nft-data");
    fireEvent.click(screen.getByTestId("upload-wizard-asset-type-option-image"));

    expect(screen.queryByTestId("upload-wizard-metadata-file-input")).not.toBeInTheDocument();
    expect(screen.queryByTestId("upload-wizard-nft-metadata-disclaimer")).not.toBeInTheDocument();
    expect(screen.queryByTestId("upload-wizard-nft-metadata-disclaimer-wrap")).not.toBeInTheDocument();
  });
});

describe("UploadWizard — round 2: nft-data clarifying label near the asset-type picker", () => {
  it("shows the Ouronet Collectables label only for nft-data", () => {
    render(<UploadWizard {...makeProps()} />);
    fireEvent.click(screen.getByTestId(`upload-wizard-account-${ACCOUNT_A}`));
    fireEvent.click(screen.getByTestId("upload-wizard-next"));

    selectCategory("general-other");
    expect(screen.queryByTestId("upload-wizard-nft-asset-type-label")).not.toBeInTheDocument();

    selectCategory("nft-data");
    expect(screen.getByTestId("upload-wizard-nft-asset-type-label").textContent).toContain("Ouronet");
  });
});

describe("UploadWizard — round 2: nft-data Public/Encrypted recommendation labels and the encrypted-NFT warning", () => {
  it("labels Public '(Recommended)' and Encrypted '(Not recommended)' for nft-data only, with no such labels for other categories", () => {
    render(<UploadWizard {...makeProps()} />);
    fireEvent.click(screen.getByTestId(`upload-wizard-account-${ACCOUNT_A}`));
    fireEvent.click(screen.getByTestId("upload-wizard-next"));

    selectCategory("general-other");
    expect(screen.getByTestId("upload-wizard-mode-public").textContent).toBe("Public");
    expect(screen.getByTestId("upload-wizard-mode-encrypted").textContent).toBe("Encrypted");

    selectCategory("nft-data");
    expect(screen.getByTestId("upload-wizard-mode-public").textContent).toContain("Recommended");
    expect(screen.getByTestId("upload-wizard-mode-encrypted").textContent).toContain("Not recommended");
  });

  it("shows an nft-data-specific 'won't be viewable as a public asset' warning only when nft-data AND Encrypted are both chosen", () => {
    render(<UploadWizard {...makeProps()} />);
    fireEvent.click(screen.getByTestId(`upload-wizard-account-${ACCOUNT_A}`));
    fireEvent.click(screen.getByTestId("upload-wizard-next"));
    selectCategory("nft-data");
    fireEvent.click(screen.getByTestId("upload-wizard-asset-type-option-image"));
    expect(screen.queryByTestId("upload-wizard-nft-encrypted-warning")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("upload-wizard-mode-encrypted"));
    const warning = screen.getByTestId("upload-wizard-nft-encrypted-warning");
    expect(warning).toBeInTheDocument();
    expect(warning.textContent?.toLowerCase()).toContain("decrypt");

    // Back to Public — the warning disappears again.
    fireEvent.click(screen.getByTestId("upload-wizard-mode-public"));
    expect(screen.queryByTestId("upload-wizard-nft-encrypted-warning")).not.toBeInTheDocument();
  });
});

describe("UploadWizard — round 2: advisory (non-blocking) extension-mismatch warning", () => {
  it("shows a per-file mismatch warning when a file's extension doesn't fit the chosen nft asset type, without blocking Next", () => {
    render(<UploadWizard {...makeProps()} />);
    fireEvent.click(screen.getByTestId(`upload-wizard-account-${ACCOUNT_A}`));
    fireEvent.click(screen.getByTestId("upload-wizard-next"));
    selectCategory("nft-data");
    fireEvent.click(screen.getByTestId("upload-wizard-asset-type-option-image"));
    fireEvent.click(screen.getByTestId("upload-wizard-next"));

    fireEvent.change(screen.getByTestId("upload-wizard-add-file-input"), { target: { files: [makeFile("notes.pdf")] } });
    const entry = screen.getByText(/notes\.pdf/).closest("li")!;
    expect(within(entry).getByText(/doesn't look like a typical image file/i)).toBeInTheDocument();

    // Advisory only — Next stays enabled with the mismatched file still present.
    expect(screen.getByTestId("upload-wizard-next")).toBeEnabled();
  });

  it("shows no mismatch warning when the file extension fits the chosen asset type", () => {
    render(<UploadWizard {...makeProps()} />);
    fireEvent.click(screen.getByTestId(`upload-wizard-account-${ACCOUNT_A}`));
    fireEvent.click(screen.getByTestId("upload-wizard-next"));
    selectCategory("nft-data");
    fireEvent.click(screen.getByTestId("upload-wizard-asset-type-option-image"));
    fireEvent.click(screen.getByTestId("upload-wizard-next"));

    fireEvent.change(screen.getByTestId("upload-wizard-add-file-input"), { target: { files: [makeFile("art.png")] } });
    expect(screen.queryByText(/doesn't look like a typical/i)).not.toBeInTheDocument();
  });

  it("shows no mismatch warning for a non-nft-data category, regardless of extension", () => {
    render(<UploadWizard {...makeProps()} />);
    advanceToFiles(); // category: general-other
    fireEvent.change(screen.getByTestId("upload-wizard-add-file-input"), { target: { files: [makeFile("weird.xyz")] } });
    expect(screen.queryByText(/doesn't look like a typical/i)).not.toBeInTheDocument();
  });
});

describe("UploadWizard — Step 2 (Files) gating, the 10-file cap, and multi-folder path-prefixing", () => {
  it("Next stays disabled with no files selected, enables once at least one file is added", () => {
    render(<UploadWizard {...makeProps()} />);
    advanceToFiles();
    expect(screen.getByTestId("upload-wizard-next")).toBeDisabled();

    fireEvent.change(screen.getByTestId("upload-wizard-add-file-input"), { target: { files: [makeFile()] } });
    expect(screen.getByTestId("upload-wizard-next")).toBeEnabled();
  });

  it("each 'Add File' click adds exactly one file to a running list, with its own byte size shown and a live running total above it", () => {
    render(<UploadWizard {...makeProps()} />);
    advanceToFiles();

    fireEvent.change(screen.getByTestId("upload-wizard-add-file-input"), { target: { files: [makeFile("a.txt", 100)] } });
    expect(screen.getByTestId("upload-wizard-file-total-size").textContent).toContain("100");
    expect(screen.getByText(/a\.txt — 100 bytes/)).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("upload-wizard-add-file-input"), { target: { files: [makeFile("b.txt", 50)] } });
    expect(screen.getByTestId("upload-wizard-file-total-size").textContent).toContain("150");
    expect(screen.getByText(/b\.txt — 50 bytes/)).toBeInTheDocument();
  });

  it("caps individually-added files at 10 and shows a clear inline message directing to Folder mode, never silently dropping the 11th", () => {
    render(<UploadWizard {...makeProps()} />);
    advanceToFiles();

    for (let i = 0; i < 10; i++) {
      fireEvent.change(screen.getByTestId("upload-wizard-add-file-input"), { target: { files: [makeFile(`f${i}.txt`)] } });
    }
    expect(screen.getAllByTestId("upload-wizard-file-entry")).toHaveLength(10);
    expect(screen.queryByTestId("upload-wizard-file-cap-message")).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId("upload-wizard-add-file-input"), { target: { files: [makeFile("f10.txt")] } });
    // The 11th is NOT added — the list stays at 10 — and a clear message
    // points to Folder mode instead.
    expect(screen.getAllByTestId("upload-wizard-file-entry")).toHaveLength(10);
    expect(screen.getByTestId("upload-wizard-file-cap-message").textContent?.toLowerCase()).toContain("folder");
  });

  it("multiple folder picks append with each folder's own name prefixed onto its files' paths, producing distinct paths that never collide", () => {
    render(<UploadWizard {...makeProps()} />);
    advanceToFiles();

    fireEvent.change(screen.getByTestId("upload-wizard-add-folder-input"), {
      target: { files: [makeFolderFile("catA/img1.png"), makeFolderFile("catA/img2.png")] },
    });
    fireEvent.change(screen.getByTestId("upload-wizard-add-folder-input"), {
      target: { files: [makeFolderFile("catB/img1.png")] },
    });

    // The ACTUAL distinct path strings — not just "no crash" — per two
    // DIFFERENTLY named folder picks.
    expect(screen.getByText(/catA\/img1\.png/)).toBeInTheDocument();
    expect(screen.getByText(/catA\/img2\.png/)).toBeInTheDocument();
    expect(screen.getByText(/catB\/img1\.png/)).toBeInTheDocument();
    expect(screen.queryByText(/^img1\.png/)).not.toBeInTheDocument();

    // The running total reflects all 3 folder-added files (each 10 bytes).
    expect(screen.getByTestId("upload-wizard-file-total-size").textContent).toContain("30");
  });

  it("two folder picks sharing the SAME literal folder name still produce distinct, disambiguated paths", () => {
    render(<UploadWizard {...makeProps()} />);
    advanceToFiles();

    fireEvent.change(screen.getByTestId("upload-wizard-add-folder-input"), {
      target: { files: [makeFolderFile("images/img1.png")] },
    });
    fireEvent.change(screen.getByTestId("upload-wizard-add-folder-input"), {
      target: { files: [makeFolderFile("images/img1.png")] },
    });

    // Two SEPARATE entries, at two SEPARATE (disambiguated) paths — never
    // one silently overwriting the other.
    expect(screen.getAllByTestId("upload-wizard-file-entry")).toHaveLength(2);
    expect(screen.getByText(/^images\/img1\.png/)).toBeInTheDocument();
    expect(screen.getByText(/^images \(2\)\/img1\.png/)).toBeInTheDocument();
  });

  it("[streaming unsupported] blocks adding a file that would push the running total over the OPFS-fallback 2 GiB cap, never silently adding it, with an honest browser-support message", async () => {
    render(<UploadWizard {...makeProps()} />);
    await flushStreamingSupportDetection();
    advanceToFiles();

    // One byte past the 2 GiB (2,147,483,648-byte) fallback cap.
    const oversized = makeFileWithSize("huge.bin", 2_147_483_649);
    fireEvent.change(screen.getByTestId("upload-wizard-add-file-input"), { target: { files: [oversized] } });

    // Not added at all — the message explains why, naming the actual
    // prospective total, the 2 GiB limit, and that this is a BROWSER-SUPPORT
    // limitation (this browser lacks OPFS), never a permanent product
    // choice — the new, honest wording (never the old "temporary
    // architecture limitation" phrasing).
    expect(screen.queryByTestId("upload-wizard-file-entry")).not.toBeInTheDocument();
    const message = screen.getByTestId("upload-wizard-file-cap-message").textContent ?? "";
    expect(message).toContain("2147483649");
    expect(message.toLowerCase()).toContain("2 gib");
    expect(message.toLowerCase()).toContain("browser");
    expect(message.toLowerCase()).not.toContain("temporary");
  });

  it("[streaming unsupported] allows a selection totaling EXACTLY 2 GiB — the fallback cap boundary is inclusive, only a total that EXCEEDS it blocks", async () => {
    render(<UploadWizard {...makeProps()} />);
    await flushStreamingSupportDetection();
    advanceToFiles();

    const atCap = makeFileWithSize("exact.bin", 2_147_483_648); // exactly 2 GiB
    fireEvent.change(screen.getByTestId("upload-wizard-add-file-input"), { target: { files: [atCap] } });

    expect(screen.getAllByTestId("upload-wizard-file-entry")).toHaveLength(1);
    expect(screen.queryByTestId("upload-wizard-file-cap-message")).not.toBeInTheDocument();
    expect(screen.getByTestId("upload-wizard-next")).toBeEnabled();
  });

  it("[streaming unsupported] the 2 GiB fallback cap also accounts for files already selected — a second file that would push the running TOTAL over the cap is blocked, even though it is small on its own", async () => {
    render(<UploadWizard {...makeProps()} />);
    await flushStreamingSupportDetection();
    advanceToFiles();

    fireEvent.change(screen.getByTestId("upload-wizard-add-file-input"), {
      target: { files: [makeFileWithSize("first.bin", 2_147_483_640)] },
    });
    expect(screen.getAllByTestId("upload-wizard-file-entry")).toHaveLength(1);

    // On its own, 10 bytes is nothing — but added to the 2,147,483,640
    // already selected, the running total would be 2,147,483,650, past the
    // cap, so this second file is blocked too.
    fireEvent.change(screen.getByTestId("upload-wizard-add-file-input"), {
      target: { files: [makeFileWithSize("second.bin", 10)] },
    });
    expect(screen.getAllByTestId("upload-wizard-file-entry")).toHaveLength(1);
    expect(screen.getByTestId("upload-wizard-file-cap-message").textContent?.toLowerCase()).toContain("2 gib");
  });

  it("[streaming unsupported] blocks adding a whole folder whose combined size would push the running total over the 2 GiB fallback cap — never partially adding it", async () => {
    render(<UploadWizard {...makeProps()} />);
    await flushStreamingSupportDetection();
    advanceToFiles();

    fireEvent.change(screen.getByTestId("upload-wizard-add-folder-input"), {
      target: {
        files: [
          makeFolderFile("big/a.bin", 1_200_000_000),
          makeFolderFile("big/b.bin", 1_000_000_000), // combined: 2,200,000,000 — over the 2 GiB cap
        ],
      },
    });

    // Neither file was added — a partial folder add would be worse than no
    // add at all (half an upload set, silently).
    expect(screen.queryByTestId("upload-wizard-file-entry")).not.toBeInTheDocument();
    expect(screen.queryByText(/big\/a\.bin/)).not.toBeInTheDocument();
    const message = screen.getByTestId("upload-wizard-file-cap-message").textContent ?? "";
    expect(message.toLowerCase()).toContain("2 gib");
    expect(message.toLowerCase()).toContain("browser");
  });

  it("removes an individually-added file, and removes a whole folder's files at once, both updating the running total live", () => {
    render(<UploadWizard {...makeProps()} />);
    advanceToFiles();

    fireEvent.change(screen.getByTestId("upload-wizard-add-file-input"), { target: { files: [makeFile("solo.txt", 20)] } });
    fireEvent.change(screen.getByTestId("upload-wizard-add-folder-input"), {
      target: { files: [makeFolderFile("catA/img1.png", 30), makeFolderFile("catA/img2.png", 40)] },
    });
    expect(screen.getByTestId("upload-wizard-file-total-size").textContent).toContain("90");

    // Remove the individually-added file.
    const soloRemove = screen.getByText(/solo\.txt — 20 bytes/).closest("li")!;
    fireEvent.click(soloRemove.querySelector("button")!);
    expect(screen.queryByText(/solo\.txt/)).not.toBeInTheDocument();
    expect(screen.getByTestId("upload-wizard-file-total-size").textContent).toContain("70");

    // Remove the whole folder at once.
    fireEvent.click(screen.getByTestId("upload-wizard-remove-folder-catA"));
    expect(screen.queryByText(/catA\/img1\.png/)).not.toBeInTheDocument();
    expect(screen.queryByText(/catA\/img2\.png/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("upload-wizard-file-total-size")).not.toBeInTheDocument();
  });
});

/**
 * T3 (`arweave-streaming-ui`): once streaming is supported, the
 * `MAX_TOTAL_SIZE_BYTES` block-on-add behavior is removed entirely for the
 * Files step — a selection that would have been blocked under the old
 * (or the new OPFS-fallback) cap now adds cleanly. The detection itself
 * runs ONCE per wizard session (on mount), never re-probed per file add.
 */
describe("UploadWizard — Step 2 (Files): streaming-supported removes the size cap entirely", () => {
  it("adds a file far past both the old 1 GiB cap AND the new 2 GiB fallback cap without blocking, once isStreamingUploadSupported resolves true", async () => {
    const isStreamingUploadSupported = vi.fn(async () => true);
    render(<UploadWizard {...makeProps({ isStreamingUploadSupported })} />);
    await flushStreamingSupportDetection();
    expect(isStreamingUploadSupported).toHaveBeenCalledTimes(1);
    advanceToFiles();

    const huge = makeFileWithSize("huge.bin", 3_000_000_000); // ~2.79 GiB — past both caps
    fireEvent.change(screen.getByTestId("upload-wizard-add-file-input"), { target: { files: [huge] } });

    expect(screen.getAllByTestId("upload-wizard-file-entry")).toHaveLength(1);
    expect(screen.queryByTestId("upload-wizard-file-cap-message")).not.toBeInTheDocument();
    expect(screen.getByTestId("upload-wizard-next")).toBeEnabled();
  });

  it("only probes isStreamingUploadSupported ONCE per wizard session, never again per file/folder add", async () => {
    const isStreamingUploadSupported = vi.fn(async () => true);
    render(<UploadWizard {...makeProps({ isStreamingUploadSupported })} />);
    await flushStreamingSupportDetection();
    advanceToFiles();

    fireEvent.change(screen.getByTestId("upload-wizard-add-file-input"), {
      target: { files: [makeFileWithSize("a.bin", 3_000_000_000)] },
    });
    fireEvent.change(screen.getByTestId("upload-wizard-add-file-input"), {
      target: { files: [makeFileWithSize("b.bin", 3_000_000_000)] },
    });

    expect(isStreamingUploadSupported).toHaveBeenCalledTimes(1);
  });
});

describe("UploadWizard — T4: the streaming disclaimer banner (Files step)", () => {
  it("shows a persistent, plain-language banner explaining disk-streamed uploads, the browser-storage requirement, and the honest 2 GiB fallback, linking to the real docs page", () => {
    render(<UploadWizard {...makeProps()} />);
    advanceToFiles();

    const banner = screen.getByTestId("upload-wizard-streaming-disclaimer");
    expect(banner).toBeInTheDocument();
    const text = banner.textContent ?? "";
    // Plain language, not internal API/type names — "OPFS" never appears.
    expect(text).not.toContain("OPFS");
    expect(text.toLowerCase()).toContain("private");
    expect(text.toLowerCase()).toContain("storage");
    expect(text).toContain("2 GiB");

    // A real, reachable documentation page — not a dead "#" placeholder.
    const link = screen.getByTestId("upload-wizard-streaming-docs-link") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/docs/arweave-upload-streaming.md");
  });

  it("stays visible after adding files — a persistent fact, not a one-shot/dismissible notice", () => {
    render(<UploadWizard {...makeProps()} />);
    advanceToFiles();

    fireEvent.change(screen.getByTestId("upload-wizard-add-file-input"), { target: { files: [makeFile()] } });

    expect(screen.getByTestId("upload-wizard-streaming-disclaimer")).toBeInTheDocument();
  });
});

describe("UploadWizard — Back preserves every prior selection", () => {
  it("returning to Step 0/1/2 after reaching Step 3 shows every value exactly as entered, never reset (nft-data + asset type)", () => {
    render(<UploadWizard {...makeProps()} />);
    fireEvent.click(screen.getByTestId(`upload-wizard-account-${ACCOUNT_B}`));
    fireEvent.click(screen.getByTestId("upload-wizard-next"));
    selectCategory("nft-data");
    fireEvent.click(screen.getByTestId("upload-wizard-asset-type-option-video"));
    fireEvent.click(screen.getByTestId("upload-wizard-next"));
    fireEvent.change(screen.getByTestId("upload-wizard-add-file-input"), { target: { files: [makeFile("keepme.txt")] } });
    fireEvent.click(screen.getByTestId("upload-wizard-next"));

    // Now at Step 3 (Review). Walk all the way back to Step 0.
    fireEvent.click(screen.getByTestId("upload-wizard-back")); // -> step 2 (Files)
    expect(screen.getByTestId("upload-wizard-file-preview").textContent).toContain("keepme.txt");

    fireEvent.click(screen.getByTestId("upload-wizard-back")); // -> step 1 (Category & Mode)
    expect(screen.getByTestId("upload-wizard-category").textContent).toContain("nft-data");
    expect(screen.getByTestId("upload-wizard-asset-type-option-video")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("upload-wizard-mode-public")).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByTestId("upload-wizard-back")); // -> step 0 (Account)
    expect(screen.getByTestId(`upload-wizard-account-${ACCOUNT_B}`)).toHaveAttribute("aria-pressed", "true");

    // Forward again — the same values should still be there, all the way to
    // the Review step's own summary.
    fireEvent.click(screen.getByTestId("upload-wizard-next"));
    expect(screen.getByTestId("upload-wizard-category").textContent).toContain("nft-data");
    fireEvent.click(screen.getByTestId("upload-wizard-next"));
    fireEvent.click(screen.getByTestId("upload-wizard-next"));
    expect(screen.getByTestId("upload-wizard-step-review").textContent).toContain("nft-data");
  });

  it("preserves App-Id/App-Version through Back for a software-code category", () => {
    render(<UploadWizard {...makeProps()} />);
    fireEvent.click(screen.getByTestId(`upload-wizard-account-${ACCOUNT_B}`));
    fireEvent.click(screen.getByTestId("upload-wizard-next"));
    selectCategory("software-code");
    fireEvent.change(screen.getByTestId("upload-wizard-app-id"), { target: { value: "app-123" } });
    fireEvent.click(screen.getByTestId("upload-wizard-next"));
    fireEvent.change(screen.getByTestId("upload-wizard-add-file-input"), { target: { files: [makeFile("keepme.txt")] } });
    fireEvent.click(screen.getByTestId("upload-wizard-next"));

    fireEvent.click(screen.getByTestId("upload-wizard-back")); // -> step 2 (Files)
    fireEvent.click(screen.getByTestId("upload-wizard-back")); // -> step 1 (Category & Mode)
    expect(screen.getByTestId("upload-wizard-app-id")).toHaveValue("app-123");
    expect(screen.getByTestId("upload-wizard-category").textContent).toContain("software-code");
  });
});

describe("UploadWizard — Step 3 (Review & Cost) cost estimate (real estimateUploadCostAr, never a placeholder)", () => {
  it("shows a loading state, then the resolved AR estimate from the injected getPrice fake", async () => {
    let resolvePrice: (v: string) => void = () => {};
    const getPrice = vi.fn(() => new Promise<string>((res) => { resolvePrice = res; }));
    render(<UploadWizard {...makeProps({ getPrice })} />);
    advanceToReview();

    expect(screen.getByTestId("upload-wizard-cost-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("upload-wizard-cost-estimate")).not.toBeInTheDocument();

    resolvePrice("1000000000");
    const estimate = await screen.findByTestId("upload-wizard-cost-estimate");
    expect(estimate.textContent).toContain("AR");
    expect(screen.queryByTestId("upload-wizard-cost-loading")).not.toBeInTheDocument();
  });

  it("shows a clear error state when the price quote rejects, without blocking the rest of the review", async () => {
    const getPrice = vi.fn(async () => {
      throw new Error("gateway pool exhausted");
    });
    render(<UploadWizard {...makeProps({ getPrice })} />);
    advanceToReview();

    expect(await screen.findByTestId("upload-wizard-cost-error")).toBeInTheDocument();
    // The rest of the review still rendered — not blocked by the failed quote.
    expect(screen.getByTestId("upload-wizard-step-review").textContent).toContain("general-other");
    expect(screen.getByTestId("upload-wizard-permanence-warning").textContent).toBe(UPLOAD_PERMANENCE_WARNING);
    // The owner correction pass's new explanatory copy is present too.
    expect(screen.getByTestId("upload-wizard-review-explainer-transaction")).toBeInTheDocument();
    expect(screen.getByTestId("upload-wizard-review-explainer-pending")).toBeInTheDocument();
    expect(screen.getByTestId("upload-wizard-review-explainer-blocktime")).toBeInTheDocument();
    expect(screen.getByTestId("upload-wizard-review-explainer-metadata")).toBeInTheDocument();
    expect(screen.getByTestId("upload-wizard-review-link-pattern")).toBeInTheDocument();
  });
});

describe("UploadWizard — Step 3 estimated remaining balance", () => {
  it("computes balance minus cost once both are known, and leaves Confirm enabled when the remainder is positive", async () => {
    const getBalance = vi.fn(async () => 2_000_000_000_000n); // 2 AR
    const getPrice = vi.fn(async () => "1000000000000"); // 1 AR per byte-quote unit — fee comes out well under 2 AR
    render(<UploadWizard {...makeProps({ getBalance, getPrice })} />);
    advanceToReview();

    await screen.findByTestId("upload-wizard-cost-estimate");
    await waitFor(() => expect(screen.getByTestId("upload-wizard-remaining-balance")).toBeInTheDocument());
    expect(screen.queryByTestId("upload-wizard-insufficient-balance")).not.toBeInTheDocument();
    expect(screen.getByTestId("upload-wizard-confirm-upload")).toBeEnabled();
  });

  it("disables Confirm with a clear insufficient-balance message when the remainder would be negative", async () => {
    const getBalance = vi.fn(async () => 1n); // effectively empty
    const getPrice = vi.fn(async () => "1000000000000"); // 1 AR fee — far more than the balance
    render(<UploadWizard {...makeProps({ getBalance, getPrice })} />);
    advanceToReview();

    expect(await screen.findByTestId("upload-wizard-insufficient-balance")).toBeInTheDocument();
    expect(screen.getByTestId("upload-wizard-confirm-upload")).toBeDisabled();
  });
});

describe("UploadWizard — Confirm & Upload threads every draft field (Public)", () => {
  it("calls uploadAndTrack with nft-data's category/assetType, and no App-Id/App-Version/encryptFor", async () => {
    const props = makeProps();
    render(<UploadWizard {...props} />);
    fireEvent.click(screen.getByTestId(`upload-wizard-account-${ACCOUNT_A}`));
    fireEvent.click(screen.getByTestId("upload-wizard-next"));
    selectCategory("nft-data");
    fireEvent.click(screen.getByTestId("upload-wizard-asset-type-option-image"));
    fireEvent.click(screen.getByTestId("upload-wizard-next"));
    fireEvent.change(screen.getByTestId("upload-wizard-add-file-input"), { target: { files: [makeFile()] } });
    fireEvent.click(screen.getByTestId("upload-wizard-next"));

    fireEvent.click(screen.getByTestId("upload-wizard-confirm-upload"));
    await waitFor(() => expect(props.uploadAndTrack).toHaveBeenCalledTimes(1));
    const [file, selection] = props.uploadAndTrack.mock.calls[0];
    expect(file.name).toBe("note.txt");
    expect(selection).toMatchObject({ category: "nft-data", assetType: "image" });
    expect(selection.appId).toBeUndefined();
    expect(selection.appVersion).toBeUndefined();
    expect(selection.encryptFor).toBeUndefined();
    expect(props.uploadFilesAndTrack).not.toHaveBeenCalled();

    expect(await screen.findByTestId("upload-wizard-result")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("upload-wizard-done"));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("calls uploadAndTrack with App-Id/App-Version for a software-code category, and no assetType", async () => {
    const props = makeProps();
    render(<UploadWizard {...props} />);
    fireEvent.click(screen.getByTestId(`upload-wizard-account-${ACCOUNT_A}`));
    fireEvent.click(screen.getByTestId("upload-wizard-next"));
    selectCategory("software-code");
    fireEvent.change(screen.getByTestId("upload-wizard-app-id"), { target: { value: "my-app" } });
    fireEvent.change(screen.getByTestId("upload-wizard-app-version"), { target: { value: "1.2.3" } });
    fireEvent.click(screen.getByTestId("upload-wizard-next"));
    fireEvent.change(screen.getByTestId("upload-wizard-add-file-input"), { target: { files: [makeFile()] } });
    fireEvent.click(screen.getByTestId("upload-wizard-next"));

    fireEvent.click(screen.getByTestId("upload-wizard-confirm-upload"));
    await waitFor(() => expect(props.uploadAndTrack).toHaveBeenCalledTimes(1));
    const [, selection] = props.uploadAndTrack.mock.calls[0];
    expect(selection).toMatchObject({ category: "software-code", appId: "my-app", appVersion: "1.2.3" });
    expect(selection.assetType).toBeUndefined();
  });

  it("2+ files route through uploadFilesAndTrack with the same selection", async () => {
    const props = makeProps();
    render(<UploadWizard {...props} />);
    advanceToFiles();
    fireEvent.change(screen.getByTestId("upload-wizard-add-file-input"), { target: { files: [makeFile("a.txt")] } });
    fireEvent.change(screen.getByTestId("upload-wizard-add-file-input"), { target: { files: [makeFile("b.txt")] } });
    fireEvent.click(screen.getByTestId("upload-wizard-next"));

    fireEvent.click(screen.getByTestId("upload-wizard-confirm-upload"));
    await waitFor(() => expect(props.uploadFilesAndTrack).toHaveBeenCalledTimes(1));
    const [files, selection] = props.uploadFilesAndTrack.mock.calls[0];
    expect(files).toHaveLength(2);
    expect(selection).toMatchObject({ category: "general-other" });
    expect(props.uploadAndTrack).not.toHaveBeenCalled();

    expect(await screen.findByTestId("upload-wizard-bundle-result")).toBeInTheDocument();
  });
});

/**
 * Bug 1 (owner-reported, the real gap): the Account step's selection used to
 * be purely cosmetic — nothing threaded the chosen `accountId` into the
 * actual `uploadAndTrack`/`uploadFilesAndTrack` call, so the real signing/
 * paying key was whatever the host's deps were CONSTRUCTED with, regardless
 * of which account the wizard showed as selected. These specs pin that the
 * wizard's own `accountId` state — the exact id the Account step's picker
 * set — reaches the injected upload seams as an explicit argument, so a
 * non-default account pick actually changes which key signs/pays.
 */
describe("UploadWizard — Confirm & Upload threads the chosen account id to the real signing seam", () => {
  it("passes the SELECTED (non-default) account's id as uploadAndTrack's third argument", async () => {
    const props = makeProps();
    render(<UploadWizard {...props} />);
    // Picks ACCOUNT_B — NOT accounts[0] — so a passing assertion proves the
    // wizard's own selection drove the call, not just whichever account
    // happens to be first/default.
    fireEvent.click(screen.getByTestId(`upload-wizard-account-${ACCOUNT_B}`));
    fireEvent.click(screen.getByTestId("upload-wizard-next"));
    selectCategory("general-other");
    fireEvent.click(screen.getByTestId("upload-wizard-mode-public"));
    fireEvent.click(screen.getByTestId("upload-wizard-next"));
    fireEvent.change(screen.getByTestId("upload-wizard-add-file-input"), { target: { files: [makeFile()] } });
    fireEvent.click(screen.getByTestId("upload-wizard-next"));

    fireEvent.click(screen.getByTestId("upload-wizard-confirm-upload"));
    await waitFor(() => expect(props.uploadAndTrack).toHaveBeenCalledTimes(1));
    const [, , accountId] = props.uploadAndTrack.mock.calls[0];
    expect(accountId).toBe(ACCOUNT_B);
  });

  it("passes the selected account's id as uploadFilesAndTrack's third argument too (bundle path)", async () => {
    const props = makeProps();
    render(<UploadWizard {...props} />);
    fireEvent.click(screen.getByTestId(`upload-wizard-account-${ACCOUNT_B}`));
    fireEvent.click(screen.getByTestId("upload-wizard-next"));
    selectCategory("general-other");
    fireEvent.click(screen.getByTestId("upload-wizard-mode-public"));
    fireEvent.click(screen.getByTestId("upload-wizard-next"));
    fireEvent.change(screen.getByTestId("upload-wizard-add-file-input"), { target: { files: [makeFile("a.txt")] } });
    fireEvent.change(screen.getByTestId("upload-wizard-add-file-input"), { target: { files: [makeFile("b.txt")] } });
    fireEvent.click(screen.getByTestId("upload-wizard-next"));

    fireEvent.click(screen.getByTestId("upload-wizard-confirm-upload"));
    await waitFor(() => expect(props.uploadFilesAndTrack).toHaveBeenCalledTimes(1));
    const [, , accountId] = props.uploadFilesAndTrack.mock.calls[0];
    expect(accountId).toBe(ACCOUNT_B);
  });
});

describe("UploadWizard — Confirm & Upload threads the real encryptFor shape (Encrypted)", () => {
  it("calls uploadAndTrack with encryptFor naming the chosen Ouronet account, whose revealAccountSecret forwards to the injected prop", async () => {
    const props = makeProps();
    render(<UploadWizard {...props} />);
    fireEvent.click(screen.getByTestId(`upload-wizard-account-${ACCOUNT_A}`));
    fireEvent.click(screen.getByTestId("upload-wizard-next"));
    selectCategory("general-other");
    fireEvent.click(screen.getByTestId("upload-wizard-mode-encrypted"));
    fireEvent.click(screen.getByTestId("upload-wizard-encryptor-ouro-2"));
    fireEvent.click(screen.getByTestId("upload-wizard-next"));
    fireEvent.change(screen.getByTestId("upload-wizard-add-file-input"), { target: { files: [makeFile()] } });
    fireEvent.click(screen.getByTestId("upload-wizard-next"));

    fireEvent.click(screen.getByTestId("upload-wizard-confirm-upload"));
    await waitFor(() => expect(props.uploadAndTrack).toHaveBeenCalledTimes(1));
    const [, selection] = props.uploadAndTrack.mock.calls[0];
    const encryptFor = selection.encryptFor;
    expect(encryptFor).toBeDefined();
    if (encryptFor === undefined) throw new Error("unreachable — asserted defined above");
    expect(encryptFor.accountId).toBe("ouro-2");
    expect(encryptFor.accountAddress).toBe("Ѻ.ouro-two-address");

    // Forwards, rather than re-implements, the injected revealAccountSecret.
    await encryptFor.revealAccountSecret("ouro-2");
    expect(props.revealAccountSecret).toHaveBeenCalledWith("ouro-2");
  });
});

describe("UploadWizard — ensureCodexUnlocked gates Confirm & Upload", () => {
  it("omitted: proceeds exactly as before (backward compatible)", async () => {
    const props = makeProps();
    render(<UploadWizard {...props} />);
    advanceToReview();

    fireEvent.click(screen.getByTestId("upload-wizard-confirm-upload"));
    await waitFor(() => expect(props.uploadAndTrack).toHaveBeenCalledTimes(1));
  });

  it("resolves true: proceeds to the real upload call after being awaited first", async () => {
    const ensureCodexUnlocked = vi.fn(async () => true);
    const props = makeProps({ ensureCodexUnlocked });
    render(<UploadWizard {...props} />);
    advanceToReview();

    fireEvent.click(screen.getByTestId("upload-wizard-confirm-upload"));
    await waitFor(() => expect(props.uploadAndTrack).toHaveBeenCalledTimes(1));
    expect(ensureCodexUnlocked).toHaveBeenCalledTimes(1);
  });

  it("resolves false (cancel): returns to Review with no error shown, and never attempts the upload", async () => {
    const ensureCodexUnlocked = vi.fn(async () => false);
    const props = makeProps({ ensureCodexUnlocked });
    render(<UploadWizard {...props} />);
    advanceToReview();

    fireEvent.click(screen.getByTestId("upload-wizard-confirm-upload"));
    await waitFor(() => expect(ensureCodexUnlocked).toHaveBeenCalledTimes(1));
    expect(props.uploadAndTrack).not.toHaveBeenCalled();
    expect(props.uploadFilesAndTrack).not.toHaveBeenCalled();
    expect(screen.getByTestId("upload-wizard-step-review")).toBeInTheDocument();
    expect(screen.queryByTestId("upload-wizard-error")).not.toBeInTheDocument();
  });
});

describe("UploadWizard — failure returns to Step 3 for retry, not Step 0", () => {
  it("shows the error view on a rejected upload, and 'Back to review' re-shows the Review step (not the Account picker)", async () => {
    const uploadAndTrack = vi.fn(async () => {
      throw new Error("turbo rejected the data item");
    });
    const props = makeProps({ uploadAndTrack });
    render(<UploadWizard {...props} />);
    advanceToReview();

    fireEvent.click(screen.getByTestId("upload-wizard-confirm-upload"));
    expect(await screen.findByTestId("upload-wizard-error")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("upload-wizard-retry"));
    expect(screen.getByTestId("upload-wizard-step-review")).toBeInTheDocument();
    expect(screen.queryByTestId("upload-wizard-step-account")).not.toBeInTheDocument();
  });
});

describe("UploadWizard — Review & Cost tag preview: fixed, canonical row set (arweave-tag-schema-spec T4)", () => {
  it("a Public upload's tag-preview row NAMES, in order, exactly match ARWEAVE_TAG_SCHEMA.md's canonical order — including Codex-Encryptor/Codex-Encryption-Version rows that still render (with a placeholder), never omitted", () => {
    render(<UploadWizard {...makeProps()} />);
    advanceToReview(); // advanceToFiles() picks category "general-other" + Public mode.

    const rows = tagPreviewRows();
    expect(rows.map((r) => r.name)).toEqual(CANONICAL_REVIEW_TAG_ROW_NAMES);

    const byName = new Map(rows.map((r) => [r.name, r.value]));
    expect(byName.get("Codex-Encrypted")).toBe("false");
    // Still PRESENT as a row — just a "does not apply" placeholder, never a
    // real encryptor value and never a missing row.
    expect(byName.get("Codex-Encryptor")).toBe("— does not apply (public upload)");
    expect(byName.get("Codex-Encryption-Version")).toBe("— does not apply (public upload)");
    // "general-other" is neither nft-data nor an app/site category — both
    // get their own "does not apply" placeholders too, same fixed-row rule.
    expect(byName.get("Codex-Asset-Type")).toBe("— does not apply (not an NFT upload)");
    expect(byName.get("Codex-App-Id")).toBe("— does not apply (not an app/site upload)");
    expect(byName.get("Codex-App-Version")).toBe("— does not apply (not an app/site upload)");
  });

  it("an Encrypted upload's tag-preview row NAMES, in order, are IDENTICAL to the Public case — only Codex-Encryptor/Codex-Encryption-Version's displayed VALUES differ, from placeholder to the real encrypting account/pinned procedure version", () => {
    render(<UploadWizard {...makeProps()} />);
    fireEvent.click(screen.getByTestId(`upload-wizard-account-${ACCOUNT_A}`));
    fireEvent.click(screen.getByTestId("upload-wizard-next"));
    selectCategory("general-other");
    fireEvent.click(screen.getByTestId("upload-wizard-mode-encrypted")); // defaults to ouro-1
    fireEvent.click(screen.getByTestId("upload-wizard-next"));
    fireEvent.change(screen.getByTestId("upload-wizard-add-file-input"), { target: { files: [makeFile()] } });
    fireEvent.click(screen.getByTestId("upload-wizard-next"));

    const rows = tagPreviewRows();
    // SAME row set, SAME order as the Public case above — never shifts shape
    // based on what the user chose.
    expect(rows.map((r) => r.name)).toEqual(CANONICAL_REVIEW_TAG_ROW_NAMES);

    const byName = new Map(rows.map((r) => [r.name, r.value]));
    expect(byName.get("Codex-Encrypted")).toBe("true");
    // Must be the Ouronet account's OWN address, not an Arweave-canonical
    // one — the exact same value the real upload call's `encryptFor.
    // accountAddress` uses (see arweave-upload-encryption's design doc for
    // why these are different address spaces).
    expect(byName.get("Codex-Encryptor")).toBe("Ѻ.ouro-one-address");
    // The pinned CURRENT encryption-procedure version — never a placeholder,
    // never caller-suppliable, matching the real `uploadAndTrack` call this
    // preview must agree with (see the flow.ts assertions in
    // e3-library-flow.test.ts).
    expect(byName.get("Codex-Encryption-Version")).toBe(CODEX_ENCRYPTION_VERSION_CURRENT);
  });

  it("App-Id/App-Version show REAL values (not a placeholder) for an app/site category (software-code), while Codex-Encryptor/Codex-Encryption-Version still show the public placeholder", () => {
    render(<UploadWizard {...makeProps()} />);
    fireEvent.click(screen.getByTestId(`upload-wizard-account-${ACCOUNT_A}`));
    fireEvent.click(screen.getByTestId("upload-wizard-next"));
    selectCategory("software-code");
    fireEvent.change(screen.getByTestId("upload-wizard-app-id"), { target: { value: "my-app" } });
    fireEvent.change(screen.getByTestId("upload-wizard-app-version"), { target: { value: "1.2.3" } });
    fireEvent.click(screen.getByTestId("upload-wizard-mode-public"));
    fireEvent.click(screen.getByTestId("upload-wizard-next"));
    fireEvent.change(screen.getByTestId("upload-wizard-add-file-input"), { target: { files: [makeFile()] } });
    fireEvent.click(screen.getByTestId("upload-wizard-next"));

    const rows = tagPreviewRows();
    expect(rows.map((r) => r.name)).toEqual(CANONICAL_REVIEW_TAG_ROW_NAMES);

    const byName = new Map(rows.map((r) => [r.name, r.value]));
    expect(byName.get("Codex-App-Id")).toBe("my-app");
    expect(byName.get("Codex-App-Version")).toBe("1.2.3");
    expect(byName.get("Codex-Encryptor")).toBe("— does not apply (public upload)");
  });
});

/**
 * T3 (`arweave-streaming-ui`): `onConfirmUpload` now threads a 4th,
 * optional `callbacks` argument (`{ onProgress?, onRouteDecided? }`) into
 * `uploadAndTrack`/`uploadFilesAndTrack` — the real wiring's own call into
 * `library/flow.ts`'s `uploadAndTrack` is expected to forward these into
 * ITS OWN `onProgress`/`onUploadRouteDecided` options. These specs drive a
 * FAKE `uploadAndTrack` that calls those callbacks directly (the same "fake
 * at the seam" convention every other injected prop in this suite already
 * uses), proving the component's own state renders what arrives through
 * that call chain — never a hardcoded placeholder.
 */
describe("UploadWizard — T3: persistent progress rendering during an in-flight upload", () => {
  it("renders a persistent progress element during the 'uploading' phase that updates LIVE as the injected call drives onProgress, and disappears once the upload resolves", async () => {
    let resolveUpload: (value: UploadTrackResult) => void = () => {};
    const uploadAndTrack = vi.fn(
      (
        _file: File,
        _selection: UploadWizardSelection,
        _accountId: string,
        callbacks?: {
          onProgress?: (uploadedChunks: number, totalChunks: number) => void;
          onRouteDecided?: (route: "streaming" | "fallback") => void;
        },
      ) => {
        callbacks?.onRouteDecided?.("streaming");
        callbacks?.onProgress?.(1, 4);
        return new Promise<UploadTrackResult>((resolve) => {
          resolveUpload = resolve;
          // A second, later progress update — proves the rendered chunk
          // count tracks REAL, changing values, not a one-shot snapshot.
          void Promise.resolve().then(() => callbacks?.onProgress?.(3, 4));
        });
      },
    );
    const props = makeProps({ uploadAndTrack });
    render(<UploadWizard {...props} />);
    await flushStreamingSupportDetection();
    advanceToReview();

    fireEvent.click(screen.getByTestId("upload-wizard-confirm-upload"));

    // Appears immediately on entering "uploading" — persistent, not a toast.
    expect(await screen.findByTestId("upload-wizard-progress")).toBeInTheDocument();

    await waitFor(() =>
      expect(screen.getByTestId("upload-wizard-progress-chunks").textContent).toContain("3"),
    );
    expect(screen.getByTestId("upload-wizard-progress-chunks").textContent).toContain("4");
    // Still present right up until the upload actually resolves — it never
    // disappeared on its own mid-flight.
    expect(screen.getByTestId("upload-wizard-progress")).toBeInTheDocument();

    resolveUpload({ id: DATA_ITEM_ID, itemId: "item-uuid-1", ownerAddress: ACCOUNT_A, tags: [] });
    expect(await screen.findByTestId("upload-wizard-result")).toBeInTheDocument();
    // Scoped to the in-flight phase only — gone once the upload is done.
    expect(screen.queryByTestId("upload-wizard-progress")).not.toBeInTheDocument();
  });
});

/**
 * T3: the routing SIGNAL (which engine actually ran) is observable in the
 * DOM, driven by the SAME `onRouteDecided` callback the progress tests
 * above exercise — correct and distinguishable in BOTH cases.
 */
describe("UploadWizard — T3: the streaming-vs-fallback routing signal is observable and correct", () => {
  it("shows the streaming route when the injected call signals onRouteDecided('streaming')", async () => {
    const uploadAndTrack = vi.fn(
      async (
        _file: File,
        _selection: UploadWizardSelection,
        _accountId: string,
        callbacks?: { onRouteDecided?: (route: "streaming" | "fallback") => void },
      ) => {
        callbacks?.onRouteDecided?.("streaming");
        return { id: DATA_ITEM_ID, itemId: "item-uuid-1", ownerAddress: ACCOUNT_A, tags: [] };
      },
    );
    const props = makeProps({ uploadAndTrack });
    render(<UploadWizard {...props} />);
    await flushStreamingSupportDetection();
    advanceToReview();

    fireEvent.click(screen.getByTestId("upload-wizard-confirm-upload"));
    await waitFor(() =>
      expect(screen.getByTestId("upload-wizard-upload-route").textContent?.toLowerCase()).toContain("streaming"),
    );
  });

  it("shows the fallback route when the injected call signals onRouteDecided('fallback') — a DIFFERENT, distinguishable message", async () => {
    const uploadAndTrack = vi.fn(
      async (
        _file: File,
        _selection: UploadWizardSelection,
        _accountId: string,
        callbacks?: { onRouteDecided?: (route: "streaming" | "fallback") => void },
      ) => {
        callbacks?.onRouteDecided?.("fallback");
        return { id: DATA_ITEM_ID, itemId: "item-uuid-1", ownerAddress: ACCOUNT_A, tags: [] };
      },
    );
    const props = makeProps({ uploadAndTrack });
    render(<UploadWizard {...props} />);
    await flushStreamingSupportDetection();
    advanceToReview();

    fireEvent.click(screen.getByTestId("upload-wizard-confirm-upload"));
    await waitFor(() =>
      expect(screen.getByTestId("upload-wizard-upload-route").textContent?.toLowerCase()).not.toContain("streaming"),
    );
    expect(screen.getByTestId("upload-wizard-upload-route").textContent?.toLowerCase()).toContain("standard");
  });
});

/**
 * `arweave-upload-dry-run` T3: the Review step's "Test this upload" button
 * — a SECOND, entirely separate action from the real "Confirm & Upload"
 * button. Regression this guards against: a future change accidentally
 * routing the Test button through the real `uploadAndTrack`/
 * `uploadFilesAndTrack` path (spending nothing should never risk spending
 * something), or letting a dry run's own loading/result state leak into —
 * or be confused with — the real upload's `phase`/progress/result UI.
 */
function makeDryRunResult(overrides: Partial<DryRunResult> = {}): DryRunResult {
  return {
    success: true,
    filesTested: 1,
    totalBytes: 10,
    chunksPosted: 1,
    resumeTested: true,
    proofsValid: true,
    decryptRoundTripOk: "not-applicable",
    streamingSupported: true,
    elapsedMs: 42,
    errors: [],
    ...overrides,
  };
}

describe("UploadWizard — T3 (arweave-upload-dry-run): the 'Test this upload' button and its dedicated result panel", () => {
  it("is absent entirely when runDryRunUpload is not supplied — never crashes, never renders a dead button", () => {
    render(<UploadWizard {...makeProps()} />);
    advanceToReview();

    expect(screen.queryByTestId("upload-wizard-dry-run-button")).not.toBeInTheDocument();
  });

  it("is present and enabled under the same conditions as Confirm & Upload when runDryRunUpload IS supplied", () => {
    const runDryRunUpload = vi.fn(async () => makeDryRunResult());
    render(<UploadWizard {...makeProps({ runDryRunUpload })} />);
    advanceToReview();

    const button = screen.getByTestId("upload-wizard-dry-run-button");
    expect(button).toBeEnabled();
    // Same gate `upload-wizard-confirm-upload` itself uses: disabled when
    // there's nothing to test.
    expect(screen.getByTestId("upload-wizard-confirm-upload")).toBeEnabled();
  });

  it("clicking Test calls ONLY runDryRunUpload — never the real uploadAndTrack/uploadFilesAndTrack — with the current files/selection/accountId", async () => {
    const runDryRunUpload = vi.fn(
      async (_files: File[], _selection: UploadWizardSelection, _accountId: string) => makeDryRunResult(),
    );
    const props = makeProps({ runDryRunUpload });
    render(<UploadWizard {...props} />);
    advanceToReview();

    fireEvent.click(screen.getByTestId("upload-wizard-dry-run-button"));
    await waitFor(() => expect(runDryRunUpload).toHaveBeenCalledTimes(1));

    expect(props.uploadAndTrack).not.toHaveBeenCalled();
    expect(props.uploadFilesAndTrack).not.toHaveBeenCalled();
    const [files, selection, accountId] = runDryRunUpload.mock.calls[0]!;
    expect(files).toHaveLength(1);
    expect((selection as UploadWizardSelection).category).toBe("general-other");
    expect(accountId).toBe(ACCOUNT_A);
  });

  it("renders the resolved DryRunResult's fields in the dedicated panel, distinct from the real upload's result/progress/route testids", async () => {
    const result = makeDryRunResult({
      filesTested: 3,
      totalBytes: 12345,
      chunksPosted: 7,
      resumeTested: true,
      proofsValid: true,
      decryptRoundTripOk: true,
      streamingSupported: true,
      errors: [],
    });
    const runDryRunUpload = vi.fn(async () => result);
    render(<UploadWizard {...makeProps({ runDryRunUpload })} />);
    advanceToReview();

    fireEvent.click(screen.getByTestId("upload-wizard-dry-run-button"));
    const panel = await screen.findByTestId("upload-wizard-dry-run-result");

    expect(within(panel).getByTestId("upload-wizard-dry-run-success").textContent).toMatch(/pass/i);
    expect(within(panel).getByTestId("upload-wizard-dry-run-files-tested").textContent).toContain("3");
    expect(within(panel).getByTestId("upload-wizard-dry-run-total-bytes").textContent).toContain("12345");
    expect(within(panel).getByTestId("upload-wizard-dry-run-chunks-posted").textContent).toContain("7");
    expect(within(panel).getByTestId("upload-wizard-dry-run-resume-tested").textContent?.toLowerCase()).toContain("yes");
    expect(within(panel).getByTestId("upload-wizard-dry-run-proofs-valid").textContent?.toLowerCase()).toContain("yes");
    expect(within(panel).getByTestId("upload-wizard-dry-run-decrypt-round-trip").textContent?.toLowerCase()).toContain("yes");

    // Distinct from every real-upload testid — never the same element, never
    // a shared container.
    expect(screen.queryByTestId("upload-wizard-result")).not.toBeInTheDocument();
    expect(screen.queryByTestId("upload-wizard-progress")).not.toBeInTheDocument();
    expect(screen.queryByTestId("upload-wizard-upload-route")).not.toBeInTheDocument();
  });

  it("renders a clear FAILURE banner (never a false pass) and every error message when the engine reports success: false", async () => {
    const result = makeDryRunResult({
      success: false,
      proofsValid: false,
      decryptRoundTripOk: false,
      errors: ["Decrypt self-check failed: the posted ciphertext did not decrypt back to the original plaintext."],
    });
    const runDryRunUpload = vi.fn(async () => result);
    render(<UploadWizard {...makeProps({ runDryRunUpload })} />);
    advanceToReview();

    fireEvent.click(screen.getByTestId("upload-wizard-dry-run-button"));
    const panel = await screen.findByTestId("upload-wizard-dry-run-result");

    expect(within(panel).getByTestId("upload-wizard-dry-run-success").textContent).toMatch(/fail/i);
    expect(within(panel).getByTestId("upload-wizard-dry-run-errors").textContent).toContain(
      "Decrypt self-check failed",
    );
  });

  it("shows a running indicator while the dry run is in flight, and it disappears once the result renders", async () => {
    let resolveDryRun: (value: DryRunResult) => void = () => {};
    const runDryRunUpload = vi.fn(
      () =>
        new Promise<DryRunResult>((resolve) => {
          resolveDryRun = resolve;
        }),
    );
    render(<UploadWizard {...makeProps({ runDryRunUpload })} />);
    advanceToReview();

    fireEvent.click(screen.getByTestId("upload-wizard-dry-run-button"));
    expect(await screen.findByTestId("upload-wizard-dry-run-running")).toBeInTheDocument();

    resolveDryRun(makeDryRunResult());
    expect(await screen.findByTestId("upload-wizard-dry-run-result")).toBeInTheDocument();
    expect(screen.queryByTestId("upload-wizard-dry-run-running")).not.toBeInTheDocument();
  });

  it("a rejected runDryRunUpload call renders a dry-run-scoped error — never the real upload's own error view", async () => {
    const runDryRunUpload = vi.fn(async () => {
      throw new Error("No Arweave key found for the selected address.");
    });
    render(<UploadWizard {...makeProps({ runDryRunUpload })} />);
    advanceToReview();

    fireEvent.click(screen.getByTestId("upload-wizard-dry-run-button"));
    expect(await screen.findByTestId("upload-wizard-dry-run-error")).toHaveTextContent(
      "No Arweave key found for the selected address.",
    );
    expect(screen.queryByTestId("upload-wizard-error")).not.toBeInTheDocument();
  });

  it("the real phase/progress/route state is COMPLETELY untouched by a dry run — including a FAILED dry-run result — the real Confirm/Done/error views never render because of a dry run alone", async () => {
    const result = makeDryRunResult({ success: false, errors: ["simulated failure"] });
    const runDryRunUpload = vi.fn(async () => result);
    const props = makeProps({ runDryRunUpload });
    render(<UploadWizard {...props} />);
    await flushStreamingSupportDetection();
    advanceToReview();

    // Before: still on Review, no real-upload artifacts.
    expect(screen.getByTestId("upload-wizard-step-review")).toBeInTheDocument();
    expect(screen.queryByTestId("upload-wizard-progress")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("upload-wizard-dry-run-button"));
    await screen.findByTestId("upload-wizard-dry-run-result");

    // After a (failed) dry run: STILL on Review — never flipped to the
    // real upload's "uploading"/"done"/"error" views, and the real upload
    // was genuinely never attempted.
    expect(screen.getByTestId("upload-wizard-step-review")).toBeInTheDocument();
    expect(screen.queryByTestId("upload-wizard-progress")).not.toBeInTheDocument();
    expect(screen.queryByTestId("upload-wizard-result")).not.toBeInTheDocument();
    expect(screen.queryByTestId("upload-wizard-bundle-result")).not.toBeInTheDocument();
    expect(screen.queryByTestId("upload-wizard-error")).not.toBeInTheDocument();
    expect(screen.queryByTestId("upload-wizard-done")).not.toBeInTheDocument();
    expect(props.uploadAndTrack).not.toHaveBeenCalled();
    expect(props.uploadFilesAndTrack).not.toHaveBeenCalled();

    // Confirm & Upload is STILL fully usable afterward — a dry run never
    // leaves the real action gated/disabled.
    expect(screen.getByTestId("upload-wizard-confirm-upload")).toBeEnabled();
    fireEvent.click(screen.getByTestId("upload-wizard-confirm-upload"));
    await waitFor(() => expect(props.uploadAndTrack).toHaveBeenCalledTimes(1));
  });

  it("a bundle (2+ files) selection still calls runDryRunUpload exactly once with every file — never uploadFilesAndTrack", async () => {
    const runDryRunUpload = vi.fn(
      async (_files: File[], _selection: UploadWizardSelection, _accountId: string) =>
        makeDryRunResult({ filesTested: 2 }),
    );
    const props = makeProps({ runDryRunUpload });
    render(<UploadWizard {...props} />);
    advanceToFiles();
    fireEvent.change(screen.getByTestId("upload-wizard-add-file-input"), { target: { files: [makeFile("a.txt")] } });
    fireEvent.change(screen.getByTestId("upload-wizard-add-file-input"), { target: { files: [makeFile("b.txt")] } });
    fireEvent.click(screen.getByTestId("upload-wizard-next"));

    fireEvent.click(screen.getByTestId("upload-wizard-dry-run-button"));
    await waitFor(() => expect(runDryRunUpload).toHaveBeenCalledTimes(1));

    const [files] = runDryRunUpload.mock.calls[0]!;
    expect(files).toHaveLength(2);
    expect(props.uploadFilesAndTrack).not.toHaveBeenCalled();
  });
});
