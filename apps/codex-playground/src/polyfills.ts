// Browser polyfill for the Node.js `Buffer` global.
//
// ~21 files across the @stoachain triplet (kadena-stoic-legacy's hd-wallet
// signing + cryptography-utils, stoa-core) reference `Buffer` as a global.
// The only polyfill shipped in the dependency tree
// (kadena-stoic-legacy/dist/hd-wallet/browser-polyfill.cjs) is unreachable
// via the package `exports` map and gets tree-shaken. The Vite dev prebundler
// happens to evaluate it, but the signing/decrypt paths (getKeyPairByPublicKey)
// still throw "Buffer is not defined" without an explicit global.
//
// Verbatim from OuronetUI's src/polyfills.ts. Must be the FIRST import in
// main.tsx so it runs before any @stoachain import.
import { Buffer } from "buffer";

globalThis.Buffer = globalThis.Buffer ?? Buffer;
