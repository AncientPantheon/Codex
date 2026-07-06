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

import { UploadArea } from "../src/panel/UploadArea";
import {
  UPLOAD_PERMANENCE_WARNING,
} from "@ancientpantheon/codex-arweave/library";

const OWNER_ADDRESS = "tzXauR_QBlPW3ZRey3xBzaiDqPqLfiqWk1SWmk2BjM4";
const DATA_ITEM_ID = "aXcDefGhIjKlMnOpQrStUvWxYz0123456789_-ABCDE";

function makeFile(): File {
  return new File(["hello permaweb"], "note.txt", { type: "text/plain" });
}

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    address: OWNER_ADDRESS,
    // The E3 upload-then-append flow: resolves the data-item result.
    uploadAndTrack: vi.fn(async () => ({
      id: DATA_ITEM_ID,
      itemId: "item-uuid-1",
      ownerAddress: OWNER_ADDRESS,
      tags: [],
    })),
    // Composes the gateway URL from a healthy endpoint.
    openUrl: vi.fn((id: string) => `https://healthy.example/${id}`),
    ...overrides,
  };
}

/** Select a file into the picker so the tag preview computes. */
function selectFile(): void {
  fireEvent.change(screen.getByTestId("upload-file-input"), {
    target: { files: [makeFile()] },
  });
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
});

describe("UploadArea — mandatory permanence confirm (N-10)", () => {
  it("blocks the upload behind a confirm rendering UPLOAD_PERMANENCE_WARNING verbatim", async () => {
    const props = makeProps();
    render(<UploadArea {...props} />);
    selectFile();
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
    fireEvent.click(screen.getByTestId("upload-start"));
    fireEvent.click(await screen.findByTestId("upload-permanence-accept"));
    await waitFor(() => expect(props.uploadAndTrack).toHaveBeenCalledTimes(1));
  });

  it("cancel aborts with no upload call", async () => {
    const props = makeProps();
    render(<UploadArea {...props} />);
    selectFile();
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
