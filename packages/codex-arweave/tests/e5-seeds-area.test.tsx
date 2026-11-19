/**
 * ArweaveSeedsArea — the Arweave "Seeds" category surface (T7).
 *
 * PRESENTATIONAL + INJECTED: it is handed the known seeds, the sources a new
 * seed can be defined from (Ouronet accounts / Chainweb seeds), the Arweave keys
 * the Codex already holds, and the persist/generate callbacks. It owns no store,
 * spawns no worker of its own, and does no RSA here — the worker is INJECTED, so
 * these cases drive a FAKE worker exactly as `e5-seeded-batch.test.ts` does.
 *
 * Every case guards a user-visible regression:
 *   (a) a Codex with no Arweave material must still offer the FIRST step. If the
 *       Prime Arweave Seed row is missing (or not first), the whole feature is
 *       unreachable — there is no other entry point.
 *   (b) options 2 and 3 read DIFFERENT parts of the Codex. Gating them together
 *       (e.g. off "is the Codex empty") hides a usable source from a user who has
 *       Ouronet accounts but no Chainweb seed, or the reverse.
 *   (b-apollo) a 1024-bit APOLLO account cannot produce a 1600-bit Arweave seed
 *       (`resolveSeedBitString` refuses it). Offering it would be a dead option
 *       that fails only after the user commits.
 *   (c) a bad word must be named INLINE and nothing stored. A silent failure, or
 *       a seed stored from unvalidated words, both derive the wrong key forever.
 *   (d)/(e) the progressive cap is the only thing standing between a user and a
 *       ~1.9 h CPU run on a path they have never seen work. The refusal must
 *       happen BEFORE a worker is spawned, and the number shown must be the one
 *       actually enforced.
 *   (f) THE funds-critical case: the library force-generates index 0 on every
 *       call (`const seen = new Set([0])` in `rsa4096/ranges.js`), so a run that
 *       stores blindly OVERWRITES the user's existing key #0 — the single worst
 *       failure this feature can have. The guard must be applied to every index.
 *   (g) at ~6.7 s/key a 100-key run is ~11 minutes. A cancel that discarded the
 *       keys already generated would throw away minutes-to-hours of CPU.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act, within } from "@testing-library/react";

import type { CodexMasterSeed, ForeignKeyEntry, MigrationProgress } from "@ancientpantheon/codex-core";
import { FORMER_MASTER_ARWEAVE_SEED } from "@ancientpantheon/codex-core";
import type { ArweaveJwk } from "@ancientpantheon/arweave-core";

import type { GatewayPool } from "@ancientpantheon/arweave-core";

import { validatePrivateKey, DALOS_ELLIPSE } from "@ouronet/dalos-crypto/gen1";

import { ARWEAVE_CHAIN_ID } from "../src/address-book/chainId";
import { ArweavePanel } from "../src/panel/ArweavePanel";
import { ArweavePanelProvider, type ArweavePanelDeps } from "../src/panel/context";
import { SEED_BIT_LENGTH } from "../src/seeds/index";
import type { KeygenWorkerMsg } from "../src/keygen/KeygenRunner";
import type { LibraryStore } from "../src/library/types";
import type { ReactNode } from "react";
import { CodexProvider, useCodexStore } from "@ancientpantheon/codex-ouronet/provider";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import { CodexUiRoot } from "@ancientpantheon/codex-ui/ui";

// Round 25: `ArweavePanel.tsx` now calls `useEnsureCodexUnlockedOptional()`
// unconditionally and threads it into `ArweaveSeedsArea`'s own
// `ensureCodexUnlocked` prop (the fix for "couldnt add a new RSA key,
// codex is locked" — gates `startRun` the same way round 22's RSA-params
// fix gates `useRsaParamsSection`). The tests in this file that mount
// `ArweavePanel` inside a real `<CodexProvider>` never call `authenticate`
// first, so the REAL hook's `requestPassword()` would hang forever waiting
// on a `<PasswordModal>` this test tree never mounts. Mirrors
// `e5-send-arweave-modal.test.tsx`'s own identical mock — defaults to
// "already unlocked" so every existing test's flow is unaffected.
const ensureCodexUnlockedMock = vi.fn(async () => true);
vi.mock("@ancientpantheon/codex-ouronet/zbom", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useEnsureCodexUnlocked: () => ensureCodexUnlockedMock,
    useEnsureCodexUnlockedOptional: () => ensureCodexUnlockedMock,
  };
});

/**
 * `SendArweaveModal` (mounted inside `ArweavePanel`'s Accounts category) now
 * calls `useEnsureCodexUnlocked` (`codex-ouronet/zbom`), which requires a
 * `<CodexProvider>` ancestor — the SAME one `apps/codex-playground` always
 * wraps `ArweavePanel` in (`ForeignChainsWiring.tsx`: "Must be mounted INSIDE
 * <CodexProvider>"). Only the two tests below that actually navigate to the
 * Accounts category need this; the rest of the file never leaves Seeds, so
 * `SendArweaveModal` never mounts and the real hook never runs.
 */
function withCodexProvider(node: ReactNode) {
  return <CodexProvider adapter={new MemoryCodexAdapter("dev")}>{node}</CodexProvider>;
}

import {
  ArweaveSeedsArea,
  validateRestrictedSeedWords,
  base64UrlToDecimal,
  type ArweaveSeedRecord,
  type ArweaveSeedsAreaProps,
  fmtDuration,
  PRIME_SEED_LABEL,
} from "../src/panel/ArweaveSeedsArea";

/** A 1600-bit stand-in: an already-resolved seed never re-runs the resolver. */
const PRIME_BITS = "1".repeat(SEED_BIT_LENGTH);

const PRIME_SEED: ArweaveSeedRecord = {
  id: "prime",
  label: "Master ArWeave Seed",
  bits: PRIME_BITS,
  isPrime: true,
};

/** The component only forwards the JWK to `persistKey`; it never inspects it. */
const fakeJwk = { kty: "RSA", n: "n", e: "AQAB" } as unknown as ArweaveJwk;

/**
 * A JWK whose members are REAL base64url with known decimals — the one fixture
 * every RSA-parameter case runs on, generated and stored alike.
 *
 * The parameters cannot be arbitrary marker strings any more: the panel prints
 * the DECIMAL integer each member encodes (what an RSA key actually is), so the
 * fixture has to be decodable and its expected output has to be a number known
 * independently of the component (`AQAB` = 65537, `3q2-7w` = 0xDEADBEEF, …).
 */
const DECIMAL_JWK = {
  kty: "RSA",
  n: "ASNFZ4mrze8", // 0x0123456789ABCDEF
  e: "AQAB", // 65537
  d: "3q2-7w", // 0xDEADBEEF
  p: "ASNFZw", // 0x01234567
  q: "iavN7w", // 0x89ABCDEF
  dp: "AAECAw", // 0x00010203
  dq: "BAUGBw", // 0x04050607
  qi: "CAkKCw", // 0x08090A0B
} as unknown as ArweaveJwk;

/** What each member of `DECIMAL_JWK` must print as. */
const DECIMALS: Record<string, string> = {
  n: "81985529216486895",
  e: "65537",
  d: "3735928559",
  p: "19088743",
  q: "2309737967",
  dp: "66051",
  dq: "67438087",
  qi: "134810123",
};

/** The six parameters that reconstruct the private key, in BOTH encodings —
 *  neither the stored base64url member nor the printed decimal may reach the
 *  DOM before an explicit reveal. */
const PRIVATE_MATERIAL: readonly string[] = ["d", "p", "q", "dp", "dq", "qi"].flatMap((name) => [
  (DECIMAL_JWK as unknown as Record<string, string>)[name]!,
  DECIMALS[name]!,
]);

/** A minimal FAKE `Worker` driven message-by-message — no real Web Worker and
 *  no real RSA (jsdom has neither). Mirrors `e5-seeded-batch.test.ts`. */
class FakeWorker {
  onmessage: ((ev: { data: KeygenWorkerMsg }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  posted: unknown[] = [];
  terminated = false;
  postMessage(msg: unknown): void {
    this.posted.push(msg);
  }
  terminate(): void {
    this.terminated = true;
  }
  emit(data: KeygenWorkerMsg): void {
    act(() => {
      this.onmessage?.({ data });
    });
  }
}

function keyMsg(index: number): KeygenWorkerMsg {
  return { kind: "key", index, jwk: fakeJwk, address: `ADDR-${index}` };
}

function makeKey(overrides: Partial<ForeignKeyEntry> = {}): ForeignKeyEntry {
  return {
    id: `key-${Math.random().toString(36).slice(2)}`,
    chainId: ARWEAVE_CHAIN_ID,
    encryptedKeyfile: "CIPHERTEXT",
    ...overrides,
  };
}

function renderArea(props: Partial<ArweaveSeedsAreaProps> = {}) {
  return render(<ArweaveSeedsArea {...props} />);
}

/** Open the define-seed form from the (undefined) Prime row via Custom Define
 *  — present regardless of `existingKeys`, unlike Quick Define. */
function openDefineForm(): void {
  fireEvent.click(screen.getByTestId("arweave-seed-custom-define"));
}

/**
 * Defines a LATER (non-master) seed through the real panel's own
 * "Add Arweave Seed" → words → confirm flow and returns the runtime-generated
 * id of the row that appeared.
 *
 * Needed because the FIRST seed a codex ever defines is stored with
 * `isPrime: true` — its Master ArWeave Seed — which is now LOCKED: the store
 * refuses to delete it and the UI renders no delete control (owner decision 3,
 * *"delete button should not be available for them"*). Every seed-DELETION case
 * driven through the panel therefore has to operate on a later seed; the
 * cascade behaviour it covers is unchanged and still has to be covered.
 */
async function defineLaterSeed(words: string): Promise<string> {
  const idsOnScreen = (): string[] =>
    Array.from(document.querySelectorAll("[data-seed-id]"), (el) =>
      el.getAttribute("data-seed-id")!,
    );
  const before = new Set(idsOnScreen());
  fireEvent.click(screen.getByTestId("arweave-add-seed"));
  fireEvent.change(screen.getByTestId("arweave-seed-words-input"), { target: { value: words } });
  fireEvent.click(screen.getByTestId("arweave-seed-confirm"));
  let defined: string | undefined;
  await waitFor(() => {
    defined = idsOnScreen().find((id) => !before.has(id));
    expect(defined).toBeDefined();
  });
  return defined!;
}

/* ── Restricted Seed Input word slots ── */

/** The colour a slot holding a non-dictionary word must be painted, as jsdom
 *  reports it. Asserting the COMPUTED colour (not just a data attribute) is the
 *  point: the human's complaint was that they could not SEE which word is wrong. */
const INVALID_WORD_RGB = "rgb(248, 113, 113)";

function wordSlot(index: number): HTMLElement {
  return screen.getByTestId(`arweave-seed-word-slot-${index}`);
}

function wordSlotInput(index: number): HTMLInputElement {
  return screen.getByTestId(`arweave-seed-word-input-${index}`) as HTMLInputElement;
}

function fillWordSlots(words: readonly string[]): void {
  words.forEach((word, i) => {
    fireEvent.change(wordSlotInput(i), { target: { value: word } });
  });
}

function currentWordSlotValues(): string[] {
  return screen
    .getAllByTestId(/^arweave-seed-word-input-\d+$/)
    .map((input) => (input as HTMLInputElement).value);
}

afterEach(() => cleanup());

describe("ArweaveSeedsArea — the Prime Arweave Seed row (T7 a)", () => {
  it("(a) renders the Prime Arweave Seed row FIRST, marked undefined, with a Define control — in a Codex with no Arweave material", () => {
    renderArea();

    const area = screen.getByTestId("arweave-seeds-area");
    const rows = within(area).getAllByTestId(/^arweave-(prime-seed-row|seed-row-)/);
    expect(rows[0]).toBe(screen.getByTestId("arweave-prime-seed-row"));

    const prime = screen.getByTestId("arweave-prime-seed-row");
    expect(prime).toHaveAttribute("data-defined", "false");
    expect(prime.textContent).toMatch(/undefined/i);
    expect(screen.getByTestId("arweave-seed-custom-define")).toHaveTextContent(
      "Custom Define Arweave Seed",
    );
  });

  it("shows a defined Prime seed as the first row, with its 1600-bit width stated", () => {
    renderArea({ seeds: [PRIME_SEED] });

    const prime = screen.getByTestId("arweave-prime-seed-row");
    expect(prime).toHaveAttribute("data-defined", "true");
    expect(prime.textContent).toContain("Master ArWeave Seed");
    expect(prime.textContent).toContain(String(SEED_BIT_LENGTH));
    // The raw seed bits are key material — never rendered.
    expect(screen.getByTestId("arweave-seeds-area").textContent).not.toContain(PRIME_BITS);
  });

  it("shows a seed with no generated addresses as UNUSED, with a generate action", () => {
    renderArea({ seeds: [PRIME_SEED] });
    fireEvent.click(screen.getByTestId("arweave-seed-toggle-prime"));

    expect(screen.getByTestId("arweave-seed-unused-prime").textContent).toMatch(/unused/i);
    expect(screen.getByTestId("arweave-generate-run")).toBeInTheDocument();
  });
});

describe("ArweaveSeedsArea — the three define-seed sources (T7 b, c)", () => {
  const DALOS_ACCOUNT = {
    id: "acct-prime",
    label: "CodexPrime",
    account: { address: "Ѻ.abc", originMode: "seedWords" as const },
    isDefault: true,
  };
  const APOLLO_ACCOUNT = {
    id: "acct-apollo",
    label: "Apollo One",
    account: { address: "₱.xyz", originMode: "seedWords" as const },
  };
  const CHAINWEB_SEED = {
    id: "cw-prime",
    label: "Prime Codex Seed",
    words: "abandon ability able about above absent absorb abstract absurd abuse access accident".split(" "),
    isDefault: true,
  };

  it("(b) disables option 2 when no activated Ouronet account exists, while option 3 stays ENABLED", () => {
    renderArea({ ouronetAccounts: [], chainwebSeeds: [CHAINWEB_SEED] });
    openDefineForm();

    expect(screen.getByTestId("arweave-seed-source-account")).toBeDisabled();
    expect(screen.getByTestId("arweave-seed-source-chainweb")).toBeEnabled();
  });

  it("(b) disables option 3 when no Chainweb seed exists, while option 2 stays ENABLED — the two are independent", () => {
    renderArea({ ouronetAccounts: [DALOS_ACCOUNT], chainwebSeeds: [] });
    openDefineForm();

    expect(screen.getByTestId("arweave-seed-source-chainweb")).toBeDisabled();
    expect(screen.getByTestId("arweave-seed-source-account")).toBeEnabled();
  });

  it("(b) leaves option 2 disabled when only APOLLO-curve accounts exist — a 1024-bit bitstring is refused, not padded", () => {
    renderArea({ ouronetAccounts: [APOLLO_ACCOUNT], chainwebSeeds: [] });
    openDefineForm();

    expect(screen.getByTestId("arweave-seed-source-account")).toBeDisabled();
  });

  it("(c) surfaces the resolver's error inline for a word outside the DALOS charset, and stores NO seed", async () => {
    const onSeedDefined = vi.fn();
    renderArea({ onSeedDefined });
    openDefineForm();

    fireEvent.change(screen.getByTestId("arweave-seed-words-input"), {
      target: { value: "hello wor中ld" },
    });
    fireEvent.click(screen.getByTestId("arweave-seed-confirm"));

    const error = await screen.findByTestId("arweave-seed-error");
    expect(error.textContent).toContain("wor中ld");
    expect(onSeedDefined).not.toHaveBeenCalled();
    expect(screen.getByTestId("arweave-prime-seed-row")).toHaveAttribute("data-defined", "false");
  });

  it("defines the Prime seed from Free Seed Input words as EXACTLY 1600 bits", async () => {
    const onSeedDefined = vi.fn();
    renderArea({ onSeedDefined });
    openDefineForm();

    fireEvent.change(screen.getByTestId("arweave-seed-words-input"), {
      target: { value: "hello world" },
    });
    fireEvent.click(screen.getByTestId("arweave-seed-confirm"));

    await waitFor(() => expect(onSeedDefined).toHaveBeenCalledTimes(1));
    const seed = onSeedDefined.mock.calls[0][0] as ArweaveSeedRecord;
    expect(seed.bits).toMatch(/^[01]+$/);
    expect(seed.bits.length).toBe(SEED_BIT_LENGTH);
    expect(seed.isPrime).toBe(true);
    expect(screen.getByTestId("arweave-prime-seed-row")).toHaveAttribute("data-defined", "true");
  });

  it("defines a seed from an activated dalos-curve Ouronet account's own bitstring (option 2)", async () => {
    const onSeedDefined = vi.fn();
    renderArea({
      onSeedDefined,
      ouronetAccounts: [DALOS_ACCOUNT],
      revealAccountSecret: vi.fn(async () => "hello world"),
    });
    openDefineForm();

    fireEvent.click(screen.getByTestId("arweave-seed-source-account"));
    // CodexPrime is the default selection — no typing, no conversion.
    expect(screen.getByTestId("arweave-seed-account-select")).toHaveValue("acct-prime");
    fireEvent.click(screen.getByTestId("arweave-seed-confirm"));

    await waitFor(() => expect(onSeedDefined).toHaveBeenCalledTimes(1));
    const seed = onSeedDefined.mock.calls[0][0] as ArweaveSeedRecord;
    expect(seed.bits.length).toBe(SEED_BIT_LENGTH);
  });

  it("defines a seed from an existing Chainweb seed's BIP39 words (option 3), defaulting to the Prime Codex Seed", async () => {
    const onSeedDefined = vi.fn();
    renderArea({ onSeedDefined, chainwebSeeds: [CHAINWEB_SEED] });
    openDefineForm();

    fireEvent.click(screen.getByTestId("arweave-seed-source-chainweb"));
    expect(screen.getByTestId("arweave-seed-chainweb-select")).toHaveValue("cw-prime");
    fireEvent.click(screen.getByTestId("arweave-seed-confirm"));

    await waitFor(() => expect(onSeedDefined).toHaveBeenCalledTimes(1));
    const seed = onSeedDefined.mock.calls[0][0] as ArweaveSeedRecord;
    expect(seed.bits.length).toBe(SEED_BIT_LENGTH);
    // The seed WORDS are secret material — the row must not echo them back.
    expect(screen.getByTestId("arweave-seeds-area").textContent).not.toContain("abandon ability");
  });
});

describe("ArweaveSeedsArea — the progressive per-run cap (T7 d, e)", () => {
  function renderWithWorker(props: Partial<ArweaveSeedsAreaProps> = {}) {
    const worker = new FakeWorker();
    let created = 0;
    const persistKey = vi.fn();
    renderArea({
      seeds: [PRIME_SEED],
      persistKey,
      workerFactory: () => {
        created += 1;
        return worker as unknown as Worker;
      },
      ...props,
    });
    fireEvent.click(screen.getByTestId("arweave-seed-toggle-prime"));
    return { worker, persistKey, workersCreated: () => created };
  }

  function requestUpTo(n: number): void {
    fireEvent.change(screen.getByTestId("arweave-generate-mode"), { target: { value: "upTo" } });
    fireEvent.change(screen.getByTestId("arweave-generate-upto"), { target: { value: String(n) } });
    fireEvent.click(screen.getByTestId("arweave-generate-run"));
  }

  it("(d) with ZERO Arweave keys shows a limit of 100 and refuses 101 positions BEFORE spawning a worker", async () => {
    const { workersCreated, persistKey } = renderWithWorker({ existingKeys: [] });

    expect(screen.getByTestId("arweave-generate-limit").textContent).toContain("100");
    expect(screen.getByTestId("arweave-generate-limit").textContent).not.toContain("1000");

    requestUpTo(100); // #0..#100 = 101 positions

    const error = await screen.findByTestId("arweave-generate-error");
    expect(error.textContent).toContain("101");
    expect(error.textContent).toContain("100");
    expect(workersCreated()).toBe(0);
    expect(persistKey).not.toHaveBeenCalled();
  });

  it("(e) with at least one Arweave key ANYWHERE in the Codex the limit rises to 1000 — 1000 positions run, 1001 are refused", async () => {
    // The key belongs to ANOTHER seed: the gate is Codex-wide, not per-seed.
    const existingKeys = [makeKey({ seedId: "other-seed", index: 0, address: "ADDR-OTHER" })];
    const { workersCreated } = renderWithWorker({ existingKeys });

    expect(screen.getByTestId("arweave-generate-limit").textContent).toContain("1000");

    requestUpTo(999); // #0..#999 = 1000 positions — at the ceiling
    await waitFor(() => expect(workersCreated()).toBe(1));
    expect(screen.queryByTestId("arweave-generate-error")).toBeNull();

    cleanup();

    const second = renderWithWorker({ existingKeys });
    requestUpTo(1000); // 1001 positions — over the ceiling
    const error = await screen.findByTestId("arweave-generate-error");
    expect(error.textContent).toContain("1001");
    expect(error.textContent).toContain("1000");
    expect(second.workersCreated()).toBe(0);
  });
});

describe("ArweaveSeedsArea — never-clobber + cancel (T7 f, g)", () => {
  it("(f) NEVER overwrites a key already stored at an index — including index 0, which the library regenerates regardless — while storing the new ones", async () => {
    const worker = new FakeWorker();
    const persistKey = vi.fn();
    // #0 already exists under THIS seed.
    const existingKeys = [makeKey({ seedId: "prime", index: 0, address: "ADDR-EXISTING-0" })];

    renderArea({
      seeds: [PRIME_SEED],
      existingKeys,
      persistKey,
      workerFactory: () => worker as unknown as Worker,
    });
    fireEvent.click(screen.getByTestId("arweave-seed-toggle-prime"));
    fireEvent.change(screen.getByTestId("arweave-generate-mode"), { target: { value: "single" } });
    fireEvent.change(screen.getByTestId("arweave-generate-position"), { target: { value: "1" } });
    fireEvent.click(screen.getByTestId("arweave-generate-run"));

    await waitFor(() => expect(worker.onmessage).not.toBeNull());
    // The planner excludes #0, but the LIBRARY force-generates it anyway, so the
    // worker delivers it. Storing it would destroy the user's existing key.
    worker.emit(keyMsg(0));
    worker.emit(keyMsg(1));
    worker.emit({ kind: "batch-done" });

    await waitFor(() => expect(persistKey).toHaveBeenCalledTimes(1));
    expect(persistKey.mock.calls[0][0]).toMatchObject({ seedId: "prime", index: 1, address: "ADDR-1" });
  });

  it("(f) stores a NEW #0 when the seed has none — the guard must not blanket-skip index 0", async () => {
    const worker = new FakeWorker();
    const persistKey = vi.fn();

    renderArea({
      seeds: [PRIME_SEED],
      existingKeys: [],
      persistKey,
      workerFactory: () => worker as unknown as Worker,
    });
    fireEvent.click(screen.getByTestId("arweave-seed-toggle-prime"));
    fireEvent.click(screen.getByTestId("arweave-generate-run")); // Default — just #0

    await waitFor(() => expect(worker.onmessage).not.toBeNull());
    worker.emit(keyMsg(0));
    worker.emit({ kind: "batch-done" });

    await waitFor(() => expect(persistKey).toHaveBeenCalledTimes(1));
    expect(persistKey.mock.calls[0][0]).toMatchObject({ seedId: "prime", index: 0 });
  });

  it("(g) cancelling mid-run stops the worker and KEEPS every key already delivered", async () => {
    const worker = new FakeWorker();
    const persistKey = vi.fn();

    renderArea({
      seeds: [PRIME_SEED],
      existingKeys: [],
      persistKey,
      workerFactory: () => worker as unknown as Worker,
    });
    fireEvent.click(screen.getByTestId("arweave-seed-toggle-prime"));
    fireEvent.change(screen.getByTestId("arweave-generate-mode"), { target: { value: "upTo" } });
    fireEvent.change(screen.getByTestId("arweave-generate-upto"), { target: { value: "5" } });
    fireEvent.click(screen.getByTestId("arweave-generate-run"));

    await waitFor(() => expect(worker.onmessage).not.toBeNull());
    worker.emit(keyMsg(0));
    worker.emit(keyMsg(1));
    await waitFor(() => expect(persistKey).toHaveBeenCalledTimes(2));

    // Live progress is what tells the user a multi-minute run is alive.
    expect(screen.getByTestId("arweave-generate-progress").textContent).toContain("2");

    fireEvent.click(screen.getByTestId("arweave-generate-cancel"));

    await waitFor(() => expect(worker.terminated).toBe(true));
    // The two finished prime searches are NOT rolled back.
    expect(persistKey).toHaveBeenCalledTimes(2);
    expect(persistKey.mock.calls.map((c) => (c[0] as { index: number }).index)).toEqual([0, 1]);
    await waitFor(() =>
      expect(screen.getByTestId("arweave-generate-status").textContent).toMatch(/cancel/i),
    );
  });
});

/**
 * The panel mount (T7, final step). `seeds` and `accounts` are the two wired
 * categories; the other three keep their explicit placeholders.
 *
 * Rendered WITHOUT an `ArweavePanelProvider` on purpose: the panel reads the
 * injected seams optionally, so a consumer that has not wired them yet still
 * gets a working (if read-only) surface instead of the hook's throw.
 */
describe("ArweavePanel — the wired Seeds and Accounts categories (T7)", () => {
  it("mounts ArweaveSeedsArea under `seeds` instead of the placeholder", () => {
    render(<ArweavePanel id={ARWEAVE_CHAIN_ID} />);
    fireEvent.click(screen.getByTestId("arweave-subtab-seeds"));

    expect(screen.getByTestId("arweave-seeds-area")).toBeInTheDocument();
    expect(screen.getByTestId("arweave-prime-seed-row")).toBeInTheDocument();
    expect(screen.queryByTestId("arweave-category-empty-seeds")).toBeNull();
  });

  it("mounts ArweaveAccountsArea under `accounts` instead of the placeholder", () => {
    render(<ArweavePanel id={ARWEAVE_CHAIN_ID} />);
    fireEvent.click(screen.getByTestId("arweave-subtab-accounts"));

    expect(screen.getByTestId("arweave-accounts-area")).toBeInTheDocument();
    expect(screen.queryByTestId("arweave-category-empty-accounts")).toBeNull();
  });

  // Upload and Library are wired now too (arweave-upload-categories addendum:
  // mounting) — with no provider (`deps === null`, this describe block's own
  // deliberate rendering choice), they degrade to their own "unavailable"
  // message rather than the old generic empty placeholder.
  it.each(["upload", "library"])(
    "shows the `%s` category's own 'unavailable' message (no provider wired) rather than the old generic empty placeholder",
    (id) => {
      render(<ArweavePanel id={ARWEAVE_CHAIN_ID} />);
      fireEvent.click(screen.getByTestId(`arweave-subtab-${id}`));
      expect(screen.getByTestId(`arweave-${id}-unavailable`)).toBeInTheDocument();
      expect(screen.queryByTestId(`arweave-category-empty-${id}`)).toBeNull();
    },
  );

  it("keeps a just-defined seed when the user switches category and comes back", async () => {
    render(<ArweavePanel id={ARWEAVE_CHAIN_ID} />);
    fireEvent.click(screen.getByTestId("arweave-subtab-seeds"));
    openDefineForm();
    fireEvent.change(screen.getByTestId("arweave-seed-words-input"), {
      target: { value: "hello world" },
    });
    fireEvent.click(screen.getByTestId("arweave-seed-confirm"));
    await waitFor(() =>
      expect(screen.getByTestId("arweave-prime-seed-row")).toHaveAttribute("data-defined", "true"),
    );

    // Switching away unmounts the area; the seed lives in the PANEL, not in it.
    fireEvent.click(screen.getByTestId("arweave-subtab-upload"));
    fireEvent.click(screen.getByTestId("arweave-subtab-seeds"));

    expect(screen.getByTestId("arweave-prime-seed-row")).toHaveAttribute("data-defined", "true");
  });

  it("Accounts never offers a delete control — a this-session-generated key is removed by deleting its SEED instead, pruning the session overlay", async () => {
    let worker: FakeWorker | undefined;
    const deleteForeignKey = vi.fn(async (_id: string) => {});
    const fakeLibraryStore = {
      append: vi.fn(async () => {}),
      get: vi.fn(async () => undefined),
      updateStatus: vi.fn(async () => {}),
      list: vi.fn(async () => []),
    } as unknown as LibraryStore;
    const deps: ArweavePanelDeps = {
      address: "ADDR-HOST",
      foreignKeys: [],
      keygenRunner: { runKeygen: vi.fn(async () => fakeJwk) },
      generateArweaveKey: vi.fn(async ({ label }) => ({
        id: "GENERATED-ID",
        chainId: ARWEAVE_CHAIN_ID,
        encryptedKeyfile: "ct",
        label,
      })),
      importArweaveKey: vi.fn(async () => ({
        id: "unused",
        chainId: ARWEAVE_CHAIN_ID,
        encryptedKeyfile: "ct",
      })),
      decryptArweaveKey: vi.fn(async () => fakeJwk),
      addForeignKey: vi.fn(async () => {}),
      renameForeignKey: vi.fn(async () => {}),
      deleteForeignKey,
      getBalance: vi.fn(async () => 0n),
      send: vi.fn(async () => ({ id: "tx", reward: 0n })),
      sendFrom: vi.fn(async () => ({ id: "tx", reward: 0n })),
      estimateFee: vi.fn(async () => 100_000_000n),
      pollStatus: vi.fn(async () => "final" as const),
      uploadAndTrack: vi.fn(async () => ({
        id: "item",
        itemId: "item",
        ownerAddress: "ADDR-HOST",
        tags: [],
      })),
      uploadFilesAndTrack: vi.fn(async () => ({
        manifestId: "manifest-id",
        fileIds: [],
        uploadId: "upload-id",
      })),
      getExportJson: vi.fn(async () => "{}"),
      backupCodex: vi.fn(async () => ({ id: "backup-id" })),
      listLibrary: vi.fn(async () => []),
      openUrl: vi.fn((id: string) => `https://arweave.net/${id}`),
      rebuildLibrary: vi.fn(async () => {}),
      libraryStore: fakeLibraryStore,
      pool: {} as unknown as GatewayPool,
      addressBook: [],
      workerFactory: () => {
        worker = new FakeWorker();
        return worker as unknown as Worker;
      },
    };

    render(
      withCodexProvider(
        <ArweavePanelProvider deps={deps}>
          <ArweavePanel id={ARWEAVE_CHAIN_ID} />
        </ArweavePanelProvider>,
      ),
    );

    // Define the Prime seed via Free Seed Input.
    fireEvent.click(screen.getByTestId("arweave-subtab-seeds"));
    openDefineForm();
    fireEvent.change(screen.getByTestId("arweave-seed-words-input"), {
      target: { value: "hello world" },
    });
    fireEvent.click(screen.getByTestId("arweave-seed-confirm"));
    await waitFor(() =>
      expect(screen.getByTestId("arweave-prime-seed-row")).toHaveAttribute("data-defined", "true"),
    );

    // The cascade is exercised on a LATER seed: the first seed defined is the
    // codex's Master ArWeave Seed (`isPrime: true`) and is Locked — it has no
    // delete control at all any more (owner decision 3). Its id is generated at
    // runtime, so it is read off the row rather than assumed.
    const seedId = await defineLaterSeed("goodbye moon");
    fireEvent.click(screen.getByTestId(`arweave-seed-toggle-${seedId}`));
    fireEvent.click(screen.getByTestId("arweave-generate-run"));
    await waitFor(() => expect(worker?.onmessage).not.toBeNull());
    worker!.emit(keyMsg(0));
    worker!.emit({ kind: "batch-done" });
    // The run must actually have SETTLED — not merely been told to — before
    // switching category. `runSeededBatch`'s resolution reaches the component's
    // `run.status` via an `await`, one microtask AFTER `batch-done` is
    // dispatched, so a click fired synchronously right after `emit` (as a real
    // user's next click never would be) would otherwise still see
    // `status: "running"` and hit T2's leave-generation dialog instead of
    // switching straight to Accounts. The completion summary only renders once
    // `status` is `"done"`/`"cancelled"`, so it is the observable settle signal.
    await waitFor(() => expect(screen.getByTestId("arweave-generate-summary")).toBeInTheDocument());

    // Switch to Accounts and confirm the session-generated key renders — even
    // though `deps.foreignKeys` stays `[]` the whole time (the session overlay).
    // Scoped to the Accounts area: Seeds now stays mounted (keep-alive) rather
    // than unmounting, so its OWN generated-key row for the same address is
    // still in the DOM (merely hidden), and an unscoped `getByText` would find
    // both.
    fireEvent.click(screen.getByTestId("arweave-subtab-accounts"));
    const accountsArea = () => screen.getByTestId("arweave-accounts-area");
    await waitFor(() => expect(within(accountsArea()).getByText("ADDR-0")).toBeInTheDocument());

    // Accounts is a pure listing — it never offers a delete control on any
    // row. A key can only be removed via its OWN category: the Seeds
    // category (deleting the seed it came from) or Pure Keys (for seedless
    // keys). Confirm no delete affordance leaked onto this Accounts row.
    expect(screen.queryByTestId("arweave-account-delete-GENERATED-ID")).toBeNull();

    // Deletion happens from Seeds instead: delete the seed the key came
    // from, which cascades to every key it produced (including this one).
    fireEvent.click(screen.getByTestId("arweave-subtab-seeds"));
    fireEvent.click(screen.getByTestId(`arweave-seed-delete-${seedId}`));
    await waitFor(() =>
      expect(screen.getByTestId(`arweave-seed-delete-confirm-panel-${seedId}`)).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId(`arweave-seed-delete-confirm-${seedId}`));

    // Back in Accounts, the row is gone — this must NOT depend on
    // `deps.foreignKeys` ever echoing the deletion back (the session overlay
    // drops it immediately).
    fireEvent.click(screen.getByTestId("arweave-subtab-accounts"));
    expect(within(accountsArea()).queryByText("ADDR-0")).toBeNull();
  });

  /**
   * Regression for the reported bug: `ArweaveSeedsArea` used to unmount the
   * instant `active !== "seeds"`, which destroyed its `run` state entirely —
   * so a generation that was genuinely still running in the background (the
   * worker keeps going regardless of what the panel renders) came back to a
   * BLANK progress bar on return, as if it had never started. The fix keeps
   * the area mounted (hidden, not removed) across a category switch, so the
   * SAME live run is still there when the user comes back to Seeds.
   */
  it("keeps the progress bar and running status after switching away and back to Seeds mid-generation", async () => {
    let worker: FakeWorker | undefined;
    const fakeLibraryStore = {
      append: vi.fn(async () => {}),
      get: vi.fn(async () => undefined),
      updateStatus: vi.fn(async () => {}),
      list: vi.fn(async () => []),
    } as unknown as LibraryStore;
    const deps: ArweavePanelDeps = {
      address: "ADDR-HOST",
      foreignKeys: [],
      keygenRunner: { runKeygen: vi.fn(async () => fakeJwk) },
      generateArweaveKey: vi.fn(async ({ label }) => ({
        id: "GENERATED-ID",
        chainId: ARWEAVE_CHAIN_ID,
        encryptedKeyfile: "ct",
        label,
      })),
      importArweaveKey: vi.fn(async () => ({
        id: "unused",
        chainId: ARWEAVE_CHAIN_ID,
        encryptedKeyfile: "ct",
      })),
      decryptArweaveKey: vi.fn(async () => fakeJwk),
      addForeignKey: vi.fn(async () => {}),
      renameForeignKey: vi.fn(async () => {}),
      deleteForeignKey: vi.fn(async () => {}),
      getBalance: vi.fn(async () => 0n),
      send: vi.fn(async () => ({ id: "tx", reward: 0n })),
      sendFrom: vi.fn(async () => ({ id: "tx", reward: 0n })),
      estimateFee: vi.fn(async () => 100_000_000n),
      pollStatus: vi.fn(async () => "final" as const),
      uploadAndTrack: vi.fn(async () => ({
        id: "item",
        itemId: "item",
        ownerAddress: "ADDR-HOST",
        tags: [],
      })),
      uploadFilesAndTrack: vi.fn(async () => ({
        manifestId: "manifest-id",
        fileIds: [],
        uploadId: "upload-id",
      })),
      getExportJson: vi.fn(async () => "{}"),
      backupCodex: vi.fn(async () => ({ id: "backup-id" })),
      listLibrary: vi.fn(async () => []),
      openUrl: vi.fn((id: string) => `https://arweave.net/${id}`),
      rebuildLibrary: vi.fn(async () => {}),
      libraryStore: fakeLibraryStore,
      pool: {} as unknown as GatewayPool,
      addressBook: [],
      workerFactory: () => {
        worker = new FakeWorker();
        return worker as unknown as Worker;
      },
    };

    render(
      <ArweavePanelProvider deps={deps}>
        <ArweavePanel id={ARWEAVE_CHAIN_ID} />
      </ArweavePanelProvider>,
    );

    fireEvent.click(screen.getByTestId("arweave-subtab-seeds"));
    openDefineForm();
    fireEvent.change(screen.getByTestId("arweave-seed-words-input"), {
      target: { value: "hello world" },
    });
    fireEvent.click(screen.getByTestId("arweave-seed-confirm"));
    await waitFor(() =>
      expect(screen.getByTestId("arweave-prime-seed-row")).toHaveAttribute("data-defined", "true"),
    );

    const seedId = screen.getByTestId("arweave-prime-seed-row").getAttribute("data-seed-id")!;
    fireEvent.click(screen.getByTestId(`arweave-seed-toggle-${seedId}`));
    fireEvent.click(screen.getByTestId("arweave-generate-run"));

    await waitFor(() => expect(worker?.onmessage).not.toBeNull());
    // A `batch-progress` event, never a terminal message — the run must still
    // be `status: "running"`, exactly like T2's `startAnInFlightRun` helper.
    worker!.emit({
      kind: "batch-progress",
      ev: {
        index: 0,
        completedCount: 0,
        totalCount: 1,
        addressProgress: 0.5,
        overallProgress: 0.5,
        stage: "q",
        attempts: 12,
      },
    });

    expect(screen.getByTestId("arweave-generate-status")).toHaveTextContent(
      "Running — each key takes several seconds.",
    );

    // Leaving mid-run opens T2's dialog; "Continue in background" is the
    // choice that leaves the worker running — the exact scenario this bug
    // report is about.
    fireEvent.click(screen.getByTestId("arweave-subtab-accounts"));
    fireEvent.click(screen.getByTestId("arweave-leave-generation-continue"));
    expect(screen.getByTestId("arweave-accounts-area")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("arweave-subtab-seeds"));

    // Before the fix, the switch away unmounted `ArweaveSeedsArea`, destroying
    // its `run` state; the switch back remounted with `run = null`, so the
    // progress bar and status were simply gone even though the worker (and
    // therefore the actual generation) was still alive. The keep-alive fix
    // keeps the area mounted (merely hidden) across the switch, so the SAME
    // running state is still here.
    expect(screen.getByTestId("arweave-generate-status")).toHaveTextContent(
      "Running — each key takes several seconds.",
    );
    expect(screen.getByTestId("arweave-generate-progress-bar")).toBeInTheDocument();
    expect(worker!.terminated).toBe(false);
  });

  /**
   * Regression for `handleDeleteSeed`: deleting a seed used to prune only
   * `sessionSeeds`, leaving a this-session-generated key's id alive in
   * `sessionKeys` — which `arweaveKeys` merges back on top of the (now-empty)
   * host list, resurrecting a key whose seed (and therefore whose whole
   * lineage) had just been deleted. Modelled on the per-key-delete "resurrect"
   * case above, but the deletion is triggered on the SEED, not the key.
   */
  it("prunes a this-session-generated key from Accounts when its SEED (not just the key) is deleted", async () => {
    let worker: FakeWorker | undefined;
    const deleteForeignKey = vi.fn(async (_id: string) => {});
    const onDeleteSeed = vi.fn(
      async (_request: { seedId: string; keyIds: readonly string[] }) => {},
    );
    const fakeLibraryStore = {
      append: vi.fn(async () => {}),
      get: vi.fn(async () => undefined),
      updateStatus: vi.fn(async () => {}),
      list: vi.fn(async () => []),
    } as unknown as LibraryStore;
    const deps: ArweavePanelDeps = {
      address: "ADDR-HOST",
      foreignKeys: [],
      keygenRunner: { runKeygen: vi.fn(async () => fakeJwk) },
      generateArweaveKey: vi.fn(async ({ label }) => ({
        id: "GENERATED-ID",
        chainId: ARWEAVE_CHAIN_ID,
        encryptedKeyfile: "ct",
        label,
      })),
      importArweaveKey: vi.fn(async () => ({
        id: "unused",
        chainId: ARWEAVE_CHAIN_ID,
        encryptedKeyfile: "ct",
      })),
      decryptArweaveKey: vi.fn(async () => fakeJwk),
      addForeignKey: vi.fn(async () => {}),
      renameForeignKey: vi.fn(async () => {}),
      deleteForeignKey,
      getBalance: vi.fn(async () => 0n),
      send: vi.fn(async () => ({ id: "tx", reward: 0n })),
      sendFrom: vi.fn(async () => ({ id: "tx", reward: 0n })),
      estimateFee: vi.fn(async () => 100_000_000n),
      pollStatus: vi.fn(async () => "final" as const),
      uploadAndTrack: vi.fn(async () => ({
        id: "item",
        itemId: "item",
        ownerAddress: "ADDR-HOST",
        tags: [],
      })),
      uploadFilesAndTrack: vi.fn(async () => ({
        manifestId: "manifest-id",
        fileIds: [],
        uploadId: "upload-id",
      })),
      getExportJson: vi.fn(async () => "{}"),
      backupCodex: vi.fn(async () => ({ id: "backup-id" })),
      listLibrary: vi.fn(async () => []),
      openUrl: vi.fn((id: string) => `https://arweave.net/${id}`),
      rebuildLibrary: vi.fn(async () => {}),
      libraryStore: fakeLibraryStore,
      pool: {} as unknown as GatewayPool,
      addressBook: [],
      onDeleteSeed,
      workerFactory: () => {
        worker = new FakeWorker();
        return worker as unknown as Worker;
      },
    };

    render(
      withCodexProvider(
        <ArweavePanelProvider deps={deps}>
          <ArweavePanel id={ARWEAVE_CHAIN_ID} />
        </ArweavePanelProvider>,
      ),
    );

    // Define the Prime seed, generate one key — it lands in `sessionKeys` via
    // `persistKey`, exactly like the per-key-delete case above.
    fireEvent.click(screen.getByTestId("arweave-subtab-seeds"));
    openDefineForm();
    fireEvent.change(screen.getByTestId("arweave-seed-words-input"), {
      target: { value: "hello world" },
    });
    fireEvent.click(screen.getByTestId("arweave-seed-confirm"));
    await waitFor(() =>
      expect(screen.getByTestId("arweave-prime-seed-row")).toHaveAttribute("data-defined", "true"),
    );

    // A LATER seed, for the same reason as the case above: the master seed has
    // no delete control any more.
    const seedId = await defineLaterSeed("goodbye moon");
    fireEvent.click(screen.getByTestId(`arweave-seed-toggle-${seedId}`));
    fireEvent.click(screen.getByTestId("arweave-generate-run"));
    await waitFor(() => expect(worker?.onmessage).not.toBeNull());
    worker!.emit(keyMsg(0));
    worker!.emit({ kind: "batch-done" });
    await waitFor(() => expect(screen.getByTestId("arweave-generate-summary")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("arweave-subtab-accounts"));
    // Scoped to the Accounts area: Seeds stays mounted (keep-alive) rather
    // than unmounting, so its OWN row for the same address is still in the
    // DOM (merely hidden), and an unscoped `getByText` would find both.
    const accountsArea = () => screen.getByTestId("arweave-accounts-area");
    await waitFor(() => expect(within(accountsArea()).getByText("ADDR-0")).toBeInTheDocument());

    // Delete the SEED (not the individual key): first click reveals the
    // confirm strip, second click confirms — same shape as T10's `deleteSeed`.
    fireEvent.click(screen.getByTestId("arweave-subtab-seeds"));
    fireEvent.click(screen.getByTestId(`arweave-seed-delete-${seedId}`));
    fireEvent.click(screen.getByTestId(`arweave-seed-delete-confirm-${seedId}`));

    // The key must be gone from Accounts, not resurrected from the
    // `sessionKeys` overlay.
    fireEvent.click(screen.getByTestId("arweave-subtab-accounts"));
    expect(within(accountsArea()).queryByText("ADDR-0")).toBeNull();
    expect(onDeleteSeed).toHaveBeenCalledTimes(1);
    expect(onDeleteSeed.mock.calls[0]?.[0]).toMatchObject({ seedId });
  });
});

/**
 * Restricted Seed Input is actually RESTRICTED (T9).
 *
 * design.md: option 1b is "BIP-dictionary gated, same as Chainweb seeds". Shipped
 * as it was, the variant accepted whatever 1a accepted, so the two buttons were
 * one button with two labels — a user who picked "Restricted" believing their
 * phrase was dictionary-checked got no check at all, and a typo silently derived
 * a DIFFERENT 1600-bit seed (and therefore different RSA keys, forever).
 *
 * Each case guards a distinct regression:
 *   (a) typing MUST stay possible — the dictionary gate must not degrade the
 *       variant into a generate-only picker, which would drop one of the two
 *       required modes.
 *   (b) rejection must be PER WORD and NAME the word, mirroring the DALOS
 *       charset message. "Invalid phrase" against 24 words is unactionable.
 *   (c) the two variants must genuinely DIFFER: the same phrase 1b refuses must
 *       still pass 1a, or the gate has leaked into Free Seed Input and broken
 *       the DALOS-charset-only contract.
 *   (d) the generate variant must emit a phrase its OWN validator accepts — a
 *       generator disagreeing with the gate is a dead button.
 */
describe("ArweaveSeedsArea — Restricted Seed Input is dictionary-gated (T9)", () => {
  /** Every word is in the BIP English wordlist. */
  const VALID_BIP_WORDS = [
    "abandon", "ability", "able", "about", "above", "absent",
    "absorb", "abstract", "absurd", "abuse", "access", "accident",
  ];
  /** DALOS-charset-legal (plain ASCII) but NOT a BIP word — the discriminator. */
  const BAD_WORD = "zzzznotaword";
  /** The same 12 words with slot 2 poisoned. */
  const POISONED_WORDS = VALID_BIP_WORDS.map((w, i) => (i === 1 ? BAD_WORD : w));
  /** The free-variant form of a non-dictionary phrase. */
  const NON_DICTIONARY_PHRASE = `abandon ${BAD_WORD} able about`;

  function chooseRestricted(): void {
    // "Dictionary (12-word)" — the tile IS the count now, so this single
    // click reaches exactly what "Restricted" + the default 12-word switch
    // used to.
    fireEvent.click(screen.getByTestId("arweave-seed-input-tile-dict12"));
  }

  it("(a) accepts a TYPED phrase whose every word is in the BIP English wordlist — typing stays a supported variant", async () => {
    const onSeedDefined = vi.fn();
    renderArea({ onSeedDefined });
    openDefineForm();
    chooseRestricted();

    fillWordSlots(VALID_BIP_WORDS);
    fireEvent.click(screen.getByTestId("arweave-seed-confirm"));

    await waitFor(() => expect(onSeedDefined).toHaveBeenCalledTimes(1));
    const seed = onSeedDefined.mock.calls[0][0] as ArweaveSeedRecord;
    expect(seed.bits.length).toBe(SEED_BIT_LENGTH);
    expect(screen.queryByTestId("arweave-seed-error")).toBeNull();
  });

  it("(b) marks the OFFENDING SLOT invalid, names the word, blocks Define seed, and stores nothing", () => {
    const onSeedDefined = vi.fn();
    renderArea({ onSeedDefined });
    openDefineForm();
    chooseRestricted();

    fillWordSlots(POISONED_WORDS);

    // The refusal is visible ON the slot that is wrong — not only in a summary.
    expect(wordSlot(1)).toHaveAttribute("data-invalid", "true");
    expect(wordSlot(0)).toHaveAttribute("data-invalid", "false");
    expect(screen.getByTestId("arweave-seed-restricted-notice").textContent).toContain(BAD_WORD);

    const confirm = screen.getByTestId("arweave-seed-confirm");
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(onSeedDefined).not.toHaveBeenCalled();
    expect(screen.getByTestId("arweave-prime-seed-row")).toHaveAttribute("data-defined", "false");
  });

  it("(c) accepts that SAME non-dictionary phrase under Free Seed Input — 1a stays DALOS-charset-only and the two variants genuinely differ", async () => {
    const onSeedDefined = vi.fn();
    renderArea({ onSeedDefined });
    openDefineForm();
    // "Stoa Dalos" (Free Seed Input) is the default tile; assert rather than assume.
    expect(screen.getByTestId("arweave-seed-input-tile-dalos")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.change(screen.getByTestId("arweave-seed-words-input"), {
      target: { value: NON_DICTIONARY_PHRASE },
    });
    fireEvent.click(screen.getByTestId("arweave-seed-confirm"));

    await waitFor(() => expect(onSeedDefined).toHaveBeenCalledTimes(1));
    expect((onSeedDefined.mock.calls[0][0] as ArweaveSeedRecord).bits.length).toBe(SEED_BIT_LENGTH);
  });

  it("(d) the generate-a-random-phrase variant fills every slot with a phrase its OWN validator accepts, and that phrase defines a seed", async () => {
    const onSeedDefined = vi.fn();
    renderArea({ onSeedDefined });
    openDefineForm();
    chooseRestricted();

    const generate = screen.getByTestId("arweave-seed-random-phrase");
    expect(generate).toBeEnabled();
    fireEvent.click(generate);

    await waitFor(() => expect(wordSlotInput(0).value).not.toBe(""));
    const words = currentWordSlotValues();
    expect(words).toHaveLength(12);
    // The generator and the gate must agree — otherwise the button is dead.
    expect(validateRestrictedSeedWords(words)).toBeNull();
    expect(screen.queryByTestId("arweave-seed-restricted-notice")).toBeNull();

    fireEvent.click(screen.getByTestId("arweave-seed-confirm"));
    await waitFor(() => expect(onSeedDefined).toHaveBeenCalledTimes(1));
    expect((onSeedDefined.mock.calls[0][0] as ArweaveSeedRecord).bits.length).toBe(SEED_BIT_LENGTH);
  });

  it("names the FIRST offending word by its 1-based position, mirroring the DALOS charset message", () => {
    expect(validateRestrictedSeedWords(["abandon", "notaword", "alsonotaword"])).toMatch(
      /seed word 2 \("notaword"\)/,
    );
    expect(validateRestrictedSeedWords(["abandon", "ability"])).toBeNull();
    // Case is normalised — a pasted capitalised phrase is not a false rejection.
    expect(validateRestrictedSeedWords(["Abandon", "ABILITY"])).toBeNull();
  });
});

/**
 * Option 1's word-input selector is a SINGLE flat 3-tile picker (this
 * restructure), not the earlier two-tier "variant row + nested word-count
 * toggle". Ported from `CreateStoaChainSeedModal`'s `SEED_TYPE_OPTIONS` tile
 * shape/styling, minus its mode toggle, password field and Key #0 preview
 * (none of which apply to Arweave's seed-definition step).
 *
 * Each case guards a distinct regression:
 *   (labels) the three tiles must actually be labelled and subtitled as the
 *       design specifies — a silently-wrong label/subtitle would mislead a
 *       user about which tile is 1-256 free words vs. a fixed-length
 *       dictionary phrase.
 *   (direct switch) reaching a 24-word Dictionary phrase from Stoa Dalos (or
 *       back) must now take exactly ONE click on the destination tile — the
 *       whole point of collapsing the old two-step "variant then count" flow.
 *       A regression that silently reintroduced a second step would defeat
 *       the restructure without failing any single-tile-click assertion.
 */
describe("ArweaveSeedsArea — the single flat 3-tile word-input picker", () => {
  it("labels and subtitles all three tiles per the design (Stoa Dalos / Dictionary 12-word / Dictionary 24-word)", () => {
    renderArea();
    openDefineForm();

    const dalos = screen.getByTestId("arweave-seed-input-tile-dalos");
    const dict12 = screen.getByTestId("arweave-seed-input-tile-dict12");
    const dict24 = screen.getByTestId("arweave-seed-input-tile-dict24");

    expect(dalos.textContent).toContain("Stoa Dalos");
    expect(dalos.textContent).toMatch(/Min 1 - Max 256 words/);
    expect(dict12.textContent).toContain("Dictionary (12-word)");
    expect(dict24.textContent).toContain("Dictionary (24-word)");
  });

  it("switches from the 24-word Dictionary tile straight to Stoa Dalos's free textarea in ONE click, with no intermediate step", () => {
    renderArea();
    openDefineForm();

    fireEvent.click(screen.getByTestId("arweave-seed-input-tile-dict24"));
    expect(screen.getAllByTestId(/^arweave-seed-word-slot-\d+$/)).toHaveLength(24);
    expect(screen.queryByTestId("arweave-seed-words-input")).toBeNull();

    fireEvent.click(screen.getByTestId("arweave-seed-input-tile-dalos"));

    expect(screen.getByTestId("arweave-seed-words-input")).toBeInTheDocument();
    expect(screen.queryAllByTestId(/^arweave-seed-word-slot-\d+$/)).toHaveLength(0);
    expect(screen.getByTestId("arweave-seed-input-tile-dalos")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

/**
 * Restricted Seed Input looks and behaves like the Codex's own seed inputs (T11).
 *
 * A single free-form textarea was shipped first and rejected on sight: the Codex
 * already has ONE way to enter a mnemonic — `CreateStoaChainSeedModal` /
 * `SpawnAccountModal`'s numbered word grid with a 12/24 switch — and a second,
 * poorer way in the same app is a defect, not a variation.
 *
 * Each case guards a distinct regression:
 *   (count) without a 12/24 switch a 24-word phrase simply cannot be entered in
 *       the shape the rest of the Codex uses, and the generated phrase silently
 *       ignores what the user asked for.
 *   (suggest/select) the wordlist is 2048 entries. Unassisted typing of 24 of
 *       them is where the typos come from, and a typo here derives a DIFFERENT
 *       1600-bit seed — i.e. permanently different RSA keys.
 *   (red) "which word is no go" must be answerable by LOOKING. A summary line
 *       under 24 slots does not answer it.
 */
describe("ArweaveSeedsArea — Restricted Seed Input word slots (T11)", () => {
  function openRestricted(props: Partial<ArweaveSeedsAreaProps> = {}): void {
    renderArea(props);
    openDefineForm();
    // "Dictionary (12-word)" — the tile IS the count now.
    fireEvent.click(screen.getByTestId("arweave-seed-input-tile-dict12"));
  }

  it("shows one slot per word and switches the slot count between the 12- and 24-word tiles", () => {
    openRestricted();

    expect(screen.getAllByTestId(/^arweave-seed-word-slot-\d+$/)).toHaveLength(12);
    expect(screen.getByTestId("arweave-seed-input-tile-dict12")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(screen.getByTestId("arweave-seed-input-tile-dict24"));
    expect(screen.getAllByTestId(/^arweave-seed-word-slot-\d+$/)).toHaveLength(24);
    expect(screen.getByTestId("arweave-seed-input-tile-dict24")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // Switching back does not strand the extra slots.
    fireEvent.click(screen.getByTestId("arweave-seed-input-tile-dict12"));
    expect(screen.getAllByTestId(/^arweave-seed-word-slot-\d+$/)).toHaveLength(12);
  });

  it("generates a phrase of the SELECTED length — 24 slots means 24 words", async () => {
    openRestricted();
    fireEvent.click(screen.getByTestId("arweave-seed-input-tile-dict24"));

    fireEvent.click(screen.getByTestId("arweave-seed-random-phrase"));

    await waitFor(() => expect(wordSlotInput(23).value).not.toBe(""));
    const words = currentWordSlotValues();
    expect(words).toHaveLength(24);
    expect(validateRestrictedSeedWords(words)).toBeNull();
  });

  it("offers only dictionary words matching the typed prefix, and none for a prefix nothing matches", () => {
    openRestricted();

    fireEvent.change(wordSlotInput(0), { target: { value: "aban" } });
    const suggestions = screen.getAllByTestId(/^arweave-seed-word-suggestion-0-\d+$/);
    expect(suggestions.length).toBeGreaterThan(0);
    for (const option of suggestions) {
      expect(option.textContent?.startsWith("aban")).toBe(true);
    }
    expect(suggestions.map((o) => o.textContent)).toContain("abandon");

    fireEvent.change(wordSlotInput(0), { target: { value: "zzzz" } });
    expect(screen.queryAllByTestId(/^arweave-seed-word-suggestion-0-\d+$/)).toHaveLength(0);
  });

  it("fills THAT slot when a suggestion is clicked, leaving the other slots alone", () => {
    openRestricted();

    fireEvent.change(wordSlotInput(3), { target: { value: "abil" } });
    fireEvent.click(screen.getByTestId("arweave-seed-word-suggestion-3-0"));

    expect(wordSlotInput(3).value).toBe("ability");
    expect(wordSlotInput(0).value).toBe("");
    expect(wordSlot(3)).toHaveAttribute("data-invalid", "false");
    // The list closes once the word is chosen.
    expect(screen.queryAllByTestId(/^arweave-seed-word-suggestion-3-\d+$/)).toHaveLength(0);
  });

  it("selects a suggestion from the KEYBOARD — arrow down then Enter fills the slot", () => {
    openRestricted();

    const input = wordSlotInput(0);
    fireEvent.change(input, { target: { value: "abo" } });
    const first = screen.getByTestId("arweave-seed-word-suggestion-0-0").textContent;

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(input.value).toBe(first);
    expect(wordSlot(0)).toHaveAttribute("data-invalid", "false");
  });

  it("paints a non-dictionary word RED in its own slot while its neighbours stay normal", () => {
    openRestricted();

    fireEvent.change(wordSlotInput(0), { target: { value: "abandon" } });
    fireEvent.change(wordSlotInput(1), { target: { value: "zzzznotaword" } });

    const bad = wordSlotInput(1);
    const good = wordSlotInput(0);
    expect(wordSlot(1)).toHaveAttribute("data-invalid", "true");
    expect(getComputedStyle(bad).color).toBe(INVALID_WORD_RGB);
    expect(getComputedStyle(bad).borderColor).toBe(INVALID_WORD_RGB);
    expect(getComputedStyle(good).color).not.toBe(INVALID_WORD_RGB);

    // An untouched, still-empty slot is incomplete, NOT wrong: colouring it red
    // would make the whole grid red before the user has typed anything.
    expect(wordSlot(5)).toHaveAttribute("data-invalid", "false");
    expect(getComputedStyle(wordSlotInput(5)).color).not.toBe(INVALID_WORD_RGB);
  });

  it("keeps Define seed blocked while a slot is still empty", () => {
    openRestricted();

    fireEvent.change(wordSlotInput(0), { target: { value: "abandon" } });
    expect(screen.getByTestId("arweave-seed-confirm")).toBeDisabled();
  });
});

/**
 * Seed deletion cascades to every key derived from the seed (T10).
 *
 * design.md: "deleting it deletes every RSA key generated from it — those keys
 * are meaningless without the seed that reproduces them, and orphaning them
 * would populate Accounts with entries no seed can regenerate."
 *
 * Each case guards a distinct regression:
 *   (a) a delete that dropped the seed but left its keys would leave Accounts
 *       showing entries no seed can ever regenerate; a delete that took the
 *       WRONG keys would destroy another seed's multi-hour RSA work. The
 *       callback must name exactly one seed's keys.
 *   (confirm) each key costs ~6.7 s of CPU; a one-click delete on the row would
 *       let a mis-click throw away hours of generation with no recourse.
 *   (b) the Master ArWeave Seed is LOCKED — no delete control at all. This
 *       clause used to say the opposite ("permanent in the SHIPPED build but
 *       deletable in development"); the owner overruled it
 *       (docs/work/locked-entities-and-former-prime/design.md §B3, owner
 *       decision 3: *"delete button should not be available for them"*),
 *       because deleting it leaves `codexMasterSeed.arweaveSeedId` dangling
 *       while the codex still reports its ArWeave face established.
 *   (c) the permanence warning must be on screen BEFORE the user confirms —
 *       after the fact it is not a warning.
 *   (d) a run is minutes-to-hours long. A run left alive after its seed is gone
 *       keeps calling `persistKey` for a seed that no longer exists, re-creating
 *       the exact orphans (a) exists to prevent.
 */
describe("ArweaveSeedsArea — deleting a seed cascades to its keys (T10)", () => {
  const SECOND_SEED: ArweaveSeedRecord = {
    id: "second",
    label: "Second Arweave Seed",
    bits: "0".repeat(SEED_BIT_LENGTH),
  };

  const PRIME_KEY_0 = makeKey({ id: "k-prime-0", seedId: "prime", index: 0, address: "ADDR-P0" });
  const PRIME_KEY_1 = makeKey({ id: "k-prime-1", seedId: "prime", index: 1, address: "ADDR-P1" });
  const SECOND_KEY_0 = makeKey({ id: "k-second-0", seedId: "second", index: 0, address: "ADDR-S0" });
  const SECOND_KEY_1 = makeKey({ id: "k-second-1", seedId: "second", index: 1, address: "ADDR-S1" });

  function deleteSeed(seedId: string): void {
    fireEvent.click(screen.getByTestId(`arweave-seed-delete-${seedId}`));
    fireEvent.click(screen.getByTestId(`arweave-seed-delete-confirm-${seedId}`));
  }

  // Re-pointed from the prime seed to the deletable one: the master row has no
  // delete control any more (owner decision 3). The cascade rule this guards —
  // EXACTLY one seed's keys, never a neighbour's — is unchanged.
  it("(a) invokes the delete callback with the seed id and the ids of EXACTLY that seed's keys, leaving another seed's keys untouched", async () => {
    const onDeleteSeed = vi.fn();
    renderArea({
      seeds: [PRIME_SEED, SECOND_SEED],
      existingKeys: [PRIME_KEY_0, SECOND_KEY_0, PRIME_KEY_1, SECOND_KEY_1],
      onDeleteSeed,
    });

    deleteSeed("second");

    await waitFor(() => expect(onDeleteSeed).toHaveBeenCalledTimes(1));
    const request = onDeleteSeed.mock.calls[0][0] as { seedId: string; keyIds: readonly string[] };
    expect(request.seedId).toBe("second");
    expect([...request.keyIds].sort()).toEqual(["k-second-0", "k-second-1"]);
    expect(request.keyIds).not.toContain("k-prime-0");
    expect(request.keyIds).not.toContain("k-prime-1");
  });

  it("(a) drops a legacy/indexless key of the same seed too — no derived key may survive the seed", async () => {
    const onDeleteSeed = vi.fn();
    const indexless = makeKey({ id: "k-second-noindex", seedId: "second" });
    renderArea({
      seeds: [PRIME_SEED, SECOND_SEED],
      existingKeys: [SECOND_KEY_0, indexless, PRIME_KEY_0],
      onDeleteSeed,
    });

    deleteSeed("second");

    await waitFor(() => expect(onDeleteSeed).toHaveBeenCalledTimes(1));
    const request = onDeleteSeed.mock.calls[0][0] as { keyIds: readonly string[] };
    expect([...request.keyIds].sort()).toEqual(["k-second-0", "k-second-noindex"]);
  });

  it("(a) removes the deleted seed's row, so a gone seed cannot be deleted twice", async () => {
    renderArea({
      seeds: [PRIME_SEED, SECOND_SEED],
      existingKeys: [SECOND_KEY_0],
      onDeleteSeed: vi.fn(),
    });

    deleteSeed("second");

    await waitFor(() => expect(screen.queryByTestId("arweave-seed-row-second")).toBeNull());
    expect(screen.getByTestId("arweave-prime-seed-row")).toHaveAttribute("data-defined", "true");
  });

  // Re-pointed from the prime seed to a deletable one — the master row no
  // longer HAS a first click to make. The confirm gate itself (one mis-click
  // must not destroy hours of RSA work) is unchanged and still covered.
  it("requires a CONFIRM — the first click alone destroys nothing", () => {
    const onDeleteSeed = vi.fn();
    renderArea({
      seeds: [PRIME_SEED, SECOND_SEED],
      existingKeys: [SECOND_KEY_0],
      onDeleteSeed,
    });

    fireEvent.click(screen.getByTestId("arweave-seed-delete-second"));

    expect(onDeleteSeed).not.toHaveBeenCalled();
    expect(screen.getByTestId("arweave-seed-delete-confirm-second")).toBeInTheDocument();
    expect(screen.getByTestId("arweave-seed-row-second")).toHaveAttribute("data-defined", "true");
  });

  // OWNER DECISION (design.md §B3, decision 3): *"delete button should not be
  // available for them"*. This test asserted the exact opposite — that the
  // PRIME row exposes a delete control, "deletable in development" — which is
  // the behaviour the owner has now overruled, because deleting the master
  // leaves `codexMasterSeed.arweaveSeedId` dangling while the codex still
  // reports its ArWeave face established. Rewritten to assert ABSENCE, plus
  // the Locked medallion that explains it. Deliberate, not a casualty.
  it("(b) renders NO delete control on the Master ArWeave Seed row — it is Locked", () => {
    renderArea({ seeds: [PRIME_SEED] });

    const prime = screen.getByTestId("arweave-prime-seed-row");
    expect(within(prime).queryByTestId("arweave-seed-delete-prime")).toBeNull();
    expect(within(prime).getByTestId("arweave-seed-locked-prime")).toBeInTheDocument();
  });

  it("(c) warns that the Prime Arweave Seed is permanent in the shipped build BEFORE the define is confirmed", () => {
    const onSeedDefined = vi.fn();
    renderArea({ onSeedDefined });
    openDefineForm();

    const warning = screen.getByTestId("arweave-seed-prime-permanence-warning");
    expect(warning.textContent).toMatch(/permanent/i);
    expect(onSeedDefined).not.toHaveBeenCalled();
  });

  it("(c) shows NO permanence warning when defining a LATER seed — only the Prime seed is one-way", () => {
    renderArea({ seeds: [PRIME_SEED] });

    fireEvent.click(screen.getByTestId("arweave-add-seed"));

    expect(screen.getByTestId("arweave-seed-define-form")).toBeInTheDocument();
    expect(screen.queryByTestId("arweave-seed-prime-permanence-warning")).toBeNull();
  });

  // Re-pointed from the prime seed to a deletable one (owner decision 3). The
  // rule it guards — a run left alive after ITS seed is gone keeps persisting
  // keys for a seed that no longer exists — is unchanged.
  it("(d) aborts a generation run in flight against the seed being deleted", async () => {
    const worker = new FakeWorker();
    const persistKey = vi.fn();
    renderArea({
      seeds: [PRIME_SEED, SECOND_SEED],
      existingKeys: [],
      persistKey,
      onDeleteSeed: vi.fn(),
      workerFactory: () => worker as unknown as Worker,
    });
    fireEvent.click(screen.getByTestId("arweave-seed-toggle-second"));
    fireEvent.change(screen.getByTestId("arweave-generate-mode"), { target: { value: "upTo" } });
    fireEvent.change(screen.getByTestId("arweave-generate-upto"), { target: { value: "5" } });
    fireEvent.click(screen.getByTestId("arweave-generate-run"));

    await waitFor(() => expect(worker.onmessage).not.toBeNull());
    worker.emit(keyMsg(0));
    await waitFor(() => expect(persistKey).toHaveBeenCalledTimes(1));

    deleteSeed("second");

    await waitFor(() => expect(worker.terminated).toBe(true));
  });

  it("(d) does NOT abort a run belonging to a DIFFERENT seed", async () => {
    const worker = new FakeWorker();
    renderArea({
      seeds: [PRIME_SEED, SECOND_SEED],
      existingKeys: [],
      persistKey: vi.fn(),
      onDeleteSeed: vi.fn(),
      workerFactory: () => worker as unknown as Worker,
    });
    fireEvent.click(screen.getByTestId("arweave-seed-toggle-prime"));
    fireEvent.click(screen.getByTestId("arweave-generate-run")); // Default — just #0

    await waitFor(() => expect(worker.onmessage).not.toBeNull());

    deleteSeed("second");

    await waitFor(() => expect(screen.queryByTestId("arweave-seed-row-second")).toBeNull());
    expect(worker.terminated).toBe(false);
  });
});

/**
 * The FIRST-EVER Arweave seed carries the name ITS USER typed — the golden
 * designation is DERIVED, never stored (`docs/work/prime-two-name-model/
 * design.md`, `former-master-record` T1).
 *
 * This describe block used to assert the opposite: the first seed's name field
 * was read-only, pre-filled with the master designation, and `confirmDefine`
 * discarded `labelText` outright for a prime definition. That was live DATA
 * LOSS — Arweave seeds have no rename UI at all, so a name thrown away here
 * could never be recovered. The owner's model: *"a prime seed or account has 2
 * names: its golden prime name, and its normal name, as every other account and
 * seed has [...] because as non-prime accounts become prime, their names
 * mangle."*
 *
 * Each case guards a distinct regression:
 *   (editable) with the field locked, a user simply cannot name their first
 *       seed — the master row is the one row with no rename escape hatch.
 *   (typed) the name reaching the record is the one the user typed, not the
 *       designation. This is THE data-loss assertion.
 *   (unnamed) no name typed means NO name stored — the row still reads as the
 *       master because the designation comes from the resolver, so inventing
 *       a stored title here would re-introduce the drift the model removes.
 */
describe("ArweaveSeedsArea — the first seed's name is the USER's (former-master-record T1)", () => {
  it("offers the first seed's name as an EDITABLE, empty field — the designation is not a stored name", () => {
    renderArea();
    openDefineForm();

    const name = screen.getByTestId("arweave-seed-label-input") as HTMLInputElement;
    expect(name.value).toBe("");
    expect(name).not.toHaveAttribute("readonly");
  });

  it("stores the first seed under the name the user typed, even though it becomes the master", async () => {
    const onSeedDefined = vi.fn();
    renderArea({ onSeedDefined });
    openDefineForm();

    fireEvent.change(screen.getByTestId("arweave-seed-label-input"), {
      target: { value: "My cold storage seed" },
    });
    fireEvent.change(screen.getByTestId("arweave-seed-words-input"), {
      target: { value: "hello world" },
    });
    fireEvent.click(screen.getByTestId("arweave-seed-confirm"));

    await waitFor(() => expect(onSeedDefined).toHaveBeenCalledTimes(1));
    const seed = onSeedDefined.mock.calls[0][0] as ArweaveSeedRecord;
    expect(seed.label).toBe("My cold storage seed");
    // It really is the prime/first seed — the name survived THAT role, which is
    // the whole point.
    expect(seed.isPrime).toBe(true);
  });

  it("stores NO name for a first seed the user left unnamed — it is not stamped with the designation", async () => {
    const onSeedDefined = vi.fn();
    renderArea({ onSeedDefined });
    openDefineForm();

    fireEvent.change(screen.getByTestId("arweave-seed-words-input"), {
      target: { value: "hello world" },
    });
    fireEvent.click(screen.getByTestId("arweave-seed-confirm"));

    await waitFor(() => expect(onSeedDefined).toHaveBeenCalledTimes(1));
    const seed = onSeedDefined.mock.calls[0][0] as ArweaveSeedRecord;
    expect(seed.label).toBe("");
    expect(seed.label).not.toBe(PRIME_SEED_LABEL);
  });

  // The Direct generator builds its OWN record, on its own code path — the
  // Seed-Based fix above does not reach it, and a user who defines their
  // first-ever seed from a bitstring loses their name just the same.
  it("keeps the typed name on a first seed defined through the DIRECT generator too", async () => {
    const onSeedDefined = vi.fn();
    renderArea({ onSeedDefined });
    openDefineForm();
    fireEvent.click(screen.getByTestId("arweave-seed-mode-direct"));
    fireEvent.click(screen.getByTestId("arweave-seed-direct-tile-bitstring"));
    fireEvent.change(screen.getByTestId("arweave-seed-direct-bitstring-input"), {
      target: { value: "01".repeat(800) },
    });
    fireEvent.change(screen.getByTestId("arweave-seed-label-input"), {
      target: { value: "Paper-wallet bits" },
    });
    fireEvent.click(screen.getByTestId("arweave-seed-confirm"));

    await waitFor(() => expect(onSeedDefined).toHaveBeenCalledTimes(1));
    const seed = onSeedDefined.mock.calls[0][0] as ArweaveSeedRecord;
    expect(seed.label).toBe("Paper-wallet bits");
    expect(seed.isPrime).toBe(true);
  });

  it("leaves a LATER seed's name free text, and uses what the user typed", async () => {
    const onSeedDefined = vi.fn();
    renderArea({ seeds: [PRIME_SEED], onSeedDefined });
    fireEvent.click(screen.getByTestId("arweave-add-seed"));

    const name = screen.getByTestId("arweave-seed-label-input") as HTMLInputElement;
    expect(name).not.toHaveAttribute("readonly");
    expect(name.value).toBe("");

    fireEvent.change(name, { target: { value: "Cold storage seed" } });
    fireEvent.change(screen.getByTestId("arweave-seed-words-input"), {
      target: { value: "hello world" },
    });
    fireEvent.click(screen.getByTestId("arweave-seed-confirm"));

    await waitFor(() => expect(onSeedDefined).toHaveBeenCalledTimes(1));
    const seed = onSeedDefined.mock.calls[0][0] as ArweaveSeedRecord;
    expect(seed.label).toBe("Cold storage seed");
    expect(seed.isPrime).not.toBe(true);
  });
});

/**
 * The Restricted word grid can be EMPTIED (T12 · 2).
 *
 * Once the 12/24 slots hold a phrase there is no way back: retyping a slot
 * replaces one word, and a user who pasted or generated the wrong phrase has to
 * clear up to 24 rectangles by hand (or close and reopen the whole define form,
 * losing the source/variant choice with it). A Clear control empties the grid in
 * one act and puts the refusal state back where it started.
 */
describe("ArweaveSeedsArea — the Restricted grid's Clear control (T12 · 2)", () => {
  function openRestricted(): void {
    renderArea();
    openDefineForm();
    // "Dictionary (12-word)" — the tile IS the count now.
    fireEvent.click(screen.getByTestId("arweave-seed-input-tile-dict12"));
  }

  it("empties every slot and resets the validation state in one click", () => {
    openRestricted();

    fillWordSlots([
      "abandon", "zzzznotaword", "able", "about", "above", "absent",
      "absorb", "abstract", "absurd", "abuse", "access", "accident",
    ]);
    expect(wordSlot(1)).toHaveAttribute("data-invalid", "true");
    expect(screen.getByTestId("arweave-seed-restricted-notice")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("arweave-seed-clear-words"));

    expect(currentWordSlotValues().every((value) => value === "")).toBe(true);
    // The refusal state goes with the words — an empty slot is incomplete, not
    // wrong, so no slot may stay painted red after a clear.
    expect(wordSlot(1)).toHaveAttribute("data-invalid", "false");
    expect(screen.queryByTestId("arweave-seed-restricted-notice")).toBeNull();
    // And an empty grid cannot define a seed.
    expect(screen.getByTestId("arweave-seed-confirm")).toBeDisabled();
  });

  it("keeps the SELECTED phrase length — clearing 24 slots leaves 24 empty slots", async () => {
    openRestricted();
    fireEvent.click(screen.getByTestId("arweave-seed-input-tile-dict24"));
    fireEvent.click(screen.getByTestId("arweave-seed-random-phrase"));
    await waitFor(() => expect(wordSlotInput(23).value).not.toBe(""));

    fireEvent.click(screen.getByTestId("arweave-seed-clear-words"));

    expect(screen.getAllByTestId(/^arweave-seed-word-slot-\d+$/)).toHaveLength(24);
    expect(currentWordSlotValues()).toEqual(Array.from({ length: 24 }, () => ""));
    expect(screen.getByTestId("arweave-seed-input-tile-dict24")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("is offered only by a Dictionary tile — Stoa Dalos has no word grid to clear", () => {
    renderArea();
    openDefineForm();

    expect(screen.queryByTestId("arweave-seed-clear-words")).toBeNull();
    fireEvent.click(screen.getByTestId("arweave-seed-input-tile-dict12"));
    expect(screen.getByTestId("arweave-seed-clear-words")).toBeInTheDocument();
  });
});

/**
 * Per-key run progress, and the RSA parameters behind a reveal (T12 · 3).
 *
 * A run is ~6.7 s PER KEY: 100 keys is ~11 minutes and 1000 is ~1.9 h. A single
 * "Generated 2 of 100" line leaves the user with no way to tell a live run from
 * a hung one, no sense of how long is left, and no sight of what was actually
 * produced. Each case guards a distinct regression:
 *   (index) the position in flight must be named — without it a multi-minute
 *       gap between two lines is indistinguishable from a stall.
 *   (bar/eta) an 11-minute wait with no proportion and no remaining time reads
 *       as frozen, and the user cancels a working run.
 *   (address) the Arweave address IS the key's identity; a run that produces
 *       nothing visible cannot be checked against Accounts.
 *   (SECURITY) `d`, `p`, `q`, `dp`, `dq`, `qi` reconstruct the whole private
 *       key. They must not reach the DOM at all before an explicit reveal —
 *       blur alone leaves them copyable, screen-readable and in the page source.
 */
describe("ArweaveSeedsArea — run progress and RSA parameters (T12 · 3)", () => {
  function revealingKeyMsg(index: number): KeygenWorkerMsg {
    return { kind: "key", index, jwk: DECIMAL_JWK, address: `ADDR-${index}` };
  }

  /** Starts an `Up to N` run against the Prime seed and returns its fake worker. */
  async function startUpTo(n: number): Promise<{ worker: FakeWorker; persistKey: ReturnType<typeof vi.fn> }> {
    const worker = new FakeWorker();
    const persistKey = vi.fn();
    renderArea({
      seeds: [PRIME_SEED],
      existingKeys: [],
      persistKey,
      workerFactory: () => worker as unknown as Worker,
    });
    fireEvent.click(screen.getByTestId("arweave-seed-toggle-prime"));
    fireEvent.change(screen.getByTestId("arweave-generate-mode"), { target: { value: "upTo" } });
    fireEvent.change(screen.getByTestId("arweave-generate-upto"), { target: { value: String(n) } });
    fireEvent.click(screen.getByTestId("arweave-generate-run"));
    await waitFor(() => expect(worker.onmessage).not.toBeNull());
    return { worker, persistKey };
  }

  it("names the position IN FLIGHT and where it sits in the run, advancing as keys arrive", async () => {
    const { worker, persistKey } = await startUpTo(3); // #0..#3 = 4 positions

    const current = () => screen.getByTestId("arweave-generate-current").textContent ?? "";
    expect(current()).toContain("#0");
    expect(current()).toContain("1 of 4");

    worker.emit(revealingKeyMsg(0));
    await waitFor(() => expect(persistKey).toHaveBeenCalledTimes(1));

    expect(screen.getByTestId("arweave-generate-progress").textContent).toContain("1 of 4");
    await waitFor(() => expect(current()).toContain("#1"));
    expect(current()).toContain("2 of 4");
  });

  it("shows the run's completion as a proportion that moves with each key", async () => {
    const { worker, persistKey } = await startUpTo(3);

    expect(screen.getByTestId("arweave-generate-progress-bar")).toHaveAttribute("data-percent", "0");

    worker.emit(revealingKeyMsg(0));
    await waitFor(() => expect(persistKey).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByTestId("arweave-generate-progress-bar")).toHaveAttribute(
        "data-percent",
        "25",
      ),
    );
  });

  it("states how long a 100-key run still has to go, in minutes — not in keys", async () => {
    await startUpTo(99); // #0..#99 = 100 positions, the first-run ceiling

    // 100 keys × ~6.7 s ≈ 11 minutes, the figure design.md uses for this run.
    expect(screen.getByTestId("arweave-generate-eta").textContent).toContain("11 min");
  });

  it("shows each generated key's Arweave ADDRESS as its headline", async () => {
    const { worker, persistKey } = await startUpTo(1);

    worker.emit(revealingKeyMsg(0));
    worker.emit(revealingKeyMsg(1));
    await waitFor(() => expect(persistKey).toHaveBeenCalledTimes(2));

    await waitFor(() =>
      expect(screen.getAllByTestId(/^arweave-generate-key-row-\d+$/)).toHaveLength(2),
    );
    expect(screen.getByTestId("arweave-generate-key-address-0").textContent).toBe("ADDR-0");
    expect(screen.getByTestId("arweave-generate-key-address-1").textContent).toBe("ADDR-1");
  });

  it("SECURITY: keeps the private RSA parameters OUT of the DOM until the user explicitly reveals them, and hides them again", async () => {
    const { worker, persistKey } = await startUpTo(1);

    worker.emit(revealingKeyMsg(0));
    await waitFor(() => expect(persistKey).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId("arweave-generate-key-address-0")).toBeInTheDocument());

    const secrets = PRIVATE_MATERIAL;

    // Nothing secret is on the page — not as text, not in an attribute.
    for (const secret of secrets) expect(document.body.innerHTML).not.toContain(secret);

    // Opening the parameter panel is NOT a reveal: the values stay masked.
    fireEvent.click(screen.getByTestId("arweave-generate-key-params-toggle-0"));
    expect(screen.getByTestId("arweave-generate-key-params-0")).toBeInTheDocument();
    for (const secret of secrets) expect(document.body.innerHTML).not.toContain(secret);

    fireEvent.click(screen.getByTestId("arweave-generate-key-reveal-0"));

    expect(screen.getByTestId("arweave-generate-key-param-0-d").textContent).toBe(DECIMALS.d);
    for (const name of ["n", "e", "d", "p", "q", "dp", "dq", "qi"]) {
      expect(screen.getByTestId(`arweave-generate-key-param-0-${name}`)).toBeInTheDocument();
    }

    // Hiding takes them back out of the DOM — a one-way reveal would leave the
    // private key on screen for the rest of the run.
    fireEvent.click(screen.getByTestId("arweave-generate-key-reveal-0"));
    for (const secret of secrets) expect(document.body.innerHTML).not.toContain(secret);
  });

  it("PERFORMANCE: never touches a fresh key's JWK members until that key's OWN RSA-parameters panel is opened", async () => {
    // Regression: reopening a seed mid-run (or after one) re-mounts every
    // already-delivered "fresh" key row at once, each handed its jwk directly
    // as a prop. If decimal conversion ran unconditionally on mount, N
    // already-delivered keys would ALL pay that cost simultaneously the
    // instant the row reopens — this is what made reopening stall. Getters
    // prove the fix precisely: nothing may read a member before the panel for
    // THAT key is explicitly expanded, and only that key's members are read.
    let reads = 0;
    const countingJwk = { kty: "RSA", e: "AQAB" } as unknown as ArweaveJwk;
    for (const name of ["n", "d", "p", "q", "dp", "dq", "qi"]) {
      Object.defineProperty(countingJwk, name, {
        get() {
          reads++;
          return "AQAB";
        },
      });
    }

    const worker = new FakeWorker();
    const persistKey = vi.fn();
    renderArea({
      seeds: [PRIME_SEED],
      existingKeys: [],
      persistKey,
      workerFactory: () => worker as unknown as Worker,
    });
    fireEvent.click(screen.getByTestId("arweave-seed-toggle-prime"));
    fireEvent.click(screen.getByTestId("arweave-generate-run")); // default mode = position 0 only
    await waitFor(() => expect(worker.onmessage).not.toBeNull());

    worker.emit({ kind: "key", index: 0, jwk: countingJwk, address: "ADDR-0" });
    await waitFor(() => expect(persistKey).toHaveBeenCalledTimes(1));

    // The row exists and rendered its collapsed summary — but nothing read
    // the JWK's members to get there.
    expect(screen.getByTestId("arweave-generate-key-row-0")).toBeInTheDocument();
    expect(reads).toBe(0);

    fireEvent.click(screen.getByTestId("arweave-generate-key-params-toggle-0"));

    expect(reads).toBeGreaterThan(0);
  });
});

/**
 * base64url → decimal (T13 · 1).
 *
 * The Crypto Lab prints an RSA key's parameters as PLAIN DECIMAL integers
 * (`r.key.n.toString()`), because that is what an RSA key actually is. This
 * surface cannot take that path: a persisted key is an encrypted JWK, whose
 * parameters are base64url big-endian byte strings. So the decimals have to be
 * re-derived, and one decoder must serve BOTH the freshly generated and the
 * stored key — two decoders would let the same key print two different moduli.
 *
 * Each case guards a real mistake:
 *   (AQAB) the canonical vector. `e` is 65537 on every RSA key ever generated
 *       here; a decoder that prints anything else for `AQAB` is broken, and the
 *       user has no way to tell a wrong modulus from a right one by eye.
 *   (-/_) base64URL is NOT base64. Feeding `-`/`_` to a plain base64 decoder
 *       yields a different integer — silently, for exactly the keys unlucky
 *       enough to contain those bytes.
 *   (padding) JWK members are unpadded; a decoder that only accepts `=`-padded
 *       input fails on real keys.
 *   (invalid/empty) a malformed member must degrade to "unknown", never throw
 *       inside a render and blank the whole panel.
 */
describe("base64UrlToDecimal — the JWK parameter decoder (T13 · 1)", () => {
  it("decodes the canonical public exponent AQAB to 65537", () => {
    expect(base64UrlToDecimal("AQAB")).toBe("65537");
  });

  it("treats `-` and `_` as base64URL, not as base64 `+`/`/`", () => {
    expect(base64UrlToDecimal("3q2-7w")).toBe("3735928559"); // 0xDEADBEEF
    expect(base64UrlToDecimal("__8")).toBe("65535"); // 0xFFFF
  });

  it("accepts an unpadded member, as JWK emits it, and a padded one alike", () => {
    expect(base64UrlToDecimal("AQ")).toBe("1");
    expect(base64UrlToDecimal("AQ==")).toBe("1");
  });

  it("decodes a multi-byte big-endian value, most significant byte first", () => {
    expect(base64UrlToDecimal("ASNFZ4mrze8")).toBe("81985529216486895"); // 0x0123456789ABCDEF
  });

  it("returns null for an empty or malformed member instead of throwing", () => {
    expect(base64UrlToDecimal("")).toBeNull();
    expect(base64UrlToDecimal("!!not-base64!!")).toBeNull();
  });
});

/**
 * The Crypto Lab's RSA-parameter panel, ported EXACTLY (T13 · 2).
 *
 * The reference is StoicDigest `src/pages/lab/seed.astro` — `field()`, `DEFS`
 * and `download()`. The user asked for that panel, not a redesign of it, and
 * these cases pin the parts a redesign would quietly drift away from:
 *   (rows) eight parameters, in the Lab's order, under the Lab's labels. `Prime
 *       p` read as `p` is a letter a human cannot interpret; a missing row makes
 *       that parameter unreachable in the Codex.
 *   (defs) the tooltips are the only explanation of what these numbers ARE.
 *       Paraphrasing them is how two surfaces start teaching two things.
 *   (decimals) an RSA parameter is an integer. Printing the base64url JWK
 *       member shows `3q2-7w` where the Lab shows `3735928559` — the same key,
 *       unrecognisably different, and uncheckable against the Lab.
 *   (reveal) a reveal on `n` claims the public modulus is secret; a MISSING
 *       reveal on `p` makes the parameter unreachable. Per-row, so looking at
 *       one prime does not put the whole private key on screen.
 *   (copy) the value is middle-truncated on screen. A copy that carried what is
 *       VISIBLE would hand the user a silently broken key.
 *   (downloads) the keyfile is how the key leaves the Codex at all.
 *
 * THE BUG THIS FIXES: the panel hung off the freshly-generated run list only,
 * so a key already stored under a seed had no way to show its parameters — the
 * button "disappeared" for every key the user came back to.
 */
describe("ArweaveSeedsArea — the ported RSA-parameter panel (T13 · 2)", () => {
  /** The eight rows, in the Crypto Lab's order, with its exact labels and its
   *  exact private/public split. */
  const RSA_ROWS: ReadonlyArray<readonly [name: string, label: string, priv: boolean]> = [
    ["n", "Modulus  n = p × q", false],
    ["e", "Public exponent e", false],
    ["p", "Prime p", true],
    ["q", "Prime q", true],
    ["d", "Private exponent d", true],
    ["dp", "dp", true],
    ["dq", "dq", true],
    ["qi", "qi", true],
  ];

  /** `DEFS` in seed.astro, verbatim. Pinned here because "verbatim" is the
   *  requirement: a paraphrase passes every other assertion in this file. */
  const DEFS: Record<string, string> = {
    arw: "The 43-character Arweave address others send AR to — Base64URL(SHA-256(n)), the hash of this key’s modulus. Public.",
    n: "The RSA modulus — the product of the two secret primes, n = p × q. Its 4096-bit size is the key’s strength. Public.",
    e: "The public exponent, always 65537 — the number used when encrypting or verifying. Public.",
    d: "The private exponent — the inverse of e modulo λ(n). The core secret used to sign or decrypt. Private.",
    p: "One of the two large secret primes whose product is the modulus n. Learning p (or q) breaks the key. Private.",
    q: "The other secret prime; n = p × q. Private.",
    dp: "CRT exponent d mod (p − 1) — a precomputed value that speeds up private operations. Private.",
    dq: "CRT exponent d mod (q − 1). Private.",
    qi: "CRT coefficient q⁻¹ mod p — the other Chinese-Remainder-Theorem speedup. Private.",
  };

  const STORED_ADDRESS = "STORED-ADDRESS-9";

  /** Mounts the area with ONE already-stored key under the Prime seed, opens
   *  the seed and expands that key's RSA parameters. */
  async function openStoredKeyPanel(
    props: Partial<ArweaveSeedsAreaProps> = {},
  ): Promise<{ decryptArweaveKey: ReturnType<typeof vi.fn> }> {
    const decryptArweaveKey = vi.fn(async () => DECIMAL_JWK);
    renderArea({
      seeds: [PRIME_SEED],
      existingKeys: [
        makeKey({ id: "stored-9", seedId: "prime", index: 9, address: STORED_ADDRESS }),
      ],
      decryptArweaveKey,
      ...props,
    });
    fireEvent.click(screen.getByTestId("arweave-seed-toggle-prime"));
    fireEvent.click(screen.getByTestId("arweave-seed-key-params-toggle-9"));
    await waitFor(() =>
      expect(screen.getByTestId("arweave-seed-key-params-9")).toBeInTheDocument(),
    );
    return { decryptArweaveKey };
  }

  /** Mounts a run, delivers key #0 and expands its RSA parameters. */
  async function openGeneratedKeyPanel(): Promise<void> {
    const worker = new FakeWorker();
    const persistKey = vi.fn();
    renderArea({
      seeds: [PRIME_SEED],
      existingKeys: [],
      persistKey,
      workerFactory: () => worker as unknown as Worker,
    });
    fireEvent.click(screen.getByTestId("arweave-seed-toggle-prime"));
    fireEvent.click(screen.getByTestId("arweave-generate-run"));
    await waitFor(() => expect(worker.onmessage).not.toBeNull());
    worker.emit({ kind: "key", index: 0, jwk: DECIMAL_JWK, address: "ADDR-0" });
    await waitFor(() => expect(persistKey).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByTestId("arweave-generate-key-params-toggle-0"));
    await waitFor(() =>
      expect(screen.getByTestId("arweave-generate-key-params-0")).toBeInTheDocument(),
    );
  }

  it("renders the eight parameters in the Crypto Lab's order, under its exact labels", async () => {
    await openGeneratedKeyPanel();

    const labels = screen
      .getAllByTestId(/^arweave-generate-key-label-0-/)
      .map((el) => el.textContent);
    // The address is the headline, then the eight parameters in the Lab's order.
    expect(labels).toEqual(["Arweave address", ...RSA_ROWS.map(([, label]) => label)]);
  });

  it("carries the Crypto Lab's tooltip for every parameter AND for the address", async () => {
    await openGeneratedKeyPanel();

    for (const [name] of RSA_ROWS) {
      expect(screen.getByTestId(`arweave-generate-key-tip-0-${name}`).textContent).toBe(
        DEFS[name],
      );
    }
    expect(screen.getByTestId("arweave-generate-key-tip-0-address").textContent).toBe(DEFS.arw);
  });

  it("prints each parameter as its DECIMAL integer, never the base64url JWK member", async () => {
    await openGeneratedKeyPanel();
    fireEvent.click(screen.getByTestId("arweave-generate-key-reveal-0"));

    for (const [name] of RSA_ROWS) {
      expect(screen.getByTestId(`arweave-generate-key-param-0-${name}`).textContent).toBe(
        DECIMALS[name],
      );
    }
  });

  it("gives every private parameter a reveal control and neither public one", async () => {
    await openGeneratedKeyPanel();

    for (const [name, , priv] of RSA_ROWS) {
      const reveal = screen.queryByTestId(`arweave-generate-key-field-reveal-0-${name}`);
      if (priv) expect(reveal).toBeInTheDocument();
      else expect(reveal).toBeNull();
    }
    // The address is public too — the headline the user checks against Accounts.
    expect(screen.queryByTestId("arweave-generate-key-field-reveal-0-address")).toBeNull();
  });

  it("reveals ONLY the row whose eye was clicked — one prime is not the whole key", async () => {
    await openGeneratedKeyPanel();

    fireEvent.click(screen.getByTestId("arweave-generate-key-field-reveal-0-p"));

    expect(screen.getByTestId("arweave-generate-key-param-0-p").textContent).toBe(DECIMALS.p);
    for (const name of ["d", "q", "dp", "dq", "qi"]) {
      expect(document.body.innerHTML).not.toContain(DECIMALS[name]!);
    }

    // …and clicking it again puts it back out of the DOM.
    fireEvent.click(screen.getByTestId("arweave-generate-key-field-reveal-0-p"));
    expect(document.body.innerHTML).not.toContain(DECIMALS.p!);
  });

  it("copies the FULL value, not the middle-truncated text on screen", async () => {
    const writeText = vi.fn();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    await openGeneratedKeyPanel();
    fireEvent.click(screen.getByTestId("arweave-generate-key-copy-0-n"));

    expect(writeText).toHaveBeenCalledWith(DECIMALS.n);
  });

  it("splits the value into a shrinking head and a never-shrinking 8-character tail", async () => {
    await openGeneratedKeyPanel();
    fireEvent.click(screen.getByTestId("arweave-generate-key-reveal-0"));

    const full = DECIMALS.n!;
    expect(screen.getByTestId("arweave-generate-key-param-0-n-head").textContent).toBe(
      full.slice(0, -8),
    );
    expect(screen.getByTestId("arweave-generate-key-param-0-n-tail").textContent).toBe(
      full.slice(-8),
    );
  });

  it("offers the Crypto Lab's three downloads for the key", async () => {
    await openGeneratedKeyPanel();

    expect(screen.getByTestId("arweave-generate-key-download-json-0").textContent).toBe(
      "Arweave keyfile (.json)",
    );
    expect(screen.getByTestId("arweave-generate-key-download-priv-0").textContent).toBe(
      "Private key (.pem)",
    );
    expect(screen.getByTestId("arweave-generate-key-download-pub-0").textContent).toBe(
      "Public key (.pem)",
    );
  });

  it("downloads the Arweave keyfile as `arweave-{address}.json` holding the JWK itself", async () => {
    const blobs: Blob[] = [];
    const anchors: HTMLAnchorElement[] = [];
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: (blob: Blob) => {
        blobs.push(blob);
        return "blob:stub";
      },
      revokeObjectURL: () => {},
    });
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        anchors.push(this);
      });

    try {
      await openGeneratedKeyPanel();
      fireEvent.click(screen.getByTestId("arweave-generate-key-download-json-0"));

      await waitFor(() => expect(anchors).toHaveLength(1));
      expect(anchors[0]!.download).toBe("arweave-ADDR-0.json");
      expect(await blobs[0]!.text()).toBe(JSON.stringify(DECIMAL_JWK, null, 2));
    } finally {
      clickSpy.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  /* ── THE REPORTED BUG: a STORED key must have the panel too ── */

  it("hangs the SAME panel off a key already stored under the seed, decrypting it on demand", async () => {
    const { decryptArweaveKey } = await openStoredKeyPanel();

    expect(decryptArweaveKey).toHaveBeenCalledTimes(1);
    expect(decryptArweaveKey.mock.calls[0]![0]).toMatchObject({ id: "stored-9", index: 9 });

    const labels = screen
      .getAllByTestId(/^arweave-seed-key-label-9-/)
      .map((el) => el.textContent);
    expect(labels).toEqual(["Arweave address", ...RSA_ROWS.map(([, label]) => label)]);

    fireEvent.click(screen.getByTestId("arweave-seed-key-reveal-9"));
    for (const [name] of RSA_ROWS) {
      expect(screen.getByTestId(`arweave-seed-key-param-9-${name}`).textContent).toBe(
        DECIMALS[name],
      );
    }
    expect(screen.getByTestId("arweave-seed-key-download-json-9")).toBeInTheDocument();
  });

  // Round 22 owner correction: "then i think we have a problem here when
  // attempting to show RSA details" — a locked codex made `decryptArweaveKey`
  // throw straight into a dead-end error message. Now gated behind the
  // injected `ensureCodexUnlocked` prop (see `RsaParamsSectionProps`'s own
  // doc comment for why it's injected rather than called directly).
  describe("gates decrypt behind the injected ensureCodexUnlocked (round 22)", () => {
    it("calls it BEFORE decryptArweaveKey, and proceeds to decrypt once it resolves true", async () => {
      const ensureCodexUnlocked = vi.fn(async () => true);
      const { decryptArweaveKey } = await openStoredKeyPanel({ ensureCodexUnlocked });
      expect(ensureCodexUnlocked).toHaveBeenCalledTimes(1);
      expect(decryptArweaveKey).toHaveBeenCalledTimes(1);
    });

    it("a cancelled prompt (resolves false) skips decryptArweaveKey entirely — no error shown", async () => {
      const ensureCodexUnlocked = vi.fn(async () => false);
      const { decryptArweaveKey } = await openStoredKeyPanel({ ensureCodexUnlocked });
      expect(ensureCodexUnlocked).toHaveBeenCalledTimes(1);
      expect(decryptArweaveKey).not.toHaveBeenCalled();
      expect(screen.queryByTestId("arweave-seed-key-params-error-9")).toBeNull();
    });

    it("omitted (the default) proceeds straight to decryptArweaveKey — byte-identical to before this prop existed", async () => {
      const { decryptArweaveKey } = await openStoredKeyPanel();
      expect(decryptArweaveKey).toHaveBeenCalledTimes(1);
    });
  });

  // Round 25 owner correction: "couldnt add a new RSA key, codex is
  // locked" — `startRun` (key generation) now gates on the SAME injected
  // `ensureCodexUnlocked` prop, spawning the worker only once it resolves.
  describe("startRun gates on the injected ensureCodexUnlocked prop (round 25)", () => {
    it("a cancelled prompt (resolves false) never spawns the worker — no wasted crypto search", async () => {
      const ensureCodexUnlocked = vi.fn(async () => false);
      const workerFactory = vi.fn(() => new FakeWorker() as unknown as Worker);
      renderArea({
        seeds: [PRIME_SEED],
        workerFactory,
        persistKey: vi.fn(),
        ensureCodexUnlocked,
      });
      fireEvent.click(screen.getByTestId("arweave-seed-toggle-prime"));
      fireEvent.click(screen.getByTestId("arweave-generate-run"));
      await waitFor(() => expect(ensureCodexUnlocked).toHaveBeenCalledTimes(1));
      expect(workerFactory).not.toHaveBeenCalled();
    });

    it("resolving true proceeds to spawn the worker as before", async () => {
      const ensureCodexUnlocked = vi.fn(async () => true);
      const worker = new FakeWorker();
      const workerFactory = vi.fn(() => worker as unknown as Worker);
      renderArea({
        seeds: [PRIME_SEED],
        workerFactory,
        persistKey: vi.fn(),
        ensureCodexUnlocked,
      });
      fireEvent.click(screen.getByTestId("arweave-seed-toggle-prime"));
      fireEvent.click(screen.getByTestId("arweave-generate-run"));
      await waitFor(() => expect(workerFactory).toHaveBeenCalledTimes(1));
    });

    it("omitted (the default) proceeds straight to the worker — byte-identical to before this prop existed", async () => {
      const worker = new FakeWorker();
      const workerFactory = vi.fn(() => worker as unknown as Worker);
      renderArea({ seeds: [PRIME_SEED], workerFactory, persistKey: vi.fn() });
      fireEvent.click(screen.getByTestId("arweave-seed-toggle-prime"));
      fireEvent.click(screen.getByTestId("arweave-generate-run"));
      await waitFor(() => expect(workerFactory).toHaveBeenCalledTimes(1));
    });
  });

  it("SECURITY: a stored key's parameters are decrypted but stay OUT of the DOM until revealed", async () => {
    await openStoredKeyPanel();

    for (const secret of PRIVATE_MATERIAL) {
      expect(document.body.innerHTML).not.toContain(secret);
    }
  });

  it("does NOT decrypt a stored key until its panel is expanded", () => {
    const decryptArweaveKey = vi.fn(async () => DECIMAL_JWK);
    renderArea({
      seeds: [PRIME_SEED],
      existingKeys: [
        makeKey({ id: "stored-9", seedId: "prime", index: 9, address: STORED_ADDRESS }),
      ],
      decryptArweaveKey,
    });
    fireEvent.click(screen.getByTestId("arweave-seed-toggle-prime"));

    expect(screen.getByTestId("arweave-seed-key-params-toggle-9")).toBeInTheDocument();
    expect(decryptArweaveKey).not.toHaveBeenCalled();
  });

  it("still offers the panel with NO decrypt seam, and says why it cannot show the numbers", () => {
    renderArea({
      seeds: [PRIME_SEED],
      existingKeys: [
        makeKey({ id: "stored-9", seedId: "prime", index: 9, address: STORED_ADDRESS }),
      ],
    });
    fireEvent.click(screen.getByTestId("arweave-seed-toggle-prime"));
    fireEvent.click(screen.getByTestId("arweave-seed-key-params-toggle-9"));

    expect(screen.getByTestId("arweave-seed-key-params-error-9").textContent).toMatch(/decrypt/i);
    expect(screen.queryByTestId("arweave-seed-key-param-9-n")).toBeNull();
  });

  it("surfaces a failed decrypt (locked codex) inline instead of an empty panel", async () => {
    const decryptArweaveKey = vi.fn(async () => {
      throw new Error("Codex is locked.");
    });
    renderArea({
      seeds: [PRIME_SEED],
      existingKeys: [
        makeKey({ id: "stored-9", seedId: "prime", index: 9, address: STORED_ADDRESS }),
      ],
      decryptArweaveKey: decryptArweaveKey as unknown as ArweaveSeedsAreaProps["decryptArweaveKey"],
    });
    fireEvent.click(screen.getByTestId("arweave-seed-toggle-prime"));
    fireEvent.click(screen.getByTestId("arweave-seed-key-params-toggle-9"));

    await waitFor(() =>
      expect(screen.getByTestId("arweave-seed-key-params-error-9").textContent).toContain(
        "Codex is locked.",
      ),
    );
  });
});

/**
 * The Crypto Lab status line (Stoic Digest parity).
 *
 * The library restates `attempts` for the search currently in flight, so a naive
 * sum over events over-counts wildly. The grand total must therefore track a
 * high-water mark per (index, stage) — this is the regression that guards it.
 */
describe("<ArweaveSeedsArea> — Crypto Lab status line", () => {
  it("accumulates grand attempts per (index,stage) instead of summing restatements", () => {
    // Mirrors the component's accumulator exactly.
    const seen = new Map<string, number>();
    let grand = 0;
    const feed = (index: number, stage: "p" | "q", attempts: number) => {
      const k = `${index}:${stage}`;
      grand += attempts - (seen.get(k) ?? 0);
      seen.set(k, attempts);
    };

    // One search restating 10 → 25 → 40 contributes 40, not 75.
    feed(0, "p", 10);
    feed(0, "p", 25);
    feed(0, "p", 40);
    expect(grand).toBe(40);

    // A different stage on the same index accumulates independently.
    feed(0, "q", 12);
    expect(grand).toBe(52);

    // And a different index likewise.
    feed(1, "p", 7);
    expect(grand).toBe(59);
  });
});

/**
 * Regressions from hands-on review.
 *
 * (1) The public parameters rendered as a solid bar of bullets: the mask keyed
 *     off `revealed` alone and ignored `priv`, so `n` and `e` — which are public
 *     and must ALWAYS show their digits — were masked like secrets.
 * (2) The download buttons no-oped on a stored key, because `download()` returns
 *     early while the JWK is still ciphertext. Silent dead buttons read as broken.
 */
describe("<ArweaveSeedsArea> — RSA panel regressions", () => {
  // Local fixtures: the suite above scopes its own inside its describe.
  const STORED_ADDRESS = "STORED-ADDRESS-9";

  it("never masks a PUBLIC parameter: n and e show digits while the private six stay hidden", async () => {
    const decryptArweaveKey = vi.fn(async () => DECIMAL_JWK);
    renderArea({
      seeds: [PRIME_SEED],
      existingKeys: [
        makeKey({ id: "stored-9", seedId: "prime", index: 9, address: STORED_ADDRESS }),
      ],
      decryptArweaveKey: decryptArweaveKey as unknown as ArweaveSeedsAreaProps["decryptArweaveKey"],
    });
    fireEvent.click(screen.getByTestId("arweave-seed-toggle-prime"));
    fireEvent.click(screen.getByTestId("arweave-seed-key-params-toggle-9"));
    await waitFor(() => expect(screen.getByTestId("arweave-seed-key-param-9-n")).toBeTruthy());

    // Public: real decimal digits, never the bullet substitute.
    for (const name of ["n", "e"]) {
      const cell = screen.getByTestId(`arweave-seed-key-param-9-${name}`);
      expect(cell.textContent ?? "").toContain(DECIMALS[name]!.slice(0, 4));
      expect(cell.textContent ?? "").not.toContain("\u2022");
    }
    // Private: masked until explicitly revealed.
    for (const name of ["p", "q", "d", "dp", "dq", "qi"]) {
      expect(screen.getByTestId(`arweave-seed-key-param-9-${name}`).textContent ?? "").toContain(
        "\u2022",
      );
    }
  });

  it("enables all three downloads once a stored key has been decrypted", async () => {
    const decryptArweaveKey = vi.fn(async () => DECIMAL_JWK);
    renderArea({
      seeds: [PRIME_SEED],
      existingKeys: [
        makeKey({ id: "stored-9", seedId: "prime", index: 9, address: STORED_ADDRESS }),
      ],
      decryptArweaveKey: decryptArweaveKey as unknown as ArweaveSeedsAreaProps["decryptArweaveKey"],
    });
    fireEvent.click(screen.getByTestId("arweave-seed-toggle-prime"));
    fireEvent.click(screen.getByTestId("arweave-seed-key-params-toggle-9"));

    // Downloads only exist once the JWK is in hand — before the decrypt lands
    // there is nothing to build a file from. After it, all three are live.
    await waitFor(() =>
      expect(screen.getByTestId("arweave-seed-key-download-json-9")).toBeInTheDocument(),
    );
    for (const kind of ["json", "priv", "pub"]) {
      expect(
        (screen.getByTestId(`arweave-seed-key-download-${kind}-9`) as HTMLButtonElement).disabled,
      ).toBe(false);
    }
  });
});

/**
 * The generator on TOP, the addresses BELOW it, and the pending positions in
 * between (T15).
 *
 * The Position/Generator box is for CHOOSING and WATCHING a run, not for
 * holding its output: it used to stack every delivered key inside itself, which
 * pushed the selector and Cancel off screen and split the seed's addresses
 * across two lists. Each case guards a distinct regression:
 *   (order) the control the user acts on must sit ABOVE the list it grows —
 *       with the list first, a seed holding 200 addresses hides its own
 *       Generate button below a screenful of keys.
 *   (no keys in the box) a key rendered inside the generate box is a key
 *       rendered TWICE once the store refreshes, and a box that scrolls away
 *       from its own Cancel during a multi-minute run.
 *   (pending) generation is ~6.7 s PER KEY, so a 100-position run is minutes of
 *       apparently nothing happening. The planned positions have to be VISIBLE
 *       as empty rows from the first second, or the list looks inert.
 *   (in place) a key must land in ITS OWN position's row — a key appended to
 *       the end while its pending row lingers shows #1 twice.
 *   (cancel) "we remain with no empty positions": a pending row surviving a
 *       cancelled run is an address the user does not have.
 */
describe("ArweaveSeedsArea — generate box on top, pending positions in the list (T15)", () => {
  async function startUpTo(
    n: number,
    props: Partial<ArweaveSeedsAreaProps> = {},
  ): Promise<{
    worker: FakeWorker;
    persistKey: ReturnType<typeof vi.fn>;
    view: ReturnType<typeof renderArea>;
  }> {
    const worker = new FakeWorker();
    const persistKey = vi.fn();
    const view = renderArea({
      seeds: [PRIME_SEED],
      existingKeys: [],
      persistKey,
      workerFactory: () => worker as unknown as Worker,
      ...props,
    });
    fireEvent.click(screen.getByTestId("arweave-seed-toggle-prime"));
    fireEvent.change(screen.getByTestId("arweave-generate-mode"), { target: { value: "upTo" } });
    fireEvent.change(screen.getByTestId("arweave-generate-upto"), { target: { value: String(n) } });
    fireEvent.click(screen.getByTestId("arweave-generate-run"));
    await waitFor(() => expect(worker.onmessage).not.toBeNull());
    return { worker, persistKey, view };
  }

  /** Every row of the seed's address list, pending or filled, in DOM order. */
  function listedIndices(): string[] {
    return within(screen.getByTestId("arweave-seed-addresses-prime"))
      .getAllByTestId(/^arweave-(seed-pending|generate-key|seed-key)-row-\d+$/)
      .map((row) => row.getAttribute("data-index") ?? "");
  }

  function pendingIndices(): string[] {
    return screen
      .queryAllByTestId(/^arweave-seed-pending-row-\d+$/)
      .map((row) => row.getAttribute("data-index") ?? "");
  }

  it("renders the generate box BEFORE the address list", () => {
    renderArea({
      seeds: [PRIME_SEED],
      existingKeys: [makeKey({ seedId: "prime", index: 0, address: "ADDR-STORED-0" })],
    });
    fireEvent.click(screen.getByTestId("arweave-seed-toggle-prime"));

    const controls = screen.getByTestId("arweave-generate-controls");
    const list = screen.getByTestId("arweave-seed-addresses-prime");
    // eslint-disable-next-line no-bitwise
    expect(controls.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("keeps every generated key OUT of the generate box — it holds only the controls and the progress", async () => {
    const { worker, persistKey } = await startUpTo(1);

    worker.emit(keyMsg(0));
    await waitFor(() => expect(persistKey).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId("arweave-generate-key-row-0")).toBeInTheDocument());

    const controls = screen.getByTestId("arweave-generate-controls");
    expect(within(controls).queryAllByTestId(/-row-\d+$/)).toHaveLength(0);
    // It keeps what a run IS watched by: the status line, the bar and Cancel.
    expect(within(controls).getByTestId("arweave-generate-progress-bar")).toBeInTheDocument();
    expect(within(controls).getByTestId("arweave-generate-cancel")).toBeInTheDocument();
    // The key itself is in the address list below.
    expect(
      within(screen.getByTestId("arweave-seed-addresses-prime")).getByTestId(
        "arweave-generate-key-address-0",
      ).textContent,
    ).toBe("ADDR-0");
  });

  it("shows one EMPTY row per planned position the moment a run starts", async () => {
    await startUpTo(2); // #0, #1, #2

    expect(pendingIndices()).toEqual(["0", "1", "2"]);
    // A seed mid-run is not "unused" — it is about to have three addresses.
    expect(screen.queryByTestId("arweave-seed-unused-prime")).toBeNull();
  });

  it("replaces a pending row IN PLACE when its key arrives, leaving the others pending", async () => {
    const { worker, persistKey } = await startUpTo(2);

    worker.emit(keyMsg(1));
    await waitFor(() => expect(persistKey).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId("arweave-generate-key-row-1")).toBeInTheDocument());

    expect(screen.queryByTestId("arweave-seed-pending-row-1")).toBeNull();
    expect(pendingIndices()).toEqual(["0", "2"]);
    // #1 sits where it always sat — between #0 and #2, not appended at the end.
    expect(listedIndices()).toEqual(["0", "1", "2"]);
  });

  it("removes every unfilled pending row when a run is cancelled, keeping only delivered keys", async () => {
    const { worker, persistKey } = await startUpTo(2);

    worker.emit(keyMsg(0));
    await waitFor(() => expect(persistKey).toHaveBeenCalledTimes(1));
    expect(pendingIndices()).toEqual(["1", "2"]);

    fireEvent.click(screen.getByTestId("arweave-generate-cancel"));
    await waitFor(() =>
      expect(screen.getByTestId("arweave-generate-status").textContent).toMatch(/cancel/i),
    );

    expect(pendingIndices()).toEqual([]);
    expect(listedIndices()).toEqual(["0"]);
  });

  it("does not list a delivered key twice once the store hands it back as an existing key", async () => {
    const { worker, persistKey, view } = await startUpTo(1);

    worker.emit(keyMsg(0));
    await waitFor(() => expect(persistKey).toHaveBeenCalledTimes(1));

    // The consumer refreshes its snapshot: the key just persisted now arrives
    // BOTH from the run and from `existingKeys`.
    view.rerender(
      <ArweaveSeedsArea
        seeds={[PRIME_SEED]}
        existingKeys={[makeKey({ id: "stored-0", seedId: "prime", index: 0, address: "ADDR-0" })]}
        persistKey={persistKey as unknown as ArweaveSeedsAreaProps["persistKey"]}
        workerFactory={() => worker as unknown as Worker}
      />,
    );

    expect(listedIndices().filter((index) => index === "0")).toEqual(["0"]);
  });
});

/**
 * Crypto Lab parity for the two surfaces the user compared side by side.
 */
describe("<ArweaveSeedsArea> — Lab parity: tooltip + completion summary", () => {
  const SUMMARY_ADDRESS = "SUMMARY-ADDRESS-9";

  function openStoredRow() {
    renderArea({
      seeds: [PRIME_SEED],
      existingKeys: [
        makeKey({ id: "stored-9", seedId: "prime", index: 9, address: SUMMARY_ADDRESS }),
      ],
    });
    fireEvent.click(screen.getByTestId("arweave-seed-toggle-prime"));
  }

  it("leads every parameter label with its ⓘ marker, so the icons line up", () => {
    openStoredRow();
    // The marker precedes the text; trailing it put each row's icon at a
    // different x, since the labels differ in length.
    const label = screen.getByTestId("arweave-seed-key-label-9-address").parentElement;
    expect((label?.textContent ?? "").trimStart().startsWith("ⓘ")).toBe(true);
  });

  it("sizes the tooltip to its text instead of a fixed width that clips it", () => {
    openStoredRow();
    const tip = screen.getByTestId("arweave-seed-key-tip-9-address");
    // A fixed px width could not fit the longer definitions, and the label's
    // `white-space: nowrap` was inherited so the text could not wrap either.
    expect(tip.style.width).toBe("max-content");
    expect(tip.style.whiteSpace).toBe("normal");
    expect(tip.style.maxWidth).not.toBe("");
  });

  it("formats a duration exactly as the Lab's fmtDuration does", () => {
    // < 1 min → one decimal of seconds; ≥ 1 min → "Nm Ss"; ≥ 1 h → "Nh Mm".
    expect(fmtDuration(1500)).toBe("1.5s");
    expect(fmtDuration(71_000)).toBe("1m 11s");
    expect(fmtDuration(3_660_000)).toBe("1h 1m");
  });
});

/**
 * Gold Prime styling + separator, ported from `SeedWordsTab.tsx` (design.md
 * ask B).
 *
 * Each case guards a distinct regression:
 *   (gold) the Prime row must be visually distinguishable at a glance — the
 *       same "which one is Prime" complaint Chainweb's surface already fixed.
 *       A wrong or missing colour, or a stray chevron where the lock belongs,
 *       silently reverts this surface to indistinguishable rows.
 *   (non-prime) the gold treatment is Prime-ONLY — painting every row gold
 *       would defeat the whole point of a highlight.
 *   (separator) the divider must exist exactly when there IS a "rest" to
 *       separate the Prime row from, and sit between the two, not floating
 *       elsewhere in the list.
 */
describe("ArweaveSeedsArea — gold Prime styling + separator (B)", () => {
  const SECOND_SEED: ArweaveSeedRecord = {
    id: "second",
    label: "Second Arweave Seed",
    bits: "0".repeat(SEED_BIT_LENGTH),
  };

  it("gives the Prime row a gold border, a gold label, a 🔒 Prime badge and a lock glyph in place of the chevron", () => {
    renderArea({ seeds: [PRIME_SEED] });

    const prime = screen.getByTestId("arweave-prime-seed-row");
    // `#ceac5f40` (25% alpha gold), exactly `SeedWordsTab.tsx`'s value.
    expect(getComputedStyle(prime).borderColor).toBe("rgba(206, 172, 95, 0.25)");

    const label = screen.getByText("Master ArWeave Seed");
    expect(getComputedStyle(label).color).toBe("rgb(206, 172, 95)");

    expect(screen.getByTestId("arweave-prime-badge").textContent).toBe("🔒 Prime");

    const toggle = screen.getByTestId("arweave-seed-toggle-prime");
    // The lock glyph is a padlock (`<rect>` body) — the chevron glyphs are
    // plain `<path>`s with no `<rect>` at all.
    expect(toggle.innerHTML).toContain("<rect");
    expect(toggle.innerHTML).not.toContain('d="m6 9 6 6 6-6"'); // chevron-down
    expect(toggle.innerHTML).not.toContain('d="m9 18 6-6-6-6"'); // chevron-right
  });

  it("still toggles the Prime row open and closed through the lock glyph's button", () => {
    renderArea({ seeds: [PRIME_SEED] });

    const toggle = screen.getByTestId("arweave-seed-toggle-prime");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("leaves a non-Prime row with the ordinary border, label colour and chevron — the gold treatment is Prime-only", () => {
    renderArea({ seeds: [PRIME_SEED, SECOND_SEED] });

    const second = screen.getByTestId("arweave-seed-row-second");
    expect(getComputedStyle(second).borderColor).toBe("rgb(38, 38, 38)");
    expect(within(second).queryByTestId("arweave-prime-badge")).toBeNull();
    within(second).getByText("Second Arweave Seed"); // present, unstyled gold

    const toggle = screen.getByTestId("arweave-seed-toggle-second");
    expect(toggle.innerHTML).not.toContain("<rect");
  });

  it("renders the 'Other Seeds' separator right after the Prime row when more than one seed exists", () => {
    renderArea({ seeds: [PRIME_SEED, SECOND_SEED] });

    const separator = screen.getByTestId("arweave-seed-separator");
    expect(separator.textContent).toBe("Other Seeds");

    const prime = screen.getByTestId("arweave-prime-seed-row");
    const second = screen.getByTestId("arweave-seed-row-second");
    // eslint-disable-next-line no-bitwise
    expect(prime.compareDocumentPosition(separator) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // eslint-disable-next-line no-bitwise
    expect(separator.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("renders NO separator when exactly one seed exists — there is no 'rest' to separate it from", () => {
    renderArea({ seeds: [PRIME_SEED] });

    expect(screen.queryByTestId("arweave-seed-separator")).toBeNull();
  });
});

/**
 * WHICH row is the master — ordering and gold follow the codex's settled
 * `codexMasterSeed.arweaveSeedId`, not the `isPrime` flag.
 *
 * The owner's report, after the eligibility wizard finalized on a codex that
 * ALREADY had an Arweave seed: *"The newly made Master Arweave Seed should be
 * on position one colour golden, and the one existing as Master Arweave Seed,
 * should have become Arweave Seed One."* The RENAME half already works — but
 * `isPrime` is a creation-time provenance marker ("the first seed ever added")
 * and is deliberately NOT moved, so the DEMOTED seed kept position one and the
 * gold while the real new master sat grey further down.
 *
 * Each case guards a distinct regression:
 *   (settled) the reported bug itself — with a stale `isPrime` on the demoted
 *       seed, the row the codex calls its master must be first AND gold, and
 *       the demoted one grey and below it.
 *   (unsettled) BACKWARDS COMPATIBILITY, a hard requirement: a codex that
 *       never ran the wizard passes no master id at all and must order and
 *       colour exactly as it always has. Breaking it would silently re-paint
 *       every existing codex's seed list.
 *   (no arweave face) a settled master seed row whose ArWeave face has not
 *       been derived yet (`arweaveSeedId` absent — the row's own documented
 *       optional field) is NOT an identity, and must not blank out the rule.
 *   (dangling) an id naming a seed that is no longer in the list must fall
 *       back, never leave the surface with no gold row at all.
 */
describe("ArweaveSeedsArea — the master row follows codexMasterSeed.arweaveSeedId", () => {
  /** The pre-existing seed: still flagged `isPrime` (first ever added), but
   *  RENAMED by the wizard's finalize step — it is no longer the master. */
  const DEMOTED_SEED: ArweaveSeedRecord = {
    id: "legacy",
    label: "Arweave Seed 1",
    bits: PRIME_BITS,
    isPrime: true,
  };
  /** The seed the wizard just derived: carries the master TITLE, and no
   *  `isPrime` (that flag cannot be relocated — `addArweaveSeed` throws
   *  `id-conflict` on a second explicit prime). */
  const NEW_MASTER_SEED: ArweaveSeedRecord = {
    id: "new-master",
    label: "Master ArWeave Seed",
    bits: PRIME_BITS,
  };
  const BOTH = [DEMOTED_SEED, NEW_MASTER_SEED];

  /** The gold label/border and the ordinary grey ones, as jsdom reports them. */
  const GOLD_TEXT = "rgb(206, 172, 95)";
  const GOLD_BORDER = "rgba(206, 172, 95, 0.25)";
  const PLAIN_TEXT = "rgb(210, 211, 212)";
  const PLAIN_BORDER = "rgb(38, 38, 38)";

  function masterRow(): HTMLElement {
    // One row, and only ever one, wears the master treatment.
    const rows = screen.getAllByTestId("arweave-prime-seed-row");
    expect(rows).toHaveLength(1);
    return rows[0]!;
  }

  it("puts the seed codexMasterSeed names FIRST and gold, with the demoted isPrime seed grey and below it", () => {
    renderArea({ seeds: BOTH, masterArweaveSeedId: "new-master" });

    const master = masterRow();
    expect(master).toHaveAttribute("data-seed-id", "new-master");
    expect(getComputedStyle(master).borderColor).toBe(GOLD_BORDER);
    expect(getComputedStyle(within(master).getByText("Master ArWeave Seed")).color).toBe(GOLD_TEXT);

    const demoted = screen.getByTestId("arweave-seed-row-legacy");
    expect(getComputedStyle(demoted).borderColor).toBe(PLAIN_BORDER);
    expect(getComputedStyle(within(demoted).getByText("Arweave Seed 1")).color).toBe(PLAIN_TEXT);
    expect(within(demoted).queryByTestId("arweave-prime-badge")).toBeNull();

    // eslint-disable-next-line no-bitwise
    expect(master.compareDocumentPosition(demoted) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("keeps today's isPrime-first behaviour when the codex has settled no master arweave seed id", () => {
    renderArea({ seeds: BOTH });

    const master = masterRow();
    expect(master).toHaveAttribute("data-seed-id", "legacy");
    expect(getComputedStyle(master).borderColor).toBe(GOLD_BORDER);

    const other = screen.getByTestId("arweave-seed-row-new-master");
    expect(getComputedStyle(other).borderColor).toBe(PLAIN_BORDER);
    // eslint-disable-next-line no-bitwise
    expect(master.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("keeps today's isPrime-first behaviour when the settled master seed row has no arweave face yet (empty id)", () => {
    renderArea({ seeds: BOTH, masterArweaveSeedId: "" });

    expect(masterRow()).toHaveAttribute("data-seed-id", "legacy");
  });

  it("falls back to isPrime — still exactly ONE gold row — when the settled id names a seed no longer in the list", () => {
    renderArea({ seeds: BOTH, masterArweaveSeedId: "deleted-seed" });

    const master = masterRow();
    expect(master).toHaveAttribute("data-seed-id", "legacy");
    expect(getComputedStyle(master).borderColor).toBe(GOLD_BORDER);
  });
});

/**
 * The master row's TWO names (`former-master-record` T1).
 *
 * The owner: *"a prime seed or account has 2 names: its golden prime name, and
 * its normal name, as every other account and seed has. This has to be properly
 * constructed like so, because as non-prime accounts become prime, their names
 * mangle."* So the master row renders the DERIVED designation
 * ("Master ArWeave Seed", gold) as its title and the seed's OWN stored name as
 * a muted second line beneath it — the same shape
 * `OuronetAccountsTab.tsx`'s displaced-name line already uses.
 *
 * Each case guards a distinct regression:
 *   (two names) with the designation stored in `name` (the model this task
 *       replaces) the user's own name was simply gone from the screen — the
 *       visible half of the data loss.
 *   (unnamed) a seed with no stored name must show the designation ALONE: an
 *       empty muted line reads as a rendering fault, and inventing a
 *       placeholder would be the stored-title drift all over again.
 *   (repeat) seeds ALREADY on disk carry `name: "Master ArWeave Seed"` from
 *       before this fix (and the playground's own stored-seed label fallback
 *       can re-assert it). Rendering it as the second line would print the
 *       title twice on one row.
 *   (identity) a NON-master seed whose stored name happens to equal the
 *       designation must get NO master treatment — the name-vs-identity guard.
 *       This is exactly the drift that made two rows both read "Master ArWeave
 *       Seed" with the real master indistinguishable.
 */
describe("ArweaveSeedsArea — the master row shows the designation AND the seed's own name", () => {
  const GOLD_TEXT = "rgb(206, 172, 95)";
  const MUTED_TEXT = "rgb(136, 136, 136)";
  const PLAIN_BORDER = "rgb(38, 38, 38)";

  /** The master seed, carrying the name ITS USER chose. */
  const NAMED_MASTER: ArweaveSeedRecord = {
    id: "master",
    label: "My cold storage seed",
    bits: PRIME_BITS,
  };

  it("renders the golden designation as the title and the stored name muted beneath it", () => {
    renderArea({ seeds: [NAMED_MASTER], masterArweaveSeedId: "master" });

    const row = screen.getByTestId("arweave-prime-seed-row");
    const designation = within(row).getByTestId("arweave-seed-designation-master");
    expect(designation.textContent).toBe("Master ArWeave Seed");
    expect(getComputedStyle(designation).color).toBe(GOLD_TEXT);

    const ownName = within(row).getByTestId("arweave-seed-own-name-master");
    expect(ownName.textContent).toBe("My cold storage seed");
    expect(getComputedStyle(ownName).color).toBe(MUTED_TEXT);
  });

  it("shows the designation ALONE for a master seed with no stored name — no empty second line", () => {
    renderArea({ seeds: [{ ...NAMED_MASTER, label: "" }], masterArweaveSeedId: "master" });

    const row = screen.getByTestId("arweave-prime-seed-row");
    expect(within(row).getByTestId("arweave-seed-designation-master").textContent).toBe(
      "Master ArWeave Seed",
    );
    expect(within(row).queryByTestId("arweave-seed-own-name-master")).toBeNull();
  });

  it("does not repeat the designation as the second line for a legacy row stored under that very name", () => {
    renderArea({
      seeds: [{ ...NAMED_MASTER, label: PRIME_SEED_LABEL }],
      masterArweaveSeedId: "master",
    });

    const row = screen.getByTestId("arweave-prime-seed-row");
    expect(within(row).queryByTestId("arweave-seed-own-name-master")).toBeNull();
    expect(within(row).getAllByText(PRIME_SEED_LABEL)).toHaveLength(1);
  });

  it("gives a NON-master seed named 'Master ArWeave Seed' no designation and no master treatment", () => {
    const decoy: ArweaveSeedRecord = {
      id: "decoy",
      label: PRIME_SEED_LABEL,
      bits: PRIME_BITS,
      // Stale provenance: the first seed the codex ever got, no longer its
      // master. `isPrime` must not win over the settled id here either.
      isPrime: true,
    };
    renderArea({ seeds: [decoy, NAMED_MASTER], masterArweaveSeedId: "master" });

    // Exactly ONE row wears the master treatment, and it is the one the
    // resolver names — not the one whose stored name says so.
    const masterRows = screen.getAllByTestId("arweave-prime-seed-row");
    expect(masterRows).toHaveLength(1);
    expect(masterRows[0]).toHaveAttribute("data-seed-id", "master");

    const decoyRow = screen.getByTestId("arweave-seed-row-decoy");
    expect(getComputedStyle(decoyRow).borderColor).toBe(PLAIN_BORDER);
    expect(within(decoyRow).queryByTestId("arweave-prime-badge")).toBeNull();
    expect(within(decoyRow).queryByTestId("arweave-seed-designation-decoy")).toBeNull();
    // Its own name is still its own name — shown as any other seed's is.
    expect(getComputedStyle(within(decoyRow).getByText(PRIME_SEED_LABEL)).color).toBe(
      "rgb(210, 211, 212)",
    );
  });
});

/**
 * The DISPLACED seed's own designation (`former-master-record` T2/T3).
 *
 * The owner: *"the one being Master Arweave Seed needs to be Master Arweave
 * Seed, and the one that isn't anymore would be designated **Former Master
 * Arweave Seed**."* So a seed the codex has on record as a former holder
 * (`codexMasterSeed.formerArweaveSeedIds`, seal-gated by
 * `isFormerMasterArweaveSeed` — resolved in `ArweavePanel.tsx` and INJECTED,
 * since this surface reaches into no store) renders on the SAME two-line shape
 * the master row uses: the derived designation as its title, its own stored
 * name muted beneath. Never gold: exactly one row is the master.
 *
 * Each case guards a distinct regression:
 *   (two names) with no designation at all the displaced seed is
 *       indistinguishable from any unrelated seed — the whole point of
 *       recording the former id is that the user can still see what it was.
 *   (not gold) painting it gold would put TWO gold rows on screen, which is
 *       the exact confusion ("two rows both reading Master ArWeave Seed") this
 *       topic exists to end.
 *   (legacy title) a seed displaced from the role on a codex that ran the
 *       pre-fix code carries `name: "Master ArWeave Seed"` on disk; printing
 *       that under "Former Master ArWeave Seed" would claim it still holds the
 *       role it just lost.
 *   (master wins) the resolver can name the very seed that is on the former
 *       list as today's master (its settled id points at a deleted seed, so it
 *       falls back to `isPrime`). One row must not wear both treatments.
 */
describe("ArweaveSeedsArea — the displaced seed reads 'Former Master ArWeave Seed'", () => {
  const GOLD_TEXT = "rgb(206, 172, 95)";
  /** The former designation's own muted-silver treatment — deliberately NOT
   *  the gold the master wears, and not the plain `#d2d3d4` either. */
  const FORMER_TEXT = "rgb(154, 154, 154)";
  const MUTED_TEXT = "rgb(136, 136, 136)";
  const PLAIN_BORDER = "rgb(38, 38, 38)";

  const MASTER: ArweaveSeedRecord = { id: "master", label: "", bits: PRIME_BITS };
  /** The seed the master role moved away from, under the name its user chose. */
  const DISPLACED: ArweaveSeedRecord = {
    id: "displaced",
    label: "My cold storage seed",
    bits: PRIME_BITS,
    // Stale provenance: it was the first seed this codex ever added.
    isPrime: true,
  };

  it("renders the former designation as the title and the seed's own name muted beneath", () => {
    renderArea({
      seeds: [DISPLACED, MASTER],
      masterArweaveSeedId: "master",
      formerMasterArweaveSeedIds: ["displaced"],
    });

    const row = screen.getByTestId("arweave-seed-row-displaced");
    const designation = within(row).getByTestId("arweave-seed-designation-displaced");
    expect(designation.textContent).toBe(FORMER_MASTER_ARWEAVE_SEED);
    expect(getComputedStyle(designation).color).toBe(FORMER_TEXT);

    const ownName = within(row).getByTestId("arweave-seed-own-name-displaced");
    expect(ownName.textContent).toBe("My cold storage seed");
    expect(getComputedStyle(ownName).color).toBe(MUTED_TEXT);
  });

  it("leaves the former row ungilded — exactly ONE row keeps the master treatment", () => {
    renderArea({
      seeds: [DISPLACED, MASTER],
      masterArweaveSeedId: "master",
      formerMasterArweaveSeedIds: ["displaced"],
    });

    const masterRows = screen.getAllByTestId("arweave-prime-seed-row");
    expect(masterRows).toHaveLength(1);
    expect(masterRows[0]).toHaveAttribute("data-seed-id", "master");
    expect(getComputedStyle(within(masterRows[0]!).getByText(PRIME_SEED_LABEL)).color).toBe(
      GOLD_TEXT,
    );

    const row = screen.getByTestId("arweave-seed-row-displaced");
    expect(getComputedStyle(row).borderColor).toBe(PLAIN_BORDER);
    expect(within(row).queryByTestId("arweave-prime-badge")).toBeNull();
    expect(getComputedStyle(within(row).getByText(FORMER_MASTER_ARWEAVE_SEED)).color).not.toBe(
      GOLD_TEXT,
    );
  });

  it("shows the former designation ALONE for a legacy row stored under the master title", () => {
    renderArea({
      seeds: [{ ...DISPLACED, label: PRIME_SEED_LABEL }, MASTER],
      masterArweaveSeedId: "master",
      formerMasterArweaveSeedIds: ["displaced"],
    });

    const row = screen.getByTestId("arweave-seed-row-displaced");
    expect(within(row).getByTestId("arweave-seed-designation-displaced").textContent).toBe(
      FORMER_MASTER_ARWEAVE_SEED,
    );
    expect(within(row).queryByTestId("arweave-seed-own-name-displaced")).toBeNull();
    // ...and it does not re-assert the title it lost anywhere on the row.
    expect(within(row).queryByText(PRIME_SEED_LABEL)).toBeNull();
  });

  it("gives a seed that is BOTH on the former list and today's resolved master the master treatment only", () => {
    // The settled id names a seed that is gone, so `resolveMasterArweaveSeed`
    // falls back to the `isPrime` row — which is the one on the former list.
    renderArea({
      seeds: [DISPLACED],
      masterArweaveSeedId: "deleted-seed",
      formerMasterArweaveSeedIds: ["displaced"],
    });

    const row = screen.getByTestId("arweave-prime-seed-row");
    expect(row).toHaveAttribute("data-seed-id", "displaced");
    expect(within(row).getByTestId("arweave-seed-designation-displaced").textContent).toBe(
      PRIME_SEED_LABEL,
    );
    expect(screen.queryByText(FORMER_MASTER_ARWEAVE_SEED)).toBeNull();
  });

  it("renders no designation at all for a seed the codex has no record of", () => {
    renderArea({ seeds: [DISPLACED, MASTER], masterArweaveSeedId: "master" });

    const row = screen.getByTestId("arweave-seed-row-displaced");
    expect(within(row).queryByTestId("arweave-seed-designation-displaced")).toBeNull();
    expect(within(row).getByText("My cold storage seed")).toBeInTheDocument();
  });
});

/**
 * The Seed-Based / Direct toggle, buttons only (design.md ask C).
 *
 * Each case guards a distinct regression:
 *   (default) a user who has never touched the toggle must see EXACTLY
 *       today's form — Seed-Based is the default, unchanged.
 *   (switch) Direct must show a REAL, non-throwing body naming the four input
 *       kinds — a blank body or a crash on switch is worse than no toggle.
 *   (confirm-blocked) Direct is buttons-only this round; a live Confirm would
 *       let a user "define" a seed the generator never actually built.
 *   (back) the switch must be reversible without losing the seed-based form's
 *       own state machine (source/variant), or the two modes are not really
 *       independent toggles.
 */
describe("ArweaveSeedsArea — the Seed-Based / Direct toggle (C)", () => {
  it("defaults to Seed-Based, showing today's three-source form unchanged", () => {
    renderArea();
    openDefineForm();

    expect(screen.getByTestId("arweave-seed-mode-seed-based")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("arweave-seed-mode-direct")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("radiogroup", { name: "Seed source" })).toBeInTheDocument();
    expect(screen.queryByTestId("arweave-seed-direct-body")).toBeNull();
  });

  it("switches to the real Direct body naming the four input kinds and disables Confirm until a value resolves", () => {
    renderArea();
    openDefineForm();

    fireEvent.click(screen.getByTestId("arweave-seed-mode-direct"));

    expect(screen.getByTestId("arweave-seed-mode-direct")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("arweave-seed-direct-body")).toBeInTheDocument();
    // The four kind tiles are now REAL (enabled) selectors, not disabled tiles.
    for (const testId of ["bitstring", "bitmap", "base10", "base49"]) {
      expect(screen.getByTestId(`arweave-seed-direct-tile-${testId}`)).not.toBeDisabled();
    }
    expect(screen.getByTestId("arweave-seed-direct-tile-bitstring")).toHaveTextContent("BitString");
    expect(screen.getByTestId("arweave-seed-direct-tile-bitmap")).toHaveTextContent("Bitmap");
    expect(screen.getByTestId("arweave-seed-direct-tile-base10")).toHaveTextContent(
      "Base-10 scalar",
    );
    expect(screen.getByTestId("arweave-seed-direct-tile-base49")).toHaveTextContent(
      "Base-49 scalar",
    );
    // The width toggle defaults to 1600 and is visible only in Direct mode.
    expect(screen.getByTestId("arweave-seed-direct-width-1600")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("arweave-seed-direct-width-1024")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    // The seed-based form is gone while Direct is showing.
    expect(screen.queryByRole("radiogroup", { name: "Seed source" })).toBeNull();
    // Nothing typed yet — Confirm stays blocked.
    expect(screen.getByTestId("arweave-seed-confirm")).toBeDisabled();
  });

  it("returns to the unchanged Seed-Based form when switched back — the words already typed still define a seed", async () => {
    const onSeedDefined = vi.fn();
    renderArea({ onSeedDefined });
    openDefineForm();

    fireEvent.click(screen.getByTestId("arweave-seed-mode-direct"));
    fireEvent.click(screen.getByTestId("arweave-seed-mode-seed-based"));

    expect(screen.queryByTestId("arweave-seed-direct-body")).toBeNull();
    fireEvent.change(screen.getByTestId("arweave-seed-words-input"), {
      target: { value: "hello world" },
    });
    fireEvent.click(screen.getByTestId("arweave-seed-confirm"));

    await waitFor(() => expect(onSeedDefined).toHaveBeenCalledTimes(1));
  });
});

/**
 * Direct Deterministic RSA Generation (`direct-deterministic-rsa`).
 *
 * Each case guards a distinct regression:
 *   - the width toggle must default to 1600 and be switchable.
 *   - each of the four input kinds (BitString/Base-10/Base-49/Bitmap) must
 *     resolve to a real bitstring Confirm accepts, via BOTH a random-generate
 *     button and manual entry.
 *   - the ONE auto-correction rule: a value shaped for the OTHER width must
 *     silently flip the toggle and be accepted — never a refusal the user has
 *     to work around by guessing which position to try first.
 *   - a value that fits neither width must be refused with a visible message,
 *     and Confirm must stay blocked.
 *   - a Direct-defined seed must carry `words: undefined`, the resolved
 *     `bitLength`, and a `sourceLabel` naming "Direct" — the reveal and the
 *     SeedRow subtitle both key off exactly these fields.
 *   - generation against a 1024-bit Direct seed must work completely
 *     unchanged from a 1600-bit one — no special-casing in `startRun`.
 */
describe("ArweaveSeedsArea — Direct Deterministic RSA Generation", () => {
  function openDirect(): void {
    openDefineForm();
    fireEvent.click(screen.getByTestId("arweave-seed-mode-direct"));
  }

  function pickKind(kind: "bitstring" | "bitmap" | "base10" | "base49"): void {
    fireEvent.click(screen.getByTestId(`arweave-seed-direct-tile-${kind}`));
  }

  /* ── width toggle ── */

  it("defaults the width toggle to 1600 and switches to 1024 on click", () => {
    renderArea();
    openDirect();

    expect(screen.getByTestId("arweave-seed-direct-width-1600")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getByTestId("arweave-seed-direct-width-1024"));
    expect(screen.getByTestId("arweave-seed-direct-width-1024")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("arweave-seed-direct-width-1600")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("is visible only in Direct mode — absent while Seed-Based is showing", () => {
    renderArea();
    openDefineForm();

    expect(screen.queryByTestId("arweave-seed-direct-width-1600")).toBeNull();
  });

  /* ── BitString ── */

  it("BitString: the Random button fills a valid directWidth-length bitstring Confirm accepts", async () => {
    const onSeedDefined = vi.fn();
    renderArea({ onSeedDefined });
    openDirect();
    pickKind("bitstring");

    fireEvent.click(screen.getByTestId("arweave-seed-direct-random-bitstring"));

    const input = screen.getByTestId("arweave-seed-direct-bitstring-input") as HTMLTextAreaElement;
    expect(input.value).toMatch(/^[01]{1600}$/);
    expect(screen.getByTestId("arweave-seed-confirm")).toBeEnabled();

    fireEvent.click(screen.getByTestId("arweave-seed-confirm"));
    await waitFor(() => expect(onSeedDefined).toHaveBeenCalledTimes(1));
    const seed = onSeedDefined.mock.calls[0][0] as ArweaveSeedRecord;
    expect(seed.bits).toBe(input.value);
    expect(seed.bitLength).toBe(1600);
    expect(seed.words).toBeUndefined();
    expect(seed.sourceLabel).toContain("Direct");
  });

  it("BitString: manual entry of a valid 1600-bit string at width=1600 confirms successfully", async () => {
    const onSeedDefined = vi.fn();
    renderArea({ onSeedDefined });
    openDirect();
    pickKind("bitstring");

    const bits = "01".repeat(800); // 1600 chars, 0/1 only
    fireEvent.change(screen.getByTestId("arweave-seed-direct-bitstring-input"), {
      target: { value: bits },
    });
    expect(screen.getByTestId("arweave-seed-confirm")).toBeEnabled();
    fireEvent.click(screen.getByTestId("arweave-seed-confirm"));

    await waitFor(() => expect(onSeedDefined).toHaveBeenCalledTimes(1));
    const seed = onSeedDefined.mock.calls[0][0] as ArweaveSeedRecord;
    expect(seed.bits).toBe(bits);
    expect(seed.bitLength).toBe(1600);
  });

  it("BitString: a valid 1024-bit string typed while width=1600 AUTO-FLIPS the toggle to 1024 and is accepted", async () => {
    const onSeedDefined = vi.fn();
    renderArea({ onSeedDefined });
    openDirect();
    pickKind("bitstring");

    const bits1024 = "01".repeat(512); // 1024 chars
    fireEvent.change(screen.getByTestId("arweave-seed-direct-bitstring-input"), {
      target: { value: bits1024 },
    });

    await waitFor(() =>
      expect(screen.getByTestId("arweave-seed-direct-width-1024")).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
    expect(screen.getByTestId("arweave-seed-confirm")).toBeEnabled();

    fireEvent.click(screen.getByTestId("arweave-seed-confirm"));
    await waitFor(() => expect(onSeedDefined).toHaveBeenCalledTimes(1));
    const seed = onSeedDefined.mock.calls[0][0] as ArweaveSeedRecord;
    expect(seed.bitLength).toBe(1024);
    expect(seed.bits).toBe(bits1024);
  });

  it("BitString: the symmetric case — a valid 1600-bit string typed while width=1024 AUTO-FLIPS to 1600", async () => {
    renderArea();
    openDirect();
    pickKind("bitstring");
    fireEvent.click(screen.getByTestId("arweave-seed-direct-width-1024"));

    const bits1600 = "01".repeat(800);
    fireEvent.change(screen.getByTestId("arweave-seed-direct-bitstring-input"), {
      target: { value: bits1600 },
    });

    await waitFor(() =>
      expect(screen.getByTestId("arweave-seed-direct-width-1600")).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
    expect(screen.getByTestId("arweave-seed-confirm")).toBeEnabled();
  });

  it("BitString: a string that fits NEITHER width shows the error inline and blocks Confirm", () => {
    renderArea();
    openDirect();
    pickKind("bitstring");

    // Filtered to 0/1 and capped at directWidth (1600), but only 10 chars —
    // matches neither 1024 nor 1600.
    fireEvent.change(screen.getByTestId("arweave-seed-direct-bitstring-input"), {
      target: { value: "0101010101" },
    });

    expect(screen.getByTestId("arweave-seed-direct-error")).toBeInTheDocument();
    expect(screen.getByTestId("arweave-seed-confirm")).toBeDisabled();
  });

  it("BitString: an untouched (empty) field shows NO error — incomplete is not wrong", () => {
    renderArea();
    openDirect();
    pickKind("bitstring");

    expect(screen.queryByTestId("arweave-seed-direct-error")).toBeNull();
    expect(screen.getByTestId("arweave-seed-confirm")).toBeDisabled();
  });

  /* ── Base-10 / Base-49 ── */

  it("Base-10: the Random button produces an accepted value", async () => {
    const onSeedDefined = vi.fn();
    renderArea({ onSeedDefined });
    openDirect();
    pickKind("base10");

    fireEvent.click(screen.getByTestId("arweave-seed-direct-random-base10"));

    const input = screen.getByTestId("arweave-seed-direct-base10-input") as HTMLTextAreaElement;
    expect(input.value).toMatch(/^[0-9]+$/);
    expect(screen.getByTestId("arweave-seed-confirm")).toBeEnabled();

    fireEvent.click(screen.getByTestId("arweave-seed-confirm"));
    await waitFor(() => expect(onSeedDefined).toHaveBeenCalledTimes(1));
    const seed = onSeedDefined.mock.calls[0][0] as ArweaveSeedRecord;
    expect(seed.bitLength).toBe(1600);
    expect(seed.bits.length).toBe(1600);
  });

  it("Base-10: TYPING a correctly-clamped scalar for the OTHER width auto-flips the toggle and accepts it", async () => {
    renderArea();
    openDirect();
    pickKind("base10");

    // Generate a value NATIVE to 1024, capture it, then clear the field and
    // re-TYPE that same value while width=1600 — this is the auto-correction
    // the user actually asked for ("if we add a 1024-bit [value]" — typing).
    fireEvent.click(screen.getByTestId("arweave-seed-direct-width-1024"));
    fireEvent.click(screen.getByTestId("arweave-seed-direct-random-base10"));
    const native1024 = (screen.getByTestId("arweave-seed-direct-base10-input") as HTMLTextAreaElement).value;
    fireEvent.click(screen.getByTestId("arweave-seed-direct-width-1600"));

    // Clear first: re-setting an input to the SAME value it already holds
    // does not fire a real `input`/`onChange` transition (React's internal
    // value tracker sees no change) — a genuine re-type always clears first.
    fireEvent.change(screen.getByTestId("arweave-seed-direct-base10-input"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByTestId("arweave-seed-direct-base10-input"), {
      target: { value: native1024 },
    });

    await waitFor(() =>
      expect(screen.getByTestId("arweave-seed-direct-width-1024")).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
    expect(screen.getByTestId("arweave-seed-confirm")).toBeEnabled();
  });

  it("Base-10: manually clicking the width toggle is AUTHORITATIVE and clears the now-incompatible field, rather than leaving a permanent error", () => {
    renderArea();
    openDirect();
    pickKind("base10");

    // A scalar native to 1024…
    fireEvent.click(screen.getByTestId("arweave-seed-direct-width-1024"));
    fireEvent.click(screen.getByTestId("arweave-seed-direct-random-base10"));
    expect(screen.getByTestId("arweave-seed-confirm")).toBeEnabled();

    // …then the user manually picks 1600 themselves. The click must STICK —
    // the OLD behavior silently snapped this back to 1024 the instant the
    // click landed, making a manual width choice look unresponsive/broken.
    // There is no meaningful "1024-bit equivalent" of this value at 1600 (a
    // different curve entirely) — rather than show a permanent "length
    // mismatch" error over content that can never fit, the field is cleared
    // so the user starts clean at the new width.
    fireEvent.click(screen.getByTestId("arweave-seed-direct-width-1600"));

    expect(screen.getByTestId("arweave-seed-direct-width-1600")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("arweave-seed-direct-width-1024")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect((screen.getByTestId("arweave-seed-direct-base10-input") as HTMLTextAreaElement).value).toBe(
      "",
    );
    expect(screen.queryByTestId("arweave-seed-direct-error")).toBeNull();
    expect(screen.getByTestId("arweave-seed-confirm")).toBeDisabled();
  });

  it("Base-10: malformed input is refused with a visible message", () => {
    renderArea();
    openDirect();
    pickKind("base10");

    fireEvent.change(screen.getByTestId("arweave-seed-direct-base10-input"), {
      target: { value: "5" },
    });

    expect(screen.getByTestId("arweave-seed-direct-error")).toBeInTheDocument();
    expect(screen.getByTestId("arweave-seed-confirm")).toBeDisabled();
  });

  it("Base-49: the Random button produces an accepted value", async () => {
    const onSeedDefined = vi.fn();
    renderArea({ onSeedDefined });
    openDirect();
    pickKind("base49");

    fireEvent.click(screen.getByTestId("arweave-seed-direct-random-base49"));

    const input = screen.getByTestId("arweave-seed-direct-base49-input") as HTMLTextAreaElement;
    expect(input.value.length).toBeGreaterThan(0);
    expect(screen.getByTestId("arweave-seed-confirm")).toBeEnabled();

    fireEvent.click(screen.getByTestId("arweave-seed-confirm"));
    await waitFor(() => expect(onSeedDefined).toHaveBeenCalledTimes(1));
    const seed = onSeedDefined.mock.calls[0][0] as ArweaveSeedRecord;
    expect(seed.bitLength).toBe(1600);
  });

  it("Base-49: TYPING a correctly-clamped scalar for the OTHER width auto-flips the toggle and accepts it", async () => {
    renderArea();
    openDirect();
    pickKind("base49");

    fireEvent.click(screen.getByTestId("arweave-seed-direct-width-1024"));
    fireEvent.click(screen.getByTestId("arweave-seed-direct-random-base49"));
    const native1024 = (screen.getByTestId("arweave-seed-direct-base49-input") as HTMLTextAreaElement).value;
    fireEvent.click(screen.getByTestId("arweave-seed-direct-width-1600"));

    fireEvent.change(screen.getByTestId("arweave-seed-direct-base49-input"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByTestId("arweave-seed-direct-base49-input"), {
      target: { value: native1024 },
    });

    await waitFor(() =>
      expect(screen.getByTestId("arweave-seed-direct-width-1024")).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
    expect(screen.getByTestId("arweave-seed-confirm")).toBeEnabled();
  });

  it("Base-49: manually clicking the width toggle is AUTHORITATIVE and clears the now-incompatible field, rather than leaving a permanent error", () => {
    renderArea();
    openDirect();
    pickKind("base49");

    fireEvent.click(screen.getByTestId("arweave-seed-direct-width-1024"));
    fireEvent.click(screen.getByTestId("arweave-seed-direct-random-base49"));
    expect(screen.getByTestId("arweave-seed-confirm")).toBeEnabled();

    fireEvent.click(screen.getByTestId("arweave-seed-direct-width-1600"));

    expect(screen.getByTestId("arweave-seed-direct-width-1600")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect((screen.getByTestId("arweave-seed-direct-base49-input") as HTMLTextAreaElement).value).toBe(
      "",
    );
    expect(screen.queryByTestId("arweave-seed-direct-error")).toBeNull();
    expect(screen.getByTestId("arweave-seed-confirm")).toBeDisabled();
  });

  it("the BitString/Base-10/Base-49 fields grow to show the WHOLE value instead of hiding most of it behind a fixed small box", () => {
    renderArea();
    openDirect();

    const fields: ReadonlyArray<["bitstring" | "base10" | "base49", string]> = [
      ["bitstring", "arweave-seed-direct-bitstring-input"],
      ["base10", "arweave-seed-direct-base10-input"],
      ["base49", "arweave-seed-direct-base49-input"],
    ];
    for (const [kind, testId] of fields) {
      pickKind(kind);
      const el = screen.getByTestId(testId) as HTMLTextAreaElement;

      // jsdom has no layout engine — stub `scrollHeight` to simulate a real
      // browser measuring a large wrapped value, exactly as the Free Seed
      // Input auto-grow test does.
      Object.defineProperty(el, "scrollHeight", { configurable: true, value: 640 });
      fireEvent.change(el, {
        target: { value: kind === "bitstring" ? "01" : kind === "base10" ? "42" : "az" },
      });

      expect(el.style.height).toBe("640px");
      // A hard ceiling still caps it — past this it scrolls, never grows
      // past most of the viewport.
      expect(el.style.maxHeight).toBe("60vh");
    }
  });

  it("Base-49: malformed input is refused with a visible message", () => {
    renderArea();
    openDirect();
    pickKind("base49");

    fireEvent.change(screen.getByTestId("arweave-seed-direct-base49-input"), {
      target: { value: "5" },
    });

    expect(screen.getByTestId("arweave-seed-direct-error")).toBeInTheDocument();
    expect(screen.getByTestId("arweave-seed-confirm")).toBeDisabled();
  });

  /* ── Bitmap ── */

  it("Bitmap: using BitmapKeyInput's Randomise produces a bitstring of the right length on confirm", async () => {
    const onSeedDefined = vi.fn();
    renderArea({ onSeedDefined });
    openDirect();
    pickKind("bitmap");

    fireEvent.click(screen.getByRole("button", { name: /Randomise/i }));
    expect(screen.getByTestId("arweave-seed-confirm")).toBeEnabled();

    fireEvent.click(screen.getByTestId("arweave-seed-confirm"));
    await waitFor(() => expect(onSeedDefined).toHaveBeenCalledTimes(1));
    const seed = onSeedDefined.mock.calls[0][0] as ArweaveSeedRecord;
    expect(seed.bits).toMatch(/^[01]{1600}$/);
    expect(seed.bitLength).toBe(1600);
    expect(seed.words).toBeUndefined();
    expect(seed.sourceLabel).toContain("Direct");
  });

  it("Bitmap: sized to 32×32 = 1024 bits when width=1024", async () => {
    const onSeedDefined = vi.fn();
    renderArea({ onSeedDefined });
    openDirect();
    fireEvent.click(screen.getByTestId("arweave-seed-direct-width-1024"));
    pickKind("bitmap");

    fireEvent.click(screen.getByRole("button", { name: /Randomise/i }));
    fireEvent.click(screen.getByTestId("arweave-seed-confirm"));

    await waitFor(() => expect(onSeedDefined).toHaveBeenCalledTimes(1));
    const seed = onSeedDefined.mock.calls[0][0] as ArweaveSeedRecord;
    expect(seed.bits).toMatch(/^[01]{1024}$/);
    expect(seed.bitLength).toBe(1024);
  });

  /* ── switching KIND carries the value across, converted (not blank) ── */

  it("switching from BitString to Base-49 populates the Base-49 field with the CONVERTED equivalent, not an empty one", async () => {
    const onSeedDefined = vi.fn();
    renderArea({ onSeedDefined });
    openDirect();
    pickKind("bitstring");

    const bits = "01".repeat(800); // exactly 1600 valid bits
    fireEvent.change(screen.getByTestId("arweave-seed-direct-bitstring-input"), {
      target: { value: bits },
    });
    expect(screen.getByTestId("arweave-seed-confirm")).toBeEnabled();

    pickKind("base49");

    const base49Field = screen.getByTestId("arweave-seed-direct-base49-input") as HTMLTextAreaElement;
    expect(base49Field.value).not.toBe("");
    expect(screen.getByTestId("arweave-seed-confirm")).toBeEnabled();

    // Prove it is the ACTUAL equivalent, not just non-empty: confirming from
    // here must define a seed with the SAME 1600 bits the BitString field held.
    fireEvent.click(screen.getByTestId("arweave-seed-confirm"));
    await waitFor(() => expect(onSeedDefined).toHaveBeenCalledTimes(1));
    const seed = onSeedDefined.mock.calls[0][0] as ArweaveSeedRecord;
    expect(seed.bits).toBe(bits);
  });

  it("shows the Seed name field in Direct mode too — it must not be Seed-Based-only", async () => {
    // Regression: the name input used to sit INSIDE the Seed-Based-only
    // branch of the form, so it silently disappeared whenever Direct mode
    // was active — a Direct-defined seed could never be named.
    const onSeedDefined = vi.fn();
    renderArea({ seeds: [PRIME_SEED], onSeedDefined });
    fireEvent.click(screen.getByTestId("arweave-add-seed"));
    fireEvent.click(screen.getByTestId("arweave-seed-mode-direct"));
    pickKind("bitstring");

    const nameField = screen.getByTestId("arweave-seed-label-input") as HTMLInputElement;
    expect(nameField).toBeInTheDocument();
    // This is NOT the prime seed (one already exists) — the field must be a
    // real, editable name input, not the locked Prime one.
    expect(nameField.readOnly).toBe(false);

    fireEvent.change(nameField, { target: { value: "My Direct Seed" } });
    fireEvent.change(screen.getByTestId("arweave-seed-direct-bitstring-input"), {
      target: { value: "01".repeat(800) },
    });
    fireEvent.click(screen.getByTestId("arweave-seed-confirm"));

    await waitFor(() => expect(onSeedDefined).toHaveBeenCalledTimes(1));
    const seed = onSeedDefined.mock.calls[0][0] as ArweaveSeedRecord;
    expect(seed.label).toBe("My Direct Seed");
  });

  // `former-master-record` T1 — was "locks the Seed name to the Prime label in
  // Direct mode too". The Seed name field is the USER's in every mode now; the
  // master designation is derived from the master id, not typed into this box.
  it("offers an editable, empty Seed name in Direct mode for the very first seed too", () => {
    renderArea();
    openDirect();

    const nameField = screen.getByTestId("arweave-seed-label-input") as HTMLInputElement;
    expect(nameField.value).toBe("");
    expect(nameField.readOnly).toBe(false);
  });

  it("switching from BitString to Bitmap paints the ACTUAL grid with the converted bits — not just the internal state, the visible SCREEN", () => {
    renderArea();
    openDirect();
    pickKind("bitstring");

    // A deterministic, checkable pattern: exactly the first row (40 cells at
    // 1600-bit/40×40) set, everything else clear.
    const bits = "1".repeat(40) + "0".repeat(1560);
    fireEvent.change(screen.getByTestId("arweave-seed-direct-bitstring-input"), {
      target: { value: bits },
    });
    expect(screen.getByTestId("arweave-seed-confirm")).toBeEnabled();

    pickKind("bitmap");

    // `BitmapKeyInput` is uncontrolled — the bug this regression pins is
    // that switching kind updated the tracked STATE but never reached the
    // actual rendered grid, since a plain `onChange`-only prop can't push a
    // new value into an already-uncontrolled component. Reading the real
    // rendered <rect> fills is the only way to prove the SCREEN, not just
    // `directBitmap`, shows the converted bitmap.
    const cells = document.querySelectorAll('[data-testid="arweave-seed-direct-bitmap"] svg rect');
    expect(cells).toHaveLength(1600);
    const filled = Array.from(cells).map((c) => c.getAttribute("fill") === "#d2d3d4");
    expect(filled.slice(0, 40).every(Boolean)).toBe(true); // first row: all set
    expect(filled.slice(40).some(Boolean)).toBe(false); // everything else: clear
  });

  it("switching from an imported/randomised Bitmap to Base-49 does NOT error — it converts the bitmap's bits, matching the user's exact report", async () => {
    const onSeedDefined = vi.fn();
    renderArea({ onSeedDefined });
    openDirect();
    pickKind("bitmap");

    fireEvent.click(screen.getByRole("button", { name: /Randomise/i }));

    pickKind("base49");

    // The exact bug reported: switching away from a valid Bitmap used to
    // show "core bits length ... != safe-scalar size ..." because the
    // target field started EMPTY instead of holding the bitmap's own bits.
    expect(screen.queryByTestId("arweave-seed-direct-error")).toBeNull();
    const base49Field = screen.getByTestId("arweave-seed-direct-base49-input") as HTMLTextAreaElement;
    expect(base49Field.value).not.toBe("");
    expect(screen.getByTestId("arweave-seed-confirm")).toBeEnabled();

    fireEvent.click(screen.getByTestId("arweave-seed-confirm"));
    await waitFor(() => expect(onSeedDefined).toHaveBeenCalledTimes(1));
    const seed = onSeedDefined.mock.calls[0][0] as ArweaveSeedRecord;
    expect(seed.bits).toMatch(/^[01]{1600}$/);
  });

  it("switching from Base-10 to Bitmap populates the grid with the converted bitmap instead of a blank one", async () => {
    const onSeedDefined = vi.fn();
    renderArea({ onSeedDefined });
    openDirect();
    pickKind("base10");

    fireEvent.click(screen.getByTestId("arweave-seed-direct-random-base10"));
    const base10Text = (screen.getByTestId("arweave-seed-direct-base10-input") as HTMLTextAreaElement)
      .value;
    expect(screen.getByTestId("arweave-seed-confirm")).toBeEnabled();

    pickKind("bitmap");

    // A freshly blank BitmapKeyInput would leave nothing valid to confirm —
    // Confirm staying enabled here is only possible because the grid was
    // populated with the CONVERTED bitmap, not a fresh empty one. Proven
    // conclusively by round-tripping through Confirm: the defined seed's
    // bits must be the same clamped scalar's bits, converted and back.
    expect(screen.getByTestId("arweave-seed-confirm")).toBeEnabled();

    fireEvent.click(screen.getByTestId("arweave-seed-confirm"));
    await waitFor(() => expect(onSeedDefined).toHaveBeenCalledTimes(1));
    const seed = onSeedDefined.mock.calls[0][0] as ArweaveSeedRecord;
    // Convert the ORIGINAL base-10 text the same way `resolveDirectScalar`
    // does, to compare against what actually got defined.
    const expectedBits = validatePrivateKey(base10Text, 10, DALOS_ELLIPSE).bitString;
    expect(seed.bits).toBe(expectedBits);
  });

  /* ── reveal + SeedRow subtitle ── */

  it("a 1024-bit Direct seed's reveal shows the 32 × 32 Bitmap tab (APOLLO), no Seed tab", () => {
    const APOLLO_SEED: ArweaveSeedRecord = {
      id: "apollo-direct",
      label: "Apollo Direct Seed",
      bits: "0".repeat(1024),
      bitLength: 1024,
      sourceLabel: "Direct: BitString (1024-bit)",
    };
    renderArea({ seeds: [PRIME_SEED, APOLLO_SEED] });

    fireEvent.click(screen.getByTestId("arweave-seed-reveal-apollo-direct"));

    expect(screen.getByText("32 × 32")).toBeInTheDocument();
    expect(screen.queryByText("40 × 40")).toBeNull();
    expect(screen.queryByText("Seed")).toBeNull();
  });

  // Round 19 owner correction: "i can only see the bitstring, i should be
  // able to see the seed words as well." There genuinely are none to show
  // for a wordless (Direct-mode, or session-reloaded) seed — this asserts
  // the honest explanatory note now shown instead of a silent, unexplained
  // bitstring-only dump.
  it("a wordless seed's reveal shows an explanatory note instead of silently omitting the Seed tab", () => {
    const APOLLO_SEED: ArweaveSeedRecord = {
      id: "apollo-direct",
      label: "Apollo Direct Seed",
      bits: "0".repeat(1024),
      bitLength: 1024,
      sourceLabel: "Direct: BitString (1024-bit)",
    };
    renderArea({ seeds: [PRIME_SEED, APOLLO_SEED] });

    fireEvent.click(screen.getByTestId("arweave-seed-reveal-apollo-direct"));

    const note = screen.getByTestId("arweave-seed-reveal-no-words-note");
    expect(note.textContent).toMatch(/no seed words to show/i);
  });

  it("a 1600-bit Direct seed's reveal shows the 40 × 40 Bitmap tab (DALOS)", () => {
    const DALOS_DIRECT_SEED: ArweaveSeedRecord = {
      id: "dalos-direct",
      label: "Dalos Direct Seed",
      bits: "0".repeat(1600),
      bitLength: 1600,
      sourceLabel: "Direct: BitString (1600-bit)",
    };
    renderArea({ seeds: [PRIME_SEED, DALOS_DIRECT_SEED] });

    fireEvent.click(screen.getByTestId("arweave-seed-reveal-dalos-direct"));

    expect(screen.getByText("40 × 40")).toBeInTheDocument();
    expect(screen.queryByText("32 × 32")).toBeNull();
  });

  it("a 1024-bit Direct seed's SeedRow subtitle reads 1024-bit APOLLO, not 1600-bit DALOS", () => {
    const APOLLO_SEED: ArweaveSeedRecord = {
      id: "apollo-direct",
      label: "Apollo Direct Seed",
      bits: "0".repeat(1024),
      bitLength: 1024,
      sourceLabel: "Direct: BitString (1024-bit)",
    };
    renderArea({ seeds: [PRIME_SEED, APOLLO_SEED] });

    const row = screen.getByTestId("arweave-seed-row-apollo-direct");
    expect(row.textContent).toContain("1024-bit APOLLO seed");
    expect(row.textContent).not.toContain("1600-bit DALOS seed");
  });

  /* ── generation against a 1024-bit Direct seed ── */

  it("generation (startRun) works unchanged against a 1024-bit Direct seed, exactly as for a 1600-bit one", async () => {
    const APOLLO_SEED: ArweaveSeedRecord = {
      id: "apollo-direct",
      label: "Apollo Direct Seed",
      bits: "0".repeat(1024),
      bitLength: 1024,
      sourceLabel: "Direct: BitString (1024-bit)",
    };
    const worker = new FakeWorker();
    const persistKey = vi.fn();
    renderArea({
      seeds: [PRIME_SEED, APOLLO_SEED],
      persistKey,
      workerFactory: () => worker as unknown as Worker,
    });

    fireEvent.click(screen.getByTestId("arweave-seed-toggle-apollo-direct"));
    fireEvent.click(within(screen.getByTestId("arweave-seed-row-apollo-direct")).getByTestId("arweave-generate-run"));

    await waitFor(() => expect(worker.onmessage).not.toBeNull());
    worker.emit(keyMsg(0));
    worker.emit({ kind: "batch-done" });

    await waitFor(() => expect(persistKey).toHaveBeenCalledTimes(1));
    expect(persistKey.mock.calls[0][0]).toMatchObject({
      seedId: "apollo-direct",
      index: 0,
      address: "ADDR-0",
    });
  });
});

/**
 * Quick vs Custom Define (design.md ask D).
 *
 * Each case guards a distinct regression:
 *   (both buttons) a genuinely empty Codex must offer BOTH the one-click path
 *       and the full form — hiding either strands a class of user (one with
 *       no CodexPrime account has no Quick option at all; that must still
 *       leave Custom reachable).
 *   (only Custom) once ANY Arweave account exists, Quick Define must be GONE
 *       — its whole premise (a one-click CodexPrime-account derivation) no
 *       longer describes "the first thing this Codex does".
 *   (disabled + tooltip) Quick Define must never invite a click it cannot
 *       honour — the missing-default and missing-seam cases both need a
 *       named reason, not a silent no-op.
 *   (one-click run) THE feature: one click must define the Prime seed AND
 *       generate EXACTLY position 0 — no form, no dialog, no extra positions.
 */
describe("ArweaveSeedsArea — Quick vs Custom Define (D)", () => {
  const DEFAULT_DALOS_ACCOUNT = {
    id: "acct-prime",
    label: "CodexPrime",
    account: { address: "Ѻ.abc", originMode: "seedWords" as const },
    isDefault: true,
  };

  it("shows BOTH Quick Define and Custom Define Arweave Seed when the Codex holds zero Arweave accounts", () => {
    renderArea({ existingKeys: [] });

    expect(screen.getByTestId("arweave-seed-quick-define")).toHaveTextContent("Quick Define");
    expect(screen.getByTestId("arweave-seed-custom-define")).toHaveTextContent(
      "Custom Define Arweave Seed",
    );
  });

  it("shows ONLY Custom Define once at least one Arweave account exists — Quick Define is gone entirely", () => {
    renderArea({ existingKeys: [makeKey({ seedId: "legacy", index: 0, address: "ADDR-LEGACY" })] });

    expect(screen.queryByTestId("arweave-seed-quick-define")).toBeNull();
    expect(screen.getByTestId("arweave-seed-custom-define")).toBeInTheDocument();
  });

  it("disables Quick Define with a tooltip when no activated dalos-curve Ouronet account exists at all", () => {
    renderArea({ existingKeys: [], ouronetAccounts: [] });

    const quick = screen.getByTestId("arweave-seed-quick-define");
    expect(quick).toBeDisabled();
    expect(quick.getAttribute("title")).toMatch(/dalos-curve/i);
  });

  it("falls back to the FIRST activated dalos account when none is explicitly flagged default (CodexPrime never went through fresh kickstart)", () => {
    // Regression: a codex that never ran fresh kickstart can have activated
    // dalos accounts with no account flagged isPrime/isDefault at all. Quick
    // Define must still be usable rather than permanently disabled.
    const undefaultedAccount = { ...DEFAULT_DALOS_ACCOUNT, isDefault: undefined };
    renderArea({
      existingKeys: [],
      ouronetAccounts: [undefaultedAccount],
      revealAccountSecret: vi.fn(async () => "hello world"),
      workerFactory: () => new FakeWorker() as unknown as Worker,
      persistKey: vi.fn(),
    });

    expect(screen.getByTestId("arweave-seed-quick-define")).toBeEnabled();
  });

  it("disables Quick Define with a tooltip when the required seams (worker/persist/reveal) are absent", () => {
    renderArea({ existingKeys: [], ouronetAccounts: [DEFAULT_DALOS_ACCOUNT] });

    const quick = screen.getByTestId("arweave-seed-quick-define");
    expect(quick).toBeDisabled();
    expect(quick.getAttribute("title")).toMatch(/not wired/i);
  });

  it("enables Quick Define once a default account and every seam are present", () => {
    renderArea({
      existingKeys: [],
      ouronetAccounts: [DEFAULT_DALOS_ACCOUNT],
      revealAccountSecret: vi.fn(async () => "hello world"),
      workerFactory: () => new FakeWorker() as unknown as Worker,
      persistKey: vi.fn(),
    });

    expect(screen.getByTestId("arweave-seed-quick-define")).toBeEnabled();
  });

  it("one click: defines the Prime seed from the CodexPrime account and generates EXACTLY position 0 — no form, no dialog", async () => {
    const worker = new FakeWorker();
    const onSeedDefined = vi.fn();
    const persistKey = vi.fn();
    const revealAccountSecret = vi.fn(async () => "hello world");

    renderArea({
      existingKeys: [],
      ouronetAccounts: [DEFAULT_DALOS_ACCOUNT],
      revealAccountSecret,
      workerFactory: () => worker as unknown as Worker,
      persistKey,
      onSeedDefined,
    });

    fireEvent.click(screen.getByTestId("arweave-seed-quick-define"));

    // The seed is defined immediately — no form, no dialog appeared.
    await waitFor(() => expect(onSeedDefined).toHaveBeenCalledTimes(1));
    const defined = onSeedDefined.mock.calls[0][0] as ArweaveSeedRecord;
    expect(defined.isPrime).toBe(true);
    // `former-master-record` T1 — Quick Define has no name field, so it stores
    // NO name. It used to store the master designation; that designation is
    // derived from the master id now, never persisted on the row.
    expect(defined.label).toBe("");
    expect(screen.queryByTestId("arweave-seed-define-form")).toBeNull();

    // …and the run starts on its own, driving the SAME injected worker.
    await waitFor(() => expect(worker.onmessage).not.toBeNull());
    worker.emit(keyMsg(0));
    worker.emit({ kind: "batch-done" });

    await waitFor(() => expect(persistKey).toHaveBeenCalledTimes(1));
    expect(persistKey.mock.calls[0][0]).toMatchObject({ seedId: defined.id, index: 0 });
    // Exactly ONE key — position 0 only, never more.
    expect(persistKey).toHaveBeenCalledTimes(1);
  });

  it("surfaces a failed reveal inline instead of defining a seed from bad material", async () => {
    const onSeedDefined = vi.fn();
    renderArea({
      existingKeys: [],
      ouronetAccounts: [DEFAULT_DALOS_ACCOUNT],
      revealAccountSecret: vi.fn(async () => {
        throw new Error("Codex is locked.");
      }),
      workerFactory: () => new FakeWorker() as unknown as Worker,
      persistKey: vi.fn(),
      onSeedDefined,
    });

    fireEvent.click(screen.getByTestId("arweave-seed-quick-define"));

    const error = await screen.findByTestId("arweave-seed-quick-define-error");
    expect(error.textContent).toContain("Codex is locked.");
    expect(onSeedDefined).not.toHaveBeenCalled();
    expect(screen.getByTestId("arweave-prime-seed-row")).toHaveAttribute("data-defined", "false");
  });
});

/**
 * `onRunActivityChange` — the seam T2 uses to warn before an in-flight
 * generation is silently abandoned (design.md ask A, T1's half of it).
 *
 * Each case guards a distinct regression:
 *   (fires while running) if the parent never learns a run is live, it can
 *       never warn before a navigation away orphans it.
 *   (settles to null) a stale activity surviving past its run would let the
 *       parent warn about a generation that is no longer happening.
 *   (cancel reaches the worker) the whole POINT of exposing `cancel` is that
 *       clicking "Stop generation now" in T2's dialog must actually stop the
 *       CPU work — a `cancel` that does not reach `worker.terminate()` would
 *       leave the run alive under a dialog that claims to have stopped it.
 *   (additive) a consumer that never wires the prop must see no behavior
 *       change at all.
 */
describe("ArweaveSeedsArea — onRunActivityChange (T1 · 7)", () => {
  it("fires the running seed's label and a working cancel while a run is in progress, then fires null once it settles", async () => {
    const worker = new FakeWorker();
    const persistKey = vi.fn();
    const onRunActivityChange = vi.fn();

    renderArea({
      seeds: [PRIME_SEED],
      existingKeys: [],
      persistKey,
      workerFactory: () => worker as unknown as Worker,
      onRunActivityChange,
    });
    fireEvent.click(screen.getByTestId("arweave-seed-toggle-prime"));
    fireEvent.click(screen.getByTestId("arweave-generate-run")); // Default — just #0

    await waitFor(() =>
      expect(onRunActivityChange).toHaveBeenCalledWith(
        expect.objectContaining({ seedLabel: "Master ArWeave Seed" }),
      ),
    );
    const lastActivity = onRunActivityChange.mock.calls.at(-1)![0] as {
      seedLabel: string;
      cancel: () => void;
    } | null;
    expect(lastActivity).not.toBeNull();

    // The exposed `cancel` reaches the SAME place the Cancel button does.
    lastActivity!.cancel();
    await waitFor(() => expect(worker.terminated).toBe(true));

    // And the activity clears once the run is no longer running.
    await waitFor(() =>
      expect(onRunActivityChange.mock.calls.at(-1)![0]).toBeNull(),
    );
  });

  it("is purely additive — a run proceeds normally when the prop is omitted", async () => {
    const worker = new FakeWorker();
    const persistKey = vi.fn();

    renderArea({
      seeds: [PRIME_SEED],
      existingKeys: [],
      persistKey,
      workerFactory: () => worker as unknown as Worker,
    });
    fireEvent.click(screen.getByTestId("arweave-seed-toggle-prime"));
    fireEvent.click(screen.getByTestId("arweave-generate-run"));

    await waitFor(() => expect(worker.onmessage).not.toBeNull());
    worker.emit(keyMsg(0));
    worker.emit({ kind: "batch-done" });

    await waitFor(() => expect(persistKey).toHaveBeenCalledTimes(1));
  });
});

/**
 * ArweavePanel — warn before abandoning an in-flight generation (T2, design.md
 * ask A). `ArweaveSeedsArea` only REPORTS its live run upward via
 * `onRunActivityChange` (T1); the panel is the piece that actually intercepts a
 * category switch and asks the user what to do with the run they are about to
 * lose sight of.
 *
 * Each case guards a distinct regression:
 *   (dialog blocks the switch) if the category switched immediately, the user
 *       would land on Accounts with no idea the generation is still running
 *       (or was silently abandoned) — the whole point of the warning is that it
 *       must appear BEFORE the Seeds area unmounts.
 *   (continue) "Continue in background" must not stop the CPU work — a build
 *       that terminated the worker here would make the button lie.
 *   (stop) "Stop generation now" must reach the SAME place the in-area Cancel
 *       button does (`worker.terminate()`), or a user who explicitly asked to
 *       stop would keep burning CPU on an unseen run.
 *   (no run, no dialog) switching tabs is instant work for every user who is
 *       not mid-generation — a dialog gating every tab click would be a
 *       regression the rest of the suite already exercises without expecting.
 */
describe("ArweavePanel — warn before leaving an in-flight generation (T2)", () => {
  function makeFullDeps(): { deps: ArweavePanelDeps; getWorker: () => FakeWorker | undefined } {
    let worker: FakeWorker | undefined;
    const fakeLibraryStore = {
      append: vi.fn(async () => {}),
      get: vi.fn(async () => undefined),
      updateStatus: vi.fn(async () => {}),
      list: vi.fn(async () => []),
    } as unknown as LibraryStore;
    const deps: ArweavePanelDeps = {
      address: "ADDR-HOST",
      foreignKeys: [],
      keygenRunner: { runKeygen: vi.fn(async () => fakeJwk) },
      generateArweaveKey: vi.fn(async ({ label }) => ({
        id: "GENERATED-ID",
        chainId: ARWEAVE_CHAIN_ID,
        encryptedKeyfile: "ct",
        label,
      })),
      importArweaveKey: vi.fn(async () => ({
        id: "unused",
        chainId: ARWEAVE_CHAIN_ID,
        encryptedKeyfile: "ct",
      })),
      decryptArweaveKey: vi.fn(async () => fakeJwk),
      addForeignKey: vi.fn(async () => {}),
      renameForeignKey: vi.fn(async () => {}),
      deleteForeignKey: vi.fn(async () => {}),
      getBalance: vi.fn(async () => 0n),
      send: vi.fn(async () => ({ id: "tx", reward: 0n })),
      sendFrom: vi.fn(async () => ({ id: "tx", reward: 0n })),
      estimateFee: vi.fn(async () => 100_000_000n),
      pollStatus: vi.fn(async () => "final" as const),
      uploadAndTrack: vi.fn(async () => ({
        id: "item",
        itemId: "item",
        ownerAddress: "ADDR-HOST",
        tags: [],
      })),
      uploadFilesAndTrack: vi.fn(async () => ({
        manifestId: "manifest-id",
        fileIds: [],
        uploadId: "upload-id",
      })),
      getExportJson: vi.fn(async () => "{}"),
      backupCodex: vi.fn(async () => ({ id: "backup-id" })),
      listLibrary: vi.fn(async () => []),
      openUrl: vi.fn((id: string) => `https://arweave.net/${id}`),
      rebuildLibrary: vi.fn(async () => {}),
      libraryStore: fakeLibraryStore,
      pool: {} as unknown as GatewayPool,
      addressBook: [],
      workerFactory: () => {
        worker = new FakeWorker();
        return worker as unknown as Worker;
      },
    };
    return { deps, getWorker: () => worker };
  }

  /** Defines the Prime seed and drives a generate run up to (but not past)
   *  `status: "running"` — emits a `batch-progress` event, which advances the
   *  run's state without ever posting a terminal message, so the run is
   *  genuinely still in flight when the test tries to navigate away. */
  async function startAnInFlightRun(getWorker: () => FakeWorker | undefined): Promise<void> {
    fireEvent.click(screen.getByTestId("arweave-subtab-seeds"));
    openDefineForm();
    fireEvent.change(screen.getByTestId("arweave-seed-words-input"), {
      target: { value: "hello world" },
    });
    fireEvent.click(screen.getByTestId("arweave-seed-confirm"));
    await waitFor(() =>
      expect(screen.getByTestId("arweave-prime-seed-row")).toHaveAttribute("data-defined", "true"),
    );

    const seedId = screen.getByTestId("arweave-prime-seed-row").getAttribute("data-seed-id")!;
    fireEvent.click(screen.getByTestId(`arweave-seed-toggle-${seedId}`));
    fireEvent.click(screen.getByTestId("arweave-generate-run"));

    await waitFor(() => expect(getWorker()?.onmessage).not.toBeNull());
    getWorker()!.emit({
      kind: "batch-progress",
      ev: {
        index: 0,
        completedCount: 0,
        totalCount: 1,
        addressProgress: 0.5,
        overallProgress: 0.5,
        stage: "q",
        attempts: 12,
      },
    });
  }

  it("opens a confirm dialog naming the seed instead of switching category immediately", async () => {
    const { deps, getWorker } = makeFullDeps();
    render(
      <ArweavePanelProvider deps={deps}>
        <ArweavePanel id={ARWEAVE_CHAIN_ID} />
      </ArweavePanelProvider>,
    );
    await startAnInFlightRun(getWorker);

    fireEvent.click(screen.getByTestId("arweave-subtab-accounts"));

    const dialog = screen.getByTestId("arweave-leave-generation-dialog");
    expect(dialog).toHaveTextContent("Master ArWeave Seed");
    // The category has NOT switched yet — Seeds is still mounted.
    expect(screen.getByTestId("arweave-seeds-area")).toBeInTheDocument();
    expect(screen.queryByTestId("arweave-accounts-area")).toBeNull();
  });

  it("'Continue in background' switches category without stopping the worker", async () => {
    const { deps, getWorker } = makeFullDeps();
    render(
      <ArweavePanelProvider deps={deps}>
        <ArweavePanel id={ARWEAVE_CHAIN_ID} />
      </ArweavePanelProvider>,
    );
    await startAnInFlightRun(getWorker);

    fireEvent.click(screen.getByTestId("arweave-subtab-accounts"));
    fireEvent.click(screen.getByTestId("arweave-leave-generation-continue"));

    expect(screen.getByTestId("arweave-accounts-area")).toBeInTheDocument();
    expect(screen.queryByTestId("arweave-leave-generation-dialog")).toBeNull();
    expect(getWorker()!.terminated).toBe(false);
  });

  it("'Stop generation now' terminates the worker, then switches category", async () => {
    const { deps, getWorker } = makeFullDeps();
    render(
      <ArweavePanelProvider deps={deps}>
        <ArweavePanel id={ARWEAVE_CHAIN_ID} />
      </ArweavePanelProvider>,
    );
    await startAnInFlightRun(getWorker);

    fireEvent.click(screen.getByTestId("arweave-subtab-accounts"));
    fireEvent.click(screen.getByTestId("arweave-leave-generation-stop"));

    await waitFor(() => expect(getWorker()!.terminated).toBe(true));
    expect(screen.getByTestId("arweave-accounts-area")).toBeInTheDocument();
    expect(screen.queryByTestId("arweave-leave-generation-dialog")).toBeNull();
  });

  it("switches category immediately, with no dialog, when no run is active", () => {
    render(<ArweavePanel id={ARWEAVE_CHAIN_ID} />);

    fireEvent.click(screen.getByTestId("arweave-subtab-seeds"));
    expect(screen.getByTestId("arweave-seeds-area")).toBeInTheDocument();
    expect(screen.queryByTestId("arweave-leave-generation-dialog")).toBeNull();

    fireEvent.click(screen.getByTestId("arweave-subtab-upload"));
    expect(screen.getByTestId("arweave-upload-unavailable")).toBeInTheDocument();
    expect(screen.queryByTestId("arweave-leave-generation-dialog")).toBeNull();
  });
});

/**
 * "View Seed" per-row reveal (arweave-seed-reveal-v1, T1).
 *
 * Each case guards a distinct regression:
 *   - the control must exist on EVERY row (Prime and non-Prime) — a reveal
 *     reachable from only one row leaves the other's key material unviewable.
 *   - clicking it must mount the REAL `DalosSecretReveal` (not a stub) so the
 *     bitstring it derives is trustworthy — asserted on its actual tab labels.
 *   - a seed whose `bits` came back `""` (host has not decrypted it) must NEVER
 *     reach `DalosSecretReveal`: that component's own `plaintext` guard turns
 *     an empty string into a null derivation, which would silently show broken
 *     "Could not derive…" panels instead of naming the real cause (locked codex).
 *   - the close control must actually unmount the overlay, or a user is stuck
 *     staring at their own key material with no way back to the row list.
 */
describe("ArweaveSeedsArea — View Seed reveal (arweave-seed-reveal-v1, T1)", () => {
  const SECOND_SEED: ArweaveSeedRecord = {
    id: "second",
    label: "Second Arweave Seed",
    bits: "0".repeat(SEED_BIT_LENGTH),
  };

  const LOCKED_SEED: ArweaveSeedRecord = {
    id: "empty",
    label: "Locked Arweave Seed",
    bits: "",
  };

  it("shows a View Seed control on both the Prime row and a non-Prime row", () => {
    renderArea({ seeds: [PRIME_SEED, SECOND_SEED] });

    expect(screen.getByTestId("arweave-seed-reveal-prime")).toBeInTheDocument();
    expect(screen.getByTestId("arweave-seed-reveal-second")).toBeInTheDocument();
  });

  it("opens DalosSecretReveal's real tabbed output when a defined seed's control is clicked", () => {
    renderArea({ seeds: [PRIME_SEED] });

    fireEvent.click(screen.getByTestId("arweave-seed-reveal-prime"));

    // The four bit-derived tabs DalosSecretReveal renders for `originMode:
    // "bitString"` — proof the real component mounted and derived a key from
    // the seed's actual bits, not a stub.
    expect(screen.getByText("Bitmap")).toBeInTheDocument();
    expect(screen.getByText("BitString")).toBeInTheDocument();
    expect(screen.getByText("Base-10")).toBeInTheDocument();
    expect(screen.getByText("Base-49")).toBeInTheDocument();
    expect(screen.queryByTestId("arweave-seed-reveal-locked")).toBeNull();
  });

  it("shows the locked notice instead of DalosSecretReveal when the seed's bits are empty", () => {
    renderArea({ seeds: [PRIME_SEED, LOCKED_SEED] });

    fireEvent.click(screen.getByTestId("arweave-seed-reveal-empty"));

    expect(screen.getByTestId("arweave-seed-reveal-locked")).toBeInTheDocument();
    // DalosSecretReveal never mounts on an empty plaintext — none of its tab
    // labels should be anywhere in the document.
    expect(screen.queryByText("BitString")).toBeNull();
    expect(screen.queryByText("Base-49")).toBeNull();
  });

  it("dismisses the overlay when the close control is clicked", () => {
    renderArea({ seeds: [PRIME_SEED] });

    fireEvent.click(screen.getByTestId("arweave-seed-reveal-prime"));
    expect(screen.getByText("BitString")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("arweave-seed-reveal-close"));

    expect(screen.queryByText("BitString")).toBeNull();
    expect(screen.queryByTestId("arweave-seed-reveal-close")).toBeNull();
  });
});

/**
 * "View Seed" reveal — provenance (UX bug fix: the reveal used to say
 * "Created from bitstring (1600 bits)" for EVERY seed, regardless of whether
 * it was typed, taken from an Ouronet account, taken from a Chainweb seed, or
 * Quick-Defined — and it always showed a meaningless "Standard address"
 * block (an Ouronet/Apollo concept with zero relevance to an Arweave seed).
 *
 * Each case guards a distinct regression:
 *   - each of the three Custom sources, and Quick Define, must show the
 *     ACTUAL provenance text (not the generic bitstring wording) in the
 *     reveal — the user's whole complaint was that this was indistinguishable
 *     across sources.
 *   - "Standard address"/"Smart address" must NEVER appear in the Arweave
 *     reveal — there is no case where an Ouronet address is relevant here.
 *   - a seed with no `sourceLabel` (e.g. reloaded from storage, where the
 *     session-only label was lost) must still open without crashing and fall
 *     back to `DalosSecretReveal`'s own default text.
 */
describe("ArweaveSeedsArea — View Seed reveal shows provenance (arweave-seed-provenance-v1)", () => {
  const DALOS_ACCOUNT = {
    id: "acct-prime",
    label: "Explorer",
    account: { address: "Ѻ.abc", originMode: "seedWords" as const },
    isDefault: true,
  };
  const CHAINWEB_SEED = {
    id: "cw-prime",
    label: "Prime Codex Seed",
    words: "abandon ability able about above absent absorb abstract absurd abuse access accident".split(" "),
    isDefault: true,
  };

  function openReveal(seedId: string): void {
    fireEvent.click(screen.getByTestId(`arweave-seed-reveal-${seedId}`));
  }

  it("shows 'Typed seed words' for a seed defined from Free Seed Input words", async () => {
    const onSeedDefined = vi.fn();
    renderArea({ onSeedDefined });
    openDefineForm();

    fireEvent.change(screen.getByTestId("arweave-seed-words-input"), {
      target: { value: "hello world" },
    });
    fireEvent.click(screen.getByTestId("arweave-seed-confirm"));

    await waitFor(() => expect(onSeedDefined).toHaveBeenCalledTimes(1));
    const seed = onSeedDefined.mock.calls[0][0] as ArweaveSeedRecord;

    openReveal(seed.id);

    expect(screen.getByText(/Typed seed words/)).toBeInTheDocument();
    expect(screen.queryByText(/Created from.*bitstring/)).toBeNull();
  });

  it("names the Ouronet account for a seed defined from an activated account (option 2)", async () => {
    const onSeedDefined = vi.fn();
    renderArea({
      onSeedDefined,
      ouronetAccounts: [DALOS_ACCOUNT],
      revealAccountSecret: vi.fn(async () => "hello world"),
    });
    openDefineForm();

    fireEvent.click(screen.getByTestId("arweave-seed-source-account"));
    fireEvent.click(screen.getByTestId("arweave-seed-confirm"));

    await waitFor(() => expect(onSeedDefined).toHaveBeenCalledTimes(1));
    const seed = onSeedDefined.mock.calls[0][0] as ArweaveSeedRecord;

    openReveal(seed.id);

    expect(screen.getByText(/Ouronet account "Explorer"/)).toBeInTheDocument();
  });

  it("names the Chainweb seed for a seed defined from an existing Chainweb seed (option 3)", async () => {
    const onSeedDefined = vi.fn();
    renderArea({ onSeedDefined, chainwebSeeds: [CHAINWEB_SEED] });
    openDefineForm();

    fireEvent.click(screen.getByTestId("arweave-seed-source-chainweb"));
    fireEvent.click(screen.getByTestId("arweave-seed-confirm"));

    await waitFor(() => expect(onSeedDefined).toHaveBeenCalledTimes(1));
    const seed = onSeedDefined.mock.calls[0][0] as ArweaveSeedRecord;

    openReveal(seed.id);

    expect(screen.getByText(/Chainweb seed "Prime Codex Seed"/)).toBeInTheDocument();
  });

  it("names CodexPrime + Quick Define for a seed defined through Quick Define", async () => {
    const onSeedDefined = vi.fn();
    renderArea({
      existingKeys: [],
      ouronetAccounts: [DALOS_ACCOUNT],
      revealAccountSecret: vi.fn(async () => "hello world"),
      workerFactory: () => new FakeWorker() as unknown as Worker,
      persistKey: vi.fn(),
      onSeedDefined,
    });

    fireEvent.click(screen.getByTestId("arweave-seed-quick-define"));

    await waitFor(() => expect(onSeedDefined).toHaveBeenCalledTimes(1));
    const seed = onSeedDefined.mock.calls[0][0] as ArweaveSeedRecord;

    openReveal(seed.id);

    expect(screen.getByText(/CodexPrime Ouronet account "Explorer" \(Quick Define\)/)).toBeInTheDocument();
  });

  it("never shows 'Standard address' or 'Smart address' in the Arweave seed reveal", () => {
    renderArea({ seeds: [PRIME_SEED] });

    openReveal("prime");

    expect(screen.queryByText(/standard address/i)).toBeNull();
    expect(screen.queryByText(/smart address/i)).toBeNull();
  });

  it("opens the reveal without crashing for a seed with no sourceLabel (e.g. reloaded from storage), falling back to DalosSecretReveal's default text", () => {
    const NO_LABEL_SEED: ArweaveSeedRecord = {
      id: "no-label",
      label: "Reloaded Arweave Seed",
      bits: "1".repeat(SEED_BIT_LENGTH),
    };
    renderArea({ seeds: [PRIME_SEED, NO_LABEL_SEED] });

    openReveal("no-label");

    expect(screen.getByText(/bitstring \(1600 bits\)/)).toBeInTheDocument();
  });

  /* ── Actual words shown in the reveal (blurred, revealable) ── */

  it("shows the ACTUAL typed words (not just the derived bitstring) for a Free Seed Input seed", async () => {
    const onSeedDefined = vi.fn();
    renderArea({ onSeedDefined });
    openDefineForm();

    fireEvent.change(screen.getByTestId("arweave-seed-words-input"), {
      target: { value: "hello world" },
    });
    fireEvent.click(screen.getByTestId("arweave-seed-confirm"));

    await waitFor(() => expect(onSeedDefined).toHaveBeenCalledTimes(1));
    const seed = onSeedDefined.mock.calls[0][0] as ArweaveSeedRecord;
    expect(seed.words).toEqual(["hello", "world"]);

    openReveal(seed.id);

    // The Seed tab is the DEFAULT active tab for a seed-words-origin reveal —
    // the words are visible without clicking anything else first.
    expect(screen.getByText("hello")).toBeInTheDocument();
    expect(screen.getByText("world")).toBeInTheDocument();
  });

  it("shows the ACTUAL decrypted words for a seed-words-origin Ouronet account (option 2)", async () => {
    const onSeedDefined = vi.fn();
    renderArea({
      onSeedDefined,
      ouronetAccounts: [DALOS_ACCOUNT],
      revealAccountSecret: vi.fn(async () => "hello world"),
    });
    openDefineForm();

    fireEvent.click(screen.getByTestId("arweave-seed-source-account"));
    fireEvent.click(screen.getByTestId("arweave-seed-confirm"));

    await waitFor(() => expect(onSeedDefined).toHaveBeenCalledTimes(1));
    const seed = onSeedDefined.mock.calls[0][0] as ArweaveSeedRecord;
    expect(seed.words).toEqual(["hello", "world"]);

    openReveal(seed.id);

    expect(screen.getByText("hello")).toBeInTheDocument();
    expect(screen.getByText("world")).toBeInTheDocument();
  });

  it("Option 2 NEVER offers an account whose origin is not seed-words (bitstring/bitmap/scalar) — the Seed-Based generator's whole premise is words", () => {
    // Regression: this account used to be SELECTABLE (and the reveal fell
    // back to a bitstring-only view). The Seed-Based generator's premise is
    // that its bits always come from words, so a non-seed-words account has
    // no place here at all — that's exclusively the (separate) Direct
    // generator's territory. Option 2 must disable itself entirely, exactly
    // as it does with zero accounts, rather than offering a dead-end choice.
    const NON_WORDS_ACCOUNT = {
      id: "acct-bitstring",
      label: "Bitstring Account",
      account: { address: "Ѻ.def", originMode: "bitString" as const },
      isDefault: true,
    };
    renderArea({ ouronetAccounts: [NON_WORDS_ACCOUNT] });
    openDefineForm();

    const option2 = screen.getByTestId("arweave-seed-source-account");
    expect(option2).toBeDisabled();
    expect(option2).toHaveAttribute("title", expect.stringMatching(/seed-words/i));
  });

  it("still shows words for a LEGACY account with no originMode field at all — defaults to seed-words, same as bitStringOf", async () => {
    const LEGACY_ACCOUNT = {
      id: "acct-legacy",
      label: "AncientHodler",
      account: { address: "Ѻ.legacy" }, // no originMode — predates the field
      isDefault: true,
    };
    const onSeedDefined = vi.fn();
    renderArea({
      existingKeys: [],
      ouronetAccounts: [LEGACY_ACCOUNT],
      revealAccountSecret: vi.fn(async () => "hello world"),
      workerFactory: () => new FakeWorker() as unknown as Worker,
      persistKey: vi.fn(),
      onSeedDefined,
    });

    fireEvent.click(screen.getByTestId("arweave-seed-quick-define"));

    await waitFor(() => expect(onSeedDefined).toHaveBeenCalledTimes(1));
    const seed = onSeedDefined.mock.calls[0][0] as ArweaveSeedRecord;
    expect(seed.words).toEqual(["hello", "world"]);

    openReveal(seed.id);

    expect(screen.getByText("hello")).toBeInTheDocument();
    expect(screen.getByText("world")).toBeInTheDocument();
  });

  it("shows the ACTUAL Chainweb seed words (option 3)", async () => {
    const onSeedDefined = vi.fn();
    renderArea({ onSeedDefined, chainwebSeeds: [CHAINWEB_SEED] });
    openDefineForm();

    fireEvent.click(screen.getByTestId("arweave-seed-source-chainweb"));
    fireEvent.click(screen.getByTestId("arweave-seed-confirm"));

    await waitFor(() => expect(onSeedDefined).toHaveBeenCalledTimes(1));
    const seed = onSeedDefined.mock.calls[0][0] as ArweaveSeedRecord;
    expect(seed.words).toEqual(CHAINWEB_SEED.words);

    openReveal(seed.id);

    expect(screen.getByText("abandon")).toBeInTheDocument();
    expect(screen.getByText("accident")).toBeInTheDocument();
  });

  it("shows the ACTUAL words for a Quick-Defined seed, when CodexPrime's origin is seed-words", async () => {
    const onSeedDefined = vi.fn();
    renderArea({
      existingKeys: [],
      ouronetAccounts: [DALOS_ACCOUNT],
      revealAccountSecret: vi.fn(async () => "hello world"),
      workerFactory: () => new FakeWorker() as unknown as Worker,
      persistKey: vi.fn(),
      onSeedDefined,
    });

    fireEvent.click(screen.getByTestId("arweave-seed-quick-define"));

    await waitFor(() => expect(onSeedDefined).toHaveBeenCalledTimes(1));
    const seed = onSeedDefined.mock.calls[0][0] as ArweaveSeedRecord;
    expect(seed.words).toEqual(["hello", "world"]);

    openReveal(seed.id);

    expect(screen.getByText("hello")).toBeInTheDocument();
    expect(screen.getByText("world")).toBeInTheDocument();
  });
});

describe("ArweaveSeedsArea — the seed reveal is UNIFIED with Ouronet's (arweave-seed-reveal-v2)", () => {
  it("renders the reveal in the SAME popup chrome (CodexModalShell) at the SAME width Ouronet's ViewSeedModal uses", () => {
    renderArea({ seeds: [PRIME_SEED] });

    fireEvent.click(screen.getByTestId("arweave-seed-reveal-prime"));

    const dialog = screen.getByTestId("arweave-seed-reveal-modal-prime");
    expect(dialog).toHaveAttribute("role", "dialog");
    // CodexModalShell's card is the dialog's own child carrying `maxWidth` —
    // 880, byte-for-byte the value `ViewSeedModal.tsx` passes.
    const card = dialog.firstElementChild as HTMLElement;
    expect(card.style.maxWidth).toBe("880px");
  });

  it("still closes via the SAME close control testid as before the shell swap", () => {
    renderArea({ seeds: [PRIME_SEED] });

    fireEvent.click(screen.getByTestId("arweave-seed-reveal-prime"));
    expect(screen.getByTestId("arweave-seed-reveal-modal-prime")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("arweave-seed-reveal-close"));
    expect(screen.queryByTestId("arweave-seed-reveal-modal-prime")).toBeNull();
  });
});

describe("ArweaveSeedsArea — DALOS Charset info + Max Entropy (Free Seed Input)", () => {
  it("shows a 'DALOS Charset' link pointing at the docs page, only under the Stoa Dalos tile", () => {
    renderArea();
    openDefineForm();

    // Stoa Dalos is the default tile.
    const link = screen.getByTestId("arweave-seed-dalos-charset-link");
    expect(link).toHaveAttribute("href", "https://codex.ancientholdings.eu/docs/dalos-character-set.html");
    expect(link).toHaveAttribute("target", "_blank");

    fireEvent.click(screen.getByTestId("arweave-seed-input-tile-dict12"));
    expect(screen.queryByTestId("arweave-seed-dalos-charset-link")).toBeNull();
  });

  it("hides the 16×16 glyph preview until hovered, and shows exactly 256 glyphs while hovered", () => {
    renderArea();
    openDefineForm();

    const grid = screen.getByTestId("arweave-seed-dalos-charset-grid");
    expect(grid).toHaveStyle({ opacity: "0" });

    fireEvent.mouseEnter(screen.getByTestId("arweave-seed-dalos-charset-link").parentElement!);
    expect(grid).toHaveStyle({ opacity: "1" });
    expect(grid.querySelectorAll("span")).toHaveLength(256);

    fireEvent.mouseLeave(screen.getByTestId("arweave-seed-dalos-charset-link").parentElement!);
    expect(grid).toHaveStyle({ opacity: "0" });
  });

  it("the Free Seed Input textarea does NOT start pre-grown to a huge fixed height while empty", () => {
    renderArea();
    openDefineForm();

    const textarea = screen.getByTestId("arweave-seed-words-input");
    // No fixed floor — an empty box must not be a giant empty rectangle.
    expect(textarea.style.minHeight).toBe("");
    // The hard ceiling is still there: past this, it scrolls instead of
    // growing further (Max Entropy's 256×256-glyph worst case).
    expect(textarea.style.maxHeight).toBe("70vh");
  });

  it("grows the textarea's actual height to track its content, and shrinks it back down when content is removed", () => {
    renderArea();
    openDefineForm();

    const textarea = screen.getByTestId("arweave-seed-words-input") as HTMLTextAreaElement;
    // jsdom has no layout engine — `scrollHeight` is stubbed per keystroke to
    // simulate what a real browser measures once content pushes the box taller.
    Object.defineProperty(textarea, "scrollHeight", { configurable: true, value: 320 });
    fireEvent.change(textarea, { target: { value: "hello world" } });
    expect(textarea.style.height).toBe("320px");

    Object.defineProperty(textarea, "scrollHeight", { configurable: true, value: 48 });
    fireEvent.change(textarea, { target: { value: "" } });
    expect(textarea.style.height).toBe("48px");
  });

  it("Max Entropy fills the Free Seed Input with EXACTLY 256 words of 256 DALOS-charset glyphs each", () => {
    renderArea();
    openDefineForm();

    fireEvent.click(screen.getByTestId("arweave-seed-max-entropy"));

    const value = (screen.getByTestId("arweave-seed-words-input") as HTMLTextAreaElement).value;
    const words = value.trim().split(/\s+/);
    expect(words).toHaveLength(256);
    for (const word of words) {
      const glyphs = Array.from(word);
      expect(glyphs).toHaveLength(256);
    }
  });

  it("Max Entropy's output is accepted by the SAME seed engine it stress-tests — defines a real (junk) 1600-bit seed", async () => {
    const onSeedDefined = vi.fn();
    renderArea({ onSeedDefined });
    openDefineForm();

    fireEvent.click(screen.getByTestId("arweave-seed-max-entropy"));
    fireEvent.click(screen.getByTestId("arweave-seed-confirm"));

    await waitFor(() => expect(onSeedDefined).toHaveBeenCalledTimes(1));
    const seed = onSeedDefined.mock.calls[0][0] as ArweaveSeedRecord;
    expect(seed.bits).toHaveLength(SEED_BIT_LENGTH);
  });

  it("only DIFFERS from run to run (not a fixed fixture) — proves the glyphs are actually random, not hardcoded", () => {
    renderArea();
    openDefineForm();

    fireEvent.click(screen.getByTestId("arweave-seed-max-entropy"));
    const first = (screen.getByTestId("arweave-seed-words-input") as HTMLTextAreaElement).value;

    fireEvent.click(screen.getByTestId("arweave-seed-max-entropy"));
    const second = (screen.getByTestId("arweave-seed-words-input") as HTMLTextAreaElement).value;

    expect(first).not.toBe(second);
  });
});

// Owner correction (design.md §8, round 8 follow-up): "when there are more
// than 10 pages available the entry 15/24 when clicked needs to allow the
// input of a given page, to jump directly to a wanted page." Same mandate
// as `StoaAccountsTab`/`SeedWordsTab`'s own jump control — ported here for
// Arweave's own seed-list pagination.
describe("ArweaveSeedsArea — mobile seed-list pagination: page-jump input past 10 pages", () => {
  class FakeResizeObserver {
    callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }
    observe(target: Element) {
      this.callback([{ contentRect: { width: 390 } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
      void target;
    }
    unobserve() {}
    disconnect() {}
  }

  afterEach(() => vi.unstubAllGlobals());

  function renderManySeeds(count: number) {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const seeds: ArweaveSeedRecord[] = [
      PRIME_SEED,
      ...Array.from({ length: count }, (_, i) => ({ id: `s${i}`, label: `Seed ${i}`, bits: PRIME_BITS })),
    ];
    return render(
      <CodexUiRoot>
        <ArweaveSeedsArea seeds={seeds} />
      </CodexUiRoot>,
    );
  }

  it("provides a clickable jump control once seed count pushes past 10 pages, and jumping commits the typed page", () => {
    // Comfortably past the threshold regardless of the page-0 separator
    // deduction's exact size (jsdom's measurement stays at safe defaults).
    renderManySeeds(200);
    const jumpBtn = screen.getByText(/^1 \/ \d+$/);
    expect(jumpBtn.tagName).toBe("BUTTON");
    const totalPages = Number(jumpBtn.textContent!.split("/")[1].trim());
    expect(totalPages).toBeGreaterThan(10);

    fireEvent.click(jumpBtn);
    const input = screen.getByLabelText(/jump to page/i);
    fireEvent.change(input, { target: { value: "9" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("button", { name: `9 / ${totalPages}` })).toBeTruthy();
  });

  it("stays a plain, unclickable label at 10 or fewer pages", () => {
    // A handful of seeds paginates (more than one page, so Prev/Next
    // renders at all) but stays well under the >10 threshold.
    renderManySeeds(10);
    const label = screen.getByText(/^1 \/ \d+$/);
    expect(label.tagName).not.toBe("BUTTON");
  });

  // Owner correction (design.md §8, round 8 follow-up): "if we bring the
  // pagination engine in the bar below (see 4th screenshot), probably 4
  // would have fit." Mirrors `SeedWordsTab.tsx`'s identical correction.
  it("portals the Prev/Next bar into fullScreenPortalTarget, freeing the seed-list column of that row", () => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const target = document.createElement("div");
    document.body.appendChild(target);
    const seeds: ArweaveSeedRecord[] = [
      PRIME_SEED,
      ...Array.from({ length: 10 }, (_, i) => ({ id: `s${i}`, label: `Seed ${i}`, bits: PRIME_BITS })),
    ];
    const { container } = render(
      <CodexUiRoot>
        <ArweaveSeedsArea seeds={seeds} fullScreenPortalTarget={target} />
      </CodexUiRoot>,
    );
    const prevBtn = screen.getByRole("button", { name: /previous page/i });
    expect(target.contains(prevBtn)).toBe(true);
    expect(container.contains(prevBtn)).toBe(false);
    document.body.removeChild(target);
  });

  it("without a target, the Prev/Next bar falls back to the bounded inline mount", () => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const seeds: ArweaveSeedRecord[] = [
      PRIME_SEED,
      ...Array.from({ length: 10 }, (_, i) => ({ id: `s${i}`, label: `Seed ${i}`, bits: PRIME_BITS })),
    ];
    const { container } = render(
      <CodexUiRoot>
        <ArweaveSeedsArea seeds={seeds} />
      </CodexUiRoot>,
    );
    const prevBtn = screen.getByRole("button", { name: /previous page/i });
    expect(container.contains(prevBtn)).toBe(true);
  });
});

// Round 9 owner correction — "standard pagination controls zone": "we also
// need to agree on a standard pagination controls zone. If no expand
// collapse medallion exists at the middle of the bottom page... that's
// where the pagination controls should be in their own medallion." The
// Seeds view never has a Collapse-All medallion, so once a caller opts
// into `onPaginationHandleChange`, pagination is reported upward INSTEAD
// OF rendered inline — mirrors `SeedWordsTab.tsx`'s identical correction.
describe("ArweaveSeedsArea — reports pagination upward instead of inline once a caller opts in (onPaginationHandleChange)", () => {
  class FakeResizeObserver {
    callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }
    observe(target: Element) {
      this.callback([{ contentRect: { width: 390 } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
      void target;
    }
    unobserve() {}
    disconnect() {}
  }

  afterEach(() => vi.unstubAllGlobals());

  type PaginationHandle = { page: number; totalPages: number; onPrev: () => void; onNext: () => void; onJump: (page: number) => void } | null;

  function renderReporting(count: number, handleRef: { current: PaginationHandle }) {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const seeds: ArweaveSeedRecord[] = [
      PRIME_SEED,
      ...Array.from({ length: count }, (_, i) => ({ id: `s${i}`, label: `Seed ${i}`, bits: PRIME_BITS })),
    ];
    return render(
      <CodexUiRoot>
        <ArweaveSeedsArea seeds={seeds} onPaginationHandleChange={(h) => { handleRef.current = h; }} />
      </CodexUiRoot>,
    );
  }

  it("reports the handle, renders no inline/portaled Prev/Next", () => {
    const handleRef: { current: PaginationHandle } = { current: null };
    renderReporting(13, handleRef);
    expect(handleRef.current).toEqual(expect.objectContaining({ page: 0 }));
    expect(handleRef.current!.totalPages).toBeGreaterThan(1);
    expect(screen.queryByRole("button", { name: /next page/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /previous page/i })).toBeNull();

    const before = document.querySelectorAll("[data-seed-id]").length;
    act(() => handleRef.current?.onNext());
    expect(document.querySelectorAll("[data-seed-id]").length).toBeGreaterThan(0);
    expect(handleRef.current).toEqual(expect.objectContaining({ page: 1 }));
    void before;
  });

  it("reports null once everything fits on one page", () => {
    const handleRef: { current: PaginationHandle } = { current: null };
    renderReporting(0, handleRef);
    expect(screen.getByText("Master ArWeave Seed")).toBeTruthy();
    expect(handleRef.current).toBeNull();
  });
});

// Round 20 owner correction: "add arweave seed must be similar to how
// chainwebs seed is added wit ha plus button in the upper line aligned
// right" — `ArweaveSeedsArea` now reports its own `openDefine` up via
// `onOpenSeedFormHandleChange`, the same "report a handle upward" shape
// `onPaginationHandleChange` already uses, so `ArweavePanel`'s shared
// mobile tablist row can render the "+" in the same slot
// `ChainwebPanel.tsx` reserves for `SeedWordsTab`'s own "Create New Seed".
describe("ArweaveSeedsArea — reports openDefine upward for the relocated mobile '+' (onOpenSeedFormHandleChange)", () => {
  it("calls the handler with a function on mount, and with null on unmount", () => {
    const handleRef: { current: (() => void) | null } = { current: undefined as unknown as null };
    const { unmount } = render(
      <ArweaveSeedsArea seeds={[PRIME_SEED]} onOpenSeedFormHandleChange={(h) => { handleRef.current = h; }} />,
    );
    expect(typeof handleRef.current).toBe("function");
    unmount();
    expect(handleRef.current).toBeNull();
  });

  it("calling the reported handle opens the SAME define form the bottom button opens", () => {
    const handleRef: { current: (() => void) | null } = { current: null };
    render(
      <ArweaveSeedsArea seeds={[PRIME_SEED]} onOpenSeedFormHandleChange={(h) => { handleRef.current = h; }} />,
    );
    expect(screen.queryByTestId("arweave-seed-define-form")).toBeNull(); // form not open yet
    act(() => handleRef.current?.());
    expect(screen.getByTestId("arweave-seed-define-form")).toBeInTheDocument();
  });

  // MOBILE ONLY — desktop keeps the bottom button as the only entry point,
  // exactly as it always has (no `CodexUiRoot` ancestor here → `isMobile`
  // defaults false, same convention this file's other describes rely on).
  it("desktop still shows the bottom 'Add Arweave Seed' button", () => {
    render(<ArweaveSeedsArea seeds={[PRIME_SEED]} />);
    expect(screen.getByTestId("arweave-add-seed")).toBeTruthy();
  });

  it("mobile hides the bottom button — the '+' handle is the only way in", () => {
    class FakeResizeObserver {
      callback: ResizeObserverCallback;
      constructor(callback: ResizeObserverCallback) { this.callback = callback; }
      observe(target: Element) {
        this.callback([{ contentRect: { width: 390 } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
        void target;
      }
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    render(
      <CodexUiRoot>
        <ArweaveSeedsArea seeds={[PRIME_SEED]} />
      </CodexUiRoot>,
    );
    expect(screen.queryByTestId("arweave-add-seed")).toBeNull();
    vi.unstubAllGlobals();
  });
});

// Round 20 owner correction: "the seedentry itself, it must have its
// content shown similar to the chainweb seed... with triple point for view
// seed and clicking it enters full screen for the details" — mobile-only
// triple-dot menu replacing the always-visible "View Seed" text link +
// trash icon. Desktop is exercised extensively elsewhere in this file and
// stays untouched.
describe("ArweaveSeedsArea — mobile seed row triple-dot menu (round 20)", () => {
  class FakeResizeObserver {
    callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) { this.callback = callback; }
    observe(target: Element) {
      this.callback([{ contentRect: { width: 390 } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
      void target;
    }
    unobserve() {}
    disconnect() {}
  }

  function renderMobile(seeds: ArweaveSeedRecord[] = [PRIME_SEED]) {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    return render(
      <CodexUiRoot>
        <ArweaveSeedsArea seeds={seeds} />
      </CodexUiRoot>,
    );
  }

  afterEach(() => vi.unstubAllGlobals());

  it("hides the inline 'View Seed' text link and trash icon, showing a triple-dot trigger instead", () => {
    renderMobile();
    expect(screen.queryByTestId("arweave-seed-reveal-prime")).toBeNull();
    expect(screen.queryByTestId("arweave-seed-delete-prime")).toBeNull();
    expect(screen.getByTestId("arweave-seed-row-actions-trigger-prime")).toBeTruthy();
  });

  // SPLIT (owner decision 3, design.md §B3): this used to open the MASTER
  // seed's menu and assert both items. The master is Locked — its menu must
  // offer View Seed and nothing that destroys it — so the "and Delete" half
  // moved onto a seed that really is deletable.
  it("opening the MASTER seed's menu shows View Seed and NO Delete — it is Locked", () => {
    renderMobile();
    fireEvent.click(screen.getByTestId("arweave-seed-row-actions-trigger-prime"));
    expect(screen.getByTestId("arweave-seed-row-actions-view-prime")).toBeTruthy();
    expect(screen.queryByTestId("arweave-seed-row-actions-delete-prime")).toBeNull();
  });

  it("opening a NON-master seed's menu shows View Seed and Delete", () => {
    const other: ArweaveSeedRecord = { id: "s2", label: "Second Seed", bits: PRIME_BITS };
    renderMobile([PRIME_SEED, other]);
    fireEvent.click(screen.getByTestId("arweave-seed-row-actions-trigger-s2"));
    expect(screen.getByTestId("arweave-seed-row-actions-view-s2")).toBeTruthy();
    expect(screen.getByTestId("arweave-seed-row-actions-delete-s2")).toBeTruthy();
  });

  it("View Seed opens the SAME full-screen reveal the desktop 'View Seed' button opens", () => {
    renderMobile();
    fireEvent.click(screen.getByTestId("arweave-seed-row-actions-trigger-prime"));
    fireEvent.click(screen.getByTestId("arweave-seed-row-actions-view-prime"));
    expect(screen.getByTestId("arweave-seed-reveal-modal-prime")).toBeTruthy();
  });

  // Re-pointed at a NON-master seed (owner decision 3) — the master's menu has
  // no Delete item to click any more. The behaviour guarded (the menu item
  // opens the SAME confirm panel the desktop trash does, never a one-click
  // destroy) is unchanged.
  it("Delete triggers the same delete-confirm panel the desktop trash icon opens", () => {
    const other: ArweaveSeedRecord = { id: "s2", label: "Second Seed", bits: PRIME_BITS };
    renderMobile([PRIME_SEED, other]);
    fireEvent.click(screen.getByTestId("arweave-seed-row-actions-trigger-s2"));
    fireEvent.click(screen.getByTestId("arweave-seed-row-actions-delete-s2"));
    expect(screen.getByTestId("arweave-seed-delete-confirm-panel-s2")).toBeTruthy();
  });

  it("each row's menu is independent — opening one seed's menu doesn't affect another's", () => {
    const other: ArweaveSeedRecord = { id: "s2", label: "Second Seed", bits: PRIME_BITS };
    renderMobile([PRIME_SEED, other]);
    fireEvent.click(screen.getByTestId("arweave-seed-row-actions-trigger-prime"));
    expect(screen.getByTestId("arweave-seed-row-actions-view-prime")).toBeTruthy();
    expect(screen.queryByTestId("arweave-seed-row-actions-view-s2")).toBeNull();
  });
});

// Round 21 owner correction: "Clicking plus to add seed on arweave must
// open it full screen, same as on chainweb" — `CreateStoaChainSeedModal.tsx`
// (Chainweb) has always rendered its define form inside `CodexModalShell`
// (a modal on every width, full-bleed on mobile); `DefineSeedForm` used to
// render plain-inline instead. Now both wrap it the same way.
describe("ArweaveSeedsArea — the define-seed form opens as a real modal (round 21)", () => {
  it("wraps the form in CodexModalShell, closable via its own × button", () => {
    render(<ArweaveSeedsArea seeds={[PRIME_SEED]} />);
    fireEvent.click(screen.getByTestId("arweave-add-seed"));
    expect(screen.getByTestId("arweave-seed-define-modal")).toBeInTheDocument();
    expect(screen.getByTestId("arweave-seed-define-form")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("arweave-seed-define-close"));
    expect(screen.queryByTestId("arweave-seed-define-modal")).toBeNull();
  });

  it("Cancel inside the form still closes it (same handler as before, now also closing the modal)", () => {
    render(<ArweaveSeedsArea seeds={[PRIME_SEED]} />);
    fireEvent.click(screen.getByTestId("arweave-add-seed"));
    fireEvent.click(screen.getByTestId("arweave-seed-define-cancel"));
    expect(screen.queryByTestId("arweave-seed-define-modal")).toBeNull();
  });
});

// Round 21 owner correction: "1b) also clicking a seed, must open it full
// screen." Mirrors `SeedWordsTab.tsx`'s own `expanded && isMobile` full-
// screen `CodexModalShell` for its key list — mobile ONLY; desktop keeps
// its existing inline accordion, exercised extensively elsewhere in this
// file with no `CodexUiRoot` ancestor (so `isMobile` defaults false).
describe("ArweaveSeedsArea — mobile: clicking a seed row opens its key list full screen (round 21)", () => {
  class FakeResizeObserver {
    callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) { this.callback = callback; }
    observe(target: Element) {
      this.callback([{ contentRect: { width: 390 } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
      void target;
    }
    unobserve() {}
    disconnect() {}
  }
  afterEach(() => vi.unstubAllGlobals());

  it("mobile: opens the key list inside a full-screen CodexModalShell", () => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    render(
      <CodexUiRoot>
        <ArweaveSeedsArea seeds={[PRIME_SEED]} />
      </CodexUiRoot>,
    );
    fireEvent.click(screen.getByTestId("arweave-seed-toggle-prime"));
    expect(screen.getByTestId("arweave-seed-expand-modal-prime")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("arweave-seed-expand-close"));
    expect(screen.queryByTestId("arweave-seed-expand-modal-prime")).toBeNull();
  });

  it("desktop: still expands inline, no modal", () => {
    render(<ArweaveSeedsArea seeds={[PRIME_SEED]} />);
    fireEvent.click(screen.getByTestId("arweave-seed-toggle-prime"));
    expect(screen.queryByTestId("arweave-seed-expand-modal-prime")).toBeNull();
    expect(screen.getByTestId("arweave-seed-unused-prime")).toBeInTheDocument();
  });
});

// Round 25 owner correction: "the seed entry on arweave, we need to make
// it to text row, and decrease its height. Upperl left corener aligned,
// name. Lower lweft corener bit size 1600 bit (nothing more). Upper right
// corner the 3 point menu, and in its left the numebr of keys stored. we
// remove prime medalion, we designed that it is prime simply via colour."
describe("ArweaveSeedsArea — mobile: compact two-line seed row (round 25)", () => {
  class FakeResizeObserver {
    callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) { this.callback = callback; }
    observe(target: Element) {
      this.callback([{ contentRect: { width: 390 } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
      void target;
    }
    unobserve() {}
    disconnect() {}
  }
  afterEach(() => vi.unstubAllGlobals());

  function renderMobile(seeds: ArweaveSeedRecord[] = [PRIME_SEED]) {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    return render(
      <CodexUiRoot>
        <ArweaveSeedsArea seeds={seeds} />
      </CodexUiRoot>,
    );
  }

  it("shows the name and bit size only — no 'DALOS seed'/'· Prime' suffix text", () => {
    renderMobile();
    expect(screen.getByText("Master ArWeave Seed")).toBeTruthy();
    expect(screen.getByText("1600-bit")).toBeTruthy();
    expect(screen.queryByText(/1600-bit DALOS seed/i)).toBeNull();
    expect(screen.queryByText(/· Prime/i)).toBeNull();
  });

  it("removes the Prime badge pill entirely — prime is conveyed by colour/lock icon alone", () => {
    renderMobile();
    expect(screen.queryByTestId("arweave-prime-badge")).toBeNull();
    expect(screen.queryByText("🔒 Prime")).toBeNull();
    // The lock glyph + gold name color are still there, doing the same job.
    const toggle = screen.getByTestId("arweave-seed-toggle-prime");
    expect(toggle.innerHTML).toContain("<rect"); // the lock glyph's body
    expect(getComputedStyle(screen.getByText("Master ArWeave Seed")).color).toBe("rgb(206, 172, 95)");
  });

  it("still shows the key count and the triple-dot menu trigger", () => {
    renderMobile();
    expect(screen.getByText("0")).toBeTruthy(); // key count badge
    expect(screen.getByTestId("arweave-seed-row-actions-trigger-prime")).toBeInTheDocument();
  });

  it("desktop keeps the Prime badge and the full 'N-bit DALOS seed · Prime' subtitle, unchanged", () => {
    render(<ArweaveSeedsArea seeds={[PRIME_SEED]} />);
    expect(screen.getByTestId("arweave-prime-badge")).toBeInTheDocument();
    expect(screen.getByText(/1600-bit DALOS seed/i)).toBeTruthy();
  });
});

// Round 21 owner correction: "same slide swipe animation must be for the
// seed view as well, which now currently doesnt have such a thing" — a
// direct port of `ArweaveAccountsArea.tsx`'s own drag-following, two-pane
// swipe carousel tests.
describe("ArweaveSeedsArea — mobile: the drag-following swipe carousel (round 21)", () => {
  class FakeResizeObserver {
    callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) { this.callback = callback; }
    observe(target: Element) {
      this.callback([{ contentRect: { width: 390 } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
      void target;
    }
    unobserve() {}
    disconnect() {}
  }
  afterEach(() => vi.unstubAllGlobals());

  function renderManySeeds(count: number) {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const seeds: ArweaveSeedRecord[] = [
      PRIME_SEED,
      ...Array.from({ length: count }, (_, i) => ({ id: `s${i}`, label: `Seed ${i}`, bits: PRIME_BITS })),
    ];
    return render(
      <CodexUiRoot>
        <ArweaveSeedsArea seeds={seeds} />
      </CodexUiRoot>,
    );
  }

  it("a left swipe advances to the next page, a right swipe goes back", async () => {
    // jsdom's `clientHeight` never resolves, so the slot engine stays at
    // its safe default (4/page) — 9 extra seeds is comfortably 2+ pages.
    renderManySeeds(9);
    const surface = screen.getByTestId("arweave-seeds-page-surface");
    expect(screen.getByText("Master ArWeave Seed")).toBeTruthy();

    const swipe = (fromX: number, toX: number) => {
      fireEvent.touchStart(surface, { touches: [{ clientX: fromX, clientY: 0 }] });
      fireEvent.touchMove(surface, { touches: [{ clientX: toX, clientY: 0 }] });
      fireEvent.touchEnd(surface, { changedTouches: [{ clientX: toX, clientY: 0 }] });
    };

    swipe(300, 200);
    await waitFor(() => expect(screen.queryByText("Master ArWeave Seed")).toBeNull());

    swipe(200, 300);
    await waitFor(() => expect(screen.getByText("Master ArWeave Seed")).toBeTruthy());
  });

  it("visually follows the finger while dragging, resists past the first page, and ignores a vertical gesture", () => {
    renderManySeeds(9);
    const surface = screen.getByTestId("arweave-seeds-page-surface");
    const track = screen.getByTestId("arweave-seeds-page-swipe-track");
    expect(track.style.transform).toBe("translateX(0px)");

    // Already on the FIRST page — dragging RIGHT resists (0.35×) instead
    // of moving 1:1 with the finger.
    fireEvent.touchStart(surface, { touches: [{ clientX: 200, clientY: 0 }] });
    fireEvent.touchMove(surface, { touches: [{ clientX: 300, clientY: 0 }] });
    expect(track.style.transform).toBe("translateX(35px)"); // 100 * 0.35
    expect(track.style.transition).toBe("none");
    fireEvent.touchEnd(surface, { changedTouches: [{ clientX: 300, clientY: 0 }] });

    // A predominantly VERTICAL gesture never moves the track at all.
    fireEvent.touchStart(surface, { touches: [{ clientX: 200, clientY: 200 }] });
    fireEvent.touchMove(surface, { touches: [{ clientX: 210, clientY: 260 }] });
    expect(track.style.transform).toBe("translateX(0px)");
    fireEvent.touchEnd(surface, { changedTouches: [{ clientX: 210, clientY: 260 }] });
  });

  it("desktop has no swipe track at all — the list renders directly, unpaginated", () => {
    const seeds: ArweaveSeedRecord[] = [
      PRIME_SEED,
      ...Array.from({ length: 9 }, (_, i) => ({ id: `s${i}`, label: `Seed ${i}`, bits: PRIME_BITS })),
    ];
    render(<ArweaveSeedsArea seeds={seeds} />);
    expect(screen.queryByTestId("arweave-seeds-page-swipe-track")).toBeNull();
    expect(screen.getByText("Seed 8")).toBeTruthy(); // every seed renders, no pagination
  });
});

// Round 22 owner correction: "the field is buldging out of hte screen, the
// seed input field . also the name with the input field define seed and
// calce. must be at the bottom of the page, fixes... instead they must
// remain at all times on screen, and the seed input field, must extend to
// the available screen space... So we need icons for these [3 seed source
// buttons]."
describe("ArweaveSeedsArea — mobile: the define-seed form layout fixes (round 22)", () => {
  class FakeResizeObserver {
    callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) { this.callback = callback; }
    observe(target: Element) {
      this.callback([{ contentRect: { width: 390 } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
      void target;
    }
    unobserve() {}
    disconnect() {}
  }

  function openDefineMobile() {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const handleRef: { current: (() => void) | null } = { current: null };
    render(
      <CodexUiRoot>
        <ArweaveSeedsArea
          seeds={[PRIME_SEED]}
          onOpenSeedFormHandleChange={(h) => { handleRef.current = h; }}
        />
      </CodexUiRoot>,
    );
    // Mobile has no bottom "Add Arweave Seed" button (round 20) — the "+"
    // lives in `ArweavePanel`'s own tablist row, reached via the reported
    // handle (see the round-20 describe block above for the same pattern).
    act(() => handleRef.current?.());
  }

  afterEach(() => vi.unstubAllGlobals());

  it("mobile: the Name field + Define/Cancel buttons render OUTSIDE the scrolling body — a pinned footer", () => {
    openDefineMobile();
    const body = screen.getByTestId("arweave-seed-define-modal-body");
    expect(body.contains(screen.getByTestId("arweave-seed-label-input"))).toBe(false);
    expect(body.contains(screen.getByTestId("arweave-seed-confirm"))).toBe(false);
    expect(body.contains(screen.getByTestId("arweave-seed-define-cancel"))).toBe(false);
    // Still both in the document, and Define seed still works.
    expect(screen.getByTestId("arweave-seed-label-input")).toBeInTheDocument();
    expect(screen.getByTestId("arweave-seed-confirm")).toBeInTheDocument();
  });

  it("desktop: Name field + buttons still render, visually stacked right after the form body (CodexModalShell's own byte-identical-on-desktop footer contract)", () => {
    render(<ArweaveSeedsArea seeds={[PRIME_SEED]} />);
    fireEvent.click(screen.getByTestId("arweave-add-seed"));
    expect(screen.getByTestId("arweave-seed-define-form")).toBeInTheDocument();
    expect(screen.getByTestId("arweave-seed-label-input")).toBeInTheDocument();
    expect(screen.getByTestId("arweave-seed-confirm")).toBeInTheDocument();
  });

  it("mobile: the three seed-source buttons render as icons, not the numbered text labels", () => {
    openDefineMobile();
    expect(screen.queryByText(/1 · Enter your own seed/i)).toBeNull();
    expect(screen.queryByText("Enter your own seed")).toBeNull();
    expect(screen.getByRole("radio", { name: "Enter your own seed" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Use an Ouronet account" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Use a Chainweb seed" })).toBeInTheDocument();
  });

  it("desktop: the three seed-source buttons keep their full numbered text, unchanged", () => {
    render(<ArweaveSeedsArea seeds={[PRIME_SEED]} />);
    fireEvent.click(screen.getByTestId("arweave-add-seed"));
    expect(screen.getByText("1 · Enter your own seed")).toBeInTheDocument();
    expect(screen.getByText("2 · Use an Ouronet account")).toBeInTheDocument();
    expect(screen.getByText("3 · Use a Chainweb seed")).toBeInTheDocument();
  });

  it("mobile: the seed-words textarea has no fixed maxHeight cap — it flex-fills instead", () => {
    openDefineMobile();
    const textarea = screen.getByTestId("arweave-seed-words-input") as HTMLTextAreaElement;
    expect(textarea.style.maxHeight).toBe("");
    expect(textarea.style.flexGrow).toBe("1");
  });

  it("desktop: the seed-words textarea keeps its 70vh maxHeight cap, unchanged", () => {
    render(<ArweaveSeedsArea seeds={[PRIME_SEED]} />);
    fireEvent.click(screen.getByTestId("arweave-add-seed"));
    const textarea = screen.getByTestId("arweave-seed-words-input") as HTMLTextAreaElement;
    expect(textarea.style.maxHeight).toBe("70vh");
  });
});

/**
 * ArweavePanel WIRES the codex's settled master seed id into the Seeds area.
 *
 * The area itself takes `masterArweaveSeedId` as an injected prop (it reaches
 * into no store — see its module doc), so without this wiring the owner's
 * reported bug is fixed only in tests. These cases drive the REAL data path:
 * the `codexMasterSeed` row in the codex store, which the eligibility wizard's
 * finalize step writes.
 *
 * Each case guards a distinct regression:
 *   (wired) the panel reads the ArWeave face specifically — threading the
 *       wrong field (e.g. `ouroAccountId`) or nothing at all leaves the
 *       demoted seed gold on every real codex.
 *   (reactive) the id is SUBSCRIBED, not read once through `getState()`:
 *       finalize writes the row while this panel is already mounted, and a
 *       non-reactive read would not re-order until some unrelated re-render.
 *   (no arweave face / no row) backwards compatibility through the real path —
 *       a codex mid-migration (Ouronet + Chainweb faces settled, ArWeave not
 *       derived yet) and a codex that never ran the wizard both keep today's
 *       isPrime-first list.
 */
describe("ArweavePanel — wires codexMasterSeed.arweaveSeedId into the Seeds area", () => {
  const DEMOTED_SEED: ArweaveSeedRecord = {
    id: "legacy",
    label: "Arweave Seed 1",
    bits: PRIME_BITS,
    isPrime: true,
  };
  const NEW_MASTER_SEED: ArweaveSeedRecord = {
    id: "new-master",
    label: "Master ArWeave Seed",
    bits: PRIME_BITS,
  };

  let panelStore: ReturnType<typeof useCodexStore> | null = null;
  function StoreGrabber(): null {
    // Same `StoreGrabber` convention as `e4-panel-codex-id.test.tsx`'s own.
    panelStore = useCodexStore();
    return null;
  }

  /** Mounts the panel on the Seeds category with both seeds wired through the
   *  host's `arweaveSeeds` seam, and the codex store reachable. */
  async function renderSeedsPanel() {
    const deps = {
      arweaveSeeds: [DEMOTED_SEED, NEW_MASTER_SEED],
    } as unknown as ArweavePanelDeps;
    render(
      <CodexProvider adapter={new MemoryCodexAdapter("dev")}>
        <StoreGrabber />
        <ArweavePanelProvider deps={deps}>
          <ArweavePanel id={ARWEAVE_CHAIN_ID} />
        </ArweavePanelProvider>
      </CodexProvider>,
    );
    await waitFor(() => expect(panelStore!.getState().ready).toBe(true));
    fireEvent.click(screen.getByTestId("arweave-subtab-seeds"));
  }

  function masterRowSeedId(): string | null {
    const rows = screen.getAllByTestId("arweave-prime-seed-row");
    expect(rows).toHaveLength(1);
    return rows[0]!.getAttribute("data-seed-id");
  }

  function settleMasterSeed(arweaveSeedId?: string): void {
    act(() => {
      panelStore!.setState({
        codexMasterSeed: {
          ouroAccountId: "ouro-1",
          chainwebSeedId: "chainweb-1",
          ...(arweaveSeedId === undefined ? {} : { arweaveSeedId }),
          establishedAt: "2026-01-01T00:00:00.000Z",
        } satisfies CodexMasterSeed,
      });
    });
  }

  afterEach(() => {
    panelStore = null;
  });

  it("re-orders and re-colours to the settled master the moment the codex row names an arweave seed", async () => {
    await renderSeedsPanel();
    // Before finalize: the stale `isPrime` stamp still decides.
    expect(masterRowSeedId()).toBe("legacy");

    settleMasterSeed("new-master");

    expect(masterRowSeedId()).toBe("new-master");
    expect(getComputedStyle(screen.getByTestId("arweave-seed-row-legacy")).borderColor).toBe(
      "rgb(38, 38, 38)",
    );
  });

  it("keeps the isPrime seed first when the settled row has no arweave face yet", async () => {
    await renderSeedsPanel();
    settleMasterSeed(undefined);

    expect(masterRowSeedId()).toBe("legacy");
  });

  it("keeps the isPrime seed first on a codex that has no codexMasterSeed row at all", async () => {
    await renderSeedsPanel();

    expect(panelStore!.getState().codexMasterSeed).toBeUndefined();
    expect(masterRowSeedId()).toBe("legacy");
  });
});

/**
 * ArweavePanel resolves the FORMER-master ids — seal-gated — for the Seeds
 * area (`former-master-record` T2/T3).
 *
 * Same division of labour as `masterArweaveSeedId` above: the store lives
 * here, `ArweaveSeedsArea` is handed plain ids. The gate is codex-core's
 * `isFormerMasterArweaveSeed(seedId, row, progress)`, whose `progress`
 * argument is REQUIRED precisely so no surface can forget it.
 *
 * Each case guards a distinct regression:
 *   (sealed) without this wiring the designation is fixed only in tests — on a
 *       real codex the displaced seed would read as an unrelated seed.
 *   (unsealed) design: *"the designation follows the SEAL, not the
 *       finalize"*. `codexMasterSeed` is written at finalize and is re-writable
 *       while unsealed, so a finalized-but-unapplied codex that already moved
 *       its designations would be showing a role change Apply never made.
 */
describe("ArweavePanel — resolves the seal-gated former-master ids for the Seeds area", () => {
  const DISPLACED_SEED: ArweaveSeedRecord = {
    id: "legacy",
    label: "My cold storage seed",
    bits: PRIME_BITS,
    isPrime: true,
  };
  const NEW_MASTER_SEED: ArweaveSeedRecord = {
    id: "new-master",
    label: "",
    bits: PRIME_BITS,
  };

  let panelStore: ReturnType<typeof useCodexStore> | null = null;
  function StoreGrabber(): null {
    // Same `StoreGrabber` convention as the describe above.
    panelStore = useCodexStore();
    return null;
  }

  async function renderSeedsPanel(): Promise<void> {
    const deps = {
      arweaveSeeds: [DISPLACED_SEED, NEW_MASTER_SEED],
    } as unknown as ArweavePanelDeps;
    render(
      <CodexProvider adapter={new MemoryCodexAdapter("dev")}>
        <StoreGrabber />
        <ArweavePanelProvider deps={deps}>
          <ArweavePanel id={ARWEAVE_CHAIN_ID} />
        </ArweavePanelProvider>
      </CodexProvider>,
    );
    await waitFor(() => expect(panelStore!.getState().ready).toBe(true));
    fireEvent.click(screen.getByTestId("arweave-subtab-seeds"));
  }

  /** The codex AFTER a takeover: `new-master` holds the role, `legacy` is on
   *  record as a former holder. `sealed` is what Apply stamps. */
  function settleTakeover(sealed: boolean): void {
    act(() => {
      panelStore!.setState({
        codexMasterSeed: {
          ouroAccountId: "ouro-1",
          chainwebSeedId: "chainweb-1",
          arweaveSeedId: "new-master",
          formerArweaveSeedIds: ["legacy"],
          establishedAt: "2026-01-01T00:00:00.000Z",
        } satisfies CodexMasterSeed,
        migrationProgress: {
          stage: "committing",
          startedAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          ...(sealed ? { appliedAt: "2026-01-02T00:00:00.000Z" } : {}),
        } satisfies MigrationProgress,
      });
    });
  }

  afterEach(() => {
    panelStore = null;
  });

  it("renders the former designation on the displaced seed once the codex is SEALED", async () => {
    await renderSeedsPanel();
    settleTakeover(true);

    const row = screen.getByTestId("arweave-seed-row-legacy");
    expect(within(row).getByTestId("arweave-seed-designation-legacy").textContent).toBe(
      FORMER_MASTER_ARWEAVE_SEED,
    );
    expect(within(row).getByTestId("arweave-seed-own-name-legacy").textContent).toBe(
      "My cold storage seed",
    );
  });

  it("renders NO former designation on a finalized-but-unapplied codex", async () => {
    await renderSeedsPanel();
    settleTakeover(false);

    const row = screen.getByTestId("arweave-seed-row-legacy");
    expect(within(row).queryByTestId("arweave-seed-designation-legacy")).toBeNull();
    expect(screen.queryByText(FORMER_MASTER_ARWEAVE_SEED)).toBeNull();
    // It reads as the ordinary seed it is, under its own name.
    expect(within(row).getByText("My cold storage seed")).toBeInTheDocument();
  });
});

/**
 * The Master ArWeave Seed is LOCKED — docs/work/locked-entities-and-former-prime
 * design.md §B3/§B5, plan T8.
 *
 * This surface was "the face with no protection at any layer": the store's
 * `deleteArweaveSeed` was an unguarded filter and this area's delete control
 * was always live, including on the master row — with the apology in the code
 * ("The Prime seed is deletable FOR NOW (development)"). Deleting it leaves
 * `codexMasterSeed.arweaveSeedId` dangling while `describeCodexMasterSeed`
 * still reports that face established.
 *
 * What each case guards:
 *   - the medallion NAMES the reason, so the missing delete control reads as a
 *     deliberate protection and not as a broken button;
 *   - the control is ABSENT, not disabled (owner decision 3: *"delete button
 *     should not be available for them"*), in BOTH forks — desktop's trash
 *     icon and mobile's triple-dot menu item are separate trees, and mobile's
 *     had no gate of any kind;
 *   - the lock is decided by codex-core's `arweaveSeedLock` — the SAME
 *     predicate the store's refusal uses — so the UI and the store cannot
 *     disagree (design criterion 9). That is why the SETTLED id locks a seed
 *     with no `isPrime` flag, and why a stale `isPrime` seed stays locked even
 *     when the codex has settled on a different master: a control the store
 *     would refuse must not be offered;
 *   - an ordinary seed is untouched — a protection that locks everything
 *     protects nothing;
 *   - a refusal that DOES reach the callback is surfaced, not swallowed into
 *     an unhandled rejection, and the row the store kept comes back (criterion
 *     10).
 */
describe("ArweaveSeedsArea — the Master ArWeave Seed is Locked (T8)", () => {
  /** No `isPrime` flag at all: only the injected settled id makes it master. */
  const SETTLED_MASTER: ArweaveSeedRecord = {
    id: "settled",
    label: "My cold storage seed",
    bits: PRIME_BITS,
  };
  const PLAIN_SEED: ArweaveSeedRecord = {
    id: "plain",
    label: "Second Arweave Seed",
    bits: "0".repeat(SEED_BIT_LENGTH),
  };

  class FakeResizeObserver {
    callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) { this.callback = callback; }
    observe(target: Element) {
      this.callback([{ contentRect: { width: 390 } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
      void target;
    }
    unobserve() {}
    disconnect() {}
  }

  function renderMobileArea(props: Partial<ArweaveSeedsAreaProps>) {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    return render(
      <CodexUiRoot>
        <ArweaveSeedsArea {...props} />
      </CodexUiRoot>,
    );
  }

  afterEach(() => vi.unstubAllGlobals());

  /* ── desktop ── */

  it("the master row wears a Locked medallion that NAMES the reason", () => {
    renderArea({ seeds: [PRIME_SEED] });

    const medallion = within(screen.getByTestId("arweave-prime-seed-row")).getByTestId(
      "arweave-seed-locked-prime",
    );
    // The word the whole topic standardises on — never "Protected", which this
    // panel already spends on a different tier (a seed whose words are held).
    expect(medallion.textContent).toMatch(/Locked/);
    expect(medallion.getAttribute("aria-label")).toMatch(/^Locked — /);
    // …and the REASON, not just the state.
    expect(medallion.getAttribute("aria-label")).toMatch(/Master ArWeave Seed/i);
  });

  it("renders NO delete control on the master row, while its other actions stay", () => {
    renderArea({ seeds: [PRIME_SEED, PLAIN_SEED] });

    const prime = screen.getByTestId("arweave-prime-seed-row");
    expect(within(prime).queryByTestId("arweave-seed-delete-prime")).toBeNull();
    // Only the destructive control is withheld: View Seed and the row toggle
    // are untouched.
    expect(within(prime).getByTestId("arweave-seed-reveal-prime")).toBeInTheDocument();
    expect(within(prime).getByTestId("arweave-seed-toggle-prime")).toBeInTheDocument();
  });

  it("a plain seed shows no medallion and keeps a LIVE delete", () => {
    const onDeleteSeed = vi.fn();
    renderArea({ seeds: [PRIME_SEED, PLAIN_SEED], onDeleteSeed });

    const row = screen.getByTestId("arweave-seed-row-plain");
    expect(within(row).queryByTestId("arweave-seed-locked-plain")).toBeNull();

    fireEvent.click(within(row).getByTestId("arweave-seed-delete-plain"));
    fireEvent.click(screen.getByTestId("arweave-seed-delete-confirm-plain"));
    expect(onDeleteSeed).toHaveBeenCalledTimes(1);
    expect(onDeleteSeed.mock.calls[0]?.[0]).toMatchObject({ seedId: "plain" });
  });

  it("does NOT lock a seed that is master only by POSITION — a display fallback is not an identity", () => {
    // `resolveMasterArweaveSeed` falls back to row 0 when a codex has neither
    // the flag nor a settled id, so this seed WEARS the master treatment. It
    // is still deletable, because the store cannot defend an insertion-ordered
    // index: whichever seed happened to be first would become undeletable, and
    // adding a seed would move the protection onto a different row. Gating the
    // control on the row's `isPrime` prop instead of `arweaveSeedLock` is the
    // obvious wrong implementation and this is what catches it.
    const onDeleteSeed = vi.fn();
    renderArea({ seeds: [PLAIN_SEED], onDeleteSeed });

    const row = screen.getByTestId("arweave-prime-seed-row");
    expect(row).toHaveAttribute("data-seed-id", "plain");
    expect(within(row).queryByTestId("arweave-seed-locked-plain")).toBeNull();
    expect(within(row).getByTestId("arweave-seed-delete-plain")).toBeInTheDocument();
  });

  it("locks the seed the codex has SETTLED on, even with no isPrime flag anywhere", () => {
    renderArea({ seeds: [PLAIN_SEED, SETTLED_MASTER], masterArweaveSeedId: "settled" });

    const master = screen.getByTestId("arweave-prime-seed-row");
    expect(master).toHaveAttribute("data-seed-id", "settled");
    expect(within(master).getByTestId("arweave-seed-locked-settled")).toBeInTheDocument();
    expect(within(master).queryByTestId("arweave-seed-delete-settled")).toBeNull();
    // The other seed is not dragged into the protection.
    expect(
      within(screen.getByTestId("arweave-seed-row-plain")).getByTestId("arweave-seed-delete-plain"),
    ).toBeInTheDocument();
  });

  it("keeps a STALE isPrime seed locked when a different seed is the settled master — the UI never offers what the store refuses", () => {
    // `arweaveSeedLock` fires on the settled id OR the `isPrime` flag (the
    // pre-settlement rule every codex that has not re-run the wizard still
    // needs). The store applies both, so the UI must withhold the control on
    // both — otherwise this row's trash icon is a button that throws.
    renderArea({ seeds: [PRIME_SEED, SETTLED_MASTER], masterArweaveSeedId: "settled" });

    const stale = screen.getByTestId("arweave-seed-row-prime");
    expect(within(stale).getByTestId("arweave-seed-locked-prime")).toBeInTheDocument();
    expect(within(stale).queryByTestId("arweave-seed-delete-prime")).toBeNull();
    // The one-gold-row invariant is untouched by any of this.
    expect(screen.getAllByTestId("arweave-prime-seed-row")).toHaveLength(1);
  });

  it("leaves the gold designation row's own text alone — the medallion adds no second copy of the name", () => {
    renderArea({ seeds: [{ ...SETTLED_MASTER }], masterArweaveSeedId: "settled" });

    const row = screen.getByTestId("arweave-prime-seed-row");
    expect(within(row).getAllByText(PRIME_SEED_LABEL)).toHaveLength(1);
    expect(within(row).getByTestId("arweave-seed-designation-settled")).toBeInTheDocument();
    expect(within(row).getByTestId("arweave-seed-own-name-settled").textContent).toBe(
      "My cold storage seed",
    );
    expect(within(row).getByTestId("arweave-prime-badge")).toBeInTheDocument();
  });

  /* ── mobile: a genuinely separate tree ── */

  it("mobile — the master row wears the COMPACT medallion (icon only, so the measured row height cannot grow)", () => {
    renderMobileArea({ seeds: [PRIME_SEED] });

    const medallion = within(screen.getByTestId("arweave-prime-seed-row")).getByTestId(
      "arweave-seed-locked-prime",
    );
    // Round 25 dropped text badges from the mobile row deliberately; the
    // medallion carries its wording in the accessible name instead.
    expect(medallion.textContent).toBe("");
    expect(medallion.getAttribute("aria-label")).toMatch(/^Locked — /);
    expect(medallion.getAttribute("aria-label")).toMatch(/Master ArWeave Seed/i);
  });

  it("mobile — a plain seed's row carries no medallion", () => {
    renderMobileArea({ seeds: [PRIME_SEED, PLAIN_SEED] });

    expect(screen.queryByTestId("arweave-seed-locked-plain")).toBeNull();
  });

  it("mobile — the settled master's menu withholds Delete even though its row has no isPrime flag", () => {
    renderMobileArea({ seeds: [SETTLED_MASTER, PLAIN_SEED], masterArweaveSeedId: "settled" });

    fireEvent.click(screen.getByTestId("arweave-seed-row-actions-trigger-settled"));
    expect(screen.getByTestId("arweave-seed-row-actions-view-settled")).toBeTruthy();
    expect(screen.queryByTestId("arweave-seed-row-actions-delete-settled")).toBeNull();
  });

  /* ── the refusal must not be silent (criterion 10) ── */

  it("surfaces the store's OWN message when the delete callback rejects, instead of swallowing it", async () => {
    const message = "This seed is your Master ArWeave Seed.";
    const onDeleteSeed = vi.fn(async () => {
      throw new Error(message);
    });
    renderArea({ seeds: [PRIME_SEED, PLAIN_SEED], onDeleteSeed });

    fireEvent.click(screen.getByTestId("arweave-seed-delete-plain"));
    fireEvent.click(screen.getByTestId("arweave-seed-delete-confirm-plain"));

    await waitFor(() =>
      expect(screen.getByTestId("arweave-seed-delete-error").textContent).toContain(message),
    );
  });

  it("puts the row BACK when the store refused it — an optimistic removal must not outlive the refusal", async () => {
    const onDeleteSeed = vi.fn(async () => {
      throw new Error("refused");
    });
    renderArea({ seeds: [PRIME_SEED, PLAIN_SEED], onDeleteSeed });

    fireEvent.click(screen.getByTestId("arweave-seed-delete-plain"));
    fireEvent.click(screen.getByTestId("arweave-seed-delete-confirm-plain"));

    await waitFor(() => expect(screen.getByTestId("arweave-seed-delete-error")).toBeInTheDocument());
    expect(screen.getByTestId("arweave-seed-row-plain")).toBeInTheDocument();
  });

  it("clears a previous refusal once a delete succeeds — a stale error must not haunt the surface", async () => {
    const onDeleteSeed = vi
      .fn<(request: { seedId: string }) => Promise<void>>()
      .mockRejectedValueOnce(new Error("refused"))
      .mockResolvedValueOnce(undefined);
    renderArea({ seeds: [PRIME_SEED, PLAIN_SEED], onDeleteSeed });

    fireEvent.click(screen.getByTestId("arweave-seed-delete-plain"));
    fireEvent.click(screen.getByTestId("arweave-seed-delete-confirm-plain"));
    await waitFor(() => expect(screen.getByTestId("arweave-seed-delete-error")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("arweave-seed-delete-plain"));
    fireEvent.click(screen.getByTestId("arweave-seed-delete-confirm-plain"));
    await waitFor(() => expect(screen.queryByTestId("arweave-seed-row-plain")).toBeNull());
    expect(screen.queryByTestId("arweave-seed-delete-error")).toBeNull();
  });
});
