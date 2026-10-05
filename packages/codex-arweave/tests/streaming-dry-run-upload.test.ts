// @vitest-environment node
/**
 * T2 RED/GREEN (`arweave-upload-dry-run`) — the dry-run engine
 * (`runUploadDryRun`), which lets a caller press a "Test this upload" button
 * and genuinely exercise the real streaming-upload engines (OPFS assembly,
 * streaming `data_root`, chunked posting, interrupt+resume) against T1's
 * shippable local/no-op gateway (`createLocalDryRunGatewayApiFactory`,
 * `@ancientpantheon/arweave-core`) instead of a real gateway — zero AR spent,
 * zero network reachability, zero Library persistence.
 *
 * `// @vitest-environment node` — same reason `streaming-post.test.ts`/
 * `streaming-upload-bundle.test.ts`/`streaming-perform-upload-and-track
 * .test.ts` already use it: this file drives real `arweave-js` streaming
 * `Transaction`s end to end.
 *
 * FOUR correctness properties are under test (this task's own "done when"):
 *
 * (1) A normal multi-file, mixed encrypted/unencrypted selection (exercised
 *     as two separate calls — `runUploadDryRun`'s own single `resolvedKey`
 *     param mirrors `performUploadAndTrack`'s own "one key for the whole
 *     upload action" contract, so "mixed" is realized across two calls, not
 *     within one) reports `success: true`, `proofsValid: true`,
 *     `resumeTested: true`, and `decryptRoundTripOk: true` for the encrypted
 *     run / `"not-applicable"` for the unencrypted-only run.
 * (2) A deliberately mismatched encryption key makes the run report
 *     `success: false` with a clear reason in `errors` — proven via the
 *     engine's own additive `decryptionKey` self-verify seam (see
 *     `dryRunUpload.ts`'s own module doc comment for why a SINGLE key used
 *     for both encrypt and decrypt can mathematically never fail this way:
 *     AES-GCM's `Enc_k(Dec_k(x)) = x` for ANY key `k`, so "wrong key" alone,
 *     used consistently, always round-trips). This is the single most
 *     important test in this file: it proves the engine can actually report
 *     failure, not rubber-stamp every input.
 * (3) Zero Library/`store.append` calls occur — `runUploadDryRun` takes NO
 *     `store` param at all (confirmed structurally: this file never
 *     constructs or passes one), so this is automatically satisfied by
 *     construction, not merely "happens not to be called".
 * (4) The OPFS file and resume record are both gone after the run completes,
 *     in BOTH the success and induced-failure cases — checked via the real
 *     `StreamingPostResumeStore.load` resolving `null` afterward (the id is
 *     captured via a spy on `store.save`'s first call) and the injected
 *     `deleteFile` spy having fired with the SAME file name.
 */

import "fake-indexeddb/auto";

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, it, expect, vi } from "vitest";
import type { ArweaveJwk } from "@ancientpantheon/arweave-core";

import type { BundleAssemblyFile } from "../src/library/streaming/bundleAssemblyFile.js";
import { StreamingPostResumeStore } from "../src/library/streaming/streamingPostResumeStore.js";
import type { IdbFactoryLike } from "../src/library/types.js";
import { deriveAccountAesKey } from "../src/crypto/fileEncryption.js";
import { makeHealthPool } from "./e3-helpers.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const throwawayJwk = JSON.parse(
  readFileSync(join(FIXTURES, "throwaway-arweave-keyfile.json"), "utf8"),
) as ArweaveJwk;

const CAP = 1_000_000_000_000n;

/** Deterministic, non-trivial per-file bytes — same convention every sibling
 *  streaming test file in this project already uses. */
function makeDeterministicBytes(size: number, seed: number): Uint8Array {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    bytes[i] = (i * 31 + seed * 7) & 0xff;
  }
  return bytes;
}

/** Three real files, sized so the assembled bundle spans several Merkle
 *  chunks (MAX_CHUNK_SIZE = 256 KiB) — mirrors `streaming-post.test.ts`'s own
 *  `makeFiles` fixture, so interrupting after one chunk genuinely leaves more
 *  to resume (never the "selection too small to interrupt" edge case). */
function makeFileFixtures(): { path: string; contentType: string; data: Uint8Array }[] {
  const sizes = [300_000, 400_000, 500_000];
  return sizes.map((size, i) => ({
    path: `sub/file-${i}.bin`,
    contentType: "application/octet-stream",
    data: makeDeterministicBytes(size, i),
  }));
}

/** A fresh, isolated `StreamingPostResumeStore` — mirrors every sibling
 *  streaming test file's own `freshResumeStore()` helper, so no two tests in
 *  this file ever share state. */
function freshResumeStore(): Promise<StreamingPostResumeStore> {
  return StreamingPostResumeStore.open({
    indexedDB: globalThis.indexedDB as unknown as IdbFactoryLike,
    databaseName: `codex-dry-run-${Math.random().toString(36).slice(2)}`,
  });
}

/**
 * A `BundleAssemblyFile` whose bytes live in a box SHARED across every
 * instance wrapping it — unlike `FakeBundleAssemblyFile` (whose content and
 * `#closed` flag are both private to one instance, so a second `open()` of
 * "the same file" can never see what a prior, now-closed instance wrote),
 * this one simulates what a REAL `openOpfsBundleAssemblyFile(name)` call
 * actually gives: a FRESH handle (its own independent, reusable `#closed`
 * flag) over the SAME durable, named file's content. `runUploadDryRun`
 * itself calls `opts.openFile` more than once for the identical `fileName`
 * — once for the interrupted first pass, again when it resumes — so a test
 * fake that returns a brand-new, empty `FakeBundleAssemblyFile` on every
 * call (or returns the SAME now-closed instance, which throws
 * "already closed" on the next read/write) does not correctly stand in for
 * real OPFS reopening; this one does.
 */
class SharedBytesBundleAssemblyFile implements BundleAssemblyFile {
  #box: { buffer: Uint8Array };
  #closed = false;

  constructor(box: { buffer: Uint8Array }) {
    this.#box = box;
  }

  async write(offset: number, bytes: Uint8Array): Promise<void> {
    this.#requireOpen();
    const end = offset + bytes.byteLength;
    if (end > this.#box.buffer.byteLength) {
      const grown = new Uint8Array(end);
      grown.set(this.#box.buffer, 0);
      this.#box.buffer = grown;
    }
    this.#box.buffer.set(bytes, offset);
  }

  async read(offset: number, length: number): Promise<Uint8Array> {
    this.#requireOpen();
    const out = new Uint8Array(length);
    const available = Math.max(0, Math.min(length, this.#box.buffer.byteLength - offset));
    if (available > 0) {
      out.set(this.#box.buffer.subarray(offset, offset + available), 0);
    }
    return out;
  }

  async close(): Promise<void> {
    this.#closed = true;
  }

  #requireOpen(): void {
    if (this.#closed) {
      throw new Error("SharedBytesBundleAssemblyFile: already closed");
    }
  }
}

/** Builds an `openFile` seam backed by {@link SharedBytesBundleAssemblyFile}
 *  — a fresh handle per call, but the SAME underlying bytes for repeat calls
 *  with the same `fileName`, so `runUploadDryRun`'s own interrupt-then-
 *  resume (which reopens the identical file by name) actually sees what the
 *  interrupted pass wrote. */
function makeKeyedOpenFile(): (fileName: string) => Promise<BundleAssemblyFile> {
  const boxes = new Map<string, { buffer: Uint8Array }>();
  return async (fileName: string) => {
    let box = boxes.get(fileName);
    if (!box) {
      box = { buffer: new Uint8Array(0) };
      boxes.set(fileName, box);
    }
    return new SharedBytesBundleAssemblyFile(box);
  };
}

const ENCRYPTION_BITSTRING_A = "1".repeat(800) + "0".repeat(800);
const ENCRYPTION_BITSTRING_B = "0".repeat(800) + "1".repeat(800);

describe("runUploadDryRun — a real, local, zero-network rehearsal of the actual streaming-upload engines", () => {
  it("a normal multi-file ENCRYPTED selection reports success, valid proofs, a tested resume, and a genuine decrypt round-trip", async () => {
    const { runUploadDryRun } = await import("../src/library/streaming/dryRunUpload.js");

    const files = makeFileFixtures();
    const key = await deriveAccountAesKey(ENCRYPTION_BITSTRING_A);
    const store = await freshResumeStore();
    const deleteFile = vi.fn(async () => {});
    const saveSpy = vi.spyOn(store, "save");

    const result = await runUploadDryRun(
      {
        jwk: throwawayJwk,
        files,
        maxRewardWinston: CAP,
        category: "general-other",
      },
      {
        pool: makeHealthPool(),
        resolvedKey: key,
        resumeStore: store,
        isStreamingSupported: async () => true,
        openFile: makeKeyedOpenFile(),
        deleteFile,
      },
    );

    expect(result.success).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.streamingSupported).toBe(true);
    expect(result.filesTested).toBe(files.length);
    expect(result.totalBytes).toBe(files.reduce((sum, f) => sum + f.data.byteLength, 0));
    expect(result.chunksPosted).toBeGreaterThan(1);
    expect(result.resumeTested).toBe(true);
    expect(result.proofsValid).toBe(true);
    expect(result.decryptRoundTripOk).toBe(true);
    expect(typeof result.elapsedMs).toBe("number");
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);

    // Cleanup, unconditional: the resume record this run used is gone...
    expect(saveSpy.mock.calls.length).toBeGreaterThan(0);
    const resumeId = saveSpy.mock.calls[0]![0].id;
    await expect(store.load(resumeId)).resolves.toBeNull();
    // ...and the OPFS file was deleted.
    expect(deleteFile).toHaveBeenCalled();
    // Explicit timeout: this test runs ~780ms uncontended, but it drives real
    // AES-GCM + real `arweave-js` Merkle hashing over a ~1.2 MB bundle, and
    // under a full 58-file suite run (heavy concurrent jsdom/React files) it
    // has been observed to stretch past vitest's 5s default and fail as a
    // scheduling flake rather than a real defect. Budgeted generously so the
    // suite is deterministic.
  }, 120_000);

  /**
   * REGRESSION (`arweave-streaming-resume-opfs-corruption`) — the end-to-end
   * form of the bug, driven through the REAL `createGatewayPool` the app
   * actually builds (`apps/codex-playground/src/realArweaveAdapter.ts`:
   * `createGatewayPool({ endpoints: [gatewayUrl] })`), NOT the
   * `makeHealthPool()` fake every other test in this file uses.
   *
   * That single substitution is the whole bug. `makeHealthPool().execute`
   * runs its operation EXACTLY ONCE; the real pool runs it up to
   * `maxAttemptsPerEndpoint` (default 3) times per endpoint. Since
   * `streamingPostBundle` wraps "post the tx + every chunk from index 0" in
   * one `pool.execute` call, the deliberate interrupt-after-1-chunk made all
   * three attempts post chunk 0 and then die on chunk 1 — so chunk 0 was
   * posted three times before the resumed run posted the rest. The local
   * dry-run gateway then reported those three posts as three separate
   * payload entries, inflating this engine's reassembly by exactly two full
   * 256 KiB chunks and producing a bogus `data_root` mismatch plus
   * unparseable ANS-104 headers, for an upload whose posted bytes were in
   * fact byte-perfect.
   *
   * This test is deliberately pinned to the real pool so the fidelity gap
   * that hid the bug (every dry-run test using a single-shot pool fake)
   * cannot silently reopen.
   */
  it("REGRESSION: survives the REAL multi-attempt createGatewayPool — a retried pool attempt re-posting chunk 0 must not inflate the reassembled payload", async () => {
    const { runUploadDryRun } = await import("../src/library/streaming/dryRunUpload.js");
    const { createGatewayPool } = await import("@ancientpantheon/arweave-core");

    const files = makeFileFixtures();
    const key = await deriveAccountAesKey(ENCRYPTION_BITSTRING_A);
    const store = await freshResumeStore();

    const result = await runUploadDryRun(
      {
        jwk: throwawayJwk,
        files,
        maxRewardWinston: CAP,
        category: "general-other",
      },
      {
        pool: createGatewayPool({ endpoints: ["https://gateway-a.example"] }),
        resolvedKey: key,
        resumeStore: store,
        isStreamingSupported: async () => true,
        openFile: makeKeyedOpenFile(),
        deleteFile: vi.fn(async () => {}),
      },
    );

    expect(result.errors).toEqual([]);
    expect(result.success).toBe(true);
    expect(result.resumeTested).toBe(true);
    expect(result.proofsValid).toBe(true);
    expect(result.decryptRoundTripOk).toBe(true);
    // The payload is 5 Merkle chunks; the pre-fix capture reported 7 (chunk 0
    // three times). `chunksPosted` counts captured PAYLOAD chunks, so it must
    // equal the real chunk count however many attempts the pool burned.
    expect(result.chunksPosted).toBe(5);
  }, 120_000);

  it("an unencrypted-only selection reports decryptRoundTripOk as not-applicable", async () => {
    const { runUploadDryRun } = await import("../src/library/streaming/dryRunUpload.js");

    const files = makeFileFixtures();
    const store = await freshResumeStore();

    const result = await runUploadDryRun(
      {
        jwk: throwawayJwk,
        files,
        maxRewardWinston: CAP,
        category: "general-other",
      },
      {
        pool: makeHealthPool(),
        resolvedKey: undefined,
        resumeStore: store,
        isStreamingSupported: async () => true,
        openFile: makeKeyedOpenFile(),
        deleteFile: async () => {},
      },
    );

    expect(result.success).toBe(true);
    expect(result.decryptRoundTripOk).toBe("not-applicable");
    expect(result.proofsValid).toBe(true);
    expect(result.resumeTested).toBe(true);
  });

  it("a deliberately mismatched encryption key makes the run report failure, not a silent pass — proving the engine can actually fail", async () => {
    const { runUploadDryRun } = await import("../src/library/streaming/dryRunUpload.js");

    const files = makeFileFixtures();
    // The upload itself encrypts under keyA; the engine's own self-verify
    // decrypt step is told to use keyB (a DIFFERENT, independently derived
    // key) — a genuine, non-tautological mismatch (see this file's own
    // module doc comment for why "the same key both ways" can never fail).
    const keyA = await deriveAccountAesKey(ENCRYPTION_BITSTRING_A);
    const keyB = await deriveAccountAesKey(ENCRYPTION_BITSTRING_B);
    const store = await freshResumeStore();
    const saveSpy = vi.spyOn(store, "save");
    const deleteFile = vi.fn(async () => {});

    const result = await runUploadDryRun(
      {
        jwk: throwawayJwk,
        files,
        maxRewardWinston: CAP,
        category: "general-other",
      },
      {
        pool: makeHealthPool(),
        resolvedKey: keyA,
        decryptionKey: keyB,
        resumeStore: store,
        isStreamingSupported: async () => true,
        openFile: makeKeyedOpenFile(),
        deleteFile,
      },
    );

    expect(result.success).toBe(false);
    expect(result.decryptRoundTripOk).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e) => /decrypt/i.test(e))).toBe(true);
    // The upload itself still completed (only the independent self-check
    // failed) — proofs/resume are unaffected, proving the two checks are
    // genuinely independent of one another.
    expect(result.proofsValid).toBe(true);
    expect(result.resumeTested).toBe(true);

    // Cleanup is STILL unconditional on the induced-failure path.
    const resumeId = saveSpy.mock.calls[0]![0].id;
    await expect(store.load(resumeId)).resolves.toBeNull();
    expect(deleteFile).toHaveBeenCalled();
  });

  it("never calls any Library-persistence method — the engine takes no store param at all", async () => {
    const { runUploadDryRun } = await import("../src/library/streaming/dryRunUpload.js");

    // Structural proof, not merely "happens not to be called": `opts`'s own
    // type has no `store` field, so there is nothing to spy on here other
    // than confirming this module's only persistence-shaped dependency
    // (`resumeStore`) never receives anything resembling a Library entry —
    // its `save` calls are always resume-CHECKPOINT records (asserted by
    // shape below), never a `LibraryEntry`.
    const files = makeFileFixtures();
    const store = await freshResumeStore();
    const saveSpy = vi.spyOn(store, "save");

    const result = await runUploadDryRun(
      {
        jwk: throwawayJwk,
        files,
        maxRewardWinston: CAP,
        category: "general-other",
      },
      {
        pool: makeHealthPool(),
        resolvedKey: undefined,
        resumeStore: store,
        isStreamingSupported: async () => true,
        openFile: makeKeyedOpenFile(),
        deleteFile: async () => {},
      },
    );

    expect(result.success).toBe(true);
    for (const call of saveSpy.mock.calls) {
      const record = call[0];
      expect(record).toHaveProperty("chunkIndex");
      expect(record).toHaveProperty("txPosted");
      expect(record).not.toHaveProperty("owner");
      expect(record).not.toHaveProperty("status");
    }
  });

  it("reports honest failure (not a misleading fallback-path pass) when streaming is unsupported", async () => {
    const { runUploadDryRun } = await import("../src/library/streaming/dryRunUpload.js");

    const files = makeFileFixtures();
    const store = await freshResumeStore();

    const result = await runUploadDryRun(
      {
        jwk: throwawayJwk,
        files,
        maxRewardWinston: CAP,
        category: "general-other",
      },
      {
        pool: makeHealthPool(),
        resolvedKey: undefined,
        resumeStore: store,
        isStreamingSupported: async () => false,
        openFile: makeKeyedOpenFile(),
        deleteFile: async () => {},
      },
    );

    expect(result.success).toBe(false);
    expect(result.streamingSupported).toBe(false);
    expect(result.resumeTested).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
