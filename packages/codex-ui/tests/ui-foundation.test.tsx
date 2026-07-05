/**
 * Ported foundation spec — `<CodexUiRoot>` token-scope wrapper, now sourced from
 * codex-ui's local `src/ui/CodexUiRoot.tsx` (relocated verbatim from
 * codex-ouronet in the D5 carve). This is the behaviour-preservation proof for
 * the single fully-standalone MOVE leaf: it needs no provider/hook/adapter, so
 * it GREENs under the jsdom harness at Wave 2. (The provider/hook-driven ported
 * tests re-home after T9.4/T9.5 land the hooks + provider.)
 */

import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

import { CodexUiRoot } from "../src/ui/CodexUiRoot.js";

afterEach(cleanup);

describe("CodexUiRoot", () => {
  it("renders its children so a consumer can wrap arbitrary UI in the token scope", () => {
    const { getByText } = render(<CodexUiRoot>Hello Codex</CodexUiRoot>);
    expect(getByText("Hello Codex")).toBeTruthy();
  });

  it("applies the .codex-ui scope class so the --codex-* token defaults bind at the wrapper boundary", () => {
    const { container } = render(<CodexUiRoot>x</CodexUiRoot>);
    const root = container.firstChild as HTMLElement;
    // The scope class is the mechanism that activates tokens.css; without it a
    // consumer's inline `var(--codex-*)` references would fall back to nothing.
    expect(root.classList.contains("codex-ui")).toBe(true);
  });

  it("merges a consumer className alongside the scope class instead of replacing it", () => {
    const { container } = render(<CodexUiRoot className="my-shell">x</CodexUiRoot>);
    const root = container.firstChild as HTMLElement;
    // Consumer overrides must never drop the token scope.
    expect(root.classList.contains("codex-ui")).toBe(true);
    expect(root.classList.contains("my-shell")).toBe(true);
  });

  it("forwards a consumer style object so per-instance token overrides are possible", () => {
    const { container } = render(
      <CodexUiRoot style={{ ["--codex-accent" as string]: "#ff0000" }}>x</CodexUiRoot>,
    );
    const root = container.firstChild as HTMLElement;
    expect(root.style.getPropertyValue("--codex-accent")).toBe("#ff0000");
  });
});
