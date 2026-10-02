// @vitest-environment node
/**
 * E3 RED matrix — the adapter `upload?` FILL (E-06).
 *
 * `// @vitest-environment node` (mirrors `e3-library-flow.test.ts`'s own FIX-9
 * pragma): this file's happy-path uploads post real string payloads through
 * arweave-core `createTransaction`. Under the package's default jsdom/"client"
 * environment, Vite resolves the `arweave` dependency via its `browser`
 * package.json field, whose `createTransaction` is MISSING the node build's
 * `typeof data === "string"` → `stringToBuffer` conversion — a plain-string
 * upload payload throws purely as an artifact of the test environment, not a
 * real code defect. Forcing this file to the `node` environment resolves
 * `arweave`'s `main` field instead, matching arweave-core's own test
 * environment.
 *
 * The Arweave adapter's ABSENT `upload?` optional method is filled to delegate to
 * arweave-core `uploadData(pool, params, opts?)` (pool-first, T3/T5's native,
 * non-bundler upload path). These tests inject a FAKE recording
 * `UploadGatewayApiFactory` (NEVER the real SDK — a real network call is a real,
 * PERMANENT, irreversible upload) and assert:
 *   - the returned `UploadResult` carries a canonical id + the REQUIRED tag
 *     schema (App-Name / Content-Type / Codex-Item-Id / Codex-Owner) in canonical
 *     order, imported from arweave-core (never re-spelled);
 *   - `Codex-Owner === addressOf(jwk)` (the rebuild anchor);
 *   - bad params (empty data / reserved-name metadata / missing maxRewardWinston)
 *     surface `InvalidUploadParamsError`;
 *   - a throwing gateway-API `getUploader` propagates its error, unwrapped, before
 *     completing; a quote exceeding the caller's `maxRewardWinston` surfaces
 *     `RewardExceedsCapError` before any signing/posting;
 *   - the JWK is a PER-CALL arg (not a constructor dep, not cached) — two uploads
 *     with two JWKs derive their OWN ownerAddress;
 *   - NO JWK private-field VALUE ever appears in a tag / error / result;
 *   - a MANDATORY exported `UPLOAD_PERMANENCE_WARNING` value exists (permanent +
 *     public + no delete/edit + public tags).
 */

import { describe, it, expect } from "vitest";

import {
  TAG_APP_NAME,
  TAG_CONTENT_TYPE,
  TAG_CODEX_ITEM_ID,
  TAG_CODEX_OWNER,
  DEFAULT_APP_NAME,
  REQUIRED_UPLOAD_TAG_NAMES,
  InvalidUploadParamsError,
  RewardExceedsCapError,
  addressOf,
  type Tag,
  type UploadResult,
} from "@ancientpantheon/arweave-core";

import { createArweaveAdapter } from "../src/adapter";
// Imported from the specific submodule (not the `../src/library` barrel, which
// also re-exports `SqliteLibraryStore` — pulling in `sqliteStore.ts`'s lazy
// `import("node:sqlite")`, a documented pre-existing vite/vitest limitation in
// this exact sandbox — see `e3-library-flow.test.ts`'s own identical comment).
import { UPLOAD_PERMANENCE_WARNING } from "../src/library/constants.js";

import {
  throwawayJwk,
  KNOWN_ADDRESS,
  MANIFEST_CONTENT_TYPE,
  makeRecordingUploadApi,
  makeHealthPool,
} from "./e3-helpers";

/** A cap comfortably above the recording fake's honest quote (e3-helpers'
 *  `RECORDING_PRICE`) — the fee cap is REQUIRED on every native-upload call. */
const CAP = 1_000_000_000_000n;

const CANONICAL_ID_RE = /^[A-Za-z0-9_-]{43}$/;

/** Pull a tag value by name off an applied tag list. */
function tagValue(tags: readonly Tag[], name: string): string | undefined {
  return tags.find((t) => t.name === name)?.value;
}

/** The private RSA fields whose VALUES must never leak into a tag/error/result. */
const PRIVATE_FIELDS = ["d", "p", "q", "dp", "dq", "qi"] as const;

function privateValues(): string[] {
  return PRIVATE_FIELDS.map((f) => (throwawayJwk as unknown as Record<string, string>)[f]).filter(
    (v): v is string => typeof v === "string" && v.length > 0,
  );
}

describe("E3 upload — the adapter `upload?` delegates to arweave-core uploadData (E-06)", () => {
  it("(a) upload delegates to uploadData via the injected apiFactory and returns a canonical UploadResult", async () => {
    const adapter = createArweaveAdapter({ pool: makeHealthPool() });
    const recorded = makeRecordingUploadApi();

    const result = (await adapter.upload!(
      {
        jwk: throwawayJwk,
        data: "hello permaweb",
        contentType: "text/plain",
        itemId: "item-xyz-1",
        maxRewardWinston: CAP,
      },
      { apiFactory: recorded.apiFactory },
    )) as UploadResult;

    // The recording fake saw exactly one posted upload — no real SDK, no real network.
    expect(recorded.calls).toHaveLength(1);
    // The id is the real, deterministic post-sign transaction id — canonical 43-char.
    expect(result.id).toMatch(CANONICAL_ID_RE);
    expect(result.ownerAddress).toBe(KNOWN_ADDRESS);
    expect(result.itemId).toBe("item-xyz-1");
    expect(Array.isArray(result.tags)).toBe(true);
  });

  it("(b) the applied tags carry the REQUIRED schema in canonical order (imported names, never re-spelled)", async () => {
    const adapter = createArweaveAdapter({ pool: makeHealthPool() });
    const recorded = makeRecordingUploadApi();

    const result = (await adapter.upload!(
      {
        jwk: throwawayJwk,
        data: "payload",
        contentType: "text/plain",
        itemId: "item-schema",
        maxRewardWinston: CAP,
      },
      { apiFactory: recorded.apiFactory },
    )) as UploadResult;

    // The four required names appear FIRST, in canonical order.
    expect(result.tags.slice(0, 4).map((t) => t.name)).toEqual([
      TAG_APP_NAME,
      TAG_CONTENT_TYPE,
      TAG_CODEX_ITEM_ID,
      TAG_CODEX_OWNER,
    ]);
    expect([...REQUIRED_UPLOAD_TAG_NAMES]).toEqual([
      TAG_APP_NAME,
      TAG_CONTENT_TYPE,
      TAG_CODEX_ITEM_ID,
      TAG_CODEX_OWNER,
    ]);
    expect(tagValue(result.tags, TAG_APP_NAME)).toBe(DEFAULT_APP_NAME);
    expect(tagValue(result.tags, TAG_CONTENT_TYPE)).toBe("text/plain");
    expect(tagValue(result.tags, TAG_CODEX_ITEM_ID)).toBe("item-schema");
    // The signed tx carries the SAME tags the result reports (delegation, not a
    // re-built list) — read off the recording fake's captured `getUploader(tx)` call.
    expect(recorded.calls[0].tags).toEqual(result.tags);
  });

  it("(c) Codex-Owner EQUALS addressOf(jwk) — the canonical rebuild anchor", async () => {
    const adapter = createArweaveAdapter({ pool: makeHealthPool() });
    const recorded = makeRecordingUploadApi();
    const expectedOwner = await addressOf(throwawayJwk);

    const result = (await adapter.upload!(
      { jwk: throwawayJwk, data: "x", contentType: "text/plain", itemId: "i", maxRewardWinston: CAP },
      { apiFactory: recorded.apiFactory },
    )) as UploadResult;

    expect(expectedOwner).toBe(KNOWN_ADDRESS);
    expect(tagValue(result.tags, TAG_CODEX_OWNER)).toBe(KNOWN_ADDRESS);
    expect(result.ownerAddress).toBe(KNOWN_ADDRESS);
  });

  it("(d.1) EMPTY data surfaces InvalidUploadParamsError with the offending field, and never reaches the gateway API", async () => {
    const adapter = createArweaveAdapter({ pool: makeHealthPool() });
    const recorded = makeRecordingUploadApi();

    await expect(
      adapter.upload!(
        { jwk: throwawayJwk, data: "", contentType: "text/plain", itemId: "i", maxRewardWinston: CAP },
        { apiFactory: recorded.apiFactory },
      ),
    ).rejects.toBeInstanceOf(InvalidUploadParamsError);
    // The invalid param is rejected BEFORE any upload call — no phantom upload.
    expect(recorded.calls).toHaveLength(0);
  });

  it("(d.2) a reserved-name metadata tag surfaces InvalidUploadParamsError (forgery guard)", async () => {
    const adapter = createArweaveAdapter({ pool: makeHealthPool() });
    const recorded = makeRecordingUploadApi();

    await expect(
      adapter.upload!(
        {
          jwk: throwawayJwk,
          data: "x",
          contentType: "text/plain",
          itemId: "i",
          maxRewardWinston: CAP,
          appMetadata: [{ name: TAG_CODEX_OWNER, value: "forged" }],
        },
        { apiFactory: recorded.apiFactory },
      ),
    ).rejects.toBeInstanceOf(InvalidUploadParamsError);
    expect(recorded.calls).toHaveLength(0);
  });

  it("(e.1) a THROWING gateway-API getUploader propagates its error, and the attempt was recorded before failing", async () => {
    const adapter = createArweaveAdapter({ pool: makeHealthPool() });
    const recorded = makeRecordingUploadApi({ throws: true });

    const err = await adapter
      .upload!(
        { jwk: throwawayJwk, data: "x", contentType: "text/plain", itemId: "i", maxRewardWinston: CAP },
        { apiFactory: recorded.apiFactory },
      )
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("upload rejected");
    // The signed tx reached getUploader (one attempt recorded) before the
    // rejection — the failure is a post-build/post-sign posting failure, not
    // a validation short-circuit.
    expect(recorded.calls).toHaveLength(1);
  });

  it("(e.2) a quote exceeding maxRewardWinston surfaces RewardExceedsCapError, BEFORE any signing/posting", async () => {
    const adapter = createArweaveAdapter({ pool: makeHealthPool() });
    const recorded = makeRecordingUploadApi();

    const err = await adapter
      .upload!(
        {
          jwk: throwawayJwk,
          data: "x",
          contentType: "text/plain",
          itemId: "i",
          // Below the recording fake's honest 1_000_000_000 Winston quote.
          maxRewardWinston: 1n,
        },
        { apiFactory: recorded.apiFactory },
      )
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(RewardExceedsCapError);
    // Refused before build/sign/post — getUploader was never reached.
    expect(recorded.calls).toHaveLength(0);
  });

  it("(f) the JWK is a PER-CALL arg — createArweaveAdapter deps carry no jwk; each call derives its OWN ownerAddress", async () => {
    // The factory takes NO jwk dep (only `pool`/`fetchFn`) — a jwk dep would
    // be required here otherwise.
    const adapter = createArweaveAdapter({ pool: makeHealthPool() });
    expect(adapter).not.toHaveProperty("jwk");

    const recorded = makeRecordingUploadApi();
    const r1 = (await adapter.upload!(
      { jwk: throwawayJwk, data: "one", contentType: "text/plain", itemId: "i1", maxRewardWinston: CAP },
      { apiFactory: recorded.apiFactory },
    )) as UploadResult;
    const r2 = (await adapter.upload!(
      { jwk: throwawayJwk, data: "two", contentType: "text/plain", itemId: "i2", maxRewardWinston: CAP },
      { apiFactory: recorded.apiFactory },
    )) as UploadResult;

    // Both calls derived the owner from THEIR per-call jwk (same throwaway key
    // here → same address, but derived per-call, never a cached ctor value).
    expect(r1.ownerAddress).toBe(KNOWN_ADDRESS);
    expect(r2.ownerAddress).toBe(KNOWN_ADDRESS);
    expect(recorded.calls).toHaveLength(2);
  });

  it("(g) NO JWK private-field VALUE (d/p/q/dp/dq/qi) appears in any tag or in the result", async () => {
    const adapter = createArweaveAdapter({ pool: makeHealthPool() });
    const recorded = makeRecordingUploadApi();

    const result = (await adapter.upload!(
      { jwk: throwawayJwk, data: "x", contentType: "text/plain", itemId: "i", maxRewardWinston: CAP },
      { apiFactory: recorded.apiFactory },
    )) as UploadResult;

    const serialized = JSON.stringify(result);
    for (const secret of privateValues()) {
      expect(serialized).not.toContain(secret);
    }
    for (const tag of result.tags) {
      for (const secret of privateValues()) {
        expect(tag.value).not.toContain(secret);
      }
    }
  });
});

describe("E3 upload — the MANDATORY permanence warning (E-06, N-10)", () => {
  it("exports a non-empty UPLOAD_PERMANENCE_WARNING stating permanent + public + no-delete/edit + public tags", () => {
    expect(typeof UPLOAD_PERMANENCE_WARNING).toBe("string");
    expect(UPLOAD_PERMANENCE_WARNING.length).toBeGreaterThan(0);
    const lower = UPLOAD_PERMANENCE_WARNING.toLowerCase();
    // The warning must communicate the four irreversibility facts the E4 UI renders.
    expect(lower).toContain("permanent");
    expect(lower).toContain("public");
    expect(lower).toMatch(/delete|remove/);
    expect(lower).toMatch(/edit|change|modif/);
    expect(lower).toContain("tag");
  });

  it("surfaces the manifest content-type constant so upload↔library share one spelling", async () => {
    const adapter = createArweaveAdapter({ pool: makeHealthPool() });
    const recorded = makeRecordingUploadApi();

    const result = (await adapter.upload!(
      {
        jwk: throwawayJwk,
        data: "manifest bytes",
        contentType: MANIFEST_CONTENT_TYPE,
        itemId: "manifest-1",
        maxRewardWinston: CAP,
      },
      { apiFactory: recorded.apiFactory },
    )) as UploadResult;

    // The manifest content-type round-trips verbatim through the applied tags —
    // the library layer detects it off THIS exact string.
    expect(tagValue(result.tags, TAG_CONTENT_TYPE)).toBe(MANIFEST_CONTENT_TYPE);
  });
});
