// Minimal browser `crypto` shim for the lazy Arweave/Turbo upload chunk.
//
// `@dha-team/arbundles` (a Turbo transitive dep) statically imports
// `{ createHash } from "crypto"` even in its WEB build. That `createHash` is used
// ONLY inside the Node async-iterator (stream) branches of `deepHash`/`hashStream`;
// the browser path passes `Uint8Array`/arrays and hashes via WebCrypto
// (`getCryptoDriver().hash`), so `createHash` is never actually invoked in the
// browser. Vite still must RESOLVE the static import to bundle the module, and it
// otherwise externalizes `crypto` to an empty stub ("createHash is not exported by
// __vite-browser-external"), failing `vite build`.
//
// This shim supplies a `createHash` export that THROWS if the Node-stream branch is
// ever reached in the browser — the correct fail-loud behavior, since that branch is
// unreachable in a bundled browser context. The `crypto` specifier is aliased onto
// this file in vite.config.ts.
const unavailable = (name: string): never => {
  throw new Error(
    `node:crypto ${name} is unavailable in the browser bundle — the Arweave/Turbo ` +
      "upload path hashes/signs via WebCrypto (getCryptoDriver), so this Node-only " +
      "branch must not be reached in the playground.",
  );
};

// Used only in arbundles' Node async-iterator (stream) hashing branch.
export function createHash(_algorithm: string): never {
  return unavailable("createHash");
}

// Used only in arbundles' Node RSA signing path (browser signs via WebCrypto).
export function createSign(_algorithm: string): never {
  return unavailable("createSign");
}

// arbundles reads `constants.RSA_PKCS1_PSS_PADDING` etc. Supplying an inert empty
// object keeps the static binding valid; the values are read only on the Node path.
export const constants: Record<string, number> = {};

// Turbo's multi-chain signer may legitimately request random bytes (nonces). Back
// it with WebCrypto's `getRandomValues` so it works in the browser rather than
// throwing — a safe, real implementation.
export function randomBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

const cryptoShim = { createHash, createSign, constants, randomBytes };
export default cryptoShim;
