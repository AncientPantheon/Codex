// @vitest-environment node
/**
 * E3 RUNTIME StoaChain-isolation gate (E-04, N-05) — the AUTHORITATIVE isolation
 * gate over the E3 `src/library/**` surface.
 *
 * `// @vitest-environment node` (mirrors `e3-library-flow.test.ts`'s own FIX-9
 * pragma): `uploadAndTrack` below posts a real string payload through
 * arweave-core `createTransaction`. Under the package's default jsdom/"client"
 * environment, Vite resolves the `arweave` dependency via its `browser`
 * package.json field, whose `createTransaction` is MISSING the node build's
 * `typeof data === "string"` → `stringToBuffer` conversion — a plain-string
 * upload payload throws purely as an artifact of the test environment, not a
 * real code defect. Forcing this file to the `node` environment resolves
 * `arweave`'s `main` field instead, matching arweave-core's own test
 * environment.
 *
 * The E2 STATIC import-scan (widened to `src/library` in
 * `e2-kadena-isolation.test.ts`) proves the library source references NO
 * forbidden StoaChain specifier/symbol in any import. This file is its runtime
 * counterpart: it drives the FULL E3 flow set — `uploadAndTrack`, `pollStatus`,
 * `openUrl`, and `rebuildLibrary` — against an `InternalCodexResolver`-shaped
 * sentinel whose `resolvePrivateKey` / `smartDecrypt` / `requestForeignKey`
 * spies THROW on any touch. Any invocation is a Critical N-05 isolation breach
 * (an Arweave path must NEVER reach the StoaChain resolver/signing strategy).
 *
 * Seam discipline mirrors the E3 helpers: upload uses `pool` + an injectable
 * `apiFactory` (the native, non-bundler upload path — `TurboUploadClient`/
 * `clientFactory` no longer exist), poll/rebuild use `fetchFn`, open uses the
 * healthy pool. The flows carry no resolver param — the sentinel is injected
 * NOWHERE and is asserted never-called after all four complete.
 */

import { describe, it, expect, vi } from "vitest";

import { DEFAULT_CONFIRMATION_DEPTH } from "@ancientpantheon/arweave-core";

// Imported from the specific submodules (not the `../src/library` barrel, which
// also re-exports `SqliteLibraryStore` — pulling in `sqliteStore.ts`'s lazy
// `import("node:sqlite")`, a documented pre-existing vite/vitest limitation in
// this exact sandbox — see `e3-library-flow.test.ts`'s own identical comment).
import { MemoryLibraryStore } from "../src/library/memoryStore.js";
import { uploadAndTrack, pollStatus, openUrl } from "../src/library/flow.js";
import { rebuildLibrary } from "../src/library/rebuild.js";

import {
  throwawayJwk,
  KNOWN_ADDRESS,
  ownerUploadRecords,
  makeRecordingUploadApi,
  makeFetchFn,
  confirmedBody,
  makeHealthPool,
  graphqlRebuildBody,
  makeKadenaSentinel,
} from "./e3-helpers";

const OWNER = KNOWN_ADDRESS;

/** A cap comfortably above the recording fake's honest quote (e3-helpers'
 *  `RECORDING_PRICE`) — the fee cap is REQUIRED on every native-upload call. */
const CAP = 1_000_000_000_000n;

describe("E3 RUNTIME StoaChain isolation — the resolver is NEVER touched across the full E3 flow set (E-04, N-05, authoritative)", () => {
  it("uploadAndTrack + pollStatus + openUrl + rebuildLibrary never invoke an InternalCodexResolver-shaped sentinel", async () => {
    // A sentinel shaped like InternalCodexResolver: any invocation throws, so a
    // touch would fail the flow AND trip the never-called assertions below.
    const sentinel = makeKadenaSentinel();
    const spies = {
      resolvePrivateKey: vi.fn(sentinel.resolvePrivateKey),
      smartDecrypt: vi.fn(sentinel.smartDecrypt),
      requestForeignKey: vi.fn(sentinel.requestForeignKey),
    };

    const store = new MemoryLibraryStore();
    const pool = makeHealthPool();

    // (1) uploadAndTrack — fake apiFactory posted through the pool (the
    // native, non-bundler write seam; the id is the real post-sign tx id).
    const recorded = makeRecordingUploadApi();
    const result = await uploadAndTrack(
      {
        jwk: throwawayJwk,
        data: "payload",
        contentType: "text/plain",
        itemId: "i",
        maxRewardWinston: CAP,
        // REQUIRED (T5, `arweave-upload-categories`) — any valid UPLOAD_CATEGORIES value.
        category: "general-other",
      },
      { store, pool, apiFactory: recorded.apiFactory },
    );
    const uploadedId = (result as { id: string }).id;

    // (2) pollStatus — fake fetchFn returning a deep-confirmed status.
    await pollStatus(uploadedId, {
      pool,
      store,
      fetchFn: makeFetchFn(200, confirmedBody(DEFAULT_CONFIRMATION_DEPTH)),
    });

    // (3) openUrl — a healthy pool composes the link.
    openUrl(uploadedId, { pool });

    // (4) rebuildLibrary — fake fetchFn returning the owner's on-chain records.
    await rebuildLibrary(OWNER, {
      store,
      pool,
      fetchFn: makeFetchFn(200, graphqlRebuildBody(ownerUploadRecords)),
    });

    // Every E3 flow completed WITHOUT reaching the StoaChain resolver.
    expect(spies.resolvePrivateKey).not.toHaveBeenCalled();
    expect(spies.smartDecrypt).not.toHaveBeenCalled();
    expect(spies.requestForeignKey).not.toHaveBeenCalled();
  });
});
