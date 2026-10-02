/**
 * RED matrix for the Arweave panel UPLOAD area (E-10, N-10).
 *
 * Pins the `UploadArea` contract: file picker → tag PREVIEW (the four required
 * tags, Codex-Owner === the selected address) BEFORE upload; a MANDATORY
 * permanence confirm surfacing E3's `UPLOAD_PERMANENCE_WARNING`; a non-re-entrant
 * progress indicator; a result with the data-item id + a gateway LINK + the
 * pending Library entry; and a failure path that leaves NO phantom entry.
 *
 * ALL upload calls are FAKES (fake `uploadAndTrack`). FAILS RED because
 * `../src/panel/UploadArea` does not exist yet.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor, cleanup, fireEvent } from "@testing-library/react";

import { UploadArea, type UploadCategorySelection } from "../src/panel/UploadArea";
// Imported directly from the constants module (not the
// `@ancientpantheon/codex-arweave/library` package-subpath barrel, which also
// re-exports `SqliteLibraryStore` — pulling in `sqliteStore.ts`'s lazy
// `import("node:sqlite")`; under vitest's jsdom transform on a Node build that
// exposes `node:sqlite` (this sandbox's Node 22) vite errors "Cannot bundle
// built-in module node:sqlite", a documented pre-existing limitation this
// package's own vitest.config.ts CI-excludes. `UploadArea.tsx` itself already
// imports this constant the SAME direct way — mirrored here). This file needs
// jsdom (it renders React), so the sibling `e3-*` tests' node-environment
// pragma escape hatch does not apply here; the direct import is the fix
// instead.
import { UPLOAD_PERMANENCE_WARNING, NFT_METADATA_DISCLAIMER } from "../src/library/constants.js";

const OWNER_ADDRESS = "tzXauR_QBlPW3ZRey3xBzaiDqPqLfiqWk1SWmk2BjM4";
const DATA_ITEM_ID = "aXcDefGhIjKlMnOpQrStUvWxYz0123456789_-ABCDE";
const MANIFEST_ID = "mMnNoOpPqQrRsStTuUvVwWxXyYzZ0123456789_-ABC";

function makeFile(name = "note.txt"): File {
  return new File(["hello permaweb"], name, { type: "text/plain" });
}

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    address: OWNER_ADDRESS,
    // The E3 upload-then-append flow: resolves the data-item result. Typed
    // with explicit `_file`/`_selection` params (rather than `()`) so
    // `mock.calls[0]` below infers a 2-tuple, not the empty tuple `[]` — T5's
    // category selection is the second arg.
    uploadAndTrack: vi.fn(async (_file: File, _selection: UploadCategorySelection) => ({
      id: DATA_ITEM_ID,
      itemId: "item-uuid-1",
      ownerAddress: OWNER_ADDRESS,
      tags: [],
    })),
    // The T7 bundle-aware flow: resolves the manifest + per-file ids. Typed
    // with explicit `_files`/`_selection` params (rather than `()`) so
    // `mock.calls[0]` below infers a 2-tuple, not the 1-tuple `[File[]]`.
    uploadFilesAndTrack: vi.fn(async (_files: File[], _selection: UploadCategorySelection) => ({
      manifestId: MANIFEST_ID,
      fileIds: [
        { path: "a.txt", id: "aAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa" },
        { path: "b.txt", id: "bBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBb" },
        { path: "c.txt", id: "cCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCc" },
      ],
      uploadId: "shared-batch-upload-id",
    })),
    // Composes the gateway URL from a healthy endpoint.
    openUrl: vi.fn((id: string) => `https://healthy.example/${id}`),
    ...overrides,
  };
}

/** Select a single file into the picker so the tag preview computes. */
function selectFile(): void {
  fireEvent.change(screen.getByTestId("upload-file-input"), {
    target: { files: [makeFile()] },
  });
}

/** Select 2+ files into the SAME (now `multiple`) file-picker input. */
function selectFiles(count: number): void {
  const files = Array.from({ length: count }, (_, i) => makeFile(`file-${i}.txt`));
  fireEvent.change(screen.getByTestId("upload-file-input"), {
    target: { files },
  });
}

/** Select 2+ files into the folder-picker input (`webkitdirectory`). */
function selectFolder(count: number): void {
  const files = Array.from({ length: count }, (_, i) => makeFile(`folder/file-${i}.txt`));
  fireEvent.change(screen.getByTestId("upload-folder-input"), {
    target: { files },
  });
}

/** Selects the required category picker. Defaults to a non-`nft-data` value
 *  ("general-other") so callers that only care about the file-selection flow
 *  don't also have to satisfy the nft-data asset-type sub-gate — tests
 *  targeting that sub-gate pick `"nft-data"` explicitly. */
function selectCategory(value = "general-other"): void {
  fireEvent.change(screen.getByTestId("upload-category"), {
    target: { value },
  });
}

/** Selects the nft-data-only asset-type picker. */
function selectAssetType(value: string): void {
  fireEvent.change(screen.getByTestId("upload-asset-type"), {
    target: { value },
  });
}

/** Attaches an optional metadata file into the nft-data-only metadata picker. */
function selectMetadataFile(name = "metadata.json"): File {
  const file = makeFile(name);
  fireEvent.change(screen.getByTestId("upload-metadata-file-input"), {
    target: { files: [file] },
  });
  return file;
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("UploadArea — tag preview before upload", () => {
  it("renders the four required tags with Codex-Owner === the selected address, before any upload", async () => {
    const props = makeProps();
    render(<UploadArea {...props} />);
    selectFile();

    const preview = await screen.findByTestId("upload-tag-preview");
    expect(within(preview).getByText("App-Name")).toBeInTheDocument();
    expect(within(preview).getByText("Content-Type")).toBeInTheDocument();
    expect(within(preview).getByText("Codex-Item-Id")).toBeInTheDocument();
    expect(within(preview).getByText("Codex-Owner")).toBeInTheDocument();
    // The owner tag value is the selected address.
    expect(preview.textContent).toContain(OWNER_ADDRESS);
    // The preview is shown before upload — no upload has run yet.
    expect(props.uploadAndTrack).not.toHaveBeenCalled();
  });

  it("(T7) also lists the schema-version, upload-id, and item-type tags alongside the original four", async () => {
    const props = makeProps();
    render(<UploadArea {...props} />);
    selectFile();

    const preview = await screen.findByTestId("upload-tag-preview");
    expect(within(preview).getByText("Codex-Tag-Schema-Version")).toBeInTheDocument();
    expect(within(preview).getByText("Codex-Upload-Id")).toBeInTheDocument();
    expect(within(preview).getByText("Codex-Item-Type")).toBeInTheDocument();
  });
});

describe("UploadArea — mandatory permanence confirm (N-10)", () => {
  it("blocks the upload behind a confirm rendering UPLOAD_PERMANENCE_WARNING verbatim", async () => {
    const props = makeProps();
    render(<UploadArea {...props} />);
    selectFile();
    selectCategory();
    fireEvent.click(screen.getByTestId("upload-start"));

    const confirm = await screen.findByTestId("upload-permanence-confirm");
    expect(confirm.textContent).toContain(UPLOAD_PERMANENCE_WARNING);
    // The upload does NOT proceed until confirmed.
    expect(props.uploadAndTrack).not.toHaveBeenCalled();
  });

  it("proceeds only after the permanence confirm is accepted", async () => {
    const props = makeProps();
    render(<UploadArea {...props} />);
    selectFile();
    selectCategory();
    fireEvent.click(screen.getByTestId("upload-start"));
    fireEvent.click(await screen.findByTestId("upload-permanence-accept"));
    await waitFor(() => expect(props.uploadAndTrack).toHaveBeenCalledTimes(1));
  });

  it("cancel aborts with no upload call", async () => {
    const props = makeProps();
    render(<UploadArea {...props} />);
    selectFile();
    selectCategory();
    fireEvent.click(screen.getByTestId("upload-start"));
    fireEvent.click(await screen.findByTestId("upload-permanence-cancel"));
    expect(props.uploadAndTrack).not.toHaveBeenCalled();
  });
});

describe("UploadArea — progress + result", () => {
  it("shows a progress indicator and is non-re-entrant during upload", async () => {
    let resolveUpload: (v: unknown) => void = () => {};
    const uploadAndTrack = vi.fn(
      () => new Promise((res) => { resolveUpload = res; }),
    );
    const props = makeProps({ uploadAndTrack });
    render(<UploadArea {...props} />);
    selectFile();
    selectCategory();
    fireEvent.click(screen.getByTestId("upload-start"));
    fireEvent.click(await screen.findByTestId("upload-permanence-accept"));

    await waitFor(() => expect(screen.getByTestId("upload-progress")).toBeInTheDocument());
    // Non-re-entrant: the start affordance is disabled while pending.
    expect(screen.getByTestId("upload-start")).toBeDisabled();

    resolveUpload({ id: DATA_ITEM_ID, itemId: "item-uuid-1", ownerAddress: OWNER_ADDRESS, tags: [] });
    await waitFor(() => expect(uploadAndTrack).toHaveBeenCalledTimes(1));
  });

  it("renders the data-item identifier + a gateway link + the pending Library entry on success", async () => {
    const props = makeProps();
    render(<UploadArea {...props} />);
    selectFile();
    selectCategory();
    fireEvent.click(screen.getByTestId("upload-start"));
    fireEvent.click(await screen.findByTestId("upload-permanence-accept"));

    const result = await screen.findByTestId("upload-result");
    expect(result.textContent).toContain(DATA_ITEM_ID);
    // The link is composed via openUrl from a healthy gateway (not hardcoded arweave.net).
    const link = within(result).getByRole("link");
    expect(link).toHaveAttribute("href", `https://healthy.example/${DATA_ITEM_ID}`);
    expect(props.openUrl).toHaveBeenCalledWith(DATA_ITEM_ID);
    // The pending entry now appears in the library affordance.
    expect(await screen.findByTestId("upload-pending-entry")).toBeInTheDocument();
  });
});

describe("UploadArea — failure", () => {
  it("shows a clear error and adds NO phantom Library entry when upload fails", async () => {
    class UploadFailedError extends Error {
      override readonly name = "UploadFailedError";
    }
    const uploadAndTrack = vi.fn(async () => {
      throw new UploadFailedError("turbo rejected the data item");
    });
    const props = makeProps({ uploadAndTrack });
    render(<UploadArea {...props} />);
    selectFile();
    selectCategory();
    fireEvent.click(screen.getByTestId("upload-start"));
    fireEvent.click(await screen.findByTestId("upload-permanence-accept"));

    expect(await screen.findByTestId("upload-error")).toBeInTheDocument();
    // No phantom pending entry on the failure path (E3 FIX-6).
    expect(screen.queryByTestId("upload-pending-entry")).not.toBeInTheDocument();
  });
});

describe("UploadArea — secret hygiene", () => {
  it("never renders a JWK value in the upload DOM or errors", async () => {
    const props = makeProps();
    render(<UploadArea {...props} />);
    selectFile();
    // The upload flow never surfaces key material — only the public data-item + tags.
    expect(document.body.innerHTML).not.toContain('"d":');
    expect(document.body.innerHTML).not.toContain('"qi":');
  });
});

describe("UploadArea — multi-file/folder bundle path (T7)", () => {
  it("selecting 2+ files via the (now `multiple`) file input routes through uploadFilesAndTrack, NOT uploadAndTrack", async () => {
    const props = makeProps();
    render(<UploadArea {...props} />);
    selectFiles(3);
    selectCategory();
    fireEvent.click(screen.getByTestId("upload-start"));
    fireEvent.click(await screen.findByTestId("upload-permanence-accept"));

    await waitFor(() => expect(props.uploadFilesAndTrack).toHaveBeenCalledTimes(1));
    expect(props.uploadAndTrack).not.toHaveBeenCalled();
    // Called with the actual picked File objects, one per selection.
    const calledWith = props.uploadFilesAndTrack.mock.calls[0][0] as File[];
    expect(calledWith).toHaveLength(3);
  });

  it("renders a DISTINCT 'N files uploaded' result (not the single-file result view) after a successful bundle upload", async () => {
    const props = makeProps();
    render(<UploadArea {...props} />);
    selectFiles(3);
    selectCategory();
    fireEvent.click(screen.getByTestId("upload-start"));
    fireEvent.click(await screen.findByTestId("upload-permanence-accept"));

    const bundleResult = await screen.findByTestId("upload-bundle-result");
    expect(bundleResult.textContent).toContain("3 files uploaded");
    expect(bundleResult.textContent).toContain(MANIFEST_ID);
    // The manifest link is composed via openUrl, exactly like the single-file link.
    const link = within(bundleResult).getByRole("link");
    expect(link).toHaveAttribute("href", `https://healthy.example/${MANIFEST_ID}`);
    // This is a DIFFERENT result view from the single-file one.
    expect(screen.queryByTestId("upload-result")).not.toBeInTheDocument();
  });

  it("a single-file selection still renders the ORIGINAL single-file result view (no regression)", async () => {
    const props = makeProps();
    render(<UploadArea {...props} />);
    selectFile();
    selectCategory();
    fireEvent.click(screen.getByTestId("upload-start"));
    fireEvent.click(await screen.findByTestId("upload-permanence-accept"));

    await screen.findByTestId("upload-result");
    expect(props.uploadFilesAndTrack).not.toHaveBeenCalled();
    expect(screen.queryByTestId("upload-bundle-result")).not.toBeInTheDocument();
  });

  it("selecting a folder (webkitdirectory input) with 2+ files ALSO routes through the bundle-aware path", async () => {
    const props = makeProps();
    render(<UploadArea {...props} />);
    selectFolder(2);
    selectCategory();
    fireEvent.click(screen.getByTestId("upload-start"));
    fireEvent.click(await screen.findByTestId("upload-permanence-accept"));

    await waitFor(() => expect(props.uploadFilesAndTrack).toHaveBeenCalledTimes(1));
    expect(props.uploadFilesAndTrack.mock.calls[0][0]).toHaveLength(2);
  });

  it("the mandatory permanence confirm still gates the bundle path — no call before it is accepted", async () => {
    const props = makeProps();
    render(<UploadArea {...props} />);
    selectFiles(2);
    selectCategory();
    fireEvent.click(screen.getByTestId("upload-start"));

    await screen.findByTestId("upload-permanence-confirm");
    expect(props.uploadFilesAndTrack).not.toHaveBeenCalled();
  });

  it("a failing bundle upload shows an error and adds no phantom bundle result", async () => {
    class UploadFailedError extends Error {
      override readonly name = "UploadFailedError";
    }
    const uploadFilesAndTrack = vi.fn(async () => {
      throw new UploadFailedError("bundle upload rejected");
    });
    const props = makeProps({ uploadFilesAndTrack });
    render(<UploadArea {...props} />);
    selectFiles(2);
    selectCategory();
    fireEvent.click(screen.getByTestId("upload-start"));
    fireEvent.click(await screen.findByTestId("upload-permanence-accept"));

    expect(await screen.findByTestId("upload-error")).toBeInTheDocument();
    expect(screen.queryByTestId("upload-bundle-result")).not.toBeInTheDocument();
  });
});

describe("UploadArea — mandatory category picker (arweave-upload-categories, T5)", () => {
  it("the category <select> never renders an option for \"foreign\" or \"codex-backup\" — exact absence, not just a plausible subset", async () => {
    const props = makeProps();
    render(<UploadArea {...props} />);
    selectFile();

    const select = (await screen.findByTestId("upload-category")) as HTMLSelectElement;
    const values = Array.from(select.querySelectorAll("option")).map((o) => o.value);
    expect(values).not.toContain("foreign");
    expect(values).not.toContain("codex-backup");
    // 24 selectable categories (26 total minus "foreign" and "codex-backup")
    // plus the one blank placeholder option.
    expect(values.filter((v) => v !== "")).toHaveLength(24);
  });

  it("Upload stays disabled with a file selected but NO category chosen", async () => {
    const props = makeProps();
    render(<UploadArea {...props} />);
    selectFile();

    await screen.findByTestId("upload-category");
    expect(screen.getByTestId("upload-start")).toBeDisabled();
  });

  it("Upload becomes enabled once BOTH a file and a (non-nft) category are chosen", async () => {
    const props = makeProps();
    render(<UploadArea {...props} />);
    selectFile();
    selectCategory("personal-photos");

    expect(screen.getByTestId("upload-start")).toBeEnabled();
  });

  it("a non-nft category selection never shows the asset-type picker", async () => {
    const props = makeProps();
    render(<UploadArea {...props} />);
    selectFile();
    selectCategory("personal-photos");

    expect(screen.queryByTestId("upload-asset-type")).not.toBeInTheDocument();
  });

  it("selecting \"nft-data\" reveals the required asset-type picker and keeps Upload disabled until it has a value", async () => {
    const props = makeProps();
    render(<UploadArea {...props} />);
    selectFile();
    selectCategory("nft-data");

    const assetType = await screen.findByTestId("upload-asset-type");
    expect(assetType).toBeInTheDocument();
    expect(screen.getByTestId("upload-start")).toBeDisabled();

    selectAssetType("video");
    expect(screen.getByTestId("upload-start")).toBeEnabled();
  });

  it("wires the chosen category/assetType/appId/appVersion into the uploadAndTrack call", async () => {
    const props = makeProps();
    render(<UploadArea {...props} />);
    selectFile();
    selectCategory("nft-data");
    selectAssetType("image");
    fireEvent.change(screen.getByTestId("upload-app-id"), { target: { value: "my-app" } });
    fireEvent.change(screen.getByTestId("upload-app-version"), { target: { value: "1.2.3" } });
    fireEvent.click(screen.getByTestId("upload-start"));
    fireEvent.click(await screen.findByTestId("upload-permanence-accept"));

    await waitFor(() => expect(props.uploadAndTrack).toHaveBeenCalledTimes(1));
    const [, selection] = props.uploadAndTrack.mock.calls[0];
    expect(selection).toMatchObject({
      category: "nft-data",
      assetType: "image",
      appId: "my-app",
      appVersion: "1.2.3",
    });
  });

  it("wires the chosen category into the uploadFilesAndTrack (bundle) call", async () => {
    const props = makeProps();
    render(<UploadArea {...props} />);
    selectFiles(2);
    selectCategory("software-code");
    fireEvent.click(screen.getByTestId("upload-start"));
    fireEvent.click(await screen.findByTestId("upload-permanence-accept"));

    await waitFor(() => expect(props.uploadFilesAndTrack).toHaveBeenCalledTimes(1));
    const [, selection] = props.uploadFilesAndTrack.mock.calls[0];
    expect(selection).toMatchObject({ category: "software-code" });
  });

  it("extends the tag preview with Codex-Category/Codex-Asset-Type/Codex-App-Id/Codex-App-Version once each has a value", async () => {
    const props = makeProps();
    render(<UploadArea {...props} />);
    selectFile();
    selectCategory("nft-data");
    selectAssetType("audio");
    fireEvent.change(screen.getByTestId("upload-app-id"), { target: { value: "my-app" } });

    const preview = await screen.findByTestId("upload-tag-preview");
    expect(within(preview).getByText("Codex-Category")).toBeInTheDocument();
    expect(within(preview).getByText("Codex-Asset-Type")).toBeInTheDocument();
    expect(within(preview).getByText("Codex-App-Id")).toBeInTheDocument();
    // appVersion was never entered — its tag row is absent from the preview.
    expect(within(preview).queryByText("Codex-App-Version")).not.toBeInTheDocument();
    expect(preview.textContent).toContain("nft-data");
    expect(preview.textContent).toContain("audio");
    expect(preview.textContent).toContain("my-app");
  });
});

describe("UploadArea — optional NFT metadata attachment (arweave-upload-categories addendum)", () => {
  it("shows the NFT_METADATA_DISCLAIMER only once \"nft-data\" is the chosen category, never for any other category", async () => {
    const props = makeProps();
    render(<UploadArea {...props} />);
    selectFile();

    // No category chosen yet — no disclaimer.
    expect(screen.queryByText(NFT_METADATA_DISCLAIMER)).not.toBeInTheDocument();

    selectCategory("personal-photos");
    expect(screen.queryByText(NFT_METADATA_DISCLAIMER)).not.toBeInTheDocument();

    selectCategory("nft-data");
    expect(await screen.findByText(NFT_METADATA_DISCLAIMER)).toBeInTheDocument();
  });

  it("shows the optional metadata file input only when category is \"nft-data\"", async () => {
    const props = makeProps();
    render(<UploadArea {...props} />);
    selectFile();

    expect(screen.queryByTestId("upload-metadata-file-input")).not.toBeInTheDocument();

    selectCategory("personal-photos");
    expect(screen.queryByTestId("upload-metadata-file-input")).not.toBeInTheDocument();

    selectCategory("nft-data");
    expect(await screen.findByTestId("upload-metadata-file-input")).toBeInTheDocument();
  });

  it("does not restrict the metadata input's accept attribute to JSON only", async () => {
    const props = makeProps();
    render(<UploadArea {...props} />);
    selectFile();
    selectCategory("nft-data");

    const input = await screen.findByTestId("upload-metadata-file-input");
    expect(input).not.toHaveAttribute("accept");
  });

  it("1 asset file + 1 attached metadata file under nft-data calls uploadFilesAndTrack with [asset, metadata], NOT uploadAndTrack", async () => {
    const props = makeProps();
    render(<UploadArea {...props} />);
    selectFile();
    selectCategory("nft-data");
    selectAssetType("image");
    const metadataFile = selectMetadataFile();
    fireEvent.click(screen.getByTestId("upload-start"));
    fireEvent.click(await screen.findByTestId("upload-permanence-accept"));

    await waitFor(() => expect(props.uploadFilesAndTrack).toHaveBeenCalledTimes(1));
    expect(props.uploadAndTrack).not.toHaveBeenCalled();
    const calledWith = props.uploadFilesAndTrack.mock.calls[0][0] as File[];
    expect(calledWith).toHaveLength(2);
    expect(calledWith[0].name).toBe("note.txt");
    expect(calledWith[1]).toBe(metadataFile);
  });

  it("1 asset file with NO metadata attached under nft-data still calls uploadAndTrack, the plain single-file path (regression)", async () => {
    const props = makeProps();
    render(<UploadArea {...props} />);
    selectFile();
    selectCategory("nft-data");
    selectAssetType("image");
    fireEvent.click(screen.getByTestId("upload-start"));
    fireEvent.click(await screen.findByTestId("upload-permanence-accept"));

    await waitFor(() => expect(props.uploadAndTrack).toHaveBeenCalledTimes(1));
    expect(props.uploadFilesAndTrack).not.toHaveBeenCalled();
  });

  it("2+ asset files under nft-data still route through uploadFilesAndTrack exactly as before (regression)", async () => {
    const props = makeProps();
    render(<UploadArea {...props} />);
    selectFiles(2);
    selectCategory("nft-data");
    selectAssetType("image");
    fireEvent.click(screen.getByTestId("upload-start"));
    fireEvent.click(await screen.findByTestId("upload-permanence-accept"));

    await waitFor(() => expect(props.uploadFilesAndTrack).toHaveBeenCalledTimes(1));
    expect(props.uploadFilesAndTrack.mock.calls[0][0]).toHaveLength(2);
  });

  it("lists the attached metadata file's name in the preview, distinctly from the primary asset file", async () => {
    const props = makeProps();
    render(<UploadArea {...props} />);
    selectFile();
    selectCategory("nft-data");
    selectMetadataFile("my-metadata.json");

    const filePreview = await screen.findByTestId("upload-file-preview");
    expect(filePreview.textContent).toContain("note.txt");
    const metadataName = within(filePreview).getByTestId("upload-metadata-file-name");
    expect(metadataName.textContent).toContain("my-metadata.json");
  });

  it("does not render the metadata file's name in the preview when none is attached", async () => {
    const props = makeProps();
    render(<UploadArea {...props} />);
    selectFile();
    selectCategory("nft-data");

    const filePreview = await screen.findByTestId("upload-file-preview");
    expect(within(filePreview).queryByTestId("upload-metadata-file-name")).not.toBeInTheDocument();
  });
});
