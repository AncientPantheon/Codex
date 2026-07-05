/**
 * RotatePaymentKeyModal — CFM Architecture v2
 *
 * Zones:
 *   0 — Function Info  → FunctionInfoZone
 *   1 — Patron Spend   → PatronZonePattern2
 *   2 — Function Inputs → StringEntryInput (2.10 free) for <new-payment-key:string>
 *   3 — Signing        → SigningZone
 *   4 — Actions        → Rotate Payment Key
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import { ZbomModalFrame } from "../ui/ZbomModalFrame.js";
import { InfoTooltip } from "../ui/InfoTooltip.js";
import { IOuroAccount, IKadenaSeed, IKadenaWallet } from "../../types/entities.js";
import { useGetKeypair } from "../../hooks/index.js";
import { useEnsureCodexUnlocked } from "../hooks/useEnsureCodexUnlocked.js";
import { usePatronSelectionDefaults } from "../patron/usePatronSelectionDefaults.js";
import { toast } from "sonner";
import { txPending } from "../toast/toastManager.js";
import { getIgnisBalance } from "../debouncer/monitoredReads.js";
import { getRotateKadenaInfo, rotateKadenaPaymentKey } from "@stoachain/ouronet-core/interactions/ouroRotateFunctions";
import { mayComeWithDeimal } from "@stoachain/stoa-core/pact";
import { analyzeGuard, buildCodexPubSet, selectCapsSigningKey } from "@stoachain/stoa-core/guard";
import { publicKeyFromPrivateKey, publicKeyFromExtendedKey } from "@stoachain/stoa-core/signing";
import { RotateCw, Loader2 } from "lucide-react";
import { ZbomLayout } from "../cfm/ZbomLayout.js";
import { FunctionInfoZone } from "../cfm/FunctionInfoZone.js";
import { PatronZonePattern2 } from "../cfm/PatronSpend.js";
import { SigningZone } from "../cfm/SigningZone.js";
import { StringEntryInput } from "../cfm/inputs.js";
import { Zone2Wrapper } from "../cfm/Zone2Wrapper.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function derivePubKey(privHex: string): string | null {
  try {
    if (privHex.length === 128) return publicKeyFromExtendedKey(privHex.slice(0, 64));
    if (privHex.length === 64)  return publicKeyFromPrivateKey(privHex);
    return null;
  } catch { return null; }
}

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

export default function RotatePaymentKeyModal({
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

  // ── Info state ──
  const [infoData,    setInfoData]    = useState<any>(null);
  const [loadingInfo, setLoadingInfo] = useState(false);

  // ── Input state ──
  const [newPaymentKey, setNewPaymentKey] = useState("");

  // ── Execution state ──
  const [isProcessing,       setIsProcessing]       = useState(false);
  const [resolvedManualKeys, setResolvedManualKeys] = useState<Record<string, string>>({});
  const [, setManualKeys] = useState<Record<string, string>>({});

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

  // ── Signing readiness (for canExecute) ──
  const codexPubs = useMemo(
    () => buildCodexPubSet(kadenaSeeds, kadenaAccounts),
    [kadenaSeeds, kadenaAccounts],
  );
  const patronAnalysis  = useMemo(() => analyzeGuard(patronAccount?.guard, codexPubs, resolvedManualKeys), [patronAccount?.guard, codexPubs, resolvedManualKeys]);
  const accountAnalysis = useMemo(() => analyzeGuard(account?.guard, codexPubs, resolvedManualKeys), [account?.guard, codexPubs, resolvedManualKeys]);

  const pureSigningPubs = useMemo(() => {
    const set = new Set<string>();
    [...patronAnalysis.codexKeys, ...patronAnalysis.resolvedForeignKeys].forEach(k => set.add(k));
    const isSame = patronAccount?.address === account.address;
    if (!isSame) [...accountAnalysis.codexKeys, ...accountAnalysis.resolvedForeignKeys].forEach(k => set.add(k));
    return set;
  }, [patronAnalysis, accountAnalysis, patronAccount, account]);

  const capsKey       = useMemo(() => selectCapsSigningKey(null, codexPubs, pureSigningPubs), [codexPubs, pureSigningPubs]);
  const gasStationPub = capsKey.key;

  const canExecute = newPaymentKey.trim().length > 0
    && patronAnalysis.satisfied
    && accountAnalysis.satisfied
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
    getRotateKadenaInfo(patronAccount.address, account.address)
      .then(setInfoData)
      .finally(() => setLoadingInfo(false));
  }, [open, patronAccount?.address, account?.address]);

  useEffect(() => {
    if (open) {
      setPatronMode(initialPatronMode); setSelectedCustomAccount(null);
      setNewPaymentKey("");
      setManualKeys({}); setResolvedManualKeys({}); setIsProcessing(false);
    }
    // initialPatronMode intentionally captured per-open — a Redux setting change
    // while the modal is closed should take effect on next open, not mid-open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ── Manual key resolution ──
  const handleManualKeyInput = useCallback((missingPub: string, privKeyHex: string) => {
    setManualKeys(prev => ({ ...prev, [missingPub]: privKeyHex }));
    if (privKeyHex.length === 64 || privKeyHex.length === 128) {
      const derived = derivePubKey(privKeyHex);
      if (derived === missingPub) {
        setResolvedManualKeys(prev => ({ ...prev, [missingPub]: privKeyHex }));
        toast.success("Key matched! ✓");
      } else {
        setResolvedManualKeys(prev => { const n = { ...prev }; delete n[missingPub]; return n; });
      }
    }
  }, []);
  void handleManualKeyInput;

  // ── Execute ──
  const handleExecute = async () => {
    if (!canExecute || !gasStationPub) return;
    setIsProcessing(true);
    const _tx = txPending("Rotate Payment Key");
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

      const patronSignKeys  = await collectKeys(patronAnalysis);
      const accountSignKeys = await collectKeys(accountAnalysis);
      const gasStationKey   = await getKadenaKeyPairsByPublicKey(gasStationPub);
      if (!gasStationKey) { toast.error("Cannot resolve Gas Station key"); setIsProcessing(false); return; }

      const result = await rotateKadenaPaymentKey(
        patronAccount!.address,
        account.address,
        newPaymentKey.trim(),
        gasStationKey,
        patronSignKeys,
        accountSignKeys,
        patronAccount!.guard,
        account.guard,
      );

      _tx.submitted(result?.requestKey ?? "");
      onClose();
    } catch (error: any) {
      _tx.fail(error?.message ?? "Failed");
    } finally { setIsProcessing(false); }
  };

  if (!open) return null;

  const ICON = <RotateCw className="h-5 w-5" style={{ color: "#ceac5f" }} />;

  return (
    <ZbomModalFrame onClose={onClose} width={600}>
      <ZbomLayout
        header={<>
          <div className="flex items-center gap-1.5">
            <div className="flex items-center gap-2">
              {ICON}
              <h2 className="text-lg font-bold" style={{ color: "#d2d3d4" }}>Rotate Payment Key</h2>
              <InfoTooltip content="Rotates the Kadena payment key linked to an Ouronet account." />
            </div>
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
            : <><RotateCw className="inline h-4 w-4 mr-1.5 align-text-bottom" />Rotate Payment Key</>,
          processingContent: <><Loader2 className="inline h-4 w-4 mr-2 animate-spin" />Processing…</>,
        }}
      >

        {/* ── Zone 0 — Function Info ── */}
        <FunctionInfoZone
          key={patronAccount?.address}
          readId="INFO_RotateKadena"
          label="DALOS-INFO|URC_RotateKadena"
          pactCall={`(ouronet-ns.INFO-ZERO.DALOS-INFO|URC_RotateKadena "${(patronAccount?.address ?? "").slice(0, 20)}…" "${account.address.slice(0, 20)}…")`}
          fetcher={() => getRotateKadenaInfo(patronAccount?.address ?? "", account.address)}
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
          functionName="ouronet-ns.TS01-C1.DALOS|C_RotateKadena"
          functionMeta={{
            locations:      ["Settings -> Ouronet Account -> Rotate Payment Key"],
            name:           "Rotate Payment Key",
            description:    "Changes the Stoa Chain k: account linked as the payment key of an Ouronet account.",
            icon:           "key",
            addedInVersion: "0.3.17",
            addedDate:      "2026-03-05",
          }}
          collapsedContent={
            <StringEntryInput
              value={newPaymentKey}
              onChange={setNewPaymentKey}
              labelIndex={3}
              varName="new-payment-key"
              placeholder="(k:, c:, u:, w:, or custom account)"
              addressBookType="stoa"
            />
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
          <StringEntryInput
            value={newPaymentKey}
            onChange={setNewPaymentKey}
            labelIndex={3}
            varName="new-payment-key"
            placeholder="(k:, c:, u:, w:, or custom account)"
            addressBookType="stoa"
          />
        </Zone2Wrapper>

        {/* ── Zone 3 — Signing ── */}
        <SigningZone
          patronAccount={patronAccount}
          accountAccount={account}
        />

      </ZbomLayout>
    </ZbomModalFrame>
  );
}
