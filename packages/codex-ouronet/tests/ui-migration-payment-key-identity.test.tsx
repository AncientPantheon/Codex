/**
 * WHOSE payment key the eligibility wizard's step 3A is actually about.
 *
 * Owner-reported, found on a REAL codex and verified by decrypting that
 * codex's own export:
 *
 *  - the Ouronet account's actual on-chain payment key is
 *    `k:e20f2672…f231` — {@link KOALA_KEY0}, position 0 of the NON-prime
 *    koala seed ("OriginalKoala");
 *  - `seeds[0]` is "Prime Codex Seed" (stoic, `isPrime: true`), whose own
 *    position 0 is {@link PRIME_STOIC_KEY0} — a completely different key.
 *
 * `currentPaymentKeyOf` read `seeds[0].accounts[index === 0].publicKey`,
 * POSITIONALLY, and never consulted the account whose payment key it
 * claimed to report. So on that codex the wizard printed the stoic key as
 * "Current payment key", captioned *"Held in this codex as Master Chainweb
 * Seed - Key #0"* — a false statement about that account — and, because
 * the "SETTLED FOR" value for a kept key is the same expression, CURRENT
 * and SETTLED rendered identical and the whole step looked like a no-op
 * while a real rotation was owed.
 *
 * It was never only cosmetic: the same expression feeds `runFinalize`'s
 * Write 3, so a `"keep"` choice locked the WRONG key non-removable via
 * `secureMasterAccount` and recorded it in `recordMigrationCommit`. That
 * half is pinned in `ui-legacy-prime-migration-wizard.test.tsx`'s own
 * Page-7 suite (where the commit helpers live); this file pins the
 * identity the user can SEE, plus the derivation label the owner's
 * screenshot caught lying for the same reason ("This key's own
 * derivation: Stoic Dalos" over a Koala-derived key).
 *
 * The real source of truth is the ACCOUNT's own registered payment key,
 * `IOuroAccount.stoaChainLedger`, normalised by stripping a leading `k:`
 * (`state/store.ts:2680` writes a stoic seed's ledger bare and every
 * other seed's with the sigil, so it must be read bare — the same rule
 * `ui/internal/outstandingKeyChanges.ts` was corrected to).
 *
 * ## No `vi.mock` anywhere in this file, deliberately
 *
 * Every dependency this wizard has that the fixture needs to control is
 * already an injected PROP (`allSeeds`, `allAccounts`,
 * `currentPrimeAccount`, `describeKeyset`, `pureKeypairs`), and the
 * crypto is REAL — `encryptStringV2` writes the account secret the
 * component then genuinely decrypts, so the derived position-0 key this
 * file compares against is the real one. The only thing stubbed is
 * `globalThis.fetch`, which is the package's own established "no real
 * network" convention (`mockup-local-dry-run-failover-client.test.ts`):
 * the chosen account carries a real `Ѻ.`-prefixed DALOS address, so
 * `useAccountChainData` genuinely fires its URC_01 read, and a throwing
 * `fetch` is what keeps that read off the network while leaving the
 * component's own failure handling exactly as it ships.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, within, cleanup } from "@testing-library/react";
import { seedWordsToBitString } from "@ouronet/dalos-crypto/gen1";
import { encryptStringV2 } from "@stoachain/stoa-core/crypto";
import { CodexProvider, useCodexStore } from "@ancientpantheon/codex-ouronet/provider";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import { LegacyPrimeMigrationWizard } from "../src/ui/internal/LegacyPrimeMigrationWizard.js";
import { deriveStoaDalosKeypairAtIndex } from "../src/wallet/stoaDalosKeygen.js";
import type { IOuroAccount, IStoaChainSeed } from "../src/types/entities.js";

const PASSWORD = "payment-key-identity-test-pw";
const WORDS = "river stone ember";
const BITS = seedWordsToBitString(WORDS.split(" "));
/** What "derive a new one" really produces from this account's words. */
const DERIVED_KEY0 = deriveStoaDalosKeypairAtIndex(BITS, 0).publicKey;

/**
 * `seeds[0]`'s position 0 on the owner's codex — the key the wizard used
 * to print as "Current payment key". Quoted to the 46 hex digits the
 * owner's report carries (`225eb6d1b11f637b7f6014d9dd4ad5630d157540ef0fc4…`)
 * and zero-padded to a full 64-hex key: what matters about it is only that
 * it is NOT the account's own, and nothing here derives it.
 */
const PRIME_STOIC_KEY0 = "225eb6d1b11f637b7f6014d9dd4ad5630d157540ef0fc4" + "0".repeat(18);
/** The account's ACTUAL on-chain payment key, verbatim from the owner's
 *  decrypted export: `OriginalKoala` key #0, the non-prime koala seed. */
const KOALA_KEY0 = "e20f267264634c5bc76e15dd5a9df6703fc3c06726e7674aa6217edeb064f231";

/** The owner's own two-seed shape: the prime stoic seed FIRST (so a
 *  positional read lands on it), the koala seed that really backs the
 *  account second. */
const seeds: IStoaChainSeed[] = [
  {
    id: "prime-codex-seed", name: "Prime Codex Seed", seedType: "stoic", version: "1.0.0",
    index: 0, secret: "ct-stoic", main: "", createdAt: "2026-11-01T10:00:00.000Z",
    isPrime: true,
    accounts: [
      { index: 0, publicKey: PRIME_STOIC_KEY0, derivationPath: "m/0" },
      { index: 1, publicKey: "1".repeat(64), derivationPath: "m/1" },
    ],
  },
  {
    id: "original-koala", name: "OriginalKoala", seedType: "koala", version: "1.0.0",
    index: 1, secret: "ct-koala", main: "k:" + KOALA_KEY0,
    createdAt: "2026-11-02T10:00:00.000Z", isPrime: false,
    accounts: [{ index: 0, publicKey: KOALA_KEY0, derivationPath: "m/0" }],
  },
];

let store: ReturnType<typeof useCodexStore> | null = null;
function Grab(): null {
  store = useCodexStore();
  return null;
}

/** The owner's account: a real DALOS address, and a `stoaChainLedger`
 *  carrying the koala key WITH the `k:` sigil — exactly the form
 *  `store.ts:2680` writes for every non-stoic seed. */
async function ownerAccount(): Promise<IOuroAccount> {
  return {
    version: "1.0", isSmart: false, address: "Ѻ.AncientHodler", guard: null,
    stoaChainLedger: "k:" + KOALA_KEY0,
    publicKey: "pub-ouronet-master",
    secret: await encryptStringV2(WORDS, PASSWORD),
    backup: "ct", originSeedTab: "write-seed",
    id: "ouronet-master", name: "AncientHodler",
  };
}

/** Renders the wizard over a real store and walks intro -> account
 *  ("keep your current account") -> payment, the way a user does. */
async function openPaymentStep(): Promise<void> {
  const account = await ownerAccount();
  store = null;
  render(
    <CodexProvider adapter={new MemoryCodexAdapter("dev")}>
      <Grab />
      <LegacyPrimeMigrationWizard
        open
        onClose={() => {}}
        currentPrimeAccount={account}
        allAccounts={[account]}
        allSeeds={seeds}
        pureKeypairs={[]}
      />
    </CodexProvider>,
  );
  await waitFor(() => expect(store!.getState().ready).toBe(true));
  act(() => { store!.getState().actions.authenticate(PASSWORD, 60); });
  fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // intro -> account
  const keep = await screen.findByTestId("legacy-prime-migration-account-option-keep");
  fireEvent.click(within(keep).getByRole("button", { name: /keep your current account/i }));
  fireEvent.click(screen.getByTestId("legacy-prime-migration-continue")); // account -> payment
  await screen.findByTestId("legacy-prime-migration-payment-section");
}

const chooseKeep = (): void => {
  fireEvent.click(
    within(screen.getByTestId("legacy-prime-migration-payment-option-keep")).getByRole("button"),
  );
};

let realFetch: typeof globalThis.fetch;
beforeEach(() => {
  realFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    throw new Error("no network in this spec");
  }) as unknown as typeof globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  cleanup();
});

describe("step 3A — the CURRENT payment key is the chosen account's own", () => {
  it("reports the account's registered payment key (the koala key), not seeds[0]'s position 0", async () => {
    await openPaymentStep();
    const current = screen.getByTestId("legacy-prime-migration-payment-current");
    // `KeyLine`/`MeasuredHexHighlight` truncate for display and carry the
    // full value on `title`, so assert the TITLE — a truncated prefix
    // would match both keys' first characters otherwise.
    expect(current.querySelector(`[title="${KOALA_KEY0}"]`)).toBeTruthy();
    expect(current.querySelector(`[title="${PRIME_STOIC_KEY0}"]`)).toBeNull();
  });

  it("captions it with the seed that really holds it (OriginalKoala #0), not the Master Chainweb Seed", async () => {
    await openPaymentStep();
    const ties = screen.getByTestId("legacy-prime-migration-payment-ties").textContent ?? "";
    expect(ties).toMatch(/OriginalKoala/);
    expect(ties).toMatch(/Key #0/);
    expect(ties).not.toMatch(/Master Chainweb Seed/);
  });

  // The symptom that made the bug look harmless: with CURRENT read off the
  // same seed position the derive option settles on, the two boxes could
  // show the SAME key and the step read as a no-op. Here a rotation really
  // is owed, so the two sides must differ — and the SETTLED side must be
  // the key genuinely derived from this account's words.
  it("CURRENT and SETTLED FOR are different keys when a rotation is genuinely owed", async () => {
    await openPaymentStep();
    await waitFor(() => {
      expect(
        screen.getByTestId("legacy-prime-migration-payment-to")
          .querySelector(`[title="${DERIVED_KEY0}"]`),
      ).toBeTruthy();
    });
    expect(
      screen.getByTestId("legacy-prime-migration-payment-current")
        .querySelector(`[title="${KOALA_KEY0}"]`),
    ).toBeTruthy();
    expect(DERIVED_KEY0).not.toBe(KOALA_KEY0);
  });

  it("the 'keep' SETTLED FOR box restates the account's own key, and calls it a Koala key", async () => {
    await openPaymentStep();
    chooseKeep();
    const settled = screen.getByTestId("legacy-prime-migration-payment-settled");
    expect(settled.querySelector(`[title="${KOALA_KEY0}"]`)).toBeTruthy();
    expect(settled.textContent ?? "").toMatch(/koala/i);
    expect(settled.textContent ?? "").not.toMatch(/stoic dalos/i);
  });
});

describe("step 3A — the kept key's DERIVATION label", () => {
  // Owner's screenshot: option 2 ("Keep the current payment key") was
  // captioned *"This key's own derivation: Stoic Dalos"*. The label itself
  // was never wrong — `detectPaymentKeyOrigin` correctly classified the key
  // it was HANDED. It was handed the prime stoic seed's key, so it reported
  // Stoic Dalos about a Koala-derived key. Same cause, no separate fix.
  it("names the kept key's real origin (Koala), not the prime stoic seed's", async () => {
    await openPaymentStep();
    chooseKeep();
    const origin = screen.getByTestId("legacy-prime-migration-payment-keep-origin").textContent ?? "";
    expect(origin).toMatch(/koala/i);
    expect(origin).not.toMatch(/stoic dalos/i);
    expect(screen.queryByTestId("legacy-prime-migration-payment-keep-origin-warning")).toBeNull();
  });

  it("relabels the derivation-method option to 'Koala Derivation' once that key is kept", async () => {
    await openPaymentStep();
    chooseKeep();
    const method = screen.getByTestId("legacy-prime-migration-keys-option-stoic-dalos");
    await waitFor(() => {
      expect(within(method).getByText("Koala Derivation")).toBeTruthy();
    });
    expect(within(method).queryByText("Stoic Dalos Derivation")).toBeNull();
  });
});

describe("step 3A — when the account has no payment key on record", () => {
  // `IOuroAccount` types `stoaChainLedger` as `string | null`, and the
  // legacy/imported accounts this wizard exists to rescue really do carry
  // it absent (the hazard `seedDashboard.ts:146-155` documents from live
  // testing). There is then NO honest answer to "what is this account's
  // current payment key" — and the positional guess is precisely what this
  // fix removed, so the screen must say so rather than name some other
  // seed's key. `runFinalize` passing `null` on through is the defined
  // "unresolved" value there (`masterKeyLockDelta.ts`): it suppresses
  // releasing existing locks and adds none, never locks a wrong key.
  it("says so, instead of naming a key from some other seed", async () => {
    const account = { ...(await ownerAccount()), stoaChainLedger: null };
    store = null;
    render(
      <CodexProvider adapter={new MemoryCodexAdapter("dev")}>
        <Grab />
        <LegacyPrimeMigrationWizard
          open
          onClose={() => {}}
          currentPrimeAccount={account}
          allAccounts={[account]}
          allSeeds={seeds}
          pureKeypairs={[]}
        />
      </CodexProvider>,
    );
    await waitFor(() => expect(store!.getState().ready).toBe(true));
    act(() => { store!.getState().actions.authenticate(PASSWORD, 60); });
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue"));
    const keep = await screen.findByTestId("legacy-prime-migration-account-option-keep");
    fireEvent.click(within(keep).getByRole("button", { name: /keep your current account/i }));
    fireEvent.click(screen.getByTestId("legacy-prime-migration-continue"));
    const section = await screen.findByTestId("legacy-prime-migration-payment-section");

    expect(screen.getByTestId("legacy-prime-migration-payment-current-none")).toBeTruthy();
    expect(screen.queryByTestId("legacy-prime-migration-payment-current")).toBeNull();
    expect(section.querySelector(`[title="${PRIME_STOIC_KEY0}"]`)).toBeNull();
  });
});
