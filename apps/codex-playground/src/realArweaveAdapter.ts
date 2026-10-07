// ============================================================================
// The REAL Arweave stack for the playground's PG-02 (real) mode — the OPT-IN,
// funds-safety-gated path that swaps the mock fakes for the executed E1-E3 seams.
//
//   - `createRealArweaveAdapter({ gatewayUrl, pool? })` — the REAL E1
//     `createArweaveAdapter({ pool })` fed a `createGatewayPool` built from the
//     USER-SET gateway URL (arweave-core). The `pool` may be injected directly
//     so automated tests drive the "real" path against a FAKE pool with ZERO
//     live network (the live-gateway path is a manual/opt-in dev affordance).
//   - `buildRealPanelDeps({ gatewayUrl, pool?, adapter? })` — the E4
//     `ArweavePanelDeps` bundle wired to the REAL adapter + E3 upload/Library
//     (`MemoryLibraryStore`/`uploadAndTrack`/`pollStatus`/`openUrl`/
//     `rebuildLibrary`) against the same pool.
//
// FUNDS-SAFETY (non-negotiable): the real adapter/pool is constructed ONLY when
// this module is called (i.e. only when the toggle flips to real) — the default
// mock path never imports or constructs it, so booting the app touches no
// network.
//
// KEYGEN (supersedes the old S-3 "keygen unsupported" note): real-mode keygen is
// now WIRED for local dev. The panel context gets a real
// `createWorkerKeygenRunner({ workerFactory })` driving codex-arweave's
// off-main-thread keygen worker, so RSA-4096 generation runs OFF the main thread
// and the tab strip stays responsive — replacing the main-thread no-op that
// threw on use. The bundler-specific `new Worker(new URL(...))` lives HERE, in
// the app, never in the shared seam: `createWorkerKeygenRunner` takes the worker
// factory injected. Automated tests inject a FAKE worker (jsdom has no `Worker`),
// so no real worker or real RSA-4096 runs under test.
// ============================================================================

import {
  addressOf,
  createGatewayPool,
  estimateFee,
  importKeyfile,
  type ArweaveJwk,
  type GatewayPool,
} from "@ancientpantheon/arweave-core";
import { encryptStringV2, smartDecrypt } from "@stoachain/stoa-core/crypto";
import type { CryptoSeam, ForeignChainAdapter, ForeignKeyEntry } from "@ancientpantheon/codex-core";
import { ARWEAVE_CHAIN_ID } from "@ancientpantheon/codex-arweave/address-book";
import { createWorkerKeygenRunner } from "@ancientpantheon/codex-arweave/keygen";
import {
  createArweaveAdapter,
  MemoryLibraryStore,
  pollStatus,
  openUrl,
  rebuildLibrary,
  backupCodexToLibrary,
  type LibraryEntry,
  type LibraryStore,
} from "@ancientpantheon/codex-arweave";
// `arweave-streaming-worker-wiring` T3-revised: the real worker-backed
// upload-performing seam `uploadAndTrack`/`uploadFilesAndTrack` below now
// drive, INSTEAD OF calling `library/flow.ts`'s own `uploadAndTrack`
// directly on the main thread (OPFS sync-access-handles are Worker-only —
// see that sub-topic's design.md). `resolveEncryptionKey` and
// `createWorkerStreamingUploadRunner`/`StreamingUploadRunner` are reached
// via a RELATIVE path into the package's own SOURCE, not a bare package
// specifier — GROUNDED (not guessed) by directly probing `tsc`: neither
// symbol rides a `package.json` `exports` subpath, and the workspace
// `tsconfig` `paths` wildcard (`@ancientpantheon/codex-arweave/*` →
// `./packages/codex-arweave/src/*/index.ts`) only maps a SINGLE path
// segment onto its OWN `index.ts` barrel — `library/flow.js` and
// `library/streaming/StreamingUploadRunner.js` are each a second segment
// deep with no barrel of their own at this scope, so
// `@ancientpantheon/codex-arweave/library/flow.js` fails to resolve
// (`TS2307`) under that mapping. A plain relative import resolves cleanly
// under both `tsc` and Vite's `.js`→`.ts` extension fallback (the SAME
// fallback this whole package's own source relies on throughout, e.g.
// `flow.ts`'s own `"./streaming/isStreamingUploadSupported.js"` import) —
// mirrors `createKeygenWorker`'s own "relative path into the package
// SOURCE" convention below, used there for the identical reason (`./keygen`
// has no `exports` subpath either).
import { resolveEncryptionKey } from "../../../packages/codex-arweave/src/library/flow.js";
import {
  createWorkerStreamingUploadRunner,
  type StreamingUploadRunner,
} from "../../../packages/codex-arweave/src/library/streaming/StreamingUploadRunner.js";
// `arweave-upload-dry-run` T3: the SAME relative-path convention as the two
// imports above, for the identical grounded reason (neither rides a
// `package.json` `exports` subpath). `StreamingDryRunRunner`/
// `createWorkerStreamingDryRunRunner`/`dryRunWorker.ts` are a SCOPE
// DEVIATION this task's own build report flags — added after the real-
// browser capstone found that `runUploadDryRun` must run inside a dedicated
// Worker (exactly like a real streaming upload) for
// `isStreamingUploadSupported()` to ever resolve `true`; see
// `StreamingDryRunRunner.ts`'s own doc comment for the full finding.
import {
  createWorkerStreamingDryRunRunner,
  type StreamingDryRunRunner,
} from "../../../packages/codex-arweave/src/library/streaming/StreamingDryRunRunner.js";
import type { DryRunResult } from "../../../packages/codex-arweave/src/library/streaming/dryRunUpload.js";
// `arweave-streaming-ui-support-probe-worker`: the SAME relative-path
// convention as the two imports above (neither rides a `package.json`
// `exports` subpath either, grounded the identical way) — the Worker-backed
// fix for the bug report's confirmed root cause: `UploadWizard.tsx`'s own
// `isStreamingUploadSupported` prop otherwise defaults to calling T1's probe
// directly on the main thread, which ALWAYS resolves `false` in a real
// browser (that probe's `createSyncAccessHandle()` call is Worker-only by
// spec). See `SupportProbeRunner.ts`'s own doc comment for the full seam.
import {
  createWorkerSupportProbeRunner,
  type SupportProbeRunner,
} from "../../../packages/codex-arweave/src/library/streaming/SupportProbeRunner.js";
// TYPE-ONLY (erased at compile time, so this costs nothing at runtime —
// never a heavy React import of the panel): `UploadWizardUploadCallbacks`/
// `UploadWizardSelection` aren't re-exported by the `./panel` barrel either,
// so they ride the SAME relative-path convention as the two imports above,
// for the identical grounded reason.
import type {
  UploadWizardUploadCallbacks,
  UploadWizardSelection,
} from "../../../packages/codex-arweave/src/panel/UploadWizard.js";
// Aliased: `checkArweaveRestoreEligibility` (the ArweavePanelDeps FIELD
// name) is a zero-arg closure THIS file builds; the imported T1 PRIMITIVE
// it's built from needs a different local name to avoid shadowing.
import { checkArweaveRestoreEligibility as deriveRestoreEligibility } from "@ancientpantheon/codex-arweave/seeds";
import type {
  ArweavePanelDeps,
  ArweaveSendRequest,
  ArweaveSendResult,
  PanelAddressBookEntry,
} from "@ancientpantheon/codex-arweave/panel";

/**
 * The real-mode gateway pool: `createGatewayPool({ endpoints: [gatewayUrl] })`
 * from arweave-core, fed the user-configured URL. When a `pool` is injected
 * (automated tests), that fake pool is used verbatim and NO real pool is built —
 * this is how the real path is exercised with zero live network.
 */
export function resolveRealPool({
  gatewayUrl,
  pool,
}: {
  gatewayUrl: string;
  pool?: GatewayPool;
}): GatewayPool {
  return pool ?? createGatewayPool({ endpoints: [gatewayUrl] });
}

/**
 * Construct the REAL E1 `ForeignChainAdapter` bound to the resolved gateway pool.
 * NOT constructed until this function is called (real-mode opt-in) — the default
 * mock path never reaches here, so booting the app opens no network connection.
 */
export function createRealArweaveAdapter({
  gatewayUrl,
  pool,
}: {
  gatewayUrl: string;
  pool?: GatewayPool;
}): ForeignChainAdapter {
  const resolvedPool = resolveRealPool({ gatewayUrl, pool });
  return createArweaveAdapter({ pool: resolvedPool });
}

/**
 * The DEFAULT worker factory for real-mode keygen: the bundler-built Web Worker
 * for codex-arweave's keygen entry.
 *
 * The URL is a RELATIVE path into the package SOURCE
 * (`packages/codex-arweave/src/keygen/worker.ts`), not a bare specifier, for two
 * reasons: codex-arweave's published `exports` map has no `./keygen` subpath at
 * all (the worker is a bundler entry, not a library symbol — see
 * `src/keygen/index.ts`), and the relative `new URL(..., import.meta.url)` form
 * is the one Vite statically analyses, so the worker is served transformed in
 * `vite dev` and emitted as its own chunk by `vite build`. (The
 * `createWorkerKeygenRunner` VALUE import above is a different mechanism: it
 * resolves through the workspace-source alias in `resolve.shared.ts` and the
 * tsconfig `paths`, which map the whole package onto `packages/codex-arweave/src`.)
 *
 * Constructed LAZILY (inside the factory, on the first keygen) so importing this
 * module never spawns a worker — and so jsdom, which has no `Worker`, only
 * trips over it if a test actually runs real keygen instead of injecting a fake.
 *
 * EXPORTED (E5/T8) because the SEEDED RSA-4096 batch (`runSeededBatch`, driven
 * by Arweave → Seeds) rides the SAME worker entry: T5 added the seeded message
 * kind to `worker.ts` rather than a second worker file, so one app-resolved URL
 * serves both the random `runKeygen` path and the seeded batch. Keeping the
 * `new Worker(new URL(...))` here — never inside codex-arweave — is the whole
 * point: `worker.ts` (src) and `worker.js` (dist) resolve differently, which is
 * why the package leaves the factory injected.
 */
export function createKeygenWorker(): Worker {
  return new Worker(
    new URL(
      "../../../packages/codex-arweave/src/keygen/worker.ts",
      import.meta.url,
    ),
    { type: "module" },
  );
}

/**
 * The DEFAULT worker factory for real-mode streaming uploads
 * (`arweave-streaming-worker-wiring` T3-revised): the bundler-built Web
 * Worker for codex-arweave's streaming-upload entry
 * (`src/library/streaming/uploadWorker.ts`) — the dedicated Worker
 * `isStreamingUploadSupported()`/`bundleAssemblyFile.ts`'s
 * `createSyncAccessHandle()` calls require (they throw on the main document
 * thread; see that sub-topic's design.md).
 *
 * Mirrors {@link createKeygenWorker} exactly, for the identical reason: a
 * RELATIVE path into the package SOURCE, not a bare specifier —
 * `library/streaming/uploadWorker.ts` has no `package.json` `exports`
 * subpath of its own (it is a bundler worker entry, not a library symbol,
 * same as `keygen/worker.ts`) and the relative `new URL(...,
 * import.meta.url)` form is what Vite statically analyses into its own
 * emitted worker chunk (this app's `vite.config.ts` already sets
 * `worker: { format: "es" }` for exactly this reason — the keygen worker's
 * own lazy heavy import needed it, and this worker's own lazy
 * `import("../flow.js")` / `import("./isStreamingUploadSupported.js")`
 * needs it identically).
 *
 * Constructed LAZILY (inside the factory, on the first real streaming
 * upload) so importing this module never spawns a worker, and so jsdom
 * (which has no `Worker` global — confirmed directly, not assumed) only
 * trips over it if a test actually drives a real upload instead of
 * injecting a `streamingUploadRunner` (see {@link buildRealPanelDeps}'s own
 * option of that name).
 */
export function createStreamingUploadWorker(): Worker {
  return new Worker(
    new URL(
      "../../../packages/codex-arweave/src/library/streaming/uploadWorker.ts",
      import.meta.url,
    ),
    { type: "module" },
  );
}

/**
 * The DEFAULT worker factory for the "Test this upload" dry run
 * (`arweave-upload-dry-run` T3 — a SCOPE DEVIATION; see this file's own
 * `StreamingDryRunRunner` import comment for why). Mirrors
 * {@link createStreamingUploadWorker} exactly, for the identical reason: a
 * RELATIVE path into the package SOURCE, not a bare specifier —
 * `library/streaming/dryRunWorker.ts` is a bundler worker entry with no
 * `package.json` `exports` subpath of its own.
 *
 * Constructed LAZILY (inside the factory, on the first dry run) so importing
 * this module never spawns a worker, and so jsdom (which has no `Worker`
 * global) only trips over it if a test actually drives a real dry run
 * instead of injecting a `streamingDryRunRunner` (see
 * {@link buildRealPanelDeps}'s own option of that name).
 */
export function createStreamingDryRunWorker(): Worker {
  return new Worker(
    new URL(
      "../../../packages/codex-arweave/src/library/streaming/dryRunWorker.ts",
      import.meta.url,
    ),
    { type: "module" },
  );
}

/**
 * The DEFAULT worker factory for the OPFS-streaming-support probe
 * (`arweave-streaming-ui-support-probe-worker`): the bundler-built Web
 * Worker for codex-arweave's support-probe entry
 * (`src/library/streaming/supportProbeWorker.ts`) — the dedicated Worker
 * `isStreamingUploadSupported()`'s own `createSyncAccessHandle()` call
 * requires (see `supportProbeWorker.ts`'s own doc comment for the full
 * finding). Mirrors {@link createStreamingDryRunWorker} exactly, for the
 * identical reason: a RELATIVE path into the package SOURCE, not a bare
 * specifier.
 *
 * Constructed LAZILY (inside the factory, on the first check) so importing
 * this module never spawns a worker, and so jsdom (which has no `Worker`
 * global) only trips over it if a test actually drives a real check instead
 * of injecting a `supportProbeRunner` (see {@link buildRealPanelDeps}'s own
 * option of that name).
 */
export function createSupportProbeWorker(): Worker {
  return new Worker(
    new URL(
      "../../../packages/codex-arweave/src/library/streaming/supportProbeWorker.ts",
      import.meta.url,
    ),
    { type: "module" },
  );
}

/** The at-rest keyring seams the seeded-generation flow spends its CPU on. */
export interface ArweaveKeyPersistence {
  /** Encrypts a finished JWK at rest and returns its ciphertext entry. */
  generateArweaveKey: (args: {
    jwk: ArweaveJwk;
    label?: string;
  }) => Promise<ForeignKeyEntry>;
  /** Validates a raw (parsed-JSON or hand-assembled, e.g. from a PEM pair)
   *  Arweave JWK via `importKeyfile`, encrypts it at rest the same way
   *  `generateArweaveKey` does, and returns its ciphertext entry. Was
   *  previously the same "real" gap `decryptArweaveKey` used to have (mock's
   *  fake `importArweaveKey` always returned a fixed placeholder entry, so an
   *  imported key's real address/material never actually persisted — the
   *  live preview shown before Save was correct, but what got saved was not
   *  the imported key at all). */
  importArweaveKey: (
    raw: unknown,
    opts?: { label?: string },
  ) => Promise<ForeignKeyEntry>;
  /** Appends a pre-encrypted entry to the codex's foreign-key slice. */
  addForeignKey: (entry: ForeignKeyEntry) => Promise<void>;
  /** Decrypts a STORED entry back into its JWK, so the RSA-parameters panel can
   *  show a persisted key's real numbers. Without this the mock mode's stub
   *  answered instead — a JWK whose every member is "" except `e` — and the
   *  panel rendered "—" for n/p/q/d/dp/dq/qi. */
  decryptArweaveKey: (entry: ForeignKeyEntry) => Promise<ArweaveJwk>;
  /** The codex store's `deleteForeignKey` action. Optional: unlike generate/add,
   *  a caller that never wires a delete seam should get no `deleteForeignKey`
   *  member at all, not a synthesized no-op — the no-op lives at the panel-deps
   *  boundary (`buildRealPanelDeps`), never inside this function. */
  deleteForeignKey?: (id: string) => Promise<void>;
}

export interface ArweaveKeyPersistenceOptions {
  /** The codex password, read at CALL time (never held): `useCodexAuth()`'s
   *  `getCurrentPassword`, which THROWS on a locked codex — deliberately not
   *  swallowed here, so a locked codex fails the persist loudly instead of
   *  silently dropping a key that cost minutes of RSA search. */
  getPassword: () => string;
  /** The codex store's `addForeignKey` action. */
  addForeignKey: (entry: ForeignKeyEntry) => Promise<void>;
  /** The codex store's `deleteForeignKey` action. Optional — see
   *  {@link ArweaveKeyPersistence.deleteForeignKey}. */
  deleteForeignKey?: (id: string) => Promise<void>;
}

/**
 * The PERSIST path behind `ArweavePanel.persistKey`, which calls
 * `generateArweaveKey({ jwk, label })` and then `addForeignKey(entry)` for EVERY
 * key the seeded batch produces — one at a time, as it arrives.
 *
 * FUNDS-CRITICAL. The plaintext JWK exists only inside `generateArweaveKey`; what
 * leaves is the `encryptStringV2` ciphertext (the same PBKDF2-SHA512/600k AES-GCM
 * v2 envelope `SpawnAccountModal` seals account secrets with, so one codex
 * password unlocks everything and a re-key rewrites it with the rest). The JWK is
 * never logged, never stored in the clear and never put in an error message.
 *
 * The canonical 43-char address doubles as the entry id — the E1 keyring rule
 * (`keyring/foreignKeys.ts`), so the same key restores to the same identity
 * instead of multiplying under fresh random ids.
 */
export function createArweaveKeyPersistence({
  getPassword,
  addForeignKey,
  deleteForeignKey,
}: ArweaveKeyPersistenceOptions): ArweaveKeyPersistence {
  /** Shared by `generateArweaveKey` and `importArweaveKey` — both end at
   *  "I have a valid `ArweaveJwk`, encrypt and wrap it as an entry", differing
   *  only in where that JWK came from (freshly generated vs. validated from
   *  an external source). */
  const persistJwk = async (
    jwk: ArweaveJwk,
    label: string | undefined,
  ): Promise<ForeignKeyEntry> => {
    const password = getPassword();
    const address = await addressOf(jwk);
    const encryptedKeyfile = await encryptStringV2(JSON.stringify(jwk), password);
    const entry: ForeignKeyEntry = {
      id: address,
      chainId: ARWEAVE_CHAIN_ID,
      encryptedKeyfile,
      // PUBLIC material — carried so Arweave -> Accounts renders a row without
      // decrypting anything.
      address,
    };
    if (label !== undefined) entry.label = label;
    return entry;
  };

  return {
    generateArweaveKey: async ({ jwk, label }) => persistJwk(jwk, label),
    importArweaveKey: async (raw, opts) => {
      // `importKeyfile` is the SAME structural validator a raw JSON keyfile
      // import already goes through — a hand-assembled JWK from a validated
      // PEM pair (all 9 fields already real base64url strings) passes it
      // trivially; a malformed/foreign shape is rejected with a typed
      // `InvalidKeyfileError` here, same as it always was for JSON.
      const jwk = importKeyfile(raw);
      return persistJwk(jwk, opts?.label);
    },
    addForeignKey,
    decryptArweaveKey: async (entry) => {
      const password = getPassword();
      const plaintext = await smartDecrypt(entry.encryptedKeyfile, password);
      return JSON.parse(plaintext) as ArweaveJwk;
    },
    ...(deleteForeignKey !== undefined ? { deleteForeignKey } : {}),
  };
}

/**
 * A 1.2x-buffered Winston fee-cap quote for a `byteSize` payload — mirrors
 * `SendArweaveModal`'s own established `maxRewardWinston = quote * 12n / 10n`
 * buffer convention (`packages/codex-arweave/src/panel/SendArweaveModal.tsx`),
 * reused here because neither `UploadAreaProps`/`CodexBackupAreaProps` expose a
 * fee-cap input of their own — `UploadParams`/`UploadBundleParams`/
 * `uploadCodexBackup`'s `maxRewardWinston` is REQUIRED, so the real adapter
 * derives it from a live quote rather than leaving upload/backup unusable.
 */
async function bufferedFeeCap(pool: GatewayPool, byteSize: number): Promise<bigint> {
  const quote = await estimateFee(pool, byteSize);
  return (quote * 12n) / 10n;
}

/**
 * `arweave-upload-dry-run` T3: a FIXED fee-cap placeholder for
 * `runDryRunUpload` — deliberately NEVER derived from a live `estimateFee`
 * quote (unlike {@link bufferedFeeCap} above), because the design's own
 * "zero real network request… across a full dry-run execution" acceptance
 * criterion forbids it: `estimateFee` reaches the REAL configured gateway
 * pool for a live price quote, which would be a genuine network call during
 * a run whose entire point is "nothing leaves your browser". The dry-run
 * engine's own posting loop checks this cap only against T1's local
 * gateway's own fixed, structurally-plausible price quote
 * (`createLocalDryRunGatewayApiFactory`'s `DRY_RUN_PRICE`, `1_000_000_000`
 * Winston) — this value is comfortably (1000x) above that, so the cap check
 * never spuriously fails a genuine dry run.
 */
const DRY_RUN_MAX_REWARD_WINSTON = 1_000_000_000_000n;

/**
 * Resolves the {@link ForeignKeyEntry} a given address/id corresponds to,
 * from the app's own `foreignKeys` list. `sendFrom` receives its entry
 * explicitly (chosen from the Accounts row the user clicked); `uploadAndTrack`/
 * `uploadFilesAndTrack` below receive the Upload Wizard's own chosen
 * `accountId` (`arweave-upload-wizard-account-wiring` — the Bug 1 fix: the
 * Account step's picker used to be purely cosmetic, with every real call
 * resolving the key from the single `ownerAddress` closed over at
 * construction time regardless of what the wizard showed as selected; now
 * each call resolves against whatever id the CALLER passed, per-call).
 * `CodexBackupAreaProps.backupCodex` still carries NO entry/account
 * parameter — that shape is fixed by `codex-arweave`'s own panel area
 * component (out of this task's file scope), and there is no Account picker
 * in front of it — so `backupCodex` is the one remaining seam still resolved
 * against `ownerAddress`, the construction-time default identity.
 */
function findEntryForAddress(
  entries: readonly ForeignKeyEntry[],
  address: string,
): ForeignKeyEntry {
  const entry = entries.find((e) => e.id === address || e.address === address);
  if (entry === undefined) {
    throw new Error(
      `No Arweave key found for the selected address "${address}" — import or generate one first.`,
    );
  }
  return entry;
}

/**
 * Assemble the E4 `ArweavePanelDeps` wired to the REAL adapter + E3 upload/
 * Library seams against the resolved gateway pool. The keyring seams surface the
 * ciphertext entries the app supplies (no plaintext JWK); the send seam runs the
 * adapter's real `buildSend`→`sign`→`post` recipe; the upload/library seams run
 * E3's `uploadAndTrack`/`pollStatus`/`openUrl`/`rebuildLibrary` against a real
 * `MemoryLibraryStore`. The keygen seam is the main-thread unsupported runner.
 */
export function buildRealPanelDeps({
  gatewayUrl,
  address,
  foreignKeys = [],
  addressBook = [],
  pool,
  adapter,
  libraryStore,
  workerFactory = createKeygenWorker,
  streamingUploadRunner,
  streamingDryRunRunner,
  supportProbeRunner,
  getPassword,
  addForeignKey,
  deleteForeignKey,
  getExportJson,
  onBackupSuccess,
  onAccountUsedForEncryption,
  primeOuronetAccountId,
  revealAccountSecret,
  primeArweaveSeedId,
  revealArweaveSeedSecret,
}: {
  gatewayUrl: string;
  address?: string;
  foreignKeys?: ForeignKeyEntry[];
  /** The panel-shaped address book (mapped from the CODEX slice by the app —
   *  see `ForeignChainsWiring.toPanelAddressBook`). Send filters it to
   *  `chainId === ARWEAVE_CHAIN_ID`. */
  addressBook?: PanelAddressBookEntry[];
  pool?: GatewayPool;
  adapter?: ForeignChainAdapter;
  libraryStore?: LibraryStore;
  /**
   * `arweave-streaming-worker-wiring` T3-revised: the off-main-thread
   * streaming-upload seam `uploadAndTrack`/`uploadFilesAndTrack` below drive
   * INSTEAD OF calling `library/flow.ts`'s `uploadAndTrack` directly.
   * Defaults to the real `createWorkerStreamingUploadRunner({ workerFactory:
   * createStreamingUploadWorker })` — a genuine Worker-backed run. Tests
   * inject a `FakeStreamingUploadRunner` (or any other
   * `StreamingUploadRunner`) so these closures are exercised with NO real
   * Worker (jsdom has none — confirmed directly) and no real upload.
   * Constructed once per `buildRealPanelDeps` call and shared by BOTH
   * closures below — safe, since the real runner spawns (and terminates) its
   * own fresh worker on every `.run()` call; it carries no per-call state of
   * its own.
   */
  streamingUploadRunner?: StreamingUploadRunner;
  /**
   * `arweave-upload-dry-run` T3 (SCOPE DEVIATION — see this file's own
   * `StreamingDryRunRunner` import comment): the off-main-thread dry-run
   * seam `runDryRunUpload` (below) drives. Defaults to a real
   * Worker-backed `createWorkerStreamingDryRunRunner({ workerFactory:
   * createStreamingDryRunWorker })`. Tests inject a `FakeStreamingDryRunRunner`
   * (or any other `StreamingDryRunRunner`) so `runDryRunUpload` is exercised
   * with NO real Worker and no real dry run.
   */
  streamingDryRunRunner?: StreamingDryRunRunner;
  /**
   * `arweave-streaming-ui-support-probe-worker`: the off-main-thread OPFS-
   * streaming-support probe `isStreamingUploadSupported` (below) drives.
   * Defaults to a real Worker-backed `createWorkerSupportProbeRunner({
   * workerFactory: createSupportProbeWorker })`. Tests inject a
   * `FakeSupportProbeRunner` (or any other `SupportProbeRunner`) so
   * `isStreamingUploadSupported` is exercised with NO real Worker.
   */
  supportProbeRunner?: SupportProbeRunner;
  /** The worker the keygen runner drives. Defaults to the real bundler-built
   *  worker; tests inject a fake so the runner is exercised without a real
   *  Web Worker (jsdom has none). */
  workerFactory?: () => Worker;
  /** The codex password reader (`useCodexAuth().getCurrentPassword`). Supplying
   *  it ARMS the persist path; without it the keyring stays read-only and
   *  `generateArweaveKey` refuses rather than pretending to store. */
  getPassword?: () => string;
  /** The codex store's `addForeignKey` action — where a generated key actually
   *  lands. Defaults to a no-op for the non-store callers. */
  addForeignKey?: (entry: ForeignKeyEntry) => Promise<void>;
  /** The codex store's `deleteForeignKey` action — where a deleted key actually
   *  leaves. Defaults to a no-op for the non-store callers. */
  deleteForeignKey?: (id: string) => Promise<void>;
  /** Resolves the codex's CURRENT encrypted export payload
   *  (`useCodexBackup().exportForCloud`), forwarded to `CodexBackupArea`
   *  verbatim. LAZY on purpose — `CodexBackupArea` calls it fresh at
   *  confirm-time, never at mount/render time, so a backup always captures
   *  whatever's true at the moment of the click, never a stale snapshot from
   *  an earlier render. Threading the LIVE getter out of the app's codex
   *  store is `ForeignChainsWiring.tsx`'s job — without it, `backupCodex`
   *  refuses rather than uploading an empty/stale payload, the same "unarmed
   *  seam refuses loudly" convention `generateArweaveKey`/`send` already use
   *  in this file. */
  getExportJson?: () => Promise<string>;
  /** Called after a real codex-backup upload resolves — the caller's own
   *  `clearDirty()` store action belongs here (`library/flow.ts`'s
   *  `backupCodexToLibrary` never knows about a `dirty` flag or `codex-ouronet`
   *  itself). Optional: the wiring is a `ForeignChainsWiring.tsx` concern,
   *  outside this task's file scope — omitting it just means the flag is not
   *  auto-cleared, not that the backup itself fails. */
  onBackupSuccess?: () => void;
  /** `arweave-non-removable-account` T5: fired straight through to
   *  `ArweavePanelDeps.onAccountUsedForEncryption` (T4's dead-letter-closing
   *  signal — `UploadWizard` calls it once with the encrypting Ouronet
   *  account's id after a successful Encrypted upload). Threading the LIVE
   *  value is `ForeignChainsWiring.tsx`'s job — the caller's own
   *  `codex-ouronet` `markOuroAccountEncryptedArweaveUpload(id)` store action
   *  belongs here, reached the SAME way `getExportJson`/`addForeignKey`/
   *  `deleteForeignKey` already reach their own store actions (a plain
   *  optional function parameter, forwarded verbatim — `codex-arweave`
   *  itself never imports `codex-ouronet`, so this file is the seam).
   *  Omitting it just leaves the signal unobserved, exactly like every other
   *  optional seam in this bundle. */
  onAccountUsedForEncryption?: (accountId: string) => void;
  /** `codex-seed-restore-activation` T3: the codex's Prime Ouronet
   *  (CodexPrime) account's id, when one exists. Reached by
   *  `ForeignChainsWiring.tsx` from the already-filtered `ouronetAccounts`
   *  list's `isDefault` entry (Option 2's own "the prime account is
   *  offered regardless of activation" carve-out — see
   *  `toArweaveSeedAccounts`'s doc comment). Omitted (or no such account)
   *  means `checkArweaveRestoreEligibility` resolves `false` rather than
   *  throwing — a codex with no Prime Ouronet account yet is simply not
   *  eligible, not an error. */
  primeOuronetAccountId?: string;
  /** `codex-seed-restore-activation` T3: unlock-gated reveal of an Ouronet
   *  account's decrypted secret — for a `dalos`-curve account this IS its
   *  1600-bit bitstring. The SAME seam `ForeignChainsWiring.tsx` already
   *  builds via `createRevealAccountSecret` for Option 2 of the define-seed
   *  flow and `LibraryArea`'s decrypt-on-download; reused here verbatim,
   *  never a second decrypt path. `null`/a thrown-then-caught failure both
   *  fold into "not eligible", never a thrown error out of this function. */
  revealAccountSecret?: (accountId: string) => Promise<string | null>;
  /** `codex-seed-restore-activation` T3: the codex's Prime Arweave seed's
   *  id, when one exists. Reached by `ForeignChainsWiring.tsx` from the
   *  stored Arweave seeds' `isPrime` entry. The seed's own ACTUAL stored
   *  address (what the re-derived address is compared against) is read
   *  from `foreignKeys`: an Arweave seed is nothing but a 1600-bit
   *  bitstring — it has no address of its own until a key is actually
   *  derived FROM it, so the "stored address" is the `#0` `ForeignKeyEntry`
   *  carrying this `seedId` (the same `seedId`/`index` provenance
   *  `ArweaveSeedsArea.tsx`'s own `indicesOfSeed` already keys grouping on).
   *  Omitted, or no matching `#0` entry yet, means `false` — not eligible
   *  yet, not an error. */
  primeArweaveSeedId?: string;
  /** `codex-seed-restore-activation` T3: unlock-gated, ON-DEMAND reveal of
   *  the NAMED Arweave seed's own plaintext 1600-bit bitstring — a GENUINELY
   *  NEW seam. `ArweaveSeedsArea.tsx`'s own "decrypt on demand" pattern only
   *  covers an Ouronet ACCOUNT's secret (`revealAccountSecret`) and a
   *  CHAINWEB SEED's mnemonic words (`revealSeedWords`); neither reveals an
   *  ARWEAVE seed's own bits by id (the app's existing `revealArweaveSeedBits`
   *  decrypts EVERY stored seed eagerly for the Seeds area's synchronous row
   *  list — a different shape). Built via
   *  `ForeignChainsWiring.tsx`'s `createRevealArweaveSeedSecret`. `null`
   *  (unknown seed id, locked codex, wrong password) is folded into "cannot
   *  attach a recovery tag this time", never a thrown error. */
  revealArweaveSeedSecret?: (seedId: string) => Promise<string | null>;
}): ArweavePanelDeps & {
  /**
   * `arweave-upload-dry-run` T3: the REAL wiring behind `UploadWizard`'s
   * "Test this upload" button — NOT a member of `ArweavePanelDeps` itself
   * (`context.tsx`, out of this task's file scope), so it is widened onto
   * this function's own return type via intersection instead of touching
   * that interface. Mirrors `uploadAndTrack`/`uploadFilesAndTrack`'s own
   * parameter shape exactly (`UploadWizardProps.runDryRunUpload`): decrypts
   * the PASSED-IN `accountId`'s key, resolves `selection.encryptFor` into a
   * `CryptoKey` the SAME way the real upload path does, and calls T2's
   * `runUploadDryRun` (via the injectable, Worker-backed
   * `streamingDryRunRunner`) — never touching `store`/Library at all.
   */
  runDryRunUpload: (
    files: File[],
    selection: UploadWizardSelection,
    accountId: string,
  ) => Promise<DryRunResult>;
  /**
   * `arweave-streaming-ui-support-probe-worker`: the REAL, Worker-backed
   * fix for `UploadWizard`'s own `isStreamingUploadSupported` prop — NOT a
   * member of `ArweavePanelDeps` itself (`context.tsx`, out of this task's
   * file scope), so, like `runDryRunUpload` above, it is widened onto this
   * function's own return type via intersection instead of touching that
   * interface. Resolves `true`/`false` via the injectable, Worker-backed
   * `supportProbeRunner`, never by calling T1's `isStreamingUploadSupported`
   * directly on the main thread (the confirmed root cause of the owner-
   * reported false "browser doesn't support this" banner/cap).
   */
  isStreamingUploadSupported: () => Promise<boolean>;
} {
  const resolvedPool = resolveRealPool({ gatewayUrl, pool });
  const resolvedAdapter =
    adapter ?? createArweaveAdapter({ pool: resolvedPool });
  const store: LibraryStore = libraryStore ?? new MemoryLibraryStore();
  const ownerAddress = address ?? "";
  // T3-revised: ONE runner shared by `uploadAndTrack`/`uploadFilesAndTrack`
  // below — see the `streamingUploadRunner` parameter's own doc comment.
  const resolvedStreamingUploadRunner =
    streamingUploadRunner ??
    createWorkerStreamingUploadRunner({ workerFactory: createStreamingUploadWorker });
  // `arweave-upload-dry-run` T3: the SAME construction pattern, for
  // `runDryRunUpload` below — see the `streamingDryRunRunner` parameter's
  // own doc comment.
  const resolvedStreamingDryRunRunner =
    streamingDryRunRunner ??
    createWorkerStreamingDryRunRunner({ workerFactory: createStreamingDryRunWorker });
  // `arweave-streaming-ui-support-probe-worker`: the SAME construction
  // pattern, for `isStreamingUploadSupported` below.
  const resolvedSupportProbeRunner =
    supportProbeRunner ??
    createWorkerSupportProbeRunner({ workerFactory: createSupportProbeWorker });
  // ARMED only when the caller wired the codex password + store action. The
  // seeded flow spends ~6.7 s of CPU per key, so an unarmed build must REFUSE up
  // front rather than resolve a key into a no-op.
  const persistence =
    getPassword === undefined
      ? null
      : createArweaveKeyPersistence({
          getPassword,
          addForeignKey: addForeignKey ?? (async () => {}),
          deleteForeignKey,
        });
  // Pulled into a local const (rather than read off the returned object
  // literal) so `sendFrom` below can call the SAME resolved fallback — the
  // fallback throw is kept only for the case `persistence` itself is unarmed.
  const decryptArweaveKey =
    persistence?.decryptArweaveKey ??
    (async () => {
      throw new Error("decryptArweaveKey requires the unlock-gated keyring.");
    });

  /**
   * `codex-seed-restore-activation` T3: resolves whether THIS codex's Prime
   * Arweave seed currently shares origin words with Prime Ouronet — the
   * precondition `library/flow.ts`'s `Codex-Backup-Recovery-Key` tag
   * depends on. Resolves `false` (NEVER throws) whenever either identity is
   * simply absent: no Prime Ouronet account id, no Prime Arweave seed id,
   * or no `#0` `ForeignKeyEntry` yet derived FOR that seed (see
   * `primeArweaveSeedId`'s own doc comment for why that entry IS "the
   * seed's stored address"). A genuine DERIVATION failure (the underlying
   * RSA-4096 re-derivation's promise rejecting) still propagates — T1's own
   * `checkArweaveRestoreEligibility` never swallows that into `false`, and
   * neither does this wrapper; "not eligible" and "the check itself broke"
   * must stay distinguishable.
   *
   * Defined ONCE here so BOTH the `checkArweaveRestoreEligibility` dep
   * field AND `backupCodex` below call the SAME function — `backupCodex`
   * calls it exactly once per backup, never a second time for the same
   * logical action (the derivation underneath is the same ~6.7s RSA-4096
   * cost the standalone eligibility check pays).
   */
  const resolveRestoreEligibility = async (): Promise<boolean> => {
    if (
      primeOuronetAccountId === undefined ||
      revealAccountSecret === undefined ||
      primeArweaveSeedId === undefined
    ) {
      return false;
    }
    const primeArweaveAddress = foreignKeys.find(
      (entry) => entry.seedId === primeArweaveSeedId && entry.index === 0,
    )?.address;
    if (primeArweaveAddress === undefined) return false;

    const ouronetBitstring = await revealAccountSecret(primeOuronetAccountId);
    if (ouronetBitstring === null || ouronetBitstring === "") return false;

    return deriveRestoreEligibility({
      ouronetBitstring,
      primeArweaveAddress,
      workerFactory,
    });
  };

  return {
    address: ownerAddress,

    // ── keyring (E1) — the app owns the ciphertext entries; no plaintext here ──
    foreignKeys,
    keygenRunner: createWorkerKeygenRunner({ workerFactory }),
    generateArweaveKey:
      persistence?.generateArweaveKey ??
      (async () => {
        throw new Error(
          "Arweave keygen cannot be persisted: no codex password seam was wired.",
        );
      }),
    importArweaveKey:
      persistence?.importArweaveKey ??
      (async () => {
        throw new Error(
          "Arweave import cannot be persisted: no codex password seam was wired.",
        );
      }),
    decryptArweaveKey,
    addForeignKey: persistence?.addForeignKey ?? (async () => {}),
    renameForeignKey: async () => {},
    deleteForeignKey: persistence?.deleteForeignKey ?? (async () => {}),

    // ── balance / send (E2) — real adapter against the resolved pool ──
    // The D3 `ForeignChainAdapter.getBalance` is deliberately loose
    // (`Promise<unknown>`); the real E1 adapter resolves a winston `bigint`, so
    // narrow it to the panel seam's `Promise<bigint>` contract.
    getBalance: async (addr: string): Promise<bigint> =>
      (await resolvedAdapter.getBalance(addr)) as bigint,
    send: async (_req: ArweaveSendRequest): Promise<ArweaveSendResult> => {
      throw new Error(
        "Real send requires an unlocked keyfile JWK; import one first.",
      );
    },
    sendFrom: async (
      entry: ForeignKeyEntry,
      req: ArweaveSendRequest,
    ): Promise<ArweaveSendResult> => {
      // Resolve the JWK ONLY at call time (never cached) — a re-locked codex
      // must fail the decrypt loudly rather than sign with a stale key. Any
      // failure at any of these three steps propagates unwrapped: a decrypt
      // failure, a `buildSend` validation error (bad target/amount/missing
      // cap), or a `post` failure (anchor/price/fee-cap/network) all surface
      // as their own error, never swallowed into a generic one.
      const jwk = await decryptArweaveKey(entry);
      // `BuildSendParams` (codex-arweave/src/adapter/arweaveAdapter.ts) has no
      // `quantity` field — only `amountAr`/`quantityWinston`. `resolvedAdapter`
      // is typed as the generic `ForeignChainAdapter`, whose `buildSend`
      // deliberately accepts `unknown[]` (it spans multiple chains with
      // different call shapes), so a wrong key name here compiles clean and
      // only breaks at runtime: the real `buildSend` reads
      // `params.quantityWinston`, sees `undefined`, and throws
      // `InvalidTransferError("non-positive-quantity")` — surfaced to the user
      // as "Invalid transfer: quantity must be a positive Winston bigint"
      // regardless of what amount they actually typed. Key MUST be
      // `quantityWinston`.
      const built = await resolvedAdapter.buildSend({
        target: req.target,
        quantityWinston: req.quantity,
        maxRewardWinston: req.maxRewardWinston,
      });
      return (await resolvedAdapter.post(built, jwk)) as ArweaveSendResult;
    },
    estimateFee: (byteSize: number, target: string): Promise<bigint> =>
      estimateFee(resolvedPool, byteSize, target),
    pollStatus: async (id: string): Promise<"pending" | "final"> => {
      // E3's pollStatus is void — it flips the store entry to `final` on deep
      // confirmation. Read the entry back to surface the current status the
      // panel's poll seam contract returns.
      await pollStatus(id, { pool: resolvedPool, store });
      const entry = await store.get(id);
      return entry?.status ?? "pending";
    },

    // ── upload / library (E3) — real flows against the resolved pool + store ──
    // `uploadAndTrack`/`uploadFilesAndTrack` now receive an explicit
    // `accountId` (Bug 1 fix, `arweave-upload-wizard-account-wiring`) —
    // `UploadWizard`'s own Account step selection, forwarded verbatim by
    // `ArweavePanelDeps`'s caller. `findEntryForAddress` resolves THAT id's
    // key (never the construction-time `ownerAddress`), and the JWK is
    // decrypted at CALL time (never cached), same discipline as `sendFrom`
    // above — so picking a different account in the wizard actually signs
    // with a different key.
    //
    // `arweave-streaming-worker-wiring` T3-revised: the actual
    // upload-performing call now goes through `resolvedStreamingUploadRunner`
    // (off-main-thread, Worker-backed in real use) INSTEAD OF calling
    // `library/flow.ts`'s `uploadAndTrack` directly — everything else below
    // (JWK resolution, fee cap, the bundle-vs-single-file result-shape
    // guards) is unchanged. `selection.encryptFor`'s live
    // `revealAccountSecret` CALLBACK cannot cross the runner's Worker
    // boundary (functions are not structured-cloneable), so it is resolved
    // into a plain `CryptoKey` HERE, on the main thread, via the now-exported
    // `resolveEncryptionKey` — exactly where `library/flow.ts`'s own
    // `uploadAndTrack` resolves it today. Only the already-resolved key, plus
    // the callback-free `{ accountId, accountAddress }` identity, cross into
    // `.run()`; a caller that picked Public (`encryptFor` absent) resolves
    // `undefined`, unchanged from before this task.
    uploadAndTrack: async (file, selection, accountId, callbacks?: UploadWizardUploadCallbacks) => {
      const jwk = await decryptArweaveKey(findEntryForAddress(foreignKeys, accountId));
      const data = new Uint8Array(await file.arrayBuffer());
      const maxRewardWinston = await bufferedFeeCap(resolvedPool, data.byteLength);
      const { encryptFor, ...selectionRest } = selection;
      const resolvedKey = encryptFor ? await resolveEncryptionKey(encryptFor) : undefined;
      const result = await resolvedStreamingUploadRunner.run(
        {
          jwk,
          data,
          contentType: file.type || "application/octet-stream",
          maxRewardWinston,
          ...selectionRest,
        },
        resolvedKey,
        {
          store,
          pool: resolvedPool,
          encryptFor: encryptFor
            ? { accountId: encryptFor.accountId, accountAddress: encryptFor.accountAddress }
            : undefined,
          onRoute: callbacks?.onRouteDecided,
          onProgress: callbacks?.onProgress,
        },
      );
      // The runner only takes the bundle path for a `files` array of 2+ — a
      // plain (non-`files`) `UploadParams` call, as above, ALWAYS resolves
      // the single-file `UploadResult` shape `UploadTrackResult` matches
      // verbatim.
      if ("manifestId" in result) {
        throw new Error("Unexpected bundle result from a single-file upload.");
      }
      return result;
    },
    uploadFilesAndTrack: async (files, selection, accountId, callbacks?: UploadWizardUploadCallbacks) => {
      const jwk = await decryptArweaveKey(findEntryForAddress(foreignKeys, accountId));
      const bundleFiles = await Promise.all(
        files.map(async (file) => ({
          path: file.webkitRelativePath || file.name,
          data: new Uint8Array(await file.arrayBuffer()),
          contentType: file.type || "application/octet-stream",
        })),
      );
      const totalBytes = bundleFiles.reduce((sum, f) => sum + f.data.byteLength, 0);
      const maxRewardWinston = await bufferedFeeCap(resolvedPool, totalBytes);
      const { encryptFor, ...selectionRest } = selection;
      const resolvedKey = encryptFor ? await resolveEncryptionKey(encryptFor) : undefined;
      const result = await resolvedStreamingUploadRunner.run(
        { jwk, files: bundleFiles, maxRewardWinston, ...selectionRest },
        resolvedKey,
        {
          store,
          pool: resolvedPool,
          encryptFor: encryptFor
            ? { accountId: encryptFor.accountId, accountAddress: encryptFor.accountAddress }
            : undefined,
          onRoute: callbacks?.onRouteDecided,
          onProgress: callbacks?.onProgress,
        },
      );
      // `files.length >= 2` ALWAYS takes the runner's bundle path.
      if (!("manifestId" in result)) {
        throw new Error("Unexpected single-file result from a bundle upload.");
      }
      return result;
    },
    // `arweave-upload-dry-run` T3: the "Test this upload" button's real
    // wiring — mirrors `uploadAndTrack`/`uploadFilesAndTrack`'s own JWK/
    // encryptFor resolution exactly, but routes into the Worker-backed
    // `resolvedStreamingDryRunRunner` (never `store`/Library — T2's own
    // `runUploadDryRun` takes no `store` param at all, by construction) and
    // uses a FIXED fee cap rather than a live `estimateFee` quote (see
    // `DRY_RUN_MAX_REWARD_WINSTON`'s own doc comment: a dry run must reach
    // zero real network, including for its own fee-cap bookkeeping).
    runDryRunUpload: async (
      files: File[],
      selection: UploadWizardSelection,
      accountId: string,
    ): Promise<DryRunResult> => {
      const jwk = await decryptArweaveKey(findEntryForAddress(foreignKeys, accountId));
      const { encryptFor, ...selectionRest } = selection;
      const resolvedKey = encryptFor ? await resolveEncryptionKey(encryptFor) : undefined;

      const first = files[0];
      if (first === undefined) {
        throw new Error("runDryRunUpload requires at least one file.");
      }

      const params =
        files.length >= 2
          ? {
              jwk,
              files: await Promise.all(
                files.map(async (file) => ({
                  path: file.webkitRelativePath || file.name,
                  data: new Uint8Array(await file.arrayBuffer()),
                  contentType: file.type || "application/octet-stream",
                })),
              ),
              maxRewardWinston: DRY_RUN_MAX_REWARD_WINSTON,
              ...selectionRest,
            }
          : {
              jwk,
              data: new Uint8Array(await first.arrayBuffer()),
              contentType: first.type || "application/octet-stream",
              maxRewardWinston: DRY_RUN_MAX_REWARD_WINSTON,
              ...selectionRest,
            };

      return resolvedStreamingDryRunRunner.run(params, resolvedKey, { pool: resolvedPool });
    },
    // `arweave-streaming-ui-support-probe-worker`: the REAL fix for
    // `UploadWizard`'s own `isStreamingUploadSupported` prop — see this
    // function's own return-type doc comment above for why this exists
    // outside `ArweavePanelDeps` itself.
    isStreamingUploadSupported: (): Promise<boolean> => resolvedSupportProbeRunner.check(),
    // `arweave-non-removable-account` T5: the dead-letter gap's host-app half
    // — forwarded verbatim to `ArweavePanelDeps.onAccountUsedForEncryption`,
    // which `UploadWizard` calls straight through after a successful
    // Encrypted upload. Left `undefined` when the caller wires none (never a
    // synthesized no-op), exactly like `getExportJson`/`onBackupSuccess` above.
    onAccountUsedForEncryption,
    listLibrary: (owner: string): Promise<LibraryEntry[]> =>
      store.list(owner),
    openUrl: (id: string, opts?: { pool: GatewayPool }) =>
      openUrl(id, { pool: opts?.pool ?? resolvedPool }),
    rebuildLibrary: async (owner: string, opts: { pool: GatewayPool }) => {
      await rebuildLibrary(owner, {
        pool: opts.pool ?? resolvedPool,
        store,
      });
    },
    libraryStore: store,
    pool: resolvedPool,

    // ── codex backup (arweave-upload-categories T5) ──
    getExportJson: getExportJson ?? (async () => ""),
    // `codex-seed-restore-activation` T2/T3: HOST-SUPPLIED, zero-argument —
    // the host already holds the Prime Ouronet account's bitstring and the
    // Prime Arweave seed's stored address, so it answers this itself
    // (`ArweaveRestoreEligibilityStatus` drives this; `codex-arweave`'s UI
    // layer never touches an Ouronet account's bitstring directly).
    checkArweaveRestoreEligibility: resolveRestoreEligibility,
    backupCodex: async (payload: string) => {
      if (getExportJson === undefined) {
        throw new Error(
          "Real codex backup requires the codex's own export payload; wire " +
            "`getExportJson` (useCodexBackup().exportForCloud) into buildRealPanelDeps.",
        );
      }
      const jwk = await decryptArweaveKey(findEntryForAddress(foreignKeys, ownerAddress));
      const maxRewardWinston = await bufferedFeeCap(
        resolvedPool,
        new TextEncoder().encode(payload).byteLength,
      );

      // T3: the base options are EXACTLY what `backupCodex` has always
      // passed — the eligibility-gated recovery params below are ADDED on
      // top only when the codex is genuinely eligible AND the seed's own
      // bits are actually readable right now; an ineligible/unreadable
      // codex gets the identical call it always got (no new keys at all,
      // not even `undefined`-valued ones — an explicit regression guard).
      const backupOptions: Parameters<typeof backupCodexToLibrary>[1] = {
        store,
        pool: resolvedPool,
        jwk,
        maxRewardWinston,
        onSuccess: onBackupSuccess,
      };

      // ONE eligibility check per backup call — never a second RSA-4096
      // re-derivation for the same logical action (see
      // `resolveRestoreEligibility`'s own doc comment).
      const eligible = await resolveRestoreEligibility();
      if (
        eligible &&
        primeArweaveSeedId !== undefined &&
        revealArweaveSeedSecret !== undefined &&
        getPassword !== undefined
      ) {
        const primeArweaveSeedBitstring = await revealArweaveSeedSecret(primeArweaveSeedId);
        if (primeArweaveSeedBitstring !== null && primeArweaveSeedBitstring !== "") {
          const cryptoSeam: CryptoSeam = { encrypt: encryptStringV2, decrypt: smartDecrypt };
          backupOptions.codexPassword = getPassword();
          backupOptions.primeArweaveSeedBitstring = primeArweaveSeedBitstring;
          backupOptions.cryptoSeam = cryptoSeam;
        }
      }

      const result = await backupCodexToLibrary(payload, backupOptions);
      return { id: result.id };
    },

    // ── address book (D5) — the codex entries the app mapped in ──
    addressBook,
  };
}
