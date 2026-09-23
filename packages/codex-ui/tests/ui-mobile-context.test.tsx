/**
 * CodexUiRoot's mobile context — container-relative, NOT viewport-relative
 * (docs/work/codex-ui-mobile/design.md §1). `CodexUiRoot` measures ITSELF via
 * `ResizeObserver` and provides the result through React context; `useIsMobile()`
 * reads it with no ref/prop drilling. Deliberately does NOT read
 * `window.innerWidth` / a media query — an embedded CodexUI can be
 * mobile-shaped inside a desktop-width host page (a narrow sidebar panel) and
 * the reverse, so the viewport is never the right signal.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { CodexUiRoot } from "../src/ui/CodexUiRoot";
import { useIsMobile, CODEX_MOBILE_BREAKPOINT } from "../src/ui/mobile/MobileContext";

/** A controllable ResizeObserver stub: `observe()` immediately invokes the
 *  callback with a caller-set width (mirroring native ResizeObserver's own
 *  real behavior of firing once on observe), and exposes `.trigger(width)`
 *  on the LAST constructed instance so a test can simulate a later resize. */
let lastInstance: FakeResizeObserver | undefined;
class FakeResizeObserver {
  callback: ResizeObserverCallback;
  target: Element | null = null;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    lastInstance = this;
  }
  observe(target: Element) {
    this.target = target;
    this.trigger(FakeResizeObserver.nextWidth);
  }
  unobserve() {}
  disconnect() {}
  trigger(width: number) {
    this.callback(
      [{ contentRect: { width } } as unknown as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
  static nextWidth = 1024;
}

function Probe() {
  const isMobile = useIsMobile();
  return <div data-testid="probe">{isMobile ? "mobile" : "desktop"}</div>;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useIsMobile / CodexUiRoot mobile context", () => {
  it("defaults to 'desktop' (false) when used with no CodexUiRoot ancestor at all", () => {
    render(<Probe />);
    expect(screen.getByTestId("probe")).toHaveTextContent("desktop");
  });

  it(`reports mobile when CodexUiRoot's OWN measured width is below the ${CODEX_MOBILE_BREAKPOINT}px breakpoint`, () => {
    FakeResizeObserver.nextWidth = 390; // a phone
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    render(
      <CodexUiRoot>
        <Probe />
      </CodexUiRoot>,
    );
    expect(screen.getByTestId("probe")).toHaveTextContent("mobile");
  });

  it("reports desktop when CodexUiRoot's measured width is at/above the breakpoint", () => {
    FakeResizeObserver.nextWidth = 1920; // a wide desktop
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    render(
      <CodexUiRoot>
        <Probe />
      </CodexUiRoot>,
    );
    expect(screen.getByTestId("probe")).toHaveTextContent("desktop");
  });

  it("re-measures on a later resize (e.g. the host page resizing an embedded CodexUiRoot's container)", () => {
    FakeResizeObserver.nextWidth = 1920;
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    render(
      <CodexUiRoot>
        <Probe />
      </CodexUiRoot>,
    );
    expect(screen.getByTestId("probe")).toHaveTextContent("desktop");

    act(() => {
      lastInstance?.trigger(375); // host narrows the container — no window resize at all
    });
    expect(screen.getByTestId("probe")).toHaveTextContent("mobile");
  });

  it("CodexUiRoot renders position: relative — the anchor absolutely-positioned mobile chrome (modals, risers) needs", () => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const { container } = render(<CodexUiRoot>content</CodexUiRoot>);
    const root = container.querySelector(".codex-ui") as HTMLElement;
    expect(root.style.position).toBe("relative");
  });
});
