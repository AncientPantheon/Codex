/**
 * E3 RED matrix — the adapter `upload?` FILL (E-06).
 *
 * The Arweave adapter's ABSENT `upload?` optional method is filled to delegate to
 * arweave-core `uploadData(params, opts?)`. These tests inject a FAKE recording
 * Turbo `clientFactory` (NEVER the real SDK — a real Turbo call is a real,
 * PERMANENT, irreversible upload) and assert:
 *   - the returned `UploadResult` carries the canonical id + the REQUIRED tag
 *     schema (App-Name / Content-Type / Codex-Item-Id / Codex-Owner) in canonical
 *     order, imported from arweave-core (never re-spelled);
 *   - `Codex-Owner === addressOf(jwk)` (the rebuild anchor);
 *   - bad params (empty data / reserved-name metadata / non-canonical owner)
 *     surface `InvalidUploadParamsError`;
 *   - a throwing client → `UploadFailedError("upload-rejected")`; a non-canonical
 *     returned id → `UploadFailedError("bad-response")`;
 *   - the JWK is a PER-CALL arg (not a constructor dep, not cached) — two uploads
 *     with two JWKs derive their OWN ownerAddress;
 *   - NO JWK private-field VALUE ever appears in a tag / error / result;
 *   - a MANDATORY exported `UPLOAD_PERMANENCE_WARNING` value exists (permanent +
 *     public + no delete/edit + public tags).
 *
 * RED: `upload` is ABSENT on the adapter + `UPLOAD_PERMANENCE_WARNING` does not
 * exist yet → these fail on import / on the missing method.
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
  UploadFailedError,
  addressOf,
  type Tag,
  type UploadResult,
} from "@ancientpantheon/arweave-core";

// RED: `upload` is not yet on the adapter surface; `UPLOAD_PERMANENCE_WARNING`
// does not yet exist. Both imports resolve only after GREEN (T13.4).
import { createArweaveAdapter } from "../src/adapter";
import { UPLOAD_PERMANENCE_WARNING } from "../src/library";

import {
  throwawayJwk,
  KNOWN_ADDRESS,
  CANONICAL_ID_A,
  NON_CANONICAL_ID,
  MANIFEST_CONTENT_TYPE,
  makeRecordingTurboClient,
} from "./e3-helpers";

/** Pull a tag value by name off an applied tag list. */
function tagValue(tags: readonly Tag[], name: string): string | undefined {
  return tags.find((t) => t.name === name)?.value;
}

/** The private RSA fields whose VALUES must never leak into a tag/error/result. */
const PRIVATE_FIELDS = ["d", "p", "q", "dp", "dq", "qi"] as const;

function privateValues(): string[] {
  return PRIVATE_FIELDS.map((f) => (throwawayJwk as Record<string, string>)[f]).filter(
    (v): v is string => typeof v === "string" && v.length > 0,
  );
}

describe("E3 upload — the adapter `upload?` delegates to arweave-core uploadData (E-06)", () => {
  it("(a) upload delegates to uploadData via the injected clientFactory and returns a canonical UploadResult", async () => {
    const adapter = createArweaveAdapter();
    const turbo = makeRecordingTurboClient({ id: CANONICAL_ID_A });

    const result: UploadResult = await adapter.upload!(
      {
        jwk: throwawayJwk,
        data: "hello permaweb",
        contentType: "text/plain",
        itemId: "item-xyz-1",
      },
      { clientFactory: turbo.factory },
    );

    // The recording client saw exactly one upload — no real SDK, no real network.
    expect(turbo.calls).toHaveLength(1);
    // The returned id is the client's id, and it is canonical 43-char.
    expect(result.id).toBe(CANONICAL_ID_A);
    expect(result.id).toHaveLength(43);
    expect(result.ownerAddress).toBe(KNOWN_ADDRESS);
    expect(result.itemId).toBe("item-xyz-1");
    expect(Array.isArray(result.tags)).toBe(true);
  });

  it("(b) the applied tags carry the REQUIRED schema in canonical order (imported names, never re-spelled)", async () => {
    const adapter = createArweaveAdapter();
    const turbo = makeRecordingTurboClient();

    const result = await adapter.upload!(
      {
        jwk: throwawayJwk,
        data: "payload",
        contentType: "text/plain",
        itemId: "item-schema",
      },
      { clientFactory: turbo.factory },
    );

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
    // The client received the SAME tags the result reports (delegation, not a
    // re-built list).
    expect(turbo.calls[0].tags).toEqual(result.tags);
  });

  it("(c) Codex-Owner EQUALS addressOf(jwk) — the canonical rebuild anchor", async () => {
    const adapter = createArweaveAdapter();
    const turbo = makeRecordingTurboClient();
    const expectedOwner = await addressOf(throwawayJwk);

    const result = await adapter.upload!(
      { jwk: throwawayJwk, data: "x", contentType: "text/plain", itemId: "i" },
      { clientFactory: turbo.factory },
    );

    expect(expectedOwner).toBe(KNOWN_ADDRESS);
    expect(tagValue(result.tags, TAG_CODEX_OWNER)).toBe(KNOWN_ADDRESS);
    expect(result.ownerAddress).toBe(KNOWN_ADDRESS);
  });

  it("(d.1) EMPTY data surfaces InvalidUploadParamsError with the offending field, and never reaches the client", async () => {
    const adapter = createArweaveAdapter();
    const turbo = makeRecordingTurboClient();

    await expect(
      adapter.upload!(
        { jwk: throwawayJwk, data: "", contentType: "text/plain", itemId: "i" },
        { clientFactory: turbo.factory },
      ),
    ).rejects.toBeInstanceOf(InvalidUploadParamsError);
    // The invalid param is rejected BEFORE any upload call — no phantom upload.
    expect(turbo.calls).toHaveLength(0);
  });

  it("(d.2) a reserved-name metadata tag surfaces InvalidUploadParamsError (forgery guard)", async () => {
    const adapter = createArweaveAdapter();
    const turbo = makeRecordingTurboClient();

    await expect(
      adapter.upload!(
        {
          jwk: throwawayJwk,
          data: "x",
          contentType: "text/plain",
          itemId: "i",
          appMetadata: [{ name: TAG_CODEX_OWNER, value: "forged" }],
        },
        { clientFactory: turbo.factory },
      ),
    ).rejects.toBeInstanceOf(InvalidUploadParamsError);
    expect(turbo.calls).toHaveLength(0);
  });

  it("(e.1) a THROWING Turbo client surfaces UploadFailedError('upload-rejected')", async () => {
    const adapter = createArweaveAdapter();
    const turbo = makeRecordingTurboClient({ throws: true });

    const err = await adapter
      .upload!(
        { jwk: throwawayJwk, data: "x", contentType: "text/plain", itemId: "i" },
        { clientFactory: turbo.factory },
      )
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(UploadFailedError);
    expect((err as UploadFailedError).message).toContain("upload-rejected");
  });

  it("(e.2) a client returning a NON-canonical id surfaces UploadFailedError('bad-response')", async () => {
    const adapter = createArweaveAdapter();
    const turbo = makeRecordingTurboClient({ id: NON_CANONICAL_ID });

    const err = await adapter
      .upload!(
        { jwk: throwawayJwk, data: "x", contentType: "text/plain", itemId: "i" },
        { clientFactory: turbo.factory },
      )
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(UploadFailedError);
    expect((err as UploadFailedError).message).toContain("bad-response");
  });

  it("(f) the JWK is a PER-CALL arg — createArweaveAdapter deps carry no jwk; each call derives its OWN ownerAddress", async () => {
    // The factory is constructible with NO jwk (a jwk dep would be required here).
    const adapter = createArweaveAdapter();
    expect(adapter).not.toHaveProperty("jwk");

    const turbo = makeRecordingTurboClient();
    const r1 = await adapter.upload!(
      { jwk: throwawayJwk, data: "one", contentType: "text/plain", itemId: "i1" },
      { clientFactory: turbo.factory },
    );
    const r2 = await adapter.upload!(
      { jwk: throwawayJwk, data: "two", contentType: "text/plain", itemId: "i2" },
      { clientFactory: turbo.factory },
    );

    // Both calls derived the owner from THEIR per-call jwk (same throwaway key
    // here → same address, but derived per-call, never a cached ctor value).
    expect(r1.ownerAddress).toBe(KNOWN_ADDRESS);
    expect(r2.ownerAddress).toBe(KNOWN_ADDRESS);
    // The client saw both jwks per-call (the delegate forwards the per-call key).
    // Value-equality (not reference): uploadData normalizes the jwk via
    // importKeyfile before handing it to the client, so a correct thin delegate
    // yields a value-equal (canonical 9-field) object, not the same reference.
    expect(turbo.calls).toHaveLength(2);
    expect(turbo.calls[0].jwk).toStrictEqual(throwawayJwk);
    expect(turbo.calls[1].jwk).toStrictEqual(throwawayJwk);
  });

  it("(g) NO JWK private-field VALUE (d/p/q/dp/dq/qi) appears in any tag or in the result", async () => {
    const adapter = createArweaveAdapter();
    const turbo = makeRecordingTurboClient();

    const result = await adapter.upload!(
      { jwk: throwawayJwk, data: "x", contentType: "text/plain", itemId: "i" },
      { clientFactory: turbo.factory },
    );

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
    const adapter = createArweaveAdapter();
    const turbo = makeRecordingTurboClient();

    const result = await adapter.upload!(
      {
        jwk: throwawayJwk,
        data: "manifest bytes",
        contentType: MANIFEST_CONTENT_TYPE,
        itemId: "manifest-1",
      },
      { clientFactory: turbo.factory },
    );

    // The manifest content-type round-trips verbatim through the applied tags —
    // the library layer detects it off THIS exact string.
    expect(tagValue(result.tags, TAG_CONTENT_TYPE)).toBe(MANIFEST_CONTENT_TYPE);
  });
});
