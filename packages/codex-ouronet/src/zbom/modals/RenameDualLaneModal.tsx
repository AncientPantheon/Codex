/**
 * RenameDualLaneModal — "Rename Dual API Key consumer lane".
 *
 * Renames the consumer-lane of an ACTIVE dual link via the LIVE
 * `ouronet-ns.TS01-C4.PYTHIA|C_UpdateDualConsumerLane` — authorized by BOTH
 * half-owners (`P|TS`), paid by a PATRON in native STOA (100, UNDISCOUNTED) with
 * the SAME 4-way split as account activation. The cost + the 4 split receivers +
 * amounts all come from `INFO_UpdateDualConsumerLane` (on-chain authority), so
 * they never drift when the on-chain price/targets change.
 *
 * The STOA sibling of RevokeDualLinkModal — the deploy modal's patron/payment/
 * split machinery, plus BOTH half-owner ownership guards and a new-name input.
 * HARD RULE: no seed leaves the Codex.
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import { Pact } from "@stoachain/kadena-stoic-legacy/client";
import { Pencil, Loader2, AlertTriangle } from "lucide-react";
import { ZbomModalFrame } from "../ui/ZbomModalFrame.js";
import { InfoTooltip } from "../ui/InfoTooltip.js";
import { ManualKeyInput } from "../ui/ManualKeyInput.js";
import { PaymentKeyInput } from "../ui/ManualKeyInput.js";
import { txPending } from "../toast/toastManager.js";
import { getIgnisBalance, getStoaChainAccountGuard } from "../debouncer/monitoredReads.js";
import { getWrapperPaymentKey, getPaymentKeyBalance } from "@ouronet/ouronet-core/interactions/wrapFunctions";
import { KADENA_CHAIN_ID as STOACHAIN_CHAIN_ID, KADENA_NETWORK as STOACHAIN_NETWORK } from "@stoachain/stoa-core/constants";
import { KADENA_NAMESPACE as STOACHAIN_NAMESPACE, STOA_AUTONOMIC_OURONETGASSTATION } from "@ouronet/ouronet-core/constants";
import { safeCreationTime, mayComeWithDeimal } from "@stoachain/stoa-core/pact";
import { classifyPaymentKey, buildCodexPubSet, analyzeGuard } from "@stoachain/stoa-core/guard";
import type { IKeyset } from "@stoachain/stoa-core/guard";
import type { IKadenaKeypair as IStoaChainKeypair } from "@stoachain/stoa-core/signing";
import type { IOuroAccount } from "../../types/entities.js";
import { ZbomLayout } from "../cfm/ZbomLayout.js";
import { FunctionInfoZone } from "../cfm/FunctionInfoZone.js";
import { PatronZonePattern2 } from "../cfm/PatronSpend.js";
import { Zone2Wrapper } from "../cfm/Zone2Wrapper.js";
import { SigningZone } from "../cfm/SigningZone.js";
import { StringEntryInput } from "../cfm/inputs.js";
import { useWallet } from "../cfm/seam.js";
import { useGetKeypair, useActiveWallet, useSignTransaction } from "../../hooks/index.js";
import { useEnsureCodexUnlocked } from "../hooks/useEnsureCodexUnlocked.js";
import { usePatronSelectionDefaults } from "../patron/usePatronSelectionDefaults.js";
import { detectOriginCurve } from "../../ui/internal/originCurve.js";
import { getRenameDualLaneInfo, getRenameDualLaneInfoOnly, buildRenameDualLanePactCode } from "../pythia/dualLinkOps.js";

const MONO = "var(--codex-font-mono, 'JetBrains Mono', ui-monospace, monospace)";
type Guard = { keys: string[]; pred: string } | null;
type PatronMode = "prime" | "resident" | "custom";

const toNum = (v: any): number => {
  if (v == null) return 0;
  const raw = mayComeWithDeimal(v);
  return typeof raw === "number" ? raw : parseFloat(String(raw)) || 0;
};

interface Props {
  open: boolean;
  onClose: () => void;
  dualLinkKey: string;
  /** Current consumer lane (for placeholder / display). */
  currentLane?: string;
  /** DALOS owner of the Standard half. */
  standardOwner: string;
  /** DALOS owner of the Smart half — MAY differ from the Standard owner. */
  smartOwner: string;
  accounts: IOuroAccount[];
}

export default function RenameDualLaneModal({
  open, onClose, dualLinkKey, currentLane, standardOwner, smartOwner, accounts,
}: Props) {
  const getStoaChainKeyPairsByPublicKey = useGetKeypair();
  const { execute } = useSignTransaction();
  const ensureCodexUnlocked = useEnsureCodexUnlocked();
  const { kadena: kadenaSeeds, stoaChainAccounts } = useWallet();
  const { activeOuroAccount } = useActiveWallet();
  const { initialPatronMode, autoSelectBestPatron } = usePatronSelectionDefaults();

  const sameOwner = !!standardOwner && standardOwner === smartOwner;

  const [newName, setNewName] = useState("");
  const [patronMode, setPatronMode] = useState<PatronMode>(initialPatronMode);
  const [selectedCustomAccount, setSelectedCustomAccount] = useState<IOuroAccount | null>(null);
  const [patronIgnisBalance, setPatronIgnisBalance] = useState<number | null>(null);
  const [paymentKeyAddr, setPaymentKeyAddr] = useState<string | null>(null);
  const [paymentKeyBal, setPaymentKeyBal] = useState<number | null>(null);
  const [loadingPK, setLoadingPK] = useState(false);
  const [fullInfo, setFullInfo] = useState<{ info: any; receivers: string[] } | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [resolvedManualKeys, setResolvedManualKeys] = useState<Record<string, string>>({});
  const [isProcessing, setIsProcessing] = useState(false);
  const [stdGuard, setStdGuard] = useState<Guard>(null);
  const [smtGuard, setSmtGuard] = useState<Guard>(null);
  const [patronPaymentGuard, setPatronPaymentGuard] = useState<Guard>(null);
  const [stdGuardLoaded, setStdGuardLoaded] = useState(false);
  const [smtGuardLoaded, setSmtGuardLoaded] = useState(false);
  const [patronGuardLoaded, setPatronGuardLoaded] = useState(false);

  const residentAccount = useMemo<IOuroAccount | null>(
    () => (activeOuroAccount && detectOriginCurve(activeOuroAccount) !== "apollo" ? activeOuroAccount : null),
    [activeOuroAccount],
  );
  const primeAccount = accounts[0] ?? null;
  const patronAccount = useMemo<IOuroAccount | null>(() => {
    if (patronMode === "prime") return primeAccount;
    if (patronMode === "resident") return residentAccount;
    return selectedCustomAccount ?? primeAccount;
  }, [patronMode, selectedCustomAccount, primeAccount, residentAccount]);

  const effectiveSmtGuard: Guard = sameOwner ? stdGuard : smtGuard;

  const renameArgs = useMemo(
    () => ({ patron: patronAccount?.address ?? "", dualLinkKey, newName }),
    [patronAccount?.address, dualLinkKey, newName],
  );

  const handleResolveKey = useCallback((pub: string, priv: string) => {
    setResolvedManualKeys((prev) => ({ ...prev, [pub]: priv }));
  }, []);

  // ── Reset on open ──
  useEffect(() => {
    if (!open) return;
    setNewName("");
    setPatronMode(initialPatronMode);
    setSelectedCustomAccount(null);
    setPatronIgnisBalance(null);
    setPaymentKeyAddr(null); setPaymentKeyBal(null);
    setFullInfo(null); setLoadingInfo(false);
    setResolvedManualKeys({}); setIsProcessing(false);
    setStdGuard(null); setSmtGuard(null); setPatronPaymentGuard(null);
    setStdGuardLoaded(false); setSmtGuardLoaded(false); setPatronGuardLoaded(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ── Patron payment key + balance ──
  useEffect(() => {
    if (!open || !patronAccount?.address) return;
    setLoadingPK(true); setPaymentKeyAddr(null); setPaymentKeyBal(null);
    getWrapperPaymentKey(patronAccount.address)
      .then((pk) => {
        setPaymentKeyAddr(pk);
        if (pk && pk.startsWith("k:")) getPaymentKeyBalance(pk).then(setPaymentKeyBal).catch(() => setPaymentKeyBal(0));
      })
      .catch(() => setPaymentKeyAddr(null))
      .finally(() => setLoadingPK(false));
  }, [open, patronAccount?.address]);

  // ── Patron IGNIS balance ──
  useEffect(() => {
    if (!open || !patronAccount?.address) return;
    setPatronIgnisBalance(null);
    getIgnisBalance(patronAccount.address)
      .then((v) => setPatronIgnisBalance(v ? parseFloat(v) : 0))
      .catch(() => setPatronIgnisBalance(0));
  }, [open, patronAccount?.address]);

  // ── INFO fetch (debounced) — cost + split receivers ──
  useEffect(() => {
    if (!open || !renameArgs.patron || !newName.trim()) { setFullInfo(null); return; }
    setLoadingInfo(true); setFullInfo(null);
    let aborted = false;
    const t = setTimeout(() => {
      getRenameDualLaneInfo(renameArgs)
        .then((r) => { if (!aborted) setFullInfo(r); })
        .catch(() => { if (!aborted) setFullInfo(null); })
        .finally(() => { if (!aborted) setLoadingInfo(false); });
    }, 450);
    return () => { aborted = true; clearTimeout(t); };
  }, [open, renameArgs, newName]);

  // ── Resolve guards (both owners + patron payment account) from chain ──
  const resolveGuard = (addr: string, set: (g: Guard) => void, setLoaded: (b: boolean) => void) => {
    let aborted = false;
    set(null); setLoaded(false);
    getStoaChainAccountGuard(addr)
      .then((g) => { if (!aborted) set(((g as unknown) as Guard) ?? null); })
      .catch(() => { if (!aborted) set(null); })
      .finally(() => { if (!aborted) setLoaded(true); });
    return () => { aborted = true; };
  };
  useEffect(() => {
    if (!open) { setStdGuard(null); setStdGuardLoaded(false); return; }
    if (!standardOwner) { setStdGuard(null); setStdGuardLoaded(true); return; } // owner unknown → loaded-as-empty
    return resolveGuard(standardOwner, setStdGuard, setStdGuardLoaded);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, standardOwner]);
  useEffect(() => {
    if (!open) { setSmtGuard(null); setSmtGuardLoaded(false); return; }
    // Owner unknown (Smart half is not in THIS Codex) → mark loaded so the modal
    // shows a clear "not in this Codex" blocker instead of spinning forever.
    if (!smartOwner || sameOwner) { setSmtGuard(null); setSmtGuardLoaded(true); return; }
    return resolveGuard(smartOwner, setSmtGuard, setSmtGuardLoaded);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, smartOwner, sameOwner]);
  useEffect(() => {
    if (!open || !patronAccount?.address) { setPatronPaymentGuard(null); setPatronGuardLoaded(false); return; }
    return resolveGuard(patronAccount.address, setPatronPaymentGuard, setPatronGuardLoaded);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, patronAccount?.address]);

  // ── Derived cost / split (ALL from INFO) ──
  const info = fullInfo?.info ?? null;
  const receivers: string[] = fullInfo?.receivers ?? [];
  const amounts: any[] = info?.kadena?.["kadena-split"] ?? [];
  const stoaCost = toNum(info?.kadena?.["kadena-full"]);
  const ignisCost = toNum(info?.ignis?.["ignis-need"]);
  const virtualToggleActive = ignisCost > 0;
  const insufficientIgnis = ignisCost > 0 && (patronIgnisBalance ?? 0) < ignisCost;

  // ── Payment key readiness (mirror of the deploy modal) ──
  const codexPubs = useMemo(() => buildCodexPubSet(kadenaSeeds, stoaChainAccounts), [kadenaSeeds, stoaChainAccounts]);
  const paymentKeyInfo = useMemo(() => classifyPaymentKey(paymentKeyAddr), [paymentKeyAddr]);
  const paymentPubKey = paymentKeyInfo?.pubkey ?? "";
  const paymentKeyIsK = paymentKeyInfo?.type === "k-account";
  const paymentSignerPub = useMemo(() => {
    if (paymentPubKey && (codexPubs.has(paymentPubKey) || !!resolvedManualKeys[paymentPubKey])) return paymentPubKey;
    const gkeys = patronPaymentGuard?.keys ?? [];
    return gkeys.find((k) => codexPubs.has(k) || !!resolvedManualKeys[k]) ?? "";
  }, [paymentPubKey, codexPubs, resolvedManualKeys, patronPaymentGuard]);
  const paymentKeyInCodex = paymentKeyIsK && !!paymentSignerPub;
  const balNum = paymentKeyBal === null ? null : Number(mayComeWithDeimal(paymentKeyBal));
  const costNum = Number(mayComeWithDeimal(stoaCost));
  const insufficientStoa = balNum !== null && Number.isFinite(balNum) && Number.isFinite(costNum) && costNum > 0 && balNum < costNum;

  const stdAnalysis = useMemo(() => analyzeGuard(stdGuard, codexPubs, resolvedManualKeys), [stdGuard, codexPubs, resolvedManualKeys]);
  const smtAnalysis = useMemo(() => (sameOwner ? stdAnalysis : analyzeGuard(effectiveSmtGuard, codexPubs, resolvedManualKeys)), [sameOwner, stdAnalysis, effectiveSmtGuard, codexPubs, resolvedManualKeys]);

  const ownerName = (addr: string) => {
    const a = accounts.find((x) => x.address === addr);
    if (!a) return addr ? addr.slice(0, 16) + "…" : "—";
    return accounts.indexOf(a) === 0 ? "CodexPrime" : (a.name || addr.slice(0, 16) + "…");
  };

  // Ownership guards for the signer — both half-owners, deduped.
  const ownerGuards = useMemo<IKeyset[]>(() => {
    const out: IKeyset[] = [];
    if (stdGuard?.keys?.length) out.push(stdGuard as IKeyset);
    if (!sameOwner && effectiveSmtGuard?.keys?.length) out.push(effectiveSmtGuard as IKeyset);
    return out;
  }, [stdGuard, effectiveSmtGuard, sameOwner]);

  const guardsLoaded = stdGuardLoaded && smtGuardLoaded && patronGuardLoaded;
  const blockerReason = (() => {
    if (isProcessing) return null;
    if (!newName.trim()) return "Enter a new lane name";
    if (!patronAccount) return "Pick a patron";
    if (loadingInfo || info === null) return "Loading function info…";
    if (loadingPK) return "Loading payment key…";
    if (!paymentKeyIsK) return "Payment key not a k: account";
    if (!patronGuardLoaded) return "Resolving payment guard…";
    if (!paymentKeyInCodex) return "Payment key not signable by Codex";
    if (insufficientStoa) return "Insufficient STOA";
    if (insufficientIgnis) return "Insufficient IGNIS";
    if (receivers.length === 0 || amounts.length === 0) return "No split returned by INFO";
    if (!standardOwner) return "Standard half not in this Codex — both owners must sign";
    if (!sameOwner && !smartOwner) return "Smart half not in this Codex — both owners must sign";
    if (!guardsLoaded) return "Resolving owner guards…";
    if (!stdGuard?.keys?.length) return "Standard owner guard unavailable";
    if (!sameOwner && !effectiveSmtGuard?.keys?.length) return "Smart owner guard unavailable";
    if (!stdAnalysis.satisfied) return `Provide Standard owner key${stdAnalysis.neededMore > 1 ? "s" : ""}`;
    if (!sameOwner && !smtAnalysis.satisfied) return `Provide Smart owner key${smtAnalysis.neededMore > 1 ? "s" : ""}`;
    return null;
  })();
  const canExecute = blockerReason === null && !isProcessing;

  async function handleExecute() {
    if (!canExecute || !patronAccount || !paymentKeyAddr || !paymentSignerPub) return;
    setIsProcessing(true);
    const _tx = txPending("Rename Dual API Lane");
    try {
      if (!(await ensureCodexUnlocked())) { _tx.fail("Authentication required"); return; }
      // Resolve the payment signer keypair (Codex or manually-provided).
      let raw: any = null;
      try {
        raw = await getStoaChainKeyPairsByPublicKey(paymentSignerPub);
      } catch (err) {
        const priv = resolvedManualKeys[paymentSignerPub];
        if (priv) raw = { publicKey: paymentSignerPub, privateKey: priv };
        else {
          const locked = (err as any)?.name === "CodexLockedError";
          throw new Error(locked ? "Codex is locked — unlock and retry." : "Payment key not signable by this Codex — pick a patron whose payment keyset you hold.");
        }
      }
      if (!raw) throw new Error("Payment key not found in Codex");
      const paymentKP: IStoaChainKeypair = {
        publicKey: raw.publicKey, privateKey: raw.privateKey,
        seedType: (raw as any).seedType, encryptedSecretKey: (raw as any).encryptedSecretKey, password: (raw as any).password,
      };

      const pactCode = buildRenameDualLanePactCode({ patron: patronAccount.address, dualLinkKey, newName: newName.trim() });
      // Signers: patron payment guard + BOTH owner guards. Payment signer carries
      // the coin.TRANSFER split caps.
      const guards = [patronPaymentGuard, ...ownerGuards].filter(Boolean) as IKeyset[];

      const { requestKey } = await execute({
        build: ({ gasLimit, capsKeyPub, guardPubs }: { gasLimit: number; capsKeyPub: string; guardPubs: string[] }) => {
          let builder = Pact.builder
            .execution(pactCode)
            .setMeta({ senderAccount: STOA_AUTONOMIC_OURONETGASSTATION, creationTime: safeCreationTime(), chainId: STOACHAIN_CHAIN_ID, gasLimit })
            .setNetworkId(STOACHAIN_NETWORK)
            .addSigner(capsKeyPub, (w: any) => [
              w(`${STOACHAIN_NAMESPACE}.DALOS.GAS_PAYER`, "", { int: 0 }, { decimal: "0.0" }),
            ])
            .addSigner(paymentKP.publicKey, (w: any) =>
              receivers.map((receiver, i) =>
                w("coin.TRANSFER", paymentKeyAddr, receiver, { decimal: String(mayComeWithDeimal(amounts[i])) }),
              ),
            );
          const alreadySigned = new Set<string>([capsKeyPub, paymentKP.publicKey]);
          for (const gp of guardPubs) {
            if (alreadySigned.has(gp)) continue;
            alreadySigned.add(gp);
            builder = (builder as any).addSigner(gp);
          }
          return (builder as any).createTransaction();
        },
        guards,
        paymentKey: paymentKP.publicKey,
        resolvedForeignKeys: resolvedManualKeys,
        extraSigners: [paymentKP],
      } as any);

      _tx.submitted(requestKey);
      onClose();
    } catch (e: any) {
      console.error("[RenameDualLane handleExecute]", e);
      _tx.fail(e?.message ?? "Failed");
    } finally {
      setIsProcessing(false);
    }
  }

  if (!open) return null;

  const label = (t: string) => <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "#555" }}>{t}</span>;

  const inputsBlock = (
    <div className="space-y-2">
      <div className="rounded-lg border p-2.5" style={{ borderColor: "#262626", backgroundColor: "#0a0a0a" }}>
        {label("Dual API key")}
        <code style={{ display: "block", marginTop: 4, fontFamily: MONO, fontSize: 10, wordBreak: "break-all", color: "#8a8a8a" }}>{dualLinkKey}</code>
        <div style={{ marginTop: 4 }}>{label(sameOwner ? `owner (both halves) · ${ownerName(standardOwner)}` : `standard owner · ${ownerName(standardOwner)} · smart owner · ${ownerName(smartOwner)}`)}</div>
      </div>
      <div>
        {label(`New consumer lane${currentLane ? ` (current: ${currentLane})` : ""}`)}
        <div style={{ marginTop: 4 }}>
          <StringEntryInput variant="free" labelIndex={3} varName="new-name" value={newName} onChange={setNewName} placeholder="e.g. Mnemosyne-v2" />
        </div>
      </div>
      <div className="flex items-center justify-between rounded-lg border p-2.5" style={{ borderColor: "#ceac5f30", backgroundColor: "#0a0a0a" }}>
        <span className="text-xs" style={{ color: "#888" }}>Cost (native STOA, undiscounted, from INFO):</span>
        <span className="text-sm font-bold font-mono" style={{ color: insufficientStoa ? "#c0392b" : "#ceac5f" }}>{loadingInfo || info === null ? "…" : `${stoaCost} STOA`}</span>
      </div>
      <div className="rounded-lg border p-2.5" style={{ borderColor: "#262626", backgroundColor: "#0a0a0a" }}>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] uppercase tracking-wider" style={{ color: "#888" }}>Patron payment key</span>
          <span className="text-[10px] font-mono" style={{ color: insufficientStoa ? "#c0392b" : "#888" }}>{loadingPK ? "…" : paymentKeyBal !== null ? `${paymentKeyBal} STOA` : ""}</span>
        </div>
        <code className="block text-[11px] font-mono break-all" style={{ color: paymentKeyIsK ? "#ceac5f" : "#c0392b" }}>{paymentKeyAddr || (loadingPK ? "…" : "—")}</code>
        {paymentKeyAddr && !paymentKeyIsK && (
          <p className="mt-1 flex items-start gap-1 text-[10px]" style={{ color: "#c0392b" }}>
            <AlertTriangle className="h-3 w-3 mt-0.5 flex-shrink-0" /> Non-k: payment key — use the Ouronet console.
          </p>
        )}
        {paymentKeyIsK && !paymentKeyInCodex && paymentPubKey && (
          <div className="mt-2"><PaymentKeyInput pubkey={paymentPubKey} resolved={resolvedManualKeys} onResolve={handleResolveKey} /></div>
        )}
      </div>
      {guardsLoaded && stdGuard && stdAnalysis.foreignKeys.length > 0 && !stdAnalysis.satisfied && (
        <ManualKeyInput label={`${sameOwner ? "Owner" : "Standard owner"} — ${ownerName(standardOwner)}`} foreignKeys={stdAnalysis.foreignKeys} resolved={resolvedManualKeys} neededMore={stdAnalysis.neededMore} onResolve={handleResolveKey} />
      )}
      {guardsLoaded && !sameOwner && effectiveSmtGuard && smtAnalysis.foreignKeys.length > 0 && !smtAnalysis.satisfied && (
        <ManualKeyInput label={`Smart owner — ${ownerName(smartOwner)}`} foreignKeys={smtAnalysis.foreignKeys} resolved={resolvedManualKeys} neededMore={smtAnalysis.neededMore} onResolve={handleResolveKey} />
      )}
    </div>
  );

  const signingGuards = sameOwner
    ? [{ label: `Owner (both halves) — ${ownerName(standardOwner)}`, guard: stdGuard }]
    : [
        { label: `Standard owner — ${ownerName(standardOwner)}`, guard: stdGuard },
        { label: `Smart owner — ${ownerName(smartOwner)}`, guard: effectiveSmtGuard },
      ];

  return (
    <ZbomModalFrame onClose={onClose} width={720}>
      <ZbomLayout
        header={
          <>
            <div className="flex items-center gap-2">
              <Pencil className="h-5 w-5" style={{ color: "#a78bfa" }} />
              <h2 className="text-lg font-bold" style={{ color: "#d2d3d4" }}>Rename Dual API Lane</h2>
              <InfoTooltip content="Renames the consumer-lane of this active dual link. Authorized by BOTH half-owners; patron pays 100 STOA (undiscounted), split 4-ways exactly like account activation — cost + receivers come from INFO." />
            </div>
          </>
        }
        executeButton={{
          canExecute,
          isProcessing,
          onClick: handleExecute,
          bgColor: (insufficientStoa || insufficientIgnis) ? "#c0392b" : canExecute ? "#a78bfa" : "#262626",
          textColor: (insufficientStoa || insufficientIgnis) ? "#fff" : canExecute ? "#0a0a0a" : "#888",
          content: canExecute ? (<><Pencil className="inline h-4 w-4 mr-1.5 align-text-bottom" />Rename + Pay</>) : (blockerReason ?? "Rename + Pay"),
          processingContent: (<><Loader2 className="inline h-4 w-4 mr-2 animate-spin" />Processing…</>),
        }}
      >
        <FunctionInfoZone
          key={(patronAccount?.address ?? "") + newName}
          readId="INFO_UpdateDualConsumerLane"
          label="PYTHIA.PYTHIA|INFO_UpdateDualConsumerLane"
          pactCall={`(ouronet-ns.PYTHIA.PYTHIA|INFO_UpdateDualConsumerLane "${(patronAccount?.address ?? "").slice(0, 12)}…" "${dualLinkKey.slice(0, 12)}…" "${newName}")`}
          fetcher={async () => await getRenameDualLaneInfoOnly(renameArgs)}
        />

        <PatronZonePattern2
          patronMode={patronMode}
          onPatronModeChange={setPatronMode}
          primeAccount={primeAccount}
          residentAccount={residentAccount}
          codexAccounts={accounts}
          selectedCustomAccount={selectedCustomAccount}
          onSelectCustomAccount={setSelectedCustomAccount}
          ignisCost={ignisCost}
          virtualToggleActive={virtualToggleActive}
          patronIgnisBalance={patronIgnisBalance}
          loading={loadingInfo}
          autoSelectBestPatron={autoSelectBestPatron}
        />

        <Zone2Wrapper
          functionName="ouronet-ns.TS01-C4.PYTHIA|C_UpdateDualConsumerLane"
          functionMeta={{
            locations: ["Ouronet Account -> Dual API -> Rename lane"],
            name: "Rename Dual API Lane",
            description: "Renames a Pythia dual-link consumer-lane, authorized by both half-owners. Patron pays 100 STOA (undiscounted), split 4-ways like account activation.",
            icon: "pencil",
            addedInVersion: "0.9.0",
            addedDate: "2026-08-08",
          }}
          collapsedContent={inputsBlock}
        >
          <StringEntryInput variant="autonomous" labelIndex={1} varName="patron" value={patronAccount?.address ?? ""} />
          <StringEntryInput variant="autonomous" labelIndex={2} varName="dual-link-key" value={dualLinkKey} />
          <StringEntryInput variant="free" labelIndex={3} varName="new-name" value={newName} onChange={setNewName} placeholder="e.g. Mnemosyne-v2" />
          {inputsBlock}
        </Zone2Wrapper>

        <SigningZone
          patronAccount={patronAccount ? ({ ...patronAccount, guard: (patronPaymentGuard ?? patronAccount.guard) } as any) : null}
          accountAccount={null}
          additionalGuards={signingGuards}
          stoaChainNeed={stoaCost}
          stoaChainReceivers={receivers}
          stoaChainAmounts={amounts.map((a) => String(mayComeWithDeimal(a)))}
        />
      </ZbomLayout>
    </ZbomModalFrame>
  );
}
