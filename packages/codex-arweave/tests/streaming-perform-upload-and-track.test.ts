// @vitest-environment node
/**
 * `performUploadAndTrack` — the behavior-preservation proof for the T1
 * (`arweave-streaming-worker-wiring`) refactor that factors everything
 * `uploadAndTrack` currently runs AFTER `resolveEncryptionKey` resolves into
 * a separately-exported function, callable with an ALREADY-RESOLVED key
 * (never a live `revealAccountSecret` callback — that cannot cross the
 * Worker boundary this refactor exists to enable; see `uploadWorker.ts`).
 *
 * `// @vitest-environment node`: mirrors `e3-library-flow.test.ts`'s own
 * pragma for the identical reason (the `arweave` dependency's `browser`
 * package.json field is missing the node build's string→buffer conversion
 * `uploadData`/`uploadBundle` rely on under jsdom).
 *
 * This file does NOT re-prove `uploadAndTrack`'s own behavior (that is
 * `e3-library-flow.test.ts`'s job, untouched by this task) — it proves
 * `performUploadAndTrack`, called directly with a pre-derived key, produces
 * the SAME shape (tags, ownerAddress, itemId, and — for the unencrypted
 * case, where nothing is random — the exact same posted bytes) as calling
 * `uploadAndTrack` with the semantically equivalent `encryptFor`/omitted-
 * `encryptFor` input. `itemId` is pinned explicitly in every call below so
 * `Codex-Upload-Id` (which `uploadData` derives verbatim from `itemId`) is
 * deterministic too — the only genuinely non-deterministic field across two
 * independently-signed transactions is the signed tx `id` itself (RSA-PSS
 * salting) and, for the ENCRYPTED case, the ciphertext bytes (a fresh random
 * IV per call) — neither is compared here for that reason.
 */

import "fake-indexeddb/auto";

import { describe, it, expect } from "vitest";

import { createGatewayPool, type UploadResult } from "@ancientpantheon/arweave-core";

import {
  uploadAndTrack,
  performUploadAndTrack,
  type PerformUploadAndTrackOptions,
} from "../src/library/flow.js";
import { MemoryLibraryStore } from "../src/library/memoryStore.js";
import { deriveAccountAesKey } from "../src/crypto/fileEncryption.js";

import { throwawayJwk, KNOWN_ADDRESS, makeRecordingUploadApi } from "./e3-helpers";

const OWNER = KNOWN_ADDRESS;
const CAP = 1_000_000_000_000n;

function makeUploadPool() {
  return createGatewayPool({ endpoints: ["https://a.example"], sleep: async () => {} });
}

describe("performUploadAndTrack — behavioral equivalence with uploadAndTrack (T1, arweave-streaming-worker-wiring)", () => {
  it("an encrypted call with an already-derived key posts the SAME tags/ownerAddress/itemId shape as uploadAndTrack given the equivalent encryptFor", async () => {
    const accountId = "ouronet-account-equiv-1";
    const accountAddress = "DALOS-fake-ouronet-equiv-address";
    const bitstring = "1".repeat(800) + "0".repeat(800);
    const plaintext = "equivalence-check plaintext contents";

    const params = {
      jwk: throwawayJwk,
      data: plaintext,
      contentType: "text/plain",
      itemId: "equiv-enc-1",
      maxRewardWinston: CAP,
      category: "general-other" as const,
    };

    // Path A: the new direct entry point, given an already-derived key —
    // exactly what `uploadWorker.ts` will call with (never a live callback).
    const storeA = new MemoryLibraryStore();
    const { apiFactory: apiFactoryA, calls: callsA } = makeRecordingUploadApi();
    const resolvedKey = await deriveAccountAesKey(bitstring);
    const optsA: PerformUploadAndTrackOptions = {
      store: storeA,
      pool: makeUploadPool(),
      apiFactory: apiFactoryA,
      encryptFor: { accountId, accountAddress },
    };
    const resultA = (await performUploadAndTrack(params, resolvedKey, optsA)) as UploadResult;

    // Path B: today's public entry point, given the equivalent live
    // `encryptFor` (same account id/address, same revealed bitstring).
    const storeB = new MemoryLibraryStore();
    const { apiFactory: apiFactoryB, calls: callsB } = makeRecordingUploadApi();
    const resultB = (await uploadAndTrack(params, {
      store: storeB,
      pool: makeUploadPool(),
      apiFactory: apiFactoryB,
      encryptFor: { accountId, accountAddress, revealAccountSecret: async () => bitstring },
    })) as UploadResult;

    // Same deterministic identity fields (the signed tx `id` itself is
    // deliberately NOT compared — RSA-PSS salting makes it non-deterministic
    // across two independent signs of the same bytes).
    expect(resultA.ownerAddress).toBe(resultB.ownerAddress);
    expect(resultA.itemId).toBe(resultB.itemId);
    // Full tag list deep-equal: `itemId` is pinned above, so every tag this
    // schema emits (Codex-Item-Id, Codex-Upload-Id, Codex-Owner,
    // Codex-Category, Codex-Encrypted, Codex-Encryptor,
    // Codex-Encryption-Version, Content-Type, ...) is fully deterministic.
    expect(callsA[0].tags).toEqual(callsB[0].tags);

    // Both posted real ciphertext, never the plaintext verbatim (proves the
    // SAME encryption actually ran on both paths, not a no-op).
    expect(Buffer.from(callsA[0].data).equals(Buffer.from(plaintext, "utf8"))).toBe(false);
    expect(Buffer.from(callsB[0].data).equals(Buffer.from(plaintext, "utf8"))).toBe(false);

    // The locally-appended entries carry the same tag shape too.
    const entryA = (await storeA.list(OWNER))[0];
    const entryB = (await storeB.list(OWNER))[0];
    expect(entryA.tags).toEqual(entryB.tags);
  });

  it("an unencrypted call with resolvedKey: undefined posts BYTE-IDENTICAL data and the same tags as uploadAndTrack with encryptFor omitted entirely", async () => {
    const plaintext = "equivalence-check plaintext, unencrypted this time";

    const params = {
      jwk: throwawayJwk,
      data: plaintext,
      contentType: "text/plain",
      itemId: "equiv-plain-1",
      maxRewardWinston: CAP,
      category: "general-other" as const,
    };

    // Path A: performUploadAndTrack given resolvedKey: undefined.
    const storeA = new MemoryLibraryStore();
    const { apiFactory: apiFactoryA, calls: callsA } = makeRecordingUploadApi();
    const resultA = (await performUploadAndTrack(params, undefined, {
      store: storeA,
      pool: makeUploadPool(),
      apiFactory: apiFactoryA,
    })) as UploadResult;

    // Path B: uploadAndTrack with encryptFor omitted entirely.
    const storeB = new MemoryLibraryStore();
    const { apiFactory: apiFactoryB, calls: callsB } = makeRecordingUploadApi();
    const resultB = (await uploadAndTrack(params, {
      store: storeB,
      pool: makeUploadPool(),
      apiFactory: apiFactoryB,
    })) as UploadResult;

    expect(resultA.ownerAddress).toBe(resultB.ownerAddress);
    expect(resultA.itemId).toBe(resultB.itemId);
    expect(callsA[0].tags).toEqual(callsB[0].tags);

    // Nothing random enters an unencrypted post: the exact same plaintext
    // bytes are posted on both paths, byte for byte.
    expect(Buffer.from(callsA[0].data).equals(Buffer.from(callsB[0].data))).toBe(true);
    expect(Buffer.from(callsA[0].data).toString("utf8")).toBe(plaintext);

    const entryA = (await storeA.list(OWNER))[0];
    const entryB = (await storeB.list(OWNER))[0];
    expect(entryA.tags).toEqual(entryB.tags);
  });
});
