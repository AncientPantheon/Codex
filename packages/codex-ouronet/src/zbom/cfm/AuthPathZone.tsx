/**
 * AuthPathZone — Smart Ouronet Account auth-path picker (key-based branches).
 *
 * Smart accounts (Σ. prefix) authorise mutations on-chain via `enforce-one`
 * over THREE branches: the account's own guard, the current sovereign
 * account's guard, and the account's governor. This UI, however, can only
 * sign with KEYS — and as of the guard-type split the account guard +
 * sovereign guard are key-based (keyset / keyset-ref) while the governor is
 * NON-key-based (user / capability / module / pact). The governor branch is
 * therefore unusable from a key-driven UI (it exists for direct on-chain
 * operations), so this zone exposes only TWO branches: Account Guard and
 * Sovereign Guard. When neither is satisfiable from the codex, the zone
 * displays a "ZBOM cannot satisfy this transaction" panel and refers the
 * user to the Execute Code page.
 *
 * Visual structure:
 *
 *   ┌─ Zone — Auth Path (Smart Account) ─────────────────────────┐
 *   │ ⓘ Smart accounts authorise via either of two key branches. │
 *   │ Pick the one you want to use to sign this transaction.     │
 *   │                                                            │
 *   │ ● Account Guard            keyset      ✓ 2/2  Ready        │
 *   │ ○ Sovereign Guard          keyset      ✓ 1/2  Manual key   │
 *   │                                                            │
 *   │ [ManualKeyInput when chosen branch needs more keys]        │
 *   └────────────────────────────────────────────────────────────┘
 *
 * Emits to parent via `onChange({ branchIndex, chosenKeyset })`:
 *   - `branchIndex`: 0 (guard) / 1 (sovereign) / -1 (none)
 *   - `chosenKeyset`: the keyset of the chosen branch, or null when
 *     no satisfiable selection has been made yet.
 *
 * The parent passes `chosenKeyset` to `strategy.execute({ guards: [
 * patron, chosenKeyset ] })` exactly like any other modal — the OR-of-
 * branches resolution happens HERE, before the strategy is called.
 *
 * v0.30.13 (three-branch). Reduced to two branches (governor dropped from
 * the UI) when the guard / governor key-based split landed.
 */

import { useEffect, useMemo, useState, useCallback } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Info,
  ShieldQuestion,
} from "lucide-react";
import {
  analyzeSmartAccountAuthPaths,
  buildCodexPubSet,
  type GuardKind,
  type IKeyset,
  type SmartAccountAuthPaths,
} from "@stoachain/stoa-core/guard";
import { useWallet } from "./seam.js";
import { ManualKeyInput } from "../ui/ManualKeyInput.js";

// ─── Visual tokens — orange-ish auth scheme to differ from green Signing ────

const ORANGE      = "#cd7f32";
const ORANGE_BG   = "#cd7f320d";
const ORANGE_BD   = "#cd7f3250";
const ORANGE_LBL  = "#e8a872";

const KIND_BADGE: Record<GuardKind, { bg: string; fg: string; label: string }> = {
  keyset:       { bg: "#ceac5f20", fg: "#ceac5f", label: "keyset" },
  "keyset-ref": { bg: "#3b82f620", fg: "#60a5fa", label: "keyset-ref" },
  capability:   { bg: "#14b8a620", fg: "#2dd4bf", label: "capability" },
  user:         { bg: "#d946ef20", fg: "#e879f9", label: "user-guard" },
  unknown:      { bg: "#26262680", fg: "#888",    label: "unknown" },
};

const BRANCH_LABEL: Record<"guard" | "sovereign" | "governor", string> = {
  guard:     "Account Guard",
  sovereign: "Sovereign Guard",
  governor:  "Governor",
};

const BRANCH_TIP: Record<"guard" | "sovereign" | "governor", string> = {
  guard:     "The Smart account's own guard. Direct ownership path.",
  sovereign: "The guard of the Smart account's current sovereign (a Standard Ouronet account). Sovereignty grants delegated control.",
  governor:  "The Smart account's governor — a custom Pact guard. Often a keyset, sometimes a capability-guard or user-guard.",
};

// ─── Selection callback shape ────────────────────────────────────────────────

export interface AuthPathSelection {
  /** -1 when no satisfiable branch is selected. */
  readonly branchIndex: number;
  /**
   * The branch index 0/1/2 → 'guard' | 'sovereign' | 'governor', for
   * humans + telemetry. Null when no branch chosen.
   */
  readonly branch: "guard" | "sovereign" | "governor" | null;
  /**
   * Keyset to pass to `strategy.execute({ guards })`. Null when the
   * chosen branch is non-keyset OR when no branch is satisfied yet.
   */
  readonly chosenKeyset: IKeyset | null;
  /**
   * True when ZBOM can produce a working transaction. When false the
   * parent's Execute button must be disabled.
   */
  readonly satisfied: boolean;
  /**
   * True when no branch is keyset-based at all → user must use the
   * Execute Code page. UI surfaces a fallback panel; parent typically
   * also disables Execute.
   */
  readonly impossibleViaZbom: boolean;
}

// ─── Props ───────────────────────────────────────────────────────────────────

export interface AuthPathZoneProps {
  /** Smart account's own guard (from `account.guard`). */
  accountGuard: unknown;
  /**
   * Sovereign account's guard. Resolve via
   * `getKadenaAccountGuard(account.sovereign)` at modal mount; pass
   * `undefined` while the fetch is in flight (the zone shows a loading
   * row instead of "unknown").
   */
  sovereignGuard: unknown | undefined;
  /**
   * Whether the sovereign-guard fetch has resolved. When false, the
   * sovereign row renders as "Loading…" instead of classifying.
   */
  sovereignLoaded: boolean;
  /** Called whenever the user's selection or its satisfaction changes. */
  onChange: (selection: AuthPathSelection) => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function AuthPathZone({
  accountGuard,
  sovereignGuard,
  sovereignLoaded,
  onChange,
}: AuthPathZoneProps) {
  const { kadena: kadenaSeeds, kadenaAccounts } = useWallet();
  const [resolvedManualKeys, setResolvedManualKeys] = useState<Record<string, string>>({});
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);

  const handleResolveKey = useCallback((pub: string, priv: string) => {
    setResolvedManualKeys((prev) => ({ ...prev, [pub]: priv }));
  }, []);

  // ── Pull the codex public-key set ───────────────────────────────────────────
  const codexPubs = useMemo(
    () => buildCodexPubSet(kadenaSeeds, kadenaAccounts),
    [kadenaSeeds, kadenaAccounts],
  );

  // ── Analyse the auth branches via core's primitive ──────────────────────────
  // The core analyzer still computes all three branches; we pass `governor:
  // null` to keep it inert (the governor is non-key-based and unusable from
  // this key-driven UI) and filter it out below so only Account Guard +
  // Sovereign Guard are ever rendered or selectable.
  const paths: SmartAccountAuthPaths = useMemo(
    () => analyzeSmartAccountAuthPaths(
      {
        accountGuard,
        // While the sovereign fetch is in flight, treat as null so the
        // branch renders as "loading" without the analyzer producing
        // a misleading "unknown" classification on a real sovereign.
        sovereignGuard: sovereignLoaded ? sovereignGuard : null,
        governor: null,
      },
      codexPubs,
      resolvedManualKeys,
    ),
    [accountGuard, sovereignGuard, sovereignLoaded, codexPubs, resolvedManualKeys],
  );

  // ── Two-branch view: Account Guard + Sovereign Guard only ───────────────────
  const branches = useMemo(
    () => paths.branches.filter((b: any) => b.which !== "governor"),
    [paths],
  );
  const firstSatisfied = useMemo(
    () => branches.findIndex((b: any) => b.analysis?.satisfied === true),
    [branches],
  );
  const anyKeyBased = useMemo(
    () => branches.some((b: any) => b.keyBased),
    [branches],
  );

  // ── Auto-pick the first satisfied branch on mount / when paths change. ─
  // Honor the user's explicit selection if it's still in a key-based branch.
  useEffect(() => {
    if (selectedIndex !== -1 && branches[selectedIndex]?.keyBased) {
      // User has already chosen and that branch is still key-based —
      // keep their choice.
      return;
    }
    setSelectedIndex(firstSatisfied);
  }, [firstSatisfied, branches, selectedIndex]);

  // ── Emit selection state up to parent ──────────────────────────────────────
  useEffect(() => {
    const branch = branches[selectedIndex];
    const chosenKeyset =
      branch && branch.keyBased && branch.analysis
        ? { keys: branch.analysis.keys, pred: branch.analysis.pred }
        : null;
    const satisfied = !!branch?.analysis?.satisfied;
    onChange({
      branchIndex: selectedIndex,
      branch: branch?.which ?? null,
      chosenKeyset,
      satisfied,
      impossibleViaZbom: !anyKeyBased,
    });
  }, [branches, anyKeyBased, selectedIndex, onChange]);

  // ── Collapsible header. AuthPathZone defaults to OPEN regardless of any
  //    zbomZone* user preference: this zone is the user's only window into
  //    which auth branch will sign, what its readiness is, and where to
  //    drop a manual key when codex is missing one. Hiding it on first
  //    open makes the modal look broken (Execute disabled with no
  //    visible reason). The user can still collapse it manually. ──
  const [open, setOpen] = useState(true);

  return (
    <div
      style={{
        borderRadius: "10px",
        border: `1px solid ${ORANGE_BD}`,
        backgroundColor: ORANGE_BG,
        overflow: "hidden",
      }}
    >
      {/* ── Collapsible header ── */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-1.5 text-left"
        style={{
          background: "transparent",
          border: "none",
          cursor: "pointer",
          padding: "7px 10px",
          borderBottom: open ? `1px solid ${ORANGE_BD}` : "none",
        }}
      >
        {open
          ? <ChevronDown style={{ width: 13, height: 13, color: "#555", flexShrink: 0 }} />
          : <ChevronRight style={{ width: 13, height: 13, color: "#555", flexShrink: 0 }} />}
        <span
          style={{
            fontSize: "10px",
            fontWeight: "bold",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: ORANGE_LBL,
          }}
        >
          Auth Path — Smart Account (enforce-one)
        </span>
        <span
          style={{
            fontSize: "9px",
            fontFamily: "'Courier New','Lucida Console',monospace",
            color: `${ORANGE_LBL}80`,
          }}
        >
          ({branches.filter((b: any) => b.keyBased).length} key-based / 2)
        </span>
      </button>

      {/* ── Body ── */}
      {open && (
        <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: "8px" }}>
          <p style={{ fontSize: "10px", color: "#888", margin: 0 }}>
            Smart accounts authorise via <code style={{ color: ORANGE_LBL }}>enforce-one</code>{" "}
            over the account guard, sovereign guard, and governor — but the governor is
            non-key-based and unusable from this key-driven UI, so pick one of the two
            key-based branches (keyset / keyset-ref) to sign this transaction.
          </p>

          {/* ── Two branches (Account Guard + Sovereign Guard) ── */}
          {branches.map((b: any, i: number) => {
            const isLoading  = b.which === "sovereign" && !sovereignLoaded;
            const badge      = KIND_BADGE[b.kind as GuardKind];
            const ready      = b.analysis?.satisfied === true;
            const partial    = b.keyBased && !ready && (b.analysis?.signable ?? 0) > 0;
            const selectable = b.keyBased; // unknown / capability / user not selectable
            const selected   = selectedIndex === i;

            // Per-branch border colour — green when ready, amber when partial,
            // red when key-based but no codex coverage at all, grey otherwise.
            const rowBorder =
              isLoading ? "#26262680"
              : !b.keyBased ? "#8b1a1a30"
              : ready ? "#22c55e40"
              : partial ? "#f59e0b40"
              : "#8b1a1a30";

            const handleClick = () => {
              if (!selectable) return;
              setSelectedIndex(i);
            };

            return (
              <div
                key={b.which}
                role={selectable ? "button" : undefined}
                onClick={handleClick}
                title={BRANCH_TIP[b.which as "guard" | "sovereign" | "governor"]}
                style={{
                  borderRadius: "8px",
                  border: `1px solid ${rowBorder}`,
                  backgroundColor: selected ? `${ORANGE}10` : "#0a0a0a",
                  padding: "8px 10px",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  cursor: selectable ? "pointer" : "not-allowed",
                  transition: "background-color 120ms ease",
                  outline: selected ? `1px solid ${ORANGE}80` : "none",
                  outlineOffset: 0,
                }}
              >
                {/* Radio indicator */}
                <div
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: "50%",
                    border: `1.5px solid ${selectable ? (selected ? ORANGE : "#444") : "#333"}`,
                    backgroundColor: selected ? ORANGE : "transparent",
                    flexShrink: 0,
                  }}
                />

                {/* Branch label */}
                <span style={{ fontSize: "12px", color: "#d2d3d4", flex: 1 }}>
                  {BRANCH_LABEL[b.which as "guard" | "sovereign" | "governor"]}
                </span>

                {/* Kind badge */}
                <span
                  style={{
                    fontSize: "10px",
                    padding: "1px 6px",
                    borderRadius: "999px",
                    backgroundColor: badge.bg,
                    color: badge.fg,
                    flexShrink: 0,
                    whiteSpace: "nowrap",
                  }}
                >
                  {isLoading ? "loading…" : badge.label}
                </span>

                {/* Status pill */}
                {isLoading ? (
                  <span
                    style={{
                      fontSize: "10px",
                      fontFamily: "monospace",
                      color: "#888",
                      flexShrink: 0,
                    }}
                  >
                    …
                  </span>
                ) : !b.keyBased ? (
                  <span
                    style={{
                      fontSize: "10px",
                      color: "#c0392b",
                      display: "flex",
                      alignItems: "center",
                      gap: "3px",
                      flexShrink: 0,
                    }}
                  >
                    <ShieldQuestion style={{ width: 12, height: 12 }} />
                    ZBOM cannot
                  </span>
                ) : ready ? (
                  <span
                    style={{
                      fontSize: "10px",
                      color: "#4ade80",
                      display: "flex",
                      alignItems: "center",
                      gap: "3px",
                      flexShrink: 0,
                    }}
                  >
                    <CheckCircle2 style={{ width: 12, height: 12 }} />
                    {b.analysis!.signable}/{b.analysis!.threshold} ready
                  </span>
                ) : (
                  <span
                    style={{
                      fontSize: "10px",
                      color: partial ? "#f59e0b" : "#c0392b",
                      display: "flex",
                      alignItems: "center",
                      gap: "3px",
                      flexShrink: 0,
                    }}
                  >
                    <AlertTriangle style={{ width: 12, height: 12 }} />
                    {b.analysis ? `${b.analysis.signable}/${b.analysis.threshold} (need ${b.analysis.neededMore} more)` : "—"}
                  </span>
                )}
              </div>
            );
          })}

          {/* ── Manual key input — shown only for the chosen branch when it's
                key-based, partially satisfied, and has unresolved foreigns. ── */}
          {selectedIndex >= 0 &&
            branches[selectedIndex]?.analysis &&
            !branches[selectedIndex].analysis!.satisfied &&
            branches[selectedIndex].analysis!.foreignKeys.length > 0 && (
              <ManualKeyInput
                label={BRANCH_LABEL[branches[selectedIndex].which as "guard" | "sovereign" | "governor"]}
                foreignKeys={branches[selectedIndex].analysis!.foreignKeys}
                resolved={resolvedManualKeys}
                neededMore={branches[selectedIndex].analysis!.neededMore}
                onResolve={handleResolveKey}
              />
            )}

          {/* ── No-key-based-path fallback — refer to Execute Code ── */}
          {!anyKeyBased && sovereignLoaded && (
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "8px",
                padding: "10px",
                backgroundColor: "#8b1a1a10",
                border: "1px solid #8b1a1a40",
                borderRadius: "8px",
              }}
            >
              <Info
                style={{ width: 14, height: 14, color: "#c0392b", flexShrink: 0, marginTop: "1px" }}
              />
              <div style={{ flex: 1 }}>
                <p
                  style={{
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "#c0392b",
                    margin: "0 0 2px 0",
                  }}
                >
                  ZBOM cannot satisfy this transaction
                </p>
                <p style={{ fontSize: "10px", color: "#888", margin: 0 }}>
                  Neither the account guard nor the sovereign guard is key-based. The codex
                  can only sign for keysets / keyset-refs — capability-guards and user-guards
                  require on-chain capability acquisition that the ZBOM does not generate. Use the
                  <strong style={{ color: "#d2d3d4" }}> Execute Code </strong>
                  page to construct a custom transaction with the appropriate
                  capability acquisitions.
                </p>
                <a
                  href="/execute-code"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                    marginTop: "4px",
                    fontSize: "10px",
                    color: ORANGE_LBL,
                    textDecoration: "underline",
                  }}
                >
                  Open Execute Code
                  <ExternalLink style={{ width: 10, height: 10 }} />
                </a>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default AuthPathZone;
