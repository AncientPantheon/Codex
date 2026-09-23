/**
 * ZbomModalFrame — mobile full-screen + z-index fix (owner correction,
 * `OuronetAccountsTab`'s mobile full-screen account-expand round): "clicking
 * the activate button, brings up the zbom. this also itself needs be full
 * screen instead of popin up like its on desktop, because it appears
 * somehow in the background... instead it has to be opened on its own full
 * screen with close button. closing brings the user to the previous full
 * screen." Two things this locks in:
 *   1. Layering: the frame's own overlay now sits at a z-index (10050)
 *      comfortably above `CodexModalShell`'s mobile full-screen popup
 *      (9999) — a ZBOM modal opened from inside one of those (e.g.
 *      `AccountRow`'s account-detail view) must always render ON TOP of it,
 *      never behind it.
 *   2. Layout: mobile goes full-bleed (no rounded corners, no margin, fills
 *      the viewport) instead of the desktop-style narrow centered card,
 *      same "modals go full-screen on mobile" treatment `CodexModalShell`
 *      already gives every other popup in this app.
 * Desktop stays byte-identical to the original card (this suite's default,
 * `useIsMobile()` with no `<CodexUiRoot>` ancestor).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { CodexUiRoot } from "@ancientpantheon/codex-ui/ui";
import { ZbomModalFrame } from "../src/zbom/ui/ZbomModalFrame";

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

function renderFrame(width: number, onClose: () => void = () => {}) {
  FakeResizeObserver.nextWidth = width;
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  return render(
    <CodexUiRoot>
      <ZbomModalFrame onClose={onClose}>
        <p>zbom body</p>
      </ZbomModalFrame>
    </CodexUiRoot>,
  );
}

describe("ZbomModalFrame — z-index always above CodexModalShell's mobile full-screen popup", () => {
  it("overlay z-index (10050) is numerically above CodexModalShell's mobile popup z-index (9999), on any platform", () => {
    renderFrame(1024);
    const overlay = screen.getByTestId("zbom-modal-frame");
    expect(Number(overlay.style.zIndex)).toBeGreaterThan(9999);
  });

  it("mobile: still z-index 10050 (unchanged from desktop) — the stacking fix isn't platform-conditional", () => {
    renderFrame(390);
    const overlay = screen.getByTestId("zbom-modal-frame");
    expect(Number(overlay.style.zIndex)).toBeGreaterThan(9999);
  });
});

describe("ZbomModalFrame — mobile goes full-screen, desktop stays a centered card", () => {
  it("desktop (wide CodexUiRoot): unchanged — capped width, rounded corners, top margin", () => {
    renderFrame(1024);
    const overlay = screen.getByTestId("zbom-modal-frame");
    const card = overlay.firstElementChild as HTMLElement;
    expect(card.style.width).toBe("600px");
    expect(card.style.borderRadius).toBe("16px");
    expect(card.style.marginTop).toBe("96px");
  });

  it("mobile (narrow CodexUiRoot): full-bleed — no cap, no rounded corners, no margin", () => {
    renderFrame(390);
    const overlay = screen.getByTestId("zbom-modal-frame");
    const card = overlay.firstElementChild as HTMLElement;
    expect(card.style.width).toBe("100%");
    expect(card.style.maxWidth).toBe("none");
    expect(card.style.borderRadius).toBe("0px");
    expect(card.style.marginTop).toBe("0px");
  });

  it("with NO CodexUiRoot ancestor (every pre-existing ZBOM modal test in this package): stays desktop — the safe default", () => {
    render(
      <ZbomModalFrame onClose={() => {}}>
        <p>zbom body</p>
      </ZbomModalFrame>,
    );
    const overlay = screen.getByTestId("zbom-modal-frame");
    const card = overlay.firstElementChild as HTMLElement;
    expect(card.style.width).toBe("600px");
    expect(card.style.borderRadius).toBe("16px");
  });
});

describe("ZbomModalFrame — close behavior unchanged (close-button-only, no overlay/Esc close)", () => {
  it("the close button still fires onClose, on mobile too", () => {
    const onClose = vi.fn();
    renderFrame(390, onClose);
    fireEvent.click(screen.getByTestId("zbom-modal-frame-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clicking the overlay backdrop does NOT close it (unchanged — matches every zbom modal's explicit shouldCloseOnOverlayClick={false})", () => {
    const onClose = vi.fn();
    renderFrame(390, onClose);
    fireEvent.click(screen.getByTestId("zbom-modal-frame"));
    expect(onClose).not.toHaveBeenCalled();
  });
});
