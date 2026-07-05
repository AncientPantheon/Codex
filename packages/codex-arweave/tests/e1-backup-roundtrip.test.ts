/**
 * E1 RED matrix — the funds-critical backup rows:
 *   - CODEC pureKeypairs+foreignKeys acceptance (drives T11.7 — the D2 revisit);
 *   - the SHARDING-adapter foreignKeys round-trip (drives T11.8 — the D5 revisit);
 *   - the useCodexBackup -> "1.3" rewire shape (function-level, drives T11.6);
 *   - the E-03 backup ROUND-TRIP (generate -> export -> wipe -> re-auth ->
 *     restore -> same 43-char address + MANDATORY WebCrypto RSA-PSS sign);
 *   - the FRESH-IV row (real AES-GCM seam, N-07);
 *   - secret-hygiene.
 *
 * codex-arweave is node-only (WebCrypto is a Node>=20 global). The sharding
 * round-trip runs the REAL Ouronet LocalStorageCodexAdapter against a FAKE
 * window.localStorage (NOT MemoryCodexAdapter — its structuredClone false-
 * passes the foreignKeys shard). The fresh-IV + signable-material rows use REAL
 * crypto, not the reversing fake.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import type { ArweaveJwk } from "@ancientpantheon/arweave-core";
import {
  addressOf,
  importKeyfile,
} from "@ancientpantheon/arweave-core";
import {
  buildCodexExport,
  serializeCodex,
  deserializeCodex,
  CodexUnknownFieldError,
  CodexError,
  makePasswordCache,
  type CryptoSeam,
  type ForeignKeyEntry,
  type PlaintextCodex,
} from "@ancientpantheon/codex-core";
import { LocalStorageCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import { CodexLockedError } from "@ancientpantheon/codex-ouronet/errors";

// RED: these codex-arweave subpaths do not exist yet.
import { generateArweaveKey, decryptArweaveKey } from "../src/keyring";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const throwawayJwk = JSON.parse(
  readFileSync(join(FIXTURES, "throwaway-arweave-keyfile.json"), "utf8"),
) as ArweaveJwk;
const legacyBackupJson = readFileSync(join(FIXTURES, "legacy-1-2-backup.json"), "utf8");

const reversingSeam: CryptoSeam = {
  encrypt: (p: string) => [...p].reverse().join(""),
  decrypt: (c: string) => [...c].reverse().join(""),
};

// ── A REAL fresh-IV AES-GCM seam (WebCrypto, node global). Each encrypt draws a
//    fresh random 12-byte IV, so two encrypts of the same plaintext yield two
//    DISTINCT ciphertexts, both decrypting identically. This is the property
//    FIX-6 pins that the deterministic reversing fake cannot exercise. ──────
function makeRealSeam(): CryptoSeam {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const deriveKey = async (password: string) => {
    const base = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: enc.encode("e1-fresh-iv-salt"), iterations: 100_000, hash: "SHA-256" },
      base,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  };
  return {
    async encrypt(plaintext: string, password: string) {
      const key = await deriveKey(password);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plaintext)));
      const packed = new Uint8Array(iv.length + ct.length);
      packed.set(iv, 0);
      packed.set(ct, iv.length);
      return Buffer.from(packed).toString("base64");
    },
    async decrypt(ciphertext: string, password: string) {
      const key = await deriveKey(password);
      const packed = new Uint8Array(Buffer.from(ciphertext, "base64"));
      const iv = packed.slice(0, 12);
      const ct = packed.slice(12);
      const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
      return dec.decode(pt);
    },
  };
}

// ── Fake window.localStorage so the REAL Ouronet LocalStorageCodexAdapter runs
//    its ACTUAL sharding saveAll/loadAll under node (no jsdom). ─────────────
function installFakeLocalStorage() {
  const store = new Map<string, string>();
  const localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  };
  (globalThis as unknown as { window: unknown }).window = { localStorage };
  return { store };
}

function baseCodex(overrides: Partial<PlaintextCodex> = {}): PlaintextCodex {
  return {
    kadenaWallets: [],
    ouronetWallets: [],
    addressBook: [],
    pureKeypairs: [],
    uiSettings: { dockPosition: "left" },
    schemaVersion: 1,
    lastUpdatedAt: null,
    lastUpdatedDevice: "main",
    ...overrides,
  };
}

const sampleForeignKey: ForeignKeyEntry = {
  id: "fk-1",
  label: "AR key",
  chainId: "arweave",
  encryptedKeyfile: "ENC::keyfile-ciphertext",
};

const samplePureKeypair = {
  id: "pk-1",
  publicKey: "a".repeat(64),
  encryptedPrivateKey: "ENC::pk-ciphertext",
  createdAt: "2025-01-01T00:00:00.000Z",
};

// ───────────────────────────────────────────────────────────────────────────
// CODEC ACCEPTANCE ROWS (drive T11.7 — pureKeypairs on the wire). These use the
// REAL codec and are EXPECTED TO FAIL against the current codec (which carries
// foreignKeys but NOT pureKeypairs) — that is the T11.7 driver.
// ───────────────────────────────────────────────────────────────────────────
describe("codec — the 1.3 envelope must carry BOTH foreignKeys AND pureKeypairs (E-02, FIX-2)", () => {
  it("(a) a {pureKeypairs, foreignKeys}-carrying 1.3 envelope round-trips through deserializeCodex WITHOUT CodexUnknownFieldError, both surviving byte-identical", () => {
    const codex = baseCodex({
      pureKeypairs: [samplePureKeypair],
      foreignKeys: [sampleForeignKey],
    });
    const json = serializeCodex(codex);

    // The reader must NOT reject pureKeypairs as an unknown field.
    const parsed = deserializeCodex(json) as Record<string, unknown>;
    expect(parsed.version).toBe("1.3");
    // foreignKeys travels as a {schemaVersion, keys} BLOCK...
    expect((parsed.foreignKeys as { keys: ForeignKeyEntry[] }).keys).toEqual([sampleForeignKey]);
    // ...while pureKeypairs travels as a BARE ARRAY (different wire shape).
    expect(parsed.pureKeypairs).toEqual([samplePureKeypair]);
  });

  it("(b) a genuinely-unknown top-level field still throws CodexUnknownFieldError naming it (allow-list widened for pureKeypairs+foreignKeys ONLY, not wide-open)", () => {
    const codex = baseCodex({ pureKeypairs: [samplePureKeypair] });
    const emitted = JSON.parse(serializeCodex(codex)) as Record<string, unknown>;
    emitted.bogusField = { nope: true };
    const json = JSON.stringify(emitted);

    let thrown: unknown;
    try {
      deserializeCodex(json);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(CodexUnknownFieldError);
    expect((thrown as Error).message).toContain("bogusField");
  });

  it("(c) buildCodexExport on a codex carrying pureKeypairs EMITS them in the 1.3 envelope (the writer does not drop pureKeypairs)", () => {
    const codex = baseCodex({ pureKeypairs: [samplePureKeypair] });
    const envelope = buildCodexExport(codex) as Record<string, unknown>;
    expect(envelope.version).toBe("1.3");
    expect(envelope.pureKeypairs).toEqual([samplePureKeypair]);
  });

  it("(d) a malformed pureKeypairs[0] (missing encryptedPrivateKey) throws a shape error NAMING the path, not echoing the value", () => {
    const codex = baseCodex({ pureKeypairs: [samplePureKeypair] });
    const emitted = JSON.parse(serializeCodex(codex)) as Record<string, unknown>;
    const bad = { id: "pk-bad", publicKey: "b".repeat(64), createdAt: "2025-01-01T00:00:00.000Z" };
    emitted.pureKeypairs = [bad];
    const json = JSON.stringify(emitted);

    let thrown: unknown;
    try {
      deserializeCodex(json);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(CodexError);
    const msg = (thrown as Error).message;
    expect(msg).toContain("pureKeypairs");
    // Secret hygiene: the path is named but no field VALUE is echoed.
    expect(msg).not.toContain(samplePureKeypair.encryptedPrivateKey);
  });

  it("(e) on the wire pureKeypairs is a BARE ARRAY while foreignKeys is a {schemaVersion,keys} BLOCK — the two keyrings have DIFFERENT shapes", () => {
    const codex = baseCodex({ pureKeypairs: [samplePureKeypair], foreignKeys: [sampleForeignKey] });
    const envelope = buildCodexExport(codex) as Record<string, unknown>;
    expect(Array.isArray(envelope.pureKeypairs)).toBe(true);
    expect(Array.isArray(envelope.foreignKeys)).toBe(false);
    expect(envelope.foreignKeys).toMatchObject({ schemaVersion: expect.any(Number), keys: [sampleForeignKey] });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// SHARDING-ADAPTER ROUND-TRIP (drives T11.8). The REAL Ouronet adapter's
// saveAll/loadAll must persist the foreignKeys shard. EXPECTED TO FAIL now
// (the adapter shards fixed keys with NO foreignKeys).
// ───────────────────────────────────────────────────────────────────────────
describe("sharding adapter — foreignKeys survive saveAll -> loadAll (E-03, FIX-1)", () => {
  let restore: () => void;
  beforeEach(() => {
    const hadWindow = "window" in globalThis;
    const prev = (globalThis as { window?: unknown }).window;
    installFakeLocalStorage();
    restore = () => {
      if (hadWindow) (globalThis as { window?: unknown }).window = prev;
      else delete (globalThis as { window?: unknown }).window;
    };
  });
  afterEach(() => restore());

  it("saveAll({...,foreignKeys:[entry]}) then loadAll() returns foreignKeys deep-equal (the false-pass guard), and preserves codexIdentity + consumerSettings", async () => {
    const adapter = new LocalStorageCodexAdapter("main");
    const snapshot = {
      kadenaSeeds: [{ id: "seed-1", secret: "ENC::seed" }],
      ouroAccounts: [],
      pureKeypairs: [samplePureKeypair],
      addressBook: [],
      watchList: [],
      uiSettings: { dockPosition: "left" },
      consumerSettings: { library: { schemaVersion: 1, settings: {} } },
      codexIdentity: { apolloA: "AAA", apolloB: "BBB", totalWordCount: 24 },
      foreignKeys: [sampleForeignKey],
      schemaVersion: 1,
      lastUpdatedAt: null,
      lastUpdatedDevice: "main" as const,
    };
    // The snapshot type gains foreignKeys via T11.8 — cast until then.
    await adapter.saveAll(snapshot as never);
    const loaded = (await adapter.loadAll()) as unknown as { foreignKeys?: ForeignKeyEntry[]; codexIdentity?: unknown; consumerSettings?: unknown };

    expect(loaded.foreignKeys).toEqual([sampleForeignKey]);
    expect(loaded.codexIdentity).toEqual(snapshot.codexIdentity);
    expect(loaded.consumerSettings).toEqual(snapshot.consumerSettings);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// BACKUP-REWIRE ROWS (function-level, drive T11.6). The rewired useCodexBackup
// writer must emit a 1.3 codec envelope carrying foreignKeys+pureKeypairs, and
// the reader must STILL accept the OLD legacy 1.2 golden (reader-before-writer).
// ───────────────────────────────────────────────────────────────────────────
describe("backup rewire — 1.3 export carries foreignKeys+pureKeypairs; old 1.2 still restores (E-02, N-03)", () => {
  it("(a) the rewired export path emits version 1.3 with foreignKeys+pureKeypairs (neither dropped, ciphertext never decrypted)", () => {
    // Models the rewired buildSnapshotFromState -> buildCodexExport writer.
    const codex = baseCodex({ pureKeypairs: [samplePureKeypair], foreignKeys: [sampleForeignKey] });
    const envelope = buildCodexExport(codex) as Record<string, unknown>;
    expect(envelope.version).toBe("1.3");
    expect((envelope.foreignKeys as { keys: ForeignKeyEntry[] }).keys).toEqual([sampleForeignKey]);
    expect(envelope.pureKeypairs).toEqual([samplePureKeypair]);
    // The codec never touches the ciphertext blobs.
    expect((envelope.foreignKeys as { keys: ForeignKeyEntry[] }).keys[0].encryptedKeyfile).toBe(
      sampleForeignKey.encryptedKeyfile,
    );
  });

  it("(b) READER-BEFORE-WRITER: the OLD legacy-1-2 backup golden still restores clean and its pureKeypairs survive; foreignKeys is absent (not defaulted)", () => {
    // The rewired reader must accept the augmented 1.2 file. The base codec
    // rejects pureKeypairs on 1.2 today, so this asserts the 1.2 golden parses
    // through the widened reader with pureKeypairs preserved and no throw.
    const parsed = deserializeCodex(legacyBackupJson) as Record<string, unknown>;
    expect(parsed.version).toBe("1.2");
    expect(parsed.pureKeypairs).toHaveLength(1);
    expect((parsed.pureKeypairs as Array<{ id: string }>)[0].id).toBe("pk-legacy-1");
    expect(parsed.foreignKeys).toBeUndefined();
  });

  it("(c) pureKeypairs survives the rewire (FIX-2 gate — a 1.3 with pureKeypairs is restorable)", () => {
    const codex = baseCodex({ pureKeypairs: [samplePureKeypair] });
    const parsed = deserializeCodex(serializeCodex(codex)) as Record<string, unknown>;
    expect(parsed.pureKeypairs).toEqual([samplePureKeypair]);
  });

  it("(d) a genuinely-unknown top-level field still throws on restore", () => {
    const codex = baseCodex();
    const emitted = JSON.parse(serializeCodex(codex)) as Record<string, unknown>;
    emitted.attackerField = 1;
    expect(() => deserializeCodex(JSON.stringify(emitted))).toThrow(CodexUnknownFieldError);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// THE E-03 ROUND-TRIP — the headline funds-critical proof.
// ───────────────────────────────────────────────────────────────────────────
describe("E-03 backup round-trip — generate -> export -> wipe -> re-auth -> restore -> same signable address (FIX-1/4/7)", () => {
  /** A minimal store double whose foreignKeys ride the codec export and whose
   *  wipe clears the passwordCache (as clearAll + re-init do in the real store). */
  function makeStore() {
    const state = {
      foreignKeys: [] as ForeignKeyEntry[],
      passwordCache: null as ReturnType<typeof makePasswordCache> | null,
    };
    return {
      state,
      saveAllCalls: [] as unknown[],
      getSnapshot: () => ({ foreignKeys: state.foreignKeys }),
      async addForeignKey(entry: ForeignKeyEntry) {
        state.foreignKeys = [...state.foreignKeys, entry];
      },
      authenticate(password: string, ttlMs: number) {
        state.passwordCache = makePasswordCache(password, ttlMs, Date.now());
      },
      wipe() {
        state.foreignKeys = [];
        state.passwordCache = null; // wipe clears the absolute unlock window
      },
    };
  }

  it("same 43-char address returns, JWK is byte-identical, and the restored key SIGNS via WebCrypto RSA-PSS; the LOCKED branch throws CodexLockedError; no private field leaks", async () => {
    const seam = makeRealSeam();
    const store = makeStore();
    const password = "codex-master-pw";
    store.authenticate(password, 15 * 60_000);

    // 1. Generate an Arweave key IN the store (encrypted at rest, unlocked).
    const entry = await generateArweaveKey({
      store,
      cryptoSeam: seam,
      password,
      passwordCache: store.state.passwordCache,
    });
    // Capture the address the generated key resolves to (its round-trip anchor).
    const generatedJwk = await decryptArweaveKey({
      entry,
      cryptoSeam: seam,
      password,
      passwordCache: store.state.passwordCache,
    });
    const capturedAddress = await addressOf(generatedJwk);
    expect(capturedAddress).toHaveLength(43);

    // 2. Export the backup (1.3, foreignKeys present) — ciphertext only.
    const codex = baseCodex({ foreignKeys: store.state.foreignKeys });
    const exportedJson = serializeCodex(codex);
    // FUNDS-CRITICAL: no private JWK field appears in any serialized backup byte.
    for (const field of [generatedJwk.d, generatedJwk.p, generatedJwk.q, generatedJwk.dp, generatedJwk.dq, generatedJwk.qi]) {
      expect(exportedJson).not.toContain(field);
    }

    // 3. WIPE the store (clears foreignKeys AND passwordCache).
    store.wipe();
    expect(store.state.foreignKeys).toHaveLength(0);
    expect(store.state.passwordCache).toBeNull();

    // 4. Restore from the exported backup.
    const restored = deserializeCodex(exportedJson) as { foreignKeys?: { keys: ForeignKeyEntry[] } };
    const restoredEntry = restored.foreignKeys!.keys[0];
    store.state.foreignKeys = [restoredEntry];

    // LOCKED BRANCH (FIX-4): without re-auth, decrypt throws CodexLockedError.
    await expect(
      decryptArweaveKey({ entry: restoredEntry, cryptoSeam: seam, password, passwordCache: store.state.passwordCache }),
    ).rejects.toBeInstanceOf(CodexLockedError);

    // 5. Re-authenticate to re-seed the ABSOLUTE unlock window (FIX-4).
    store.authenticate(password, 15 * 60_000);

    // (i) same 43-char address returns.
    const restoredJwk = await decryptArweaveKey({
      entry: restoredEntry,
      cryptoSeam: seam,
      password,
      passwordCache: store.state.passwordCache,
    });
    const restoredAddress = await addressOf(restoredJwk);
    expect(restoredAddress).toBe(capturedAddress);

    // (ii) byte-identical JWK (all 9 fields).
    expect(restoredJwk).toEqual(generatedJwk);
    expect(importKeyfile(restoredJwk)).toEqual(generatedJwk);

    // (iii) MANDATORY signable-material check (FIX-7): the restored JWK imports
    // into WebCrypto for RSA-PSS and a real sign over a fixed message SUCCEEDS —
    // address-equality alone does NOT catch a same-length-corrupted modulus/d.
    const cryptoKey = await crypto.subtle.importKey(
      "jwk",
      { ...restoredJwk, alg: "PS256", ext: true, key_ops: ["sign"] } as JsonWebKey,
      { name: "RSA-PSS", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signature = await crypto.subtle.sign(
      { name: "RSA-PSS", saltLength: 32 },
      cryptoKey,
      new TextEncoder().encode("e1-round-trip-fixed-message"),
    );
    expect(signature.byteLength).toBeGreaterThan(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// FRESH-IV ROW (N-07, FIX-6) — the REAL seam, not the reversing fake.
// ───────────────────────────────────────────────────────────────────────────
describe("fresh IV per encryption (N-07, FIX-6)", () => {
  it("encrypting the same JWK twice yields two DISTINCT ciphertexts, both decrypting to the byte-identical JWK", async () => {
    const seam = makeRealSeam();
    const plaintext = JSON.stringify(throwawayJwk);

    const c1 = await seam.encrypt(plaintext, "pw");
    const c2 = await seam.encrypt(plaintext, "pw");
    expect(c1).not.toBe(c2); // fresh IV -> distinct ciphertext (no IV reuse)

    const d1 = JSON.parse((await seam.decrypt(c1, "pw")) as string) as ArweaveJwk;
    const d2 = JSON.parse((await seam.decrypt(c2, "pw")) as string) as ArweaveJwk;
    expect(d1).toEqual(throwawayJwk);
    expect(d2).toEqual(throwawayJwk);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// SECRET-HYGIENE ROWS (N-06).
// ───────────────────────────────────────────────────────────────────────────
describe("secret hygiene (N-06) — errors name the field/operation, never echo a JWK value or password", () => {
  it("a malformed foreignKeys block names the path but never echoes the encryptedKeyfile value", () => {
    const emitted = {
      version: "1.3",
      exportedAt: new Date().toISOString(),
      kadenaWallets: [],
      ouronetWallets: [],
      addressBook: [],
      uiSettings: {},
      foreignKeys: { schemaVersion: 1, keys: [{ id: "x", chainId: "arweave" /* encryptedKeyfile MISSING */ }] },
    };
    let thrown: unknown;
    try {
      deserializeCodex(JSON.stringify(emitted));
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(CodexError);
    expect((thrown as Error).message).toContain("foreignKeys");
  });

  it("a locked decrypt error names the operation but not the password", async () => {
    const seam = makeRealSeam();
    const err = await decryptArweaveKey({
      entry: sampleForeignKey,
      cryptoSeam: seam,
      password: "super-secret-password",
      passwordCache: null,
    }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(CodexLockedError);
    expect((err as Error).message).not.toContain("super-secret-password");
  });
});
