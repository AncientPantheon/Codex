/**
 * `KeysetUpdateGate` — the PRECONDITION surface for a keyset-ref update
 * (docs/work/migration-execute-keyset/design.md §3, acceptance criteria 5-8,
 * `migration-execute-keyset` T5).
 *
 * The owner's worked example is the whole spec in one sentence: *"This keyset
 * ref is a keyset of 9 keys with a predicate 5 of 9. This means the user is
 * presented with the list of 9 keys, and for each key a field where he may
 * enter the private key. Entering a private key on that field, the UI verifies
 * that it fits, and once 5 of 9 are verified this way, then the update could
 * proceed."* Everything below is that, plus the forfeit — design §3's second
 * resolution, which is a legitimate outcome and never an error.
 *
 * ## MAINNET HAZARD — and why this file has no `vi.mock`
 *
 * The gate needs the account's LIVE guard resolved, which is one chain read.
 * `pactRead` defaults to `rawCalibratedDirtyRead`
 * (`node_modules/@stoachain/stoa-core/dist/reads/pactReader.js`), so any read
 * that slipped past an injection would hit a real node.
 *
 *   1. The reader is an INJECTED prop with NO default (`readAccountGuard`).
 *      Every render here passes a `vi.fn()`. The production
 *      `getStoaChainAccountGuard` is never imported by this file.
 *   2. **There is deliberately ZERO `vi.mock` in this file**, and the
 *      self-check at the bottom keeps it that way. Delete every mock in this
 *      suite — there are none — and it still cannot reach a node, because the
 *      seam is injected and has no live default to fall back on. A `vi.mock` a
 *      refactor silently drops fails OPEN onto mainnet; a required injected
 *      seam cannot.
 *   3. Belt to that brace: every test starts with a THROWING `pactReader`
 *      registered through `setPactReader`, the same belt
 *      `tests/ui-pending-key-changes-section.test.tsx:250-253` wears.
 *
 * ## The private keys in this file are real, and derived independently
 *
 * The gate's verification is `tryDerivePublicKey(priv) === pub`, so a fixture
 * of fake pairs would assert nothing. The pubkeys below are derived from the
 * private keys with `@noble/curves`' `ed25519.getPublicKey` directly — NOT
 * with the helper the component uses — so the test and the implementation
 * reach the same answer by two different routes. (Parity of the two routes is
 * itself asserted once, at the top.)
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import { setPactReader, getPactReader } from "@stoachain/stoa-core/reads";
import { tryDerivePublicKey } from "@stoachain/stoa-core/guard";
import { ed25519 } from "@noble/curves/ed25519";

import {
  KeysetUpdateGate,
  type KeysetUpdateSelection,
} from "../src/ui/settings/KeysetUpdateGate.js";

// ─── Fixtures ───────────────────────────────────────────────────────────────

const hexToBytes = (hex: string): Uint8Array =>
  Uint8Array.from(hex.match(/../g)!.map((b) => parseInt(b, 16)));
const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/** A real ed25519 pair: a 64-hex seed and the pubkey it derives to. */
const pairFor = (byte: string): { priv: string; pub: string } => {
  const priv = byte.repeat(32);
  return { priv, pub: toHex(ed25519.getPublicKey(hexToBytes(priv))) };
};

/** The owner's nine. The first FOUR are the ones this codex holds. */
const NINE = ["01", "02", "03", "04", "05", "06", "07", "08", "09"].map(pairFor);
const KEYS = NINE.map((p) => p.pub);
const CODEX_PUBS = new Set(KEYS.slice(0, 4));
/** A real pair that is NOT in the keyset — the "fits nothing" case. */
const OUTSIDER = pairFor("fe");

/** 5 of 9, by name — `guardUtils.js:49`'s `STOIC_M_OF_N` entry. */
const PRED = "stoa-ns.stoic-predicates.keys-5-of-9";

const ACCOUNT = "Ѻ.AncientHodler";
const FREE_REF = "free.ah-keyset";

/** What `getKadenaAccountGuard` hands back for a keyset-REF guard: the
 *  EXPANDED keyset annotated with the qualified reference name
 *  (`ouroAccountFunctions.js:164-168`). */
const refGuard = (ref: string = FREE_REF) => ({ keys: KEYS, pred: PRED, keysetRef: ref });

type Props = Parameters<typeof KeysetUpdateGate>[0];
type OnChangeMock = Mock<(s: KeysetUpdateSelection) => void>;

function renderGate(overrides: Partial<Props> = {}) {
  const readAccountGuard = overrides.readAccountGuard ?? vi.fn(async () => refGuard());
  const onChange = (overrides.onChange ?? vi.fn()) as OnChangeMock;
  const view = render(
    <KeysetUpdateGate
      active={overrides.active ?? true}
      accountAddress={overrides.accountAddress ?? ACCOUNT}
      codexPubs={overrides.codexPubs ?? CODEX_PUBS}
      readAccountGuard={readAccountGuard}
      onChange={onChange}
    />,
  );
  return { ...view, readAccountGuard, onChange };
}

const lastReport = (onChange: OnChangeMock): KeysetUpdateSelection =>
  onChange.mock.calls.at(-1)![0];

/** `@testing-library/jest-dom` is not set up in this package (`tests/setup.ts`
 *  configures only `asyncUtilTimeout` + a ResizeObserver stub), so text is
 *  asserted on `textContent` — the idiom `tests/ui-pending-key-changes-card.test.tsx`
 *  already uses. */
const textOf = (testId: string): string => screen.getByTestId(testId).textContent ?? "";

/** The field for ONE listed key — the owner's "for each key a field". */
const fieldForKey = (pub: string): HTMLElement =>
  within(screen.getByTestId(`keyset-update-gate-row-${KEYS.indexOf(pub)}`)).getByPlaceholderText(
    /private key/i,
  );

const ORIGINAL_READER = getPactReader();

beforeEach(() => {
  // See this file's header, rule 3.
  setPactReader(() => {
    throw new Error("no reader registered by this test");
  });
});

afterEach(() => {
  cleanup();
  setPactReader(ORIGINAL_READER);
});

// ─── (0) the fixtures are real pairs ────────────────────────────────────────

describe("the fixture pairs", () => {
  it("derive to the same pubkeys through noble and through stoa-core", () => {
    // If these two disagreed, every "typing the private key resolves the row"
    // assertion below would be testing the fixture rather than the gate.
    for (const { priv, pub } of [...NINE, OUTSIDER]) {
      expect(tryDerivePublicKey(priv)).toBe(pub);
    }
  });
});

// ─── (a) the whole key list — criterion 6, the owner's nine ─────────────────

describe("the key list", () => {
  it("lists ALL NINE keys, marks the four the codex holds, and offers five fields", async () => {
    // WHY: `ManualKeyInput` on its own lists `foreignKeys` ONLY, so a gate that
    // just mounted it would show five rows and hide the four keys the codex
    // already covers — the user could not see the keyset he is being asked
    // about. Criterion 6 is "every key of the current keyset".
    renderGate();
    await waitFor(() => expect(screen.getAllByTestId(/^keyset-update-gate-row-/)).toHaveLength(9));

    const rows = screen.getAllByTestId(/^keyset-update-gate-row-/);
    expect(rows.filter((r) => r.dataset.keyState === "codex")).toHaveLength(4);
    expect(rows.filter((r) => r.dataset.keyState === "needed")).toHaveLength(5);
    expect(screen.getAllByPlaceholderText(/private key/i)).toHaveLength(5);
    expect(textOf("keyset-update-gate-ref")).toContain(FREE_REF);
  });

  it("reads the reference name out of the nested lowercase `keysetref` spelling too", async () => {
    // WHY: real persisted data uses BOTH spellings — `resolveGuardKeys.ts:66-92`
    // is the record of that, and of what silently vanished when a surface read
    // one field instead of going through `keysetRefNameOf`. A gate that read
    // `guard.keysetRef` directly would render "not a keyset-ref" for a real
    // keyset-ref account and refuse a step that is perfectly executable.
    renderGate({
      readAccountGuard: vi.fn(async () => ({
        keys: KEYS,
        pred: PRED,
        keysetref: { ns: "free", ksn: "ah-keyset" },
      })),
    });
    await waitFor(() =>
      expect(textOf("keyset-update-gate-ref")).toContain("free.ah-keyset"),
    );
    expect(screen.getAllByTestId(/^keyset-update-gate-row-/)).toHaveLength(9);
  });
});

// ─── (b) verification and progress — criterion 6's second half ──────────────

describe("entering a private key", () => {
  it("verifies it by derivation, resolves that row, and moves 4-of-5 to 5-of-5", async () => {
    // WHY: this is the owner's sentence. The threshold comes from
    // `analyzeGuard`, so this also pins that the gate counts against the
    // PREDICATE (5) and not against the key count (9) — the difference
    // between a reachable update and one that can never be satisfied.
    const { onChange } = renderGate();
    await waitFor(() => expect(screen.getByTestId("keyset-update-gate-progress")).toBeTruthy());

    const progress = screen.getByTestId("keyset-update-gate-progress");
    expect(progress.textContent).toContain("4 of 5");
    expect(progress.textContent).toContain("keys-5-of-9 (5 of 9)");
    expect(lastReport(onChange).satisfied).toBe(false);

    const fifth = NINE[4]!;
    fireEvent.change(fieldForKey(fifth.pub), { target: { value: fifth.priv } });

    await waitFor(() => expect(progress.textContent).toContain("5 of 5"));
    const row = screen.getByTestId(`keyset-update-gate-row-${KEYS.indexOf(fifth.pub)}`);
    expect(row.dataset.keyState).toBe("resolved");

    const report = lastReport(onChange);
    expect(report.satisfied).toBe(true);
    expect(report.forfeited).toBe(false);
    expect(report.ref).toBe(FREE_REF);
    expect(report.manualKeys).toEqual({ [fifth.pub]: fifth.priv });
    expect(report.analysis?.threshold).toBe(5);
    expect(report.analysis?.signable).toBe(5);
    // Still nine rows: satisfying the predicate does not shorten the keyset.
    expect(screen.getAllByTestId(/^keyset-update-gate-row-/)).toHaveLength(9);
  });

  it("rejects a valid key that fits none of the listed keys, and stays unsatisfied", async () => {
    // WHY: the only thing standing between "the user pasted something" and
    // "the update will be signed" is this derivation check. A gate that marked
    // a row resolved on any 64-hex input would report `satisfied: true` and
    // the chain would refuse at signing time, after the press.
    const { onChange } = renderGate();
    await waitFor(() => expect(screen.getByTestId("keyset-update-gate-progress")).toBeTruthy());

    fireEvent.change(fieldForKey(KEYS[4]!), { target: { value: OUTSIDER.priv } });

    expect(await screen.findByText(/doesn't match/i)).toBeTruthy();
    expect(textOf("keyset-update-gate-progress")).toContain("4 of 5");
    const report = lastReport(onChange);
    expect(report.satisfied).toBe(false);
    expect(report.manualKeys).toEqual({});
    expect(
      screen.getAllByTestId(/^keyset-update-gate-row-/).filter((r) => r.dataset.keyState === "resolved"),
    ).toHaveLength(0);
  });
});

// ─── (c) the guard that is not a keyset-ref — criterion 4's UI half ─────────

describe("a guard that is NOT a keyset-ref", () => {
  it("reports `ref: null` and renders no key list at all", async () => {
    // WHY: `define-keyset` needs a reference NAME; an inline keyset cannot be
    // redefined at all. Offering nine private-key fields for a keyset that no
    // `define-keyset` can ever target would collect the most sensitive input
    // in the application for nothing.
    const { onChange } = renderGate({
      readAccountGuard: vi.fn(async () => ({ keys: KEYS, pred: "keys-all" })),
    });
    await waitFor(() => expect(screen.getByTestId("keyset-update-gate-not-ref")).toBeTruthy());

    expect(screen.queryAllByTestId(/^keyset-update-gate-row-/)).toHaveLength(0);
    expect(screen.queryByPlaceholderText(/private key/i)).toBeNull();
    const report = lastReport(onChange);
    expect(report.ref).toBeNull();
    expect(report.analysis).toBeNull();
    expect(report.satisfied).toBe(false);
  });
});

// ─── (d) the read, and when it must NOT happen ─────────────────────────────

describe("the chain read", () => {
  it("is not performed when no keyset update was chosen", async () => {
    // WHY: this gate lives in a section that renders for EVERY codex with a
    // pending migration. An ungated effect would put one live chain read per
    // render on every one of them, for a question none of them asked.
    const { readAccountGuard, onChange, container } = renderGate({ active: false });
    await waitFor(() => expect(container.firstChild).toBeNull());
    expect(readAccountGuard).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("is performed exactly once across re-renders with a fresh reader function", async () => {
    // WHY: a parent that passes an inline `async a => …` would re-create the
    // prop on every render. With the function in the effect's dependency list
    // that is a new live read per render.
    const readAccountGuard = vi.fn(async () => refGuard());
    const { rerender } = renderGate({ readAccountGuard });
    await waitFor(() => expect(screen.getByTestId("keyset-update-gate-progress")).toBeTruthy());

    rerender(
      <KeysetUpdateGate
        active
        accountAddress={ACCOUNT}
        codexPubs={new Set(CODEX_PUBS)}
        readAccountGuard={vi.fn(async () => refGuard())}
        onChange={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByTestId("keyset-update-gate-progress")).toBeTruthy());
    expect(readAccountGuard).toHaveBeenCalledTimes(1);
  });

  it("renders an honest error when the read fails — never an empty key list", async () => {
    // WHY: an empty list reads as "nothing to satisfy". The gate would then
    // look READY for a keyset it has not even seen, which is the one way this
    // surface could wave through an unsatisfiable update.
    const { onChange } = renderGate({
      readAccountGuard: vi.fn(async () => {
        throw new Error("node unreachable");
      }),
    });
    await waitFor(() => expect(screen.getByTestId("keyset-update-gate-error")).toBeTruthy());

    expect(textOf("keyset-update-gate-error")).toMatch(/node unreachable/);
    expect(screen.queryAllByTestId(/^keyset-update-gate-row-/)).toHaveLength(0);
    const report = lastReport(onChange);
    expect(report.satisfied).toBe(false);
    expect(report.analysis).toBeNull();
  });

  it("treats a ref that resolved to NO keys as an error, not as satisfied", async () => {
    // WHY: `analyzeGuard(null)` returns `satisfied: true` by design
    // (`guardUtils.js`: an absent guard blocks nothing). Handing it an
    // unresolved ref would therefore report the keyset as already met and
    // start a `define-keyset` no key can sign.
    const { onChange } = renderGate({
      readAccountGuard: vi.fn(async () => ({ keysetRef: FREE_REF })),
    });
    await waitFor(() => expect(screen.getByTestId("keyset-update-gate-error")).toBeTruthy());
    expect(lastReport(onChange).satisfied).toBe(false);
  });
});

// ─── (e) the forfeit — design §3 point 2, criterion 8 ──────────────────────

describe("the forfeit", () => {
  it("is never the initial value", async () => {
    // WHY: a default forfeit silently abandons a change the user deliberately
    // chose, and reports success while doing it.
    const { onChange } = renderGate();
    await waitFor(() => expect(screen.getByTestId("keyset-update-gate-progress")).toBeTruthy());
    expect(onChange.mock.calls.every(([s]) => !s.forfeited)).toBe(true);
    expect(screen.getByTestId("keyset-update-gate-forfeit")).toBeTruthy();
  });

  it("reports `forfeited: true`, keeps the keyset as it is, and is not an error", async () => {
    // WHY: criterion 8 — forfeit proceeds with every other step. The reported
    // keyset must still be the CURRENT one (the keyset "remains as is"), and
    // the surface must not read as a failure.
    const { onChange } = renderGate();
    await waitFor(() => expect(screen.getByTestId("keyset-update-gate-progress")).toBeTruthy());

    fireEvent.click(screen.getByTestId("keyset-update-gate-forfeit"));

    await waitFor(() => expect(lastReport(onChange).forfeited).toBe(true));
    const report = lastReport(onChange);
    expect(report.ref).toBe(FREE_REF);
    expect(report.analysis?.keys).toEqual(KEYS);
    expect(report.satisfied).toBe(false);
    expect(textOf("keyset-update-gate-forfeited")).toMatch(/remain/i);
    expect(screen.queryByTestId("keyset-update-gate-error")).toBeNull();
  });

  it("discards every private key already entered, and can be taken back", async () => {
    // WHY: a private key held for an update the user just abandoned is pure
    // risk with no remaining purpose. And the forfeit must be reversible, or a
    // misclick costs the user the update with no way back short of a reload.
    const { onChange } = renderGate();
    await waitFor(() => expect(screen.getByTestId("keyset-update-gate-progress")).toBeTruthy());

    const fifth = NINE[4]!;
    fireEvent.change(fieldForKey(fifth.pub), { target: { value: fifth.priv } });
    await waitFor(() => expect(lastReport(onChange).satisfied).toBe(true));

    fireEvent.click(screen.getByTestId("keyset-update-gate-forfeit"));
    await waitFor(() => expect(lastReport(onChange).forfeited).toBe(true));
    expect(lastReport(onChange).manualKeys).toEqual({});

    fireEvent.click(screen.getByTestId("keyset-update-gate-resume"));
    await waitFor(() => expect(lastReport(onChange).forfeited).toBe(false));
    // The key is gone, so the user is back to supplying one — not silently
    // still satisfied from before the forfeit.
    expect(lastReport(onChange).satisfied).toBe(false);
    expect(textOf("keyset-update-gate-progress")).toContain("4 of 5");
  });
});

// ─── (f) the private keys do not outlive the surface ──────────────────────

describe("the entered private keys", () => {
  it("are cleared from the reported selection when the gate unmounts", async () => {
    // WHY: the parent holds this map (the gate's output is a value, not a side
    // effect), so when the surface that collected the keys disappears the
    // parent's copy must go with it rather than sitting in React state for the
    // rest of the session.
    const { onChange, unmount } = renderGate();
    await waitFor(() => expect(screen.getByTestId("keyset-update-gate-progress")).toBeTruthy());
    const fifth = NINE[4]!;
    fireEvent.change(fieldForKey(fifth.pub), { target: { value: fifth.priv } });
    await waitFor(() => expect(lastReport(onChange).satisfied).toBe(true));

    unmount();

    const report = lastReport(onChange);
    expect(report.manualKeys).toEqual({});
    expect(report.satisfied).toBe(false);
    expect(report.forfeited).toBe(false);
  });
});

// ─── (g) the namespace heads-up — plan T5 point 4 ─────────────────────────

describe("a protocol-guarded namespace", () => {
  it("warns, without blocking, for `ouronet-ns`", async () => {
    // WHY: `stoa-genesis-1.pact:110-113` guards `ouronet-ns`/`stoa-ns` with a
    // protocol keyset, so a user redefinition is most likely refused on chain.
    // Learning that before pressing beats learning it from a failed row. It is
    // non-blocking because this plan does not model namespace authority.
    renderGate({ readAccountGuard: vi.fn(async () => refGuard("ouronet-ns.dh_ah-keyset")) });
    await waitFor(() =>
      expect(textOf("keyset-update-gate-namespace-warning")).toMatch(/ouronet-ns/),
    );
    // Non-blocking: the fields and the forfeit are both still offered.
    expect(screen.getAllByPlaceholderText(/private key/i)).toHaveLength(5);
    expect(screen.getByTestId("keyset-update-gate-forfeit")).toBeTruthy();
  });

  it("does not warn for an open namespace like `free`", async () => {
    // WHY: `free` is `GUARD_SUCCESS` (`stoa-genesis-1.pact:112-113`). A warning
    // on every update would train the owner to ignore the one that matters.
    renderGate();
    await waitFor(() => expect(screen.getByTestId("keyset-update-gate-progress")).toBeTruthy());
    expect(screen.queryByTestId("keyset-update-gate-namespace-warning")).toBeNull();
  });
});

// ─── (h) the test of the test ─────────────────────────────────────────────

describe("this file's own hazard discipline", () => {
  it("contains ZERO vi.mock calls — the reader is injected", () => {
    // See the header. A mock a refactor silently drops fails OPEN onto
    // mainnet; an injected seam with no live default cannot.
    const self = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "ui-keyset-update-gate.test.tsx"),
      "utf8",
    );
    expect(self.match(/vi\s*\.\s*mock\s*\(/g) ?? []).toEqual([]);
  });

  it("never names a live read — the component takes its reader as a prop", () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../src/ui/settings/KeysetUpdateGate.tsx"),
      "utf8",
    );
    expect(src).not.toMatch(/monitoredReads|getKadenaAccountGuard|getFailoverClient|pactRead/);
  });
});
