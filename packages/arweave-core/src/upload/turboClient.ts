/**
 * The DEFAULT Turbo upload client factory — the ONLY place `@ardrive/turbo-sdk`
 * is imported at runtime in this module.
 *
 * BROWSER STORY (verified turbo-sdk 1.42.0 packaging facts): the package has no
 * `browser` field and its ROOT export is the NODE build (imports `fs`, `crypto`,
 * `node:stream`). A browser bundler resolving the root specifier gets the Node
 * build. Because ESM static imports are resolved for the WHOLE module graph
 * regardless of runtime branches, injecting a web-built client through
 * `uploadData`'s seam selects the runtime client but does NOT remove the Node
 * build from the bundle graph. Therefore:
 *   - browser consumers MUST alias `@ardrive/turbo-sdk` → `@ardrive/turbo-sdk/web`
 *     in their bundler config (the alias rewrites this file's import too); AND
 *   - `uploadData` imports THIS file only via a LAZY dynamic `import()`, executed
 *     solely when no client is injected, so a code-splitting bundler can drop it
 *     for consumers that always inject a client.
 *
 * The default targets the Turbo upload SERVICE (`upload.ardrive.io`) — a bundler
 * service, NOT an Arweave gateway. Uploads therefore do NOT flow through the
 * Phase 2 gateway pool; this is deliberate and documented (a bundler service is
 * not a gateway, so this is not a missed pool integration).
 */

import { TurboFactory } from "@ardrive/turbo-sdk";
import type { ArweaveJwk } from "../keys/types.js";
import type { TurboUploadClient, TurboUploadClientFactory } from "./types.js";

/**
 * Builds a real authenticated Turbo client from the jwk and adapts it to the
 * narrow {@link TurboUploadClient} seam. The 9-field `ArweaveJwk` is assignment-
 * compatible with turbo's `ArweaveJWK`/`JWKInterface`, so it is passed directly
 * as `privateKey` with `token: "arweave"` (the upload-service default token).
 */
export const defaultTurboClientFactory: TurboUploadClientFactory = (
  jwk: ArweaveJwk,
): TurboUploadClient => {
  const client = TurboFactory.authenticated({ privateKey: jwk, token: "arweave" });
  return {
    upload: (p) => client.upload(p),
  };
};
