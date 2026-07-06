/**
 * RED contract tests for the chain-aware address book seam (D-10 / D-11).
 *
 * These specs drive T9.8's GREEN. They import the NOT-YET-EXISTING seam and
 * MUST fail at import resolution until T9.8 lands it:
 *
 *   - `AddressBookEntry.chainId?: string` — a NEW OPTIONAL field. Additive:
 *     an existing on-disk entry with no `chainId` reads as the StoaChain default
 *     (`entry.chainId ?? STOACHAIN_CHAIN_ID`); the stored entry is UNCHANGED.
 *   - `STOACHAIN_CHAIN_ID` — the default chainId a legacy entry resolves to. It
 *     shares the string namespace with codex-core's `ForeignKeyEntry.chainId`
 *     / `ForeignChainAdapter.id` (D2/D3), so E-series Arweave slots in.
 *   - `createAddressValidatorRegistry()` + the module-level default registry's
 *     `registerChainAddressValidator` / `validateAddress` / `getRegisteredChains`
 *     / `resetAddressValidators` — the PLUGGABLE per-chain validation seam. The
 *     registry value type is `(addr: string, type?: AddressKind) => boolean`
 *     (FIX-5): the StoaChain validator INTERNALLY dispatches on the orthogonal
 *     `AddressBookEntry.type` (address-KIND), preserving the three per-type
 *     validators verbatim.
 *   - `stoaChainAddressValidator` — the concrete StoaChain validator T9.8 registers
 *     under `STOACHAIN_CHAIN_ID`.
 *
 * SEAM DECISIONS PINNED HERE (T9.8 must satisfy):
 *   - Unregistered chainId → `validateAddress` THROWS a typed
 *     `UnknownChainError` that NAMES the missing chainId (mirrors codex-core's
 *     fail-loud `ForeignChainError.get(unknownId)` precedent — a lookup miss on
 *     an unregistered chain is a programmer error and must fail diagnosably).
 *     The error message does NOT echo the address value.
 *   - The registry is RESET-ABLE: `createAddressValidatorRegistry()` returns a
 *     fresh instance, and `resetAddressValidators()` clears the module-level
 *     default registry so tests isolate cleanly.
 *
 * `type` (address-KIND: ouronet | stoa | stoic-tag) is ORTHOGONAL to `chainId`
 * (CHAIN). The StoaChain chain-validator is a thin dispatcher over the three
 * preserved per-type validators — it does NOT collapse them into one check.
 *
 * The address book entity/hook/tab STAY Ouronet-side (AddressBookTab carries a
 * value `@stoachain` + `zbom` edge), so this seam + these tests are co-located
 * here. Node-safe: no DOM, no store mount.
 */

import { describe, it, expect, beforeEach } from "vitest";

import type { AddressBookEntry, AddressKind } from "@ancientpantheon/codex-ouronet/types";
import {
  STOACHAIN_CHAIN_ID,
  stoaChainAddressValidator,
  createAddressValidatorRegistry,
  registerChainAddressValidator,
  validateAddress,
  getRegisteredChains,
  resetAddressValidators,
  UnknownChainError,
} from "@ancientpantheon/codex-ouronet/hooks";

// A legacy on-disk entry EXACTLY as persisted before D5: no `chainId` field.
// Frozen so any test that mutates it (rather than reading through the default)
// fails loudly — the additive contract is "read as StoaChain", not "rewrite".
function legacyEntry(overrides: Partial<AddressBookEntry> = {}): AddressBookEntry {
  return Object.freeze({
    id: "ab-legacy-1",
    name: "Alice",
    address: "Ѻ.alice-recipient",
    type: "ouronet",
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  }) as AddressBookEntry;
}

describe("chainId additive default-to-StoaChain (D-10)", () => {
  it("resolves a legacy entry with NO chainId to the StoaChain default on read, leaving the stored entry unchanged", () => {
    // STOACHAIN_CHAIN_ID must be a concrete, non-empty chainId string (shared with
    // codex-core's ForeignKeyEntry.chainId vocabulary) — asserting its shape
    // fails until T9.8 exports the real constant, not `undefined`.
    expect(typeof STOACHAIN_CHAIN_ID).toBe("string");
    expect(STOACHAIN_CHAIN_ID.length).toBeGreaterThan(0);

    const entry = legacyEntry();
    // The read-time default is `entry.chainId ?? STOACHAIN_CHAIN_ID` — a legacy
    // entry has no chainId, so it resolves to StoaChain.
    expect(entry.chainId).toBeUndefined();
    expect(entry.chainId ?? STOACHAIN_CHAIN_ID).toBe(STOACHAIN_CHAIN_ID);
    // Additive contract: reading the default must NOT write chainId onto disk.
    expect("chainId" in entry).toBe(false);
  });

  it("lets a NEW entry carry an explicit chainId that overrides the StoaChain default", () => {
    // The chainId namespace is shared with codex-core (ForeignKeyEntry.chainId),
    // so a foreign entry uses that same string vocabulary — and must be DISTINCT
    // from the StoaChain default (which T9.8 must export as a real constant).
    // The StoaChain default must be a real exported string, distinct from the
    // explicit foreign chainId — fails until T9.8 exports the constant.
    expect(typeof STOACHAIN_CHAIN_ID).toBe("string");
    const foreign = legacyEntry({ id: "ab-ar-1", chainId: "arweave:mainnet" });
    expect(foreign.chainId).toBe("arweave:mainnet");
    expect(foreign.chainId).not.toBe(STOACHAIN_CHAIN_ID);
    expect(foreign.chainId ?? STOACHAIN_CHAIN_ID).toBe("arweave:mainnet");
  });

  it("makes chainId a NEW OPTIONAL field — an entry omitting it still satisfies AddressBookEntry (superset, not a changed shape)", () => {
    // This assignment only typechecks if chainId is OPTIONAL on the extended
    // AddressBookEntry. If T9.8 made it required, the legacy factory (which omits
    // it) would fail to compile — pinning the D-11 superset contract at the type
    // level, then asserting the required fields still round-trip at runtime.
    const entry: AddressBookEntry = legacyEntry();
    expect(entry.id).toBe("ab-legacy-1");
    expect(entry.type).toBe("ouronet");
    expect(entry.address).toBe("Ѻ.alice-recipient");
    // The optional field defaults to StoaChain when absent — anchoring the read
    // path on the real STOACHAIN_CHAIN_ID constant T9.8 must export.
    expect(entry.chainId ?? STOACHAIN_CHAIN_ID).toBe(STOACHAIN_CHAIN_ID);
    expect(STOACHAIN_CHAIN_ID).toBeDefined();
  });
});

describe("pluggable per-chain validation registry (FIX-5)", () => {
  beforeEach(() => {
    // The module-level default registry is reset-able so each test starts clean
    // (no leak from a prior test's registrations).
    resetAddressValidators();
  });

  it("dispatches validateAddress(STOACHAIN_CHAIN_ID, addr, type) to the registered StoaChain validator", () => {
    registerChainAddressValidator(STOACHAIN_CHAIN_ID, stoaChainAddressValidator);
    // A well-formed ouronet address under the StoaChain chain validates true; the
    // dispatch reached the StoaChain validator (not a default-allow).
    expect(validateAddress(STOACHAIN_CHAIN_ID, "Ѻ.recipient", "ouronet")).toBe(true);
    // And a malformed one validates false — proving real validation ran, not a
    // blanket pass-through.
    expect(validateAddress(STOACHAIN_CHAIN_ID, "not-ouronet", "ouronet")).toBe(false);
  });

  it("throws a typed UnknownChainError naming the missing chainId (fail-loud) and does NOT echo the address value", () => {
    registerChainAddressValidator(STOACHAIN_CHAIN_ID, stoaChainAddressValidator);

    let caught: unknown;
    try {
      validateAddress("no-such-chain:mainnet", "secret-address-value", "stoa");
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(UnknownChainError);
    // The error names the unregistered chainId so the failure is diagnosable.
    expect((caught as Error).message).toContain("no-such-chain:mainnet");
    // Hygiene: the missing-chain error must not echo the address it was asked
    // to validate.
    expect((caught as Error).message).not.toContain("secret-address-value");
  });

  it("registers a SECOND chain's stub validator without disturbing StoaChain's, and lists both (E-series slots Arweave in with zero core change)", () => {
    const arweaveLikeStub = (): boolean => true;
    registerChainAddressValidator(STOACHAIN_CHAIN_ID, stoaChainAddressValidator);
    registerChainAddressValidator("arweave-like", arweaveLikeStub);

    // StoaChain's dispatch is untouched by the second registration.
    expect(validateAddress(STOACHAIN_CHAIN_ID, "Ѻ.recipient", "ouronet")).toBe(true);
    // The stub chain dispatches to its own validator.
    expect(validateAddress("arweave-like", "anything")).toBe(true);
    // Both chains are enumerated.
    expect([...getRegisteredChains()].sort()).toEqual(["arweave-like", STOACHAIN_CHAIN_ID].sort());
  });

  it("returns a FRESH, isolated registry from createAddressValidatorRegistry() — registrations do not leak between instances", () => {
    const registry = createAddressValidatorRegistry();
    registry.register(STOACHAIN_CHAIN_ID, stoaChainAddressValidator);
    expect(registry.getRegisteredChains()).toEqual([STOACHAIN_CHAIN_ID]);

    // A second fresh registry starts empty — no shared global mutable state.
    const other = createAddressValidatorRegistry();
    expect(other.getRegisteredChains()).toEqual([]);

    // And the module-level default registry (reset in beforeEach) is likewise
    // empty — the instance above did not touch it.
    expect(getRegisteredChains()).toEqual([]);
  });
});

describe("the 3-type regression under the StoaChain default-chain validator (FIX-5 / D-10 non-breaking contract)", () => {
  beforeEach(() => {
    resetAddressValidators();
    registerChainAddressValidator(STOACHAIN_CHAIN_ID, stoaChainAddressValidator);
  });

  it("validates a well-formed OURONET address true (startsWith 'Ѻ.') — the ouronet per-type validator is preserved", () => {
    expect(validateAddress(STOACHAIN_CHAIN_ID, "Ѻ.recipient", "ouronet")).toBe(true);
  });

  it("rejects a malformed OURONET address false (missing the 'Ѻ.' prefix) — per-type strictness is real, not a blanket true", () => {
    expect(validateAddress(STOACHAIN_CHAIN_ID, "recipient-no-sigil", "ouronet")).toBe(false);
  });

  it("validates a well-formed STOA address true for each k:/c:/w:/u: prefix (/^[kcwu]:/) — the stoa per-type validator is preserved", () => {
    for (const addr of ["k:abc", "c:abc", "w:abc", "u:abc"]) {
      expect(validateAddress(STOACHAIN_CHAIN_ID, addr, "stoa")).toBe(true);
    }
  });

  it("rejects a malformed STOA address false (no k:/c:/w:/u: prefix) — per-type strictness is real, not a blanket true", () => {
    expect(validateAddress(STOACHAIN_CHAIN_ID, "x:abc", "stoa")).toBe(false);
    expect(validateAddress(STOACHAIN_CHAIN_ID, "abc", "stoa")).toBe(false);
  });

  it("validates a well-formed STOIC-TAG address true (a bare tag, stripSigil(v).length > 0) — the stoic-tag per-type validator is preserved", () => {
    // Bare name and §-prefixed name both strip to a non-empty tag.
    expect(validateAddress(STOACHAIN_CHAIN_ID, "mytag", "stoic-tag")).toBe(true);
    expect(validateAddress(STOACHAIN_CHAIN_ID, "§mytag", "stoic-tag")).toBe(true);
  });

  it("rejects an empty STOIC-TAG address false (stripSigil yields empty) — per-type strictness is real, not a blanket true", () => {
    expect(validateAddress(STOACHAIN_CHAIN_ID, "§", "stoic-tag")).toBe(false);
    expect(validateAddress(STOACHAIN_CHAIN_ID, "   ", "stoic-tag")).toBe(false);
  });

  it("does NOT collapse the three per-type validators — an address valid under ONE type is rejected under another (the StoaChain validator dispatches on type, not a permissive union)", () => {
    // "Ѻ.recipient" is a valid ouronet address but NOT a valid stoa address —
    // if the chain-validator collapsed the three into one permissive check this
    // would wrongly pass. The dispatch on the orthogonal `type` keeps them
    // distinct.
    const ouronetAddr = "Ѻ.recipient";
    expect(validateAddress(STOACHAIN_CHAIN_ID, ouronetAddr, "ouronet")).toBe(true);
    expect(validateAddress(STOACHAIN_CHAIN_ID, ouronetAddr, "stoa")).toBe(false);

    // And a k:-address is valid stoa but not a valid ouronet address.
    const stoaAddr = "k:abc";
    expect(validateAddress(STOACHAIN_CHAIN_ID, stoaAddr, "stoa")).toBe(true);
    expect(validateAddress(STOACHAIN_CHAIN_ID, stoaAddr, "ouronet")).toBe(false);
  });
});

describe("surface stability — AddressBookEntry is a SUPERSET (D-11 overlap)", () => {
  beforeEach(() => {
    resetAddressValidators();
  });

  it("round-trips a legacy entry (no chainId) through a structural copy unchanged — the new field is purely additive", () => {
    const original = legacyEntry();
    // Simulate addEntry/read: a structural pass-through must preserve every
    // legacy field byte-for-byte and must NOT synthesize a chainId onto the
    // stored shape (chainId is resolved at READ time via ?? default, not written).
    const stored: AddressBookEntry = { ...original };
    expect(stored).toEqual({
      id: "ab-legacy-1",
      name: "Alice",
      address: "Ѻ.alice-recipient",
      type: "ouronet",
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    });
    expect("chainId" in stored).toBe(false);
  });

  it("keeps AddressKind the three-member address-KIND union the StoaChain validator dispatches on, ORTHOGONAL to chainId", () => {
    // AddressKind is the address-KIND vocabulary the registry value type's
    // second param uses; the StoaChain validator must dispatch on exactly these
    // three kinds. Exercising each through validateAddress proves the union is
    // the live dispatch key set (not just a stale type alias), and fails until
    // T9.8 lands the validator + registry.
    registerChainAddressValidator(STOACHAIN_CHAIN_ID, stoaChainAddressValidator);
    const perKind: Array<[AddressKind, string]> = [
      ["ouronet", "Ѻ.recipient"],
      ["stoa", "k:abc"],
      ["stoic-tag", "mytag"],
    ];
    for (const [kind, addr] of perKind) {
      expect(validateAddress(STOACHAIN_CHAIN_ID, addr, kind)).toBe(true);
    }
  });
});
