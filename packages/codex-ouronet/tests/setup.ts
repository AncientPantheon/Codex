/**
 * Vitest global setup for the ouronet-codex package.
 *
 * Two package-wide concerns:
 *
 *  1. `asyncUtilTimeout` — Testing Library's default is 1000ms, and this
 *     package's UI tests drive REAL crypto (`smartDecrypt` over PBKDF2-600k).
 *     A single derivation can exceed a second on its own, and when all ~130
 *     test files run in parallel it reliably does. The result was a suite that
 *     failed 2-5 DIFFERENT tests per run with "Unable to find element" —
 *     indistinguishable from real breakage, and it masked genuine bugs for an
 *     entire debugging session. The product code was never at fault; the
 *     deadline was. Set once here rather than per-file: three files had already
 *     grown their own local `configure({ asyncUtilTimeout })` call, and every
 *     file that forgot one stayed a CPU-contention coin flip
 *     (`ui-create-stoa-chain-seed-modal`, `ui-seed-words-tab`).
 *
 *     NB: this raises the CEILING for waiting, not the time any passing test
 *     actually takes — `waitFor` still resolves on the first successful poll.
 *     A genuinely broken expectation costs this timeout before failing, which
 *     is the intended trade: slow honest failures over fast false ones.
 *
 *  2. jsdom does not implement ResizeObserver, which several `./ui` components use
 * to fit/truncate addresses (e.g. OuronetAddressHighlight). Any test that
 * mounts those components — such as expanding an account row — needs this stub.
 */

if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}

import { configure } from "@testing-library/react";

configure({ asyncUtilTimeout: 15000 });
