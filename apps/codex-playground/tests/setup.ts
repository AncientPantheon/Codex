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

/**
 * `asyncUtilTimeout` — Testing Library's default is 1000ms, and these tests
 * drive REAL crypto (codex decrypt + Stoa Dalos derivation) behind
 * `findBy*`/`waitFor`. A single derivation can exceed a second alone, and
 * under full-suite parallelism it reliably does: the suite failed on a
 * different test per run, indistinguishable from real breakage, while the
 * same test passed 45/45 in isolation.
 *
 * Same root cause and same fix as `codex-ouronet/tests/setup.ts` and
 * `codex-arweave/tests/setup.ts`. Set once here so a file that forgets a
 * local `configure()` is not left a CPU-contention coin flip.
 *
 * NB: this raises the CEILING for waiting, not the time a passing test takes.
 */
import { configure } from "@testing-library/react";

configure({ asyncUtilTimeout: 15000 });
