/**
 * RotateGovernorModal — CFM Architecture v2 (canonical ZBOM pattern).
 * Operates on a Smart Ouronet Account (Σ.), rotating its GOVERNOR.
 *
 * The governor slot is the inverse of the account GUARD slot: the chain
 * restricts it to NON-key-based guards (user / capability / module / pact).
 * The governor is therefore authored inline through NonKeyGuardEntryInput —
 * the user picks one of the five constructors and supplies the argument
 * expression; core assembles `(constructor body)` via buildNonKeyGuardExpr,
 * and buildRotateGovernorPactCode interpolates it bare (no .addData payload).
 *
 * Auth: Smart-account mutations authorise via `enforce-one` over (account
 * guard / sovereign guard / governor). The UI is key-driven, so AuthPathZone
 * exposes only the two KEY-BASED branches (account guard, sovereign guard) —
 * the governor branch is for direct on-chain operations and is dropped here.
 *
 * Pact functions:
 *   INFO    — (ouronet-ns.INFO-ZERO.DALOS-INFO|URC_RotateGovernor patron account)
 *   EXECUTE — (ouronet-ns.TS01-C1.DALOS|C_RotateGovernor patron account governor-expr)
 *
 * Zones:
 *   0 — Function Info     → FunctionInfoZone
 *   1 — Patron Spend      → PatronZonePattern2
 *   2 — Function Inputs   → Zone2Wrapper
 *                            INPUT I   <patron:string>   (autonomous)
 *                            INPUT II  <account:string>  (autonomous)
 *                            INPUT III <governor:guard>  (NonKeyGuardEntryInput,
 *                                                         pre-filled from chain)
 *   3 — Auth Path         → AuthPathZone (two key-based branches)
 *   4 — Signing           → SigningZone
 *   5 — Actions           → Rotate Governor
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Pact } from "@stoachain/kadena-stoic-legacy/client";
import { ZbomModalFrame } from "../ui/ZbomModalFrame.js";
import { InfoTooltip } from "../ui/InfoTooltip.js";
import { usePatronSelectionDefaults } from "../patron/usePatronSelectionDefaults.js";
import { txPending } from "../toast/toastManager.js";
import { Gavel, Loader2 } from "lucide-react";
import { getIgnisBalance, getKadenaAccountGuard } from "../debouncer/monitoredReads.js";
import { pactRead } from "@stoachain/stoa-core/reads";
import { KADENA_CHAIN_ID, KADENA_NETWORK } from "@stoachain/stoa-core/constants";
import {
  KADENA_NAMESPACE,
  STOA_AUTONOMIC_OURONETGASSTATION,
} from "@stoachain/ouronet-core/constants";
import { buildRotateGovernorPactCode, buildNonKeyGuardExpr, type NonKeyGuardConstructor } from "@stoachain/ouronet-core/pact";
import { safeCreationTime, mayComeWithDeimal } from "@stoachain/stoa-core/pact";
import type { IKeyset } from "@stoachain/stoa-core/guard";
import type { IOuroAccount, IKadenaSeed, IKadenaWallet } from "../../types/entities.js";
import { ZbomLayout } from "../cfm/ZbomLayout.js";
import { FunctionInfoZone } from "../cfm/FunctionInfoZone.js";
import { PatronZonePattern2 } from "../cfm/PatronSpend.js";
import { Zone2Wrapper } from "../cfm/Zone2Wrapper.js";
import { SigningZone } from "../cfm/SigningZone.js";
import { StringEntryInput, NonKeyGuardEntryInput } from "../cfm/inputs.js";
import { serializeGovernorToInput, type NonKeyGuardValue } from "../cfm/governorSerialize.js";
import { AuthPathZone, type AuthPathSelection } from "../cfm/AuthPathZone.js";
import { useSignTransaction } from "../../hooks/index.js";
import { useEnsureCodexUnlocked } from "../hooks/useEnsureCodexUnlocked.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toNum(v: any): number {
  if (v === null || v === undefined) return 0;
  const raw = mayComeWithDeimal(v);
  return typeof raw === "number" ? raw : parseFloat(String(raw)) || 0;
}

// ─── Types ────────────────────────────────────────────────────────────────────

type PatronMode = "prime" | "resident" | "custom";

interface Props {
  open: boolean;
  onClose: () => void;
  /** The Smart account whose governor is being rotated (Σ.). */
  account: IOuroAccount;
  /** Full codex Ouronet accounts — for patron Custom selector. */
  accounts: IOuroAccount[];
  kadenaSeeds: IKadenaSeed[];
  kadenaAccounts: IKadenaWallet[];
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function RotateGovernorModal({
  open,
  onClose,
  account,
  accounts,
  kadenaSeeds: _kadenaSeeds,
  kadenaAccounts: _kadenaAccounts,
}: Props) {
  const { execute } = useSignTransaction();
  const ensureCodexUnlocked = useEnsureCodexUnlocked();

  // ── Patron selection mode (canonical wiring via usePatronSelectionDefaults) ──
  const { initialPatronMode, autoSelectBestPatron } = usePatronSelectionDefaults();

  // ── Patron state ──
  const [patronMode, setPatronMode] = useState<PatronMode>(initialPatronMode);
  const [selectedCustomAccount, setSelectedCustomAccount] = useState<IOuroAccount | null>(null);
  const [patronIgnisBalance, setPatronIgnisBalance] = useState<number | null>(null);

  // ── INFO data ──
  const [infoData, setInfoData] = useState<any>(null);
  const [loadingInfo, setLoadingInfo] = useState(false);

  // ── governor input (controlled — parent owns constructor + body so the
  //    field can render in both Zone2 slots without diverging) ──
  const [governorCtor, setGovernorCtor] = useState<NonKeyGuardConstructor>("create-user-guard");
  const [governorBody, setGovernorBody] = useState<string>("");

  // ── Sovereign guard fetch (for AuthPathZone) ──
  const [sovereignGuard, setSovereignGuard] = useState<unknown>(null);
  const [sovereignLoaded, setSovereignLoaded] = useState(false);

  // ── AuthPathZone selection ──
  const [authSelection, setAuthSelection] = useState<AuthPathSelection>({
    branchIndex: -1,
    branch: null,
    chosenKeyset: null,
    satisfied: false,
    impossibleViaZbom: false,
  });

  // ── Execute state ──
  const [isProcessing, setIsProcessing] = useState(false);

  // ── Derived accounts ──
  const primeAccount = accounts[0] ?? null;
  const patronAccount = useMemo<IOuroAccount | null>(() => {
    if (patronMode === "prime")    return primeAccount;
    if (patronMode === "resident") return account;
    return selectedCustomAccount ?? primeAccount;
  }, [patronMode, selectedCustomAccount, primeAccount, account]);

  const displayAccountName = (acc: IOuroAccount | null | undefined): string => {
    if (!acc) return "—";
    return accounts.indexOf(acc) === 0 ? "CodexPrime" : acc.name || acc.address?.slice(0, 20) + "…";
  };

  // ── Patron IGNIS balance ──
  useEffect(() => {
    if (!open || !patronAccount?.address) return;
    setPatronIgnisBalance(null);
    let aborted = false;
    getIgnisBalance(patronAccount.address)
      .then((v) => { if (!aborted) setPatronIgnisBalance(v ? parseFloat(v) : 0); })
      .catch(() => { if (!aborted) setPatronIgnisBalance(0); });
    return () => { aborted = true; };
  }, [open, patronAccount?.address]);

  // ── INFO fetch (URC_RotateGovernor — same shape as INFO-ZERO functions) ──
  useEffect(() => {
    if (!open || !patronAccount?.address || !account?.address) return;
    setLoadingInfo(true);
    setInfoData(null);
    let aborted = false;
    pactRead(
      `(${KADENA_NAMESPACE}.INFO-ZERO.DALOS-INFO|URC_RotateGovernor "${patronAccount.address}" "${account.address}")`,
      { tier: "T7" },
    )
      .then((res: any) => {
        if (aborted) return;
        const data = res?.result?.data ?? null;
        setInfoData(data);
      })
      .catch(() => { if (!aborted) setInfoData(null); })
      .finally(() => { if (!aborted) setLoadingInfo(false); });
    return () => { aborted = true; };
  }, [open, patronAccount?.address, account?.address]);

  // ── Sovereign guard fetch — needed for the AuthPathZone sovereign branch ──
  useEffect(() => {
    if (!open) return;
    setSovereignGuard(null);
    setSovereignLoaded(false);
    const sov = (account as any).sovereign as string | false | undefined;
    if (!sov || typeof sov !== "string") {
      setSovereignLoaded(true);
      return;
    }
    let aborted = false;
    getKadenaAccountGuard(sov)
      .then((g) => { if (!aborted) setSovereignGuard(g); })
      .catch(() => { if (!aborted) setSovereignGuard(null); })
      .finally(() => { if (!aborted) setSovereignLoaded(true); });
    return () => { aborted = true; };
  }, [open, account]);

  // The current on-chain governor reduced to { constructor, body }. The UI only
  // exposes user / capability guards, so a capability-pact seed (same `(CAP …)`
  // body) is coerced to a plain capability guard. Drives the initial field
  // state, the restore-on-switch behaviour, and the no-op rotation guard.
  const governorSeed = useMemo<{ constructor: NonKeyGuardConstructor; body: string }>(() => {
    const ser = serializeGovernorToInput((account as any).governor);
    const ctor =
      ser.constructor === "create-capability-pact-guard" ? "create-capability-guard" : ser.constructor;
    return { constructor: ctor, body: ser.body };
  }, [account]);

  // ── Reset on close ──
  useEffect(() => {
    if (!open) return;
    setPatronMode(initialPatronMode);
    setSelectedCustomAccount(null);
    setPatronIgnisBalance(null);
    setInfoData(null);
    setLoadingInfo(false);
    // Seed the governor field from the current on-chain governor so the
    // modal opens pre-filled with the exact value, ready to edit.
    setGovernorCtor(governorSeed.constructor);
    setGovernorBody(governorSeed.body);
    setSovereignGuard(null);
    setSovereignLoaded(false);
    setAuthSelection({
      branchIndex: -1,
      branch: null,
      chosenKeyset: null,
      satisfied: false,
      impossibleViaZbom: false,
    });
    setIsProcessing(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ── Derived INFO values ──
  const ignisCost = toNum(infoData?.ignis?.["ignis-need"]);
  const virtualToggleActive = ignisCost > 0;
  const hasEnoughIgnis = (patronIgnisBalance ?? 0) >= ignisCost;
  const insufficientIgnis = !hasEnoughIgnis && infoData !== null && ignisCost > 0;

  // ── governor validation ──
  // The emitted value — `null` until the user supplies a non-empty body.
  const governorValue = useMemo<NonKeyGuardValue>(
    () => (governorBody.trim().length === 0 ? null : { constructor: governorCtor, body: governorBody.trim() }),
    [governorCtor, governorBody],
  );
  const governorExpr = governorValue ? `(${governorValue.constructor} ${governorValue.body})` : null;

  // The current on-chain governor in canonical form (only when it is a
  // recognised non-key guard — key-based / unknown governors produce an empty
  // body and skip the unchanged check). Blocks a pure no-op rotation
  // (submitting the untouched prefill verbatim).
  const currentGovernorExpr =
    governorSeed.body.trim().length > 0
      ? `(${governorSeed.constructor} ${governorSeed.body.trim()})`
      : null;

  const governorUnchanged =
    !!governorExpr && !!currentGovernorExpr && governorExpr === currentGovernorExpr;

  // ── Stable callbacks ──
  const handleAuthPathChange = useCallback((sel: AuthPathSelection) => {
    setAuthSelection(sel);
  }, []);

  // ── canExecute + blocker reason ──
  const blockerReason = (() => {
    if (isProcessing)                     return null;
    if (loadingInfo || infoData === null) return "Loading function info…";
    if (!patronAccount)                   return "Pick a patron";
    if (insufficientIgnis)                return "Insufficient IGNIS";
    if (!sovereignLoaded)                 return "Loading sovereign guard…";
    if (!governorValue || !governorExpr)  return "Author the new governor";
    if (governorUnchanged)                return "Governor unchanged";
    if (authSelection.impossibleViaZbom)  return "No key-based auth path — use Execute Code";
    if (!authSelection.chosenKeyset)      return "Pick an auth path";
    if (!authSelection.satisfied)         return "Auth path needs more keys";
    return null;
  })();
  const canExecute = blockerReason === null && !isProcessing;

  // ── Patron guard for strategy ──
  const patronGuard = useMemo<IKeyset | null>(
    () => ((patronAccount?.guard as any) ?? null),
    [patronAccount],
  );

  // ── Execute ──
  async function handleExecute() {
    if (!canExecute || !patronAccount || !patronGuard || !authSelection.chosenKeyset || !governorValue) return;
    setIsProcessing(true);
    const _tx = txPending("Rotate Governor");
    try {
      // Ensure the codex is unlocked before signing (the password cache may
      // have lapsed while the user authored the governor).
      if (!(await ensureCodexUnlocked())) { _tx.fail("Authentication required"); return; }

      const governorExprFinal = buildNonKeyGuardExpr({
        constructor: governorValue.constructor,
        body:        governorValue.body,
      });
      const pactCode = buildRotateGovernorPactCode({
        patron:       patronAccount.address,
        account:      account.address,
        governorExpr: governorExprFinal,
      });

      const { requestKey } = await execute({
        build: ({ gasLimit, capsKeyPub, guardPubs }: { gasLimit: number; capsKeyPub: string; guardPubs: string[] }) => {
          let builder = Pact.builder
            .execution(pactCode)
            .setMeta({
              senderAccount: STOA_AUTONOMIC_OURONETGASSTATION,
              creationTime:  safeCreationTime(),
              chainId:       KADENA_CHAIN_ID,
              gasLimit,
            })
            .setNetworkId(KADENA_NETWORK)
            .addSigner(capsKeyPub, (w: any) => [
              w(`${KADENA_NAMESPACE}.DALOS.GAS_PAYER`, "", { int: 0 }, { decimal: "0.0" }),
            ]);
          for (const gp of guardPubs) builder = (builder as any).addSigner(gp);
          return (builder as any).createTransaction();
        },
        guards: [patronGuard, authSelection.chosenKeyset],
        paymentKey: null,
      });

      _tx.submitted(requestKey);
      onClose();
    } catch (e: any) {
      console.error("[RotateGovernor handleExecute]", e);
      _tx.fail(e?.message ?? "Failed");
    } finally {
      setIsProcessing(false);
    }
  }

  if (!open) return null;

  return (
    <ZbomModalFrame onClose={onClose} width={720}>
      <ZbomLayout
        header={
          <>
            <div className="flex items-center gap-2">
              <Gavel className="h-5 w-5" style={{ color: "#a78bfa" }} />
              <h2 className="text-lg font-bold" style={{ color: "#d2d3d4" }}>
                Rotate Governor
              </h2>
              <InfoTooltip content="Changes the governor of this Smart Ouronet account. The governor is a NON-key-based guard (user / capability / module / pact) for direct on-chain governance. Authorise the rotation with a key-based branch — the account guard or the sovereign's guard." />
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs" style={{ color: "#888" }}>Account:</span>
              <span className="text-xs font-mono font-bold" style={{ color: "#a78bfa" }}>
                {displayAccountName(account)}
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full"
                style={{ backgroundColor: "#8b5cf620", color: "#a78bfa" }}>
                Σ. Smart
              </span>
            </div>
          </>
        }
        executeButton={{
          canExecute,
          isProcessing,
          onClick: handleExecute,
          bgColor: insufficientIgnis
            ? "#c0392b"
            : canExecute
              ? "#a78bfa"
              : "#262626",
          textColor: insufficientIgnis
            ? "#fff"
            : canExecute
              ? "#0a0a0a"
              : "#888",
          content: canExecute
            ? (
              <>
                <Gavel className="inline h-4 w-4 mr-1.5 align-text-bottom" />
                Rotate Governor
              </>
            )
            : (blockerReason ?? "Rotate Governor"),
          processingContent: (
            <>
              <Loader2 className="inline h-4 w-4 mr-2 animate-spin" />Processing…
            </>
          ),
        }}
      >

        {/* ── Zone 0 — Function Info ── */}
        <FunctionInfoZone
          key={patronAccount?.address}
          readId="INFO_RotateGovernor"
          label="DALOS-INFO|URC_RotateGovernor"
          pactCall={`(ouronet-ns.INFO-ZERO.DALOS-INFO|URC_RotateGovernor "${(patronAccount?.address ?? "").slice(0, 20)}…" "${account.address.slice(0, 20)}…")`}
          fetcher={async () => {
            const res = await pactRead(
              `(${KADENA_NAMESPACE}.INFO-ZERO.DALOS-INFO|URC_RotateGovernor "${patronAccount?.address ?? ""}" "${account.address}")`,
              { tier: "T7" },
            );
            return (res as any)?.result?.data ?? null;
          }}
        />

        {/* ── Zone 1 — Patron Spend ── */}
        <PatronZonePattern2
          patronMode={patronMode}
          onPatronModeChange={setPatronMode}
          primeAccount={primeAccount}
          residentAccount={account}
          codexAccounts={accounts}
          selectedCustomAccount={selectedCustomAccount}
          onSelectCustomAccount={setSelectedCustomAccount}
          ignisCost={ignisCost}
          virtualToggleActive={virtualToggleActive}
          patronIgnisBalance={patronIgnisBalance}
          loading={loadingInfo}
          autoSelectBestPatron={autoSelectBestPatron}
        />

        {/* ── Zone 2 — Function Inputs ──
            Basic mode (zbomZone2 = false) hides the two autonomous rows
            (patron + account) and shows only the governor authoring field
            via `collapsedContent`. The governor field opens pre-filled with
            the current on-chain governor, ready to edit. */}
        {(() => {
          const governorRow = (
            <NonKeyGuardEntryInput
              labelIndex={3}
              varName="governor"
              constructorName={governorCtor}
              body={governorBody}
              onConstructorChange={setGovernorCtor}
              onBodyChange={setGovernorBody}
              initialSeed={governorSeed}
            />
          );

          return (
            <Zone2Wrapper
              functionName="ouronet-ns.TS01-C1.DALOS|C_RotateGovernor"
              functionMeta={{
                locations:      ["Settings -> Ouronet Account -> Rotate Governor"],
                name:           "Rotate Governor",
                description:    "Replaces the governor (a non-key-based guard for direct on-chain governance) of a Smart Ouronet account. Authorised by a key-based branch — the account guard or the sovereign's guard.",
                icon:           "gavel",
                addedInVersion: "1.2.5",
                addedDate:      "2026-05-30",
              }}
              collapsedContent={governorRow}
            >
              {/* INPUT I — patron (autonomous, derived from PatronZone selection) */}
              <StringEntryInput
                variant="autonomous"
                labelIndex={1}
                varName="patron"
                value={patronAccount?.address ?? ""}
              />

              {/* INPUT II — account (autonomous, the Smart account being rotated) */}
              <StringEntryInput
                variant="autonomous"
                labelIndex={2}
                varName="account"
                value={account.address}
              />

              {/* INPUT III — governor (free, pre-filled from the current governor) */}
              {governorRow}
            </Zone2Wrapper>
          );
        })()}

        {/* ── Auth Path — Smart Account key-based branch picker ── */}
        <AuthPathZone
          accountGuard={account.guard}
          sovereignGuard={sovereignGuard}
          sovereignLoaded={sovereignLoaded}
          onChange={handleAuthPathChange}
        />

        {/* ── Zone 3 — Signing (patron + chosen branch shown via additionalGuards) ── */}
        <SigningZone
          patronAccount={patronAccount}
          accountAccount={null /* account-side auth is in AuthPathZone */}
          additionalGuards={
            authSelection.chosenKeyset
              ? [{
                  label: `Account auth — ${authSelection.branch === "sovereign" ? "Sovereign Guard" : "Account Guard"}`,
                  guard: authSelection.chosenKeyset,
                }]
              : []
          }
        />
      </ZbomLayout>
    </ZbomModalFrame>
  );
}
