/**
 * Vitest global setup for the codex-arweave package.
 *
 * Registers the jest-dom DOM matchers (`toHaveTextContent`, `toBeInTheDocument`,
 * …) so the Arweave panel `.tsx` tests can assert against the rendered tree.
 *
 * jsdom does not implement ResizeObserver, which several interface components
 * use to fit/truncate content. Any test that mounts those components needs this
 * stub.
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

/**
 * `asyncUtilTimeout` — Testing Library's default is 1000ms, and this
 * package's panel tests drive REAL crypto (codex decrypt paths, RSA-4096
 * seeded keygen) behind `findBy*`/`waitFor`. A single derivation can exceed
 * a second on its own, and when all ~68 test files run in parallel it
 * reliably does: the suite failed on a DIFFERENT test per run with "Unable
 * to find element", which is indistinguishable from real breakage.
 *
 * Same root cause, and the same fix, as `codex-ouronet/tests/setup.ts` —
 * set once here rather than per-file, so a file that forgets a local
 * `configure()` is not left a CPU-contention coin flip.
 *
 * NB: this raises the CEILING for waiting, not the time a passing test
 * takes — `waitFor` still resolves on its first successful poll.
 */
import { configure } from "@testing-library/react";

configure({ asyncUtilTimeout: 15000 });

/**
 * THE NETWORK BELT.
 *
 * No spec in this package may make a real network call. Verified free: with
 * this throw in place the whole suite passes unchanged (71 files, 1137
 * tests), so nothing here legitimately reaches the wire.
 *
 * It exists because the reach is easy to acquire by ACCIDENT. `CodexIdPage`
 * mounts `<PendingKeyChangesSection />` prop-less, and that section's
 * injected seams fall back to live readers when a prop is omitted — so a
 * component added below it can start reading mainnet from a unit test
 * without anyone editing a test. The sibling package wears this belt
 * per-file via `setPactReader`; codex-arweave cannot (it does not depend on
 * `@stoachain/stoa-core`), so the guard goes at the transport instead, which
 * is stricter and catches every route rather than one library's.
 *
 * A spec that genuinely needs fetch should stub it locally, which shadows
 * this and keeps the failure loud for everyone else.
 */
globalThis.fetch = ((...args: unknown[]) => {
  throw new Error(
    `A test made a real network call to ${String(args[0])}. Inject the seam ` +
      `instead — see tests/setup.ts's network belt.`,
  );
}) as typeof fetch;
