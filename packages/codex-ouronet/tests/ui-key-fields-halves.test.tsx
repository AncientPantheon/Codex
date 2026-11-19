/**
 * KeyFieldsHalves — error-message discrimination tests (bug 2b,
 * docs/work/debug/two-real-codex-bugs.md). `decryptPrivate` is the only
 * prop; both desktop controls ("Show private key" / "Copy private key")
 * wrap it in a try/catch that must distinguish a genuine lock-state failure
 * (`new Error("locked")`, the exact sentinel both real callers throw) from
 * any other thrown error — the latter must surface its own real message
 * rather than the misleading "Unlock the codex..." text.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

import { KeyFieldsHalves } from "../src/ui/internal/KeyFieldsHalves";

afterEach(cleanup);

const PUBLIC_KEY = "pub-" + "a".repeat(60);

describe("<KeyFieldsHalves> — error discrimination", () => {
  it("shows the lock message when decryptPrivate rejects with the lock sentinel (show control)", async () => {
    const decryptPrivate = vi.fn().mockRejectedValue(new Error("locked"));
    render(<KeyFieldsHalves publicKey={PUBLIC_KEY} decryptPrivate={decryptPrivate} />);

    fireEvent.click(screen.getByTitle("Show private key"));

    expect(await screen.findByText("Unlock the codex to view the private key.")).toBeTruthy();
  });

  it("shows the real error message when decryptPrivate rejects with a non-lock error (show control)", async () => {
    const decryptPrivate = vi
      .fn()
      .mockRejectedValue(new Error("seed bitstring must be exactly 1024 or 1600 characters"));
    render(<KeyFieldsHalves publicKey={PUBLIC_KEY} decryptPrivate={decryptPrivate} />);

    fireEvent.click(screen.getByTitle("Show private key"));

    expect(
      await screen.findByText(
        "Could not view the private key: seed bitstring must be exactly 1024 or 1600 characters",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/Unlock the codex/)).toBeNull();
  });

  it("shows the lock message when decryptPrivate rejects with the lock sentinel (copy control)", async () => {
    const decryptPrivate = vi.fn().mockRejectedValue(new Error("locked"));
    render(<KeyFieldsHalves publicKey={PUBLIC_KEY} decryptPrivate={decryptPrivate} />);

    fireEvent.click(screen.getByTitle("Copy private key"));

    expect(await screen.findByText("Unlock the codex to copy the private key.")).toBeTruthy();
  });

  it("shows the real error message when decryptPrivate rejects with a non-lock error (copy control)", async () => {
    const decryptPrivate = vi
      .fn()
      .mockRejectedValue(new Error("seed bitstring must be exactly 1024 or 1600 characters"));
    render(<KeyFieldsHalves publicKey={PUBLIC_KEY} decryptPrivate={decryptPrivate} />);

    fireEvent.click(screen.getByTitle("Copy private key"));

    expect(
      await screen.findByText(
        "Could not copy the private key: seed bitstring must be exactly 1024 or 1600 characters",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/Unlock the codex/)).toBeNull();
  });
});
