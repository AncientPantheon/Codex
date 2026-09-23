/**
 * The Controls registry (docs/work/codex-ui-mobile/design.md §5) — a
 * source-keyed registry of ghosted-button groups, deduped by content
 * signature so re-registering the same shape doesn't storm re-renders.
 * Ported near-verbatim from OuronetUI's `context/controls-context.tsx`.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import {
  ControlsProvider,
  useControls,
  useControlsOptional,
  useRegisterControls,
  useRegisterControlsOptional,
} from "../src/ui/mobile/controls-context";

afterEach(() => cleanup());

function Probe() {
  const { count, groups } = useControls();
  return (
    <div>
      <span data-testid="count">{count}</span>
      <span data-testid="groups">{groups.map((g) => g.source).join(",")}</span>
    </div>
  );
}

function Registrar({ active, n }: { active: boolean; n: number }) {
  useRegisterControls(
    "test-source",
    "Test Group",
    active,
    Array.from({ length: n }, (_, i) => ({ id: `item-${i}`, label: `Item ${i}`, onClick: () => {} })),
  );
  return null;
}

describe("Controls registry — useControls() with no ancestor ControlsProvider", () => {
  it("throws — the hook requires a <ControlsProvider> ancestor", () => {
    // Swallow the expected React error-boundary console noise for this one assertion.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/ControlsProvider/);
    spy.mockRestore();
  });
});

describe("Controls registry — register/unregister/count", () => {
  it("starts empty", () => {
    render(
      <ControlsProvider>
        <Probe />
      </ControlsProvider>,
    );
    expect(screen.getByTestId("count").textContent).toBe("0");
  });

  it("registers a group's items while active, and the count reflects them", () => {
    render(
      <ControlsProvider>
        <Registrar active n={3} />
        <Probe />
      </ControlsProvider>,
    );
    expect(screen.getByTestId("count").textContent).toBe("3");
    expect(screen.getByTestId("groups").textContent).toBe("test-source");
  });

  it("unregisters when active flips false — count drops back to zero", () => {
    const { rerender } = render(
      <ControlsProvider>
        <Registrar active n={2} />
        <Probe />
      </ControlsProvider>,
    );
    expect(screen.getByTestId("count").textContent).toBe("2");

    rerender(
      <ControlsProvider>
        <Registrar active={false} n={2} />
        <Probe />
      </ControlsProvider>,
    );
    expect(screen.getByTestId("count").textContent).toBe("0");
  });

  it("empty items array is treated as unregistered — never shows a zero-item group", () => {
    render(
      <ControlsProvider>
        <Registrar active n={0} />
        <Probe />
      </ControlsProvider>,
    );
    expect(screen.getByTestId("count").textContent).toBe("0");
    expect(screen.getByTestId("groups").textContent).toBe("");
  });
});

describe("Controls registry — open/setOpen", () => {
  function OpenProbe() {
    const { open, setOpen } = useControls();
    return (
      <div>
        <span data-testid="open">{String(open)}</span>
        <button type="button" onClick={() => setOpen(true)}>
          open
        </button>
      </div>
    );
  }

  it("defaults closed, and setOpen(true) opens it", () => {
    render(
      <ControlsProvider>
        <OpenProbe />
      </ControlsProvider>,
    );
    expect(screen.getByTestId("open").textContent).toBe("false");
    act(() => screen.getByRole("button", { name: "open" }).click());
    expect(screen.getByTestId("open").textContent).toBe("true");
  });
});

describe("useControlsOptional() — the safe (non-throwing) variant", () => {
  function OptionalProbe() {
    const ctx = useControlsOptional();
    return <span data-testid="ctx">{ctx === null ? "null" : "present"}</span>;
  }

  it("returns null with no ancestor ControlsProvider — never throws", () => {
    expect(() => render(<OptionalProbe />)).not.toThrow();
    expect(screen.getByTestId("ctx").textContent).toBe("null");
  });

  it("returns the live context when a ControlsProvider IS an ancestor", () => {
    render(
      <ControlsProvider>
        <OptionalProbe />
      </ControlsProvider>,
    );
    expect(screen.getByTestId("ctx").textContent).toBe("present");
  });
});

describe("useRegisterControlsOptional() — a graceful no-op without a Provider", () => {
  function OptionalRegistrar({ n }: { n: number }) {
    const registered = useRegisterControlsOptional(
      "opt-source",
      "Opt Group",
      true,
      Array.from({ length: n }, (_, i) => ({ id: `item-${i}`, label: `Item ${i}`, onClick: () => {} })),
    );
    return <span data-testid="registered">{String(registered)}</span>;
  }

  it("never throws with no ancestor ControlsProvider, and reports registered=false", () => {
    expect(() => render(<OptionalRegistrar n={2} />)).not.toThrow();
    expect(screen.getByTestId("registered").textContent).toBe("false");
  });

  it("actually registers into the count when a ControlsProvider IS present, and reports registered=true", () => {
    render(
      <ControlsProvider>
        <OptionalRegistrar n={2} />
        <Probe />
      </ControlsProvider>,
    );
    expect(screen.getByTestId("registered").textContent).toBe("true");
    expect(screen.getByTestId("count").textContent).toBe("2");
  });
});
