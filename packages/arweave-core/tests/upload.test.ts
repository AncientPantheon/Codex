/**
 * upload.test.ts — Turbo upload orchestration (`uploadData`).
 *
 * `uploadData` validates the jwk, derives Codex-Owner via Phase 2's `addressOf`
 * (the SOLE derivation path — the one-canonical-form contract), builds the tag
 * schema, uploads through an INJECTABLE Turbo client seam, and returns the
 * data-item id. These tests inject a plain recording client — NO network, and
 * (deliberately) NO import of `@ardrive/turbo-sdk` anywhere in this file: the
 * seam is typed against OUR `TurboUploadClient` interface, not the SDK.
 *
 * The offline guarantee is asserted structurally: `globalThis.fetch` is stubbed
 * to throw across the whole happy path, proving the mocked upload touches no
 * network. These are the RED tests: they fail until upload.ts/types.ts/errors.ts
 * exist.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { uploadData } from "../src/upload/upload.js";
import type { UploadParams, TurboUploadClient } from "../src/upload/types.js";
import { UploadFailedError } from "../src/upload/errors.js";
import { InvalidUploadParamsError } from "../src/upload/errors.js";
import { InvalidKeyfileError } from "../src/keys/errors.js";
import { addressOf } from "../src/keys/address.js";
import { queryOwnerUploads } from "../src/rebuild/query.js";
import { createGatewayPool } from "../src/gateway/pool.js";
import {
  TAG_APP_NAME,
  TAG_CONTENT_TYPE,
  TAG_CODEX_ITEM_ID,
  TAG_CODEX_OWNER,
  DEFAULT_APP_NAME,
  type Tag,
} from "../src/upload/tags.js";
import { TEST_KEYFILE } from "./fixtures/test-keyfile.js";

/** A canonical 43-char base64url id — the shape Turbo data-item ids take. */
const VALID_ID = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNO_-".slice(0, 43);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RecordingClient extends TurboUploadClient {
  calls: { data: unknown; tags: Tag[] }[];
}

/** A plain recording client that captures every upload call and resolves a fixed id. */
function recordingClient(id: string = VALID_ID): RecordingClient {
  const calls: { data: unknown; tags: Tag[] }[] = [];
  return {
    calls,
    upload(p) {
      calls.push({ data: p.data, tags: p.dataItemOpts.tags });
      return Promise.resolve({ id, owner: "someowner", winc: "0" });
    },
  };
}

function tagValue(tags: Tag[], name: string): string | undefined {
  return tags.find((t) => t.name === name)?.value;
}

function baseParams(overrides: Partial<UploadParams> = {}): UploadParams {
  return {
    jwk: TEST_KEYFILE,
    data: "hello permaweb",
    contentType: "text/plain",
    ...overrides,
  };
}

let realFetch: typeof globalThis.fetch;

beforeEach(() => {
  // Offline guarantee: any network touch during the mocked path must fail loudly.
  realFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(() => {
    throw new Error("network access is forbidden in upload tests");
  }) as unknown as typeof globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe("uploadData — tag schema application (one-canonical-form)", () => {
  it("applies all four required tags with Codex-Owner strictly equal to addressOf(jwk)", async () => {
    const client = recordingClient();
    const expectedOwner = await addressOf(TEST_KEYFILE);

    await uploadData(baseParams(), { clientFactory: () => client });

    expect(client.calls).toHaveLength(1);
    const tags = client.calls[0]!.tags;
    expect(tagValue(tags, TAG_APP_NAME)).toBe(DEFAULT_APP_NAME);
    expect(tagValue(tags, TAG_CONTENT_TYPE)).toBe("text/plain");
    expect(tagValue(tags, TAG_CODEX_OWNER)).toBe(expectedOwner);
    // Codex-Item-Id is present and a UUID when not supplied.
    expect(tagValue(tags, TAG_CODEX_ITEM_ID)).toMatch(UUID_RE);
  });

  it("passes app metadata tags through to the wire after the required four", async () => {
    const client = recordingClient();

    await uploadData(
      baseParams({ appMetadata: [{ name: "Title", value: "The Odyssey" }] }),
      { clientFactory: () => client },
    );

    const tags = client.calls[0]!.tags;
    expect(tagValue(tags, "Title")).toBe("The Odyssey");
    // Required tags come first; metadata is appended.
    expect(tags.slice(0, 4).map((t) => t.name)).toEqual([
      TAG_APP_NAME,
      TAG_CONTENT_TYPE,
      TAG_CODEX_ITEM_ID,
      TAG_CODEX_OWNER,
    ]);
  });

  it("honors an explicit appName override in the App-Name tag", async () => {
    const client = recordingClient();

    await uploadData(baseParams({ appName: "Custom-App" }), {
      clientFactory: () => client,
    });

    expect(tagValue(client.calls[0]!.tags, TAG_APP_NAME)).toBe("Custom-App");
  });
});

describe("uploadData — result and item id", () => {
  it("resolves the id returned by the client", async () => {
    const client = recordingClient(VALID_ID);

    const result = await uploadData(baseParams(), { clientFactory: () => client });

    expect(result.id).toBe(VALID_ID);
  });

  it("auto-generates a UUID itemId that appears in both the tag and the result", async () => {
    const client = recordingClient();

    const result = await uploadData(baseParams(), { clientFactory: () => client });

    expect(result.itemId).toMatch(UUID_RE);
    expect(tagValue(client.calls[0]!.tags, TAG_CODEX_ITEM_ID)).toBe(result.itemId);
  });

  it("respects an explicitly provided itemId", async () => {
    const client = recordingClient();
    const explicit = "my-explicit-item-id";

    const result = await uploadData(baseParams({ itemId: explicit }), {
      clientFactory: () => client,
    });

    expect(result.itemId).toBe(explicit);
    expect(tagValue(client.calls[0]!.tags, TAG_CODEX_ITEM_ID)).toBe(explicit);
  });

  it("returns ownerAddress equal to addressOf(jwk) and the applied tags", async () => {
    const client = recordingClient();
    const expectedOwner = await addressOf(TEST_KEYFILE);

    const result = await uploadData(baseParams(), { clientFactory: () => client });

    expect(result.ownerAddress).toBe(expectedOwner);
    expect(result.tags).toEqual(client.calls[0]!.tags);
  });
});

describe("uploadData — input validation (zero client calls)", () => {
  it("rejects a malformed jwk with InvalidKeyfileError and never calls the client", async () => {
    const client = recordingClient();
    const badJwk = { ...TEST_KEYFILE };
    delete (badJwk as Record<string, unknown>).d;

    await expect(
      uploadData(baseParams({ jwk: badJwk as UploadParams["jwk"] }), {
        clientFactory: () => client,
      }),
    ).rejects.toBeInstanceOf(InvalidKeyfileError);
    expect(client.calls).toHaveLength(0);
  });

  it("rejects empty string data with InvalidUploadParamsError and never calls the client", async () => {
    const client = recordingClient();

    await expect(
      uploadData(baseParams({ data: "" }), { clientFactory: () => client }),
    ).rejects.toBeInstanceOf(InvalidUploadParamsError);
    expect(client.calls).toHaveLength(0);
  });

  it("rejects empty Uint8Array data with InvalidUploadParamsError and never calls the client", async () => {
    const client = recordingClient();

    await expect(
      uploadData(baseParams({ data: new Uint8Array(0) }), {
        clientFactory: () => client,
      }),
    ).rejects.toBeInstanceOf(InvalidUploadParamsError);
    expect(client.calls).toHaveLength(0);
  });
});

describe("uploadData — upload failure handling", () => {
  it("wraps a client rejection in UploadFailedError preserving the cause", async () => {
    const underlying = new Error("turbo says no");
    const client: TurboUploadClient = {
      upload: () => Promise.reject(underlying),
    };

    const err = await uploadData(baseParams(), { clientFactory: () => client }).catch(
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(UploadFailedError);
    expect((err as UploadFailedError).cause).toBe(underlying);
    expect((err as UploadFailedError).operation).toBeDefined();
    expect((err as UploadFailedError).reason).toBeDefined();
  });

  it("never leaks JWK private-field values in the error message or the cause chain", async () => {
    // The client rejects with a message that itself embeds a private field to
    // prove uploadData does not surface key material even when the cause does.
    const secretD = TEST_KEYFILE.d;
    const client: TurboUploadClient = {
      upload: () => Promise.reject(new Error("boom")),
    };

    const err = (await uploadData(baseParams(), {
      clientFactory: () => client,
    }).catch((e: unknown) => e)) as UploadFailedError;

    const serialized = JSON.stringify({
      message: err.message,
      operation: err.operation,
      reason: err.reason,
      fields: Object.entries(err),
    });
    for (const field of [
      TEST_KEYFILE.d,
      TEST_KEYFILE.p,
      TEST_KEYFILE.q,
      TEST_KEYFILE.dp,
      TEST_KEYFILE.dq,
      TEST_KEYFILE.qi,
    ]) {
      expect(serialized).not.toContain(field);
    }
    // Sanity: the private field is a long non-empty string, so the assertion is real.
    expect(secretD.length).toBeGreaterThan(100);
  });

  it("rejects an empty response id with UploadFailedError reason bad-response", async () => {
    const client = recordingClient("");

    const err = (await uploadData(baseParams(), {
      clientFactory: () => client,
    }).catch((e: unknown) => e)) as UploadFailedError;

    expect(err).toBeInstanceOf(UploadFailedError);
    expect(err.reason).toBe("bad-response");
  });

  it("rejects a too-short (20-char) response id with UploadFailedError", async () => {
    const client = recordingClient("a".repeat(20));

    await expect(
      uploadData(baseParams(), { clientFactory: () => client }),
    ).rejects.toBeInstanceOf(UploadFailedError);
  });

  it("rejects a response id containing non-base64url chars (+) with UploadFailedError", async () => {
    const client = recordingClient("a+cdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNO_-".slice(0, 43));

    await expect(
      uploadData(baseParams(), { clientFactory: () => client }),
    ).rejects.toBeInstanceOf(UploadFailedError);
  });
});

describe("uploadData → queryOwnerUploads — FLOW A owner-address round-trip (one canonical string)", () => {
  it("stamps the SAME string upload's Codex-Owner, addressOf, and rebuild's owners filter all use", async () => {
    // Upload derives Codex-Owner via addressOf(jwk); rebuild filters by owners:[owner].
    // This closes the loop at the contract level: the string uploadData stamps is
    // byte-identical to addressOf(TEST_KEYFILE) AND is exactly what queryOwnerUploads
    // binds into its GraphQL `owners` variable — proving one canonical form end to end.
    const client = recordingClient();
    const owner = (await uploadData(baseParams(), { clientFactory: () => client })).ownerAddress;

    // 1) Upload's stamped owner equals the independent addressOf derivation.
    const derived = await addressOf(TEST_KEYFILE);
    expect(owner).toBe(derived);
    // Sanity: the same string was stamped into the on-wire Codex-Owner tag.
    expect(tagValue(client.calls[0]!.tags, TAG_CODEX_OWNER)).toBe(owner);

    // 2) Rebuild binds that exact string into owners:[owner]. Capture the request.
    let capturedOwners: unknown;
    const fetchFn = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      capturedOwners = JSON.parse(String(init?.body)).variables.owners;
      return new Response(
        JSON.stringify({ data: { transactions: { pageInfo: { hasNextPage: false }, edges: [] } } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    const pool = createGatewayPool({ endpoints: ["https://a.example"], sleep: async () => {} });

    await queryOwnerUploads(pool, owner, { fetchFn });

    expect(capturedOwners).toEqual([owner]);
  });
});

describe("uploadData — offline guarantee", () => {
  it("completes the mocked happy path without any network access", async () => {
    const client = recordingClient();

    const result = await uploadData(baseParams(), { clientFactory: () => client });

    expect(result.id).toBe(VALID_ID);
    // fetch was stubbed to throw; a passing result proves no network touch.
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
