/**
 * codex-ouronet's own CodexModalShell — the SAME mobile full-screen-sheet
 * flip as codex-ui's copy (see that package's ui-codex-modal-shell-mobile.test.tsx
 * for the full rationale), wired through `useIsMobile` imported from
 * `@ancientpantheon/codex-ui/ui`. This file confirms the WIRING specifically
 * in this package — every zbom/UrStoa/Send modal renders into THIS shell, not
 * codex-ui's, so this is the copy that actually matters for the app.
 *
 * No test elsewhere in this package needs to change: `useIsMobile()` defaults
 * to `false` (desktop) with no `<CodexUiRoot>` ancestor, so every EXISTING
 * modal test that renders a modal directly (without wrapping it in
 * `CodexUiRoot`) is completely unaffected — exactly the point of that default.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { CodexUiRoot } from "@ancientpantheon/codex-ui/ui";
import { CodexModalShell } from "../src/ui/internal/CodexModalShell";

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

function renderModal(width: number) {
  FakeResizeObserver.nextWidth = width;
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  return render(
    <CodexUiRoot>
      <CodexModalShell title="Test Modal" onClose={() => {}} dialogTestId="test-modal">
        <p>body</p>
      </CodexModalShell>
    </CodexUiRoot>,
  );
}

describe("codex-ouronet CodexModalShell — mobile full-screen sheet", () => {
  it("desktop (wide CodexUiRoot): unchanged — fixed position, capped width", () => {
    renderModal(1920);
    const dialog = screen.getByTestId("test-modal");
    expect(dialog.style.position).toBe("fixed");
  });

  it("mobile (narrow CodexUiRoot): position: absolute (anchored to CodexUiRoot), full-bleed sheet", () => {
    renderModal(390);
    const dialog = screen.getByTestId("test-modal");
    expect(dialog.style.position).toBe("absolute");
    const card = dialog.firstElementChild as HTMLElement;
    expect(card.style.maxWidth).toBe("none");
    expect(card.style.borderRadius).toBe("0px");
  });

  it("with NO CodexUiRoot ancestor (every pre-existing modal test in this package): stays desktop — the safe default that keeps ~30 existing modal tests unaffected", () => {
    render(
      <CodexModalShell title="Test Modal" onClose={() => {}} dialogTestId="test-modal">
        <p>body</p>
      </CodexModalShell>,
    );
    expect(screen.getByTestId("test-modal").style.position).toBe("fixed");
  });
});

describe("codex-ouronet CodexModalShell — mobile: footer pinned to the card's bottom, body scrolls independently (design.md §8, 'there is a horizontal line... buttons need to stay on the bottom of the page... only vertical not horizontal scroll allowed')", () => {
  function renderWithFooter(width: number) {
    FakeResizeObserver.nextWidth = width;
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    return render(
      <CodexUiRoot>
        <CodexModalShell
          title="Test Modal"
          onClose={() => {}}
          dialogTestId="test-modal"
          footer={<button data-testid="footer-btn">Submit</button>}
        >
          <p>body</p>
        </CodexModalShell>
      </CodexUiRoot>,
    );
  }

  it("mobile: the card itself doesn't scroll (overflow hidden both axes) — the BODY does, independently", () => {
    renderWithFooter(390);
    const card = screen.getByTestId("test-modal").firstElementChild as HTMLElement;
    expect(card.style.overflowY).toBe("hidden");
    expect(card.style.overflowX).toBe("hidden");
    const body = screen.getByTestId("test-modal-body");
    expect(body.style.overflowY).toBe("auto");
    expect(body.style.overflowX).toBe("hidden");
  });

  it("mobile: the footer button is OUTSIDE the scrolling body — a sibling after it, not nested inside", () => {
    renderWithFooter(390);
    const body = screen.getByTestId("test-modal-body");
    const footerBtn = screen.getByTestId("footer-btn");
    expect(body.contains(footerBtn)).toBe(false);
    expect(footerBtn.parentElement?.previousElementSibling).toBe(body);
  });

  it("desktop: footer renders INSIDE the body div, right after children — byte-identical DOM shape to a plain inline <ModalExecuteRow>", () => {
    renderWithFooter(1024);
    const body = screen.getByTestId("test-modal-body");
    const footerBtn = screen.getByTestId("footer-btn");
    expect(body.contains(footerBtn)).toBe(true);
    const card = screen.getByTestId("test-modal").firstElementChild as HTMLElement;
    expect(card.style.overflowY).toBe("auto");
  });

  it("mobile with NO footer supplied: unaffected — card still scrolls as a whole, exactly as before this prop existed", () => {
    FakeResizeObserver.nextWidth = 390;
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    render(
      <CodexUiRoot>
        <CodexModalShell title="Test Modal" onClose={() => {}} dialogTestId="test-modal">
          <p>body</p>
        </CodexModalShell>
      </CodexUiRoot>,
    );
    const card = screen.getByTestId("test-modal").firstElementChild as HTMLElement;
    expect(card.style.overflowY).toBe("auto");
  });
});

describe("codex-ouronet CodexModalShell — mobile: topBar pinned above the scrolling body (design.md §8, the 'further optimize round 6' — owner correction: 'the button must stay fixed at the top, only the entries scroll')", () => {
  function renderWithTopBar(width: number) {
    FakeResizeObserver.nextWidth = width;
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    return render(
      <CodexUiRoot>
        <CodexModalShell
          title="Test Modal"
          onClose={() => {}}
          dialogTestId="test-modal"
          topBar={<button data-testid="topbar-btn">Switch</button>}
        >
          <p>body</p>
        </CodexModalShell>
      </CodexUiRoot>,
    );
  }

  it("mobile: the topBar button is OUTSIDE the scrolling body — a sibling BEFORE it", () => {
    renderWithTopBar(390);
    const body = screen.getByTestId("test-modal-body");
    const topBarBtn = screen.getByTestId("topbar-btn");
    expect(body.contains(topBarBtn)).toBe(false);
    expect(topBarBtn.parentElement?.nextElementSibling).toBe(body);
  });

  it("mobile: the card itself doesn't scroll — the body does, independently", () => {
    renderWithTopBar(390);
    const card = screen.getByTestId("test-modal").firstElementChild as HTMLElement;
    expect(card.style.overflowY).toBe("hidden");
    const body = screen.getByTestId("test-modal-body");
    expect(body.style.overflowY).toBe("auto");
  });

  it("desktop: topBar renders INSIDE the body div, right BEFORE children", () => {
    renderWithTopBar(1024);
    const body = screen.getByTestId("test-modal-body");
    const topBarBtn = screen.getByTestId("topbar-btn");
    expect(body.contains(topBarBtn)).toBe(true);
    const card = screen.getByTestId("test-modal").firstElementChild as HTMLElement;
    expect(card.style.overflowY).toBe("auto");
  });

  it("topBar and footer can both be supplied at once — one pinned above, one below, body scrolls between them", () => {
    FakeResizeObserver.nextWidth = 390;
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    render(
      <CodexUiRoot>
        <CodexModalShell
          title="Test Modal"
          onClose={() => {}}
          dialogTestId="test-modal"
          topBar={<button data-testid="topbar-btn">Switch</button>}
          footer={<button data-testid="footer-btn">Submit</button>}
        >
          <p>body</p>
        </CodexModalShell>
      </CodexUiRoot>,
    );
    const body = screen.getByTestId("test-modal-body");
    expect(body.contains(screen.getByTestId("topbar-btn"))).toBe(false);
    expect(body.contains(screen.getByTestId("footer-btn"))).toBe(false);
  });
});

describe("CodexModalShell — splitOnDesktop (wizard-page2-and-dashboard-fixes, issue 3: 'the title with next prev buttons, as well as the Settle Dashboard Move. They have to be fixed, non movable.')", () => {
  // Owner's own repro was on a desktop-width window — `footerSplit`
  // (the fixed-header/scrolling-body split topBar/footer/fillBody
  // already enable) was previously MOBILE-ONLY, so a desktop caller's
  // header scrolled away together with its body no matter what. This
  // new, opt-in prop (default `false`, every EXISTING caller untouched)
  // lets a caller request the SAME split on desktop too.
  function renderWithTopBarDesktop(splitOnDesktop?: boolean) {
    return render(
      <CodexModalShell
        title="Test Modal"
        onClose={() => {}}
        dialogTestId="test-modal"
        topBar={<button data-testid="topbar-btn">Switch</button>}
        splitOnDesktop={splitOnDesktop}
      >
        <p>body</p>
      </CodexModalShell>,
    );
  }

  it("desktop + splitOnDesktop: topBar renders OUTSIDE the scrolling body — a sibling BEFORE it, same as the mobile split", () => {
    renderWithTopBarDesktop(true);
    const body = screen.getByTestId("test-modal-body");
    const topBarBtn = screen.getByTestId("topbar-btn");
    expect(body.contains(topBarBtn)).toBe(false);
    expect(topBarBtn.parentElement?.nextElementSibling).toBe(body);
  });

  it("desktop + splitOnDesktop: the card itself doesn't scroll (overflow hidden) — the body does, independently, with a bounded flex height", () => {
    renderWithTopBarDesktop(true);
    const card = screen.getByTestId("test-modal").firstElementChild as HTMLElement;
    expect(card.style.overflowY).toBe("hidden");
    expect(card.style.display).toBe("flex");
    expect(card.style.flexDirection).toBe("column");
    const body = screen.getByTestId("test-modal-body");
    expect(body.style.overflowY).toBe("auto");
    expect(body.style.flex).toBe("1 1 0%");
  });

  it("desktop + splitOnDesktop: the card still keeps its normal capped width — not a mobile full-bleed sheet", () => {
    renderWithTopBarDesktop(true);
    const card = screen.getByTestId("test-modal").firstElementChild as HTMLElement;
    expect(card.style.maxWidth).not.toBe("none");
  });

  it("desktop WITHOUT splitOnDesktop (every existing caller, default omitted): topBar still renders INSIDE the body — byte-identical to before this prop existed", () => {
    renderWithTopBarDesktop(undefined);
    const body = screen.getByTestId("test-modal-body");
    const topBarBtn = screen.getByTestId("topbar-btn");
    expect(body.contains(topBarBtn)).toBe(true);
    const card = screen.getByTestId("test-modal").firstElementChild as HTMLElement;
    expect(card.style.overflowY).toBe("auto");
  });
});

describe("CodexModalShell — zIndex override (mirrors codex-ui's own copy; owner-reported bug: a signed action on a locked codex hung forever on 'Processing…' because the password prompt opened invisibly behind an already-open ZbomModalFrame)", () => {
  it("defaults to 9999 when omitted — every existing caller stays byte-identical", () => {
    FakeResizeObserver.nextWidth = 1920;
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    render(
      <CodexUiRoot>
        <CodexModalShell title="Test Modal" onClose={() => {}}>
          <p>body</p>
        </CodexModalShell>
      </CodexUiRoot>,
    );
    expect(screen.getByRole("dialog").style.zIndex).toBe("9999");
  });

  it("a caller can override it to render above ZbomModalFrame's own z-index (10050)", () => {
    FakeResizeObserver.nextWidth = 1920;
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    render(
      <CodexUiRoot>
        <CodexModalShell title="Elevated" onClose={() => {}} zIndex={2147483647}>
          <p>body</p>
        </CodexModalShell>
      </CodexUiRoot>,
    );
    const z = Number(screen.getByRole("dialog").style.zIndex);
    expect(z).toBeGreaterThan(10050);
  });
});

describe("CodexModalShell — headerExtra (wizard-seed-dashboard-refinements)", () => {
  it("renders headerExtra inside the title bar, as a sibling of the title block", () => {
    render(
      <CodexModalShell
        title="T"
        onClose={() => {}}
        headerExtra={<button data-testid="extra-btn">X</button>}
      >
        body
      </CodexModalShell>,
    );
    const extra = screen.getByTestId("extra-btn");
    expect(extra).toBeTruthy();
    // Sibling of the title's own flex:1 block, not inside `children`.
    expect(screen.getByText("T").closest("div")?.parentElement?.contains(extra)).toBe(true);
    expect(screen.getByText("body").contains(extra)).toBe(false);
  });

  it("renders no extra node, and the title bar's own children are unaffected, when headerExtra is omitted", () => {
    render(<CodexModalShell title="T" onClose={() => {}}>body</CodexModalShell>);
    expect(screen.queryByTestId("extra-btn")).toBeNull();
    expect(screen.getByText("T")).toBeTruthy();
    expect(screen.getByLabelText("Close")).toBeTruthy();
  });

  it("applies the themed-scrollbar class to both the outer card and the body element", () => {
    render(
      <CodexModalShell title="T" onClose={() => {}} dialogTestId="shell">
        body
      </CodexModalShell>,
    );
    const card = screen.getByRole("dialog").firstElementChild as HTMLElement;
    const body = screen.getByTestId("shell-body");
    expect(card.className).toContain("codex-modal-shell-scroll");
    expect(body.className).toContain("codex-modal-shell-scroll");
  });
});

describe("CodexModalShell — sidebar (wizard-keyset-scale-and-sidebar, design.md §F: 'the card becomes a two-column flex row below the title bar')", () => {
  it("desktop: renders a left sidebar column (fixed width, own scroll, right border) beside the existing title-bar/topBar/body/footer column", () => {
    render(
      <CodexModalShell
        title="Test Modal"
        onClose={() => {}}
        dialogTestId="test-modal"
        sidebar={<nav data-testid="sidebar-nav">Nav</nav>}
      >
        <p>body</p>
      </CodexModalShell>,
    );
    const nav = screen.getByTestId("sidebar-nav");
    const leftColumn = nav.parentElement as HTMLElement;
    expect(leftColumn.style.width).toBe("260px");
    expect(leftColumn.style.flexShrink).toBe("0");
    expect(leftColumn.style.overflowY).toBe("auto");
    expect(leftColumn.style.borderRight).toBe("1px solid rgb(38, 38, 38)");
    // Owner (live testing, `wizard-keyset-scale-and-sidebar` follow-up):
    // "the left settle side of the popup have the same separators towards
    // the margin as the right side has... the rectangle is flush to its
    // area." The right column's own scrolling body always gets
    // `padding: 20` — this column must match it, not sit flush.
    expect(leftColumn.style.padding).toBe("20px");

    const row = leftColumn.parentElement as HTMLElement;
    expect(row.style.display).toBe("flex");
    expect(row.children[0]).toBe(leftColumn);

    // The right column is the SAME structure the body test id already
    // targets — just nested one level deeper, as a sibling of the
    // sidebar column instead of the title bar.
    const body = screen.getByTestId("test-modal-body");
    const rightColumn = row.children[1] as HTMLElement;
    expect(rightColumn.contains(body)).toBe(true);
  });

  it("mobile: sidebar renders stacked inside the fixed region, immediately before topBar — not as a column", () => {
    FakeResizeObserver.nextWidth = 390;
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    render(
      <CodexUiRoot>
        <CodexModalShell
          title="Test Modal"
          onClose={() => {}}
          dialogTestId="test-modal"
          sidebar={<nav data-testid="sidebar-nav">Nav</nav>}
          topBar={<button data-testid="topbar-btn">Switch</button>}
        >
          <p>body</p>
        </CodexModalShell>
      </CodexUiRoot>,
    );
    const nav = screen.getByTestId("sidebar-nav");
    const body = screen.getByTestId("test-modal-body");
    expect(body.contains(nav)).toBe(false);

    const topBarBtn = screen.getByTestId("topbar-btn");
    // sidebar's own fixed block is the immediate previous sibling of
    // topBar's own fixed block — stacked above it, in the same region.
    expect(nav.parentElement?.nextElementSibling).toBe(topBarBtn.parentElement);
  });

  it("sidebar omitted (every existing caller): no new wrapper element inserted — byte-identical to before this prop existed", () => {
    render(
      <CodexModalShell
        title="Test Modal"
        onClose={() => {}}
        dialogTestId="test-modal"
        topBar={<button data-testid="topbar-btn">Switch</button>}
      >
        <p>body</p>
      </CodexModalShell>,
    );
    const body = screen.getByTestId("test-modal-body");
    const topBarBtn = screen.getByTestId("topbar-btn");
    // Desktop without splitOnDesktop: topBar still renders INSIDE body.
    expect(body.contains(topBarBtn)).toBe(true);
    // The card's own direct children are exactly the title bar, then the
    // body div itself — no sidebar row/column wraps it.
    const card = screen.getByTestId("test-modal").firstElementChild as HTMLElement;
    expect(card.children.length).toBe(2);
    expect(card.children[1]).toBe(body);
  });

  it("sidebarWidth overrides the left column's inline width (defaults to 260px otherwise)", () => {
    render(
      <CodexModalShell
        title="Test Modal"
        onClose={() => {}}
        dialogTestId="test-modal"
        sidebar={<nav data-testid="sidebar-nav">Nav</nav>}
        sidebarWidth={340}
      >
        <p>body</p>
      </CodexModalShell>,
    );
    const nav = screen.getByTestId("sidebar-nav");
    expect((nav.parentElement as HTMLElement).style.width).toBe("340px");
  });
});
