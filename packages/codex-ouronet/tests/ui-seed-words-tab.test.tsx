/**
 * SeedWordsTab specs — updated for the v0.5.x 1:1 "My Codex SeedWordsList" clone.
 *
 * The tab now: shows a "Create New Seed" button; renders each seed as an
 * expandable row; displays the first/prime seed as "Prime Codex Seed"; and puts
 * View Seed Words / Rename / Delete behind a per-row actions menu (the prime
 * seed's menu omits Rename/Delete). Mnemonic reveal stays gated through
 * `useCodexAuth` (decrypts `seed.secret` with the cached codex password).
 */

import * as React from "react";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { smartEncrypt } from "@stoachain/stoa-core/crypto";

import { CodexProvider } from "@ancientpantheon/codex-ouronet/provider";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import { useCodex, useKadenaSeeds, useCodexAuth } from "@ancientpantheon/codex-ouronet/hooks";
import { SeedWordsTab } from "@ancientpantheon/codex-ouronet/ui";
import type { IKadenaSeed } from "@ancientpantheon/codex-ouronet/types";

const seedFx = (over: Partial<IKadenaSeed> = {}): IKadenaSeed => ({
  id: over.id ?? "s1",
  name: over.name ?? "My Seed",
  seedType: "koala",
  version: "1.0.0",
  index: 0,
  secret: over.secret ?? "enc-secret",
  main: "k:" + "0".repeat(64),
  createdAt: "2026-05-25T10:00:00.000Z",
  accounts: over.accounts ?? [],
  ...over,
});

function Seeder({ seeds }: { seeds: IKadenaSeed[] }) {
  const { addSeed } = useKadenaSeeds();
  const { isReady } = useCodex();
  React.useEffect(() => {
    if (isReady) seeds.forEach((s) => void addSeed(s));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady]);
  return null;
}

function Authenticator({ password }: { password: string }) {
  const { authenticate } = useCodexAuth();
  const { isReady } = useCodex();
  React.useEffect(() => {
    if (isReady) authenticate(password, 60);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady]);
  return null;
}

async function renderTab(seeds: IKadenaSeed[] = [], password?: string) {
  const adapter = new MemoryCodexAdapter("dev");
  const utils = render(
    <CodexProvider adapter={adapter}>
      <Seeder seeds={seeds} />
      {password !== undefined && <Authenticator password={password} />}
      <SeedWordsTab />
    </CodexProvider>,
  );
  if (seeds.length > 0) {
    await waitFor(() =>
      expect(document.querySelectorAll("[data-seed-id]").length).toBe(seeds.length),
    );
  } else {
    await waitFor(() => expect(screen.getByText(/No seeds/i)).toBeTruthy());
  }
  return utils;
}

/** Open a seed row's actions (3-dot) menu. */
const openMenu = (card: HTMLElement) =>
  fireEvent.click(within(card).getByRole("button", { name: /seed actions/i }));

describe("<SeedWordsTab>", () => {
  it("renders the empty state with a Create-Seed affordance when the codex holds no seeds", async () => {
    await renderTab([]);
    expect(screen.getByText(/No seeds/i)).toBeTruthy();
    // Header "Create New Seed" + empty-state "Create Your First Seed".
    expect(screen.getAllByRole("button", { name: /create.*seed/i }).length).toBeGreaterThan(0);
  });

  it("shows the Create New Seed button when seeds exist", async () => {
    await renderTab([seedFx({ id: "p", name: "Prime" })]);
    expect(screen.getByRole("button", { name: /create new seed/i })).toBeTruthy();
  });

  it("displays the first seed as the locked Prime Codex Seed regardless of its name", async () => {
    await renderTab([seedFx({ id: "p", name: "Some Name" })]);
    expect(screen.getByText("Prime Codex Seed")).toBeTruthy();
    expect(screen.queryByText("Some Name")).toBeNull();
  });

  it("lists a non-prime seed's own name and key count", async () => {
    await renderTab([
      seedFx({ id: "p", name: "Prime" }),
      seedFx({
        id: "s1",
        name: "Trading Seed",
        accounts: [
          { index: 0, publicKey: "a".repeat(64), derivationPath: "m'/44'/626'/0'" },
          { index: 1, publicKey: "b".repeat(64), derivationPath: "m'/44'/626'/1'" },
        ],
      }),
    ]);
    expect(screen.getByText("Trading Seed")).toBeTruthy();
    expect(screen.getByText(/2 keys/i)).toBeTruthy();
  });

  it("expands a seed row to reveal its per-key list", async () => {
    await renderTab([
      seedFx({ id: "p", name: "Prime" }),
      seedFx({
        id: "s1",
        name: "Expandable",
        accounts: [{ index: 0, publicKey: "c".repeat(64), derivationPath: "m'/44'/626'/0'" }],
      }),
    ]);
    const card = (await screen.findByText("Expandable")).closest("[data-seed-id]") as HTMLElement;
    fireEvent.click(within(card).getByText("Expandable"));
    expect(await within(card).findByText("Key #0")).toBeTruthy();
    // Per-key copy + delete + the add-key buttons surface.
    expect(within(card).getByRole("button", { name: /add consecutive key/i })).toBeTruthy();
    expect(within(card).getByRole("button", { name: /add key at position/i })).toBeTruthy();
  });

  it("renames a non-prime seed through updateSeed (via the actions menu)", async () => {
    await renderTab([
      seedFx({ id: "s-prime", name: "Prime" }),
      seedFx({ id: "s1", name: "Old Name" }),
    ]);
    const card = (await screen.findByText("Old Name")).closest("[data-seed-id]") as HTMLElement;
    openMenu(card);
    fireEvent.click(within(card).getByRole("button", { name: /rename/i }));
    const input = screen.getByDisplayValue("Old Name");
    fireEvent.change(input, { target: { value: "New Name" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByText("New Name")).toBeTruthy();
    expect(screen.queryByText("Old Name")).toBeNull();
  });

  it("deletes a non-prime seed through the actions menu", async () => {
    await renderTab([
      seedFx({ id: "s-prime", name: "Prime" }),
      seedFx({ id: "s-del", name: "Disposable" }),
    ]);
    const card = (await screen.findByText("Disposable")).closest("[data-seed-id]") as HTMLElement;
    openMenu(card);
    fireEvent.click(within(card).getByRole("button", { name: /delete/i }));
    await waitFor(() => expect(screen.queryByText("Disposable")).toBeNull());
  });

  it("omits Rename/Delete from the Prime seed's actions menu", async () => {
    await renderTab([seedFx({ id: "s-prime", name: "Prime Seed", isPrime: true })]);
    const card = (await screen.findByText("Prime Codex Seed")).closest("[data-seed-id]") as HTMLElement;
    openMenu(card);
    // View Seed Words is present; Rename + Delete are not (prime protection).
    expect(within(card).getByRole("button", { name: /view seed words/i })).toBeTruthy();
    expect(within(card).queryByRole("button", { name: /^rename$/i })).toBeNull();
    expect(within(card).queryByRole("button", { name: /^delete$/i })).toBeNull();
  });

  it("pins the Prime seed first, then lists the rest alphabetically (case/numeric-insensitive)", async () => {
    // Prime is seeded first (the store auto-primes the first seed); the remaining
    // seeds arrive in a deliberately non-alphabetical order to prove the tab
    // re-sorts them rather than echoing store/insertion order.
    await renderTab([
      seedFx({ id: "prime", name: "Origin", isPrime: true }),
      seedFx({ id: "z", name: "Zephyr Seed" }),
      seedFx({ id: "a", name: "apex seed" }),
      seedFx({ id: "m", name: "Seed 10" }),
      seedFx({ id: "n", name: "Seed 2" }),
    ]);
    const order = Array.from(document.querySelectorAll("[data-seed-id]")).map(
      (el) => (el.querySelector("span")?.textContent || "").trim(),
    );
    // Prime is pinned first (displayed as "Prime Codex Seed"); the remaining four
    // follow alphabetically — "apex seed" before "Seed 2" before "Seed 10"
    // (numeric-aware) before "Zephyr Seed", independent of insertion order.
    expect(order[0]).toBe("Prime Codex Seed");
    expect(order.slice(1)).toEqual(["apex seed", "Seed 2", "Seed 10", "Zephyr Seed"]);
  });

  it("reveals the decrypted mnemonic only after authentication via useCodexAuth", async () => {
    const password = "hunter2";
    const phrase = "alpha bravo charlie delta echo foxtrot";
    const encrypted = await smartEncrypt(phrase, password, "2");
    await renderTab(
      [
        seedFx({ id: "p", name: "Prime" }),
        seedFx({ id: "s1", name: "Viewable", secret: encrypted }),
      ],
      password,
    );

    const card = (await screen.findByText("Viewable")).closest("[data-seed-id]") as HTMLElement;
    openMenu(card);
    fireEvent.click(within(card).getByRole("button", { name: /view seed words/i }));

    // The plaintext mnemonic surfaces — proving the codex password decrypted it.
    expect(await screen.findByText(phrase)).toBeTruthy();
  });
});
