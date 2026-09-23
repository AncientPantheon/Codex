/**
 * CodexModalShell — the mobile full-screen-sheet flip (Pantheonic mobile doc
 * §7: "Modals / signing zones go full-screen on mobile" — ONE shared modal
 * component change flips every transaction modal in the app at once). On a
 * narrow CodexUiRoot, the backdrop switches `position: fixed` (viewport) to
 * `position: absolute` (anchored to CodexUiRoot, per design.md §1 — an
 * embedded CodexUI must never let a modal escape its host's rectangle), and
 * the card becomes a full-bleed, content-height sheet instead of a centered,
 * fixed-max-width card.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { CodexUiRoot } from "../src/ui/CodexUiRoot";
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
      <CodexModalShell title="Test Modal" onClose={() => {}}>
        <p>body</p>
      </CodexModalShell>
    </CodexUiRoot>,
  );
}

describe("CodexModalShell — mobile full-screen sheet", () => {
  it("desktop (wide CodexUiRoot): stays a centered, fixed-position, capped-width card", () => {
    renderModal(1920);
    const dialog = screen.getByRole("dialog");
    expect(dialog.style.position).toBe("fixed");
    const card = dialog.firstElementChild as HTMLElement;
    expect(card.style.maxWidth).not.toBe("none");
    expect(card.style.borderRadius).not.toBe("0px");
  });

  it("mobile (narrow CodexUiRoot): the backdrop is position:absolute (anchored to CodexUiRoot, never escapes to the viewport)", () => {
    renderModal(390);
    const dialog = screen.getByRole("dialog");
    expect(dialog.style.position).toBe("absolute");
  });

  it("mobile: the card is a full-bleed sheet — no max-width cap, no rounded corners, fills the height", () => {
    renderModal(390);
    const dialog = screen.getByRole("dialog");
    const card = dialog.firstElementChild as HTMLElement;
    expect(card.style.maxWidth).toBe("none");
    expect(card.style.borderRadius).toBe("0px");
    expect(card.style.height).toBe("100%");
  });

  it("mobile: still renders the title, close button, and children — a full-screen sheet is still the same modal, not a different one", () => {
    renderModal(390);
    expect(screen.getByText("Test Modal")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    expect(screen.getByText("body")).toBeInTheDocument();
  });
});
