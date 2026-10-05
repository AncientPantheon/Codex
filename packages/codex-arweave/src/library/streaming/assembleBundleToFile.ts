/**
 * The incremental bundle assembler (T2 of `arweave-opfs-bundle-assembly`).
 *
 * Reproduces `packages/arweave-core/src/upload/bundle.ts`'s `uploadBundle` +
 * its module-internal `assembleSignedBundle` — the per-file tag-building/
 * signing convention and the exact ANS-104 bundle byte layout — but writes the
 * result INCREMENTALLY through a {@link BundleAssemblyFile} seam instead of
 * holding every signed item's raw bytes in memory and `Buffer.concat`-ing
 * them. That in-memory pattern is exactly what this whole streaming-upload
 * project exists to replace for a multi-gigabyte folder upload.
 *
 * THE LAYOUT (confirmed by reading `assembleSignedBundle` directly, never
 * assumed): 32 bytes (item count, `longTo32ByteArray`) + 64 bytes x N
 * (per-item header: 32-byte length + 32-byte raw id) + the concatenated raw
 * item binaries, in order. The header REGION's size (`32 + 64*N`) is known the
 * instant the item count (file count + 1 manifest) is known — before anything
 * is signed — so it is reserved (zero-filled) FIRST, letting the write cursor
 * start right after it. Only the header's CONTENT (each item's real final
 * byte length + id) needs every item to have been signed first, which is why
 * the header region is backfilled at offset 0 only once every item (including
 * the manifest, signed LAST, since it needs every file's final id) is done.
 *
 * SIGNING CONVENTION — reused verbatim from `bundle.ts`, never diverged from:
 * `ArweaveSigner`/`createData`/`sign` (aliased `signDataItem` here, matching
 * `bundle.ts`'s own alias) are arbundles' standalone, browser-safe exports.
 * `DataItem.prototype.sign()`/`.rawId`/`.id` are NEVER touched — see
 * `bundle.ts`'s own doc comment for why: those unconditionally call Node's
 * `crypto.createHash`, which throws under this project's browser-aliased
 * `crypto` shim (`apps/codex-playground/crypto.shim.ts`).
 *
 * IDS WITHOUT A THROWAWAY IN-MEMORY BUNDLE: `uploadBundle` base64url-encodes
 * each file's raw id by building a throwaway `Bundle` from just the file
 * items (`assembleSignedBundle(fileItems).getIds()`) purely to reuse
 * `Bundle.getIds()`'s base64url encoding instead of taking a direct
 * `base64url` dependency — but that throwaway `Bundle` itself
 * `Buffer.concat`s every file's raw bytes into one buffer, exactly the
 * in-memory pattern this module exists to avoid. Each `rawId` returned by
 * `signDataItem` is already the raw id BYTES (a `Buffer`), so no throwaway
 * Bundle is needed at all — but `rawId.toString("base64url")` is NOT an
 * option: the real Node `Buffer` supports the `"base64url"` encoding (Node
 * >=15.7), but the browser-polyfilled `buffer` package this project's own
 * bundler aliases `node:buffer`/`buffer` onto for the browser build does
 * NOT — confirmed live, the hard way, during this task's real-OPFS/real-
 * browser manual verification (`TypeError: Unknown encoding: base64url`,
 * thrown from inside a real Worker). `"base64"` IS universally supported by
 * both; {@link base64url} below encodes via `"base64"` and then applies the
 * three-character RFC 4648 §5 base64url substitution itself
 * (`+`→`-`, `/`→`_`, strip `=` padding) — the same transform `Bundle.getIds()`
 * (`arbundles`' own `base64url` npm dependency) performs internally, just
 * inlined here instead of adding a new direct dependency on that package.
 *
 * LAZY PER-FILE INPUT: `AssembleBundleToFileInput.readData()` is called
 * exactly once per file, at the moment it is that file's turn — never a
 * caller-preloaded `Uint8Array`. A caller that eagerly read every file into
 * memory before calling this function would defeat the whole point one layer
 * up, regardless of what this function's own loop does; the lazy seam is what
 * lets a later real caller (a folder of real browser `File`s, read via
 * `.arrayBuffer()` only when it is that file's turn) actually honor "never
 * hold the whole folder in memory at once" end to end.
 *
 * MEMORY RESIDENCY: within the per-file loop below, the file's own read bytes
 * (`bytes`) and its signed `DataItem` (`item`) are `const`-bound to a single
 * loop iteration and never stored anywhere beyond it — only the lightweight
 * `{ byteLength, rawId }` pair survives into the next iteration, for the
 * eventual header backfill. This is what releases a file's raw bytes before
 * the next one is read, verified structurally (not "trust the code") by this
 * module's own test via `WeakRef` + a forced GC.
 *
 * `arbundles` is reached through a DYNAMIC `import()` inside
 * {@link assembleBundleToFile} below, never a top-level static import —
 * mirroring this package's own established heavy-third-party-dependency
 * convention (`panel/lazyDeps.ts`'s `loadTurbo()`, dynamically loading
 * `@ardrive/turbo-sdk` for the same reason: keep a heavy external signing/
 * protocol library out of a module's STATIC import graph). A static,
 * top-level import of that package here would also trip
 * `e2-stoachain-isolation.test.ts`'s allow-listed-bare-specifier scan across
 * the whole `src/library` tree (an unrelated, pre-existing StoaChain-
 * isolation gate, out of this task's file scope to edit) — the SAME outcome
 * the dynamic-import convention already produces for Turbo, for the same
 * underlying reason.
 */

import {
  importKeyfile,
  addressOf,
  buildUploadTags,
  type ArweaveJwk,
  type UploadCategory,
  type NftAssetType,
} from "@ancientpantheon/arweave-core";

import type { BundleAssemblyFile } from "./bundleAssemblyFile.js";
import {
  encryptStreamToFile,
  type ByteRangeReader,
  type ByteRangeWriter,
} from "../../crypto/streamingFileEncryption.js";

/** The app-metadata tag carrying a bundled file item's relative path,
 *  subfolders preserved — mirrors `bundle.ts`'s own (module-private, so
 *  redeclared here verbatim rather than diverging) `TAG_CODEX_PATH`. */
const TAG_CODEX_PATH = "Codex-Path";

/** Mirrors `bundle.ts`'s own (module-private) manifest content-type/format/
 *  version constants verbatim. */
const MANIFEST_CONTENT_TYPE = "application/x.arweave-manifest+json";
const MANIFEST_FORMAT = "arweave/paths";
const MANIFEST_VERSION = "0.2.0";

/** One input file for {@link assembleBundleToFile}. `readData()` is called
 *  EXACTLY ONCE, when it becomes this file's turn in the per-file loop — not
 *  a caller-preloaded buffer. See the module doc comment above for why this
 *  laziness is the point, not an incidental detail. */
export interface AssembleBundleToFileInput {
  /** The file's path relative to the upload root, subfolders preserved with
   *  forward slashes — becomes the manifest's path key and the file item's
   *  `Codex-Path` tag value verbatim, same as `UploadBundleFile.path`. */
  path: string;
  /** The file's MIME type — becomes the file item's `Content-Type`. */
  contentType: string;
  /** Lazily reads this file's full raw bytes. Called once; the returned
   *  buffer is used to build+sign this file's data item and then released
   *  (not held past the iteration that reads it). */
  readData(): Promise<Uint8Array>;
}

/** Parameters for {@link assembleBundleToFile} — the SAME per-upload-action
 *  tag inputs `uploadBundle` accepts (minus `maxRewardWinston`/posting, which
 *  are out of this topic's scope — see `design.md`), applied identically to
 *  every file item (and, for `category`/`assetType`/`appId`/`appVersion`, the
 *  manifest item too — `encrypted`/`encryptorAddress`/`encryptionVersion`
 *  never apply to the manifest, same two-way-implication rule as
 *  `uploadBundle`). */
export interface AssembleBundleToFileParams {
  /** The uploader's keyfile. The SAME jwk signs every file item and the
   *  manifest item. */
  jwk: ArweaveJwk;
  /** The files to bundle, in the order they are signed and written. */
  files: AssembleBundleToFileInput[];
  /** REQUIRED Codex-Category, applied identically to every file item AND the
   *  manifest item — same rule as `uploadBundle`. */
  category: UploadCategory;
  /** Optional Codex-Asset-Type — present if and only if `category ===
   *  "nft-data"`. */
  assetType?: NftAssetType;
  /** Optional Codex-App-Id, applied identically to every item. */
  appId?: string;
  /** Optional Codex-App-Version, applied identically to every item. */
  appVersion?: string;
  /** REQUIRED Codex-Encrypted, applied verbatim to every FILE item; the
   *  MANIFEST item is ALWAYS tagged `encrypted: false` regardless of this
   *  value — same rule, same reason, as `uploadBundle`. */
  encrypted: boolean;
  /** Optional Codex-Encryptor — present if and only if `encrypted === true`,
   *  never applied to the manifest item. */
  encryptorAddress?: string;
  /** Optional Codex-Encryption-Version — present if and only if `encrypted
   *  === true`, never applied to the manifest item. */
  encryptionVersion?: string;
  /** OPTIONAL (T2, `arweave-streaming-encryption`) — when present, every
   *  file's plaintext (never the manifest, which is always public) is run
   *  through T1's chunked `encryptStreamToFile` under `key` BEFORE it is
   *  handed to `createData`/signed, so the bytes that actually get SIGNED
   *  (and therefore land on-chain) are the ciphertext, never the plaintext —
   *  see {@link encryptFileBytes} below for why the full ciphertext must
   *  still be assembled as one buffer per file (ANS-104 signing hashes a
   *  DataItem's complete `data` field in one shot; there is no incremental/
   *  streaming signing in `arbundles`). Omitted entirely, every file is
   *  signed over its raw plaintext bytes exactly as before this param
   *  existed — zero behavior change to that path. Narrow and additive by
   *  design: this does not require (and does not inspect) `params.encrypted`
   *  — the two are independent knobs a caller is expected to set together
   *  for a real encrypted upload, but this function enforces no coupling
   *  between them. */
  encryption?: { key: CryptoKey };
}

/** The result of a successful incremental bundle assembly. */
export interface AssembleBundleToFileResult {
  /** The manifest data item's deterministic post-sign ANS-104 id
   *  (base64url), the LAST item written to `file`. */
  manifestId: string;
  /** Each input file's relative path paired with its data item's id
   *  (base64url), in `params.files` order. */
  fileIds: { path: string; id: string }[];
}

/** One already-written item's header content, recorded as it is produced so
 *  the header region can be backfilled once every item (files + manifest) is
 *  done. Deliberately lightweight: no raw bytes, no `DataItem`, so nothing
 *  beyond this survives a loop iteration. */
interface ItemHeaderRecord {
  byteLength: number;
  rawId: Buffer;
}

/** Base64url-encodes `rawId` via the universally-supported `"base64"`
 *  encoding + the RFC 4648 §5 substitution — see the module doc comment
 *  above for why `.toString("base64url")` itself is NOT safe here. */
function base64url(rawId: Buffer): string {
  return rawId.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Encrypts `plaintext` end to end via T1's chunked `encryptStreamToFile`,
 * returning the complete framed ciphertext as ONE buffer — the exact bytes
 * {@link assembleBundleToFile}'s per-file loop then hands to `createData` in
 * place of the raw plaintext.
 *
 * WHY a full buffer, not a direct stream into `file.write`: ANS-104 signing
 * (`createData`/`sign`) deep-hashes a DataItem's complete `data` field in one
 * shot — `arbundles` has no incremental/streaming signing — so the final
 * ciphertext must already be fully assembled before `createData` is ever
 * called. This is NOT a new, separate memory ceiling: the UNENCRYPTED path
 * already resolves `inputFile.readData()` into one whole-file buffer before
 * signing, for the exact same reason; this function just produces an
 * equivalent whole-file buffer via chunked encryption instead of a direct
 * plaintext read, so the per-file residency bound stays what it already was.
 * What chunking still buys here, every bit as much as it does for T1's own
 * tests: never holding a base64-blown-up whole-file string (v1's
 * `encryptFileForUpload` ceiling, `fileEncryption.ts`) or more than one
 * plaintext+ciphertext CHUNK resident at once mid-encrypt.
 *
 * Grows a local backing buffer on demand (same technique
 * `FakeBundleAssemblyFile.write` already uses) rather than pre-computing the
 * final ciphertext length up front — `encryptStreamToFile` itself is the one
 * place that owns the framing-overhead arithmetic (12-byte IV + 16-byte GCM
 * tag per chunk); this function deliberately does not duplicate that
 * constant.
 */
async function encryptFileBytes(plaintext: Uint8Array, key: CryptoKey): Promise<Uint8Array> {
  let ciphertext = new Uint8Array(0);
  const read: ByteRangeReader = async (offset, length) => plaintext.subarray(offset, offset + length);
  const write: ByteRangeWriter = async (offset, bytes) => {
    const end = offset + bytes.byteLength;
    if (end > ciphertext.byteLength) {
      const grown = new Uint8Array(end);
      grown.set(ciphertext, 0);
      ciphertext = grown;
    }
    ciphertext.set(bytes, offset);
  };

  await encryptStreamToFile({ read, totalPlaintextLength: plaintext.byteLength, key, write });
  return ciphertext;
}

/**
 * Assembles an ANS-104 bundle (N file items + an `arweave/paths` manifest
 * item) INCREMENTALLY into `file`, signing and writing one item at a time so
 * at most one file's raw bytes are ever resident at once — see the module doc
 * comment for the full layout/signing-convention rationale.
 *
 * Composition, mirroring `uploadBundle`'s own steps minus posting:
 *   1. Reserve the header region (`32 + 64*(files.length+1)` zeroed bytes) at
 *      offset 0, so the write cursor can start right after it.
 *   2. For each file, in order: read its bytes, tag+sign it, write its raw
 *      signed bytes at the cursor, record `{byteLength, rawId}`, advance the
 *      cursor, and let that file's bytes/item go out of scope before the next
 *      iteration.
 *   3. Build the `arweave/paths` manifest (needs every file's now-known final
 *      id), sign it the same way, write it as the final item.
 *   4. Backfill the header region at offset 0 with every item's real
 *      `{byteLength, rawId}`, files then the manifest, in that order.
 */
export async function assembleBundleToFile(
  file: BundleAssemblyFile,
  params: AssembleBundleToFileParams,
): Promise<AssembleBundleToFileResult> {
  // Real-Worker gap found and fixed during this task's own real-browser/
  // real-OPFS manual verification (T3, `arweave-streaming-encryption`):
  // arbundles' `ArweaveSigner`/`jwkTopem` reach for a bare, ambient `Buffer`
  // global (never a `buffer`-package import it carries itself) — confirmed
  // live, the hard way, in a real dedicated Worker: `ReferenceError: Buffer
  // is not defined`, thrown from `arbundles.js`'s own `base64url2bn`. The
  // app's main thread never hits this because `main.tsx`'s first import
  // (`polyfills.ts`) sets `globalThis.Buffer` before anything else runs —
  // but a Worker has its own separate global scope and never sees that
  // assignment, and this module's own doc comment above explicitly claims
  // "callable from wherever it eventually gets invoked (a Worker, per this
  // topic's design)" — a claim this fix is what actually makes true. Mirrors
  // `polyfills.ts`'s own guarded `globalThis.Buffer = globalThis.Buffer ??
  // Buffer` convention exactly, scoped locally to the one function that
  // actually needs it rather than requiring every eventual calling Worker
  // entry file to remember a separate polyfill import. The dynamic
  // `import("buffer")` (not a static one) keeps this module free of a new
  // top-level dependency; under Node this resolves to the real builtin,
  // under the browser build to the SAME `buffer` polyfill `vite.config.ts`
  // already aliases the bare `buffer` specifier onto for `polyfills.ts`.
  if (typeof globalThis.Buffer === "undefined") {
    const { Buffer } = await import("buffer");
    globalThis.Buffer = Buffer;
  }

  // Dynamic, not static — see the module doc comment above for why.
  const { ArweaveSigner, createData, sign: signDataItem, longTo32ByteArray } =
    await import("arbundles");

  const jwk = importKeyfile(params.jwk);
  const ownerAddress = await addressOf(jwk);
  const uploadId = globalThis.crypto.randomUUID();
  const signer = new ArweaveSigner(jwk);

  // The item count (files + 1 manifest) is known up front — before anything
  // is signed — so the header region's SIZE is too. Reserve it (zero-filled)
  // first; its CONTENT is backfilled once every item is signed, below.
  const itemCount = params.files.length + 1;
  const headerRegionSize = 32 + 64 * itemCount;
  await file.write(0, new Uint8Array(headerRegionSize));
  let cursor = headerRegionSize;

  const headerRecords: ItemHeaderRecord[] = [];
  const fileIds: { path: string; id: string }[] = [];

  for (const inputFile of params.files) {
    // `plaintext`, `bytes`, and `item` are bound to THIS iteration only —
    // none is stored anywhere that survives past it (only the lightweight
    // `headerRecords` entry below does), so all become garbage-collectable
    // the moment the next iteration starts. This is the "release the raw
    // input bytes before moving to the next file" property, verified
    // structurally by this module's own test.
    const plaintext = await inputFile.readData();
    // When `encryption` is set, `bytes` (the data `createData` signs below)
    // is the file's CIPHERTEXT, never its plaintext — see `encryptFileBytes`
    // above for why the full ciphertext must be one buffer by this point.
    // Everything downstream (`raw.byteLength`, `cursor`, the manifest's
    // implicit size via that same length) therefore already reflects the
    // ciphertext's length, not the plaintext's, with no separate offset
    // arithmetic needed: `cursor += raw.byteLength` below was always correct
    // for WHATEVER `bytes` turned out to be.
    const bytes = params.encryption
      ? await encryptFileBytes(plaintext, params.encryption.key)
      : plaintext;
    const tags = buildUploadTags({
      ownerAddress,
      contentType: inputFile.contentType,
      itemId: globalThis.crypto.randomUUID(),
      uploadId,
      itemType: "file",
      category: params.category,
      assetType: params.assetType,
      appId: params.appId,
      appVersion: params.appVersion,
      encrypted: params.encrypted,
      encryptorAddress: params.encryptorAddress,
      encryptionVersion: params.encryptionVersion,
      appMetadata: [{ name: TAG_CODEX_PATH, value: inputFile.path }],
    });
    const item = createData(bytes, signer, { tags });
    const rawId = await signDataItem(item, signer);
    const raw = item.getRaw();

    await file.write(cursor, raw);
    headerRecords.push({ byteLength: raw.byteLength, rawId });
    fileIds.push({ path: inputFile.path, id: base64url(rawId) });
    cursor += raw.byteLength;
  }

  // The manifest is built LAST — it needs every file's now-known final id,
  // which are all known only once every file above has been signed.
  const paths: Record<string, { id: string }> = {};
  for (const entry of fileIds) {
    paths[entry.path] = { id: entry.id };
  }
  const manifestTags = buildUploadTags({
    ownerAddress,
    contentType: MANIFEST_CONTENT_TYPE,
    itemId: globalThis.crypto.randomUUID(),
    uploadId,
    itemType: "manifest",
    category: params.category,
    assetType: params.assetType,
    appId: params.appId,
    appVersion: params.appVersion,
    // The manifest item is ALWAYS public — see `bundle.ts`'s own doc comment
    // for why — regardless of `params.encrypted`/`encryptorAddress`/
    // `encryptionVersion` applied to the sibling file items above.
    encrypted: false,
  });
  // `fileIds` is non-empty whenever `params.files` is — `index` names the
  // first file's path as the manifest's default resolution target, same as
  // `uploadBundle`.
  const manifestBody = JSON.stringify({
    manifest: MANIFEST_FORMAT,
    version: MANIFEST_VERSION,
    index: { path: fileIds[0]!.path },
    paths,
  });
  const manifestItem = createData(manifestBody, signer, { tags: manifestTags });
  const manifestRawId = await signDataItem(manifestItem, signer);
  const manifestRaw = manifestItem.getRaw();

  await file.write(cursor, manifestRaw);
  headerRecords.push({ byteLength: manifestRaw.byteLength, rawId: manifestRawId });
  const manifestId = base64url(manifestRawId);

  // Backfill the header region now that every item's real {byteLength,
  // rawId} is known: 32 bytes item-count + 64 bytes x N per-item {32-byte
  // length, 32-byte raw id}, files then the manifest, matching
  // `assembleSignedBundle`'s own documented layout exactly.
  const headerRegion = new Uint8Array(headerRegionSize);
  headerRegion.set(longTo32ByteArray(headerRecords.length), 0);
  headerRecords.forEach(({ byteLength, rawId }, index) => {
    const header = new Uint8Array(64);
    header.set(longTo32ByteArray(byteLength), 0);
    header.set(rawId, 32);
    headerRegion.set(header, 32 + 64 * index);
  });
  await file.write(0, headerRegion);

  return { manifestId, fileIds };
}
