/**
 * codec codexIdentity allow-list — closes a reader/writer contradiction
 * found by a downstream consumer (OuronetUI), not a user-reported incident.
 *
 * `deriveBackupLineage()` (`packages/codex-arweave/src/library/flow.ts`)
 * reads `parsed.codexIdentity.formatted` from an opaque, already-parsed
 * backup envelope to derive an `appId` lineage tag for Arweave backup
 * posts — its own doc comment explicitly claims this is safe because
 * `codexIdentity` "is not one of the three documented secret-ciphertext
 * fields." That claim is about DECRYPTION safety, not about whether the
 * SHAPE GATE (`deserializeCodex`'s own allow-list) would accept the field
 * at all — and before this fix, it would not: `codexIdentity` was absent
 * from `KNOWN_TOP_LEVEL_FIELDS`, so any envelope that DID carry it would
 * throw `CodexUnknownFieldError` from `deserializeCodex` — including from
 * `reencryptBackupSecretFields`'s own internal `deserializeCodex` call,
 * meaning the backup path itself would fail on its own output.
 *
 * `buildBackupPayload` (`packages/codex-ui/src/hooks/useCodexBackup.ts`)
 * never emits `codexIdentity` into the wire envelope at all — a DELIBERATE
 * omission (`buildSnapshotFromState`'s own comment: "PRESERVE the
 * double-Apollo identity + per-consumer settings the sharding adapter
 * shards: the wire format omits them") — so in practice `appId` has always
 * resolved to `undefined`, not a live crash. This suite only closes the
 * reader-side landmine (allow-listing the field so it round-trips cleanly
 * IF a future caller or writer ever does emit it) — it deliberately does
 * NOT change `buildBackupPayload` to start emitting `codexIdentity`; that
 * omission is an intentional privacy/security decision, out of scope here.
 *
 * Mirrors `codec-watchlist-allowlist.test.ts`'s own pattern, narrowed to
 * what's actually needed: `codexIdentity` carries no dedicated shape
 * validator (unlike `foreignKeys`/`pureKeypairs`/`arweaveSeeds`/
 * `watchList`) because `deriveBackupLineage` already does its own narrow,
 * defensive, unknown-safe property reads independently — a second
 * validator here would just duplicate that discipline.
 *
 * Pure unit tests — no WebCrypto, no fs, no network.
 */

import { describe, it, expect } from "vitest";
import {
  deserializeCodex,
  CodexUnknownFieldError,
} from "../src";

function baseEnvelope(extra: Record<string, unknown> = {}) {
  return {
    version: "1.3",
    exportedAt: new Date().toISOString(),
    kadenaWallets: [],
    ouronetWallets: [],
    addressBook: [],
    uiSettings: {},
    ...extra,
  };
}

describe("codec — codexIdentity allow-list (FIX-codexidentity)", () => {
  it("(a) an envelope carrying codexIdentity round-trips WITHOUT CodexUnknownFieldError", () => {
    const json = JSON.stringify(
      baseEnvelope({ codexIdentity: { formatted: "ABC-123" } }),
    );
    expect(() => deserializeCodex(json)).not.toThrow();
  });

  it("(b) the allow-listed codexIdentity value is returned, opaque, unvalidated", () => {
    const json = JSON.stringify(
      baseEnvelope({ codexIdentity: { formatted: "ABC-123", extra: 1 } }),
    );
    const parsed = deserializeCodex(json) as unknown as {
      codexIdentity?: { formatted?: string };
    };
    expect(parsed.codexIdentity).toEqual({ formatted: "ABC-123", extra: 1 });
  });

  it("(c) an envelope WITHOUT codexIdentity still round-trips (field stays optional)", () => {
    const json = JSON.stringify(baseEnvelope());
    const parsed = deserializeCodex(json) as unknown as {
      codexIdentity?: unknown;
    };
    expect(parsed.codexIdentity).toBeUndefined();
  });

  it("(d) a genuinely-unknown field alongside codexIdentity still throws (allow-list stays narrow)", () => {
    const json = JSON.stringify(
      baseEnvelope({
        codexIdentity: { formatted: "ABC-123" },
        totallyUnknownField: 1,
      }),
    );
    expect(() => deserializeCodex(json)).toThrow(CodexUnknownFieldError);
  });
});
