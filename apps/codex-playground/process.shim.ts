// Minimal browser `process` polyfill for the Arweave/Turbo path.
//
// D6 was Kadena-only and never bundled `arweave`/`@ardrive/turbo-sdk`. Those
// Node-oriented libraries reach for a bare `process` global (e.g. `process.env`,
// `process.browser`, `process.nextTick`) that Vite does NOT auto-supply for the
// browser bundle. Rather than pull the full `process` npm package (an extra
// dependency the offline install would have to fetch), this hand-rolled shim
// supplies the handful of members those libs actually touch. The `process`
// specifier is aliased onto this file in vite.config.ts so any bare `process`
// reference in the real-toggle Arweave path resolves here instead of crashing
// the production bundle with "process is not defined".
const processShim = {
  env: {} as Record<string, string | undefined>,
  browser: true,
  version: "",
  versions: {} as Record<string, string>,
  platform: "browser",
  nextTick: (cb: (...args: unknown[]) => void, ...args: unknown[]): void => {
    queueMicrotask(() => cb(...args));
  },
};

export default processShim;
