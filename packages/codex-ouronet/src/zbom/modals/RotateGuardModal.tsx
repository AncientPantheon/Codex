/**
 * RotateGuardModal — CFM Architecture v2
 *
 * Zones:
 *   0 — Function Info  → FunctionInfoZone (live, re-fetches on patron change)
 *   1 — Patron Spend   → PatronZonePattern2
 *   2 — Function Inputs → inline (Define Keys + Use Existing Keyset + safe:bool)
 *   3 — Signing        → SigningZone (+ additionalGuards for New Guard)
 *   4 — Actions        → Rotate Guard
 */

import { useState, useEffect, useMemo } from "react";
import { ZbomModalFrame } from "../ui/ZbomModalFrame.js";
import { InfoTooltip } from "../ui/InfoTooltip.js";
import { IOuroAccount, IKadenaSeed, IKadenaWallet } from "../../types/entities.js";
import { useGetKeypair } from "../../hooks/index.js";
import { useEnsureCodexUnlocked } from "../hooks/useEnsureCodexUnlocked.js";
import { usePatronSelectionDefaults } from "../patron/usePatronSelectionDefaults.js";
import { toast } from "sonner";
import { txPending } from "../toast/toastManager.js";
import { getIgnisBalance } from "../debouncer/monitoredReads.js";
import { getRotateGuardInfo, rotateGuard } from "@stoachain/ouronet-core/interactions/guardFunctions";
import { mayComeWithDeimal } from "@stoachain/stoa-core/pact";
import { analyzeGuard, buildCodexPubSet, selectCapsSigningKey } from "@stoachain/stoa-core/guard";
import { Shield, Loader2 } from "lucide-react";
import { ZbomLayout } from "../cfm/ZbomLayout.js";
import { FunctionInfoZone } from "../cfm/FunctionInfoZone.js";
import { PatronZonePattern2 } from "../cfm/PatronSpend.js";
import { SigningZone } from "../cfm/SigningZone.js";
import { StringEntryInput, GuardEntryInput, BoolEntryInput, type GuardChangeValue, type GuardInputMode } from "../cfm/inputs.js";
import { Zone2Wrapper } from "../cfm/Zone2Wrapper.js";

function toNum(v: any): number {
  if (v === null || v === undefined) return 0;
  const raw = mayComeWithDeimal(v);
  return typeof raw === "number" ? raw : parseFloat(String(raw)) || 0;
}

// ─── Types ────────────────────────────────────────────────────────────────────

type PatronMode = "prime" | "resident" | "custom";

interface Props {
  open: boolean; onClose: () => void;
  account: IOuroAccount; accounts: IOuroAccount[];
  kadenaSeeds: IKadenaSeed[]; kadenaAccounts: IKadenaWallet[];
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function RotateGuardModal({
  open, onClose, account, accounts, kadenaSeeds, kadenaAccounts,
}: Props) {
  const getKadenaKeyPairsByPublicKey = useGetKeypair();
  const ensureCodexUnlocked = useEnsureCodexUnlocked();

  // ── Patron selection mode (canonical wiring via usePatronSelectionDefaults) ──
  const { initialPatronMode, autoSelectBestPatron } = usePatronSelectionDefaults();

  // ── Patron state ──
  const [patronMode,            setPatronMode]            = useState<PatronMode>(initialPatronMode);
  const [selectedCustomAccount, setSelectedCustomAccount] = useState<IOuroAccount | null>(null);
  const [patronIgnisBalance,    setPatronIgnisBalance]    = useState<number | null>(null);

  // ── Info data ──
  const [infoData,    setInfoData]    = useState<any>(null);
  const [loadingInfo, setLoadingInfo] = useState(false);

  // ── Input state ──
  const [guardValue,    setGuardValue]    = useState<GuardChangeValue>(null);
  const [guardMode,     setGuardMode]     = useState<GuardInputMode>("define");
  const [existingSafe,  setExistingSafe]  = useState(false);

  // ── Execution state ──
  const [isProcessing,       setIsProcessing]       = useState(false);
  const [resolvedManualKeys, setResolvedManualKeys] = useState<Record<string, string>>({});
  const [, setManualKeys]         = useState<Record<string, string>>({});

  // ── Derived accounts ──
  const primeAccount = accounts[0] ?? null;

  const patronAccount = useMemo<IOuroAccount | null>(() => {
    if (patronMode === "prime")    return primeAccount;
    if (patronMode === "resident") return account;
    return selectedCustomAccount ?? primeAccount;
  }, [patronMode, selectedCustomAccount, primeAccount, account]);

  const displayAccountName = (acc: IOuroAccount | undefined | null): string => {
    if (!acc) return "—";
    return accounts.indexOf(acc) === 0 ? "CodexPrime" : acc.name || acc.address?.slice(0, 20) + "…";
  };

  // ── Derived info values ──
  const ignisCost          = toNum(infoData?.ignis?.["ignis-need"]);
  const virtualToggleActive = ignisCost > 0;
  const hasEnoughIgnis     = (patronIgnisBalance ?? 0) >= ignisCost;
  const insufficientIgnis  = !hasEnoughIgnis && infoData !== null;

  // ── Derived from GuardEntryInput ──
  const guardDefineKeys = guardValue?.mode === "define" ? guardValue.keys : [];
  const guardDefinePred = guardValue?.mode === "define" ? guardValue.pred : "keys-all";
  const guardExistingRef  = guardValue?.mode === "existing" ? guardValue.keysetRef : "";

  const guardValid = guardValue !== null;

  const newGuardForSigning = useMemo(() => {
    if (!guardValue) return null;
    if (guardValue.mode === "define") {
      return { label: "New Guard", guard: { keys: guardValue.keys, pred: guardValue.pred } };
    }
    if (existingSafe && guardValue.resolvedKeys.length > 0) {
      return { label: "New Guard", guard: { keys: guardValue.resolvedKeys, pred: guardValue.resolvedPred } };
    }
    return null;
  }, [guardValue, existingSafe]);

  const additionalGuards = useMemo(
    () => newGuardForSigning ? [newGuardForSigning] : [],
    [newGuardForSigning],
  );

  // ── canExecute ──
  const codexPubs = useMemo(
    () => buildCodexPubSet(kadenaSeeds, kadenaAccounts),
    [kadenaSeeds, kadenaAccounts],
  );
  const patronAnalysis   = useMemo(() => analyzeGuard(patronAccount?.guard, codexPubs, resolvedManualKeys), [patronAccount?.guard, codexPubs, resolvedManualKeys]);
  const accountAnalysis  = useMemo(() => analyzeGuard(account?.guard, codexPubs, resolvedManualKeys), [account?.guard, codexPubs, resolvedManualKeys]);
  const newGuardAnalysis = useMemo(() => newGuardForSigning ? analyzeGuard(newGuardForSigning.guard, codexPubs, resolvedManualKeys) : null, [newGuardForSigning, codexPubs, resolvedManualKeys]);

  const pureSigningPubs = useMemo(() => {
    const set = new Set<string>();
    [...patronAnalysis.codexKeys, ...patronAnalysis.resolvedForeignKeys].forEach(k => set.add(k));
    const isSame = patronAccount?.address === account.address;
    if (!isSame) [...accountAnalysis.codexKeys, ...accountAnalysis.resolvedForeignKeys].forEach(k => set.add(k));
    if (newGuardAnalysis) [...newGuardAnalysis.codexKeys, ...newGuardAnalysis.resolvedForeignKeys].forEach(k => set.add(k));
    return set;
  }, [patronAnalysis, accountAnalysis, newGuardAnalysis, patronAccount, account]);

  const capsKey       = useMemo(() => selectCapsSigningKey(null, codexPubs, pureSigningPubs), [codexPubs, pureSigningPubs]);
  const gasStationPub = capsKey.key;

  const canExecute = guardValid
    && patronAnalysis.satisfied
    && accountAnalysis.satisfied
    && (newGuardAnalysis ? newGuardAnalysis.satisfied : true)
    && gasStationPub !== undefined
    && hasEnoughIgnis
    && !loadingInfo
    && infoData !== null;

  // ── Effects ──
  useEffect(() => {
    if (!open || !patronAccount?.address) return;
    setPatronIgnisBalance(null);
    getIgnisBalance(patronAccount.address).then(v => setPatronIgnisBalance(v ? parseFloat(v) : 0));
  }, [open, patronAccount?.address]);

  useEffect(() => {
    if (!open || !patronAccount?.address || !account?.address) return;
    setLoadingInfo(true);
    setInfoData(null);
    getRotateGuardInfo(patronAccount.address, account.address)
      .then(setInfoData)
      .finally(() => setLoadingInfo(false));
  }, [open, patronAccount?.address, account?.address]);

  useEffect(() => {
    if (open) {
      setPatronMode(initialPatronMode); setSelectedCustomAccount(null);
      setGuardValue(null); setGuardMode("define"); setExistingSafe(false);
      setManualKeys({}); setResolvedManualKeys({}); setIsProcessing(false);
    }
    // initialPatronMode intentionally captured per-open — a Redux setting change
    // while the modal is closed should take effect on next open, not mid-open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);


  // ── Execute ──
  const handleExecute = async () => {
    if (!canExecute || !gasStationPub) return;
    setIsProcessing(true);
    const _tx = txPending("Rotate Guard");
    try {
      // Prompt for the codex password if locked; abort on cancel.
      if (!(await ensureCodexUnlocked())) { _tx.fail("Authentication required"); return; }

      const collectKeys = async (analysis: ReturnType<typeof analyzeGuard>) => {
        const keys: { publicKey: string; privateKey: string }[] = [];
        const candidates = [...analysis.codexKeys, ...analysis.resolvedForeignKeys];
        for (const pub of candidates) {
          if (keys.length >= analysis.threshold) break;
          if (resolvedManualKeys[pub]) keys.push({ publicKey: pub, privateKey: resolvedManualKeys[pub] });
          else { const kp = await getKadenaKeyPairsByPublicKey(pub); if (kp) keys.push(kp); }
        }
        return keys;
      };

      const patronSignKeys   = await collectKeys(patronAnalysis);
      const accountSignKeys  = await collectKeys(accountAnalysis);
      const newGuardSignKeys = newGuardAnalysis ? await collectKeys(newGuardAnalysis) : [];
      const gasStationKey    = await getKadenaKeyPairsByPublicKey(gasStationPub);
      if (!gasStationKey) { toast.error("Cannot resolve Gas Station key"); setIsProcessing(false); return; }

      const mode = guardValue?.mode ?? "define";
      const result = await rotateGuard({
        patronAddress:   patronAccount!.address,
        accountAddress:  account.address,
        mode,
        newKeys:         mode === "define" ? guardDefineKeys : undefined,
        newPred:         mode === "define" ? guardDefinePred : undefined,
        keysetRef:       mode === "existing" ? guardExistingRef : undefined,
        safe:            mode === "define" ? true : existingSafe,
        gasStationKey,
        patronGuardKeys:  patronSignKeys,
        accountGuardKeys: accountSignKeys,
        newGuardKeys:     newGuardSignKeys,
      });

      _tx.submitted(result?.requestKey ?? "");
      onClose();
    } catch (error: any) {
      _tx.fail(error?.message ?? "Failed");
    } finally { setIsProcessing(false); }
  };

  if (!open) return null;

  const ICON = <Shield className="h-5 w-5" style={{ color: "#ceac5f" }} />;

  return (
    <ZbomModalFrame onClose={onClose} width={600}>
      <ZbomLayout
        header={<>
          <div className="flex items-center gap-2">
            {ICON}
            <h2 className="text-lg font-bold" style={{ color: "#d2d3d4" }}>Rotate Guard</h2>
            <InfoTooltip content="Rotates the Guard (ownership keyset) of an Ouronet account on Stoa Chain." />
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs" style={{ color: "#888" }}>Account:</span>
            <span className="text-xs font-mono font-bold" style={{ color: "#ceac5f" }}>
              {displayAccountName(account)}
            </span>
          </div>
        </>}
        executeButton={{
          canExecute,
          isProcessing,
          onClick: handleExecute,
          bgColor: insufficientIgnis ? "#c0392b" : canExecute ? "#ceac5f" : "#262626",
          textColor: insufficientIgnis ? "#fff" : canExecute ? "#0a0a0a" : "#555",
          content: insufficientIgnis
            ? "Insufficient IGNIS"
            : <><Shield className="inline h-4 w-4 mr-1.5 align-text-bottom" />Rotate Guard</>,
          processingContent: <><Loader2 className="inline h-4 w-4 mr-2 animate-spin" />Processing…</>,
        }}
      >

        {/* ── Zone 0 — Function Info ── */}
        <FunctionInfoZone
          key={patronAccount?.address}
          readId="INFO_RotateGuard"
          label="DALOS-INFO|URC_RotateGuard"
          pactCall={`(ouronet-ns.INFO-ZERO.DALOS-INFO|URC_RotateGuard "${(patronAccount?.address ?? "").slice(0, 20)}…" "${account.address.slice(0, 20)}…")`}
          fetcher={() => getRotateGuardInfo(patronAccount?.address ?? "", account.address)}
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

        {/* ── Zone 2 — Function Inputs ── */}
        <Zone2Wrapper
          functionName="ouronet-ns.TS01-C1.DALOS|C_RotateGuard"
          functionMeta={{
            locations:      ["Settings -> Ouronet Account -> Rotate Guard"],
            name:           "Rotate Guard",
            description:    "Replaces the guard keyset of an Ouronet account. Supports Define Keys or Use Existing Keyset (on-chain).",
            icon:           "shield",
            addedInVersion: "0.3.18",
            addedDate:      "2026-03-05",
          }}
          collapsedContent={
            <>
              <GuardEntryInput
                labelIndex={3}
                varName="guard"
                onChange={setGuardValue}
                onModeChange={setGuardMode}
              />
              <BoolEntryInput
                labelIndex={4}
                varName="safe"
                value={guardMode === "define" ? true : existingSafe}
                onChange={guardMode === "existing" ? setExistingSafe : undefined}
                variant={guardMode === "define" ? "autonomous" : "free"}
              />
            </>
          }
        >
          <StringEntryInput
            labelIndex={1}
            varName="patron"
            value={patronAccount?.address ?? ""}
            variant="autonomous"
          />
          <StringEntryInput
            labelIndex={2}
            varName="account"
            value={account.address}
            variant="autonomous"
          />
          <GuardEntryInput
            labelIndex={3}
            varName="guard"
            onChange={setGuardValue}
            onModeChange={setGuardMode}
          />
          <BoolEntryInput
            labelIndex={4}
            varName="safe"
            value={guardMode === "define" ? true : existingSafe}
            onChange={guardMode === "existing" ? setExistingSafe : undefined}
            variant={guardMode === "define" ? "autonomous" : "free"}
          />
        </Zone2Wrapper>

        {/* ── Zone 3 — Signing ── */}
        <SigningZone
          patronAccount={patronAccount}
          accountAccount={account}
          additionalGuards={additionalGuards}
        />

      </ZbomLayout>
    </ZbomModalFrame>
  );
}
