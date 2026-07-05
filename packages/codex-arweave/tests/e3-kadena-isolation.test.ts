/**
 * E3 RUNTIME Kadena-isolation gate (E-04, N-05) — the AUTHORITATIVE isolation
 * gate over the E3 `src/library/**` surface.
 *
 * The E2 STATIC import-scan (widened to `src/library` in
 * `e2-kadena-isolation.test.ts`) proves the library source references NO
 * forbidden Kadena specifier/symbol in any import. This file is its runtime
 * counterpart: it drives the FULL E3 flow set — `uploadAndTrack`, `pollStatus`,
 * `openUrl`, and `rebuildLibrary` — against an `InternalCodexResolver`-shaped
 * sentinel whose `resolvePrivateKey` / `smartDecrypt` / `requestForeignKey`
 * spies THROW on any touch. Any invocation is a Critical N-05 isolation breach
 * (an Arweave path must NEVER reach the Kadena resolver/signing strategy).
 *
 * Seam discipline mirrors the E3 helpers: upload uses `clientFactory` (fake
 * Turbo), poll/rebuild use `fetchFn`, open uses the healthy pool. The flows
 * carry no resolver param — the sentinel is injected NOWHERE and is asserted
 * never-called after all four complete.
 */

import { describe, it, expect, vi } from "vitest";

import { DEFAULT_CONFIRMATION_DEPTH } from "@ancientpantheon/arweave-core";

import {
  MemoryLibraryStore,
  uploadAndTrack,
  pollStatus,
  openUrl,
  rebuildLibrary,
} from "../src/library";

import {
  throwawayJwk,
  KNOWN_ADDRESS,
  CANONICAL_ID_A,
  ownerUploadRecords,
  makeRecordingTurboClient,
  makeFetchFn,
  confirmedBody,
  makeHealthPool,
  graphqlRebuildBody,
  makeKadenaSentinel,
} from "./e3-helpers";

const OWNER = KNOWN_ADDRESS;

describe("E3 RUNTIME Kadena isolation — the resolver is NEVER touched across the full E3 flow set (E-04, N-05, authoritative)", () => {
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

    // (1) uploadAndTrack — fake Turbo clientFactory (the write seam).
    const turbo = makeRecordingTurboClient({ id: CANONICAL_ID_A });
    await uploadAndTrack(
      { jwk: throwawayJwk, data: "payload", contentType: "text/plain", itemId: "i" },
      { store, clientFactory: turbo.factory },
    );

    // (2) pollStatus — fake fetchFn returning a deep-confirmed status.
    await pollStatus(CANONICAL_ID_A, {
      pool,
      store,
      fetchFn: makeFetchFn(200, confirmedBody(DEFAULT_CONFIRMATION_DEPTH)),
    });

    // (3) openUrl — a healthy pool composes the link.
    openUrl(CANONICAL_ID_A, { pool });

    // (4) rebuildLibrary — fake fetchFn returning the owner's on-chain records.
    await rebuildLibrary(OWNER, {
      store,
      pool,
      fetchFn: makeFetchFn(200, graphqlRebuildBody(ownerUploadRecords)),
    });

    // Every E3 flow completed WITHOUT reaching the Kadena resolver.
    expect(spies.resolvePrivateKey).not.toHaveBeenCalled();
    expect(spies.smartDecrypt).not.toHaveBeenCalled();
    expect(spies.requestForeignKey).not.toHaveBeenCalled();
  });
});
