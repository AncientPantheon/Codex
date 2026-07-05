/**
 * RotateSovereignModal — CFM Architecture v2 (canonical Phase 3b+
 * pattern). The first ZBOM that operates on a Smart Ouronet Account.
 *
 * Smart accounts (Σ.) authorise mutations via `enforce-one` over THREE
 * branches (account guard, sovereign account guard, governor). The
 * AuthPathZone resolves the OR-of-3 in the UI layer and emits a single
 * chosen keyset; `strategy.execute` then runs its standard AND-of-keysets
 * pipeline with `[patronGuard, chosenAccountBranchKeyset]`.
 *
 * Pact functions:
 *   INFO    — (ouronet-ns.INFO-ZERO.DALOS-INFO|URC_RotateSovereign patron account)
 *   EXECUTE — (ouronet-ns.TS01-C1.DALOS|C_RotateSovereign patron account new-sovereign)
 *
 * Zones:
 *   0 — Function Info     → FunctionInfoZone
 *   1 — Patron Spend      → PatronZonePattern2
 *   2 — Function Inputs   → Zone2Wrapper + every execution-function arg
 *                            in canonical order:
 *                              INPUT I   <patron:string>        (autonomous)
 *                              INPUT II  <account:string>       (autonomous)
 *                              INPUT III <new-sovereign:string> (free)
 *                            Basic mode (zbomZone2 = false) collapses the
 *                            autonomous rows and shows only INPUT III via
 *                            collapsedContent. Advanced mode shows all 3.
 *   3 — Auth Path         → AuthPathZone (NEW — Smart-account three-branch picker)
 *   4 — Signing           → SigningZone (patron + chosen branch as additional)
 *   5 — Actions           → Rotate Sovereign
 *
 * v0.30.13.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Pact } from "@stoachain/kadena-stoic-legacy/client";
import { ZbomModalFrame } from "../ui/ZbomModalFrame.js";
import { InfoTooltip } from "../ui/InfoTooltip.js";
import { usePatronSelectionDefaults } from "../patron/usePatronSelectionDefaults.js";
import { txPending } from "../toast/toastManager.js";
import { Copy, Crown, Loader2, Lock } from "lucide-react";
import { OuronetAddressHighlight } from "../../ui/internal/OuronetAddressHighlight.js";
import { getIgnisBalance, getKadenaAccountGuard } from "../debouncer/monitoredReads.js";
import { pactRead } from "@stoachain/stoa-core/reads";
import { KADENA_CHAIN_ID, KADENA_NETWORK } from "@stoachain/stoa-core/constants";
import {
  KADENA_NAMESPACE,
  STOA_AUTONOMIC_OURONETGASSTATION,
} from "@stoachain/ouronet-core/constants";
import { buildRotateSovereignPactCode } from "@stoachain/ouronet-core/pact";
import { safeCreationTime, mayComeWithDeimal } from "@stoachain/stoa-core/pact";
import type { IKeyset } from "@stoachain/stoa-core/guard";
import type { IOuroAccount, IKadenaSeed, IKadenaWallet } from "../../types/entities.js";
import { ZbomLayout } from "../cfm/ZbomLayout.js";
import { FunctionInfoZone } from "../cfm/FunctionInfoZone.js";
import { PatronZonePattern2 } from "../cfm/PatronSpend.js";
import { Zone2Wrapper } from "../cfm/Zone2Wrapper.js";
import { SigningZone } from "../cfm/SigningZone.js";
import { StringEntryInput } from "../cfm/inputs.js";
import { AuthPathZone, type AuthPathSelection } from "../cfm/AuthPathZone.js";
import { useSignTransaction } from "../../hooks/index.js";
import { useEnsureCodexUnlocked } from "../hooks/useEnsureCodexUnlocked.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toNum(v: any): number {
  if (v === null || v === undefined) return 0;
  const raw = mayComeWithDeimal(v);
  return typeof raw === "number" ? raw : parseFloat(String(raw)) || 0;
}

function isStandardOuronetAddr(addr: string): boolean {
  return typeof addr === "string" && addr.startsWith("Ѻ.");
}

// ─── Ghost values ─────────────────────────────────────────────────────────────
// Pre-filled placeholder for the new-sovereign field. Two distinct strings
// so we can swap if the primary happens to equal the account's actual
// current sovereign (avoids suggesting "rotate to the same address you
// already have"). Strings supplied by the user; treated as opaque
// 160-char Ouronet placeholders.
const GHOST_SOVEREIGN_PRIMARY =
  "Ѻ.ъΦĞρλξäFφVПÉЫÍЬÙGěЭыц¥ĄïsKзŤ8£ΞδĚãlÍŃÝþáΩĘΞȘĎĄЛδůÖîĎĄΠДÈrЪqyςkѺδKłĄρțØänÀŚxчtÍςÃΩ₳9ť7ÇяŠΛδÓdťЗΞŻÛπΩ∇цжuлiØłÛáYπOкæáYoùχmŒуŞËЛΞьPĘáÛÝaBÑБžя₳țςhrĚë₱dÑLÞЛεñeîÓУłëΦ";
const GHOST_SOVEREIGN_FALLBACK =
  "Ѻ.éXødVțrřĄθ7ΛдUŒjeßćιiXTПЗÚĞqŸœÈэαLżØôćmч₱ęãΛě$êůáØCЗшõyĂźςÜãθΘзШË¥şEÈnxΞЗÚÏÛjDVЪжγÏŽнăъçùαìrпцДЖöŃȘâÿřh£1vĎO£κнβдłпČлÿáZiĐą8ÊHÂßĎЩmEBцÄĎвЙßÌ5Ï7ĘŘùrÑckeñëδšПχÌàî";

// ─── CurrentSovereignRow ──────────────────────────────────────────────────────
// Mirror of the autonomous StringEntryInput visual (dashed dim border,
// `OuronetAddressHighlight` for the silver-on-blue character processing,
// Lock + SYSTEM stamp, Copy button), but with a custom `CURRENT` label
// instead of `INPUT N` since it's not a function argument — it's the live
// on-chain value the user is rotating *away from*. Position: between
// INPUT II (account) and INPUT III (new-sovereign), so the user reads
// "you are rotating FROM this TO that" top-to-bottom.
function CurrentSovereignRow({ address }: { address: string }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
        <span style={{ fontSize: "9px", fontWeight: "bold", color: "#3d3d45", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          CURRENT
        </span>
        <span style={{ fontSize: "10px", fontFamily: "'Courier New','Lucida Console',monospace", color: "#5a4020", fontStyle: "italic", fontWeight: "bold" }}>
          &lt;sovereign:string&gt;
        </span>
      </div>
      <div
        title={address}
        style={{
          display: "flex",
          alignItems: "center",
          height: "36px",
          backgroundColor: "#080808",
          border: "1px dashed #2a2a2a",
          borderRadius: "8px",
          overflow: "hidden",
          cursor: "default",
        }}
      >
        <div style={{ flex: 1, padding: "0 10px", overflow: "hidden", display: "flex", alignItems: "center", minWidth: 0 }}>
          <OuronetAddressHighlight address={address} />
        </div>
        <div style={{ width: "1px", height: "20px", backgroundColor: "#2a2a2a", flexShrink: 0 }} />
        <div style={{ display: "flex", alignItems: "center", gap: "4px", padding: "0 8px", color: "#2d2d35", userSelect: "none", flexShrink: 0 }}>
          <Lock style={{ width: 11, height: 11 }} />
          <span style={{ fontSize: "9px", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            SYSTEM
          </span>
        </div>
        <div style={{ width: "1px", height: "20px", backgroundColor: "#2a2a2a", flexShrink: 0 }} />
        <button
          type="button"
          onClick={() => navigator.clipboard.writeText(address).catch(() => {})}
          title="Copy current sovereign"
          style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "32px", height: "100%", background: "transparent", border: "none", cursor: "pointer", color: "#333", flexShrink: 0 }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "#ceac5f")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "#333")}
        >
          <Copy style={{ width: 12, height: 12 }} />
        </button>
      </div>
    </div>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

type PatronMode = "prime" | "resident" | "custom";

interface Props {
  open: boolean;
  onClose: () => void;
  /** The Smart account whose sovereign is being rotated (Σ.). */
  account: IOuroAccount;
  /** Full codex Ouronet accounts — for patron Custom selector. */
  accounts: IOuroAccount[];
  kadenaSeeds: IKadenaSeed[];
  kadenaAccounts: IKadenaWallet[];
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function RotateSovereignModal({
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

  // ── new-sovereign input ──
  const [newSovereign, setNewSovereign] = useState("");

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

  // ── INFO fetch (URC_RotateSovereign — same shape as INFO-ZERO functions) ──
  useEffect(() => {
    if (!open || !patronAccount?.address || !account?.address) return;
    setLoadingInfo(true);
    setInfoData(null);
    let aborted = false;
    pactRead(
      `(${KADENA_NAMESPACE}.INFO-ZERO.DALOS-INFO|URC_RotateSovereign "${patronAccount.address}" "${account.address}")`,
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

  // ── Sovereign guard fetch — needed for the AuthPathZone middle branch ──
  useEffect(() => {
    if (!open) return;
    setSovereignGuard(null);
    setSovereignLoaded(false);
    const sov = (account as any).sovereign as string | false | undefined;
    if (!sov || typeof sov !== "string") {
      // Unactivated Smart account — no on-chain sovereign yet. AuthPathZone
      // will render the sovereign branch as 'unknown' / non-key-based.
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

  // ── Reset on close ──
  useEffect(() => {
    if (!open) return;
    setPatronMode(initialPatronMode);
    setSelectedCustomAccount(null);
    setPatronIgnisBalance(null);
    setInfoData(null);
    setLoadingInfo(false);
    setNewSovereign("");
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
    // initialPatronMode intentionally captured per-open — a Redux setting change
    // while the modal is closed should take effect on next open, not mid-open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ── Derived INFO values ──
  const ignisCost = toNum(infoData?.ignis?.["ignis-need"]);
  const virtualToggleActive = ignisCost > 0;
  const hasEnoughIgnis = (patronIgnisBalance ?? 0) >= ignisCost;
  const insufficientIgnis = !hasEnoughIgnis && infoData !== null && ignisCost > 0;

  // ── new-sovereign validation ──
  const newSovereignTrimmed = newSovereign.trim();
  const newSovereignIsStandard = isStandardOuronetAddr(newSovereignTrimmed);
  const currentSovereign =
    typeof (account as any).sovereign === "string"
      ? ((account as any).sovereign as string)
      : null;
  const newSovereignSameAsCurrent =
    !!currentSovereign && newSovereignTrimmed === currentSovereign;
  const newSovereignError =
    newSovereignTrimmed.length === 0
      ? null
      : !newSovereignIsStandard
        ? "Must be a Standard Ouronet account (Ѻ. prefix). Smart accounts cannot serve as sovereigns."
        : newSovereignSameAsCurrent
          ? "New sovereign equals current sovereign — pick a different account."
          : null;

  // ── Ghost placeholder for the new-sovereign field. Falls back to the
  //    secondary string if the primary collides with this account's
  //    current sovereign (avoids the placeholder suggesting the user's
  //    own existing sovereign as the "new" one). Memoised on account
  //    identity so the ghost is stable while the modal is open. ──
  const ghostNewSovereign = useMemo(() => {
    return currentSovereign === GHOST_SOVEREIGN_PRIMARY
      ? GHOST_SOVEREIGN_FALLBACK
      : GHOST_SOVEREIGN_PRIMARY;
  }, [currentSovereign]);

  // ── Stable callback for AuthPathZone ──
  const handleAuthPathChange = useCallback((sel: AuthPathSelection) => {
    setAuthSelection(sel);
  }, []);

  // ── canExecute + blocker reason ──
  // Why-disabled hierarchy. First match wins. UX: the Execute button
  // text reflects the *specific* blocker so the user can react without
  // hunting through five collapsed zones for what's wrong. `null` here
  // means everything passes and the button reads "Rotate Sovereign".
  const blockerReason = (() => {
    if (isProcessing)                  return null; // handled by processingContent
    if (loadingInfo || infoData === null) return "Loading function info…";
    if (!patronAccount)                return "Pick a patron";
    if (insufficientIgnis)             return "Insufficient IGNIS";
    if (!sovereignLoaded)              return "Loading current sovereign…";
    if (newSovereignTrimmed.length === 0) return "Enter new sovereign";
    if (!newSovereignIsStandard)       return "New sovereign must start with Ѻ.";
    if (newSovereignSameAsCurrent)     return "Pick a different sovereign";
    if (authSelection.impossibleViaZbom) return "No key-based auth path — use Execute Code";
    if (!authSelection.chosenKeyset)   return "Pick an auth path";
    if (!authSelection.satisfied)      return "Auth path needs more keys";
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
    if (!canExecute || !patronAccount || !patronGuard || !authSelection.chosenKeyset) return;
    setIsProcessing(true);
    const _tx = txPending("Rotate Sovereign");
    try {
      // Prompt for the codex password if locked; abort on cancel.
      if (!(await ensureCodexUnlocked())) { _tx.fail("Authentication required"); return; }

      const pactCode = buildRotateSovereignPactCode({
        patron:       patronAccount.address,
        account:      account.address,
        newSovereign: newSovereignTrimmed,
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
        // The OR-of-3 is resolved here in the UI; strategy receives the
        // single chosen branch alongside the patron guard. Strategy stays
        // AND-only over its `guards` array — clean separation of concerns.
        guards: [patronGuard, authSelection.chosenKeyset],
        paymentKey: null,
      });

      _tx.submitted(requestKey);
      onClose();
    } catch (e: any) {
      console.error("[RotateSovereign handleExecute]", e);
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
              <Crown className="h-5 w-5" style={{ color: "#a78bfa" }} />
              <h2 className="text-lg font-bold" style={{ color: "#d2d3d4" }}>
                Rotate Sovereign
              </h2>
              <InfoTooltip content="Changes the Standard Ouronet account that holds sovereignty over this Smart Ouronet account. Smart-account auth runs enforce-one over its guard, the sovereign's guard, and the governor — any one branch authorises the rotation." />
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
          // When disabled, surface the specific blocker so the user
          // doesn't have to hunt for what's wrong. When enabled, show
          // the canonical action label.
          content: canExecute
            ? (
              <>
                <Crown className="inline h-4 w-4 mr-1.5 align-text-bottom" />
                Rotate Sovereign
              </>
            )
            : (blockerReason ?? "Rotate Sovereign"),
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
          readId="INFO_RotateSovereign"
          label="DALOS-INFO|URC_RotateSovereign"
          pactCall={`(ouronet-ns.INFO-ZERO.DALOS-INFO|URC_RotateSovereign "${(patronAccount?.address ?? "").slice(0, 20)}…" "${account.address.slice(0, 20)}…")`}
          fetcher={async () => {
            const res = await pactRead(
              `(${KADENA_NAMESPACE}.INFO-ZERO.DALOS-INFO|URC_RotateSovereign "${patronAccount?.address ?? ""}" "${account.address}")`,
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
            Every C_RotateSovereign argument is listed as INPUT N in
            canonical order. Basic mode (zbomZone2 = false) hides the
            two autonomous rows (patron + account) and shows only the
            CURRENT sovereign reference + the free new-sovereign input
            via `collapsedContent`. The CURRENT row is metadata, not a
            function arg — labelled `CURRENT` instead of `INPUT N`. */}
        {(() => {
          const newSovereignFreeRow = (
            <>
              <StringEntryInput
                value={newSovereign}
                onChange={(v) => setNewSovereign(v)}
                variant="free"
                labelIndex={3}
                varName="new-sovereign"
                placeholder={ghostNewSovereign}
                addressBookType="ouronet"
              />
              {newSovereignError && (
                <div
                  style={{
                    marginTop: "6px",
                    fontSize: "10px",
                    color: "#c0392b",
                    padding: "6px 8px",
                    border: "1px solid #8b1a1a40",
                    borderRadius: "6px",
                    backgroundColor: "#8b1a1a10",
                  }}
                >
                  {newSovereignError}
                </div>
              )}
            </>
          );
          const currentSovereignRow = currentSovereign ? (
            <CurrentSovereignRow address={currentSovereign} />
          ) : null;

          return (
            <Zone2Wrapper
              functionName="ouronet-ns.TS01-C1.DALOS|C_RotateSovereign"
              functionMeta={{
                locations:      ["Settings -> Ouronet Account -> Rotate Sovereign"],
                name:           "Rotate Sovereign",
                description:    "Replaces the sovereign public key (the account's canonical identity key) of an Ouronet account. Requires guard authorization.",
                icon:           "shield",
                addedInVersion: "1.0.4",
                addedDate:      "2026-05-15",
              }}
              collapsedContent={
                <>
                  {currentSovereignRow}
                  {newSovereignFreeRow}
                </>
              }
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

              {/* CURRENT — sovereign on chain right now (metadata, not a function arg) */}
              {currentSovereignRow}

              {/* INPUT III — new-sovereign (free, the only field expecting user input) */}
              {newSovereignFreeRow}
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
