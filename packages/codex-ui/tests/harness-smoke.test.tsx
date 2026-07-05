import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// Harness self-check: proves the jsdom vitest config can transform JSX, mount a
// React tree via @testing-library/react, and query the resulting DOM. If a
// duplicate-React regression returns (root 18 vs nested 19), rendering throws a
// null hooks dispatcher here and this test fails loud — guarding the invariant
// the carve waves' real .tsx tests depend on.
describe("codex-ui jsdom harness", () => {
  afterEach(cleanup);

  it("renders a React element into the jsdom document", () => {
    render(<div data-testid="harness-probe">codex-ui harness online</div>);
    expect(screen.getByTestId("harness-probe")).toHaveTextContent(
      "codex-ui harness online",
    );
  });

  it("exposes the ResizeObserver stub the setup file installs", () => {
    expect(typeof globalThis.ResizeObserver).toBe("function");
    const observer = new ResizeObserver(() => {});
    expect(() => observer.observe(document.body)).not.toThrow();
    expect(() => observer.disconnect()).not.toThrow();
  });
});
