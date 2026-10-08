/**
 * RED matrix for the Arweave panel LIBRARY area (E-10).
 *
 * Pins the `LibraryArea` contract: list pending+final NEWEST-FIRST (from E3's
 * `list(owner)`, distinguishable badges); open via a HEALTHY gateway (`openUrl(id,
 * {pool})` composes the URL from the healthy endpoint of a seeded fake pool, NOT
 * hardcoded arweave.net); a manifest entry renders a SINGLE link; and
 * rebuild-from-chain (`rebuildLibrary(owner, {store, pool})`) reconciles N records
 * newest-first.
 *
 * ALL Library/pool calls are FAKES. FAILS RED because `../src/panel/LibraryArea`
 * does not exist yet.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor, cleanup, fireEvent } from "@testing-library/react";

import { LibraryArea, CANNOT_DECRYPT_ENCRYPTOR_MESSAGE } from "../src/panel/LibraryArea";
import type { LibraryEntry } from "@ancientpantheon/codex-arweave/library";
import {
  deriveAccountAesKey,
  encryptWithDerivedKey,
} from "../src/crypto/fileEncryption.js";
import { bitStringOf } from "@ancientpantheon/codex-ouronet/codex-identity";
import type { ArweaveSeedAccountSource } from "../src/panel/ArweaveSeedsArea.js";

const OWNER = "tzXauR_QBlPW3ZRey3xBzaiDqPqLfiqWk1SWmk2BjM4";
const HEALTHY_ENDPOINT = "https://healthy.example";
const ID_NEW = "newNewNewNewNewNewNewNewNewNewNewNewNewNewNe";
const ID_OLD = "oldOldOldOldOldOldOldOldOldOldOldOldOldOldOl";
const ID_MANIFEST = "manManManManManManManManManManManManManManMa";

function makeEntry(overrides: Partial<LibraryEntry>): LibraryEntry {
  return {
    id: "id",
    owner: OWNER,
    itemId: "item",
    contentType: "text/plain",
    status: "final",
    createdAt: 0,
    tags: [],
    ...overrides,
  };
}

/** A fake gateway pool whose healthy endpoint the link composes against. */
function makePool() {
  return {
    getHealthSnapshot: () => [
      { endpoint: "https://down.example", healthy: false, active: false },
      { endpoint: HEALTHY_ENDPOINT, healthy: true, active: true },
    ],
    getActiveEndpoint: () => HEALTHY_ENDPOINT,
    execute: vi.fn(),
  };
}

function makeProps(overrides: Record<string, unknown> = {}) {
  const pool = makePool();
  return {
    owners: [OWNER],
    pool,
    // E3's list(owner) — newest-first is the store's job; here we return two entries.
    listLibrary: vi.fn(async (): Promise<LibraryEntry[]> => [
      makeEntry({ id: ID_NEW, createdAt: 200, status: "pending" }),
      makeEntry({ id: ID_OLD, createdAt: 100, status: "final" }),
    ]),
    // E3's openUrl(id, {pool}) composes the URL from the healthy endpoint.
    openUrl: vi.fn((id: string) => `${HEALTHY_ENDPOINT}/${id}`),
    // E3's rebuildLibrary(owner, {store, pool}) reconciles chain records.
    rebuildLibrary: vi.fn(async () => {}),
    ...overrides,
  };
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("LibraryArea — list newest-first", () => {
  it("lists pending + final entries newest-first with distinguishable status badges", async () => {
    render(<LibraryArea {...makeProps()} />);

    const items = await screen.findAllByTestId("library-entry");
    expect(items).toHaveLength(2);
    // Newest-first: the createdAt:200 entry precedes the createdAt:100 one.
    expect(items[0].textContent).toContain(ID_NEW);
    expect(items[1].textContent).toContain(ID_OLD);
    // Distinguishable badges: pending vs final.
    expect(within(items[0]).getByText(/pending/i)).toBeInTheDocument();
    expect(within(items[1]).getByText(/final/i)).toBeInTheDocument();
  });
});

describe("LibraryArea — open via a healthy gateway", () => {
  it("composes the open URL from the healthy endpoint via openUrl(id,{pool}), not hardcoded arweave.net", async () => {
    const props = makeProps();
    render(<LibraryArea {...props} />);
    await screen.findAllByTestId("library-entry");

    const link = screen.getAllByTestId("library-open-link")[0];
    expect(props.openUrl).toHaveBeenCalledWith(ID_NEW, expect.objectContaining({ pool: props.pool }));
    expect(link).toHaveAttribute("href", `${HEALTHY_ENDPOINT}/${ID_NEW}`);
    // The healthy endpoint drives the link — never the arweave.net default.
    expect(link.getAttribute("href")).not.toContain("arweave.net");
  });
});

describe("LibraryArea — manifest single-link", () => {
  it("renders a manifest entry as ONE link, not an expanded file list", async () => {
    const props = makeProps({
      listLibrary: vi.fn(async (): Promise<LibraryEntry[]> => [
        makeEntry({
          id: ID_MANIFEST,
          createdAt: 300,
          contentType: "application/x.arweave-manifest+json",
          manifest: { isManifest: true },
        }),
      ]),
    });
    render(<LibraryArea {...props} />);

    const entry = (await screen.findAllByTestId("library-entry"))[0];
    // Exactly one link for the manifest — not an expanded per-file list.
    expect(within(entry).getAllByRole("link")).toHaveLength(1);
    expect(within(entry).getByTestId("library-manifest-badge")).toBeInTheDocument();
  });

  it("falls back to the bare manifest id when no sibling file entry with a Codex-Path is known locally", async () => {
    const props = makeProps({
      listLibrary: vi.fn(async (): Promise<LibraryEntry[]> => [
        makeEntry({
          id: ID_MANIFEST,
          createdAt: 300,
          contentType: "application/x.arweave-manifest+json",
          manifest: { isManifest: true },
          uploadId: "upload-solo",
        }),
      ]),
    });
    render(<LibraryArea {...props} />);

    const entry = (await screen.findAllByTestId("library-entry"))[0];
    const link = within(entry).getByTestId("library-open-link");
    expect(link).toHaveAttribute("href", `${HEALTHY_ENDPOINT}/${ID_MANIFEST}`);
  });
});

describe("LibraryArea — rebuild from chain", () => {
  it("empty library → rebuild → shows the reconciled entries newest-first", async () => {
    const chainEntries = [
      makeEntry({ id: ID_NEW, createdAt: 200 }),
      makeEntry({ id: ID_OLD, createdAt: 100 }),
    ];
    let listCalls = 0;
    const listLibrary = vi.fn(async (): Promise<LibraryEntry[]> => {
      // First read (mount) is empty; after rebuild the reconciled set appears.
      listCalls += 1;
      return listCalls === 1 ? [] : chainEntries;
    });
    const props = makeProps({ listLibrary });
    render(<LibraryArea {...props} />);

    // Empty-state before rebuild.
    expect(await screen.findByTestId("library-empty")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("library-rebuild"));

    await waitFor(() =>
      expect(props.rebuildLibrary).toHaveBeenCalledWith(
        OWNER,
        expect.objectContaining({ pool: props.pool }),
      ),
    );
    const items = await screen.findAllByTestId("library-entry");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain(ID_NEW);
    expect(items[1].textContent).toContain(ID_OLD);
  });

  // Regression guard for the real-world "Rebuild from chain does nothing"
  // report: before this fix, `onRebuild` had no try/catch at all — a
  // rejected `rebuildLibrary` (wrong owner address, a thrown
  // `InvalidAddressError`, a network failure, anything) became an unhandled
  // promise rejection with ZERO visible UI change, which is indistinguishable
  // from the button silently doing nothing. This proves a failure is now
  // surfaced to the user instead of swallowed.
  it("surfaces a visible error when rebuildLibrary rejects, instead of silently doing nothing", async () => {
    const rebuildLibrary = vi.fn(async () => {
      throw new Error("queryOwnerUploads: invalid-address");
    });
    const props = makeProps({
      rebuildLibrary,
      listLibrary: vi.fn(async (): Promise<LibraryEntry[]> => []),
    });
    render(<LibraryArea {...props} />);

    expect(await screen.findByTestId("library-empty")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("library-rebuild"));

    await waitFor(() =>
      expect(screen.getByTestId("library-rebuild-error")).toHaveTextContent(
        "queryOwnerUploads: invalid-address",
      ),
    );
    // The empty-state message is still there — the failure never silently
    // pretended the rebuild succeeded with zero entries.
    expect(screen.getByTestId("library-empty")).toBeInTheDocument();
  });
});

/**
 * Bug report: a codex with MORE than one configured Arweave key (e.g. a
 * second key generated/imported after the first) could upload under
 * whichever key the Upload Wizard's Account step actually selected
 * (`arweave-upload-wizard-account-wiring`'s own per-call `accountId`
 * resolution), but the Library area was always scoped to a single hardcoded
 * `owner` — the FIRST configured key (`ForeignChainsWiring.tsx` picked
 * `foreignKeys.find((k) => k.chainId === ARWEAVE_CHAIN_ID)`, i.e. index 0).
 * An upload made under any OTHER key was therefore invisible in Library and
 * un-rebuildable, even though it genuinely exists on chain under a key this
 * very codex holds.
 *
 * Fix: `LibraryArea` is handed the FULL list of this chain's configured
 * owner addresses (`owners`) and aggregates `listLibrary`/`rebuildLibrary`
 * across every one of them — Library's whole point is "show me everything
 * I've uploaded", not "show me what one specific key uploaded".
 */
describe("LibraryArea — aggregates across every configured owner, not just the first", () => {
  const OWNER_2 = "secondOwnerAddressSecondOwnerAddressSecond_x";

  it("lists entries from EVERY owner address, merged newest-first, not just the first owner's", async () => {
    const listLibrary = vi.fn(async (owner: string): Promise<LibraryEntry[]> => {
      if (owner === OWNER) return [makeEntry({ id: ID_OLD, owner: OWNER, createdAt: 100 })];
      if (owner === OWNER_2) return [makeEntry({ id: ID_NEW, owner: OWNER_2, createdAt: 200 })];
      return [];
    });
    const props = makeProps({ owners: [OWNER, OWNER_2], listLibrary });
    render(<LibraryArea {...props} />);

    const items = await screen.findAllByTestId("library-entry");
    // Before the fix, `listLibrary` was only ever called with the FIRST owner
    // (OWNER) — OWNER_2's upload (ID_NEW) would never appear at all.
    expect(items).toHaveLength(2);
    expect(listLibrary).toHaveBeenCalledWith(OWNER);
    expect(listLibrary).toHaveBeenCalledWith(OWNER_2);
    // Merged newest-first across BOTH owners' entries, not just sorted within
    // one owner's own list.
    expect(items[0].textContent).toContain(ID_NEW);
    expect(items[1].textContent).toContain(ID_OLD);
  });

  it("rebuilds every configured owner's uploads from chain, not just the first", async () => {
    const rebuildLibrary = vi.fn(async () => {});
    const props = makeProps({
      owners: [OWNER, OWNER_2],
      listLibrary: vi.fn(async (): Promise<LibraryEntry[]> => []),
      rebuildLibrary,
    });
    render(<LibraryArea {...props} />);
    await screen.findByTestId("library-empty");

    fireEvent.click(screen.getByTestId("library-rebuild"));

    await waitFor(() => {
      expect(rebuildLibrary).toHaveBeenCalledWith(
        OWNER,
        expect.objectContaining({ pool: props.pool }),
      );
      expect(rebuildLibrary).toHaveBeenCalledWith(
        OWNER_2,
        expect.objectContaining({ pool: props.pool }),
      );
    });
  });
});

/* ───────────────────── T6: decrypt-on-download ───────────────────── */

const ID_PUBLIC = "pubPubPubPubPubPubPubPubPubPubPubPubPubPubPu";
const ID_ENCRYPTED = "encEncEncEncEncEncEncEncEncEncEncEncEncEncEn";

/** An Ouronet account this codex holds — the seam `downloadEntry` uses to map
 *  a `Codex-Encryptor` tag's address back to the `accountId`
 *  `revealAccountSecret` expects. `originMode: "seedWords"` + a real 2-word
 *  `revealAccountSecret` resolution mirrors `e5-seeds-area.test.tsx`'s own
 *  `DALOS_ACCOUNT`/`revealAccountSecret: async () => "hello world"` fixture
 *  (the same `bitStringOf` re-derivation path, proven fast/working under
 *  jsdom there already). */
const ENCRYPTOR_ADDRESS = "Ѻ.the-encrypting-account";
const ENCRYPTOR_SECRET = "hello world";
const ENCRYPTOR_ACCOUNT: ArweaveSeedAccountSource = {
  id: "acct-1",
  label: "Test Account",
  account: { address: ENCRYPTOR_ADDRESS, originMode: "seedWords" },
};

/** Bytes → standard-alphabet base64 text, without `Buffer` (browser-portable,
 *  matches `abToB64`-style helpers already used elsewhere in this package). */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

/**
 * Builds the EXACT on-chain byte layout T5's upload composition will produce
 * for an encrypted file: base64-encode the raw bytes, AES-GCM encrypt the
 * base64 text's UTF-8 bytes under the key derived from `ENCRYPTOR_ACCOUNT`'s
 * re-derived bitstring, then prepend the IV to the ciphertext (the documented
 * "prepend the IV" convention `LibraryArea`'s decrypt path must invert).
 */
async function buildEncryptedUploadBytes(originalBytes: Uint8Array): Promise<Uint8Array> {
  const bits = bitStringOf(ENCRYPTOR_ACCOUNT.account, ENCRYPTOR_SECRET);
  if (bits === null) throw new Error("test setup: bitStringOf failed to re-derive a bitstring");
  const key = await deriveAccountAesKey(bits);
  const base64Bytes = new TextEncoder().encode(bytesToBase64(originalBytes));
  const { ciphertext, iv } = await encryptWithDerivedKey(key, base64Bytes);
  const uploaded = new Uint8Array(iv.length + ciphertext.length);
  uploaded.set(iv, 0);
  uploaded.set(ciphertext, iv.length);
  return uploaded;
}

/** A fake `fetchFn` resolving `bytes` as the gateway's raw response body —
 *  the download path's only use of the `Response` it gets back is
 *  `.arrayBuffer()`. */
function makeDownloadFetchFn(bytes: Uint8Array): typeof fetch {
  return vi.fn(async () => ({
    arrayBuffer: async () => bytes.slice().buffer,
  })) as unknown as typeof fetch;
}

/** Stubs `URL.createObjectURL`/`revokeObjectURL` (capturing every Blob) and
 *  `HTMLAnchorElement.prototype.click` (capturing every anchor clicked) — the
 *  SAME browser-download-capture idiom `e5-seeds-area.test.tsx`'s own
 *  "downloads the Arweave keyfile" row already uses. Callers MUST call the
 *  returned `restore()` in a `finally` block. */
function stubBrowserDownload(): {
  blobs: Blob[];
  anchors: HTMLAnchorElement[];
  restore: () => void;
} {
  const blobs: Blob[] = [];
  const anchors: HTMLAnchorElement[] = [];
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: (blob: Blob) => {
      blobs.push(blob);
      return "blob:stub";
    },
    revokeObjectURL: () => {},
  });
  const clickSpy = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(function (this: HTMLAnchorElement) {
      anchors.push(this);
    });
  return {
    blobs,
    anchors,
    restore: () => {
      clickSpy.mockRestore();
      vi.unstubAllGlobals();
    },
  };
}

describe("LibraryArea — download action is offered alongside Open", () => {
  it("renders a Download button for every entry, in addition to the unchanged Open link", async () => {
    render(<LibraryArea {...makeProps()} />);

    const items = await screen.findAllByTestId("library-entry");
    for (const item of items) {
      expect(within(item).getByTestId("library-open-link")).toBeInTheDocument();
      expect(within(item).getByTestId("library-download-button")).toBeInTheDocument();
    }
  });
});

describe("LibraryArea — downloading a PUBLIC entry", () => {
  it("downloads exactly the bytes served at the Open link's own URL — unchanged from today's Open behavior", async () => {
    const originalBytes = new TextEncoder().encode("hello, this is a public file");
    const fetchFn = makeDownloadFetchFn(originalBytes);
    const props = makeProps({
      fetchFn,
      listLibrary: vi.fn(async (): Promise<LibraryEntry[]> => [
        makeEntry({ id: ID_PUBLIC, itemId: "item-public", createdAt: 100, tags: [] }),
      ]),
    });
    const capture = stubBrowserDownload();

    try {
      render(<LibraryArea {...props} />);
      const item = (await screen.findAllByTestId("library-entry"))[0]!;

      // The Open link is untouched — same URL a public download fetches from.
      const openHref = within(item).getByTestId("library-open-link").getAttribute("href");
      expect(openHref).toBe(`${HEALTHY_ENDPOINT}/${ID_PUBLIC}`);

      fireEvent.click(within(item).getByTestId("library-download-button"));

      await waitFor(() => expect(capture.blobs).toHaveLength(1));
      expect(fetchFn).toHaveBeenCalledWith(openHref);
      const downloaded = new Uint8Array(await capture.blobs[0]!.arrayBuffer());
      expect(Array.from(downloaded)).toEqual(Array.from(originalBytes));
      // No Codex-Path tag on this entry → falls back to the entry's itemId.
      expect(capture.anchors[0]!.download).toBe("item-public");
      expect(within(item).queryByTestId("library-download-error")).not.toBeInTheDocument();
    } finally {
      capture.restore();
    }
  });
});

describe("LibraryArea — downloading an ENCRYPTED entry", () => {
  it("decrypts via the matching Ouronet account and downloads the EXACT original plaintext under the original filename", async () => {
    const originalBytes = new TextEncoder().encode("the quick brown fox, TOP SECRET");
    const uploadedBytes = await buildEncryptedUploadBytes(originalBytes);
    const fetchFn = makeDownloadFetchFn(uploadedBytes);
    const revealAccountSecret = vi.fn(async () => ENCRYPTOR_SECRET);
    const props = makeProps({
      fetchFn,
      revealAccountSecret,
      ouronetAccounts: [ENCRYPTOR_ACCOUNT],
      listLibrary: vi.fn(async (): Promise<LibraryEntry[]> => [
        makeEntry({
          id: ID_ENCRYPTED,
          itemId: "item-encrypted",
          createdAt: 100,
          contentType: "text/plain",
          tags: [
            { name: "Codex-Encrypted", value: "true" },
            { name: "Codex-Encryptor", value: ENCRYPTOR_ADDRESS },
            { name: "Codex-Path", value: "secrets/plan.txt" },
          ],
        }),
      ]),
    });
    const capture = stubBrowserDownload();

    try {
      render(<LibraryArea {...props} />);
      const item = (await screen.findAllByTestId("library-entry"))[0]!;

      fireEvent.click(within(item).getByTestId("library-download-button"));

      await waitFor(() => expect(capture.blobs).toHaveLength(1));
      expect(revealAccountSecret).toHaveBeenCalledWith(ENCRYPTOR_ACCOUNT.id);
      const downloaded = new Uint8Array(await capture.blobs[0]!.arrayBuffer());
      expect(Array.from(downloaded)).toEqual(Array.from(originalBytes));
      expect(capture.anchors[0]!.download).toBe("secrets/plan.txt");
      expect(within(item).queryByTestId("library-download-error")).not.toBeInTheDocument();
    } finally {
      capture.restore();
    }
  });

  function encryptedEntryProps(overrides: Record<string, unknown>) {
    return makeProps({
      listLibrary: vi.fn(async (): Promise<LibraryEntry[]> => [
        makeEntry({
          id: ID_ENCRYPTED,
          itemId: "item-encrypted",
          createdAt: 100,
          tags: [
            { name: "Codex-Encrypted", value: "true" },
            { name: "Codex-Encryptor", value: ENCRYPTOR_ADDRESS },
          ],
        }),
      ]),
      ...overrides,
    });
  }

  it('surfaces the specific "doesn\'t hold the account" message when revealAccountSecret is absent — never a generic failure, never a corrupted download', async () => {
    const uploadedBytes = await buildEncryptedUploadBytes(new TextEncoder().encode("secret"));
    const props = encryptedEntryProps({
      fetchFn: makeDownloadFetchFn(uploadedBytes),
      ouronetAccounts: [ENCRYPTOR_ACCOUNT],
      revealAccountSecret: undefined,
    });
    const capture = stubBrowserDownload();

    try {
      render(<LibraryArea {...props} />);
      const item = (await screen.findAllByTestId("library-entry"))[0]!;

      fireEvent.click(within(item).getByTestId("library-download-button"));

      await waitFor(() =>
        expect(within(item).getByTestId("library-download-error")).toHaveTextContent(
          CANNOT_DECRYPT_ENCRYPTOR_MESSAGE,
        ),
      );
      expect(capture.blobs).toHaveLength(0);
    } finally {
      capture.restore();
    }
  });

  it('surfaces the specific "doesn\'t hold the account" message when no held account matches the Codex-Encryptor address', async () => {
    const uploadedBytes = await buildEncryptedUploadBytes(new TextEncoder().encode("secret"));
    const otherAccount: ArweaveSeedAccountSource = {
      id: "acct-other",
      label: "A different account",
      account: { address: "Ѻ.some-other-address", originMode: "seedWords" },
    };
    const props = encryptedEntryProps({
      fetchFn: makeDownloadFetchFn(uploadedBytes),
      ouronetAccounts: [otherAccount],
      revealAccountSecret: vi.fn(async () => "irrelevant"),
    });
    const capture = stubBrowserDownload();

    try {
      render(<LibraryArea {...props} />);
      const item = (await screen.findAllByTestId("library-entry"))[0]!;

      fireEvent.click(within(item).getByTestId("library-download-button"));

      await waitFor(() =>
        expect(within(item).getByTestId("library-download-error")).toHaveTextContent(
          CANNOT_DECRYPT_ENCRYPTOR_MESSAGE,
        ),
      );
      expect(capture.blobs).toHaveLength(0);
    } finally {
      capture.restore();
    }
  });

  it('surfaces the specific "doesn\'t hold the account" message when revealAccountSecret resolves null', async () => {
    const uploadedBytes = await buildEncryptedUploadBytes(new TextEncoder().encode("secret"));
    const props = encryptedEntryProps({
      fetchFn: makeDownloadFetchFn(uploadedBytes),
      ouronetAccounts: [ENCRYPTOR_ACCOUNT],
      revealAccountSecret: vi.fn(async () => null),
    });
    const capture = stubBrowserDownload();

    try {
      render(<LibraryArea {...props} />);
      const item = (await screen.findAllByTestId("library-entry"))[0]!;

      fireEvent.click(within(item).getByTestId("library-download-button"));

      await waitFor(() =>
        expect(within(item).getByTestId("library-download-error")).toHaveTextContent(
          CANNOT_DECRYPT_ENCRYPTOR_MESSAGE,
        ),
      );
      expect(capture.blobs).toHaveLength(0);
    } finally {
      capture.restore();
    }
  });
});

/* ──────────────── owner-reported redesign: category/bundle grouping,
 * separated status/manifest badges, copyable link box, pagination
 * ──────────────── */

const ID_FILE_A = "fileAfileAfileAfileAfileAfileAfileAfileAfile";
const ID_FILE_B = "fileBfileBfileBfileBfileBfileBfileBfileBfile";

describe("LibraryArea — separated status/manifest badges (no concatenated text)", () => {
  // Regression guard for the real-world report: id/status/manifest-badge used
  // to be three bare adjacent `<span>` elements with no styling/separator at
  // all — rendered/flattened text read as one crushed-together string (e.g.
  // "...Tn0final" or "...finalmanifest"). Each badge must now be its OWN
  // padded, bordered pill — not just a plain inline span relying on an
  // invisible space character for separation.
  it("renders the status badge as its own padded pill with exactly its own label", async () => {
    const props = makeProps({
      listLibrary: vi.fn(async (): Promise<LibraryEntry[]> => [
        makeEntry({ id: ID_NEW, createdAt: 100, status: "final" }),
      ]),
    });
    render(<LibraryArea {...props} />);

    const entry = (await screen.findAllByTestId("library-entry"))[0]!;
    const statusBadge = within(entry).getByTestId("library-status-final");
    // The label is exactly its own text — not the id or anything else glued on.
    expect(statusBadge.textContent).toBe("Final");
    // Real padding — a styled pill, not a bare unstyled <span>.
    expect(statusBadge.style.padding).not.toBe("");
  });

  it("renders the manifest badge as its OWN pill, separate from the status badge, with no shared text", async () => {
    const props = makeProps({
      listLibrary: vi.fn(async (): Promise<LibraryEntry[]> => [
        makeEntry({
          id: ID_MANIFEST,
          createdAt: 300,
          status: "final",
          contentType: "application/x.arweave-manifest+json",
          manifest: { isManifest: true },
        }),
      ]),
    });
    render(<LibraryArea {...props} />);

    const entry = (await screen.findAllByTestId("library-entry"))[0]!;
    const statusBadge = within(entry).getByTestId("library-status-final");
    const manifestBadge = within(entry).getByTestId("library-manifest-badge");

    // Two DISTINCT, independently-styled elements — never one node carrying
    // both labels concatenated.
    expect(statusBadge).not.toBe(manifestBadge);
    expect(statusBadge.textContent).toBe("Final");
    expect(manifestBadge.textContent).toBe("Manifest");
    expect(manifestBadge.style.padding).not.toBe("");
  });
});

describe("LibraryArea — category grouping", () => {
  it("groups entries into labeled category sections, rendering only the sections that actually have entries", async () => {
    const props = makeProps({
      listLibrary: vi.fn(async (): Promise<LibraryEntry[]> => [
        makeEntry({
          id: ID_NEW,
          createdAt: 200,
          tags: [{ name: "Codex-Category", value: "nft-data" }],
        }),
        makeEntry({
          id: ID_OLD,
          createdAt: 100,
          tags: [{ name: "Codex-Category", value: "legal-records" }],
        }),
      ]),
    });
    render(<LibraryArea {...props} />);

    await screen.findAllByTestId("library-entry");

    // Only the two categories actually present render a section header.
    expect(screen.getByTestId("library-category-nft-data")).toHaveTextContent("NFT Data");
    expect(screen.getByTestId("library-category-legal-records")).toHaveTextContent("Legal Records");
    // A category with zero entries (e.g. "software-code") never renders a
    // header at all — no empty section.
    expect(screen.queryByTestId("library-category-software-code")).not.toBeInTheDocument();
  });

  it("falls back to an Uncategorized section for an entry with no Codex-Category tag", async () => {
    const props = makeProps({
      listLibrary: vi.fn(async (): Promise<LibraryEntry[]> => [makeEntry({ id: ID_NEW, createdAt: 100, tags: [] })]),
    });
    render(<LibraryArea {...props} />);

    await screen.findAllByTestId("library-entry");
    expect(screen.getByTestId("library-category-uncategorized")).toHaveTextContent("Uncategorized");
  });

  // `LibraryArea` is now mounted ONLY on the panel's "General Data" tab
  // (`arweave-upload-library` follow-up redesign) — the "Codex" tab's own
  // `CodexBackupHistoryArea` is the dedicated "just my codex backups" view.
  // An entry tagged `Codex-Category: codex-backup` must never show up here
  // too, or the same upload would read as appearing TWICE across the two
  // tabs with no indication they're the same thing.
  it("never renders a codex-backup entry or its category section — that's the Codex tab's job", async () => {
    const props = makeProps({
      listLibrary: vi.fn(async (): Promise<LibraryEntry[]> => [
        makeEntry({
          id: ID_NEW,
          createdAt: 200,
          tags: [{ name: "Codex-Category", value: "nft-data" }],
        }),
        makeEntry({
          id: ID_OLD,
          createdAt: 100,
          tags: [{ name: "Codex-Category", value: "codex-backup" }],
        }),
      ]),
    });
    render(<LibraryArea {...props} />);

    await screen.findAllByTestId("library-entry");
    expect(screen.queryByTestId("library-category-codex-backup")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("library-entry")).toHaveLength(1);
  });
});

describe("LibraryArea — bundle grouping (a real nft-data 2-file upload)", () => {
  // The owner's own real-world case: "I have 2 files uploaded, I would have
  // to be shown two entries... one per manifest, one per subentry." A
  // manifest + its 2 files sharing one Codex-Upload-Id must render as ONE
  // group with 2 named file rows — not 3 flat peer rows each with its own
  // full Open/Download controls.
  function bundleFixture(): LibraryEntry[] {
    return [
      makeEntry({
        id: ID_MANIFEST,
        createdAt: 300,
        contentType: "application/x.arweave-manifest+json",
        manifest: { isManifest: true },
        uploadId: "upload-1",
        tags: [{ name: "Codex-Category", value: "nft-data" }],
      }),
      makeEntry({
        id: ID_FILE_A,
        createdAt: 300,
        uploadId: "upload-1",
        tags: [
          { name: "Codex-Category", value: "nft-data" },
          { name: "Codex-Path", value: "Set_Bunny_RGB_Big.png" },
        ],
      }),
      makeEntry({
        id: ID_FILE_B,
        createdAt: 300,
        uploadId: "upload-1",
        tags: [
          { name: "Codex-Category", value: "nft-data" },
          { name: "Codex-Path", value: "metadata.json" },
        ],
      }),
    ];
  }

  it("renders the manifest + 2 files as ONE group with exactly 2 named file rows, not 3 flat peer rows", async () => {
    const props = makeProps({ listLibrary: vi.fn(async () => bundleFixture()) });
    render(<LibraryArea {...props} />);

    const group = await screen.findByTestId("library-bundle-group");
    const rows = within(group).getAllByTestId("library-entry");
    // Exactly the 2 FILES — the manifest is demoted to the group header, not
    // a third peer row.
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.textContent).join(" ")).toContain("Set_Bunny_RGB_Big.png");
    expect(rows.map((r) => r.textContent).join(" ")).toContain("metadata.json");
    // The manifest is NOT given a full peer row of its own.
    expect(screen.queryAllByTestId("library-entry")).toHaveLength(2);
  });

  it("the bundle header shows the manifest's own id, de-emphasized, with no Open/Download controls of its own", async () => {
    const props = makeProps({ listLibrary: vi.fn(async () => bundleFixture()) });
    render(<LibraryArea {...props} />);

    const header = await screen.findByTestId("library-bundle-header");
    expect(within(header).getByTestId("library-bundle-manifest-id")).toHaveTextContent(ID_MANIFEST);
    // No Open link or Download button lives in the header itself.
    expect(within(header).queryByTestId("library-open-link")).not.toBeInTheDocument();
    expect(within(header).queryByTestId("library-download-button")).not.toBeInTheDocument();
  });

  it("each file row's Open link is the file's OWN direct URL — the exact link to paste into the NFT", async () => {
    const props = makeProps({ listLibrary: vi.fn(async () => bundleFixture()) });
    render(<LibraryArea {...props} />);

    const group = await screen.findByTestId("library-bundle-group");
    const rows = within(group).getAllByTestId("library-entry");
    const imageRow = rows.find((r) => r.textContent?.includes("Set_Bunny_RGB_Big.png"))!;
    expect(within(imageRow).getByTestId("library-open-link")).toHaveAttribute(
      "href",
      `${HEALTHY_ENDPOINT}/${ID_FILE_A}`,
    );
  });
});

describe("LibraryArea — copyable link box with a Copy button", () => {
  function publicEntryProps() {
    return makeProps({
      listLibrary: vi.fn(async (): Promise<LibraryEntry[]> => [
        makeEntry({ id: ID_PUBLIC, createdAt: 100, tags: [] }),
      ]),
    });
  }

  it("shows the entry's full access URL in a link box, and Copy writes the EXACT URL to the clipboard", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });

    try {
      render(<LibraryArea {...publicEntryProps()} />);
      const entry = (await screen.findAllByTestId("library-entry"))[0]!;

      const linkBox = within(entry).getByTestId("library-link-box");
      expect(linkBox.textContent).toBe(`${HEALTHY_ENDPOINT}/${ID_PUBLIC}`);

      fireEvent.click(within(entry).getByTestId("library-copy-button"));

      await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${HEALTHY_ENDPOINT}/${ID_PUBLIC}`));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("shows a visible fallback instead of crashing or doing nothing when the clipboard write rejects", async () => {
    const writeText = vi.fn(async () => {
      throw new Error("denied");
    });
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });

    try {
      render(<LibraryArea {...publicEntryProps()} />);
      const entry = (await screen.findAllByTestId("library-entry"))[0]!;

      fireEvent.click(within(entry).getByTestId("library-copy-button"));

      await waitFor(() =>
        expect(within(entry).getByTestId("library-copy-failed")).toHaveTextContent(/copy failed/i),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("shows the same visible fallback when the clipboard API is entirely unavailable, rather than silently doing nothing", async () => {
    vi.stubGlobal("navigator", { ...navigator, clipboard: undefined });

    try {
      render(<LibraryArea {...publicEntryProps()} />);
      const entry = (await screen.findAllByTestId("library-entry"))[0]!;

      fireEvent.click(within(entry).getByTestId("library-copy-button"));

      expect(within(entry).getByTestId("library-copy-failed")).toHaveTextContent(/copy failed/i);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("LibraryArea — pagination", () => {
  function manyEntries(count: number): LibraryEntry[] {
    return Array.from({ length: count }, (_, i) =>
      makeEntry({
        id: `pageEntry${String(i).padStart(2, "0")}pageEntrypageEntrypad`.slice(0, 43),
        createdAt: 1000 - i,
      }),
    );
  }

  it("shows no pagination control when everything fits on one page", async () => {
    const props = makeProps({ listLibrary: vi.fn(async () => manyEntries(3)) });
    render(<LibraryArea {...props} />);

    await screen.findAllByTestId("library-entry");
    expect(screen.queryByTestId("library-pager")).not.toBeInTheDocument();
  });

  // Page size bumped from 10 → 25 (owner's own "15000 photos" scenario):
  // the redesigned row is a compact 2-line layout with 3 square icon
  // buttons instead of the old 3-sub-row layout + full-width text-button
  // actions, roughly half the vertical space per entry — so twice as many
  // units comfortably fit on a page without feeling any less scannable.
  it("paginates top-level units (25 per page) with a working Prev/Next and a correct page count", async () => {
    const props = makeProps({ listLibrary: vi.fn(async () => manyEntries(30)) });
    render(<LibraryArea {...props} />);

    await screen.findAllByTestId("library-entry");
    // 30 units at 25/page -> 2 pages.
    expect(screen.getByTestId("library-page-label")).toHaveTextContent("Page 1 of 2");
    expect(screen.getAllByTestId("library-entry")).toHaveLength(25);
    expect(screen.getByTestId("library-page-prev")).toBeDisabled();

    fireEvent.click(screen.getByTestId("library-page-next"));

    expect(screen.getByTestId("library-page-label")).toHaveTextContent("Page 2 of 2");
    expect(screen.getAllByTestId("library-entry")).toHaveLength(5);
    expect(screen.getByTestId("library-page-next")).toBeDisabled();

    fireEvent.click(screen.getByTestId("library-page-prev"));
    expect(screen.getByTestId("library-page-label")).toHaveTextContent("Page 1 of 2");
  });

  it("counts a bundle group as ONE page unit, not one per file row", async () => {
    // 1 bundle (manifest + 2 files = 1 unit) + 9 solo entries = 10 units,
    // all fitting on page 1 with zero spillover, even though the raw entry
    // count is 12.
    const bundle = [
      makeEntry({
        id: ID_MANIFEST,
        createdAt: 500,
        contentType: "application/x.arweave-manifest+json",
        manifest: { isManifest: true },
        uploadId: "upload-page",
      }),
      makeEntry({ id: ID_FILE_A, createdAt: 500, uploadId: "upload-page", tags: [{ name: "Codex-Path", value: "a.png" }] }),
      makeEntry({ id: ID_FILE_B, createdAt: 500, uploadId: "upload-page", tags: [{ name: "Codex-Path", value: "b.png" }] }),
    ];
    const solos = manyEntries(9);
    const props = makeProps({ listLibrary: vi.fn(async () => [...bundle, ...solos]) });
    render(<LibraryArea {...props} />);

    await screen.findAllByTestId("library-bundle-group");
    expect(screen.queryByTestId("library-pager")).not.toBeInTheDocument();
  });
});

/* ───────────── owner's follow-up redesign: compact 2-line rows with 3
 * square icon buttons, and collapsible categories (`arweave-upload-library`
 * follow-up: "lets make two Tabs here... each entry has to use as little as
 * possible in height... categories must be collapsable") ───────────── */

describe("LibraryArea — compact two-line row with 3 square icon buttons", () => {
  function singlePublicEntryProps() {
    return makeProps({
      listLibrary: vi.fn(async (): Promise<LibraryEntry[]> => [
        makeEntry({ id: ID_PUBLIC, itemId: "item-public", createdAt: 100, tags: [] }),
      ]),
    });
  }

  it("renders exactly two lines: name+status on line 1, the link box + actions on line 2 — not the old 3-sub-row layout", async () => {
    render(<LibraryArea {...singlePublicEntryProps()} />);

    const entry = (await screen.findAllByTestId("library-entry"))[0]!;
    // Exactly 2 direct "line" children — a regression guard against the old
    // layout (header row, then a separate CopyLinkBox row, then a separate
    // actions row = 3 rows), which this redesign deliberately collapses to 2
    // so thousands of entries stay scannable per page.
    const line1 = within(entry).getByTestId("library-entry-label").closest("[data-testid='library-entry-line1']");
    const line2 = screen.getByTestId("library-link-box").closest("[data-testid='library-entry-line2']");
    expect(line1).toBeInTheDocument();
    expect(line2).toBeInTheDocument();
    // Open/Download/Copy all live on line 2, alongside the link box — not a
    // third row of their own.
    expect(within(line2 as HTMLElement).getByTestId("library-open-link")).toBeInTheDocument();
    expect(within(line2 as HTMLElement).getByTestId("library-download-button")).toBeInTheDocument();
    expect(within(line2 as HTMLElement).getByTestId("library-copy-button")).toBeInTheDocument();
  });

  it("Open/Download/Copy are square, icon-only buttons with title/aria-label naming the action — no visible text label", async () => {
    render(<LibraryArea {...singlePublicEntryProps()} />);

    const entry = (await screen.findAllByTestId("library-entry"))[0]!;
    const open = within(entry).getByTestId("library-open-link");
    const download = within(entry).getByTestId("library-download-button");
    const copy = within(entry).getByTestId("library-copy-button");

    for (const [el, action] of [
      [open, "open"],
      [download, "download"],
      [copy, "copy"],
    ] as const) {
      // No rendered text label — icon-only.
      expect(el.textContent).toBe("");
      // A real icon glyph is present (lucide renders an <svg>).
      expect(el.querySelector("svg")).toBeInTheDocument();
      // `title`/`aria-label` name the action for accessibility, since there
      // is no visible text.
      expect((el.getAttribute("title") ?? "").toLowerCase()).toContain(action);
      expect((el.getAttribute("aria-label") ?? "").toLowerCase()).toContain(action);
      // Square — a small icon button, not a wide text pill.
      expect(el.style.width).not.toBe("");
      expect(el.style.width).toBe(el.style.height);
    }
  });

  it("the Open/Download/Copy icon buttons still trigger their exact existing behavior, just re-skinned", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });

    try {
      render(<LibraryArea {...singlePublicEntryProps()} />);
      const entry = (await screen.findAllByTestId("library-entry"))[0]!;

      const openHref = within(entry).getByTestId("library-open-link").getAttribute("href");
      expect(openHref).toBe(`${HEALTHY_ENDPOINT}/${ID_PUBLIC}`);

      fireEvent.click(within(entry).getByTestId("library-copy-button"));
      await waitFor(() => expect(writeText).toHaveBeenCalledWith(openHref));
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

/* ───────────── arweave-library-export: "Export Library" button ─────────────
 *
 * The owner is about to upload ~6.8GB of NFT images; every filename→link
 * pairing needs to leave the app as data to construct on-chain metadata-
 * update transactions afterward, not be copied one paginated row at a time.
 */
describe("LibraryArea — Export Library", () => {
  function parseExportedJson(capture: { blobs: Blob[] }): Promise<{
    exportedAt: string;
    itemCount: number;
    items: Array<Record<string, unknown>>;
  }> {
    return capture.blobs[0]!.text().then((text) => JSON.parse(text));
  }

  it("exports EVERY entry across every owner and every page, not just the current page", async () => {
    // 30 units (> LIBRARY_PAGE_SIZE of 25) spread across two owners, so a
    // current-page-only or single-owner-only bug would under-count.
    const OWNER_2 = "secondOwnerAddressSecondOwnerAddressSecond_x";
    const owner1Entries = Array.from({ length: 20 }, (_, i) =>
      makeEntry({
        id: `o1Entry${String(i).padStart(2, "0")}o1Entryo1Entryo1Entrypad`.slice(0, 43),
        owner: OWNER,
        createdAt: 1000 - i,
      }),
    );
    const owner2Entries = Array.from({ length: 11 }, (_, i) =>
      makeEntry({
        id: `o2Entry${String(i).padStart(2, "0")}o2Entryo2Entryo2Entrypad`.slice(0, 43),
        owner: OWNER_2,
        createdAt: 500 - i,
      }),
    );
    const listLibrary = vi.fn(async (owner: string): Promise<LibraryEntry[]> => {
      if (owner === OWNER) return owner1Entries;
      if (owner === OWNER_2) return owner2Entries;
      return [];
    });
    const props = makeProps({ owners: [OWNER, OWNER_2], listLibrary });
    const capture = stubBrowserDownload();

    try {
      render(<LibraryArea {...props} />);
      await screen.findAllByTestId("library-entry");
      // Confirm pagination is genuinely in play (more than one page of units).
      expect(screen.getByTestId("library-pager")).toBeInTheDocument();

      fireEvent.click(screen.getByTestId("library-export"));

      await waitFor(() => expect(capture.blobs).toHaveLength(1));
      const exported = await parseExportedJson(capture);
      expect(exported.itemCount).toBe(31);
      expect(exported.items).toHaveLength(31);
    } finally {
      capture.restore();
    }
  });

  it("each exported item's filename/link matches exactly what that entry's own rendered row shows", async () => {
    const props = makeProps({
      listLibrary: vi.fn(async (): Promise<LibraryEntry[]> => [
        makeEntry({
          id: ID_PUBLIC,
          createdAt: 200,
          tags: [{ name: "Codex-Path", value: "photos/sunset.png" }],
        }),
        makeEntry({ id: ID_OLD, itemId: "item-old", createdAt: 100, tags: [] }),
      ]),
    });
    const capture = stubBrowserDownload();

    try {
      render(<LibraryArea {...props} />);
      const rows = await screen.findAllByTestId("library-entry");
      const linkBoxes = rows.map((r) => within(r).getByTestId("library-link-box").textContent);

      fireEvent.click(screen.getByTestId("library-export"));

      await waitFor(() => expect(capture.blobs).toHaveLength(1));
      const exported = await parseExportedJson(capture);

      const tagged = exported.items.find((i) => i.id === ID_PUBLIC)!;
      expect(tagged.filename).toBe("photos/sunset.png");
      expect(tagged.link).toBe(linkBoxes[0]);

      const untagged = exported.items.find((i) => i.id === ID_OLD)!;
      // No Codex-Path tag → falls back to the entry's itemId, same as the
      // row's own label convention.
      expect(untagged.filename).toBe("item-old");
      expect(untagged.link).toBe(linkBoxes[1]);
    } finally {
      capture.restore();
    }
  });

  it("a bundled file's exported link is the real manifest-aware per-file URL, not a bare manifest link", async () => {
    const bundleFixture: LibraryEntry[] = [
      makeEntry({
        id: ID_MANIFEST,
        createdAt: 300,
        contentType: "application/x.arweave-manifest+json",
        manifest: { isManifest: true },
        uploadId: "upload-1",
      }),
      makeEntry({
        id: ID_FILE_A,
        createdAt: 300,
        uploadId: "upload-1",
        tags: [{ name: "Codex-Path", value: "Set_Bunny_RGB_Big.png" }],
      }),
    ];
    const props = makeProps({ listLibrary: vi.fn(async () => bundleFixture) });
    const capture = stubBrowserDownload();

    try {
      render(<LibraryArea {...props} />);
      await screen.findByTestId("library-bundle-group");

      fireEvent.click(screen.getByTestId("library-export"));

      await waitFor(() => expect(capture.blobs).toHaveLength(1));
      const exported = await parseExportedJson(capture);

      const manifestItem = exported.items.find((i) => i.id === ID_MANIFEST)!;
      // Manifest-aware composition: <manifestId>/<siblingPath>, not a bare id.
      expect(manifestItem.link).toBe(
        `${HEALTHY_ENDPOINT}/${ID_MANIFEST}/Set_Bunny_RGB_Big.png`,
      );
      expect(manifestItem.isManifest).toBe(true);

      const fileItem = exported.items.find((i) => i.id === ID_FILE_A)!;
      expect(fileItem.link).toBe(`${HEALTHY_ENDPOINT}/${ID_FILE_A}`);
      expect(fileItem.isManifest).toBe(false);
    } finally {
      capture.restore();
    }
  });

  it("an empty Library still exports a valid, empty-but-well-formed JSON file via a present, functional button", async () => {
    const props = makeProps({ listLibrary: vi.fn(async (): Promise<LibraryEntry[]> => []) });
    const capture = stubBrowserDownload();

    try {
      render(<LibraryArea {...props} />);
      await screen.findByTestId("library-empty");

      const exportButton = screen.getByTestId("library-export");
      expect(exportButton).not.toBeDisabled();

      fireEvent.click(exportButton);

      await waitFor(() => expect(capture.blobs).toHaveLength(1));
      const exported = await parseExportedJson(capture);
      expect(exported.items).toEqual([]);
      expect(exported.itemCount).toBe(0);
    } finally {
      capture.restore();
    }
  });

  it("the exported JSON's top-level shape is structurally correct: itemCount matches items.length, exportedAt is a valid ISO timestamp", async () => {
    const props = makeProps({
      listLibrary: vi.fn(async (): Promise<LibraryEntry[]> => [
        makeEntry({ id: ID_NEW, createdAt: 200 }),
        makeEntry({ id: ID_OLD, createdAt: 100 }),
      ]),
    });
    const capture = stubBrowserDownload();

    try {
      render(<LibraryArea {...props} />);
      await screen.findAllByTestId("library-entry");

      fireEvent.click(screen.getByTestId("library-export"));

      await waitFor(() => expect(capture.blobs).toHaveLength(1));
      const exported = await parseExportedJson(capture);

      expect(exported.itemCount).toBe(exported.items.length);
      expect(exported.itemCount).toBe(2);
      expect(new Date(exported.exportedAt).toISOString()).toBe(exported.exportedAt);

      // The download itself uses the same saveBytesAsFile mechanism, with a
      // JSON content type and an anchor download name carrying the date.
      expect(capture.blobs[0]!.type).toBe("application/json");
      expect(capture.anchors[0]!.download).toMatch(/^codex-library-export-\d{4}-\d{2}-\d{2}\.json$/);
    } finally {
      capture.restore();
    }
  });
});

describe("LibraryArea — collapsible categories", () => {
  function twoCategoryProps() {
    return makeProps({
      listLibrary: vi.fn(async (): Promise<LibraryEntry[]> => [
        makeEntry({
          id: ID_NEW,
          createdAt: 200,
          tags: [{ name: "Codex-Category", value: "nft-data" }],
        }),
        makeEntry({
          id: ID_OLD,
          createdAt: 100,
          tags: [{ name: "Codex-Category", value: "legal-records" }],
        }),
      ]),
    });
  }

  it("defaults to EXPANDED — every category's entries are visible with no click needed", async () => {
    render(<LibraryArea {...twoCategoryProps()} />);

    await screen.findAllByTestId("library-entry");
    expect(screen.getByTestId("library-category-toggle-nft-data")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByTestId("library-entry")).toHaveLength(2);
  });

  it("toggling a category's header hides its entries, and toggling again re-shows them", async () => {
    render(<LibraryArea {...twoCategoryProps()} />);

    await screen.findAllByTestId("library-entry");
    fireEvent.click(screen.getByTestId("library-category-toggle-nft-data"));

    // The nft-data entry is gone; the OTHER category's entry is untouched.
    expect(screen.getByTestId("library-category-toggle-nft-data")).toHaveAttribute("aria-expanded", "false");
    expect(screen.getAllByTestId("library-entry")).toHaveLength(1);
    expect(screen.getByTestId("library-category-nft-data")).toBeInTheDocument();
    expect(screen.getByTestId("library-category-legal-records")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("library-category-toggle-nft-data"));

    expect(screen.getByTestId("library-category-toggle-nft-data")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByTestId("library-entry")).toHaveLength(2);
  });

  it("collapsing one category does not affect another category's entries", async () => {
    render(<LibraryArea {...twoCategoryProps()} />);

    await screen.findAllByTestId("library-entry");
    fireEvent.click(screen.getByTestId("library-category-toggle-legal-records"));

    expect(screen.getByTestId("library-category-toggle-nft-data")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByTestId("library-entry")).toHaveLength(1);
  });
});
