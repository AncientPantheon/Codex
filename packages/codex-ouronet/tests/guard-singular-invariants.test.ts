/**
 * FOUR SINGULAR STRUCTURAL INVARIANTS — dedicated regression guard (C4).
 *
 * The broad state suite exercises each invariant piecemeal across many files;
 * this single guard asserts all four in one place so a regression in ANY of
 * them fails LOUDLY here, not buried in an unrelated spec. Every assertion is
 * driven through PUBLIC store/identity actions (kickstart, add*, delete*,
 * rename*, rotate*, buildRegisterCodexIdentityTx) — never internal-state pokes.
 *
 * The four invariants (spec §B / v0.3.0 design):
 *   (a) ONE Prime Codex Seed        — isPrime:true singleton, kickstart-set, undeletable
 *   (b) ONE CodexPrime ouro account — isPrime:true singleton, undeletable
 *   (c) ONE active CodexGuard       — isCodexGuard:true singleton, label-locked,
 *                                      undeletable, rotation transfers + keeps history
 *   (d) Immutable double-Apollo id  — no public setter, byte-for-byte consumed on-chain
 *
 * A full v0.3 kickstart is the single public action that materialises all four
 * at once, so it is the shared pre-state. `reuse-codexid-whole` + `kadena-seed`
 * yields a REAL Prime Codex Seed, CodexPrime ouro, CodexGuard, and identity.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createCodexStore } from "@ancientpantheon/codex-ouronet/state";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import type { CodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import {
  CodexPrimeProtectedError,
  CodexPrimeSeedProtectedError,
  CodexKickstartError,
  CodexGuardError,
  CodexIdentityError,
} from "@ancientpantheon/codex-ouronet/errors";
import type {
  KickstartArgsV3,
  KickstartResultV3,
} from "@ancientpantheon/codex-ouronet/codex-identity";
import type {
  IKadenaSeed,
  IOuroAccount,
} from "@ancientpantheon/codex-ouronet/types";

const PW = "singular-invariants-password";
// encryptStringV2 (PBKDF2-SHA512/600k) runs several times per kickstart; give
// each spec that kickstarts a generous budget.
const T = { timeout: 120_000 };

const WORDS_12 =
  "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima";
const KADENA_MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon " +
  "abandon abandon abandon abandon abandon abandon abandon abandon " +
  "abandon abandon abandon abandon abandon abandon abandon art";

/** Full v0.3 kickstart args: whole-seed CodexPrime + kadena-seed duo. This
 *  combination produces the maximal singular set — a Prime Codex Seed, a
 *  CodexPrime ouro, a CodexGuard pure key, and a double-Apollo identity. */
function kickstartArgs(): KickstartArgsV3 {
  return {
    codexIdSeed: { mode: "words", value: WORDS_12 },
    codexPrimeSeed: { source: "reuse-codexid-whole" },
    duoPrime: { mode: "kadena-seed", seedType: "koala", mnemonic: KADENA_MNEMONIC },
  };
}

let adapter: CodexAdapter;
let store: ReturnType<typeof createCodexStore>;

async function freshKickstartedStore(): Promise<KickstartResultV3> {
  adapter = new MemoryCodexAdapter("dev");
  store = createCodexStore();
  await store.getState().actions.init(adapter, "dev");
  store.getState().actions.authenticate(PW, 60);
  const r = await store.getState().actions.kickstartCodex(kickstartArgs());
  return r as KickstartResultV3;
}

// ─── (a) ONE Prime Codex Seed ────────────────────────────────────────────────

describe("(a) singular invariant: exactly one Prime Codex Seed", () => {
  let kick: KickstartResultV3;
  beforeEach(async () => {
    kick = await freshKickstartedStore();
  }, T.timeout);

  it("kickstart flags EXACTLY ONE kadena seed as the Prime Codex Seed", T, () => {
    const primes = store.getState().kadenaSeeds.filter((s) => s.isPrime === true);
    expect(primes).toHaveLength(1);
    // The flagged seed is the one kickstart returned as primeCodexSeed — the
    // singleton is causal, not merely positional.
    expect(primes[0]!.id).toBe(kick.primeCodexSeed!.id);
  });

  it("rejects adding a SECOND explicit prime seed — the singleton holds", T, async () => {
    const intruder: IKadenaSeed = {
      id: "intruder-seed",
      seedType: "koala",
      version: "2",
      index: 0,
      secret: "enc",
      main: "k:" + "0".repeat(64),
      createdAt: "2026-06-01T00:00:00.000Z",
      accounts: [],
      isPrime: true,
    };
    await expect(
      store.getState().actions.addKadenaSeed(intruder)
    ).rejects.toMatchObject({
      name: "CodexKickstartError",
      reason: "id-conflict",
    });
    // Still exactly one prime, and the intruder never landed.
    const seeds = store.getState().kadenaSeeds;
    expect(seeds.filter((s) => s.isPrime === true)).toHaveLength(1);
    expect(seeds.some((s) => s.id === "intruder-seed")).toBe(false);
  });

  it("the Prime Codex Seed is structurally undeletable", T, async () => {
    const primeId = kick.primeCodexSeed!.id;
    await expect(
      store.getState().actions.deleteKadenaSeed(primeId)
    ).rejects.toBeInstanceOf(CodexPrimeSeedProtectedError);
    // Delete attempt left the prime in place.
    expect(store.getState().kadenaSeeds.some((s) => s.id === primeId)).toBe(true);
  });
});

// ─── (b) ONE CodexPrime ouro account ─────────────────────────────────────────

describe("(b) singular invariant: exactly one CodexPrime ouro account", () => {
  let kick: KickstartResultV3;
  beforeEach(async () => {
    kick = await freshKickstartedStore();
  }, T.timeout);

  it("kickstart installs EXACTLY ONE ouro account flagged isPrime (CodexPrime)", T, () => {
    const primes = store.getState().ouroAccounts.filter((a) => a.isPrime === true);
    expect(primes).toHaveLength(1);
    expect(primes[0]!.id).toBe(kick.codexPrime.id);
    expect(primes[0]!.name).toBe("CodexPrime");
  });

  it("rejects adding a SECOND explicit prime ouro — the singleton holds", T, async () => {
    const intruder: IOuroAccount = {
      id: "intruder-ouro",
      name: "NotPrime",
      version: "2",
      isSmart: false,
      address: "Ѻ.intruder",
      guard: null,
      kadenaLedger: null,
      publicKey: "pk-intruder",
      secret: "enc-intruder",
      backup: "",
      isPrime: true,
    };
    await expect(
      store.getState().actions.addOuroAccount(intruder)
    ).rejects.toMatchObject({
      name: "CodexKickstartError",
      reason: "id-conflict",
    });
    const ouros = store.getState().ouroAccounts;
    expect(ouros.filter((a) => a.isPrime === true)).toHaveLength(1);
    expect(ouros.some((a) => a.id === "intruder-ouro")).toBe(false);
  });

  it("deleting the CodexPrime ouro throws CodexPrimeProtectedError", T, async () => {
    const primeId = kick.codexPrime.id;
    await expect(
      store.getState().actions.deleteOuroAccount(primeId)
    ).rejects.toBeInstanceOf(CodexPrimeProtectedError);
    expect(store.getState().ouroAccounts.some((a) => a.id === primeId)).toBe(true);
  });
});

// ─── (c) ONE active CodexGuard + history-forever ─────────────────────────────

describe("(c) singular invariant: one active CodexGuard, label-locked, undeletable, rotation keeps history", () => {
  let kick: KickstartResultV3;
  beforeEach(async () => {
    kick = await freshKickstartedStore();
  }, T.timeout);

  it("kickstart installs EXACTLY ONE pure key flagged isCodexGuard, exposed by the getter", T, () => {
    const active = store
      .getState()
      .pureKeypairs.filter((k) => k.isCodexGuard === true && k.wasCodexGuard !== true);
    expect(active).toHaveLength(1);
    expect(active[0]!.id).toBe(kick.codexGuard.id);
    // The exactly-one integrity getter agrees with the array scan.
    expect(store.getState().actions.getCodexGuardPublic()).toBe(
      kick.codexGuard.publicKey
    );
  });

  it("the active CodexGuard is LABEL-LOCKED (non-suffix rename rejected)", T, async () => {
    await expect(
      store.getState().actions.renamePureKeypair(kick.codexGuard.id, "MyGuard")
    ).rejects.toMatchObject({
      name: "CodexGuardError",
      reason: "rename-rejected",
    });
    // Label untouched by the rejected rename.
    const guard = store
      .getState()
      .pureKeypairs.find((k) => k.id === kick.codexGuard.id);
    expect(guard!.label).toBe("CodexGuard");
  });

  it("the active CodexGuard is UNDELETABLE (delete rejected with guard-protected error)", T, async () => {
    await expect(
      store.getState().actions.deletePureKeypair(kick.codexGuard.id)
    ).rejects.toMatchObject({
      name: "CodexGuardError",
      reason: "delete-rejected",
    });
    expect(
      store.getState().pureKeypairs.some((k) => k.id === kick.codexGuard.id)
    ).toBe(true);
  });

  it("ROTATION transfers isCodexGuard to the new key AND retains wasCodexGuard history forever", T, async () => {
    const oldGuardId = kick.codexGuard.id;
    const { newGuard, retired } = await store.getState().actions.rotateCodexGuard();

    // New key is the ONLY active guard; old key is demoted, not purged.
    expect(newGuard.isCodexGuard).toBe(true);
    expect(newGuard.id).not.toBe(oldGuardId);
    expect(retired.id).toBe(oldGuardId);
    expect(retired.isCodexGuard).toBe(false);
    expect(retired.wasCodexGuard).toBe(true);

    const keys = store.getState().pureKeypairs;
    const active = keys.filter((k) => k.isCodexGuard === true && k.wasCodexGuard !== true);
    expect(active).toHaveLength(1);
    expect(active[0]!.id).toBe(newGuard.id);
    expect(store.getState().actions.getCodexGuardPublic()).toBe(newGuard.publicKey);

    // History kept forever: the retired key is STILL present in the codex and
    // carries wasCodexGuard — it was demoted, never removed.
    const retainedOld = keys.find((k) => k.id === oldGuardId);
    expect(retainedOld).toBeDefined();
    expect(retainedOld!.wasCodexGuard).toBe(true);
  });

  it("the retired (former) CodexGuard stays undeletable after rotation", T, async () => {
    const oldGuardId = kick.codexGuard.id;
    await store.getState().actions.rotateCodexGuard();
    await expect(
      store.getState().actions.deletePureKeypair(oldGuardId)
    ).rejects.toMatchObject({
      name: "CodexGuardError",
      reason: "delete-rejected",
    });
    // Wasn't purged by the rejected delete either.
    expect(store.getState().pureKeypairs.some((k) => k.id === oldGuardId)).toBe(true);
  });
});

// ─── (d) Immutable double-Apollo identity ────────────────────────────────────

describe("(d) singular invariant: the double-Apollo identity is immutable + byte-consumed on-chain", () => {
  let kick: KickstartResultV3;
  beforeEach(async () => {
    kick = await freshKickstartedStore();
  }, T.timeout);

  it("kickstart produces EXACTLY ONE identity, surfaced verbatim by getCodexIdentity", T, () => {
    const id = store.getState().actions.getCodexIdentity();
    expect(id).not.toBeNull();
    // Same object the kickstart returned — one identity, no re-derivation.
    expect(id).toBe(kick.codexIdentity);
    expect(id!.standardPublicKey).toBe(kick.codexIdentity.standardPublicKey);
    expect(id!.smartPublicKey).toBe(kick.codexIdentity.smartPublicKey);
  });

  it("exposes NO public mutator for the identity — immutability is enforced structurally", T, () => {
    // The immutability invariant is preserved by there being NO public API path
    // to overwrite an existing identity: kickstart is the only writer and it
    // refuses to run twice (asserted below). A rogue re-kickstart on the SAME
    // codex is the concrete mutation attempt a consumer could make; it throws.
    const actionNames = Object.keys(store.getState().actions);
    expect(actionNames).not.toContain("setCodexIdentity");
    expect(actionNames).not.toContain("updateCodexIdentity");
    expect(actionNames).not.toContain("mutateCodexIdentity");
  });

  it("a second kickstart on an existing-identity codex is rejected (already-exists) — identity not overwritten", T, async () => {
    const before = store.getState().actions.getCodexIdentity();
    await expect(
      store.getState().actions.kickstartCodex(kickstartArgs())
    ).rejects.toMatchObject({
      name: "CodexKickstartError",
      reason: "already-kickstarted",
    });
    // The original identity object is untouched — same reference, byte-for-byte.
    expect(store.getState().actions.getCodexIdentity()).toBe(before);
  });

  it("declares CodexIdentityError('immutable-field') as the contract for a future setter guard", T, () => {
    // No runtime setter exists in this phase, so the immutable-field guard is a
    // DECLARED contract (error code present, diagnosable message) that any later
    // atomic setter must throw. Pinning it here keeps the contract from drifting.
    const err = new CodexIdentityError("immutable-field");
    expect(err.reason).toBe("immutable-field");
    expect(err.name).toBe("CodexIdentityError");
    expect(err.message).toMatch(/immutable/i);
  });

  it("the identity is consumed BYTE-FOR-BYTE by the on-chain register-tx path", T, () => {
    const id = store.getState().actions.getCodexIdentity()!;
    const tx = store.getState().actions.buildRegisterCodexIdentityTx();

    // The register tx targets the on-chain codex module and carries the SAME
    // Apollo pubkeys the immutable identity holds — no transform, no re-derive.
    expect(tx.module).toBe("ouronet-ns.CODEX");
    expect(tx.function).toBe("register-codex-identity");
    expect(tx.args[0]).toBe(id.standardPublicKey);
    expect(tx.args[1]).toBe(id.smartPublicKey);
    // The guard keyset is the single active CodexGuard — ties (c) and (d)
    // together: the on-chain identity registration is signed by the one guard.
    const keyset = tx.args[2] as { keys: string[]; pred: string };
    expect(keyset.pred).toBe("keys-all");
    expect(keyset.keys).toEqual([store.getState().actions.getCodexGuardPublic()]);
  });
});
