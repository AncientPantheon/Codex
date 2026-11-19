/**
 * `resolveGuardKeys` — the guard-unfolding half of Secure Master Account,
 * and the gap the codebase audit turned up: nothing anywhere took an
 * account's `{keysetref:{ns,ksn}}` guard and expanded it into its keys.
 * `describeKeyset` existed, but was wired only into the ZBOM guard EDITOR.
 *
 * The failure branch is the one that matters most. A chain read that fails
 * must NOT degrade to "this guard authorizes no keys" — downstream, that
 * answer would release every lock protecting the master's guard keys and
 * silently re-permit deleting them. Unresolvable must stay unresolvable.
 */

import { describe, it, expect, vi } from "vitest";
import { resolveGuardKeys } from "../src/guards/resolveGuardKeys.js";

const K1 = "a".repeat(64);
const K2 = "b".repeat(64);

describe("resolveGuardKeys", () => {
  it("returns the keys of a direct keyset without touching the chain", async () => {
    const describeKeyset = vi.fn();
    const r = await resolveGuardKeys({ pred: "keys-all", keys: [K1] }, { describeKeyset });

    expect(r).toEqual({ kind: "keyset", pred: "keys-all", keys: [K1] });
    expect(describeKeyset).not.toHaveBeenCalled();
  });

  it("carries the origin ref when a direct keyset records one (the DALOS/HOV shape in the owner's codex)", async () => {
    const r = await resolveGuardKeys(
      { pred: "keys-any", keys: [K1, K2], keysetRef: "ouronet-ns.dh_hov-keyset" },
      { describeKeyset: vi.fn() },
    );
    expect(r).toEqual({
      kind: "keyset",
      pred: "keys-any",
      keys: [K1, K2],
      viaRef: "ouronet-ns.dh_hov-keyset",
    });
  });

  it("UNFOLDS a true keyset reference through the injected resolver", async () => {
    const describeKeyset = vi.fn(async () => ({ keys: [K1, K2], pred: "keys-any" }));
    const r = await resolveGuardKeys(
      { keysetref: { ns: "ouronet-ns", ksn: "dh_sc_dalos-keyset" } },
      { describeKeyset },
    );

    expect(describeKeyset).toHaveBeenCalledWith("ouronet-ns.dh_sc_dalos-keyset");
    expect(r).toEqual({
      kind: "keyset-ref",
      ref: "ouronet-ns.dh_sc_dalos-keyset",
      pred: "keys-any",
      keys: [K1, K2],
    });
  });

  it("reports a FAILED ref resolution as unresolved — never as 'no keys'", async () => {
    const describeKeyset = vi.fn(async () => { throw new Error("node unreachable"); });
    const r = await resolveGuardKeys(
      { keysetref: { ns: "ouronet-ns", ksn: "dh_hov-keyset" } },
      { describeKeyset },
    );

    expect(r.kind).toBe("keyset-ref-unresolved");
    if (r.kind !== "keyset-ref-unresolved") throw new Error("narrowing");
    expect(r.ref).toBe("ouronet-ns.dh_hov-keyset");
    expect(r.error).toContain("node unreachable");
    // Crucially: no `keys` field at all, so a caller cannot mistake it for
    // an authoritative empty list and release locks on the strength of it.
    expect("keys" in r).toBe(false);
  });

  it("reports a null/absent guard as 'none' (31 of the owner's 43 accounts)", async () => {
    expect(await resolveGuardKeys(null, { describeKeyset: vi.fn() })).toEqual({ kind: "none" });
    expect(await resolveGuardKeys(undefined, { describeKeyset: vi.fn() })).toEqual({ kind: "none" });
  });

  it("reports a capability guard as unsupported — it authorizes no enumerable keys", async () => {
    const r = await resolveGuardKeys(
      { cgName: "ouronet-ns.DALOS.SOME_CAP", cgArgs: [], cgPactId: null },
      { describeKeyset: vi.fn() },
    );
    expect(r).toEqual({ kind: "unsupported", guardKind: "capability" });
  });

  it("reports a user guard as unsupported", async () => {
    const r = await resolveGuardKeys(
      { fun: "ouronet-ns.DALOS.some-fun", args: [] },
      { describeKeyset: vi.fn() },
    );
    expect(r).toEqual({ kind: "unsupported", guardKind: "user" });
  });

  it("reports an unrecognised shape as unresolved rather than guessing", async () => {
    const r = await resolveGuardKeys({ something: "else" }, { describeKeyset: vi.fn() });
    expect(r.kind).toBe("unknown");
  });

  // Owner (live testing, real data, said repeatedly): "the guard is made
  // by a keyset-ref. And this still isnt shown... the AncientHodler
  // Account has a keyset-ref, which is the ouronet-ns.dh_ah-keyset, which
  // should be shown there at the current guard."
  //
  // An EXPANDED keyset can still carry the reference it came from. This
  // codebase declares that annotation two different ways — `IKeyset`'s
  // camelCase `keysetRef` and the Pact wire shape's lowercase
  // `keysetref` — and real persisted guards use both. Reading only one
  // spelling (the old behaviour) dropped the annotation for the other,
  // which is exactly how the keyset-ref badge kept not showing.
  describe("keyset-ref annotation on an EXPANDED keyset — every real spelling", () => {
    const cases: ReadonlyArray<[string, Record<string, unknown>]> = [
      ["camelCase qualified string", { keysetRef: "ouronet-ns.dh_ah-keyset" }],
      ["lowercase qualified string", { keysetref: "ouronet-ns.dh_ah-keyset" }],
      ["camelCase {ns,ksn} pair", { keysetRef: { ns: "ouronet-ns", ksn: "dh_ah-keyset" } }],
    ];

    for (const [label, annotation] of cases) {
      it(`carries viaRef through for a ${label}`, async () => {
        const describeKeyset = vi.fn();
        const r = await resolveGuardKeys(
          { pred: "keys-any", keys: [K1, K2], ...annotation },
          { describeKeyset },
        );
        expect(r).toEqual({
          kind: "keyset",
          pred: "keys-any",
          keys: [K1, K2],
          viaRef: "ouronet-ns.dh_ah-keyset",
        });
        // Still purely local — an already-expanded keyset never needs the
        // chain, annotated or not.
        expect(describeKeyset).not.toHaveBeenCalled();
      });
    }

    it("leaves viaRef absent for a plain keyset carrying no annotation at all", async () => {
      const r = await resolveGuardKeys(
        { pred: "keys-all", keys: [K1] },
        { describeKeyset: vi.fn() },
      );
      expect(r).toEqual({ kind: "keyset", pred: "keys-all", keys: [K1] });
    });

    it("treats a malformed annotation as simply absent, never throwing", async () => {
      const r = await resolveGuardKeys(
        { pred: "keys-all", keys: [K1], keysetRef: { ns: "ouronet-ns" } },
        { describeKeyset: vi.fn() },
      );
      expect(r).toEqual({ kind: "keyset", pred: "keys-all", keys: [K1] });
    });
  });
});
