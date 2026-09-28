/**
 * PreZbomHint / PreZbomTooltipCard — the pre-ZBOM hover tooltip on a LAUNCHER
 * button, never a ZBOM's own execute button (that button carries NO hover
 * tooltip at all — see `tests/zbom-execute-button-no-tooltip.test.ts` — per
 * the owner's ruling: inside an open ZBOM the information is already on the
 * page). Built on `@ouronet/talos-registry@2.1.0`'s shared canon
 * (`tooltipModel`/`tooltipModels` — see `node_modules/@ouronet/talos-
 * registry/TOOLTIP-CANON.md`); this file's job is to prove the RENDERER
 * honors the canon's rules against the REAL, live-installed registry (not a
 * mock) — the model itself is the registry's own responsibility, verified by
 * its own test suite, not duplicated here.
 *
 * `PreZbomTooltipCard` (the always-rendered content) is tested directly for
 * rendering/live-read logic — mirrors `execution-tooltip.test.tsx`'s own "no
 * hover simulation needed" strategy. `PreZbomHint` (the hover-gated wrapper)
 * is tested with `ActionTooltip` replaced by a simple always-visible
 * passthrough, so the on/off/mobile/fail-open GATE (whether the card mounts
 * at all) is asserted directly without depending on Radix's real
 * pointer-timing/portal behavior.
 */
import * as React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, act } from "@testing-library/react";
import { setPactReader } from "@stoachain/stoa-core/reads";
import { CONSUMERS, tooltipModel, tooltipModels } from "@ouronet/talos-registry";
import { DEPLOY_API_KEY_KEY } from "../src/zbom/pythia/deployApiKey.js";
import { LINK_DUAL_API_KEY_KEY } from "../src/zbom/pythia/linkDualApiKey.js";
import { RENAME_DUAL_LANE_KEY, REVOKE_DUAL_LINK_KEY } from "../src/zbom/pythia/dualLinkOps.js";
import { CodexProvider } from "@ancientpantheon/codex-ouronet/provider";
import { MemoryCodexAdapter, emptySnapshot } from "@ancientpantheon/codex-ouronet/adapters";
import type { IConsumerSettings } from "@ancientpantheon/codex-ouronet/types";

vi.mock("../src/zbom/ui/ActionTooltip.js", () => ({
  ActionTooltip: ({ content, children }: { content: React.ReactNode; children: React.ReactNode }) => (
    <div data-testid="fake-action-tooltip">
      {children}
      <div data-testid="fake-action-tooltip-content">{content}</div>
    </div>
  ),
}));

import PreZbomHint, { PreZbomTooltipCard } from "../src/zbom/cfm/PreZbomHint.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function mockReader(response: unknown) {
  const reader = vi.fn().mockResolvedValue(response);
  setPactReader(reader);
  return reader;
}

function disabledAdapterFx(): MemoryCodexAdapter {
  const adapter = new MemoryCodexAdapter("dev");
  const entry: IConsumerSettings = {
    consumerName: "Codex",
    consumerVersion: "1.0.0",
    schemaVersion: 1,
    settings: { preZbomTooltip: false },
    lastUpdatedAt: "2026-05-29T00:00:00.000Z",
  };
  void adapter.saveAll({ ...emptySnapshot("dev"), consumerSettings: { Codex: entry } });
  return adapter;
}

describe("PreZbomTooltipCard — rule 1: every EXECUTION parameter, always, in order", () => {
  it("RotateGuard's numbered list shows all 4 exec params (patron executor new-guard safe), not just the preview's 2 (patron account)", () => {
    mockReader({ result: { status: "success", data: null } });
    const { container } = render(<PreZbomTooltipCard entrypoint="TS01-C1.DALOS|C_RotateGuard" />);

    expect(container.textContent).toContain("01 patron = ");
    expect(container.textContent).toContain("02 executor = ");
    expect(container.textContent).toContain("03 new-guard = ");
    expect(container.textContent).toContain("04 safe = ");
    expect(container.textContent).not.toContain("05 ");
  });

  it("PYTHIA|C_Link's numbered list shows all 4 exec params (executor standard-apollo smart-apollo consumer-lane), not the preview's 3", () => {
    const { container } = render(<PreZbomTooltipCard entrypoint="TS01-C4.PYTHIA|C_Link" />);

    expect(container.textContent).toContain("01 executor = ");
    expect(container.textContent).toContain("02 standard-apollo = ");
    expect(container.textContent).toContain("03 smart-apollo = ");
    expect(container.textContent).toContain("04 consumer-lane = ");
    expect(container.textContent).not.toContain("05 ");
  });

  it("shows the names row and a PARALLEL types row (rule 3) — never inlined as name:type pairs", () => {
    const { container } = render(<PreZbomTooltipCard entrypoint="TS01-C1.DALOS|C_RotateGuard" />);
    expect(screen.getByText("(patron executor new-guard safe)")).toBeTruthy();
    expect(screen.getByText("(string string guard bool)")).toBeTruthy();
    expect(container.textContent).not.toContain("patron:string");
  });
});

describe("PreZbomTooltipCard — rule 2: arguments are the execution's, cost is the preview's", () => {
  it("shows the preview's OWN name and OWN (possibly different, shorter) parameter list, separately from the numbered exec list", () => {
    mockReader({ result: { status: "success", data: null } });
    const { container } = render(<PreZbomTooltipCard entrypoint="TS01-C1.DALOS|C_RotateGuard" />);

    expect(screen.getByText("ouronet-ns.INFO-ONE.INFO_DALOS|RotateGuard")).toBeTruthy();
    expect(container.textContent).toContain("(patron account) — this preview's own arguments");
  });

  it("a real ghost value never gets mislabelled with the OTHER list's name — RotateGuard's exec has no 'account' slot at all", () => {
    mockReader({ result: { status: "success", data: null } });
    const { container } = render(<PreZbomTooltipCard entrypoint="TS01-C1.DALOS|C_RotateGuard" />);
    // "account" appears only in the preview's own parameter line, never as
    // a numbered exec row (RotateGuard's exec params are patron/executor/
    // new-guard/safe — "account" is exclusively the preview's own name).
    expect(container.textContent).not.toMatch(/0\d account = /);
  });
});

describe("PreZbomTooltipCard — rule 4/4b: chain colour+label, and a separate consumer marker", () => {
  it("an ouronet-kind entrypoint gets the canonical BLUE border and 'OURONET' label", () => {
    mockReader({ result: { status: "success", data: null } });
    const { container } = render(<PreZbomTooltipCard entrypoint="TS01-C4.CODEX|C_ReleaseStoicTag" />);
    const card = container.querySelector(".rounded-lg.border") as HTMLElement;
    expect(card.style.border).toContain("rgb(59, 130, 246)"); // #3b82f6
    expect(screen.getByText("OURONET")).toBeTruthy();
  });

  it("a stoa-kind (native coin.*) entrypoint gets the canonical GOLD border and 'STOA NATIVE' label — the SAME renderer, no separate native card", () => {
    const { container } = render(<PreZbomTooltipCard entrypoint="coin.C_URV|Stake" />);
    const card = container.querySelector(".rounded-lg.border") as HTMLElement;
    expect(card.style.border).toContain("rgb(206, 172, 95)"); // #ceac5f
    expect(screen.getByText("STOA NATIVE")).toBeTruthy();
  });

  it("the consumer marker is Codex's own violet accent — a DIFFERENT axis from the chain-coloured border, never merged with it", () => {
    mockReader({ result: { status: "success", data: null } });
    const { container } = render(<PreZbomTooltipCard entrypoint="TS01-C4.CODEX|C_ReleaseStoicTag" />);
    expect(screen.getByText("CODEX")).toBeTruthy();
    // The border stays chain-blue; the consumer accent (#8b5cf6) never
    // becomes the border colour.
    const card = container.querySelector(".rounded-lg.border") as HTMLElement;
    expect(card.style.border).not.toContain("rgb(139, 92, 246)");
  });

  it("native STOA has no INFO_ preview at all — a distinct footer says so instead of an empty cost section", () => {
    const { container } = render(<PreZbomTooltipCard entrypoint="coin.C_URV|Stake" />);
    expect(container.textContent).toContain("no IGNIS");
    expect(container.textContent).toContain("not an Ouronet operation");
    expect(container.textContent).toContain("Gas is still sponsored");
    expect(container.textContent).not.toMatch(/\d\s*IGNIS/); // no cost NUMBER — natives are never priced
  });
});

describe("PreZbomTooltipCard — local stopgap for a key the registry can't describe yet", () => {
  it("coin.C_TransferAcross falls back to the local spec (tooltipModels silently drops it — confirmed absent from STOA_SIGNATURES) — gold border, STOA NATIVE label, the real 5-parameter signature", () => {
    const { container } = render(<PreZbomTooltipCard entrypoint="coin.C_TransferAcross" />);
    expect(screen.getByText("STOA NATIVE")).toBeTruthy();
    const card = container.querySelector(".rounded-lg.border") as HTMLElement;
    expect(card.style.border).toContain("rgb(206, 172, 95)"); // #ceac5f, same gold as every other stoa card
    expect(container.textContent).toContain("coin.C_TransferAcross");
    expect(container.textContent).toContain("01 sender");
    expect(container.textContent).toContain("02 receiver");
    expect(container.textContent).toContain("03 receiver-guard");
    expect(container.textContent).toContain("04 target-chain");
    expect(container.textContent).toContain("05 amount");
    expect(container.textContent).not.toContain("06 ");
    // Canon retraction (2.2.0): an earlier round wrongly inferred "not an
    // Ouronet operation" to mean "gas is unsponsored" — every native modal
    // actually carries GAS_PAYER on the gas-station key. The local-stopgap
    // card must say so too, same as every registry-backed stoa ModelCard.
    expect(container.textContent).toContain("Gas is still sponsored");
  });

  it("honors a caller-supplied description, same as every registry-backed ModelCard", () => {
    render(<PreZbomTooltipCard entrypoint="coin.C_TransferAcross" description="Sends STOA to another chain." />);
    expect(screen.getByText("Sends STOA to another chain.")).toBeTruthy();
  });

  // Live bug report: this card used to render ONLY the signature's param
  // NAMES — a caller-supplied `values` prop was silently ignored, unlike
  // every registry-backed `ModelCard`, so a launcher's real sender/receiver
  // never reached this specific card even when correctly passed in.
  it("renders caller-supplied values (bound by name), not just param names — every slot shows a real value, not a placeholder", () => {
    render(
      <PreZbomTooltipCard
        entrypoint="coin.C_TransferAcross"
        values={{ sender: "k:realsender", receiver: "k:realreceiver", "target-chain": "1" }}
      />,
    );
    expect(screen.getByText('"k:realsender"')).toBeTruthy();
    expect(screen.getByText('"k:realreceiver"')).toBeTruthy();
    expect(screen.getByText('"1"')).toBeTruthy();
    // receiver-guard/amount weren't supplied — they still resolve to a
    // type-appropriate ghost, never an italic "<no live example>" placeholder,
    // matching every OTHER stoa/kadena key's own fallback.
    expect(screen.getByText('(read-keyset "ks")')).toBeTruthy();
    expect(screen.queryByText("<no live example>")).toBeNull();
  });

  it("PreZbomHint does NOT fail open for this key — it's describable via the local stopgap, so the tooltip still mounts", async () => {
    render(
      <CodexProvider adapter={new MemoryCodexAdapter("dev")}>
        <PreZbomHint entrypoint="coin.C_TransferAcross">
          <button>Cross-chain Send</button>
        </PreZbomHint>
      </CodexProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("fake-action-tooltip")).toBeTruthy());
  });
});

describe("PreZbomTooltipCard — rule 5: a ghost is not data", () => {
  it("italicizes a placeholder row ('example') instead of showing it as plain data", () => {
    mockReader({ result: { status: "success", data: null } });
    const { container } = render(<PreZbomTooltipCard entrypoint="TS01-C4.PYTHIA|C_Link" />);
    // standard-apollo/smart-apollo/consumer-lane all have no real ghost —
    // confirmed live, every one of them ships the "example" sentinel.
    expect(screen.getAllByText("<no live example>").length).toBeGreaterThanOrEqual(3);
    expect(container.textContent).not.toContain('"example"');
  });

  it("does not fire the live read when any exec/preview argument is a placeholder — shouldRead is false, not inferred by this file", async () => {
    const reader = mockReader({ result: { status: "success", data: null } });
    render(<PreZbomTooltipCard entrypoint="TS01-C4.PYTHIA|C_Link" />);
    await waitFor(() => expect(screen.getByText(/no live example on chain/)).toBeTruthy());
    expect(reader).not.toHaveBeenCalled();
  });

  it("fires the live read and renders the result when nothing is a placeholder", async () => {
    const reader = mockReader({
      result: { status: "success", data: { "pre-text": ["ok"], ignis: { "ignis-need": { decimal: "1.0" } } } },
    });
    render(<PreZbomTooltipCard entrypoint="TS01-C4.CODEX|C_ReleaseStoicTag" />);
    await waitFor(() => expect(reader).toHaveBeenCalled());
    const [code] = reader.mock.calls[0];
    expect(code).toContain("INFO_CODEX|ReleaseStoicTag");
    await waitFor(() => expect(screen.getByText("ok")).toBeTruthy());
    expect(screen.getByText(/1(\.0)? IGNIS/)).toBeTruthy();
  });
});

describe("PreZbomTooltipCard — rule 6: a guard is shown via its display form, never its raw submittable shape", () => {
  it("RotateGuard's guard slot renders (read-keyset \"ks\"), never [object Object] or a raw {readKeyset} shape", () => {
    mockReader({ result: { status: "success", data: null } });
    const { container } = render(<PreZbomTooltipCard entrypoint="TS01-C1.DALOS|C_RotateGuard" />);
    expect(screen.getByText('(read-keyset "ks")')).toBeTruthy();
    expect(container.textContent).not.toContain("[object Object]");
    expect(container.textContent).not.toContain("readKeyset");
  });

  it("a native TransferAnew's receiver-guard slot ALSO gets the display form — the same rule applies uniformly across chains", () => {
    const { container } = render(<PreZbomTooltipCard entrypoint="coin.C_TransferAnew" />);
    expect(container.textContent).toContain("01 sender = ");
    expect(container.textContent).toContain("02 receiver = ");
    expect(container.textContent).toContain("03 receiver-guard = ");
    expect(container.textContent).toContain("04 amount = ");
    expect(screen.getByText('(read-keyset "ks")')).toBeTruthy();
  });
});

describe("PreZbomTooltipCard — rule 8: a refusal is an answer, rendered as one", () => {
  it("classifies a 'No value found in table ... for key' refusal as a friendly, matter-of-fact message — not red, not the raw chain text", async () => {
    mockReader({
      result: { status: "failure", error: { message: "No value found in table ouronet-ns.ATS_ATS|Ledger for key: SilverStoa" } },
    });
    // A unique caller-supplied value keeps this test's rendered call string
    // (and therefore usePreZbomPreview's module-level cache key) distinct
    // from every other test using this same entrypoint — otherwise a prior
    // test's cached "ok" result would be served here instead of firing a
    // fresh read.
    render(<PreZbomTooltipCard entrypoint="TS01-C4.CODEX|C_ReleaseStoicTag" values={{ "tag-name": "Rule8MissingRowTag" }} />);
    const friendly = await waitFor(() => screen.getByText(/no existing record for this yet/i));
    expect(screen.queryByText(/No value found in table/)).toBeNull();
    // This exact string shape has shipped from a genuinely BROKEN/stale
    // module reference at least four times in this package's own history
    // (confirmed reading ouroSelectorReads.ts's own doc comment) — the raw
    // chain message must stay reachable on hover (title), never fully
    // replaced by the friendly text, so a real wiring regression producing
    // the same shape stays discoverable on inspection.
    expect(friendly.getAttribute("title")).toBe("No value found in table ouronet-ns.ATS_ATS|Ledger for key: SilverStoa");
  });

  it("does NOT classify a near-miss message missing the 'for key' clause — falls through to raw/red, proving the regex boundary is intentional, not coincidental", async () => {
    mockReader({
      result: { status: "failure", error: { message: "No value found in table ouronet-ns.ATS_ATS|Ledger" } },
    });
    render(<PreZbomTooltipCard entrypoint="TS01-C4.CODEX|C_ReleaseStoicTag" values={{ "tag-name": "Rule8NearMissTag" }} />);
    await waitFor(() =>
      expect(screen.getByText(/No value found in table ouronet-ns\.ATS_ATS\|Ledger/)).toBeTruthy()
    );
    expect(screen.queryByText(/no existing record for this yet/i)).toBeNull();
  });

  it("shows an UNCLASSIFIED refusal raw, in red — prettifying every refusal is how a genuinely broken contract call gets hidden", async () => {
    mockReader({
      result: { status: "failure", error: { message: "some genuinely unexpected on-chain refusal xyz" } },
    });
    render(<PreZbomTooltipCard entrypoint="TS01-C4.CODEX|C_ReleaseStoicTag" values={{ "tag-name": "Rule8UnclassifiedTag" }} />);
    await waitFor(() =>
      expect(screen.getByText(/some genuinely unexpected on-chain refusal xyz/i)).toBeTruthy()
    );
  });
});

describe("PreZbomTooltipCard — caller-supplied values bind BY NAME, against either list, never positionally", () => {
  it("a caller value keyed by the PREVIEW's own name ('account', not an exec slot at all) is used and fires the live read", async () => {
    const reader = mockReader({
      result: { status: "success", data: { "pre-text": ["ok"], ignis: { "ignis-need": { decimal: "0.5" } } } },
    });
    render(<PreZbomTooltipCard entrypoint="TS01-C1.DALOS|C_RotateGuard" values={{ account: "Σ.realaccount" }} />);
    await waitFor(() => expect(reader).toHaveBeenCalled());
    const [code] = reader.mock.calls[0];
    expect(code).toContain("Σ.realaccount");
    // "account" is not an exec slot name for RotateGuard at all — it must
    // never appear as a numbered row (rule 1 lists the EXEC's own params).
    expect(screen.queryByText(/0\d account = /)).toBeNull();
  });

  it("a caller value keyed by an EXEC slot name is shown in the numbered list, not italicized as a placeholder", () => {
    const { container } = render(
      <PreZbomTooltipCard entrypoint="coin.C_URV|Stake" values={{ account: "k:realaddress00000000000000000000000000" }} />,
    );
    expect(container.textContent).toContain("k:realaddress0…00000000000000"); // shortened, keep=14
    expect(container.textContent).not.toContain("k:1ac0d8b0a4f6e2c9d3b5a7e1f4c6089d2b3e5a7c9f1d3b5e7a9c1f3d5b7e9a1c");
  });

  // Live bug report: Kadena's cross-chain variant showed the SAME registry
  // ghost value for both `receiver` and `target-chain` (both `string`-typed
  // exec params, so the registry's own per-TYPE ghost fallback can't
  // distinguish them without a real caller value) — the launcher's tooltip
  // was telling the user their receiver account and target chain were the
  // same string. Supplying real, distinct values for both fixes it.
  it("coin.transfer-crosschain: caller-supplied receiver and target-chain render as DISTINCT real values, not the same reused ghost", () => {
    render(
      <PreZbomTooltipCard
        entrypoint="coin.transfer-crosschain"
        values={{ sender: "k:realsender", receiver: "k:realreceiver", "target-chain": "1" }}
      />,
    );
    expect(screen.getByText('"k:realsender"')).toBeTruthy();
    expect(screen.getByText('"k:realreceiver"')).toBeTruthy();
    expect(screen.getByText('"1"')).toBeTruthy();
  });
});

describe("PreZbomTooltipCard — cycling (multiple entrypoints)", () => {
  it("shows no cycle footer at all for a bare-string entrypoint", () => {
    const { container } = render(<PreZbomTooltipCard entrypoint="coin.C_URV|Stake" />);
    expect(container.textContent).not.toContain("executions");
  });

  it("starts at slot 0 and shows the cycle footer when given 2 entrypoint keys", () => {
    render(<PreZbomTooltipCard entrypoint={["coin.C_URV|Stake", "coin.C_URV|Collect"]} />);
    expect(screen.getByText("coin.C_URV|Stake")).toBeTruthy();
    expect(screen.queryByText("coin.C_URV|Collect")).toBeNull();
    expect(screen.getByText("this button offers 2 executions")).toBeTruthy();
  });

  it("advances to the next slot after one full CYCLE_MS (10s) tick, and wraps back to slot 0 after a second", () => {
    vi.useFakeTimers();
    render(<PreZbomTooltipCard entrypoint={["coin.C_URV|Stake", "coin.C_URV|Collect"]} />);
    expect(screen.getByText("coin.C_URV|Stake")).toBeTruthy();

    // 120ms STEPs: the slot only advances on the first tick AT OR AFTER
    // 10_000ms — the 84th tick, at 10_080ms, not exactly 10_000ms.
    act(() => { vi.advanceTimersByTime(10_200); });
    expect(screen.queryByText("coin.C_URV|Stake")).toBeNull();
    expect(screen.getByText("coin.C_URV|Collect")).toBeTruthy();

    act(() => { vi.advanceTimersByTime(10_200); });
    expect(screen.queryByText("coin.C_URV|Collect")).toBeNull();
    expect(screen.getByText("coin.C_URV|Stake")).toBeTruthy();
  });

  it("a fresh mount always restarts at slot 0, regardless of where a prior instance's cycle had reached", () => {
    vi.useFakeTimers();
    const first = render(<PreZbomTooltipCard entrypoint={["coin.C_URV|Stake", "coin.C_URV|Collect"]} />);
    act(() => { vi.advanceTimersByTime(5_000); });
    first.unmount();

    render(<PreZbomTooltipCard entrypoint={["coin.C_URV|Stake", "coin.C_URV|Collect"]} />);
    expect(screen.getByText("coin.C_URV|Stake")).toBeTruthy();
    expect(screen.queryByText("coin.C_URV|Collect")).toBeNull();
  });

  it("drops a stale/unknown key from a cycling set rather than losing the whole tooltip", () => {
    const { container } = render(
      <PreZbomTooltipCard entrypoint={["coin.C_URV|Stake", "TS01-NOPE|C_DoesNotExist"]} />,
    );
    expect(container.textContent).not.toContain("executions"); // only 1 of 2 keys survived — no cycling
    expect(screen.getByText("coin.C_URV|Stake")).toBeTruthy();
  });

  // Live bug report: the native-Stoa and Kadena Send launchers' tooltips
  // used to cycle through only their two SAME-chain variants — the
  // cross-chain variant was silently missing from the "this button offers N
  // executions" cycle, even though the launcher's own modal (SendStoaModal/
  // SendKadenaModal) genuinely supports cross-chain as a real third mode.
  // For Kadena this was a plain omission (`coin.transfer-crosschain` is
  // already in the installed registry's `KADENA_SIGNATURES` — a "model"
  // slot). For StoaChain, `coin.C_TransferAcross` is a `LOCAL_STOA_SIGNATURES`
  // stopgap key (the registry itself can't describe it yet) — the OLD
  // cycling logic (`tooltipModels` alone) could only ever produce "model"
  // slots and had a SEPARATE, single-key-only branch for a lone stopgap key,
  // so a stopgap key could never appear ALONGSIDE two real models in one
  // cycling set. These tests pin the fix: a cycle can mix both kinds.
  it("mixes a registry-model slot and a local-stopgap slot in ONE cycle (native Stoa Send's real 3-variant set: same-chain, same-chain-create, cross-chain)", () => {
    vi.useFakeTimers();
    render(
      <PreZbomTooltipCard entrypoint={["coin.C_Transfer", "coin.C_TransferAnew", "coin.C_TransferAcross"]} />,
    );
    expect(screen.getByText("this button offers 3 executions")).toBeTruthy();
    expect(screen.getByText("coin.C_Transfer")).toBeTruthy();

    act(() => { vi.advanceTimersByTime(10_200); });
    expect(screen.getByText("coin.C_TransferAnew")).toBeTruthy();

    act(() => { vi.advanceTimersByTime(10_200); });
    // Slot 2 is the local-stopgap card — same "STOA NATIVE" card this
    // package already renders for a bare, non-cycling `coin.C_TransferAcross`
    // (see the "local stopgap" describe block above), now reachable from
    // inside a cycle instead of only standalone.
    expect(screen.getByText("STOA NATIVE")).toBeTruthy();
    expect(screen.getByText("coin.C_TransferAcross")).toBeTruthy();
    expect(screen.getByText("Gas is still sponsored", { exact: false })).toBeTruthy();
  });

  it("Kadena Send's real 3-variant set (all registry models: coin.transfer / coin.transfer-create / coin.transfer-crosschain) cycles through all three, not just the two same-chain ones", () => {
    vi.useFakeTimers();
    render(
      <PreZbomTooltipCard entrypoint={["coin.transfer", "coin.transfer-create", "coin.transfer-crosschain"]} />,
    );
    expect(screen.getByText("this button offers 3 executions")).toBeTruthy();
    expect(screen.getByText("coin.transfer")).toBeTruthy();

    act(() => { vi.advanceTimersByTime(10_200); });
    expect(screen.getByText("coin.transfer-create")).toBeTruthy();

    act(() => { vi.advanceTimersByTime(10_200); });
    expect(screen.getByText("coin.transfer-crosschain")).toBeTruthy();
    // rule 4: Kadena is a genuinely different chain, still coloured green,
    // even for this "defpact"/multi-step variant.
    expect(screen.getByText("KADENA")).toBeTruthy();
  });
});

describe("PreZbomHint — rule 0: fail open for a key the model cannot describe", () => {
  it("renders children alone (no tooltip at all) when NONE of the given keys resolve, and warns once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(
      <CodexProvider adapter={new MemoryCodexAdapter("dev")}>
        <PreZbomHint entrypoint="TS01-NOPE|C_DoesNotExist">
          <button>Do the thing</button>
        </PreZbomHint>
      </CodexProvider>,
    );
    await waitFor(() => expect(screen.getByText("Do the thing")).toBeTruthy());
    expect(screen.queryByTestId("fake-action-tooltip")).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("still renders the tooltip when AT LEAST ONE of several keys resolves", async () => {
    render(
      <CodexProvider adapter={new MemoryCodexAdapter("dev")}>
        <PreZbomHint entrypoint={["TS01-NOPE|C_DoesNotExist", "coin.C_URV|Stake"]}>
          <button>Stake</button>
        </PreZbomHint>
      </CodexProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("fake-action-tooltip")).toBeTruthy());
  });
});

describe("PreZbomHint — the double-tooltip fix: strip the wrapped button's own native title", () => {
  it("removes a `title` prop from the wrapped child so the browser's native tooltip never fights the Radix one", async () => {
    render(
      <CodexProvider adapter={new MemoryCodexAdapter("dev")}>
        <PreZbomHint entrypoint="coin.C_URV|Stake">
          <button title="Stake UrStoa">Stake</button>
        </PreZbomHint>
      </CodexProvider>,
    );
    const button = await screen.findByText("Stake");
    expect(button.closest("button")?.hasAttribute("title")).toBe(false);
  });

  it("leaves a child with no title prop untouched", async () => {
    render(
      <CodexProvider adapter={new MemoryCodexAdapter("dev")}>
        <PreZbomHint entrypoint="coin.C_URV|Stake">
          <button>Stake</button>
        </PreZbomHint>
      </CodexProvider>,
    );
    const button = await screen.findByText("Stake");
    expect(button.closest("button")?.hasAttribute("title")).toBe(false);
  });
});

describe("PreZbomHint — on/off + mobile gate", () => {
  it("renders only children, with no ActionTooltip mounted, when the setting is off — and the live read never fires (not just hidden UI)", async () => {
    const reader = mockReader({ result: { status: "success", data: null } });
    render(
      <CodexProvider adapter={disabledAdapterFx()}>
        <PreZbomHint entrypoint="TS01-C4.PYTHIA|C_Link">
          <button>Link</button>
        </PreZbomHint>
      </CodexProvider>,
    );
    await waitFor(() => expect(screen.getByText("Link")).toBeTruthy());
    expect(screen.queryByTestId("fake-action-tooltip")).toBeNull();

    await new Promise((r) => setTimeout(r, 300));
    expect(reader).not.toHaveBeenCalled();
  });

  it("wraps children in ActionTooltip when enabled (default, no prior settings entry) and on desktop (no CodexUiRoot ancestor = desktop)", async () => {
    render(
      <CodexProvider adapter={new MemoryCodexAdapter("dev")}>
        <PreZbomHint entrypoint="TS01-C4.PYTHIA|C_Link">
          <button>Link</button>
        </PreZbomHint>
      </CodexProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("fake-action-tooltip")).toBeTruthy());
    expect(screen.getByText("Link")).toBeTruthy();
  });

  // Mobile gating (`if (isMobile) return children`) mirrors `ExecutionTooltip`'s
  // own, already-shipped `useIsMobile()` gate byte-for-byte — not re-proven here
  // (forcing mobile requires a `CodexUiRoot` + `ResizeObserver` mock,
  // disproportionate to a one-line mirror of an already-proven pattern).
});

describe("PreZbomHint launcher wiring — real caller values bound by name, against the REAL registry", () => {
  // Locks in the CONFIRMED-REAL subset of aliases each real launcher call
  // site's own fill map (`ouronetAccountFillValues`/`resolvePatronFillValue`,
  // `preZbomFillMap.ts`) actually resolves to real parameter names for THAT
  // specific entrypoint, checked against the live registry's own
  // `tooltipModel` — not
  // through the React render (a value bound to a PREVIEW-ONLY name, e.g.
  // RotateGuard's "account", is never itself rendered as visible text — it
  // only ever appears inside the composed `preview.call` string — so
  // asserting on rendered DOM text would silently pass or fail for the
  // wrong reason depending on which list a given name happens to belong to;
  // calling the model directly checks the ACTUAL claim: every wired name is
  // a real exec-or-preview parameter, and the value it carries reaches the
  // model). `tooltipModel` expects values as rendered Pact literals
  // (quoted), matching `toModelValues`'s own contract in the source file.
  // 2026-09-28: every DALOS/CODEX entry below now carries the SAME
  // `patron`+`executor` (plus the other confirmed aliases) shape the real
  // `ouronetAccountFillValues`/`resolvePatronFillValue`-driven launchers in
  // OuronetAccountsTab.tsx/SingleApiPanel.tsx/DualApiPanel.tsx actually pass
  // — NOT the pre-fix `{ account: "..." }`-only shape, which is exactly the
  // silently-no-op bug this round's own fill map fixed (see
  // docs/work/prezbom-tooltip-canon-2.2/design.md). `account` alone used to
  // pass this test only because it happens to ALSO be `RotateGuard`'s own
  // PREVIEW parameter name — it never proved `patron`/`executor` (the real
  // EXECUTION parameter names) were wired at all.
  // Scoped per entrypoint to EXACTLY the aliases confirmed real for that
  // specific key (this test intentionally does NOT tolerate an unused/
  // harmless extra the way `ouronetAccountFillValues`'s own production
  // callers deliberately do — this test's whole point is catching a
  // mistyped/wrong name, so an unused key here would be a real gap it
  // should still catch, not something to paper over with a shared blob).
  const CASES: Array<{ label: string; entrypoint: string; values: Record<string, string> }> = [
    { label: "Rotate Payment Key", entrypoint: "TS01-C1.DALOS|C_RotateStoa", values: { patron: "Σ.primetest", executor: "Σ.testaccount", account: "Σ.testaccount" } },
    { label: "Rotate Guard", entrypoint: "TS01-C1.DALOS|C_RotateGuard", values: { patron: "Σ.primetest", executor: "Σ.testaccount", account: "Σ.testaccount" } },
    { label: "Release StoicTag", entrypoint: "TS01-C4.CODEX|C_ReleaseStoicTag", values: { patron: "Σ.primetest", executor: "Σ.testaccount", "tag-name": "existingtag" } },
    { label: "Register StoicTag", entrypoint: "TS01-C4.CODEX|C_RegisterStoicTag", values: { patron: "Σ.primetest", executor: "Σ.testaccount", "tag-name": "NewTag", "account-address": "Σ.testaccount" } },
    { label: "Rotate Sovereign", entrypoint: "TS01-C1.DALOS|C_RotateSovereign", values: { patron: "Σ.primetest", executor: "Σ.testaccount", account: "Σ.testaccount" } },
    { label: "Rotate Governor", entrypoint: "TS01-C1.DALOS|C_RotateGovernor", values: { patron: "Σ.primetest", executor: "Σ.testaccount", account: "Σ.testaccount" } },
    // DeploySmartAccount/DeployStandardAccount have no `patron` exec slot at
    // all (confirmed live) — only `executor`/`account` apply.
    { label: "Deploy Standard Account", entrypoint: "TS01-C1.DALOS|C_DeployStandardAccount", values: { executor: "Σ.testaccount", account: "Σ.testaccount" } },
    { label: "Deploy Smart Account", entrypoint: "TS01-C1.DALOS|C_DeploySmartAccount", values: { executor: "Σ.testaccount", account: "Σ.testaccount" } },
    { label: "Deploy API Key", entrypoint: DEPLOY_API_KEY_KEY, values: { patron: "Σ.primetest", executor: "Σ.testaccount", "apollo-account": "Σ.testaccount", "owner-account": "Σ.testaccount" } },
    { label: "Link Dual API Key", entrypoint: LINK_DUAL_API_KEY_KEY, values: { "standard-apollo": "Π.std", "smart-apollo": "Π.smt", "consumer-lane": "NewLane", executor: "Σ.testaccount" } },
    { label: "Rename dual lane", entrypoint: RENAME_DUAL_LANE_KEY, values: { patron: "Σ.primetest", executor: "Σ.testaccount", "dual-link-key": "Σ.std:Π.smt", "new-name": "NewName" } },
    { label: "Revoke dual link", entrypoint: REVOKE_DUAL_LINK_KEY, values: { patron: "Σ.primetest", executor: "Σ.testaccount", "dual-link-key": "Σ.std:Π.smt" } },
    { label: "Send/Transfer (Stoa mode)", entrypoint: "coin.C_Transfer", values: { sender: "k:realaddress" } },
    { label: "Send/Transfer Anew (Stoa mode)", entrypoint: "coin.C_TransferAnew", values: { sender: "k:realaddress" } },
    { label: "Transfer UrStoa", entrypoint: "coin.C_UR|Transfer", values: { sender: "k:realaddress" } },
    { label: "Stake UrStoa", entrypoint: "coin.C_URV|Stake", values: { account: "k:realaddress" } },
    { label: "Unstake UrStoa", entrypoint: "coin.C_URV|Unstake", values: { account: "k:realaddress" } },
    { label: "Collect UrStoa", entrypoint: "coin.C_URV|Collect", values: { account: "k:realaddress" } },
  ];

  for (const { label, entrypoint, values } of CASES) {
    it(`${label}: every wired name is a real exec-or-preview param, and its value reaches the model`, () => {
      const quoted: Record<string, string> = {};
      for (const [k, v] of Object.entries(values)) quoted[k] = JSON.stringify(v);
      const m = tooltipModel(entrypoint, quoted, CONSUMERS.Codex);

      for (const [name, rawValue] of Object.entries(values)) {
        const slot = m.slots.find((s) => s.name === name);
        const isPreviewParam = m.preview?.params.includes(name) ?? false;
        expect(
          slot || isPreviewParam,
          `${entrypoint}: "${name}" is not a real exec or preview parameter name — check the spelling against the live registry`,
        ).toBeTruthy();
        if (slot) {
          expect(slot.isPlaceholder, `${entrypoint}.${name} rendered as a placeholder despite a real caller value`).toBe(false);
          expect(slot.value, `${entrypoint}.${name} value mismatch`).toContain(rawValue);
        } else {
          expect(m.preview!.call, `${entrypoint}: preview.call never used ${name}=${rawValue}`).toContain(rawValue);
        }
      }
    });
  }

  // `coin.C_UR|TransferAnew` — the 4th Transfer-UrStoa cycling variant this
  // package wires in `StoaAccountsTab.tsx` — is NOT YET in the installed
  // 2.1.0 registry's own `STOA_SIGNATURES` table, even though the deployed
  // contract genuinely has it (confirmed live:
  // `_onchain/Ouronet/0_Stoa/coin-contract/coin-live.pact:1080`). This is a
  // gap in the shared canonical package, not something to patch around here
  // (that would reintroduce the exact per-app drift this migration exists
  // to end) — `tooltipModels` already degrades gracefully: it drops the
  // unresolvable variant rather than throwing, so Transfer UrStoa's cycling
  // temporarily shows only its `C_UR|Transfer` variant in production until
  // the registry adds the missing entry upstream.
  it("coin.C_UR|TransferAnew is not yet in the installed registry — tooltipModels drops it rather than throwing or crashing the cycle", () => {
    const models = tooltipModels(
      ["coin.C_UR|Transfer", "coin.C_UR|TransferAnew"],
      { sender: '"k:realaddress"' },
      CONSUMERS.Codex,
    );
    expect(models.map((m) => m.exec)).toEqual(["coin.C_UR|Transfer"]);
  });
});

describe("StoaAccountsTab.tsx — real Send launcher entrypoint arrays include the cross-chain variant", () => {
  // Source-text guard, not a render test: the exact old broken pattern
  // (a two-element array omitting the cross-chain variant) never
  // reappears — mirrors `zbom-prezbom-fill-map.test.ts`'s own precedent for
  // this style of regression guard.
  const source = readFileSync(resolve(__dirname, "../src/ui/tabs/StoaAccountsTab.tsx"), "utf8");

  it("Kadena mode's Send launcher offers all three registry-resolvable variants, not just the two same-chain ones", () => {
    expect(source).toMatch(/entrypoint=\{\["coin\.transfer",\s*"coin\.transfer-create",\s*"coin\.transfer-crosschain"\]\}/);
  });

  it("native Stoa mode's Send launcher offers all three variants (two registry models + the local-stopgap cross-chain key), not just the two same-chain ones", () => {
    expect(source).toMatch(/\["coin\.C_Transfer",\s*"coin\.C_TransferAnew",\s*"coin\.C_TransferAcross"\]/);
  });
});

describe("PreZbomHint / PreZbomTooltipCard — module-scope discipline", () => {
  it("both are declared as top-level statements in the source file, not returned from inside another function (the flicker/remount trap)", () => {
    const path = resolve(__dirname, "../src/zbom/cfm/PreZbomHint.tsx");
    const text = readFileSync(path, "utf8");
    expect(text).toMatch(/^export function PreZbomTooltipCard/m);
    expect(text).toMatch(/^export default function PreZbomHint/m);
  });
});
