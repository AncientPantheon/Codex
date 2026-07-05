/**
 * Phase 13 — `./ui` foundation specs.
 *
 * Covers the `<CodexUiRoot>` token-scope wrapper exported from
 * `@ancientpantheon/codex-ouronet/ui`, plus a build-artifact assertion that the
 * `dist/ui.css` token sheet is emitted and carries the `--codex-*` contract.
 *
 * These tests pin the consumer-facing contract Phases 14/15 build against:
 * importing `@ancientpantheon/codex-ouronet/ui` must resolve to the barrel, and the
 * wrapper must apply the `.codex-ui` scope class so the token defaults take
 * effect at the consumer boundary.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { render } from "@testing-library/react";

import { CodexUiRoot } from "@ancientpantheon/codex-ouronet/ui";

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
    const { container } = render(
      <CodexUiRoot className="my-shell">x</CodexUiRoot>,
    );
    const root = container.firstChild as HTMLElement;
    // Consumer overrides must never drop the token scope.
    expect(root.classList.contains("codex-ui")).toBe(true);
    expect(root.classList.contains("my-shell")).toBe(true);
  });

  it("forwards a consumer style object so per-instance token overrides are possible", () => {
    const { container } = render(
      <CodexUiRoot style={{ ["--codex-accent" as string]: "#ff0000" }}>
        x
      </CodexUiRoot>,
    );
    const root = container.firstChild as HTMLElement;
    expect(root.style.getPropertyValue("--codex-accent")).toBe("#ff0000");
  });
});

describe("dist/ui.css build artifact", () => {
  const distUiCss = resolve(__dirname, "../dist/ui.css");

  it("is emitted by the build so consumers can import @ancientpantheon/codex-ouronet/ui.css", () => {
    // Fails until the build copy-step lands; run `npm run build` before this.
    expect(existsSync(distUiCss)).toBe(true);
  });

  it("carries the --codex-* token contract (the whole point of the sheet)", () => {
    const css = readFileSync(distUiCss, "utf8");
    // Spot-check the load-bearing tokens components in Phase 14/15 reference.
    expect(css).toContain("--codex-bg");
    expect(css).toContain("--codex-surface");
    expect(css).toContain("--codex-accent");
    expect(css).toContain("--codex-text");
    // The scope class + :root fallback are both required so a consumer can
    // apply tokens at any boundary OR globally.
    expect(css).toContain(".codex-ui");
    expect(css).toContain(":root");
  });
});
