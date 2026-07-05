/**
 * Vitest global setup for the codex-playground app harness.
 *
 * Adds the @testing-library/jest-dom matchers, and stubs ResizeObserver — jsdom
 * does not implement it and the codex-ouronet shell components (e.g. address
 * fit/truncate) construct one on mount, so any test that renders the shell needs it.
 */
import "@testing-library/jest-dom";

if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}
