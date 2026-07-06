// Minimal browser `stream` shim for the lazy Arweave/Turbo upload chunk.
//
// `@dha-team/arbundles` (a Turbo transitive dep) statically imports
// `{ PassThrough, Transform } from "stream"` in its WEB build. These Node stream
// classes are used ONLY on the Node upload/streaming path; the browser Turbo client
// uploads via `fetch`/WebCrypto and never constructs them. Vite externalizes
// `stream` to an empty stub, so the named `PassThrough`/`Transform` bindings are
// missing and `vite build` fails. This shim supplies inert classes that throw if
// ever instantiated in the browser (the correct fail-loud behavior — that path is
// unreachable in a bundled browser context). The `stream` specifier is aliased onto
// this file in vite.config.ts.
class UnavailableStream {
  constructor() {
    throw new Error(
      "node:stream is unavailable in the browser bundle — the Arweave/Turbo upload " +
        "path uploads via fetch/WebCrypto, so this Node-stream branch must not be " +
        "reached in the playground.",
    );
  }
}

export class PassThrough extends UnavailableStream {}
export class Transform extends UnavailableStream {}
export class Readable extends UnavailableStream {}
export class Writable extends UnavailableStream {}
export class Duplex extends UnavailableStream {}

const streamShim = { PassThrough, Transform, Readable, Writable, Duplex };
export default streamShim;
