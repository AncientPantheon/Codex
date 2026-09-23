/**
 * CodexLockControl — the `fullWidth` variant (docs/work/codex-ui-mobile/
 * design.md §8 feedback round): a single, full-width button row instead of
 * the compact inline pill, for Zone 2's mobile empty state. The unlocked
 * countdown folds INTO the same button's label instead of a separate
 * trailing element, so it can never overflow past the row's own edge.
 * Default (`fullWidth` omitted) is byte-identical to the original pill.
 */
import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import { CodexProvider, useCodexStore } from "../src/provider/index.js";
import { CodexLockControl } from "../src/ui/CodexLockControl.js";

import { createCodexStore } from "@ancientpantheon/codex-ouronet/state";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";

function mount(fullWidth: boolean) {
  const adapter = new MemoryCodexAdapter("dev");
  return render(
    <CodexProvider createStore={createCodexStore} adapter={adapter}>
      <CodexLockControl fullWidth={fullWidth} />
    </CodexProvider>,
  );
}

describe("CodexLockControl — locked (a fresh store's default state)", () => {
  it("fullWidth: 'Unlock Codex' is a single width:100% button", () => {
    mount(true);
    const btn = screen.getByRole("button", { name: /unlock codex/i });
    expect(btn.style.width).toBe("100%");
  });

  it("default (no fullWidth): unchanged — no width:100% on the button", () => {
    mount(false);
    const btn = screen.getByRole("button", { name: /unlock codex/i });
    expect(btn.style.width).not.toBe("100%");
  });
});

describe("CodexLockControl — unlocked", () => {
  async function mountUnlocked(fullWidth: boolean) {
    const adapter = new MemoryCodexAdapter("dev");
    function Unlocker() {
      const store = useCodexStore();
      store.getState().actions.authenticate("test-password", 5);
      return <CodexLockControl fullWidth={fullWidth} />;
    }
    render(
      <CodexProvider createStore={createCodexStore} adapter={adapter}>
        <Unlocker />
      </CodexProvider>,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: /lock codex/i })).toBeInTheDocument());
  }

  it("fullWidth: ONE button (width:100%) with the countdown folded into its own label, not a separate sibling element", async () => {
    await mountUnlocked(true);
    const btn = screen.getByRole("button", { name: /lock codex/i });
    expect(btn.style.width).toBe("100%");
    // The wrapper CodexLockControl renders (its own root) is just this ONE
    // button — no adjacent <span> countdown outside it.
    expect(btn.parentElement?.children.length).toBe(1);
    expect(btn).toHaveTextContent(/lock codex.*·.*\d+:\d+/i);
  });

  it("default (no fullWidth): unchanged — button + a SEPARATE trailing countdown span", async () => {
    await mountUnlocked(false);
    const btn = screen.getByRole("button", { name: /^lock codex$/i });
    expect(btn.style.width).not.toBe("100%");
    // The original shape: a wrapper div containing the button AND a
    // separate countdown <span> as a sibling.
    expect(screen.getByText(/unlocked ·/i)).toBeInTheDocument();
  });
});
