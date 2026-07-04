/**
 * public-api.test.ts — surface lock for the package barrel (`src/index.ts`).
 *
 * The barrel is the package's ONLY public contract: everything a consumer of
 * `@ancientpantheon/arweave-core` can reach flows through it. This suite locks
 * that surface three ways so the contract cannot silently drift:
 *
 *   (a) every intended VALUE export is present and of the right runtime kind
 *       (function / class-constructor / bigint) — a rename or accidental drop
 *       fails here before it reaches a consumer;
 *   (b) every public error class is `instanceof`-usable ON THE BARREL-IMPORTED
 *       constructor — the Goal contract forbids message parsing, so consumers
 *       MUST be able to catch by identity. This includes the errors thrown
 *       transitively (`InvalidGatewayConfigError` via `createGatewayPool`,
 *       `InvalidBase64UrlError` via `addressOf`) — every thrown public error is
 *       itself exported;
 *   (c) NEGATIVE surface lock — the barrel does NOT re-export internal helpers
 *       that were deliberately kept private (the base64url encode/decode
 *       FUNCTIONS in encoding.ts). Only the error CLASS from that module is
 *       public. This catches an accidental `export *` widening the surface.
 *
 * DECODE/ENCODE PUBLIC DECISION (recorded here and in task notes): the
 * base64url `base64urlEncode` / `base64urlDecode` FUNCTIONS are INTERNAL — they
 * are an implementation detail of `addressOf` and the keyfile-length check, not
 * part of the phase's public surface. Only `InvalidBase64UrlError` (thrown
 * through `addressOf`) is public, per the every-thrown-error-exported rule.
 */

import { describe, it, expect } from "vitest";

import * as api from "../src/index.js";
import {
  isCanonicalAddress,
  ARWEAVE_ADDRESS_RE,
  createGatewayPool,
  GatewayPoolExhaustedError,
  InvalidGatewayConfigError,
  WINSTON_PER_AR,
  arToWinston,
  winstonToAr,
  InvalidAmountError,
  generateKey,
  importKeyfile,
  exportKeyfile,
  InvalidKeyfileError,
  addressOf,
  InvalidBase64UrlError,
  DEFAULT_KEY_DERIVATION_FLAGS,
  generateFromMnemonic,
  deriveFromEthereumSignature,
  KeyDerivationDisabledError,
  KeyDerivationNotImplementedError,
  // ── Phase 3: signing ─────────────────────────────────────────────────────
  signTransaction,
  SigningError,
  // ── Phase 3: transfer ────────────────────────────────────────────────────
  sendTransfer,
  InvalidTransferError,
  TransferPostFailedError,
  InvalidGatewayPriceError,
  RewardExceedsCapError,
  // ── Phase 3: shared endpoint policy ──────────────────────────────────────
  UnsupportedEndpointError,
  // ── Phase 3: reads ───────────────────────────────────────────────────────
  getBalance,
  getTransactionStatus,
  DEFAULT_CONFIRMATION_DEPTH,
  InvalidAddressError,
  InvalidTransactionIdError,
  InvalidGatewayResponseError,
  // ── Phase 4: upload ──────────────────────────────────────────────────────
  uploadData,
  buildUploadTags,
  DEFAULT_APP_NAME,
  TAG_APP_NAME,
  TAG_CONTENT_TYPE,
  TAG_CODEX_ITEM_ID,
  TAG_CODEX_OWNER,
  REQUIRED_UPLOAD_TAG_NAMES,
  InvalidUploadParamsError,
  UploadFailedError,
  // ── Phase 4: rebuild ─────────────────────────────────────────────────────
  queryOwnerUploads,
  DEFAULT_REBUILD_PAGE_SIZE,
  DEFAULT_REBUILD_MAX_PAGES,
  RebuildPageLimitError,
  InvalidRebuildParamsError,
} from "../src/index.js";
import { TEST_KEYFILE } from "./fixtures/test-keyfile.js";

describe("public API barrel — value exports present and correctly typed", () => {
  it("exports the gateway pool factory as a function", () => {
    expect(typeof createGatewayPool).toBe("function");
  });

  it("exports the shared canonical-address predicate and its regexp", () => {
    // The ONE fund-relevant 43-char base64url gate every read/transfer/upload/
    // rebuild path uses — public so a consumer validating an id before composing
    // a gateway URL gates on the exact same form the library does.
    expect(typeof isCanonicalAddress).toBe("function");
    // A canonical 43-char base64url string passes; a 42-char one and a string with
    // an out-of-alphabet char (`!`) are rejected — driving the predicate from input.
    expect(isCanonicalAddress("A".repeat(43))).toBe(true);
    expect(isCanonicalAddress("A".repeat(42))).toBe(false);
    expect(isCanonicalAddress("A".repeat(42) + "!")).toBe(false);
    // The regexp is exported too and matches the predicate's decision exactly.
    expect(ARWEAVE_ADDRESS_RE).toBeInstanceOf(RegExp);
    expect(ARWEAVE_ADDRESS_RE.test("A".repeat(43))).toBe(true);
  });

  it("exports the unit-conversion functions and the WINSTON_PER_AR bigint constant", () => {
    expect(typeof arToWinston).toBe("function");
    expect(typeof winstonToAr).toBe("function");
    // A bigint, not a number — precision at every magnitude depends on it.
    expect(typeof WINSTON_PER_AR).toBe("bigint");
    expect(WINSTON_PER_AR).toBe(1_000_000_000_000n);
  });

  it("exports the key-management functions", () => {
    expect(typeof generateKey).toBe("function");
    expect(typeof importKeyfile).toBe("function");
    expect(typeof exportKeyfile).toBe("function");
    expect(typeof addressOf).toBe("function");
    expect(typeof generateFromMnemonic).toBe("function");
    expect(typeof deriveFromEthereumSignature).toBe("function");
  });

  it("exports the frozen default derivation flags with both paths OFF", () => {
    expect(DEFAULT_KEY_DERIVATION_FLAGS).toEqual({
      mnemonic: false,
      ethareum: false,
    });
    expect(Object.isFrozen(DEFAULT_KEY_DERIVATION_FLAGS)).toBe(true);
  });

  it("exports every error class as a constructable class", () => {
    for (const Err of [
      GatewayPoolExhaustedError,
      InvalidGatewayConfigError,
      InvalidAmountError,
      InvalidKeyfileError,
      InvalidBase64UrlError,
      KeyDerivationDisabledError,
      KeyDerivationNotImplementedError,
    ]) {
      expect(typeof Err).toBe("function");
      // A class constructor carries a prototype object; a plain fn value would not.
      expect(Err.prototype).toBeInstanceOf(Error);
    }
  });
});

describe("public API barrel — error classes are instanceof-usable on the barrel constructor", () => {
  it("re-imported InvalidGatewayConfigError catches the SYNCHRONOUS config-validation throw", () => {
    // Thrown transitively by createGatewayPool — must be catchable by identity.
    let caught: unknown;
    try {
      createGatewayPool({ endpoints: [] });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(InvalidGatewayConfigError);
  });

  it("re-imported InvalidAmountError catches an arToWinston rejection", () => {
    let caught: unknown;
    try {
      arToWinston("not-a-number");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(InvalidAmountError);
  });

  it("re-imported InvalidKeyfileError catches an importKeyfile rejection", () => {
    let caught: unknown;
    try {
      importKeyfile({ kty: "EC" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(InvalidKeyfileError);
  });

  it("re-imported InvalidBase64UrlError catches the addressOf decode throw", async () => {
    // `=` padding is corruption the strict decoder rejects — thrown through addressOf.
    await expect(addressOf({ n: "AB=" })).rejects.toBeInstanceOf(
      InvalidBase64UrlError,
    );
  });

  it("re-imported KeyDerivationDisabledError catches the default-OFF mnemonic stub", async () => {
    await expect(generateFromMnemonic("phrase")).rejects.toBeInstanceOf(
      KeyDerivationDisabledError,
    );
  });

  it("re-imported KeyDerivationNotImplementedError catches a forced-ON derivation", async () => {
    await expect(
      deriveFromEthereumSignature(new Uint8Array([1]), {
        mnemonic: false,
        ethareum: true,
      }),
    ).rejects.toBeInstanceOf(KeyDerivationNotImplementedError);
  });
});

describe("public API barrel — exported functions are the real implementations", () => {
  it("addressOf derives the fixture's 43-char address through the barrel export", async () => {
    // Proves the barrel re-exports the working implementation, not a stub.
    const address = await addressOf(TEST_KEYFILE);
    expect(address).toHaveLength(43);
    expect(address).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("import/export round-trips the fixture through the barrel exports", () => {
    expect(importKeyfile(exportKeyfile(TEST_KEYFILE))).toEqual(TEST_KEYFILE);
  });
});

describe("public API barrel — negative surface lock", () => {
  it("does NOT export the internal base64url encode/decode helper FUNCTIONS", () => {
    // Deliberate decision: encode/decode are private implementation detail of
    // addressOf and the keyfile-length guard. Only InvalidBase64UrlError is public.
    expect("base64urlEncode" in api).toBe(false);
    expect("base64urlDecode" in api).toBe(false);
    expect((api as Record<string, unknown>).base64urlEncode).toBeUndefined();
    expect((api as Record<string, unknown>).base64urlDecode).toBeUndefined();
  });

  it("does NOT export internal gateway/health helpers", () => {
    // createHealthTracker and the pool's internal seams stay private-by-default.
    expect((api as Record<string, unknown>).createHealthTracker).toBeUndefined();
  });

  it("does NOT export the internal per-endpoint arweave-js client factory", () => {
    // Decision (T3.4/T3.6/T3.7): the endpoint-client factory is an internal seam
    // of the tx module — consumers configure gateways via the pool, not by minting
    // arweave-js instances. Only the tx module reaches it (via a relative import).
    expect((api as Record<string, unknown>).arweaveForEndpoint).toBeUndefined();
    expect(
      (api as Record<string, unknown>).createEndpointClientFactory,
    ).toBeUndefined();
  });

  it("does NOT export the internal origin-only assertion helper", () => {
    // Decision (T3.7): assertOriginOnlyEndpoints is an internal pre-flight helper
    // run inside sendTransfer/getBalance/getTransactionStatus. Only the error CLASS
    // it throws (UnsupportedEndpointError) is public, per the every-thrown-error-
    // exported rule — mirroring the encoding encode/decode private-by-default call.
    expect(
      (api as Record<string, unknown>).assertOriginOnlyEndpoints,
    ).toBeUndefined();
  });
});

describe("public API barrel — Phase 3 value exports present and correctly typed", () => {
  it("exports the isolated signer function", () => {
    expect(typeof signTransaction).toBe("function");
  });

  it("exports the transfer orchestration and read functions", () => {
    expect(typeof sendTransfer).toBe("function");
    expect(typeof getBalance).toBe("function");
    expect(typeof getTransactionStatus).toBe("function");
  });

  it("exports DEFAULT_CONFIRMATION_DEPTH as the documented number 10", () => {
    // The pending-vs-final threshold (handoff CONFIRM_DEPTH); a consumer tuning
    // finality depends on this exact default.
    expect(typeof DEFAULT_CONFIRMATION_DEPTH).toBe("number");
    expect(DEFAULT_CONFIRMATION_DEPTH).toBe(10);
  });

  it("exports every Phase 3 error class as a constructable Error subclass", () => {
    for (const Err of [
      SigningError,
      InvalidTransferError,
      TransferPostFailedError,
      InvalidGatewayPriceError,
      RewardExceedsCapError,
      UnsupportedEndpointError,
      InvalidAddressError,
      InvalidTransactionIdError,
      InvalidGatewayResponseError,
    ]) {
      expect(typeof Err).toBe("function");
      expect(Err.prototype).toBeInstanceOf(Error);
    }
  });
});

describe("public API barrel — Phase 3 error classes are instanceof-usable on the barrel constructor", () => {
  it("re-imported UnsupportedEndpointError catches the sendTransfer origin-only pre-flight throw", async () => {
    // A pathed endpoint is a deterministic caller-config error surfaced UNWRAPPED
    // by the eager pre-flight — must be catchable by identity off the barrel.
    const pool = createGatewayPool({ endpoints: ["https://gw.example/api"] });
    await expect(
      sendTransfer(pool, {
        jwk: TEST_KEYFILE,
        target: "A".repeat(43),
        quantity: 1n,
        maxRewardWinston: 1_000_000_000n,
      }),
    ).rejects.toBeInstanceOf(UnsupportedEndpointError);
  });

  it("re-imported InvalidTransferError catches a non-positive-quantity transfer", async () => {
    // Quantity 0n is rejected before any pool attempt — a structured caller error.
    const pool = createGatewayPool({ endpoints: ["https://arweave.net"] });
    await expect(
      sendTransfer(pool, {
        jwk: TEST_KEYFILE,
        target: "A".repeat(43),
        quantity: 0n,
        maxRewardWinston: 1_000_000_000n,
      }),
    ).rejects.toBeInstanceOf(InvalidTransferError);
  });

  it("re-imported InvalidAddressError catches a getBalance address rejection", async () => {
    // A too-short address fails the canonical form before any network call.
    const pool = createGatewayPool({ endpoints: ["https://arweave.net"] });
    await expect(getBalance(pool, "too-short")).rejects.toBeInstanceOf(
      InvalidAddressError,
    );
  });

  it("re-imported InvalidTransactionIdError catches a getTransactionStatus id rejection", async () => {
    // A malformed txid fails the canonical form before any network call.
    const pool = createGatewayPool({ endpoints: ["https://arweave.net"] });
    await expect(
      getTransactionStatus(pool, "not-a-valid-txid"),
    ).rejects.toBeInstanceOf(InvalidTransactionIdError);
  });

  it("re-imported SigningError is a distinct constructable class from the barrel", () => {
    // Wraps a crypto-driver failure; consumers catch it by identity, never by
    // message. Constructing it proves the barrel re-exports the real class.
    const err = new SigningError("rsa-pss-deephash-sign", new Error("driver"));
    expect(err).toBeInstanceOf(SigningError);
    expect(err).toBeInstanceOf(Error);
    expect(err.operation).toBe("rsa-pss-deephash-sign");
  });
});

describe("public API barrel — Phase 4 value exports present and correctly typed", () => {
  it("exports the upload orchestrator and pure tag builder as functions", () => {
    expect(typeof uploadData).toBe("function");
    expect(typeof buildUploadTags).toBe("function");
  });

  it("exports the rebuild query as a function", () => {
    expect(typeof queryOwnerUploads).toBe("function");
  });

  it("exports the pinned DEFAULT_APP_NAME literal shared by upload and rebuild", () => {
    // The ONE place the app-name value lives; upload and rebuild key their filter
    // pair on this exact string, so a drift here silently breaks rebuild matching.
    expect(DEFAULT_APP_NAME).toBe("AncientPantheon-Codex");
  });

  it("exports the four required tag-name constants with exact schema casing", () => {
    // GraphQL tag matching is exact-string: these names are the load-bearing
    // contract shared between the upload writer and the rebuild reader.
    expect(TAG_APP_NAME).toBe("App-Name");
    expect(TAG_CONTENT_TYPE).toBe("Content-Type");
    expect(TAG_CODEX_ITEM_ID).toBe("Codex-Item-Id");
    expect(TAG_CODEX_OWNER).toBe("Codex-Owner");
  });

  it("exports REQUIRED_UPLOAD_TAG_NAMES as the four names in canonical order", () => {
    expect(REQUIRED_UPLOAD_TAG_NAMES).toEqual([
      "App-Name",
      "Content-Type",
      "Codex-Item-Id",
      "Codex-Owner",
    ]);
  });

  it("exports DEFAULT_REBUILD_PAGE_SIZE as the documented gateway maximum 100", () => {
    // The GraphQL `first` default; 100 is the arweave.net cap, so a consumer
    // tuning page size must be able to introspect the ceiling this default sits at.
    expect(typeof DEFAULT_REBUILD_PAGE_SIZE).toBe("number");
    expect(DEFAULT_REBUILD_PAGE_SIZE).toBe(100);
  });

  it("exports DEFAULT_REBUILD_MAX_PAGES as the documented page cap 50", () => {
    // This default decides when RebuildPageLimitError fires; a consumer catching
    // that error must be able to read the cap that governs it.
    expect(typeof DEFAULT_REBUILD_MAX_PAGES).toBe("number");
    expect(DEFAULT_REBUILD_MAX_PAGES).toBe(50);
  });

  it("exports every Phase 4 error class as a constructable Error subclass", () => {
    for (const Err of [
      InvalidUploadParamsError,
      UploadFailedError,
      InvalidRebuildParamsError,
      RebuildPageLimitError,
    ]) {
      expect(typeof Err).toBe("function");
      expect(Err.prototype).toBeInstanceOf(Error);
    }
  });
});

describe("public API barrel — Phase 4 tag builder is the real implementation", () => {
  it("buildUploadTags emits the four required tags first through the barrel export", async () => {
    // Proves the barrel re-exports the working builder, not a stub — and that the
    // required-first ordering (the schema contract) survives the re-export.
    const ownerAddress = await addressOf(TEST_KEYFILE);
    const tags = buildUploadTags({
      ownerAddress,
      contentType: "text/plain",
      itemId: "item-1",
    });
    expect(tags.slice(0, 4)).toEqual([
      { name: "App-Name", value: DEFAULT_APP_NAME },
      { name: "Content-Type", value: "text/plain" },
      { name: "Codex-Item-Id", value: "item-1" },
      { name: "Codex-Owner", value: ownerAddress },
    ]);
  });
});

describe("public API barrel — Phase 4 error classes are instanceof-usable on the barrel constructor", () => {
  it("re-imported InvalidUploadParamsError catches a malformed-owner buildUploadTags throw", () => {
    // A 42-char owner fails the canonical form before any tag is emitted — the
    // schema's load-bearing field, catchable by identity off the barrel.
    let caught: unknown;
    try {
      buildUploadTags({
        ownerAddress: "A".repeat(42),
        contentType: "text/plain",
        itemId: "item-1",
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(InvalidUploadParamsError);
  });

  it("re-imported UploadFailedError is a distinct constructable class from the barrel", () => {
    // Thrown when the Turbo client rejects or returns a bad id; consumers catch it
    // by identity. Constructing it proves the barrel re-exports the real class and
    // preserves the cause chain.
    const cause = new Error("client rejected");
    const err = new UploadFailedError("upload-rejected", { cause });
    expect(err).toBeInstanceOf(UploadFailedError);
    expect(err).toBeInstanceOf(Error);
    expect(err.reason).toBe("upload-rejected");
    expect(err.cause).toBe(cause);
  });

  it("re-imported InvalidRebuildParamsError catches an out-of-range pageSize before any pool call", async () => {
    // pageSize 101 exceeds the gateway maximum and is rejected with zero pool
    // attempts — a structured caller error catchable by identity.
    const pool = createGatewayPool({ endpoints: ["https://arweave.net"] });
    await expect(
      queryOwnerUploads(pool, "A".repeat(43), { pageSize: 101 }),
    ).rejects.toBeInstanceOf(InvalidRebuildParamsError);
  });

  it("re-imported InvalidAddressError catches a queryOwnerUploads owner rejection", async () => {
    // A too-short owner fails the canonical form before any pool attempt — the
    // reads-module error is REUSED by rebuild (no duplicate class) and remains
    // catchable by identity off the barrel.
    const pool = createGatewayPool({ endpoints: ["https://arweave.net"] });
    await expect(
      queryOwnerUploads(pool, "too-short"),
    ).rejects.toBeInstanceOf(InvalidAddressError);
  });

  it("re-imported RebuildPageLimitError is a distinct constructable class from the barrel", () => {
    // Thrown when pagination cannot complete within maxPages; consumers catch it by
    // identity and read the structured page/record counts.
    const err = new RebuildPageLimitError(50, 4200);
    expect(err).toBeInstanceOf(RebuildPageLimitError);
    expect(err).toBeInstanceOf(Error);
    expect(err.pagesFetched).toBe(50);
    expect(err.recordsCollected).toBe(4200);
  });
});

describe("public API barrel — Phase 4 negative surface lock", () => {
  it("does NOT export the internal default Turbo client factory", () => {
    // Decision (mirrors T3.7's endpoint-client-factory call): the default factory
    // is an internal seam — the ONLY runtime site importing @ardrive/turbo-sdk.
    // Consumers inject a custom client via uploadData's options rather than minting
    // SDK clients through us; a browser consumer aliases the SDK to its web build.
    expect((api as Record<string, unknown>).defaultTurboClientFactory).toBeUndefined();
  });
});
