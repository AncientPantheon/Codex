/**
 * PureKeypairsTab specs — updated for the v0.5.x upgraded interface:
 *   • 3 subtabs (List / Generate / Import)
 *   • List rows are EXPANDABLE (Ouronet-Accounts style): a collapsed header
 *     (icon + label + badge) expands to reveal the public key, a password-gated
 *     "View Private Key" reveal, and the delete control.
 *   • Protected keys (CodexGuard / Duo) have their delete DISABLED at the UI.
 *   • Import validates a pasted pair by re-deriving the public key.
 */

import * as React from "react";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

import { CodexProvider } from "@ancientpantheon/codex-ouronet/provider";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import { useCodex, usePureKeypairs } from "@ancientpantheon/codex-ouronet/hooks";
import { PureKeypairsTab } from "@ancientpantheon/codex-ouronet/ui";
import type { IPureKeypair } from "@ancientpantheon/codex-ouronet/types";

const kpFx = (over: Partial<IPureKeypair> = {}): IPureKeypair => ({
  id: over.id ?? "kp-1",
  label: over.label,
  publicKey: over.publicKey ?? "a".repeat(64),
  encryptedPrivateKey: "enc",
  createdAt: "2026-05-25T10:00:00.000Z",
  ...over,
});

function Seeder({ pairs }: { pairs: IPureKeypair[] }) {
  const { addKeypair } = usePureKeypairs();
  const { isReady } = useCodex();
  React.useEffect(() => {
    if (isReady) pairs.forEach((p) => void addKeypair(p));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady]);
  return null;
}

async function renderTab(pairs: IPureKeypair[] = []) {
  const adapter = new MemoryCodexAdapter("dev");
  const utils = render(
    <CodexProvider adapter={adapter}>
      <Seeder pairs={pairs} />
      <PureKeypairsTab />
    </CodexProvider>,
  );
  if (pairs.length > 0) {
    await waitFor(() => expect(document.querySelectorAll("[data-keypair-id]").length).toBe(pairs.length));
  } else {
    await waitFor(() => expect(screen.getByText(/No pure keypairs/i)).toBeTruthy());
  }
  return utils;
}

/** Expand a collapsed keypair row by clicking its header. */
const expandRow = (card: HTMLElement) => fireEvent.click(card.querySelector("div") as HTMLElement);

describe("<PureKeypairsTab>", () => {
  it("renders the empty state + the 3 subtab pills when the codex holds no keypairs", async () => {
    await renderTab([]);
    expect(screen.getByText(/No pure keypairs/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /^generate$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^import$/i })).toBeTruthy();
  });

  it("shows a collapsed row by label, expanding to reveal the public key + private-key control", async () => {
    await renderTab([kpFx({ id: "kp-1", label: "Trading", publicKey: "b".repeat(64) })]);
    expect(screen.getByText("Trading")).toBeTruthy();
    // Public key is hidden until expanded.
    expect(screen.queryByText("b".repeat(64))).toBeNull();
    const card = screen.getByText("Trading").closest("[data-keypair-id]") as HTMLElement;
    expandRow(card);
    expect(await within(card).findByText("b".repeat(64))).toBeTruthy();
    expect(within(card).getByRole("button", { name: /show private key/i })).toBeTruthy();
  });

  it("exposes the public+private import inputs under the Import subtab", async () => {
    await renderTab([]);
    fireEvent.click(screen.getByRole("button", { name: /^import$/i }));
    expect(screen.getByPlaceholderText(/private \(secret\) key/i)).toBeTruthy();
    expect(screen.getByPlaceholderText(/public key/i)).toBeTruthy();
  });

  it("accepts a 128-hex Chainweaver extended key in the Import subtab and validates the match", async () => {
    // Real vector: this 128-hex BIP32-Ed25519 key (kL‖kR) derives this pubkey.
    const PUB = "d8d5628bf6e932ac4601a038d361000246faf20a4e90d6f23998cbb834ef5f49";
    const PRIV =
      "88aa38fba13aa1ab76b3265be5f88cc6635a79b7dbe00652a2e628b3aa1b6440" +
      "4066f4b2a77f41ade24c80649797f05fbc3d9fa960bce7ff4c9c2e841430d6f3";
    await renderTab([]);
    fireEvent.click(screen.getByRole("button", { name: /^import$/i }));
    fireEvent.change(screen.getByPlaceholderText(/public key/i), {
      target: { value: PUB },
    });
    fireEvent.change(screen.getByPlaceholderText(/private \(secret\) key/i), {
      target: { value: PRIV },
    });
    // No "must be 64 hex" rejection; the extended key validates as a match.
    expect(await screen.findByText(/Keys match/i)).toBeTruthy();
    const addBtn = screen.getByRole("button", {
      name: /add to codex/i,
    }) as HTMLButtonElement;
    expect(addBtn.disabled).toBe(false);
  });

  it("mints a keypair under the Generate subtab", async () => {
    await renderTab([]);
    fireEvent.click(screen.getByRole("button", { name: /^generate$/i }));
    fireEvent.click(screen.getByRole("button", { name: /generate keypair/i }));
    expect(await screen.findByText(/save this private key/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /save to codex/i })).toBeTruthy();
  });

  it("deletes an unprotected keypair from the expanded row", async () => {
    await renderTab([kpFx({ id: "kp-del", publicKey: "c".repeat(64) })]);
    const card = screen.getByText("Pure Key #1").closest("[data-keypair-id]") as HTMLElement;
    expandRow(card);
    fireEvent.click(within(card).getByRole("button", { name: /^delete$/i }));
    await waitFor(() => expect(document.querySelectorAll("[data-keypair-id]").length).toBe(0));
  });

  it("disables deletion for a protected CodexGuard key (UI-level protection)", async () => {
    await renderTab([
      kpFx({ id: "kp-guard", publicKey: "d".repeat(64), isCodexGuard: true, label: "GuardianKey" }),
    ]);
    const card = screen.getByText("GuardianKey").closest("[data-keypair-id]") as HTMLElement;
    expandRow(card);
    expect(within(card).getByRole("button", { name: /cannot be removed/i })).toBeTruthy();
    expect(within(card).queryByRole("button", { name: /^delete$/i })).toBeNull();
    expect(screen.getByText("GuardianKey")).toBeTruthy();
  });
});
