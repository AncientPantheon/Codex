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
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, cleanup, act } from "@testing-library/react";
import { smartEncrypt } from "@stoachain/stoa-core/crypto";

import { CodexProvider } from "@ancientpantheon/codex-ouronet/provider";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import { useCodex, useStoaChainSeeds, useCodexAuth } from "@ancientpantheon/codex-ouronet/hooks";
import { SeedWordsTab } from "@ancientpantheon/codex-ouronet/ui";
import type { IStoaChainSeed } from "@ancientpantheon/codex-ouronet/types";
import { CodexUiRoot } from "@ancientpantheon/codex-ui/ui";

const seedFx = (over: Partial<IStoaChainSeed> = {}): IStoaChainSeed => ({
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

function Seeder({ seeds }: { seeds: IStoaChainSeed[] }) {
  const { addSeed } = useStoaChainSeeds();
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

async function renderTab(seeds: IStoaChainSeed[] = [], password?: string) {
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

class FakeResizeObserver {
  callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }
  observe(target: Element) {
    this.callback(
      [{ contentRect: { width: FakeResizeObserver.nextWidth } } as unknown as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
    void target;
  }
  unobserve() {}
  disconnect() {}
  static nextWidth = 1024;
}

async function renderTabMobile(seeds: IStoaChainSeed[] = [], password?: string) {
  FakeResizeObserver.nextWidth = 390;
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  const adapter = new MemoryCodexAdapter("dev");
  const utils = render(
    <CodexProvider adapter={adapter}>
      <Seeder seeds={seeds} />
      {password !== undefined && <Authenticator password={password} />}
      <CodexUiRoot>
        <SeedWordsTab />
      </CodexUiRoot>
    </CodexProvider>,
  );
  if (seeds.length > 0) {
    await waitFor(() =>
      expect(document.querySelectorAll("[data-seed-id]").length).toBeGreaterThan(0),
    );
  } else {
    await waitFor(() => expect(screen.getByText(/No seeds/i)).toBeTruthy());
  }
  return utils;
}

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

  it("renders a legacy 'eckowallet' seed under the unified Chainweaver/EckoWallet badge (collapse regression)", async () => {
    await renderTab([
      seedFx({ id: "p", name: "Prime" }),
      seedFx({ id: "s1", name: "Legacy Ecko Seed", seedType: "eckowallet" }),
    ]);
    const card = (await screen.findByText("Legacy Ecko Seed")).closest("[data-seed-id]") as HTMLElement;
    // Old "eckowallet" data still renders, sharing the SAME unified label +
    // color as "chainweaver" — not a separate orange "EckoWallet" badge.
    const badge = within(card).getByText("Chainweaver / EckoWallet");
    expect(badge).toBeTruthy();
    expect(badge.style.color).toBe("rgb(59, 130, 246)"); // #3b82f6
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
    // Round 22: the menu now portals to `document.body` (fixes a real
    // position bug caused by round 21's swipe-carousel transform ancestor)
    // — its items are no longer DOM descendants of `card`, so `screen`
    // finds them, not `within(card)`.
    fireEvent.click(screen.getByRole("button", { name: /rename/i }));
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
    fireEvent.click(screen.getByRole("button", { name: /delete/i })); // portaled — see the rename test's comment above
    await waitFor(() => expect(screen.queryByText("Disposable")).toBeNull());
  });

  it("omits Rename/Delete from the Prime seed's actions menu", async () => {
    await renderTab([seedFx({ id: "s-prime", name: "Prime Seed", isPrime: true })]);
    const card = (await screen.findByText("Prime Codex Seed")).closest("[data-seed-id]") as HTMLElement;
    openMenu(card);
    // View Seed Words is present; Rename + Delete are not (prime protection).
    // Portaled to `document.body` (round 22) — see the rename test's comment above.
    expect(screen.getByRole("button", { name: /view seed words/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^rename$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^delete$/i })).toBeNull();
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
    fireEvent.click(screen.getByRole("button", { name: /view seed words/i })); // portaled — see the rename test's comment above

    // The plaintext mnemonic surfaces — proving the codex password decrypted it.
    expect(await screen.findByText(phrase)).toBeTruthy();
  });

  // Round 19 owner correction: "if there is a stoa dalos Seed type, it
  // needs to have the whole Stoa Dalos private key viewing infrastructure,
  // words, bit sctring, bitmap, base 49 base 10 scalar the whole deal."
  it("a 'stoic' (Stoa Dalos) seed's View Seed Words shows the FULL DalosSecretReveal (Bitmap/BitString/Base-10/Base-49 tabs) instead of a bare bitstring dump", async () => {
    const password = "hunter2";
    // A `stoic` seed's own `secret` is ALWAYS its raw DALOS bitstring, never
    // a BIP39 mnemonic (see `SeedWordsTab.tsx`'s own doc comment on this) —
    // "0".repeat(1600) is the same valid-dalos-curve fixture
    // `codex-arweave`'s own `e5-seeds-area.test.tsx` uses for `bits`.
    const bitstring = "0".repeat(1600);
    const encrypted = await smartEncrypt(bitstring, password, "2");
    await renderTab(
      [
        seedFx({ id: "p", name: "Prime" }),
        seedFx({ id: "s1", name: "Dalos Seed", seedType: "stoic", secret: encrypted }),
      ],
      password,
    );

    const card = (await screen.findByText("Dalos Seed")).closest("[data-seed-id]") as HTMLElement;
    openMenu(card);
    fireEvent.click(screen.getByRole("button", { name: /view seed words/i })); // portaled — see the rename test's comment above

    // The bare bitstring dump is GONE — `DalosSecretReveal`'s own tab bar
    // (Bitmap / BitString / Base-10 / Base-49) is what renders instead.
    expect(await screen.findByRole("button", { name: /bitmap/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /bitstring/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /base-10/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /base-49/i })).toBeTruthy();
    // No Seed (words) tab — a stoic seed genuinely has no real words to
    // reveal (the conversion is one-way; see the same doc comment).
    expect(screen.queryByRole("button", { name: /^seed$/i })).toBeNull();
  });

  // Round 22/23 owner correction, asked four times: "A Chainwe[b] Stoa-Dalos
  // based Seed still cant show me the seed words." A stoic seed created
  // WITH real words behind it (`wordsSecret` set — see
  // `IStoaChainSeed.wordsSecret`'s own doc comment and
  // `CreateStoaChainSeedModal.tsx`'s `finalizeStoicSeed`) must show them.
  it("a 'stoic' seed WITH a wordsSecret shows the real Seed (words) tab, not just the bitstring dump", async () => {
    const password = "hunter2";
    const bitstring = "0".repeat(1600);
    const words = "alpha bravo charlie delta echo foxtrot golf hotel";
    const encryptedBits = await smartEncrypt(bitstring, password, "2");
    const encryptedWords = await smartEncrypt(words, password, "2");
    await renderTab(
      [
        seedFx({ id: "p", name: "Prime" }),
        seedFx({
          id: "s1",
          name: "Dalos Seed",
          seedType: "stoic",
          secret: encryptedBits,
          wordsSecret: encryptedWords,
        }),
      ],
      password,
    );

    const card = (await screen.findByText("Dalos Seed")).closest("[data-seed-id]") as HTMLElement;
    openMenu(card);
    fireEvent.click(screen.getByRole("button", { name: /view seed words/i })); // portaled — see the rename test's comment above

    // The Seed (words) tab is NOW present — its "8 words" subtitle is a
    // unique marker (unlike the "Seed" label alone, which also prefixes
    // the page's own "Seed actions" menu trigger) — and shows the real
    // words.
    expect(await screen.findByText("8 words")).toBeTruthy();
    for (const word of words.split(" ")) {
      expect(screen.getByText(word)).toBeTruthy();
    }
    // Every OTHER representation still derives correctly alongside it.
    expect(screen.getByRole("button", { name: /bitmap/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /bitstring/i })).toBeTruthy();
  });

  it("every OTHER seed type keeps the plain mnemonic strip — the DalosSecretReveal swap is stoic-only", async () => {
    const password = "hunter2";
    const phrase = "alpha bravo charlie delta echo foxtrot";
    const encrypted = await smartEncrypt(phrase, password, "2");
    await renderTab(
      [
        seedFx({ id: "p", name: "Prime" }),
        seedFx({ id: "s1", name: "Koala Seed", seedType: "koala", secret: encrypted }),
      ],
      password,
    );

    const card = (await screen.findByText("Koala Seed")).closest("[data-seed-id]") as HTMLElement;
    openMenu(card);
    fireEvent.click(screen.getByRole("button", { name: /view seed words/i })); // portaled — see the rename test's comment above

    expect(await screen.findByText(phrase)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /bitmap/i })).toBeNull();
  });
});

describe("<SeedWordsTab> — mobile: full-screen expansion + pagination (design.md §8, the 'optimize each blockchain and tab' round)", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("hides its own header ('Total N Seeds' + 'Create New Seed') — relocated onto ChainwebPanel's category row", async () => {
    await renderTabMobile([seedFx({ id: "p", name: "Prime" })]);
    expect(screen.queryByText(/Total \d+ Seeds?/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /create new seed/i })).toBeNull();
  });

  it("clicking a seed opens it FULL SCREEN (a dialog with a back/close control) instead of expanding inline", async () => {
    await renderTabMobile([
      seedFx({ id: "p", name: "Prime" }),
      seedFx({ id: "s1", name: "Explorer" }),
    ]);
    const card = (await screen.findByText("Explorer")).closest("[data-seed-id]") as HTMLElement;
    fireEvent.click(card.firstElementChild as HTMLElement);
    const dialog = await screen.findByRole("dialog");
    // Title now also carries the key count (design.md §8, the "further
    // optimize round 5": "the title must show the how many keys the seed
    // holds") — "Explorer (0)" here, since this fixture has no accounts.
    expect(within(dialog).getByText(/^Explorer \(\d+\)$/)).toBeTruthy();
    // The real `CodexModalShell` chrome — a Close control — not a bare
    // inline expand.
    expect(within(dialog).getByRole("button", { name: "Close" })).toBeTruthy();
  });

  it("only ONE seed can be full-screen-open at a time — opening a second replaces the first", async () => {
    await renderTabMobile([
      seedFx({ id: "p", name: "Prime" }),
      seedFx({ id: "s1", name: "Alpha" }),
      seedFx({ id: "s2", name: "Beta" }),
    ]);
    const alphaCard = (await screen.findByText("Alpha")).closest("[data-seed-id]") as HTMLElement;
    fireEvent.click(alphaCard.firstElementChild as HTMLElement);
    expect(within(await screen.findByRole("dialog")).getByText(/^Alpha \(\d+\)$/)).toBeTruthy();

    const betaCard = screen.getByText("Beta").closest("[data-seed-id]") as HTMLElement;
    fireEvent.click(betaCard.firstElementChild as HTMLElement);
    // Exactly one dialog, now showing Beta.
    const dialogs = screen.getAllByRole("dialog");
    expect(dialogs).toHaveLength(1);
    expect(within(dialogs[0]).getByText(/^Beta \(\d+\)$/)).toBeTruthy();
    expect(within(dialogs[0]).queryByText(/^Alpha \(\d+\)$/)).toBeNull();
  });

  it("closing the full-screen popup returns to the list, nothing left expanded", async () => {
    await renderTabMobile([seedFx({ id: "p", name: "Prime" })]);
    const card = (await screen.findByText("Prime Codex Seed")).closest("[data-seed-id]") as HTMLElement;
    fireEvent.click(card.firstElementChild as HTMLElement);
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("paginates using the MEASURED page size (design.md §8, round 8 follow-up: 'we need [the] same pagination... at the seeds level'), with Prev/Next controls", async () => {
    // jsdom never resolves real layout (`clientHeight` stays 0), so
    // `useMobileSeedPageSize` never gets a real measurement and stays at
    // its safe DEFAULT (4 rows/page) throughout — the SAME "measurement is
    // a browser-only concern" precedent `OuronetAccountsTab`'s own
    // `useMobilePageSize` established. `PrimeSeparator` is desktop-only now
    // (round 8 follow-up: "the prime seed must be differentiated only via
    // colour on mobile"), so every page uses the SAME plain 4 — 14 total
    // seeds → 4 + 4 + 4 + 2 = 4 pages.
    const seeds = [
      seedFx({ id: "p", name: "Prime" }),
      ...Array.from({ length: 13 }, (_, i) => seedFx({ id: `s${i}`, name: `Seed${String(i).padStart(2, "0")}` })),
    ];
    await renderTabMobile(seeds);
    expect(screen.getByText("1 / 4")).toBeTruthy();
    expect(document.querySelectorAll("[data-seed-id]").length).toBe(4);

    fireEvent.click(screen.getByRole("button", { name: /next page/i }));
    expect(await screen.findByText("2 / 4")).toBeTruthy();
    expect(document.querySelectorAll("[data-seed-id]").length).toBe(4);

    fireEvent.click(screen.getByRole("button", { name: /next page/i }));
    expect(await screen.findByText("3 / 4")).toBeTruthy();
    expect(document.querySelectorAll("[data-seed-id]").length).toBe(4);

    fireEvent.click(screen.getByRole("button", { name: /next page/i }));
    expect(await screen.findByText("4 / 4")).toBeTruthy();
    expect(document.querySelectorAll("[data-seed-id]").length).toBe(2);
  });

  it("no separator on mobile — the prime seed is differentiated by colour alone (round 8 follow-up: 'if we remove the separator, [more] entries would have fit')", async () => {
    await renderTabMobile([seedFx({ id: "p", name: "Prime" }), seedFx({ id: "s1", name: "Second" })]);
    expect(screen.queryByText("Other Seeds")).toBeNull();
  });

  it("no pagination controls when everything fits on one page", async () => {
    await renderTabMobile([seedFx({ id: "p", name: "Prime" })]);
    expect(screen.queryByRole("button", { name: /next page/i })).toBeNull();
  });

  // Round 9 owner correction — "standard pagination controls zone": "If no
  // expand collapse medallion exists at the middle of the bottom page...
  // that's where the pagination controls should be in their own
  // medallion." The Seeds view never has a Collapse-All medallion, so once
  // a caller opts into `onPaginationHandleChange`, pagination is reported
  // upward INSTEAD OF rendered inline — `ChainwebPanel` renders the shared
  // medallion elsewhere.
  describe("reports pagination upward instead of inline once a caller opts in (onPaginationHandleChange)", () => {
    type PaginationHandle = { page: number; totalPages: number; onPrev: () => void; onNext: () => void; onJump: (page: number) => void } | null;

    async function renderReporting(seeds: IStoaChainSeed[], handleRef: { current: PaginationHandle }) {
      FakeResizeObserver.nextWidth = 390;
      vi.stubGlobal("ResizeObserver", FakeResizeObserver);
      const adapter = new MemoryCodexAdapter("dev");
      const utils = render(
        <CodexProvider adapter={adapter}>
          <Seeder seeds={seeds} />
          <CodexUiRoot>
            <SeedWordsTab onPaginationHandleChange={(h) => { handleRef.current = h; }} />
          </CodexUiRoot>
        </CodexProvider>,
      );
      await waitFor(() => expect(document.querySelectorAll("[data-seed-id]").length).toBeGreaterThan(0));
      return utils;
    }

    it("reports the handle, renders no inline/portaled Prev/Next", async () => {
      const handleRef: { current: PaginationHandle } = { current: null };
      const seeds = [
        seedFx({ id: "p", name: "Prime" }),
        ...Array.from({ length: 13 }, (_, i) => seedFx({ id: `s${i}`, name: `Seed${String(i).padStart(2, "0")}` })),
      ];
      await renderReporting(seeds, handleRef);
      await waitFor(() => expect(handleRef.current).toEqual(expect.objectContaining({ page: 0, totalPages: 4 })));
      expect(screen.queryByRole("button", { name: /next page/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /previous page/i })).toBeNull();

      act(() => handleRef.current?.onNext());
      expect(document.querySelectorAll("[data-seed-id]").length).toBe(4);
      await waitFor(() => expect(handleRef.current).toEqual(expect.objectContaining({ page: 1, totalPages: 4 })));
    });

    it("reports null once everything fits on one page", async () => {
      const handleRef: { current: PaginationHandle } = { current: null };
      await renderReporting([seedFx({ id: "p", name: "Prime" })], handleRef);
      await waitFor(() => expect(screen.getByText("Prime Codex Seed")).toBeTruthy());
      expect(handleRef.current).toBeNull();
    });
  });

  // Owner correction (design.md §8, round 8 follow-up): "when there are
  // more than 10 pages available the entry 15/24 when clicked needs to
  // allow the input of a given page, to jump directly to a wanted page."
  it("becomes a clickable jump control past 10 pages and jumps directly to a typed page", async () => {
    // 45 seeds / 4 per page (jsdom default) = 12 pages — past the threshold.
    const seeds = [
      seedFx({ id: "p", name: "Prime" }),
      ...Array.from({ length: 44 }, (_, i) => seedFx({ id: `s${i}`, name: `Seed${String(i).padStart(2, "0")}` })),
    ];
    await renderTabMobile(seeds);
    const jumpBtn = await screen.findByRole("button", { name: "1 / 12" });
    fireEvent.click(jumpBtn);
    const input = screen.getByLabelText(/jump to page/i);
    fireEvent.change(input, { target: { value: "9" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByRole("button", { name: "9 / 12" })).toBeTruthy();
  });

  it("desktop (no CodexUiRoot ancestor) is unaffected — header shown, inline expansion, no pagination", async () => {
    await renderTab([seedFx({ id: "p", name: "Prime" })]);
    expect(screen.getByRole("button", { name: /create new seed/i })).toBeTruthy();
    const card = screen.getByText("Prime Codex Seed").closest("[data-seed-id]") as HTMLElement;
    fireEvent.click(card.firstElementChild as HTMLElement);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  // Owner-reported live bug (round 9): "the next button to change page
  // doesn't work, and i can clearly see that 4 entries would fit, so why
  // aren't there 4 entries there?" jsdom's own default fallback (every
  // OTHER test in this suite) never exercises the REAL measurement branch
  // — `clientHeight`/`getBoundingClientRect` always read 0, so `pageSize`
  // never leaves its literal `useState(4)` seed. This case drives that
  // branch with REALISTIC (non-zero, non-default) pixel values to prove
  // (a) the formula lands on the page count the numbers actually justify,
  // and (b) Next still advances correctly once real numbers are in play.
  it("under REALISTIC (non-default) measured dimensions, computes the page size the numbers justify, and Next still advances", async () => {
    // A controllable stand-in — unlike the suite's own `FakeResizeObserver`
    // (which fires its callback synchronously and only ever once, using
    // canned `contentRect` data neither hook here even reads), this one
    // lets the test install ITS OWN `getBoundingClientRect`/`clientHeight`
    // on the exact row/container nodes AFTER they exist, then fire the
    // observers on demand to re-measure against those real-shaped values —
    // exactly what a real browser's resize/layout settle does.
    class ControllableResizeObserver {
      static instances: ControllableResizeObserver[] = [];
      target: Element | null = null;
      callback: ResizeObserverCallback;
      constructor(cb: ResizeObserverCallback) {
        this.callback = cb;
        ControllableResizeObserver.instances.push(this);
      }
      observe(target: Element) {
        this.target = target;
      }
      unobserve() {}
      disconnect() {}
      fire() {
        if (this.target) this.callback([{ contentRect: {} } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
      }
    }
    ControllableResizeObserver.instances = [];
    vi.stubGlobal("ResizeObserver", ControllableResizeObserver);

    const seeds = [
      seedFx({ id: "p", name: "Prime" }),
      ...Array.from({ length: 9 }, (_, i) => seedFx({ id: `s${i}`, name: `Seed${String(i).padStart(2, "0")}` })),
    ];
    const adapter = new MemoryCodexAdapter("dev");
    render(
      <CodexProvider adapter={adapter}>
        <Seeder seeds={seeds} />
        <CodexUiRoot>
          <SeedWordsTab />
        </CodexUiRoot>
      </CodexProvider>,
    );
    await waitFor(() => expect(document.querySelectorAll("[data-seed-id]").length).toBeGreaterThan(0));

    // Structure: containerRef(flex column) > wrapper-div(rowRef, ONLY on
    // the page's first row) > [data-seed-id] (SeedRow's own root).
    const firstSeedDiv = document.querySelector("[data-seed-id]") as HTMLElement;
    const rowEl = firstSeedDiv.parentElement as HTMLElement;
    const containerEl = rowEl.parentElement as HTMLElement;

    // A row genuinely 54px tall, a container genuinely 256px tall — the
    // SAME 8px gap the component's own `SEED_ROW_GAP` uses. Round 10 owner
    // correction ("same size of the border left right up and down") added
    // `padding: SEED_ROW_GAP` on every side, which `compute()` subtracts
    // back out of `clientHeight` (256 - 2*8 = 240 usable) before applying
    // the SAME formula as before: `floor((240+8)/(54+8)) = floor(4.0) = 4`
    // — 4 rows SHOULD fit, with zero px left over.
    Object.defineProperty(rowEl, "getBoundingClientRect", { configurable: true, value: () => ({ height: 54 }) });
    Object.defineProperty(containerEl, "clientHeight", { configurable: true, value: 256 });

    for (const inst of ControllableResizeObserver.instances) inst.fire();
    // Two effects chain (row measures → rowHeight state → container effect
    // re-runs) — a second pass of fires lets that settle fully in case the
    // container's own observer instance predates the row height update.
    await waitFor(() => {});
    for (const inst of ControllableResizeObserver.instances) inst.fire();

    await waitFor(() => expect(document.querySelectorAll("[data-seed-id]").length).toBe(4));
    expect(screen.getByText("1 / 3")).toBeTruthy(); // 10 seeds / 4 per page = 3 pages (4+4+2)

    fireEvent.click(screen.getByRole("button", { name: /next page/i }));
    await waitFor(() => expect(screen.getByText("2 / 3")).toBeTruthy());
    expect(document.querySelectorAll("[data-seed-id]").length).toBe(4);
  });
});

describe("<SeedWordsTab> — mobile: fullScreenPortalTarget (design.md §8, the 'further optimize round 3' — owner correction: 'when I say full screen from now on, I mean a full screen extension, not extending in its zone')", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  async function renderTabMobileWithTarget(seeds: IStoaChainSeed[], target: HTMLElement | null) {
    FakeResizeObserver.nextWidth = 390;
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const adapter = new MemoryCodexAdapter("dev");
    const utils = render(
      <CodexProvider adapter={adapter}>
        <Seeder seeds={seeds} />
        <CodexUiRoot>
          <SeedWordsTab fullScreenPortalTarget={target} />
        </CodexUiRoot>
      </CodexProvider>,
    );
    await waitFor(() => expect(document.querySelectorAll("[data-seed-id]").length).toBeGreaterThan(0));
    return utils;
  }

  it("portals the seed-detail dialog into the supplied target — NOT bounded to this component's own tree", async () => {
    const target = document.createElement("div");
    target.setAttribute("data-testid", "whole-screen-target");
    document.body.appendChild(target);

    const { container } = await renderTabMobileWithTarget([seedFx({ id: "p", name: "Prime" })], target);
    const card = screen.getByText("Prime Codex Seed").closest("[data-seed-id]") as HTMLElement;
    fireEvent.click(card.firstElementChild as HTMLElement);

    const dialog = await screen.findByRole("dialog");
    // Rendered under the EXTERNAL target, not under this component's own container.
    expect(target.contains(dialog)).toBe(true);
    expect(container.contains(dialog)).toBe(false);

    document.body.removeChild(target);
  });

  it("without a target, falls back to the bounded inline mount (unchanged default)", async () => {
    const { container } = await renderTabMobileWithTarget([seedFx({ id: "p", name: "Prime" })], null);
    const card = screen.getByText("Prime Codex Seed").closest("[data-seed-id]") as HTMLElement;
    fireEvent.click(card.firstElementChild as HTMLElement);

    const dialog = await screen.findByRole("dialog");
    expect(container.contains(dialog)).toBe(true);
  });

  it("ALSO portals the 'Create New Seed' modal into the supplied target — owner correction: 'clicking create new seed must be opened on the whole screen real estate area, so it must be full screen'", async () => {
    const target = document.createElement("div");
    target.setAttribute("data-testid", "whole-screen-target");
    document.body.appendChild(target);

    const adapter = new MemoryCodexAdapter("dev");
    FakeResizeObserver.nextWidth = 390;
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const { container } = render(
      <CodexProvider adapter={adapter}>
        <Seeder seeds={[seedFx({ id: "p", name: "Prime" })]} />
        <CodexUiRoot>
          <SeedWordsTab fullScreenPortalTarget={target} createOpen onCreateOpenChange={() => {}} />
        </CodexUiRoot>
      </CodexProvider>,
    );
    await waitFor(() => expect(document.querySelectorAll("[data-seed-id]").length).toBeGreaterThan(0));

    const dialog = await screen.findByRole("dialog");
    expect(target.contains(dialog)).toBe(true);
    expect(container.contains(dialog)).toBe(false);

    document.body.removeChild(target);
  });

  // Owner correction (design.md §8, round 8 follow-up): "if we bring the
  // pagination engine in the bar below (see 4th screenshot), probably 4
  // would have fit."
  it("ALSO portals the Prev/Next pagination bar into the supplied target, freeing the seed-list column of that row", async () => {
    const target = document.createElement("div");
    target.setAttribute("data-testid", "whole-screen-target");
    document.body.appendChild(target);

    const seeds = [
      seedFx({ id: "p", name: "Prime" }),
      ...Array.from({ length: 13 }, (_, i) => seedFx({ id: `s${i}`, name: `Seed${String(i).padStart(2, "0")}` })),
    ];
    const { container } = await renderTabMobileWithTarget(seeds, target);

    const prevBtn = await screen.findByRole("button", { name: /previous page/i });
    expect(target.contains(prevBtn)).toBe(true);
    expect(container.contains(prevBtn)).toBe(false);

    document.body.removeChild(target);
  });

  it("without a target, the pagination bar falls back to the bounded inline mount (unchanged default)", async () => {
    const seeds = [
      seedFx({ id: "p", name: "Prime" }),
      ...Array.from({ length: 13 }, (_, i) => seedFx({ id: `s${i}`, name: `Seed${String(i).padStart(2, "0")}` })),
    ];
    const { container } = await renderTabMobileWithTarget(seeds, null);
    const prevBtn = await screen.findByRole("button", { name: /previous page/i });
    expect(container.contains(prevBtn)).toBe(true);
  });
});

describe("<SeedWordsTab> — mobile: ONE key row + switcher (design.md §8, the 'further optimize round 4' — owner correction: 'instead of using 2 rows on each entry… we instead use one row, and switch between with a switcher square')", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows the public key by default, on a SINGLE row (no separate private row underneath)", async () => {
    const PUBKEY = "a".repeat(64);
    await renderTabMobile([
      seedFx({ id: "p", name: "Prime", accounts: [{ index: 0, publicKey: PUBKEY, derivationPath: "m/0" }] }),
    ]);
    const card = screen.getByText("Prime Codex Seed").closest("[data-seed-id]") as HTMLElement;
    fireEvent.click(card.firstElementChild as HTMLElement);
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getByTitle(PUBKEY)).toBeTruthy();
    expect(within(dialog).queryByTitle("Show private key")).toBeNull(); // desktop-only title, gone on mobile
    expect(within(dialog).getByTitle("Switch to private key")).toBeTruthy();
  });

  it("tapping the switcher immediately enters a busy (decrypting) state — no separate blurred/masked placeholder step exists on mobile", async () => {
    const PUBKEY = "a".repeat(64);
    await renderTabMobile([
      seedFx({ id: "p", name: "Prime", accounts: [{ index: 0, publicKey: PUBKEY, derivationPath: "m/0" }] }),
    ]);
    const card = screen.getByText("Prime Codex Seed").closest("[data-seed-id]") as HTMLElement;
    fireEvent.click(card.firstElementChild as HTMLElement);
    const dialog = await screen.findByRole("dialog");
    const switcher = within(dialog).getByTitle("Switch to private key");

    fireEvent.click(switcher);

    // Synchronous — the busy spinner appears the instant the switch is
    // tapped (`decryptPrivate()` may go on to prompt for a password; this
    // assertion doesn't wait on that). No blurred/masked variant exists
    // anywhere on mobile anymore — round 4 replaced it with the switcher.
    expect(switcher.querySelector(".lucide-loader-circle")).toBeTruthy();
    // No masked/blurred key placeholder anywhere in the dialog (the modal's
    // OWN backdrop legitimately uses `backdrop-filter: blur(2px)` — scope
    // past that to the plain CSS `filter` property the old masking used).
    expect(dialog.querySelector('[style*="filter: blur"]')).toBeNull();
  });

  it("the copy button copies the public key while it's the one showing", async () => {
    const PUBKEY = "a".repeat(64);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    await renderTabMobile([
      seedFx({ id: "p", name: "Prime", accounts: [{ index: 0, publicKey: PUBKEY, derivationPath: "m/0" }] }),
    ]);
    const card = screen.getByText("Prime Codex Seed").closest("[data-seed-id]") as HTMLElement;
    fireEvent.click(card.firstElementChild as HTMLElement);
    const dialog = await screen.findByRole("dialog");

    fireEvent.click(within(dialog).getByTitle("Copy public key"));
    expect(writeText).toHaveBeenLastCalledWith(PUBKEY);
  });

  it("desktop keeps the side-by-side row layout, byte-identical", async () => {
    const PUBKEY = "b".repeat(64);
    await renderTab([
      seedFx({ id: "p", name: "Prime", accounts: [{ index: 0, publicKey: PUBKEY, derivationPath: "m/0" }] }),
    ]);
    const card = screen.getByText("Prime Codex Seed").closest("[data-seed-id]") as HTMLElement;
    fireEvent.click(card.firstElementChild as HTMLElement); // desktop: inline expand, not a dialog
    const publicRow = screen.getByText(PUBKEY).closest("div") as HTMLElement;
    const privateRow = screen.getByTitle("Show private key").closest("div") as HTMLElement;
    const wrapper = publicRow.parentElement as HTMLElement;
    expect(wrapper).toBe(privateRow.parentElement);
    expect(wrapper.style.flexDirection).not.toBe("column");
  });
});

describe("<SeedWordsTab> — mobile: seed row header + key-detail footer polish (design.md §8, the 'further optimize round 4')", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("replaces the wide seed-type TEXT badge with a small colored dot, back on ONE row (design.md §8, round 6) — the name still gets to flex to full width", async () => {
    await renderTabMobile([
      seedFx({ id: "p", name: "A Very Long Seed Name That Would Otherwise Truncate", seedType: "koala", accounts: [] }),
    ]);
    const card = (await screen.findByText("Prime Codex Seed")).closest("[data-seed-id]") as HTMLElement;
    // No wide text badge ("Koala") anywhere anymore — just a dot carrying
    // the label via title/aria-label instead.
    expect(within(card).queryByText("Koala")).toBeNull();
    const dot = within(card).getByTitle("Koala");
    expect(dot.style.borderRadius).toBe("50%");
    const nameEl = within(card).getByText("Prime Codex Seed");
    expect(nameEl.style.flex).toBe("1 1 0%");
    // Single row: the dot and the name share the SAME header row.
    expect(dot.closest('div[style*="align-items: center"]')).toBe(nameEl.closest('div[style*="align-items: center"]'));
  });

  it("replaces the 'N keys' text with a compact count + key-icon badge", async () => {
    await renderTabMobile([
      seedFx({ id: "p", name: "Prime", accounts: [{ index: 0, publicKey: "a".repeat(64), derivationPath: "m/0" }, { index: 1, publicKey: "b".repeat(64), derivationPath: "m/1" }] }),
    ]);
    await screen.findByText("Prime Codex Seed");
    expect(screen.queryByText(/^\d+ keys?$/)).toBeNull();
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("desktop keeps the single-row 'N keys' text layout, byte-identical", async () => {
    await renderTab([
      seedFx({ id: "p", name: "Prime", seedType: "koala", accounts: [{ index: 0, publicKey: "a".repeat(64), derivationPath: "m/0" }] }),
    ]);
    expect(screen.getByText("1 key")).toBeTruthy();
  });

  it("the key-detail footer (Add Consecutive/At Position) stays PINNED to the card's bottom, outside the scrolling key list", async () => {
    await renderTabMobile([
      seedFx({ id: "p", name: "Prime", accounts: [{ index: 0, publicKey: "a".repeat(64), derivationPath: "m/0" }] }),
    ]);
    const card = screen.getByText("Prime Codex Seed").closest("[data-seed-id]") as HTMLElement;
    fireEvent.click(card.firstElementChild as HTMLElement);
    const dialog = await screen.findByRole("dialog");

    const body = within(dialog).getByTestId("seed-detail-p-body");
    const addBtn = within(dialog).getByRole("button", { name: /add consecutive key/i });
    // The footer button is OUTSIDE the scrolling body — a sibling after it.
    expect(body.contains(addBtn)).toBe(false);
    expect(addBtn.closest('[role="dialog"]')).toBe(dialog);
  });

  it("each key row renders as its own bordered card (rectangle)", async () => {
    await renderTabMobile([
      seedFx({ id: "p", name: "Prime", accounts: [{ index: 0, publicKey: "a".repeat(64), derivationPath: "m/0" }] }),
    ]);
    const card = screen.getByText("Prime Codex Seed").closest("[data-seed-id]") as HTMLElement;
    fireEvent.click(card.firstElementChild as HTMLElement);
    const dialog = await screen.findByRole("dialog");

    const keyRow = within(dialog).getByText("#0").closest('div[style*="border-radius: 12px"]') as HTMLElement;
    expect(keyRow).toBeTruthy();
    expect(keyRow.style.border).toContain("1px solid");
  });
});

describe("<SeedWordsTab> — mobile: shared key-selection row + position medallions (design.md §8, the 'further optimize round 5')", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  const threeKeys = [
    seedFx({
      id: "p", name: "Prime",
      accounts: [
        { index: 0, publicKey: "a".repeat(64), derivationPath: "m/0" },
        { index: 1, publicKey: "b".repeat(64), derivationPath: "m/1" },
        { index: 2, publicKey: "c".repeat(64), derivationPath: "m/2" },
      ],
    }),
  ];

  async function openDialog() {
    await renderTabMobile(threeKeys);
    const card = screen.getByText("Prime Codex Seed").closest("[data-seed-id]") as HTMLElement;
    fireEvent.click(card.firstElementChild as HTMLElement);
    return screen.findByRole("dialog");
  }

  it("the title shows the seed's key count", async () => {
    const dialog = await openDialog();
    expect(within(dialog).getByText(/^Prime Codex Seed \(3\)$/)).toBeTruthy();
  });

  it("shows a #N medallion per position instead of 'Key #N' text", async () => {
    const dialog = await openDialog();
    expect(within(dialog).getByText("#0")).toBeTruthy();
    expect(within(dialog).getByText("#1")).toBeTruthy();
    expect(within(dialog).getByText("#2")).toBeTruthy();
    expect(within(dialog).queryByText(/^Key #\d+$/)).toBeNull();
  });

  it("elongates the medallion (extra horizontal padding) for a position number too wide for a plain circle", async () => {
    const seeds = [
      seedFx({ id: "p", name: "Prime", accounts: [{ index: 7723, publicKey: "a".repeat(64), derivationPath: "m/0" }] }),
    ];
    await renderTabMobile(seeds);
    const card = screen.getByText("Prime Codex Seed").closest("[data-seed-id]") as HTMLElement;
    fireEvent.click(card.firstElementChild as HTMLElement);
    const dialog = await screen.findByRole("dialog");

    const medallion = within(dialog).getByText("#7723");
    // Always fully-rounded (semicircle) ends — the "elongation" is purely
    // extra width via padding, never a plain rounded-rectangle corner radius.
    expect(medallion.style.borderRadius).toBe("9999px");
    expect(medallion.style.padding).not.toBe("0px");
  });

  it("position #0 is SELECTED by default — no tap needed — and its medallion is lit", async () => {
    const dialog = await openDialog();
    const medallion0 = within(dialog).getByText("#0");
    expect(medallion0.style.border).toContain("rgb(206, 172, 95)"); // #ceac5f, lit
    const medallion1 = within(dialog).getByText("#1");
    expect(medallion1.style.border).not.toContain("rgb(206, 172, 95)");
  });

  it("tapping a different position moves the selection to it", async () => {
    const dialog = await openDialog();
    fireEvent.click(within(dialog).getByText("#1").closest("div[style*='cursor: pointer']") as HTMLElement);
    await waitFor(() => expect(within(dialog).getByText("#1").style.border).toContain("rgb(206, 172, 95)"));
    expect(within(dialog).getByText("#0").style.border).not.toContain("rgb(206, 172, 95)");
  });

  it("the shared switcher/copy/delete row sits ONCE, beneath the title — not duplicated per key", async () => {
    const dialog = await openDialog();
    expect(within(dialog).getAllByTitle(/switch to (public|private) key/i)).toHaveLength(1);
  });

  it("the shared row is PINNED at the top — outside the scrolling key list (design.md §8, round 6: 'the button must stay fixed at the top, only the entries scroll')", async () => {
    const dialog = await openDialog();
    const body = within(dialog).getByTestId("seed-detail-p-body");
    const switcher = within(dialog).getByTitle(/switch to (public|private) key/i);
    expect(body.contains(switcher)).toBe(false);
  });

  it("the Add Consecutive/At Position footer buttons are centered", async () => {
    const dialog = await openDialog();
    const addBtn = within(dialog).getByRole("button", { name: /add consecutive key/i });
    const row = addBtn.parentElement as HTMLElement;
    expect(row.style.justifyContent).toBe("center");
  });

  it("the key-detail body has scroll-snap enabled, so it settles on whole rows only", async () => {
    const dialog = await openDialog();
    const body = within(dialog).getByTestId("seed-detail-p-body");
    expect(body.style.scrollSnapType).toBe("y mandatory");
  });

  it("each key row opts INTO the scroll-snap (scrollSnapAlign: start)", async () => {
    const dialog = await openDialog();
    const keyRow = within(dialog).getByText("#0").closest('div[style*="border-radius: 12px"]') as HTMLElement;
    expect(keyRow.style.scrollSnapAlign).toBe("start");
  });

  it("the seed's own card (in the outer list) opts into scroll-snap too", async () => {
    await renderTabMobile(threeKeys);
    const card = screen.getByText("Prime Codex Seed").closest("[data-seed-id]") as HTMLElement;
    expect(card.style.scrollSnapAlign).toBe("start");
  });
});

describe("<SeedWordsTab> — mobile: 'View Seed Words' failure feedback on a COLLAPSED row (design.md §8, the 'further optimize round 5' — bug fix: 'nothing happens')", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("a 'View Seed Words' decrypt failure now surfaces on a COLLAPSED mobile row (previously silently swallowed — gated `!isMobile` only)", async () => {
    // The fixture's default `secret` ("enc-secret") isn't real ciphertext,
    // so `smartDecrypt` throws once authenticated — a hermetic way to reach
    // `handleView`'s catch block (sets `rowError`) without needing to drive
    // a real password-prompt modal to completion.
    await renderTabMobile([seedFx({ id: "p", name: "Prime" })], "pw");
    const card = screen.getByText("Prime Codex Seed").closest("[data-seed-id]") as HTMLElement;
    // Row is COLLAPSED — never tapped to expand.
    openMenu(card);
    fireEvent.click(screen.getByRole("button", { name: /view seed words/i })); // portaled — see the rename test's comment above

    expect(await screen.findByText(/unlock the codex to view this seed phrase/i)).toBeTruthy();
  });
});

// Round 21 owner correction (ported from `ArweaveSeedsArea.tsx`'s identical
// change): "same slide swipe animation must be for the seed view as well,
// which now currently doesnt have such a thing."
describe("<SeedWordsTab> — mobile: the drag-following swipe carousel (round 21)", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  function manySeeds(count: number): IStoaChainSeed[] {
    return [
      seedFx({ id: "p", name: "Prime" }),
      ...Array.from({ length: count }, (_, i) => seedFx({ id: `s${i}`, name: `Seed${String(i).padStart(2, "0")}` })),
    ];
  }

  it("a left swipe advances to the next page, a right swipe goes back", async () => {
    await renderTabMobile(manySeeds(13)); // 4 pages, per the pagination test above
    const surface = screen.getByTestId("stoa-seeds-page-surface");
    expect(screen.getByText("Prime Codex Seed")).toBeTruthy();

    const swipe = (fromX: number, toX: number) => {
      fireEvent.touchStart(surface, { touches: [{ clientX: fromX, clientY: 0 }] });
      fireEvent.touchMove(surface, { touches: [{ clientX: toX, clientY: 0 }] });
      fireEvent.touchEnd(surface, { changedTouches: [{ clientX: toX, clientY: 0 }] });
    };

    swipe(300, 200);
    await waitFor(() => expect(screen.queryByText("Prime Codex Seed")).toBeNull());

    swipe(200, 300);
    await waitFor(() => expect(screen.getByText("Prime Codex Seed")).toBeTruthy());
  });

  it("visually follows the finger while dragging, resists past the first page, and ignores a vertical gesture", async () => {
    await renderTabMobile(manySeeds(13));
    const surface = screen.getByTestId("stoa-seeds-page-surface");
    const track = screen.getByTestId("stoa-seeds-page-swipe-track");
    expect(track.style.transform).toBe("translateX(0px)");

    fireEvent.touchStart(surface, { touches: [{ clientX: 200, clientY: 0 }] });
    fireEvent.touchMove(surface, { touches: [{ clientX: 300, clientY: 0 }] });
    expect(track.style.transform).toBe("translateX(35px)"); // 100 * 0.35 resistance
    expect(track.style.transition).toBe("none");
    fireEvent.touchEnd(surface, { changedTouches: [{ clientX: 300, clientY: 0 }] });

    fireEvent.touchStart(surface, { touches: [{ clientX: 200, clientY: 200 }] });
    fireEvent.touchMove(surface, { touches: [{ clientX: 210, clientY: 260 }] });
    expect(track.style.transform).toBe("translateX(0px)");
    fireEvent.touchEnd(surface, { changedTouches: [{ clientX: 210, clientY: 260 }] });
  });

  it("desktop has no swipe track at all", async () => {
    await renderTab(manySeeds(13));
    expect(screen.queryByTestId("stoa-seeds-page-swipe-track")).toBeNull();
  });
});
