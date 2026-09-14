/**
 * CreateStoaChainSeedModal specs.
 *
 * Covers the two changes this task landed:
 *   1. The Chainweaver/EckoWallet picker collapse — ONE selectable option for
 *      that family (always emitting `seedType: "chainweaver"` for new seeds).
 *   2. The new "Stoa Dalos" (`seedType: "stoic"`) path — both sub-modes
 *      ("Enter new seed words" and "Use existing Ouronet seed"), including
 *      the `originMode === "seedWords"`-only eligibility restriction on the
 *      existing-account picker.
 *
 * Real crypto throughout (no mocked smartEncrypt/smartDecrypt/dalos-crypto) —
 * same rationale as resolver-internal.test.ts: these ARE the primitives a
 * regression would actually break.
 *
 * The password field is filled EXPLICITLY via fireEvent rather than relying
 * on the modal's mount-time `getCurrentPassword()` prefill — that prefill
 * only fires once, on first mount, so it races an async codex `authenticate()`
 * effect and cannot be relied on in tests.
 */

import * as React from "react";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { smartEncrypt } from "@stoachain/stoa-core/crypto";

import { CodexProvider } from "@ancientpantheon/codex-ouronet/provider";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import { useCodex, useOuroAccounts, useStoaChainSeeds } from "@ancientpantheon/codex-ouronet/hooks";
import { CreateStoaChainSeedModal } from "../src/ui/internal/CreateStoaChainSeedModal";
import type { IOuroAccount, IStoaChainSeed } from "@ancientpantheon/codex-ouronet/types";

const PASSWORD = "hunter2-test-password";
const VALID_WORDS = "alpha bravo charlie delta echo";

const ouroFx = (over: Partial<IOuroAccount> = {}): IOuroAccount => ({
  id: over.id ?? "o1",
  name: over.name ?? "My Account",
  version: "1.0.0",
  isSmart: false,
  address: over.address ?? "Ѻ.my-account",
  guard: null,
  stoaChainLedger: null,
  publicKey: over.publicKey ?? "p".repeat(64),
  secret: over.secret ?? "s",
  backup: "b",
  ...over,
});

function Seeder({ accounts, seeds }: { accounts?: IOuroAccount[]; seeds?: IStoaChainSeed[] }) {
  const { addAccount } = useOuroAccounts();
  const { addSeed } = useStoaChainSeeds();
  const { isReady } = useCodex();
  React.useEffect(() => {
    if (!isReady) return;
    (accounts ?? []).forEach((a) => void addAccount(a));
    (seeds ?? []).forEach((s) => void addSeed(s));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady]);
  return null;
}

/** Renders the currently-persisted seeds as plain text so specs can assert
 *  on the store's post-submit state without reaching into the store directly. */
function SeedsProbe() {
  const { seeds } = useStoaChainSeeds();
  return (
    <ul data-testid="seeds-probe">
      {seeds.map((s) => (
        <li key={s.id}>{s.seedType}:{s.accounts[0]?.publicKey ?? ""}</li>
      ))}
    </ul>
  );
}

async function renderModal(opts: {
  accounts?: IOuroAccount[];
  seeds?: IStoaChainSeed[];
  onClose?: () => void;
} = {}) {
  const adapter = new MemoryCodexAdapter("dev");
  const onClose = opts.onClose ?? (() => {});
  const utils = render(
    <CodexProvider adapter={adapter}>
      <Seeder accounts={opts.accounts} seeds={opts.seeds} />
      <SeedsProbe />
      <CreateStoaChainSeedModal onClose={onClose} />
    </CodexProvider>,
  );
  await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
  return utils;
}

const seedTypeButton = (name: RegExp) => screen.getByRole("button", { name });
const fillPassword = (value: string) =>
  fireEvent.change(screen.getByPlaceholderText(/enter your password/i), { target: { value } });
const fillName = (value: string) =>
  fireEvent.change(screen.getByPlaceholderText(/my seed/i), { target: { value } });
const addSeedButton = () => screen.getByRole("button", { name: /^add seed$/i }) as HTMLButtonElement;

describe("<CreateStoaChainSeedModal>", () => {
  describe("Chainweaver/EckoWallet collapse", () => {
    it("offers exactly one Chainweaver/EckoWallet option, not two separate ones", async () => {
      await renderModal();
      // Exactly one seed-type button matches the family; "EckoWallet" alone
      // (as a standalone option label) must not exist as its own choice.
      expect(screen.getAllByRole("button", { name: /chainweaver/i })).toHaveLength(1);
      expect(screen.queryByRole("button", { name: /^eckowallet$/i })).toBeNull();
      // Exactly 3 seed-type choices total: Koala, Chainweaver/EckoWallet, Stoa Dalos.
      expect(seedTypeButton(/stoa dalos/i)).toBeTruthy();
      expect(seedTypeButton(/koala/i)).toBeTruthy();
    });
  });

  describe("wallet-type ordering & defaults (UI refinement)", () => {
    it("renders the wallet-type options in order: Koala, Stoa Dalos, then Chainweaver/EckoWallet", async () => {
      await renderModal();
      const labels = screen
        .getAllByRole("button", { name: /^koala|^stoa dalos|^chainweaver/i })
        .map((b) => b.textContent ?? "");
      expect(labels[0]).toMatch(/^koala/i);
      expect(labels[1]).toMatch(/^stoa dalos/i);
      expect(labels[2]).toMatch(/^chainweaver/i);
    });

    // Intentional behavior change (was "koala"): Stoa Dalos should be
    // pre-selected when the modal opens. Verified indirectly via Stoic-only
    // UI (its own sub-mode toggle, no generate/restore mode toggle) being
    // present without clicking the "Stoa Dalos" button first.
    it("defaults the selected wallet type to Stoa Dalos, not Koala", async () => {
      await renderModal();
      expect(screen.queryByRole("button", { name: /generate new/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /restore existing/i })).toBeNull();
      expect(screen.getByRole("button", { name: /enter new seed words/i })).toBeTruthy();
      expect(screen.getByRole("button", { name: /use existing ouronet seed/i })).toBeTruthy();
    });

    it("renders the Stoic sub-mode toggle with 'Enter new seed words' first, 'Use existing Ouronet seed' second", async () => {
      await renderModal();
      const buttons = screen.getAllByRole("button", {
        name: /^enter new seed words$|^use existing ouronet seed$/i,
      });
      expect(buttons[0].textContent).toMatch(/enter new seed words/i);
      expect(buttons[1].textContent).toMatch(/use existing ouronet seed/i);
    });

    // Intentional behavior change (was "existing"): the newly-first-listed
    // sub-mode option ("Enter new seed words") should also be the default.
    it("defaults the Stoic sub-mode to 'new' (type seed words), not 'existing'", async () => {
      await renderModal();
      expect(screen.getByPlaceholderText(/type brand-new dalos seed words/i)).toBeTruthy();
      expect(screen.queryByRole("listbox", { name: /ouronet account/i })).toBeNull();
    });
  });

  describe("Stoa Dalos — new seed words", () => {
    it("previews Key #0 for valid seed words and persists seedType: 'stoic' on submit", async () => {
      await renderModal();
      fireEvent.click(seedTypeButton(/stoa dalos/i));
      fireEvent.click(screen.getByRole("button", { name: /enter new seed words/i }));

      const textarea = screen.getByPlaceholderText(/type brand-new dalos seed words/i);
      fireEvent.change(textarea, { target: { value: VALID_WORDS } });

      await screen.findByText(/key #0 preview/i);

      fillName("My Stoa Dalos Seed");
      fillPassword(PASSWORD);

      await waitFor(() => expect(addSeedButton().disabled).toBe(false));
      fireEvent.click(addSeedButton());

      // encryptStringV2's KDF is deliberately slow (~1-2s) — give it room.
      await waitFor(
        () => {
          const probe = screen.getByTestId("seeds-probe");
          expect(within(probe).getByText(/^stoic:/)).toBeTruthy();
        },
        { timeout: 10000 },
      );
    }, 15000);

    it("blocks submission and shows a notice when seed words exceed the 256-word maximum", async () => {
      await renderModal();
      fireEvent.click(seedTypeButton(/stoa dalos/i));
      fireEvent.click(screen.getByRole("button", { name: /enter new seed words/i }));

      const tooMany = Array.from({ length: 257 }, (_, i) => `w${i}`).join(" ");
      const textarea = screen.getByPlaceholderText(/type brand-new dalos seed words/i);
      fireEvent.change(textarea, { target: { value: tooMany } });

      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toMatch(/256/);
      expect(addSeedButton().disabled).toBe(true);
      expect(screen.queryByText(/key #0 preview/i)).toBeNull();
    });

    it("blocks submission and shows a notice when a word contains a character outside the DALOS alphabet", async () => {
      await renderModal();
      fireEvent.click(seedTypeButton(/stoa dalos/i));
      fireEvent.click(screen.getByRole("button", { name: /enter new seed words/i }));

      const textarea = screen.getByPlaceholderText(/type brand-new dalos seed words/i);
      fireEvent.change(textarea, { target: { value: "alpha !!!notallowed!!!" } });

      expect(await screen.findByRole("alert")).toBeTruthy();
      expect(addSeedButton().disabled).toBe(true);
      expect(screen.queryByText(/key #0 preview/i)).toBeNull();
    });
  });

  describe("Stoa Dalos — existing Ouronet seed", () => {
    it("lists only dalos-curve, seedWords-origin accounts — excludes bitString-origin and apollo-origin accounts", async () => {
      const eligible = ouroFx({
        id: "eligible",
        name: "Eligible Account",
        originCurve: "dalos",
        originMode: "seedWords",
        secret: await smartEncrypt(VALID_WORDS, PASSWORD, "1.0"),
      });
      const bitStringOrigin = ouroFx({
        id: "bitstring-acct",
        name: "BitString Account",
        originCurve: "dalos",
        originMode: "bitString",
        secret: await smartEncrypt("0".repeat(1600), PASSWORD, "1.0"),
      });
      const apolloOrigin = ouroFx({
        id: "apollo-acct",
        name: "Apollo Account",
        originCurve: "apollo",
        originMode: "seedWords",
        secret: await smartEncrypt(VALID_WORDS, PASSWORD, "1.0"),
      });

      await renderModal({ accounts: [eligible, bitStringOrigin, apolloOrigin] });
      fireEvent.click(seedTypeButton(/stoa dalos/i));
      // "new" is the default sub-mode now — switch to "existing" explicitly.
      fireEvent.click(screen.getByRole("button", { name: /use existing ouronet seed/i }));
      const listbox = await screen.findByRole("listbox", { name: /ouronet account/i });

      expect(within(listbox).getByText("Eligible Account")).toBeTruthy();
      expect(within(listbox).queryByText("BitString Account")).toBeNull();
      expect(within(listbox).queryByText("Apollo Account")).toBeNull();
    });

    it("previews Key #0 after selecting an eligible account and persists seedType: 'stoic' on submit", async () => {
      const eligible = ouroFx({
        id: "eligible",
        name: "Eligible Account",
        originCurve: "dalos",
        originMode: "seedWords",
        secret: await smartEncrypt(VALID_WORDS, PASSWORD, "1.0"),
      });

      await renderModal({ accounts: [eligible] });
      fireEvent.click(seedTypeButton(/stoa dalos/i));
      // "new" is the default sub-mode now — switch to "existing" explicitly.
      fireEvent.click(screen.getByRole("button", { name: /use existing ouronet seed/i }));
      fireEvent.click(await screen.findByText("Eligible Account"));
      fillPassword(PASSWORD);

      await screen.findByText(/key #0 preview/i);

      fillName("From Existing");
      await waitFor(() => expect(addSeedButton().disabled).toBe(false));
      fireEvent.click(addSeedButton());

      // encryptStringV2's KDF is deliberately slow (~1-2s) — give it room.
      await waitFor(
        () => {
          const probe = screen.getByTestId("seeds-probe");
          expect(within(probe).getByText(/^stoic:/)).toBeTruthy();
        },
        { timeout: 10000 },
      );
    }, 15000);

    it("shows only the account's name in the picker, not its address", async () => {
      const eligible = ouroFx({
        id: "eligible",
        name: "Eligible Account",
        address: "Ѻ.unique-address-should-not-render",
        originCurve: "dalos",
        originMode: "seedWords",
        secret: await smartEncrypt(VALID_WORDS, PASSWORD, "1.0"),
      });

      await renderModal({ accounts: [eligible] });
      fireEvent.click(seedTypeButton(/stoa dalos/i));
      fireEvent.click(screen.getByRole("button", { name: /use existing ouronet seed/i }));
      const listbox = await screen.findByRole("listbox", { name: /ouronet account/i });

      expect(within(listbox).getByText("Eligible Account")).toBeTruthy();
      expect(screen.queryByText("Ѻ.unique-address-should-not-render")).toBeNull();
    });

    it("filters the picker's visible accounts by name as the user types, and restores the full list when the search is cleared", async () => {
      const alice = ouroFx({
        id: "a1",
        name: "Alice's Wallet",
        address: "Ѻ.alice",
        originCurve: "dalos",
        originMode: "seedWords",
        secret: await smartEncrypt(VALID_WORDS, PASSWORD, "1.0"),
      });
      const bob = ouroFx({
        id: "a2",
        name: "Bob's Wallet",
        address: "Ѻ.bob",
        originCurve: "dalos",
        originMode: "seedWords",
        secret: await smartEncrypt(VALID_WORDS, PASSWORD, "1.0"),
      });

      await renderModal({ accounts: [alice, bob] });
      fireEvent.click(seedTypeButton(/stoa dalos/i));
      fireEvent.click(screen.getByRole("button", { name: /use existing ouronet seed/i }));
      await screen.findByRole("listbox", { name: /ouronet account/i });

      const search = screen.getByPlaceholderText(/search accounts/i);
      fireEvent.change(search, { target: { value: "ali" } });

      expect(screen.getByText("Alice's Wallet")).toBeTruthy();
      expect(screen.queryByText("Bob's Wallet")).toBeNull();

      fireEvent.change(search, { target: { value: "" } });

      expect(screen.getByText("Alice's Wallet")).toBeTruthy();
      expect(screen.getByText("Bob's Wallet")).toBeTruthy();
    });

    it("shows a distinct 'no accounts match' message when the search matches nothing, not the DALOS-eligibility empty-state copy", async () => {
      const eligible = ouroFx({
        id: "eligible",
        name: "Eligible Account",
        originCurve: "dalos",
        originMode: "seedWords",
        secret: await smartEncrypt(VALID_WORDS, PASSWORD, "1.0"),
      });

      await renderModal({ accounts: [eligible] });
      fireEvent.click(seedTypeButton(/stoa dalos/i));
      fireEvent.click(screen.getByRole("button", { name: /use existing ouronet seed/i }));
      await screen.findByRole("listbox", { name: /ouronet account/i });

      const search = screen.getByPlaceholderText(/search accounts/i);
      fireEvent.change(search, { target: { value: "zzz-no-such-account" } });

      expect(await screen.findByText(/no accounts match/i)).toBeTruthy();
      expect(screen.queryByText(/no compatible ouronet accounts found/i)).toBeNull();
      expect(screen.queryByRole("listbox", { name: /ouronet account/i })).toBeNull();
    });
  });
});
