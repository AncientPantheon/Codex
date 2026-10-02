/**
 * T3 (`arweave-non-removable-account`) RED matrix —
 * `checkAccountEncryptedArweaveUploads`, the chain-query safety net.
 *
 * Pins the three behaviors the design calls out explicitly:
 *   - a matching `Codex-Encryptor: <address>` record on chain → resolves true;
 *   - zero matching records (a well-formed, empty GraphQL response) → resolves
 *     false — "no matches" is never an error;
 *   - a genuine network/gateway failure (e.g. a non-2xx gateway response)
 *     PROPAGATES — it must never be swallowed into a silent `false`, which
 *     would be a fail-open bug for what is meant to be a safety check.
 *
 * Reuses the E3 `makeHealthPool`/`makeFetchFn`/`graphqlRebuildBody` helpers —
 * `graphqlRebuildBody` wraps records into the exact `data.transactions`
 * GraphQL shape `queryUploadsByTag` (same `parsePage` as `queryOwnerUploads`)
 * parses, so it is reused verbatim rather than duplicating a second fixture
 * builder for the identical response shape.
 */

import { describe, it, expect } from "vitest";

import { TAG_CODEX_ENCRYPTOR, type Tag } from "@ancientpantheon/arweave-core";

import { checkAccountEncryptedArweaveUploads } from "../src/library/checkEncryptionSafety.js";

import { KNOWN_ADDRESS, CANONICAL_ID_A, makeFetchFn, makeHealthPool, graphqlRebuildBody } from "./e3-helpers";

const ADDRESS = KNOWN_ADDRESS;

const encryptorTag: Tag = { name: TAG_CODEX_ENCRYPTOR, value: ADDRESS };

describe("checkAccountEncryptedArweaveUploads — chain-query safety net (T3)", () => {
  it("resolves true when the gateway returns at least one matching Codex-Encryptor record", async () => {
    const pool = makeHealthPool();
    const fetchFn = makeFetchFn(
      200,
      graphqlRebuildBody([{ id: CANONICAL_ID_A, tags: [encryptorTag] }]),
    );

    const result = await checkAccountEncryptedArweaveUploads(pool, ADDRESS, { fetchFn });

    expect(result).toBe(true);
  });

  it("resolves false when the gateway returns a well-formed, empty edges array (no matches is never an error)", async () => {
    const pool = makeHealthPool();
    const fetchFn = makeFetchFn(200, graphqlRebuildBody([]));

    const result = await checkAccountEncryptedArweaveUploads(pool, ADDRESS, { fetchFn });

    expect(result).toBe(false);
  });

  it("PROPAGATES a genuine gateway failure rather than silently resolving false (fail-safe, never fail-open)", async () => {
    const pool = makeHealthPool();
    // A non-2xx gateway response is a genuine failure, not "no matches".
    const fetchFn = makeFetchFn(500, { error: "gateway unavailable" });

    await expect(
      checkAccountEncryptedArweaveUploads(pool, ADDRESS, { fetchFn }),
    ).rejects.toThrow();
  });
});
