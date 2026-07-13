/**
 * `rekeyCodex` — codex password-rotation primitive (Handoff 07).
 *
 * Real crypto (PBKDF2-SHA512/600k) — decrypt-old → re-encrypt-new per field is
 * 2 KDF passes each, so the round-trip fixture is kept compact and timeouts are
 * generous.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { encryptStringV2, smartDecrypt, WrongPasswordError } from "@stoachain/stoa-core/crypto";
import {
  rekeyCodex,
  collectCodexPasswordSecrets,
  CODEX_IDENTITY_SECRET_FIELDS,
} from "@ancientpantheon/codex-ouronet/rekey";
import type { CodexSnapshot } from "@ancientpantheon/codex-ouronet/types";

const OLD = "old-codex-password-01";
const NEW = "new-codex-password-02";
const T = { timeout: 120_000 };

/** Build a snapshot whose every secret field is a real V2 blob under `pw`. */
async function makeSnapshot(pw: string): Promise<CodexSnapshot> {
  const enc = (label: string) => encryptStringV2(`plain:${label}`, pw);
  return {
    schemaVersion: 3,
    lastUpdatedAt: null,
    lastUpdatedDevice: "main",
    uiSettings: {} as CodexSnapshot["uiSettings"],
    kadenaSeeds: [{ id: "ks1", secret: await enc("ks1") }],
    ouroAccounts: [{ id: "oa1", secret: await enc("oa1-secret"), backup: await enc("oa1-backup") }],
    pureKeypairs: [{ id: "pk1", encryptedPrivateKey: await enc("pk1") }],
    foreignKeys: [{ id: "fk1", encryptedKeyfile: await enc("fk1") }],
    codexIdentity: {
      encryptedSeedWords: await enc("id-seed"),
      encryptedStandardBitstring: await enc("id-std-bits"),
    },
  } as unknown as CodexSnapshot;
}

describe("rekeyCodex", () => {
  let snap: CodexSnapshot;
  beforeAll(async () => { snap = await makeSnapshot(OLD); }, T.timeout);

  it("re-keys every secret from old→new so all decrypt under the new password", async () => {
    const before = structuredClone(snap);
    const { snapshot: out, skipped } = await rekeyCodex(snap, OLD, NEW);

    expect(skipped).toEqual([]);
    // Input is never mutated (pure).
    expect(snap).toEqual(before);

    // Every field now decrypts under NEW back to its original plaintext.
    expect(await smartDecrypt(out.kadenaSeeds[0].secret, NEW)).toBe("plain:ks1");
    expect(await smartDecrypt(out.ouroAccounts[0].secret, NEW)).toBe("plain:oa1-secret");
    expect(await smartDecrypt(out.ouroAccounts[0].backup, NEW)).toBe("plain:oa1-backup");
    expect(await smartDecrypt(out.pureKeypairs[0].encryptedPrivateKey, NEW)).toBe("plain:pk1");
    expect(await smartDecrypt(out.foreignKeys![0].encryptedKeyfile, NEW)).toBe("plain:fk1");
    expect(await smartDecrypt(out.codexIdentity!.encryptedSeedWords, NEW)).toBe("plain:id-seed");
    expect(await smartDecrypt(out.codexIdentity!.encryptedStandardBitstring, NEW)).toBe("plain:id-std-bits");

    // The old ciphertext no longer decrypts under NEW (it was genuinely re-keyed).
    await expect(smartDecrypt(before.kadenaSeeds[0].secret, NEW)).rejects.toThrow();
  }, T.timeout);

  it("throws WrongPasswordError on a bad old password and mutates nothing", async () => {
    const before = structuredClone(snap);
    await expect(rekeyCodex(snap, "not-the-password", NEW)).rejects.toBeInstanceOf(WrongPasswordError);
    expect(snap).toEqual(before);
  }, T.timeout);

  it("skips (does not drop) a field encrypted under a different password", async () => {
    const foreign = await encryptStringV2("plain:foreign", "some-other-password");
    const mixed = structuredClone(snap);
    mixed.pureKeypairs[0].encryptedPrivateKey = foreign;

    const { snapshot: out, skipped } = await rekeyCodex(mixed, OLD, NEW);

    // The foreign field is recorded, not dropped, and keeps its original blob.
    expect(skipped).toEqual([{ slice: "pureKeypairs", id: "pk1", field: "encryptedPrivateKey", reason: expect.any(String) }]);
    expect(out.pureKeypairs[0].encryptedPrivateKey).toBe(foreign);
    // …while the rest re-keyed normally.
    expect(await smartDecrypt(out.kadenaSeeds[0].secret, NEW)).toBe("plain:ks1");
  }, T.timeout);

  it("returns an empty codex unchanged (no secrets, no throw)", async () => {
    const empty = {
      schemaVersion: 3, lastUpdatedAt: null, lastUpdatedDevice: "main",
      uiSettings: {}, kadenaSeeds: [], ouroAccounts: [], pureKeypairs: [],
    } as unknown as CodexSnapshot;
    const { snapshot: out, skipped } = await rekeyCodex(empty, OLD, NEW);
    expect(skipped).toEqual([]);
    expect(out).toEqual(empty);
  }, T.timeout);

  it("collectCodexPasswordSecrets covers the FULL inventory (not just the legacy 3 slices)", () => {
    // 1 kadena + 2 ouro(secret,backup) + 1 pure + 1 foreign + 2 identity = 7.
    expect(collectCodexPasswordSecrets(snap)).toHaveLength(7);
  });

  it("inventory guard: the identity secret-field list is non-empty and unique", () => {
    // Lockstep guard — the list is the single source of truth the re-key walks.
    expect(CODEX_IDENTITY_SECRET_FIELDS.length).toBeGreaterThanOrEqual(9);
    expect(new Set(CODEX_IDENTITY_SECRET_FIELDS).size).toBe(CODEX_IDENTITY_SECRET_FIELDS.length);
  });
});
