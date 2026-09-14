// ============================================================================
// RED SPEC (T15.5) — the PG-01 render matrix: the wired Foreign Chains tab +
// the Arweave subtab + the 5 ArweavePanel areas rendered against the MOCK
// adapter + injected fake seams, with NO real key and NO network.
//
// These tests DRIVE the not-yet-existing GREEN wiring (T15.4):
//   - `../src/mockArweaveAdapter`   — the mock ForeignChainAdapter + fake seams
//   - `../src/ForeignChainsWiring`  — builds the registry, wires
//                                     foreignChainPanels[ARWEAVE_CHAIN_ID] =
//                                     ArweavePanel, provides the panel context
// so the dominant RED failure is "module ../src/ForeignChainsWiring does not
// exist" (right reason) — NOT a harness/fixture/alias resolution error (the
// T15.2 aliases + T15.3 fixtures + the E4 seams must all resolve cleanly).
//
// The mock adapter returns a FIXED fake Winston balance of 1_500_000_000_000n,
// no-network anchor the balance-area assertion drives off (NOT a hardcoded
// literal unrelated to the input).
// ============================================================================

import { describe, it, expect, afterEach, vi } from "vitest";
import { useEffect } from "react";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { ARWEAVE_CHAIN_ID } from "@ancientpantheon/codex-arweave/address-book";
import { CodexProvider, useCodexStore } from "@ancientpantheon/codex-ouronet/provider";
import { useCodexAuth } from "@ancientpantheon/codex-ouronet/hooks";
import type { CodexSnapshot } from "@ancientpantheon/codex-ouronet/adapters";

import { hydrateFromPlaintextSnapshot } from "../src/loadCodex";
import {
  emptySnapshot,
  throwawayArweaveKeyfile,
} from "../fixtures/index.js";
import type { GatewayPool } from "@ancientpantheon/arweave-core";
import { buildRealPanelDeps } from "../src/realArweaveAdapter";
import { DEFAULT_GATEWAY_URL } from "../src/ArweaveModeToggle";

// The not-yet-existing GREEN wiring (T15.4). Importing it is what makes this
// file RED until T15.4 lands. `ForeignChainsWiring` mounts the generic
// ForeignChainsTab wired with the mock Arweave adapter + the fake panel context.
import { ForeignChainsWiring } from "../src/ForeignChainsWiring";

/** The chain rail renders ids Capitalised for display ("arweave" -> "Arweave"),
 *  so match the id case-insensitively rather than hardcoding the display form —
 *  the id stays the single source of truth. */
const railName = (id: string) => new RegExp(`^${id}$`, "i");


afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Test-only unlock helper: calls the REAL `useCodexAuth().authenticate` on
 *  mount so a test can drive a seam gated on `getCurrentPassword()` (e.g. Quick
 *  Define's account-secret reveal, or the seed-persist path) without a UI
 *  unlock screen — `ForeignChainsWiring` mounts no lock gate of its own (that
 *  gate lives in `App.tsx`, which this harness never mounts). `authenticate`
 *  never validates the password against anything; it only seeds the cache. */
function AutoUnlock({ password }: { password: string }): null {
  const { authenticate } = useCodexAuth();
  useEffect(() => {
    authenticate(password);
  }, [authenticate, password]);
  return null;
}

/** Test-only probe: hands the mounted zustand store instance out to the test
 *  via a ref, so an assertion can read `store.getState().foreignKeys` DIRECTLY
 *  — the real persisted slice — rather than only through the Accounts view,
 *  which also shows a same-session `sessionKeys` OVERLAY (`ArweavePanel`'s
 *  own optimistic local state). The overlay would keep showing a generated key
 *  even if the real `addForeignKey` store action were a dropped/inert stub, so
 *  it alone cannot prove the key reached the store — this probe can. */
function StoreProbe({ storeRef }: { storeRef: { current: ReturnType<typeof useCodexStore> | null } }): null {
  const store = useCodexStore();
  storeRef.current = store;
  return null;
}

/** Mount the wiring inside the REAL <CodexProvider> against a plaintext-hydrated
 *  store (the `hydrateFromPlaintextSnapshot` dev/test seam, as the PG-03 smoke
 *  does). The provider is REQUIRED: the wiring now reads the codex address book
 *  out of the mounted store to feed the panel's Send recipient seam, so a
 *  provider-less mount is no longer a representative render.
 *
 *  T9 moved the CodexTabs SHELL into the wiring, so what mounts here is the whole
 *  three-Class tab strip landing on Ouronet Accounts — the rail lives inside
 *  Class 2 and is reached by selecting `Blockchain Accounts`, exactly as a user
 *  does in the app.
 *
 *  `unlockPassword`, when supplied, mounts {@link AutoUnlock} alongside the
 *  wiring so the codex is unlocked BEFORE any test interaction — additive and
 *  opt-in: every existing caller that omits it renders exactly as before,
 *  locked, which is what the define-via-words tests intentionally exercise.
 *
 *  `storeRef`, when supplied, mounts {@link StoreProbe} so a test can read the
 *  mounted store's state directly after driving the UI — also additive/opt-in. */
async function renderWiring(
  snapshot: CodexSnapshot = emptySnapshot,
  unlockPassword?: string,
  storeRef?: { current: ReturnType<typeof useCodexStore> | null },
) {
  const user = userEvent.setup();
  const adapter = await hydrateFromPlaintextSnapshot(snapshot);
  render(
    <CodexProvider adapter={adapter} deviceVariant="dev">
      {unlockPassword !== undefined && <AutoUnlock password={unlockPassword} />}
      {storeRef !== undefined && <StoreProbe storeRef={storeRef} />}
      <ForeignChainsWiring />
    </CodexProvider>,
  );
  await user.click(
    await screen.findByRole("tab", { name: /blockchain accounts/i }),
  );
  return { user };
}

/** Render the wired Foreign Chains tab and select the Arweave rail entry.
 *  Returns the user-event handle so each test can drive the panel's categories. */
async function renderWiredForeignChainsTab(
  snapshot?: CodexSnapshot,
  unlockPassword?: string,
  storeRef?: { current: ReturnType<typeof useCodexStore> | null },
) {
  const { user } = await renderWiring(snapshot, unlockPassword, storeRef);
  // The rail dispatches an Arweave entry keyed by ARWEAVE_CHAIN_ID (the generic
  // tab is id-blind — the id text on the rail entry IS the chain id string).
  const arweaveTab = await screen.findByRole("tab", { name: railName(ARWEAVE_CHAIN_ID) });
  await user.click(arweaveTab);
  return { user };
}

describe("PG-01 — the wired Foreign Chains tab dispatches the Arweave subtab", () => {
  it("renders a subtab keyed by ARWEAVE_CHAIN_ID (dispatched from the injected foreignChains list)", async () => {
    await renderWiring();
    // The subtab label is the injected id (the generic strip renders `id`), so a
    // tab named ARWEAVE_CHAIN_ID proves the mock adapter's id reached the list.
    expect(
      await screen.findByRole("tab", { name: railName(ARWEAVE_CHAIN_ID) }),
    ).toBeInTheDocument();
  });

  it("renders the ArweavePanel when the Arweave subtab is selected", async () => {
    await renderWiredForeignChainsTab();
    // The panel roots a `data-testid="arweave-panel"` node carrying the chain id
    // — selecting the subtab dispatched the ArweavePanel into the slot.
    const panel = await screen.findByTestId("arweave-panel");
    expect(panel).toHaveAttribute("data-chain-id", ARWEAVE_CHAIN_ID);
  });
});

describe("PG-01 — the Class 2 rail carries BOTH blockchains (Chainweb + Arweave)", () => {
  it("lists a chainweb rail entry and mounts the Chainweb panel's category strip when it is selected", async () => {
    // WHY: T5 removed Seed Words / Pure Key Pairs / Stoa Accounts from the Codex
    // top level — they are now only reachable through Class 2's Chainweb panel.
    // If the playground's wiring contributes Arweave alone, those three surfaces
    // are unreachable in the playground and Class 2 is half-mounted.
    const { user } = await renderWiring();

    await user.click(await screen.findByRole("tab", { name: railName("chainweb") }));

    const panel = await screen.findByTestId("chainweb-panel");
    // The Class IA spine: Seeds · Pure Keys · Accounts, from the panel itself.
    expect(within(panel).getByTestId("chainweb-subtab-seeds")).toBeInTheDocument();
    expect(within(panel).getByTestId("chainweb-subtab-pure-keys")).toBeInTheDocument();
    expect(within(panel).getByTestId("chainweb-subtab-accounts")).toBeInTheDocument();
  });

  it("lands on the Arweave panel (the chain this wiring's adapter backs) before any rail click", async () => {
    // The rail's FIRST id is the selected one; Arweave leads because it is the
    // registry-registered adapter. A regression that reorders the rail would
    // silently change the landing panel.
    await renderWiring();
    expect(await screen.findByTestId("arweave-panel")).toBeInTheDocument();
  });
});

// ── REMOVED: the per-area mock composition specs ─────────────────────────────
// ArweavePanel no longer mounts KeyringArea / BalanceArea / SendArea /
// UploadArea / LibraryArea — every Arweave category is now an explicit empty
// placeholder pending real per-category wiring (Seeds first). The blocks that
// stood here drove those mock areas THROUGH the panel:
//   · the 5 ArweavePanel areas render against the mock adapter + fakes
//   · no real key / no network while rendering the panel + all 5 areas
//   · a saved Arweave Address Book entry is selectable as a Send recipient
// Each area component still exists with its own direct spec in codex-arweave
// (tests/e4-panel-*.test.tsx). Re-add a composition spec per category as that
// category is wired for real.


/** A gateway pool that never reaches the network — this spec drives the keygen
 *  seam only, so any real gateway call would be a defect, not a dependency. */
const offlinePool = {
  pick: () => DEFAULT_GATEWAY_URL,
  report: () => {},
} as unknown as GatewayPool;

/**
 * A fake `WorkerLike` standing in for the real keygen worker. It answers the
 * runner's start message with one coarse `progress` tick and then `done`,
 * carrying the throwaway keyfile as the payload — so the assertion below reads
 * the JWK back out of the message protocol rather than from a literal. This is
 * what proves the seam is a REAL `createWorkerKeygenRunner` and not the old
 * main-thread no-op that threw "unsupported".
 */
class FakeKeygenWorker {
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  terminated = false;

  postMessage(): void {
    // Reply asynchronously, like a real worker, so the runner's promise wiring
    // (rather than a synchronous shortcut) is what is under test.
    queueMicrotask(() => {
      this.onmessage?.({ data: { kind: "progress", state: { state: "working" } } });
      this.onmessage?.({
        data: { kind: "done", jwk: throwawayArweaveKeyfile },
      });
    });
  }

  terminate(): void {
    this.terminated = true;
  }
}

describe("PG-02 — real-mode keygen runs through an off-main-thread worker", () => {
  it("drives the injected worker and resolves the generated key instead of throwing 'unsupported'", async () => {
    // WHY: real mode used to supply a main-thread no-op runner that THREW on
    // use, so Arweave → Pure Keys → create was dead in the playground. The seam
    // must now be a real `createWorkerKeygenRunner`, which is only provable by
    // driving it: a regression back to the no-op rejects here.
    const worker = new FakeKeygenWorker();
    const deps = buildRealPanelDeps({
      gatewayUrl: DEFAULT_GATEWAY_URL,
      pool: offlinePool,
      workerFactory: () => worker as unknown as Worker,
    });

    const progress: string[] = [];
    const jwk = await deps.keygenRunner.runKeygen((p) => progress.push(p.state));

    // The key came back over the worker's `done` message (driven from the fake
    // worker's payload, not a hardcoded literal).
    expect(jwk.n).toBe(throwawayArweaveKeyfile.n);
    // Coarse progress was forwarded to the panel — this is what keeps the tab
    // strip responsive instead of a frozen main thread.
    expect(progress).toContain("working");
    // The worker is released once the run settles (no leaked worker per keygen).
    expect(worker.terminated).toBe(true);
  });
});

describe("PG-01 — id-blind gate: the generic tab source carries no 'arweave' literal", () => {
  it("has no hardcoded 'arweave' string in the codex-ui ForeignChainsTab source", () => {
    // The chain id literal lives ONLY in the app's mock/wiring (and the codex-
    // arweave address-book const) — never in the GENERIC codex-ui tab, which must
    // dispatch purely off the injected `foreignChains`/`foreignChainPanels` props.
    // A regression that special-cases "arweave" in the generic layer fails here.
    const tabSource = readFileSync(
      resolve(
        __dirname,
        "../../../packages/codex-ui/src/ui/foreign-chains/ForeignChainsTab.tsx",
      ),
      "utf8",
    );
    expect(tabSource).not.toContain("arweave");
  });
});

// ============================================================================
// T8 — the Arweave panel's data seams fed from the REAL codex (E5 / Wave 4).
//
// Two things are under test here, and both are app-wiring concerns (the panel
// and its areas have their own specs in codex-arweave):
//   1. Arweave → Accounts reads the codex's OWN `foreignKeys` slice, so an empty
//      Codex shows the empty state and a populated one shows its real keys. The
//      mock stack used to seed a hardcoded "Mock Arweave key" demo entry, which
//      made an empty Codex look populated — that must never come back.
//   2. Option 2 of the define-seed flow is fed from the codex's Ouronet
//      accounts, filtered to the ACTIVATED, `dalos`-curve ones (Apollo's
//      1024-bit bitstrings are deferred by design — offering one would yield a
//      seed `resolveSeedBitString` refuses).
// ============================================================================

import type { ForeignKeyEntry } from "@ancientpantheon/codex-core";
import type { IOuroAccount } from "@ancientpantheon/codex-ouronet/types";

import { toArweaveSeedAccounts } from "../src/ForeignChainsWiring";

/** A ciphertext-only Arweave keyring entry carrying T2's seed provenance —
 *  the shape the seeded generate flow persists. NOT a real or funded key. */
const codexArweaveKey: ForeignKeyEntry = {
  id: "playground-arweave-key-under-test",
  chainId: ARWEAVE_CHAIN_ID,
  encryptedKeyfile: "throwaway-ciphertext-blob",
  seedId: "arweave-seed-under-test",
  index: 3,
  address: "iN0RZ3rHUxT5YvXlGHtcH1KHm4N4P4UlFf0kKhz8mBQ",
};

/** A foreign key belonging to ANOTHER chain — the slice is chain-agnostic, so
 *  the Arweave panel must filter it out rather than the wiring pre-filtering. */
const otherChainKey: ForeignKeyEntry = {
  id: "playground-other-chain-key",
  chainId: "not-arweave",
  encryptedKeyfile: "throwaway-ciphertext-blob",
};

const snapshotWithForeignKeys: CodexSnapshot = {
  ...emptySnapshot,
  foreignKeys: [codexArweaveKey, otherChainKey],
};

describe("T8 — Arweave Accounts is fed by the REAL codex foreignKeys slice", () => {
  it("shows the empty state — and no demo entry — for a Codex with no Arweave key", async () => {
    // WHY: the mock stack seeded a hardcoded `Mock Arweave key` entry, so a
    // brand-new Codex rendered a populated Accounts list that no seed could
    // reproduce. A regression that re-seeds any fixture entry fails here.
    await renderWiredForeignChainsTab(emptySnapshot);

    const area = await screen.findByTestId("arweave-accounts-area");
    expect(within(area).getByTestId("arweave-accounts-empty")).toBeInTheDocument();
    expect(within(area).queryAllByTestId("arweave-account-row")).toHaveLength(0);
    expect(screen.queryByText(/mock arweave key/i)).not.toBeInTheDocument();
  });

  it("lists the Codex's own Arweave key with its index and address, and no other chain's key", async () => {
    // WHY: Accounts used to read a fake in-module list, so a key the Codex
    // actually holds (or one the seeded generate flow just persisted) was
    // invisible. Both assertions are driven off the hydrated entry, not a
    // literal: the row must carry THAT index and THAT address, and the
    // non-Arweave entry in the same slice must not leak into the Arweave panel.
    await renderWiredForeignChainsTab(snapshotWithForeignKeys);

    const area = await screen.findByTestId("arweave-accounts-area");
    const rows = within(area).getAllByTestId("arweave-account-row");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent(`#${codexArweaveKey.index}`);
    expect(rows[0]).toHaveTextContent(codexArweaveKey.address as string);
    expect(within(area).queryByTestId("arweave-accounts-empty")).not.toBeInTheDocument();
  });
});

/** Minimal `IOuroAccount` fixtures for the Option-2 source filter. Secrets are
 *  throwaway ciphertext placeholders — nothing here is a real account. */
function ouroAccount(overrides: Partial<IOuroAccount> & { id: string; address: string }): IOuroAccount {
  return {
    name: undefined,
    version: "1.2",
    isSmart: false,
    guard: null,
    stoaChainLedger: null,
    publicKey: "throwaway-public-key",
    secret: "throwaway-ciphertext-blob",
    backup: "throwaway-ciphertext-blob",
    ...overrides,
  };
}

describe("T8 — Option 2 sources: ACTIVATED dalos-curve Ouronet accounts only", () => {
  const activatedDalosPrime = ouroAccount({
    id: "ouro-dalos-prime",
    name: "CodexPrime",
    address: "Ѻ.dalos-activated-prime",
    originCurve: "dalos",
    isActive: true,
    isPrime: true,
  });
  const activatedApollo = ouroAccount({
    id: "ouro-apollo",
    name: "Apollo Account",
    address: "₱.apollo-activated",
    originCurve: "apollo",
    isActive: true,
  });
  const unactivatedDalos = ouroAccount({
    id: "ouro-dalos-unactivated",
    address: "Ѻ.dalos-not-activated",
    originCurve: "dalos",
  });

  it("offers the activated dalos account and never the apollo one", () => {
    // WHY: design.md defers Apollo's 1024-bit bitstrings — offering such an
    // account would hand `resolveSeedBitString` 1024 bits, which it refuses
    // rather than pads, so the user would pick a source that cannot work.
    const sources = toArweaveSeedAccounts([
      activatedDalosPrime,
      activatedApollo,
      unactivatedDalos,
    ]);

    expect(sources.map((s) => s.id)).toEqual([activatedDalosPrime.id]);
  });

  it("labels the source from the account and marks CodexPrime as the default", () => {
    // WHY: design.md's Option 2 default is CodexPrime; without the flag the
    // picker opens on an arbitrary account.
    const [source] = toArweaveSeedAccounts([activatedDalosPrime]);

    expect(source.label).toBe(activatedDalosPrime.name);
    expect(source.isDefault).toBe(true);
    expect(source.account).toBe(activatedDalosPrime);
  });

  it("falls back to the address as the label when the account has no name", () => {
    // WHY: a nameless account would otherwise render an empty picker row the
    // user cannot tell apart from another nameless one.
    const nameless = ouroAccount({
      id: "ouro-dalos-nameless",
      address: "Ѻ.dalos-nameless",
      originCurve: "dalos",
      isActive: true,
    });

    expect(toArweaveSeedAccounts([nameless])[0].label).toBe(nameless.address);
  });

  it("offers the prime account even when it is NOT activated, still marked default", () => {
    // WHY: this is the reported bug — a real CodexPrime account can exist
    // without ever having been `isActive` (an on-chain-registration flag
    // unrelated to whether its key material is readable). Requiring activation
    // for the PRIME account too filtered it out of `ouronetAccounts` entirely,
    // leaving `dalosAccounts.find(a => a.isDefault)` empty and Quick Define
    // permanently disabled even though the CodexPrime account exists.
    const unactivatedPrime = ouroAccount({
      id: "ouro-dalos-prime-unactivated",
      name: "CodexPrime",
      address: "Ѻ.dalos-prime-unactivated",
      originCurve: "dalos",
      isActive: false,
      isPrime: true,
    });

    const sources = toArweaveSeedAccounts([unactivatedPrime]);

    expect(sources.map((s) => s.id)).toEqual([unactivatedPrime.id]);
    expect(sources[0].isDefault).toBe(true);
  });

  it("still excludes a NON-prime account that is not activated", () => {
    // WHY: regression guard — the prime carve-out must not quietly relax the
    // activation requirement for every other account too.
    const unactivatedNonPrime = ouroAccount({
      id: "ouro-dalos-non-prime-unactivated",
      address: "Ѻ.dalos-non-prime-unactivated",
      originCurve: "dalos",
      isActive: false,
    });

    expect(toArweaveSeedAccounts([unactivatedNonPrime])).toEqual([]);
  });
});

// ============================================================================
// T? — the Arweave SEED wiring: the three define-seed sources, the unlock-gated
// reveal seams, the seed→keys delete cascade, and the PERSIST path.
//
// These drive the app-side seams `ArweavePanel` forwards to `ArweaveSeedsArea`.
// The area itself is specced in codex-arweave; what is under test here is that
// the PLAYGROUND actually fills them out of the mounted codex — an unfilled seam
// is a dead affordance in the UI (a disabled Generate button, an empty picker,
// or worse: a key generated over minutes of CPU and then dropped on the floor).
// ============================================================================

import { encryptStringV2, smartDecrypt } from "@stoachain/stoa-core/crypto";
import type { IStoaChainSeed } from "@ancientpantheon/codex-ouronet/types";

import { MODE2_LAST_UPDATED_AT, THROWAWAY_ARWEAVE_ADDRESS } from "../fixtures/index.js";
import {
  buildArweaveWiring,
  createRevealAccountSecret,
  createRevealSeedWords,
  createSeedKeyDeleter,
  toArweaveSeedChainwebSources,
  ARWEAVE_WIRING_MODE_MOCK,
} from "../src/ForeignChainsWiring";
import { createArweaveKeyPersistence } from "../src/realArweaveAdapter";

/** A DEV-ONLY test password. Never a real codex password. */
const TEST_PASSWORD = "dev-only-playground-password";

/** A THROWAWAY DALOS-charset phrase — the plaintext behind the fixtures below.
 *  Not a real mnemonic and it backs nothing. */
const TEST_PHRASE = "alpha beta gamma delta";

/** A minimal `IStoaChainSeed`. `secret` is real ciphertext of a THROWAWAY
 *  phrase, so the lazy reveal seam is exercised against real crypto. */
function chainwebSeedFixture(
  overrides: Partial<IStoaChainSeed> & { id: string },
): IStoaChainSeed {
  return {
    name: undefined,
    seedType: "chainweaver",
    version: "1.2",
    index: 0,
    secret: "throwaway-ciphertext-blob",
    main: "throwaway-main",
    createdAt: MODE2_LAST_UPDATED_AT,
    accounts: [],
    ...overrides,
  };
}

describe("Arweave seeds — Option 2 is fed from the mounted codex", () => {
  it("lists the Codex's activated dalos account in the picker and never the apollo one", async () => {
    // WHY: `deps.ouronetAccounts` unwired leaves Option 2 permanently DISABLED
    // in the app ("No activated DALOS-curve Ouronet account exists"), so the
    // user can never seed Arweave from the key material the Codex already holds.
    const dalos = ouroAccount({
      id: "ouro-dalos-wired",
      name: "CodexPrime",
      address: "Ѻ.dalos-wired",
      originCurve: "dalos",
      isActive: true,
      isPrime: true,
    });
    const apollo = ouroAccount({
      id: "ouro-apollo-wired",
      name: "Apollo Account",
      address: "₱.apollo-wired",
      originCurve: "apollo",
      isActive: true,
    });

    const { user } = await renderWiredForeignChainsTab({
      ...emptySnapshot,
      ouroAccounts: [dalos, apollo],
    });

    await user.click(await screen.findByTestId("arweave-subtab-seeds"));
    await user.click(await screen.findByTestId("arweave-seed-custom-define"));
    await user.click(screen.getByTestId("arweave-seed-source-account"));

    const select = screen.getByTestId("arweave-seed-account-select");
    expect(
      within(select).getAllByRole("option").map((o) => o.textContent),
    ).toEqual([dalos.name]);
  });
});

describe("Arweave seeds — Option 3 is fed from the codex's Chainweb seeds", () => {
  it("lists the Codex's Chainweb seeds in the picker, labelled from the seed", async () => {
    // WHY: unwired, Option 3 is disabled ("No Chainweb seed exists in this
    // Codex") even for a Codex whose Prime Codex Seed is right there — the
    // no-typing capture path design.md calls for is simply unreachable.
    //
    // The FIRST seed is the one the store flags as the Prime Codex Seed on load
    // (`store.ts`: a codex with seeds but none flagged gets index 0 promoted),
    // and a prime seed carries no `name` — hence the two expected labels.
    const primeSeed = chainwebSeedFixture({ id: "chainweb-seed-prime-wired" });
    const namedSeed = chainwebSeedFixture({
      id: "chainweb-seed-wired",
      name: "Chainweb Seed Under Test",
    });

    const { user } = await renderWiredForeignChainsTab({
      ...emptySnapshot,
      kadenaSeeds: [primeSeed, namedSeed],
    });

    await user.click(await screen.findByTestId("arweave-subtab-seeds"));
    await user.click(await screen.findByTestId("arweave-seed-custom-define"));
    await user.click(screen.getByTestId("arweave-seed-source-chainweb"));

    const select = screen.getByTestId("arweave-seed-chainweb-select");
    expect(
      within(select).getAllByRole("option").map((o) => o.textContent),
    ).toEqual(["Prime Codex Seed", namedSeed.name]);
  });

  it("labels the prime seed 'Prime Codex Seed' and marks it the default", () => {
    // WHY: design.md's Option 3 default IS the Prime Codex Seed; the prime seed
    // carries no `name`, so without the mapping it would render as a blank row.
    const prime = chainwebSeedFixture({ id: "chainweb-prime", isPrime: true });
    const other = chainwebSeedFixture({ id: "chainweb-other", name: "Second" });

    const [first, second] = toArweaveSeedChainwebSources([prime, other]);

    expect(first).toMatchObject({ id: prime.id, label: "Prime Codex Seed", isDefault: true });
    expect(second).toMatchObject({ id: other.id, label: other.name });
    expect(second.isDefault).toBe(false);
  });
});

describe("Arweave seeds — the unlock-gated reveal seams", () => {
  it("reveals an Ouronet account's decrypted secret, and null for an unknown account", async () => {
    // WHY: Option 2 feeds this plaintext into `bitStringOf`. Handing back the
    // CIPHERTEXT (or throwing) would either derive a wrong 1600-bit seed or
    // blow up the define flow — and a wrong seed means unreproducible RSA keys.
    const account = ouroAccount({
      id: "ouro-reveal",
      address: "Ѻ.reveal",
      originCurve: "dalos",
      isActive: true,
      secret: await encryptStringV2(TEST_PHRASE, TEST_PASSWORD),
    });

    const reveal = createRevealAccountSecret({
      accounts: [account],
      getPassword: () => TEST_PASSWORD,
    });

    await expect(reveal(account.id)).resolves.toBe(TEST_PHRASE);
    await expect(reveal("no-such-account")).resolves.toBeNull();
  }, 30_000);

  it("returns null (never throws) when the codex is locked", async () => {
    // WHY: `getCurrentPassword()` THROWS CodexLockedError on a locked codex. An
    // escaping throw would surface as an unhandled rejection instead of the
    // area's inline "could not read the key material" refusal.
    const reveal = createRevealAccountSecret({
      accounts: [ouroAccount({ id: "ouro-locked", address: "Ѻ.locked" })],
      getPassword: () => {
        throw new Error("codex is locked");
      },
    });

    await expect(reveal("ouro-locked")).resolves.toBeNull();
  });

  it("lazily decrypts a Chainweb seed's mnemonic into its words", async () => {
    // WHY: Option 3 converts WORDS through the DALOS ellipse. The store holds
    // one ciphertext STRING, so without the split the whole mnemonic would be
    // handed over as a single "word" and resolve to a different bitstring.
    const seed = chainwebSeedFixture({
      id: "chainweb-reveal",
      secret: await encryptStringV2(`  ${TEST_PHRASE}  `, TEST_PASSWORD),
    });

    const revealWords = createRevealSeedWords({
      seeds: [seed],
      getPassword: () => TEST_PASSWORD,
    });

    await expect(revealWords(seed.id)).resolves.toEqual(TEST_PHRASE.split(" "));
    await expect(revealWords("no-such-seed")).resolves.toBeNull();
  }, 30_000);
});

describe("Arweave seeds — deleting a seed cascades to exactly its keys", () => {
  it("deletes every key of the deleted seed and leaves the other seed's keys alone", async () => {
    // WHY: without the cascade the keys survive in Arweave → Accounts with no
    // seed able to regenerate them — the orphan state design.md rules out.
    // Over-deleting is the mirror-image defect, so the survivor is asserted too.
    const keys: ForeignKeyEntry[] = [
      { id: "k1", chainId: ARWEAVE_CHAIN_ID, encryptedKeyfile: "c1", seedId: "seed-1", index: 0 },
      { id: "k2", chainId: ARWEAVE_CHAIN_ID, encryptedKeyfile: "c2", seedId: "seed-1", index: 1 },
      { id: "k3", chainId: ARWEAVE_CHAIN_ID, encryptedKeyfile: "c3", seedId: "seed-2", index: 0 },
    ];
    let slice = [...keys];

    const onDeleteSeed = createSeedKeyDeleter({
      deleteForeignKey: async (id: string) => {
        slice = slice.filter((entry) => entry.id !== id);
      },
    });

    await onDeleteSeed({ seedId: "seed-1", keyIds: ["k1", "k2"] });

    expect(slice.map((entry) => entry.id)).toEqual(["k3"]);
  });
});

describe("Arweave seeds — the PERSIST path (a generated key must survive)", () => {
  it("encrypts the JWK at rest under the codex password and hands the entry to the store", async () => {
    // WHY: this is the seam `ArweavePanel.persistKey` calls after ~6.7 s of RSA
    // search PER KEY. It used to THROW in real mode, so a finished key was lost.
    // The ciphertext must round-trip (a key that cannot be decrypted is lost
    // just as surely) and must not contain the private exponent in the clear.
    const stored: ForeignKeyEntry[] = [];
    const { generateArweaveKey, addForeignKey } = createArweaveKeyPersistence({
      getPassword: () => TEST_PASSWORD,
      addForeignKey: async (entry: ForeignKeyEntry) => {
        stored.push(entry);
      },
    });

    const entry = await generateArweaveKey({ jwk: throwawayArweaveKeyfile, label: "#0" });

    expect(entry.chainId).toBe(ARWEAVE_CHAIN_ID);
    expect(entry.label).toBe("#0");
    // The canonical 43-char address is the stable entry id (E1 keyring rule).
    expect(entry.id).toBe(THROWAWAY_ARWEAVE_ADDRESS);
    expect(entry.address).toBe(THROWAWAY_ARWEAVE_ADDRESS);
    expect(entry.encryptedKeyfile).not.toContain(throwawayArweaveKeyfile.d);
    await expect(smartDecrypt(entry.encryptedKeyfile, TEST_PASSWORD)).resolves.toBe(
      JSON.stringify(throwawayArweaveKeyfile),
    );

    await addForeignKey(entry);
    expect(stored).toEqual([entry]);
  }, 30_000);

  it("wires that persist path into REAL-mode panel deps instead of the old throwing stub", async () => {
    // WHY: `buildRealPanelDeps.generateArweaveKey` threw
    // "Keygen-in-the-playground is unsupported" — a regression back to it drops
    // every seeded key on the floor after the CPU has already been spent.
    const stored: ForeignKeyEntry[] = [];
    const deps = buildRealPanelDeps({
      gatewayUrl: DEFAULT_GATEWAY_URL,
      pool: offlinePool,
      getPassword: () => TEST_PASSWORD,
      addForeignKey: async (entry: ForeignKeyEntry) => {
        stored.push(entry);
      },
    });

    const entry = await deps.generateArweaveKey({ jwk: throwawayArweaveKeyfile });
    await deps.addForeignKey(entry);

    expect(stored.map((e) => e.id)).toEqual([THROWAWAY_ARWEAVE_ADDRESS]);
  }, 30_000);

  it("wires the SAME persist path + worker factory in MOCK mode (where the app runs)", async () => {
    // WHY: the playground runs `ARWEAVE_WIRING_MODE_MOCK`. Mock mode's keyring
    // seams are inert fakes, so a seeded key would be "persisted" into a no-op
    // and the Generate button would stay DISABLED (it is gated on
    // `workerFactory !== undefined && persistKey !== undefined`). Seeded keygen
    // is codex-local crypto — no network, no funds — so it is REAL in both modes.
    const stored: ForeignKeyEntry[] = [];
    const workerFactory = (): Worker => new FakeKeygenWorker() as unknown as Worker;

    const { panelDeps } = buildArweaveWiring({
      mode: ARWEAVE_WIRING_MODE_MOCK,
      workerFactory,
      getPassword: () => TEST_PASSWORD,
      addForeignKey: async (entry: ForeignKeyEntry) => {
        stored.push(entry);
      },
    });

    expect(panelDeps.workerFactory).toBe(workerFactory);

    const entry = await panelDeps.generateArweaveKey({ jwk: throwawayArweaveKeyfile });
    await panelDeps.addForeignKey(entry);

    expect(stored.map((e) => e.id)).toEqual([THROWAWAY_ARWEAVE_ADDRESS]);
  }, 30_000);

  it("validates + encrypts an IMPORTED JWK the same way generateArweaveKey does, instead of the mock's fake placeholder", async () => {
    // WHY (reported live bug): mock mode's `importArweaveKey` used to ignore
    // the `raw` argument entirely and return a FIXED fake entry
    // (MOCK_FAKE_ADDRESS + a fake ciphertext) for every import — including
    // the new PEM-pair import flow. The live preview before Save showed the
    // CORRECT derived address, but the row that appeared after Save was an
    // unrelated placeholder, and its "RSA parameters" decrypted to the
    // all-empty-fields fixture — "doesn't seem to be properly decoded".
    const stored: ForeignKeyEntry[] = [];
    const { importArweaveKey, addForeignKey } = createArweaveKeyPersistence({
      getPassword: () => TEST_PASSWORD,
      addForeignKey: async (entry: ForeignKeyEntry) => {
        stored.push(entry);
      },
    });

    const entry = await importArweaveKey(throwawayArweaveKeyfile, { label: "Imported" });

    expect(entry.chainId).toBe(ARWEAVE_CHAIN_ID);
    expect(entry.label).toBe("Imported");
    expect(entry.id).toBe(THROWAWAY_ARWEAVE_ADDRESS);
    expect(entry.address).toBe(THROWAWAY_ARWEAVE_ADDRESS);
    // Round-trips back to the EXACT imported key — not a fake placeholder.
    await expect(smartDecrypt(entry.encryptedKeyfile, TEST_PASSWORD)).resolves.toBe(
      JSON.stringify(throwawayArweaveKeyfile),
    );

    await addForeignKey(entry);
    expect(stored).toEqual([entry]);
  }, 30_000);

  it("rejects a malformed import (missing RSA fields) with a typed error, never silently substituting a placeholder", async () => {
    const { importArweaveKey } = createArweaveKeyPersistence({
      getPassword: () => TEST_PASSWORD,
      addForeignKey: async () => {},
    });

    await expect(importArweaveKey({ kty: "RSA" })).rejects.toThrow();
  });

  it("wires the REAL import path into REAL-mode panel deps instead of the old throwing stub", async () => {
    const stored: ForeignKeyEntry[] = [];
    const deps = buildRealPanelDeps({
      gatewayUrl: DEFAULT_GATEWAY_URL,
      pool: offlinePool,
      getPassword: () => TEST_PASSWORD,
      addForeignKey: async (entry: ForeignKeyEntry) => {
        stored.push(entry);
      },
    });

    const entry = await deps.importArweaveKey(throwawayArweaveKeyfile);
    await deps.addForeignKey(entry);

    expect(stored.map((e) => e.id)).toEqual([THROWAWAY_ARWEAVE_ADDRESS]);
  }, 30_000);

  it("wires the SAME real import path in MOCK mode (where the app runs)", async () => {
    const stored: ForeignKeyEntry[] = [];
    const workerFactory = (): Worker => new FakeKeygenWorker() as unknown as Worker;

    const { panelDeps } = buildArweaveWiring({
      mode: ARWEAVE_WIRING_MODE_MOCK,
      workerFactory,
      getPassword: () => TEST_PASSWORD,
      addForeignKey: async (entry: ForeignKeyEntry) => {
        stored.push(entry);
      },
    });

    const entry = await panelDeps.importArweaveKey(throwawayArweaveKeyfile, { label: "Imported" });
    await panelDeps.addForeignKey(entry);

    expect(stored.map((e) => e.id)).toEqual([THROWAWAY_ARWEAVE_ADDRESS]);
    // The address is the REAL derived one, not MOCK_FAKE_ADDRESS.
    expect(entry.address).toBe(THROWAWAY_ARWEAVE_ADDRESS);
  }, 30_000);

  it("wires deleteForeignKey into REAL-mode panel deps instead of the old no-op stub", async () => {
    // WHY: `buildRealPanelDeps.deleteForeignKey` hardcoded `async () => {}` — a
    // delete button anywhere in the real-mode UI would do nothing end-to-end,
    // silently leaving the "deleted" key on disk.
    const calls: string[] = [];
    const deps = buildRealPanelDeps({
      gatewayUrl: DEFAULT_GATEWAY_URL,
      pool: offlinePool,
      getPassword: () => TEST_PASSWORD,
      deleteForeignKey: async (id: string) => {
        calls.push(id);
      },
    });

    await deps.deleteForeignKey("some-id");

    expect(calls).toEqual(["some-id"]);
  });

  it("wires the SAME deleteForeignKey path in MOCK mode (where the app runs)", async () => {
    // WHY: mock mode built its own inert `deleteForeignKey` no-op via
    // `buildMockPanelDeps` — a deleted Arweave key is local cryptography with no
    // network and no funds, so mock mode has no legitimate fake reason to
    // swallow the delete either.
    const calls: string[] = [];
    const workerFactory = (): Worker => new FakeKeygenWorker() as unknown as Worker;

    const { panelDeps } = buildArweaveWiring({
      mode: ARWEAVE_WIRING_MODE_MOCK,
      workerFactory,
      getPassword: () => TEST_PASSWORD,
      deleteForeignKey: async (id: string) => {
        calls.push(id);
      },
    });

    await panelDeps.deleteForeignKey("some-id");

    expect(calls).toEqual(["some-id"]);
  });
});

describe("Arweave seeds — the Generate button is actually ENABLED in the app", () => {
  it("enables Generate on a freshly defined seed, with no 'not wired' note", async () => {
    // WHY: this is the whole point of the wiring. The area disables the run
    // button and renders `arweave-generate-unwired` unless BOTH the worker
    // factory and the persist seam arrive. Mounting the real app wiring and
    // walking define → open seed is the only assertion that proves a human
    // clicking Generate gets a key rather than a greyed-out button.
    const { user } = await renderWiredForeignChainsTab(emptySnapshot);

    await user.click(await screen.findByTestId("arweave-subtab-seeds"));
    await user.click(await screen.findByTestId("arweave-seed-custom-define"));
    await user.type(screen.getByTestId("arweave-seed-words-input"), TEST_PHRASE);
    await user.click(screen.getByTestId("arweave-seed-confirm"));

    const row = await screen.findByTestId("arweave-prime-seed-row");
    expect(row).toHaveAttribute("data-defined", "true");
    await user.click(screen.getByTestId(`arweave-seed-toggle-${row.getAttribute("data-seed-id")}`));

    expect(screen.getByTestId("arweave-generate-run")).toBeEnabled();
    expect(screen.queryByTestId("arweave-generate-unwired")).not.toBeInTheDocument();
  }, 30_000);
});

/**
 * A fake `WorkerLike` standing in for the real keygen worker, answering the
 * SEEDED-BATCH protocol (`runSeededBatch`'s `"start-seeded"` → `"key"` /
 * `"batch-done"`) rather than {@link FakeKeygenWorker}'s random-keygen
 * protocol (`"start"` → `"progress"` / `"done"`). Quick Define's generate step
 * rides `runSeededBatch`, so this is the shape it actually speaks.
 */
class FakeSeededKeygenWorker {
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  terminated = false;

  postMessage(msg: unknown): void {
    if ((msg as { kind?: string }).kind !== "start-seeded") return;
    // Reply asynchronously, like a real worker, so the runner's promise wiring
    // is what is under test rather than a synchronous shortcut.
    queueMicrotask(() => {
      this.onmessage?.({
        data: {
          kind: "key",
          index: 0,
          jwk: throwawayArweaveKeyfile,
          address: THROWAWAY_ARWEAVE_ADDRESS,
        },
      });
      this.onmessage?.({ data: { kind: "batch-done" } });
    });
  }

  terminate(): void {
    this.terminated = true;
  }
}

describe("Arweave seeds — Quick Define wired end-to-end through the REAL app", () => {
  it("one click defines the Prime seed from the wired CodexPrime account and persists exactly one key at index 0, with no error", async () => {
    // WHY: T1/T2's static review found the pieces individually wired
    // (`isDefault`, `revealAccountSecret`, `workerFactory`, `persistKey` all
    // threaded through `ForeignChainsWiring`), but Quick Define was only ever
    // proven against package-level FAKES in codex-arweave's own suite. This is
    // the first test to drive it through the REAL playground wiring — the real
    // `CodexProvider` store, the real `toArweaveSeedAccounts` filter, the real
    // `createRevealAccountSecret` decrypt, and the real persist path into
    // `foreignKeys` — so a gap in any seam between them fails HERE, not in
    // production. A regression that breaks any one link (e.g. `isDefault`
    // never set, or the persist seam silently swallowed) fails this test.
    const codexPrime = ouroAccount({
      id: "ouro-dalos-quick-define",
      name: "CodexPrime",
      address: "Ѻ.dalos-quick-define",
      originCurve: "dalos",
      isActive: true,
      isPrime: true,
      secret: await encryptStringV2(TEST_PHRASE, TEST_PASSWORD),
    });

    // The default `createKeygenWorker` calls `new Worker(new URL(...))`
    // directly — `ForeignChainsWiring` exposes no `workerFactory` override
    // prop, unlike the lower-level `buildArweaveWiring`/`buildRealPanelDeps`
    // seams the other PERSIST-path tests inject into directly. Stubbing the
    // global `Worker` constructor is therefore the only seam available to
    // drive REAL keygen through the REAL wiring without spawning an actual
    // off-thread RSA search (jsdom has no `Worker` at all).
    vi.stubGlobal("Worker", FakeSeededKeygenWorker as unknown as typeof Worker);
    const storeRef: { current: ReturnType<typeof useCodexStore> | null } = { current: null };
    try {
      const { user } = await renderWiredForeignChainsTab(
        { ...emptySnapshot, ouroAccounts: [codexPrime] },
        TEST_PASSWORD,
        storeRef,
      );

      await user.click(await screen.findByTestId("arweave-subtab-seeds"));

      const quickDefine = await screen.findByTestId("arweave-seed-quick-define");
      expect(quickDefine).toBeEnabled();
      await user.click(quickDefine);

      // (a) the row is defined WITHOUT the custom form ever opening — Quick
      // Define bypasses `DefineSeedForm` entirely, so neither the form's root
      // nor its words-source field/input ever mount. `handleQuickDefine`
      // awaits an async decrypt before flipping the row, so the assertion
      // RE-QUERIES on every retry rather than polling a captured element — the
      // undefined→defined transition swaps in an entirely new DOM node under
      // the SAME testid, and a stale reference to the pre-transition node
      // would never observe the flip.
      await waitFor(() =>
        expect(screen.getByTestId("arweave-prime-seed-row")).toHaveAttribute(
          "data-defined",
          "true",
        ),
      );
      expect(screen.queryByTestId("arweave-seed-define-form")).not.toBeInTheDocument();
      expect(screen.queryByTestId("arweave-seed-source-words")).not.toBeInTheDocument();
      expect(screen.queryByTestId("arweave-seed-words-input")).not.toBeInTheDocument();

      // (b) exactly one key at index 0 landed in the REAL codex store. Read the
      // store's OWN `foreignKeys` slice directly — `ArweavePanel` also keeps a
      // same-session `sessionKeys` overlay that would keep showing a generated
      // key in the Accounts view even if the real `addForeignKey` store action
      // were a dropped/inert stub, so the Accounts view ALONE cannot prove
      // real persistence. `waitFor` because the store update is async
      // (the worker's `key`/`batch-done` messages resolve via microtasks).
      await waitFor(() => {
        const foreignKeys = storeRef.current?.getState().foreignKeys ?? [];
        expect(foreignKeys).toHaveLength(1);
        expect(foreignKeys[0]).toMatchObject({ chainId: ARWEAVE_CHAIN_ID, index: 0 });
      });

      // ...and the Accounts view reflects that SAME real entry (T8's own seam).
      await user.click(await screen.findByTestId("arweave-subtab-accounts"));
      const area = await screen.findByTestId("arweave-accounts-area");
      const rows = await within(area).findAllByTestId("arweave-account-row");
      expect(rows).toHaveLength(1);
      expect(rows[0]).toHaveAttribute("data-index", "0");

      // (c) no persist error is shown.
      expect(screen.queryByTestId("arweave-seed-persist-error")).not.toBeInTheDocument();
      expect(screen.queryByTestId("arweave-seed-quick-define-error")).not.toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  }, 30_000);

  it("stays ENABLED and still defines the Prime seed when CodexPrime is not activated", async () => {
    // WHY: the user-reported bug — a REAL CodexPrime account that has never
    // been on-chain-activated (`isActive: false`) made Quick Define disabled
    // ("No default (CodexPrime) Ouronet account exists in this Codex"), even
    // though the account very much exists. `isActive` gates on-chain
    // registration; it has no bearing on whether the account's key material can
    // be read, which is all Quick Define needs. This drives the FULL real
    // wiring (not just the `toArweaveSeedAccounts` unit) to prove the actual
    // reported symptom — a disabled button in the real app — is fixed.
    const unactivatedCodexPrime = ouroAccount({
      id: "ouro-dalos-quick-define-unactivated",
      name: "CodexPrime",
      address: "Ѻ.dalos-quick-define-unactivated",
      originCurve: "dalos",
      isActive: false,
      isPrime: true,
      secret: await encryptStringV2(TEST_PHRASE, TEST_PASSWORD),
    });

    vi.stubGlobal("Worker", FakeSeededKeygenWorker as unknown as typeof Worker);
    const storeRef: { current: ReturnType<typeof useCodexStore> | null } = { current: null };
    try {
      const { user } = await renderWiredForeignChainsTab(
        { ...emptySnapshot, ouroAccounts: [unactivatedCodexPrime] },
        TEST_PASSWORD,
        storeRef,
      );

      await user.click(await screen.findByTestId("arweave-subtab-seeds"));

      const quickDefine = await screen.findByTestId("arweave-seed-quick-define");
      expect(quickDefine).toBeEnabled();
      await user.click(quickDefine);

      await waitFor(() =>
        expect(screen.getByTestId("arweave-prime-seed-row")).toHaveAttribute(
          "data-defined",
          "true",
        ),
      );

      await waitFor(() => {
        const foreignKeys = storeRef.current?.getState().foreignKeys ?? [];
        expect(foreignKeys).toHaveLength(1);
        expect(foreignKeys[0]).toMatchObject({ chainId: ARWEAVE_CHAIN_ID, index: 0 });
      });

      expect(screen.queryByTestId("arweave-seed-persist-error")).not.toBeInTheDocument();
      expect(screen.queryByTestId("arweave-seed-quick-define-error")).not.toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  }, 30_000);
});

/**
 * A stored key's RSA parameters must come from the REAL ciphertext, not a stub.
 *
 * Mock mode's `decryptArweaveKey` answered with MOCK_FAKE_JWK — every member an
 * empty string except `e: "AQAB"` — so the panel rendered "65537" for e and "—"
 * for n/p/q/d/dp/dq/qi. A seeded key is local cryptography with no network and
 * no funds, so mock mode has no legitimate fake for it: the persist seam owns
 * both directions.
 */
describe("PG-04 — a persisted Arweave key round-trips through the real crypto", () => {
  it("encrypts a JWK and decrypts it back member-for-member", async () => {
    const PASSWORD = "correct horse battery staple";
    const persistence = createArweaveKeyPersistence({
      getPassword: () => PASSWORD,
      addForeignKey: async () => {},
    });

    const entry = await persistence.generateArweaveKey({ jwk: throwawayArweaveKeyfile });
    // Never plaintext at rest.
    expect(entry.encryptedKeyfile).not.toContain(throwawayArweaveKeyfile.n);

    const back = await persistence.decryptArweaveKey(entry);
    for (const member of ["n", "e", "d", "p", "q", "dp", "dq", "qi"] as const) {
      expect((back as unknown as Record<string, string>)[member]).toBe(
        (throwawayArweaveKeyfile as unknown as Record<string, string>)[member],
      );
      // The stub's tell: a non-empty member that came back empty.
      expect((back as unknown as Record<string, string>)[member]).not.toBe("");
    }
  });
});
