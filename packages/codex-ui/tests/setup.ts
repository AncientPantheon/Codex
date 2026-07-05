/**
 * Vitest global setup for the codex-ui package.
 *
 * Registers the jest-dom DOM matchers (`toHaveTextContent`, `toBeInTheDocument`,
 * …) so `.tsx` tests can assert against the rendered tree.
 *
 * jsdom does not implement ResizeObserver, which several interface components
 * use to fit/truncate content (e.g. address highlights). Any test that mounts
 * those components needs this stub.
 */

import "@testing-library/jest-dom/vitest";

if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}
