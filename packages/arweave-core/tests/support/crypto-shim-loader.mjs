// ESM loader hook reproducing, at the real Node module-loader level, the TWO
// resolutions `apps/codex-playground/vite.config.ts` applies for the real
// (non-mocked) Arweave/Turbo upload path:
//
//   1. `crypto`/`node:crypto` -> `crypto.shim.ts` (the deliberately fail-loud
//      stub supplying ONLY the exports arbundles' WEB build statically
//      imports: `createHash`/`createSign`/`constants`/`randomBytes`).
//   2. the bare `arbundles` specifier -> its own `browser` package-export
//      condition's target (`build/web/esm/webIndex.js`), exactly what Vite's
//      client-build `resolve.conditions` picks and what `bundle.ts`'s plain
//      `import ... from "arbundles"` resolves to in the real app bundle.
//
// `vi.mock`/`vi.importActual` CANNOT reproduce this: Vitest's SSR module
// graph externalizes `node_modules` dependencies (this project's
// `vitest.config.ts` inlines none of them), so a dependency reached via
// `node_modules` is loaded through Node's OWN native resolver/loader —
// completely bypassing Vite's mock virtualization for that module AND its
// whole subgraph (confirmed empirically: neither `vi.mock("crypto", ...)`
// nor `vi.mock("arbundles", ...)`, however constructed, ever intercepted
// arbundles' internal `import { createHash } from "crypto"` in this test
// harness). A real `module.register()` hook operates one level below
// Vitest/Vite entirely, at Node's own loader, so it reproduces the exact
// resolution the shipped app performs.
//
// One extra wrinkle this hook works around: Vitest's own SSR module
// evaluator resolves the bare `arbundles` specifier ITSELF (via its own
// resolver, which — with no `browser` condition — picks the `node` build)
// before Node's loader ever sees a bare specifier; what reaches THIS hook's
// `resolve()` is already the fully-resolved absolute
// `.../arbundles/build/node/esm/...` path. So the redirect below matches on
// that resolved NODE-build path (not the bare specifier) and rewrites it
// onto the corresponding WEB-build file, mirroring Vite's `browser`
// condition for the bare import.
const SHIM_URL = "codex-crypto-shim:virtual";

const NODE_BUILD_MARKER = "/arbundles/build/node/esm/index.js";
const ARBUNDLES_WEB_BUILD_URL = new URL(
  "../../../../node_modules/arbundles/build/web/esm/webIndex.js",
  import.meta.url,
).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "crypto" || specifier === "node:crypto") {
    return { url: SHIM_URL, shortCircuit: true };
  }
  if (specifier.endsWith(NODE_BUILD_MARKER)) {
    return nextResolve(ARBUNDLES_WEB_BUILD_URL, context);
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url === SHIM_URL) {
    const source = `
      const unavailable = (name) => {
        throw new Error(
          \`node:crypto \${name} is unavailable in the browser bundle — the Arweave/Turbo \` +
          "upload path hashes/signs via WebCrypto (getCryptoDriver), so this Node-only " +
          "branch must not be reached in the playground."
        );
      };
      export function createHash(_algorithm) { return unavailable("createHash"); }
      export function createSign(_algorithm) { return unavailable("createSign"); }
      export const constants = {};
      export function randomBytes(size) {
        const bytes = new Uint8Array(size);
        globalThis.crypto.getRandomValues(bytes);
        return bytes;
      }
      export default { createHash, createSign, constants, randomBytes };
    `;
    return { format: "module", source, shortCircuit: true };
  }
  return nextLoad(url, context);
}
