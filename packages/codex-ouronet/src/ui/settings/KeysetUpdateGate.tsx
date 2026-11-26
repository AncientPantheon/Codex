/**
 * `KeysetUpdateGate` — the surface that appears when the codex cannot satisfy
 * the keyset the user chose to update
 * (docs/work/migration-execute-keyset/design.md §3, acceptance criteria 5-8).
 *
 * The owner's worked example is the specification:
 *
 * > This keyset ref is a keyset of 9 keys with a predicate 5 of 9. This means
 * > the user is presented with the list of 9 keys, and for each key a field
 * > where he may enter the private key. Entering a private key on that field,
 * > the UI verifies that it fits, and once 5 of 9 are verified this way, then
 * > the update could proceed.
 *
 * ## This is a PRECONDITION, never a mid-chain prompt
 *
 * The standing rule is that once the chain starts it runs to completion
 * without stopping to ask anything (`PendingKeyChangesCard`'s header carries
 * the owner's wording). So this gate resolves BEFORE the press that starts the
 * chain, and it is NOT an error surface: design §3 offers exactly two
 * resolutions — supply the missing keys, or **forfeit**, in which case
 * everything else still executes and the keyset simply stays as it is.
 *
 * ## It reuses the shared manual-key input; it reimplements nothing
 *
 * `zbom/ui/ManualKeyInput.tsx` is already the shared component for this (five
 * consumers: `SigningZone`, `AuthPathZone`, `LinkDualApiKeyModal`,
 * `RenameDualLaneModal`, `RevokeDualLinkModal`). It already derives the public
 * key from an entered private key with `tryDerivePublicKey`, clears the field
 * on a match, and hides itself once the threshold is met. It is imported here
 * UNCHANGED. This component adds only the two things it deliberately does not
 * do:
 *
 *   1. **the whole key list** — `ManualKeyInput` lists the unresolved FOREIGN
 *      keys only, while criterion 6 is "every key of the current keyset". So
 *      one row per `analysis.keys` entry, each marked codex-held / resolved by
 *      hand / still needed, with the shared input mounted beneath the rows
 *      that need one (`foreignKeys={[pub]}` — the field belongs to that one
 *      key, which is what "for each key a field" means);
 *   2. **the forfeit** — a migration concept with no business inside a generic
 *      signer widget.
 *
 * Threshold and progress come from `analyzeGuard`, never from counting here: a
 * second threshold rule is a second way to sign with the wrong number of keys,
 * and `analyzeGuard` already owns the unknown-predicate fallback.
 *
 * ## MAINNET HAZARD — the read is an injected prop with NO default
 *
 * The gate needs the account's live guard resolved, which is ONE chain read
 * (`getStoaChainAccountGuard`, registry id `UR_AccountGuard` — the same read
 * the section already performs, and the one that EXPANDS a `keysetref` into
 * `{ ...keyset, keysetRef: "<ns>.<ksn>" }`, so the reference name and the
 * current `{ keys, pred }` both come out of it). This file names no live
 * function: `readAccountGuard` is a required prop, defaulted to the real
 * function only at the parent. The effect is additionally gated on `active`,
 * so no codex that did not choose a keyset update is read at all, and the
 * reader is held in a ref so a parent passing an inline arrow cannot turn a
 * re-render into a second live read.
 *
 * ## The entered private keys
 *
 * A private key typed into a field is the most sensitive input in this
 * application, so its lifetime is bounded deliberately:
 *
 *   - it lives in this component's React state and in the parent's, for one
 *     press. Nothing writes it to the store, the adapter, `localStorage` or
 *     any URL; `MigrationProgress` is never touched.
 *   - nothing logs it. There is no `console` call in this file, no entered
 *     value reaches an error message, and the internal change-detection
 *     signature below is built from PUBLIC keys only.
 *   - **forfeit discards it.** An abandoned update has no use for the key, so
 *     the map is emptied and the empty map is reported up, overwriting the
 *     parent's copy.
 *   - **unmount discards it** the same way: the gate reports one final cleared
 *     selection so no private key outlives the surface that collected it.
 *
 * ## Its output is a value, not a side effect
 *
 * One callback, `onChange`, hands the whole resolution up; the parent holds
 * the state and the engine call stays a pure function of it. This component
 * never calls the engine, never unlocks the codex and never submits anything.
 */

import * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { analyzeGuard, type GuardAnalysis } from "@stoachain/stoa-core/guard";
import { keysetRefNameOf } from "../../guards/resolveGuardKeys.js";
import { ManualKeyInput } from "../../zbom/ui/ManualKeyInput.js";

/** What the gate hands up. `ref === null` means "no keyset-ref to update" —
 *  either the guard is not one (criterion 4) or the read has not resolved yet;
 *  in both cases `satisfied` is `false`, which is the conservative answer.
 *  `satisfied` and `forfeited` are ORTHOGONAL: `satisfied` says whether the
 *  current keyset CAN be signed, `forfeited` says the user chose not to. */
export interface KeysetUpdateSelection {
  /** The qualified keyset-reference name (`"<ns>.<ksn>"`), or `null`. */
  readonly ref: string | null;
  /** `analyzeGuard` over the current keyset + the codex + the supplied keys. */
  readonly analysis: GuardAnalysis | null;
  /** pubkey → private key, for the keys the user supplied by hand. */
  readonly manualKeys: Record<string, string>;
  /** Whether the current keyset's predicate is met by codex + supplied keys. */
  readonly satisfied: boolean;
  /** Whether the user chose to forfeit the keyset update. Never the default. */
  readonly forfeited: boolean;
}

export interface KeysetUpdateGateProps {
  /** `true` only when a keyset update was actually chosen. Gates the read. */
  readonly active: boolean;
  /** The Ouronet account whose guard carries the keyset reference. */
  readonly accountAddress: string;
  /** Every public key this codex can sign with. */
  readonly codexPubs: Set<string>;
  /** INJECTED, no default: resolves the account's live guard. */
  readonly readAccountGuard: (address: string) => Promise<unknown>;
  /** The whole resolution, every time it changes. */
  readonly onChange: (selection: KeysetUpdateSelection) => void;
}

/** Namespaces whose USER guard is a protocol keyset — `stoa-genesis-1.pact:110-113`
 *  defines `ouronet-ns` and `stoa-ns` with `(keyset-ref-guard "ns-operate-keyset")`,
 *  while `free` and `user` are `GUARD_SUCCESS`. */
const PROTOCOL_NAMESPACES = new Set(["ouronet-ns", "stoa-ns"]);

type ReadState =
  | { readonly phase: "idle" }
  | { readonly phase: "loading" }
  | { readonly phase: "error"; readonly message: string }
  | { readonly phase: "not-ref" }
  | {
      readonly phase: "ready";
      readonly ref: string;
      readonly keyset: { readonly keys: string[]; readonly pred: string };
    };

/**
 * The `{ keys, pred }` out of a resolved guard, or `null` when it carries no
 * usable key list. `null` must NEVER be handed to `analyzeGuard`: an absent
 * guard analyses as trivially `satisfied: true`, so an unresolved reference
 * would report a keyset that no key can sign as already met.
 *
 * An unreadable `pred` falls back to `keys-all` — the most demanding reading,
 * never the most permissive.
 */
function keysetOf(guard: unknown): { keys: string[]; pred: string } | null {
  if (typeof guard !== "object" || guard === null) return null;
  const { keys, pred } = guard as { keys?: unknown; pred?: unknown };
  if (!Array.isArray(keys) || keys.length === 0) return null;
  if (!keys.every((k) => typeof k === "string" && k.length > 0)) return null;
  return {
    keys: keys as string[],
    pred: typeof pred === "string" && pred.length > 0 ? pred : "keys-all",
  };
}

const shortKey = (pub: string): string => `${pub.slice(0, 16)}…${pub.slice(-8)}`;

const boxStyle: React.CSSProperties = {
  padding: 12,
  borderRadius: 8,
  backgroundColor: "#18181B",
  border: "1px solid #262626",
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  padding: 6,
  borderRadius: 6,
  backgroundColor: "#0f0f11",
  border: "1px solid #262626",
};

const btnStyle: React.CSSProperties = {
  alignSelf: "flex-start",
  padding: "6px 12px",
  borderRadius: 6,
  border: "1px solid #3f3f46",
  backgroundColor: "#27272a",
  color: "#d2d3d4",
  fontWeight: 700,
  fontSize: 12,
  cursor: "pointer",
};

export function KeysetUpdateGate({
  active,
  accountAddress,
  codexPubs,
  readAccountGuard,
  onChange,
}: KeysetUpdateGateProps) {
  const [state, setState] = useState<ReadState>({ phase: "idle" });
  const [manualKeys, setManualKeys] = useState<Record<string, string>>({});
  const [forfeited, setForfeited] = useState(false);

  // The reader and the callback are held in refs, and NOT in the read effect's
  // dependency list: a parent that re-creates either inline would otherwise
  // turn every re-render into another live chain read. Declared before the
  // read effect so they are current when it runs.
  const readerRef = useRef(readAccountGuard);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    readerRef.current = readAccountGuard;
    onChangeRef.current = onChange;
  }, [readAccountGuard, onChange]);

  useEffect(() => {
    // No keyset update chosen → no read, no report, nothing rendered.
    if (!active) {
      setState({ phase: "idle" });
      setManualKeys({});
      setForfeited(false);
      return;
    }
    // A different account is a different keyset: never inherit keys or a
    // forfeit across it.
    let aborted = false;
    setState({ phase: "loading" });
    setManualKeys({});
    setForfeited(false);
    readerRef
      .current(accountAddress)
      .then((guard) => {
        if (aborted) return;
        const ref = keysetRefNameOf(guard);
        if (ref === null) {
          setState({ phase: "not-ref" });
          return;
        }
        const keyset = keysetOf(guard);
        if (!keyset) {
          setState({
            phase: "error",
            message: `the keyset reference "${ref}" did not resolve to a key list`,
          });
          return;
        }
        setState({ phase: "ready", ref, keyset });
      })
      .catch((err: unknown) => {
        if (aborted) return;
        setState({ phase: "error", message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      aborted = true;
    };
  }, [active, accountAddress]);

  const analysis = useMemo(
    () => (state.phase === "ready" ? analyzeGuard(state.keyset, codexPubs, manualKeys) : null),
    [state, codexPubs, manualKeys],
  );

  // ── Reporting up ──────────────────────────────────────────────────────────
  // Keyed on a signature of the VALUES rather than on object identity, so a
  // parent that rebuilds `codexPubs` on every render does not get a report per
  // render (and, if it stores the report, an endless loop). The signature is
  // built from public keys only — no entered private key is ever serialised.
  const lastSignature = useRef<string | null>(null);
  const hasReported = useRef(false);
  useEffect(() => {
    if (state.phase === "idle") return;
    const ref = state.phase === "ready" ? state.ref : null;
    const signature = JSON.stringify([
      state.phase,
      ref,
      forfeited,
      analysis?.signable ?? null,
      analysis?.threshold ?? null,
      analysis?.keys.length ?? null,
      Object.keys(manualKeys).sort(),
    ]);
    if (signature === lastSignature.current) return;
    lastSignature.current = signature;
    hasReported.current = true;
    onChangeRef.current({
      ref,
      analysis,
      manualKeys,
      satisfied: analysis?.satisfied ?? false,
      forfeited,
    });
  }, [state, analysis, manualKeys, forfeited]);

  // The private keys do not outlive the surface that collected them: one final
  // cleared report overwrites whatever the parent is holding. Only fired when
  // something WAS reported, so an inactive gate stays silent.
  useEffect(
    () => () => {
      if (!hasReported.current) return;
      onChangeRef.current({
        ref: null,
        analysis: null,
        manualKeys: {},
        satisfied: false,
        forfeited: false,
      });
    },
    [],
  );

  const handleResolve = useCallback((pub: string, priv: string) => {
    setManualKeys((prev) => (prev[pub] === priv ? prev : { ...prev, [pub]: priv }));
  }, []);

  const handleForfeit = useCallback(() => {
    // An abandoned update has no use for a private key.
    setManualKeys({});
    setForfeited(true);
  }, []);

  if (!active) return null;

  return (
    <div data-testid="keyset-update-gate" style={boxStyle}>
      <span style={{ fontSize: 12, fontWeight: 700, color: "#ceac5f" }}>
        Keyset update — the current keyset has to authorize it
      </span>

      {state.phase === "loading" && (
        <p data-testid="keyset-update-gate-loading" style={{ fontSize: 11, color: "#a1a1aa" }}>
          Reading this account's current keyset…
        </p>
      )}

      {state.phase === "error" && (
        <p data-testid="keyset-update-gate-error" style={{ fontSize: 11, color: "#c0392b" }}>
          The current keyset could not be read, so the update cannot be prepared — {state.message}.
          Nothing has been started.
        </p>
      )}

      {state.phase === "not-ref" && (
        <p data-testid="keyset-update-gate-not-ref" style={{ fontSize: 11, color: "#a1a1aa" }}>
          This account's guard is not a keyset reference, so there is no keyset to redefine. Every
          other step of the migration is unaffected.
        </p>
      )}

      {state.phase === "ready" && analysis && (
        <>
          <span data-testid="keyset-update-gate-ref" style={{ fontSize: 11, color: "#a1a1aa" }}>
            Keyset reference: <code style={{ color: "#d2d3d4" }}>{state.ref}</code>
          </span>

          {PROTOCOL_NAMESPACES.has(state.ref.split(".")[0] ?? "") && (
            <p
              data-testid="keyset-update-gate-namespace-warning"
              style={{ fontSize: 11, color: "#f59e0b" }}
            >
              Heads up: <code>{state.ref.split(".")[0]}</code> is a protocol-guarded namespace
              (stoa-genesis-1.pact:110-113), so the chain will most likely refuse this
              redefinition even with the keyset satisfied. The rest of the migration is unaffected,
              and a refused keyset update is reported rather than fatal.
            </p>
          )}

          <span data-testid="keyset-update-gate-progress" style={{ fontSize: 11, color: "#d2d3d4" }}>
            {analysis.signable} of {analysis.threshold} keys verified — {analysis.predLabel}
          </span>

          {forfeited ? (
            <>
              <p data-testid="keyset-update-gate-forfeited" style={{ fontSize: 11, color: "#a1a1aa" }}>
                Update forfeited — this keyset will remain exactly as it is, and every other step
                of the migration still runs. Any private key entered here has been discarded.
              </p>
              <button
                type="button"
                data-testid="keyset-update-gate-resume"
                style={btnStyle}
                onClick={() => setForfeited(false)}
              >
                Supply keys instead
              </button>
            </>
          ) : (
            <>
              <p style={{ fontSize: 11, color: "#a1a1aa" }}>
                {analysis.satisfied
                  ? "The predicate is met — the update can proceed when you press."
                  : `Every key of the current keyset is listed below. Enter the private key for any ${analysis.neededMore} of the ones still needed, or forfeit the update.`}
              </p>

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {analysis.keys.map((pub, i) => {
                  const inCodex = analysis.codexKeys.includes(pub);
                  const byHand = !inCodex && !!manualKeys[pub];
                  const keyState = inCodex ? "codex" : byHand ? "resolved" : "needed";
                  return (
                    <div
                      key={pub}
                      data-testid={`keyset-update-gate-row-${i}`}
                      data-key-state={keyState}
                      style={rowStyle}
                    >
                      <span style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                        <code style={{ fontSize: 10, color: "#d2d3d4" }}>{shortKey(pub)}</code>
                        <span
                          style={{
                            fontSize: 10,
                            color: keyState === "needed" ? "#a1a1aa" : "#4ade80",
                          }}
                        >
                          {keyState === "codex"
                            ? "held by this codex"
                            : keyState === "resolved"
                              ? "verified by hand"
                              : analysis.satisfied
                                ? "not required — threshold met"
                                : "private key needed"}
                        </span>
                      </span>
                      {keyState === "needed" && (
                        <ManualKeyInput
                          label={`Key ${i + 1} of ${analysis.keys.length}`}
                          foreignKeys={[pub]}
                          resolved={manualKeys}
                          neededMore={analysis.neededMore}
                          onResolve={handleResolve}
                        />
                      )}
                    </div>
                  );
                })}
              </div>

              <button
                type="button"
                data-testid="keyset-update-gate-forfeit"
                style={btnStyle}
                onClick={handleForfeit}
              >
                Forfeit the update
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}
