/**
 * ObservationalCodexIdDisplay — Zone 2 of the CodexUI mobile shell (docs/work/
 * codex-ui-mobile/design.md §8). Desktop keeps the existing "details"
 * disclosure toggle (Standard/Smart Public Key + Guard hidden until clicked).
 * Mobile drops that toggle — a `SwipeDeck` shows the identity overview plus
 * (when observational) all three detail panes, one swipe at a time, always
 * reachable, never hidden.
 */
import { useEffect, useRef } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

import { CodexProvider, useCodexStore } from "../src/provider/index.js";
import { useCodex, useOuroAccounts, usePureKeypairs } from "../src/hooks/index.js";
import { CodexUiRoot } from "../src/ui/CodexUiRoot.js";
import { ObservationalCodexIdDisplay } from "../src/ui/ObservationalCodexId.js";
import { ControlsProvider, useControls } from "../src/ui/mobile/controls-context.js";

import { createCodexStore } from "@ancientpantheon/codex-ouronet/state";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import type { IOuroAccount, IPureKeypair } from "@ancientpantheon/codex-ouronet/types";

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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ouroFx = (id: string, overrides: Partial<IOuroAccount> = {}): IOuroAccount => ({
  id,
  name: "Test",
  version: "1.0.0",
  isSmart: false,
  address: "Ѻ." + id,
  guard: null,
  stoaChainLedger: null,
  publicKey: "pk-" + id,
  secret: "secret-" + id,
  backup: "backup-" + id,
  ...overrides,
});

const pureFx = (id: string): IPureKeypair => ({
  id,
  label: "Test Pure",
  publicKey: "f".repeat(64),
  encryptedPrivateKey: "enc-pk",
  createdAt: "2026-05-25T10:01:00.000Z",
});

/** Seeds one Standard (₱.) + one Smart (Π.) APOLLO account and enables the
 *  observational config referencing them, once the store is ready. `withGuard`
 *  also seeds a Pure Keypair and sets it as the observational guard, so
 *  `codexIdGuard` is non-null (needed to exercise the guard-pane/"Show
 *  CodexID Guard" Controls entry — without a guard picked, that entry never
 *  registers, matching the "no guard selected" empty state). */
function Seeder({ withGuard = false }: { withGuard?: boolean } = {}) {
  const { isReady } = useCodex();
  const { addAccount } = useOuroAccounts();
  const { keypairs, addKeypair } = usePureKeypairs();
  const store = useCodexStore();
  const started = useRef(false);

  useEffect(() => {
    if (!isReady || started.current) return;
    started.current = true;
    void (async () => {
      await addAccount(ouroFx("std1", { address: "₱.std1", isSmart: false }));
      await addAccount(ouroFx("smt1", { address: "Π.smt1", isSmart: true }));
      if (withGuard) await addKeypair(pureFx("guard1"));
      await store.getState().actions.updateUiSettings({
        observationalCodexId: {
          enabled: true, standardId: "std1", smartId: "smt1",
          guardKeypairId: withGuard ? "guard1" : "",
        },
      });
    })();
  }, [isReady, addAccount, addKeypair, withGuard, store]);

  void keypairs;
  return null;
}

async function renderObservational(
  width: number,
  opts: { withControls?: boolean; withGuard?: boolean; fullScreenPortalTarget?: Element | null } = {},
) {
  FakeResizeObserver.nextWidth = width;
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  const adapter = new MemoryCodexAdapter("dev");
  const tree = (
    <CodexProvider createStore={createCodexStore} adapter={adapter}>
      <Seeder withGuard={opts.withGuard} />
      <CodexUiRoot>
        <ObservationalCodexIdDisplay fullScreenPortalTarget={opts.fullScreenPortalTarget} />
      </CodexUiRoot>
    </CodexProvider>
  );
  render(opts.withControls ? <ControlsProvider>{tree}</ControlsProvider> : tree);
  // Wait for the observational identity to actually populate (past the
  // "not yet established" empty state).
  await waitFor(() => expect(screen.getByText(/observational/i)).toBeInTheDocument());
  // Zone 2 is COLLAPSED by default on mobile (the "Zone 2 collapse" round)
  // — expand it so the many pre-existing body-content assertions below keep
  // testing what they always intended (the SwipeDeck's actual pane
  // content), not the new collapsed single line. Desktop has no collapse
  // toggle at all (mobile-only concept), hence the optional query. The
  // collapse feature itself gets its own dedicated describe block further
  // down, which deliberately does NOT expand first.
  const expandBtn = screen.queryByRole("button", { name: /expand codex identity/i });
  if (expandBtn) fireEvent.click(expandBtn);
}

/** Same seeded/populated mobile mount as `renderObservational(390)`, but
 *  WITHOUT the auto-expand — for the collapse feature's own tests, which
 *  need to observe the actual default (collapsed) state. */
async function renderPopulatedCollapsed() {
  FakeResizeObserver.nextWidth = 390;
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  const adapter = new MemoryCodexAdapter("dev");
  render(
    <CodexProvider createStore={createCodexStore} adapter={adapter}>
      <Seeder />
      <CodexUiRoot>
        <ObservationalCodexIdDisplay />
      </CodexUiRoot>
    </CodexProvider>,
  );
  await waitFor(() => expect(screen.getByText(/observational/i)).toBeInTheDocument());
}

describe("ObservationalCodexIdDisplay — desktop (unchanged): details stay behind a toggle", () => {
  it("hides Standard/Smart Public Key + Guard until 'details' is clicked", async () => {
    await renderObservational(1920);
    expect(screen.queryByText(/Standard Public Key/i)).toBeNull();

    fireEvent.click(screen.getByText("details"));
    expect(screen.getByText(/Standard Public Key/i)).toBeInTheDocument();
    expect(screen.getByText(/Smart Public Key/i)).toBeInTheDocument();
  });
});

describe("ObservationalCodexIdDisplay — mobile: Zone 2 SwipeDeck", () => {
  it("has no 'details' toggle — swiping replaces it", async () => {
    await renderObservational(390);
    expect(screen.queryByText("details")).toBeNull();
  });

  it("shows all four panes' content at once (overview + Standard/Smart/Guard), never hidden behind a toggle", async () => {
    await renderObservational(390);
    expect(screen.getByText(/Standard Public Key/i)).toBeInTheDocument();
    expect(screen.getByText(/Smart Public Key/i)).toBeInTheDocument();
    expect(screen.getByText(/no guard selected/i)).toBeInTheDocument();
  });

  it("renders one SwipeDeck dot per pane (4: overview, Standard, Smart, Guard)", async () => {
    await renderObservational(390);
    expect(screen.getAllByLabelText(/go to pane/i)).toHaveLength(4);
  });

  it("compact Standard/Smart Public Key panes still show the Reveal Seed affordance (icon-only)", async () => {
    await renderObservational(390);
    expect(screen.getAllByLabelText("Reveal Seed")).toHaveLength(2);
  });
});

describe("ObservationalCodexIdDisplay — mobile, WITHOUT a ControlsProvider ancestor: safe fallback", () => {
  it("keeps the Lock control inline (nowhere else for it to go) — real production OuronetUI has no ControlsProvider yet", async () => {
    await renderObservational(390, { withControls: false });
    expect(screen.getByRole("button", { name: /unlock codex/i })).toBeInTheDocument();
  });
});

describe("ObservationalCodexIdDisplay — mobile, WITH a ControlsProvider ancestor: Lock ghosts into Controls", () => {
  it("removes the Lock control from the title row", async () => {
    await renderObservational(390, { withControls: true });
    expect(screen.queryByRole("button", { name: /unlock codex/i })).toBeNull();
  });

  it("registers it into Controls instead, reachable via useControls()", async () => {
    FakeResizeObserver.nextWidth = 390;
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const adapter = new MemoryCodexAdapter("dev");

    function Probe() {
      const { count, groups } = useControls();
      return <span data-testid="probe">{`${count}:${groups.map((g) => g.source).join(",")}`}</span>;
    }

    render(
      <ControlsProvider>
        <CodexProvider createStore={createCodexStore} adapter={adapter}>
          <Seeder />
          <CodexUiRoot>
            <ObservationalCodexIdDisplay />
          </CodexUiRoot>
        </CodexProvider>
        <Probe />
      </ControlsProvider>,
    );
    await waitFor(() => expect(screen.getByText(/observational/i)).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toBe("1:codexid-lock"));
  });
});

describe("ObservationalCodexIdDisplay — mobile Guard pane + full-screen popup", () => {
  it("with no guard selected: no 'Show CodexID Guard' Controls registration, guard pane shows the empty-guard message", async () => {
    await renderObservational(390, { withControls: true, withGuard: false });
    expect(screen.getByText(/no guard selected/i)).toBeInTheDocument();
  });

  it("with a guard selected: the guard pane shows its content, bounded/scrollable", async () => {
    await renderObservational(390, { withControls: true, withGuard: true });
    expect(screen.queryByText(/no guard selected/i)).toBeNull();
    // The guard pane's own preview box is the bounded/scrollable one (maxHeight set).
    const boxes = Array.from(document.querySelectorAll("div")).filter(
      (el) => (el as HTMLElement).style.maxHeight === "74px",
    );
    expect(boxes.length).toBeGreaterThan(0);
  });
});

/** Renders ObservationalCodexIdDisplay (withGuard, mobile) alongside an
 *  "open-guard" button that drives the SAME "Show CodexID Guard" action a
 *  Controls riser/drawer would (calling the registered item's `onClick`
 *  directly, bypassing the riser UI itself — that riser is host chrome,
 *  already covered by OuronetShellMock's own tests). Returns the render
 *  `container` so a test can assert WHERE the resulting dialog ends up. */
async function renderWithGuardOpener(fullScreenPortalTarget?: Element | null) {
  FakeResizeObserver.nextWidth = 390;
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  const adapter = new MemoryCodexAdapter("dev");

  function Opener() {
    const { groups } = useControls();
    const item = groups.flatMap((g) => g.items).find((i) => i.id === "show-guard");
    return (
      <button type="button" onClick={() => item?.onClick()}>
        open-guard
      </button>
    );
  }

  const utils = render(
    <ControlsProvider>
      <CodexProvider createStore={createCodexStore} adapter={adapter}>
        <Seeder withGuard />
        <CodexUiRoot>
          <ObservationalCodexIdDisplay fullScreenPortalTarget={fullScreenPortalTarget} />
        </CodexUiRoot>
      </CodexProvider>
      <Opener />
    </ControlsProvider>,
  );
  await waitFor(() => expect(screen.getByText(/observational/i)).toBeInTheDocument());
  fireEvent.click(screen.getByText("open-guard"));
  // `CodexModalShell` doesn't set aria-label/aria-labelledby, so the dialog's
  // accessible NAME is empty — match by role alone, then confirm it's really
  // the guard popup via its title text.
  const dialog = await screen.findByRole("dialog");
  await waitFor(() => expect(dialog).toHaveTextContent("CodexID Guard"));
  return { ...utils, dialog };
}

describe("ObservationalCodexIdDisplay — fullScreenPortalTarget (design.md §8 feedback round: 'the whole screen, not Zone 2 only')", () => {
  it("without a portal target: the Guard full-screen popup renders INSIDE this component's own tree (the old, bounded-to-Zone-2 behavior)", async () => {
    const { container, dialog } = await renderWithGuardOpener();
    expect(container.contains(dialog)).toBe(true);
  });

  it("WITH a portal target: the Guard full-screen popup renders INTO the target node instead, not inside this component's own DOM subtree", async () => {
    const portalTarget = document.body.appendChild(document.createElement("div"));
    const { container, dialog } = await renderWithGuardOpener(portalTarget);
    expect(container.contains(dialog)).toBe(false);
    expect(portalTarget.contains(dialog)).toBe(true);
    document.body.removeChild(portalTarget);
  });
});

describe("ObservationalCodexIdDisplay — mobile EMPTY state (design.md §8 feedback round: 'title plus button-like zones', not one crammed row)", () => {
  async function renderEmptyMobile() {
    FakeResizeObserver.nextWidth = 390;
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const adapter = new MemoryCodexAdapter("dev");
    render(
      <CodexProvider createStore={createCodexStore} adapter={adapter}>
        <CodexUiRoot>
          <ObservationalCodexIdDisplay />
        </CodexUiRoot>
      </CodexProvider>,
    );
    await waitFor(() => expect(screen.getByText(/not yet established/i)).toBeInTheDocument());
  }

  it("the title row doesn't carry the Define/Lock buttons — flexShrink: 0, only the collapse toggle lives there", async () => {
    await renderEmptyMobile();
    const title = screen.getByText("CodexID").parentElement as HTMLElement;
    expect(title.style.flexShrink).toBe("0");
    // The ONLY button in the title row is the collapse toggle itself — the
    // "Zone 2 collapse" round's new affordance — never Define/Lock, which
    // live in the (collapsible) body below.
    const buttons = Array.from(title.querySelectorAll("button"));
    expect(buttons).toHaveLength(1);
    expect(buttons[0].getAttribute("aria-label")).toMatch(/(expand|collapse) codex identity/i);
  });

  it("'Define Codex Identity' is a full-width button row, not a small inline pill (once expanded — collapsed by default, the row is hidden)", async () => {
    await renderEmptyMobile();
    fireEvent.click(screen.getByRole("button", { name: /expand codex identity/i }));
    const btn = screen.getByRole("button", { name: /define codex identity/i });
    expect(btn.style.width).toBe("100%");
  });

  it("the Lock/Unlock control is ALSO a full-width button row — no separate overflow-prone countdown text beside it (once expanded)", async () => {
    await renderEmptyMobile();
    fireEvent.click(screen.getByRole("button", { name: /expand codex identity/i }));
    const lockBtn = screen.getByRole("button", { name: /(un)?lock codex/i });
    expect(lockBtn.style.width).toBe("100%");
    // The countdown (when unlocked) folds INTO this same button — the
    // wrapper has exactly ONE child (the button), never a sibling span
    // beside it that could overflow past the row's own edge.
    expect(lockBtn.parentElement?.children.length).toBe(1);
  });
});

describe("ObservationalCodexIdDisplay — mobile: Zone 2 is COLLAPSIBLE, collapsed by default (design.md §8, the 'Zone 2 collapse' round)", () => {
  it("EMPTY state: collapsed by default — body (Define/Lock button rows) is hidden, only the title row + toggle show", async () => {
    FakeResizeObserver.nextWidth = 390;
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const adapter = new MemoryCodexAdapter("dev");
    render(
      <CodexProvider createStore={createCodexStore} adapter={adapter}>
        <CodexUiRoot>
          <ObservationalCodexIdDisplay />
        </CodexUiRoot>
      </CodexProvider>,
    );
    await waitFor(() => expect(screen.getByText(/not yet established/i)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /define codex identity/i })).toBeNull();
    expect(screen.getByRole("button", { name: /expand codex identity/i })).toBeInTheDocument();
  });

  it("POPULATED state: collapsed by default — the SwipeDeck (body) is hidden, only the title row + toggle show", async () => {
    await renderPopulatedCollapsed();
    expect(screen.queryByText(/Standard Public Key/i)).toBeNull();
    expect(screen.getByRole("button", { name: /expand codex identity/i })).toBeInTheDocument();
    // The title row itself — CodexID label, badge, copy tags — still shows
    // even collapsed (it's the "single line" the collapsed state IS).
    expect(screen.getByText("CodexID")).toBeInTheDocument();
  });

  it("clicking the toggle expands it — body content appears, toggle flips to 'Collapse'", async () => {
    await renderPopulatedCollapsed();
    fireEvent.click(screen.getByRole("button", { name: /expand codex identity/i }));
    expect(screen.getByText(/Standard Public Key/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /collapse codex identity/i })).toBeInTheDocument();
  });

  it("clicking it again re-collapses — body content disappears", async () => {
    await renderPopulatedCollapsed();
    fireEvent.click(screen.getByRole("button", { name: /expand codex identity/i }));
    expect(screen.getByText(/Standard Public Key/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /collapse codex identity/i }));
    expect(screen.queryByText(/Standard Public Key/i)).toBeNull();
    expect(screen.getByRole("button", { name: /expand codex identity/i })).toBeInTheDocument();
  });

  it("desktop has no collapse toggle at all — mobile-only concept", async () => {
    await renderObservational(1920);
    expect(screen.queryByRole("button", { name: /(expand|collapse) codex identity/i })).toBeNull();
  });

  it("while collapsed (empty state), the Lock control is still reachable — ghosted into Controls rather than stranded in the hidden body", async () => {
    FakeResizeObserver.nextWidth = 390;
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const adapter = new MemoryCodexAdapter("dev");

    function Probe() {
      const { count, groups } = useControls();
      return <span data-testid="probe">{`${count}:${groups.map((g) => g.source).join(",")}`}</span>;
    }

    render(
      <ControlsProvider>
        <CodexProvider createStore={createCodexStore} adapter={adapter}>
          <CodexUiRoot>
            <ObservationalCodexIdDisplay />
          </CodexUiRoot>
        </CodexProvider>
        <Probe />
      </ControlsProvider>,
    );
    await waitFor(() => expect(screen.getByText(/not yet established/i)).toBeInTheDocument());
    // Collapsed (default) + empty state: the inline `CodexLockControl
    // fullWidth` row is hidden (it's in the body), so it must be ghosted.
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toBe("1:codexid-lock"));
  });
});
