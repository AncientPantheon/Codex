/**
 * Vitest global setup for the ouronet-codex package.
 *
 * jsdom does not implement ResizeObserver, which several `./ui` components use
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
