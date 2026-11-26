/**
 * `zbom/execute/rotateOps.ts` — headless F (rotate payment key) and G (rotate
 * guard), plus the once-only signer resolution both of them and both ZBOM
 * rotate modals share.
 *
 * ── MAINNET HAZARD, the sharpest in this topic ──────────────────────────────
 * F and G are the two operations that change WHO CONTROLS THE ACCOUNT. Both
 * of the real implementations (`zbom/rotatePaymentKeyLive.ts:120` and
 * `@ouronet/ouronet-core/interactions/guardFunctions.js:103`) reach
 * `getFailoverClient(...).submit` — a REAL broadcast to StoaChain mainnet —
 * through a module-scope import that no test can displace. A test that
 * reaches either one rotates a real account's keys.
 *
 * So this spec contains **ZERO `vi.mock` calls, by construction** (and a
 * self-check below that keeps it that way). Every chain edge arrives as an
 * INJECTED dependency on an explicit `deps` parameter with NO default: a
 * dropped mock fails OPEN onto mainnet, a required injected seam cannot fail
 * open at all — TypeScript refuses the call and the function has nothing else
 * to reach for.
 *
 * Nothing here registers a `setPactReader` either, because `rotateOps.ts`
 * performs no reads: its predicates come from T8's `chainState.ts`.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi } from "vitest";
import type { IKadenaKeypair as IStoaChainKeypair } from "@stoachain/stoa-core/signing";

import {
  collectGuardSigners,
  executeRotatePaymentKey,
  executeRotateGuard,
  GuardChangeNotExecutableError,
  type GuardSignerAnalysis,
  type RotateGuardSubmitter,
  type RotatePaymentKeySubmitter,
} from "../src/zbom/execute/rotateOps.js";

// ─── Fixtures ───────────────────────────────────────────────────────────────

const CODEX_A = "a".repeat(64);
const CODEX_B = "b".repeat(64);
const FOREIGN_C = "c".repeat(64);
const UNRESOLVABLE = "d".repeat(64);

/** A GuardAnalysis slice — only the three fields the signer walk reads.
 *  Defaults are the conservative "nothing signable, nothing required". */
function analysisFx(partial: Partial<GuardSignerAnalysis> = {}): GuardSignerAnalysis {
  return { codexKeys: [], resolvedForeignKeys: [], threshold: 0, ...partial };
}

/** An injected `getKeypair` over a fixed pub → privkey map. Resolves `null`
 *  for anything absent — the real codex resolver's "not in this codex" answer
 *  the modal's own `if (kp)` guard has always handled. */
function keypairResolver(pubs: readonly string[]) {
  const held = new Set(pubs);
  return vi.fn(async (publicKey: string): Promise<IStoaChainKeypair | null> =>
    held.has(publicKey) ? { publicKey, privateKey: `priv-${publicKey}` } : null,
  );
}

function kp(publicKey: string): IStoaChainKeypair {
  return { publicKey, privateKey: `priv-${publicKey}` };
}

// ─── collectGuardSigners — the once-only signer resolution ──────────────────

describe("collectGuardSigners — the lifted signer resolution (F, G and both modals)", () => {
  it("stops at `threshold` even when MORE candidates resolve, codexKeys first", async () => {
    // The load-bearing rule: signing with more keys than the guard requires is
    // how a transaction gets rejected for an unexpected signer set. Three keys
    // are resolvable; a 2-of-3 guard must receive exactly two, in walk order.
    const getKeypair = keypairResolver([CODEX_A, CODEX_B, FOREIGN_C]);

    const signers = await collectGuardSigners(
      analysisFx({ codexKeys: [CODEX_A, CODEX_B], resolvedForeignKeys: [FOREIGN_C], threshold: 2 }),
      getKeypair,
    );

    expect(signers).toEqual([kp(CODEX_A), kp(CODEX_B)]);
    // and the walk SHORT-CIRCUITS — the third candidate is never even resolved
    expect(getKeypair).toHaveBeenCalledTimes(2);
    expect(getKeypair).not.toHaveBeenCalledWith(FOREIGN_C);
  });

  it("prefers a manually-entered private key over `getKeypair` for the same pubkey", async () => {
    // A foreign key the user pasted in is the ONLY way its private half is
    // known; falling through to the codex resolver would drop it and leave the
    // guard under-signed.
    const getKeypair = keypairResolver([CODEX_A]);

    const signers = await collectGuardSigners(
      analysisFx({ resolvedForeignKeys: [FOREIGN_C], threshold: 1 }),
      getKeypair,
      { [FOREIGN_C]: "manual-priv-c" },
    );

    expect(signers).toEqual([{ publicKey: FOREIGN_C, privateKey: "manual-priv-c" }]);
    expect(getKeypair).not.toHaveBeenCalled();
  });

  it("SKIPS a pubkey the resolver answers falsy for, instead of pushing `undefined`", async () => {
    // `undefined` in the signer array reaches `fromKeypair(undefined)` inside
    // the real rotate call and either throws mid-flight or signs with a
    // malformed signer list. Skipping keeps the array well-formed; the caller's
    // own `satisfied` gate decides whether the short set is acceptable.
    const getKeypair = keypairResolver([CODEX_B]);

    const signers = await collectGuardSigners(
      analysisFx({ codexKeys: [UNRESOLVABLE, CODEX_B], threshold: 2 }),
      getKeypair,
    );

    expect(signers).toEqual([kp(CODEX_B)]);
    expect(signers).not.toContain(undefined);
    expect(getKeypair).toHaveBeenCalledWith(UNRESOLVABLE);
  });

  it("returns [] for a zero-threshold analysis without resolving anything", async () => {
    // A zero threshold is what an UNRESOLVED keyset-ref analyses to
    // (`computeThreshold`'s keyCount === 0 short-circuit). Resolving keys for
    // it would attach signers the transaction never asked for.
    const getKeypair = keypairResolver([CODEX_A]);

    const signers = await collectGuardSigners(
      analysisFx({ codexKeys: [CODEX_A], threshold: 0 }),
      getKeypair,
    );

    expect(signers).toEqual([]);
    expect(getKeypair).not.toHaveBeenCalled();
  });
});

// ─── F — rotate payment key (TS01-C1.DALOS|C_RotateStoa) ────────────────────

const PATRON_ADDR  = "Ѻ.PATRON";
const ACCOUNT_ADDR = "Ѻ.ACCOUNT";
const GAS_PUB      = "e".repeat(64);
const NEW_PAY_KEY  = "9".repeat(64);
const PATRON_GUARD  = { keys: [CODEX_A], pred: "keys-all" };
const ACCOUNT_GUARD = { keys: [CODEX_B], pred: "keys-all" };

/** The injected submitter — a recording stand-in for
 *  `rotateStoaChainPaymentKeyLive`, whose real body broadcasts. */
function paymentKeySubmitterFx(requestKey = "req-rotate-pay-1") {
  return vi.fn(async (..._args: Parameters<RotatePaymentKeySubmitter>) => ({ requestKey }));
}

function rotatePaymentKeyRequestFx(overrides: Record<string, unknown> = {}) {
  return {
    patronAddress:   PATRON_ADDR,
    accountAddress:  ACCOUNT_ADDR,
    newPaymentKey:   NEW_PAY_KEY,
    gasStationKey:   kp(GAS_PUB),
    patronAnalysis:  analysisFx({ codexKeys: [CODEX_A], threshold: 1 }),
    accountAnalysis: analysisFx({ codexKeys: [CODEX_B], threshold: 1 }),
    patronGuard:     PATRON_GUARD,
    accountGuard:    ACCOUNT_GUARD,
    ...overrides,
  };
}

describe("executeRotatePaymentKey — F, headless", () => {
  it("passes the WHOLE eight-argument tuple in `rotatePaymentKeyLive.ts:60-68`'s declared order", async () => {
    // Asserted as a whole tuple, not a subset: these are POSITIONAL
    // parameters, so a single inserted/dropped/transposed argument silently
    // rotates the wrong account to the wrong key. That is the trap the
    // named-argument wrapper exists to close, and this is the assertion that
    // proves the wrapper maps the names back onto the right slots.
    const getKeypair = keypairResolver([CODEX_A, CODEX_B]);
    const submit = paymentKeySubmitterFx();

    await executeRotatePaymentKey(rotatePaymentKeyRequestFx(), {
      getKeypair,
      submitRotatePaymentKey: submit,
    });

    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0]).toEqual([
      PATRON_ADDR,
      ACCOUNT_ADDR,
      NEW_PAY_KEY,
      kp(GAS_PUB),
      [kp(CODEX_A)],   // patron signers, derived via collectGuardSigners
      [kp(CODEX_B)],   // account signers, likewise
      PATRON_GUARD,
      ACCOUNT_GUARD,
    ]);
  });

  it("drops `accountGuard` when the account IS the patron — the `ks-account` rule", async () => {
    // `rotatePaymentKeyLive.ts:88` attaches the `ks-account` keyset payload
    // only `if (accountGuard && accountAddress !== patronAddress)`. Nulling it
    // here makes that condition explicit at the headless boundary, so a
    // self-rotation can never ship a redundant second keyset payload that the
    // Pact code would have to ignore.
    const getKeypair = keypairResolver([CODEX_A, CODEX_B]);
    const submit = paymentKeySubmitterFx();

    await executeRotatePaymentKey(
      rotatePaymentKeyRequestFx({ accountAddress: PATRON_ADDR }),
      { getKeypair, submitRotatePaymentKey: submit },
    );

    const call = submit.mock.calls[0];
    expect(call[1]).toBe(PATRON_ADDR);
    expect(call[6]).toEqual(PATRON_GUARD);
    expect(call[7]).toBeNull();
  });

  it("returns the submitter's result, requestKey intact", async () => {
    // The engine polls confirmation by requestKey; losing it would leave a
    // landed rotation unverifiable.
    const result = await executeRotatePaymentKey(rotatePaymentKeyRequestFx(), {
      getKeypair: keypairResolver([CODEX_A, CODEX_B]),
      submitRotatePaymentKey: paymentKeySubmitterFx("req-xyz"),
    });

    expect(result.requestKey).toBe("req-xyz");
  });

  it("propagates a submitter failure with its message intact, and submits once", async () => {
    // `createSimulationError`'s message is the only diagnosis the user gets
    // for a refused rotation; swallowing or rewrapping it loses the Pact
    // error. And the chain must NOT retry on its own — one submit per call.
    const submit = vi.fn(async () => {
      throw new Error("Rotate Payment Key simulation failed: row not found");
    });

    await expect(
      executeRotatePaymentKey(rotatePaymentKeyRequestFx(), {
        getKeypair: keypairResolver([CODEX_A, CODEX_B]),
        submitRotatePaymentKey: submit,
      }),
    ).rejects.toThrow("Rotate Payment Key simulation failed: row not found");

    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("names C_RotateStoa and never C_RotateKadena on the path the engine takes", async () => {
    // The same regression T1 fixes in `components/RotatePaymentKeyModal.tsx`,
    // pinned HERE because this module is the engine's route to F. Two halves:
    // (1) the live submitter must route to the package-LOCAL delegate, not
    // back to `@ouronet/ouronet-core`'s `rotateKadenaPaymentKey`, which still
    // emits the renamed-away member; (2) that delegate's one emitted Pact call
    // must be `C_RotateStoa`. Confirmed on mainnet via
    // `describe-module "ouronet-ns.TS01-C1"`: `C_RotateKadena` answers
    // "no such member".
    const ops = readFileSync(resolve(__dirname, "../src/zbom/execute/rotateOps.ts"), "utf8");
    expect(ops).toMatch(/from\s+"\.\.\/rotatePaymentKeyLive\.js"/);
    expect(ops).not.toMatch(/rotateKadenaPaymentKey|ouroRotateFunctions/);

    const live = readFileSync(resolve(__dirname, "../src/zbom/rotatePaymentKeyLive.ts"), "utf8");
    const emitted = [...live.matchAll(/\.execution\(\s*`([^`]*)`/g)].map((m) => m[1]);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toContain("TS01-C1.DALOS|C_RotateStoa");
    expect(emitted[0]).not.toContain("C_RotateKadena");
  });
});

// ─── G — rotate guard (TS01-C1.DALOS|C_RotateGuard) ─────────────────────────

const NEW_GUARD_PUB = "f".repeat(64);
const KEYSET_REF = "ouronet-ns.my-keyset";

/** The injected submitter — a recording stand-in for `ouronet-core`'s
 *  `rotateGuard`, whose real body broadcasts. */
function guardSubmitterFx(requestKey = "req-rotate-guard-1") {
  return vi.fn(async (..._args: Parameters<RotateGuardSubmitter>) => ({ requestKey }));
}

const guardBaseFx = {
  patronAddress:   PATRON_ADDR,
  accountAddress:  ACCOUNT_ADDR,
  gasStationKey:   kp(GAS_PUB),
  patronAnalysis:  analysisFx({ codexKeys: [CODEX_A], threshold: 1 }),
  accountAnalysis: analysisFx({ codexKeys: [CODEX_B], threshold: 1 }),
};

describe("executeRotateGuard — G, headless, both buildable forms", () => {
  it('builds the "define" params object — safe FORCED true, new-guard signers in their own slot', async () => {
    // `(read-keyset "ks")` form. Two things are money-critical here and are
    // asserted as a WHOLE object, not a subset: (1) `safe: true` is forced,
    // mirroring `RotateGuardModal.tsx:281` — the unsafe variant skips the
    // chain's own check that the incoming keyset is actually satisfiable, and
    // a wrong keyset there locks the account out permanently; (2) the NEW
    // guard's signers go to `newGuardKeys` and nowhere else — folding them
    // into `accountGuardKeys` would prove ownership with keys that do not yet
    // own anything.
    const getKeypair = keypairResolver([CODEX_A, CODEX_B, NEW_GUARD_PUB]);
    const submit = guardSubmitterFx();

    await executeRotateGuard(
      {
        ...guardBaseFx,
        newGuardAnalysis: analysisFx({ codexKeys: [NEW_GUARD_PUB], threshold: 1 }),
        target: { mode: "define", newKeys: [NEW_GUARD_PUB], newPred: "keys-all" },
      },
      { getKeypair, submitRotateGuard: submit },
    );

    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0][0]).toStrictEqual({
      patronAddress:    PATRON_ADDR,
      accountAddress:   ACCOUNT_ADDR,
      mode:             "define",
      newKeys:          [NEW_GUARD_PUB],
      newPred:          "keys-all",
      keysetRef:        undefined,
      safe:             true,
      gasStationKey:    kp(GAS_PUB),
      patronGuardKeys:  [kp(CODEX_A)],
      accountGuardKeys: [kp(CODEX_B)],
      newGuardKeys:     [kp(NEW_GUARD_PUB)],
    });
  });

  it('builds the "existing" params object — keysetRef carried, `safe` the caller\'s, no `ks` payload', async () => {
    // `(keyset-ref-guard "<ref>")` form. `newKeys`/`newPred` MUST stay absent:
    // `guardFunctions.js:63` adds the `ks` data payload only when both are
    // present, so leaking them here would attach a keyset the Pact expression
    // never reads. `safe` is the caller's choice in this mode (a ref whose
    // keyset this codex cannot satisfy is a legitimate, deliberate target).
    const getKeypair = keypairResolver([CODEX_A, CODEX_B]);
    const submit = guardSubmitterFx();

    await executeRotateGuard(
      { ...guardBaseFx, target: { mode: "existing", keysetRef: KEYSET_REF, safe: false } },
      { getKeypair, submitRotateGuard: submit },
    );

    expect(submit.mock.calls[0][0]).toStrictEqual({
      patronAddress:    PATRON_ADDR,
      accountAddress:   ACCOUNT_ADDR,
      mode:             "existing",
      newKeys:          undefined,
      newPred:          undefined,
      keysetRef:        KEYSET_REF,
      safe:             false,
      gasStationKey:    kp(GAS_PUB),
      patronGuardKeys:  [kp(CODEX_A)],
      accountGuardKeys: [kp(CODEX_B)],
      newGuardKeys:     [],
    });
  });

  it("sends an EMPTY newGuardKeys array when there is no new-guard analysis", async () => {
    // Mirrors `RotateGuardModal.tsx:268`'s `newGuardAnalysis ? … : []`. An
    // `undefined` here reaches `[...newGuardKeys]` inside the real call and
    // throws mid-build, after the patron/account keys were already resolved.
    const submit = guardSubmitterFx();

    await executeRotateGuard(
      {
        ...guardBaseFx,
        target: { mode: "define", newKeys: [NEW_GUARD_PUB], newPred: "keys-all" },
      },
      { getKeypair: keypairResolver([CODEX_A, CODEX_B]), submitRotateGuard: submit },
    );

    expect(submit.mock.calls[0][0].newGuardKeys).toEqual([]);
  });

  it("returns the submitter's result and propagates a failure message intact", async () => {
    const ok = await executeRotateGuard(
      { ...guardBaseFx, target: { mode: "existing", keysetRef: KEYSET_REF, safe: true } },
      { getKeypair: keypairResolver([CODEX_A, CODEX_B]), submitRotateGuard: guardSubmitterFx("req-g") },
    );
    expect(ok.requestKey).toBe("req-g");

    const failing = vi.fn(async () => { throw new Error("Rotate Guard simulation failed: GUARD_FAILURE"); });
    await expect(
      executeRotateGuard(
        { ...guardBaseFx, target: { mode: "existing", keysetRef: KEYSET_REF, safe: true } },
        { getKeypair: keypairResolver([CODEX_A, CODEX_B]), submitRotateGuard: failing },
      ),
    ).rejects.toThrow("Rotate Guard simulation failed: GUARD_FAILURE");
    expect(failing).toHaveBeenCalledTimes(1);
  });

  it("REFUSES the `define-keyset` keyset-ref UPDATE loudly — never reaches the submitter", async () => {
    // Design §6: `define-keyset` has zero code anywhere in the tree, is not an
    // Ouronet `C_*` call (so the Ouronet gas station is not available to pay
    // for it) and must be satisfied by the keyset's CURRENT keyset, which this
    // codex may not hold. It is REPRESENTED in the target union precisely so a
    // caller cannot express it and have it silently skipped — and the money
    // assertion is that it never degrades into some OTHER rotation: the
    // submitter is not called at all.
    const submit = guardSubmitterFx();
    const getKeypair = keypairResolver([CODEX_A, CODEX_B]);

    await expect(
      executeRotateGuard(
        { ...guardBaseFx, target: { mode: "define-keyset", keysetName: KEYSET_REF } },
        { getKeypair, submitRotateGuard: submit },
      ),
    ).rejects.toThrow(GuardChangeNotExecutableError);

    await expect(
      executeRotateGuard(
        { ...guardBaseFx, target: { mode: "define-keyset", keysetName: KEYSET_REF } },
        { getKeypair, submitRotateGuard: submit },
      ),
    ).rejects.toThrow(/define-keyset/);

    expect(submit).not.toHaveBeenCalled();
    // ...and it refuses BEFORE spending any key resolution on it.
    expect(getKeypair).not.toHaveBeenCalled();
  });

  it("the installed `rotateGuard` still maps the two modes to the two guard expressions this API promises", async () => {
    // G's `mode` discriminant is only meaningful because upstream turns
    // "define" into `(read-keyset "ks")` and "existing" into
    // `(keyset-ref-guard "<ref>")` (`guardFunctions.js:48-50`). This module
    // documents that mapping and the engine depends on it; if a dependency
    // bump reshuffles it, a "define" request would silently rotate the guard
    // to something other than the keys the user chose. Pinned against the
    // INSTALLED file so the bump fails here instead of on chain.
    const upstream = readFileSync(
      resolve(__dirname, "../node_modules/@ouronet/ouronet-core/dist/interactions/guardFunctions.js"),
      "utf8",
    );
    expect(upstream).toContain('mode === "define"');
    expect(upstream).toContain('`(read-keyset "ks")`');
    expect(upstream).toContain('`(keyset-ref-guard "${keysetRef}")`');
    expect(upstream).toContain("TS01-C1.DALOS|C_RotateGuard");
  });
});

// ─── The no-vi.mock self-check ──────────────────────────────────────────────

describe("this spec's own mainnet discipline", () => {
  it("contains no `vi.mock` call anywhere — every chain edge is injected", () => {
    const self = readFileSync(resolve(__dirname, "execute-rotate-ops.test.ts"), "utf8");
    // Matches a real call site only; the prose above says "vi.mock" with no
    // paren, so the file can keep explaining WHY the rule exists.
    expect(self).not.toMatch(/vi\s*\.\s*mock\s*\(/);
  });

  it("rotateOps.ts can never FAIL OPEN: no entry point defaults to a live submitter", () => {
    // The whole injected-deps discipline rests on one property — that neither
    // headless entry point has anything to reach for when a caller forgets to
    // supply a submitter. The day someone adds
    // `submitRotateGuard = liveRotateGuardSubmitter` "for convenience", every
    // test in this file that forgets a stub starts broadcasting real key
    // rotations to mainnet. That is not a property a reviewer can be relied on
    // to re-notice, so it is pinned here.
    const ops = readFileSync(resolve(__dirname, "../src/zbom/execute/rotateOps.ts"), "utf8");

    // Comments stripped first, so the module's own doc comments can keep
    // NAMING the live aliases while the CODE is held to one mention each.
    const code = ops.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

    // Each live alias may appear exactly ONCE in code: its own `export const`
    // declaration. A second mention is, by construction, something reaching
    // for it — a parameter default, a `??` fallback, a reassignment — and any
    // of those is the fail-open.
    for (const alias of ["liveRotatePaymentKeySubmitter", "liveRotateGuardSubmitter"]) {
      expect(code.split(alias).length - 1, `code mentions of ${alias}`).toBe(1);
      expect(code).toContain(`export const ${alias}`);
    }

    // ...and both submitters are REQUIRED members of their deps type: no `?`.
    expect(code).toContain("readonly submitRotatePaymentKey: RotatePaymentKeySubmitter;");
    expect(code).toContain("readonly submitRotateGuard: RotateGuardSubmitter;");
  });
});
