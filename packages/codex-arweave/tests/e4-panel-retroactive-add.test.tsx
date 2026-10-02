/**
 * RED matrix for the Arweave panel RETROACTIVE-ADD area (T7,
 * `arweave-upload-encryption`).
 *
 * Pins the `RetroactiveAddArea` contract: an id/URL input + a submit button;
 * on submit, calls the injected `queryUploadById(id)`; a `null` result shows a
 * clear "not found" message (never a crash, never a generic error); a found
 * record whose `Codex-Owner` tag does NOT match any of the injected
 * `ownedAddresses` is rejected with a clear "doesn't belong to any account in
 * this codex" message and the injected `addToLibrary` callback is NEVER
 * called; a found record whose `Codex-Owner` tag DOES match one of
 * `ownedAddresses` (checked against the FULL list, not just a single active
 * address) calls `addToLibrary` with the record and shows a success result.
 *
 * Mirrors `UploadArea.tsx`/`CodexBackupArea.tsx`'s own injected-async-function
 * pattern (`queryUploadById`/`addToLibrary` are both injected — this
 * component never reaches into a `GatewayPool` or `LibraryStore` directly).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";

import { RetroactiveAddArea } from "../src/panel/RetroactiveAddArea";
import { TAG_CODEX_OWNER, TAG_APP_NAME, type OwnerUploadRecord } from "@ancientpantheon/arweave-core";

const HELD_ADDRESS_1 = "tzXauR_QBlPW3ZRey3xBzaiDqPqLfiqWk1SWmk2BjM4";
const HELD_ADDRESS_2 = "abcABCabcABCabcABCabcABCabcABCabcABCabcAB_-";
const FOREIGN_ADDRESS = "0123456789012345678901234567890123456789012";
const UPLOAD_ID = "aXcDefGhIjKlMnOpQrStUvWxYz0123456789_-ABCDE";

function makeRecord(owner: string, id = UPLOAD_ID): OwnerUploadRecord {
  return {
    id,
    // Codex-Owner is deliberately NOT the first tag — proves the component
    // reads it BY NAME, not by tag array position.
    tags: [
      { name: TAG_APP_NAME, value: "Codex" },
      { name: TAG_CODEX_OWNER, value: owner },
    ],
  };
}

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    ownedAddresses: [HELD_ADDRESS_1, HELD_ADDRESS_2],
    queryUploadById: vi.fn(async (_id: string) => makeRecord(HELD_ADDRESS_1)),
    addToLibrary: vi.fn(async (_record: OwnerUploadRecord) => {}),
    ...overrides,
  };
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("RetroactiveAddArea — found + owned: inserts into the Library", () => {
  it("calls queryUploadById with the typed id, then addToLibrary with the found record, and shows a result", async () => {
    const props = makeProps();
    render(<RetroactiveAddArea {...props} />);

    fireEvent.change(screen.getByTestId("retroactive-add-input"), {
      target: { value: UPLOAD_ID },
    });
    fireEvent.click(screen.getByTestId("retroactive-add-submit"));

    await waitFor(() => expect(props.queryUploadById).toHaveBeenCalledWith(UPLOAD_ID));
    await waitFor(() => expect(props.addToLibrary).toHaveBeenCalledTimes(1));
    expect(props.addToLibrary).toHaveBeenCalledWith(makeRecord(HELD_ADDRESS_1));

    const result = await screen.findByTestId("retroactive-add-result");
    expect(result.textContent).toContain(UPLOAD_ID);
  });

  it("matches ANY address in ownedAddresses, not only the first one — a user may retroactively add something belonging to a different held account", async () => {
    const props = makeProps({
      queryUploadById: vi.fn(async () => makeRecord(HELD_ADDRESS_2)),
    });
    render(<RetroactiveAddArea {...props} />);

    fireEvent.change(screen.getByTestId("retroactive-add-input"), {
      target: { value: UPLOAD_ID },
    });
    fireEvent.click(screen.getByTestId("retroactive-add-submit"));

    await waitFor(() => expect(props.addToLibrary).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("retroactive-add-owner-mismatch")).not.toBeInTheDocument();
  });

  it("extracts the id from a pasted gateway URL (id/URL input)", async () => {
    const props = makeProps();
    render(<RetroactiveAddArea {...props} />);

    fireEvent.change(screen.getByTestId("retroactive-add-input"), {
      target: { value: `https://arweave.net/${UPLOAD_ID}` },
    });
    fireEvent.click(screen.getByTestId("retroactive-add-submit"));

    await waitFor(() => expect(props.queryUploadById).toHaveBeenCalledWith(UPLOAD_ID));
  });

  it("shows a non-re-entrant progress indicator while the lookup/add is pending", async () => {
    let resolveQuery: (v: OwnerUploadRecord | null) => void = () => {};
    const queryUploadById = vi.fn(
      () => new Promise<OwnerUploadRecord | null>((res) => { resolveQuery = res; }),
    );
    const props = makeProps({ queryUploadById });
    render(<RetroactiveAddArea {...props} />);

    fireEvent.change(screen.getByTestId("retroactive-add-input"), {
      target: { value: UPLOAD_ID },
    });
    fireEvent.click(screen.getByTestId("retroactive-add-submit"));

    await waitFor(() => expect(screen.getByTestId("retroactive-add-progress")).toBeInTheDocument());
    expect(screen.getByTestId("retroactive-add-submit")).toBeDisabled();

    resolveQuery(makeRecord(HELD_ADDRESS_1));
    await waitFor(() => expect(props.addToLibrary).toHaveBeenCalledTimes(1));
  });
});

describe("RetroactiveAddArea — found but NOT owned: rejected, never inserted", () => {
  it("shows the specific 'doesn't belong to any account in this codex' message and never calls addToLibrary", async () => {
    const props = makeProps({
      queryUploadById: vi.fn(async () => makeRecord(FOREIGN_ADDRESS)),
    });
    render(<RetroactiveAddArea {...props} />);

    fireEvent.change(screen.getByTestId("retroactive-add-input"), {
      target: { value: UPLOAD_ID },
    });
    fireEvent.click(screen.getByTestId("retroactive-add-submit"));

    const mismatch = await screen.findByTestId("retroactive-add-owner-mismatch");
    expect(mismatch.textContent).toMatch(/doesn't belong to any account in this codex/i);
    expect(props.addToLibrary).not.toHaveBeenCalled();
    expect(screen.queryByTestId("retroactive-add-result")).not.toBeInTheDocument();
  });

  it("rejects a record with NO Codex-Owner tag at all (never treats a missing tag as a match)", async () => {
    const props = makeProps({
      queryUploadById: vi.fn(async () => ({
        id: UPLOAD_ID,
        tags: [{ name: TAG_APP_NAME, value: "Codex" }],
      })),
    });
    render(<RetroactiveAddArea {...props} />);

    fireEvent.change(screen.getByTestId("retroactive-add-input"), {
      target: { value: UPLOAD_ID },
    });
    fireEvent.click(screen.getByTestId("retroactive-add-submit"));

    await screen.findByTestId("retroactive-add-owner-mismatch");
    expect(props.addToLibrary).not.toHaveBeenCalled();
  });
});

describe("RetroactiveAddArea — not found", () => {
  it("shows a clear 'not found' message, not a crash or a generic error, when queryUploadById resolves null", async () => {
    const props = makeProps({ queryUploadById: vi.fn(async () => null) });
    render(<RetroactiveAddArea {...props} />);

    fireEvent.change(screen.getByTestId("retroactive-add-input"), {
      target: { value: UPLOAD_ID },
    });
    fireEvent.click(screen.getByTestId("retroactive-add-submit"));

    const notFound = await screen.findByTestId("retroactive-add-not-found");
    expect(notFound.textContent).toMatch(/not found/i);
    expect(props.addToLibrary).not.toHaveBeenCalled();
    expect(screen.queryByTestId("retroactive-add-error")).not.toBeInTheDocument();
  });
});

describe("RetroactiveAddArea — genuine lookup failure", () => {
  it("shows a distinct error view (not the not-found message) when queryUploadById rejects", async () => {
    class GatewayPoolExhaustedFake extends Error {
      override readonly name = "GatewayPoolExhaustedError";
    }
    const props = makeProps({
      queryUploadById: vi.fn(async () => {
        throw new GatewayPoolExhaustedFake("every endpoint failed");
      }),
    });
    render(<RetroactiveAddArea {...props} />);

    fireEvent.change(screen.getByTestId("retroactive-add-input"), {
      target: { value: UPLOAD_ID },
    });
    fireEvent.click(screen.getByTestId("retroactive-add-submit"));

    expect(await screen.findByTestId("retroactive-add-error")).toBeInTheDocument();
    expect(screen.queryByTestId("retroactive-add-not-found")).not.toBeInTheDocument();
    expect(props.addToLibrary).not.toHaveBeenCalled();
  });

  it("shows the error view (not a silent no-op) when addToLibrary itself rejects", async () => {
    const props = makeProps({
      addToLibrary: vi.fn(async () => {
        throw new Error("store write failed");
      }),
    });
    render(<RetroactiveAddArea {...props} />);

    fireEvent.change(screen.getByTestId("retroactive-add-input"), {
      target: { value: UPLOAD_ID },
    });
    fireEvent.click(screen.getByTestId("retroactive-add-submit"));

    expect(await screen.findByTestId("retroactive-add-error")).toBeInTheDocument();
    expect(screen.queryByTestId("retroactive-add-result")).not.toBeInTheDocument();
  });
});

describe("RetroactiveAddArea — submit is disabled without input", () => {
  it("the submit button is disabled while the input is empty", () => {
    const props = makeProps();
    render(<RetroactiveAddArea {...props} />);
    expect(screen.getByTestId("retroactive-add-submit")).toBeDisabled();
  });
});
