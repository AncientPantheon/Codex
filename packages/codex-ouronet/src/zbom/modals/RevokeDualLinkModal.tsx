/**
 * RevokeDualLinkModal — "Revoke Dual API Key" (the kill-switch).
 *
 * Deactivates an ACTIVE dual link via the LIVE `ouronet-ns.TS01-C4.PYTHIA|C_RevokeLink`
 * — authorized by BOTH half-owners (`P|TS`), paid by a PATRON in IGNIS (1 unit,
 * or 0 when virtual gas is zero). No native STOA / no 4-way split — the
 * IGNIS-only sibling of the rotate ops. Counterpart fields stay immutable
 * afterwards (deploy fresh halves to re-pair).
 *
 * ZBOM/CFM flow: patron (IGNIS) + BOTH half-owner ownership guards. Gas via the
 * Ouronet gas station (GAS_PAYER); no payment key / no coin.TRANSFER. HARD RULE:
 * no seed leaves the Codex.
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import { Pact } from "@stoachain/kadena-stoic-legacy/client";
import { Power, Loader2 } from "lucide-react";
import { ZbomModalFrame } from "../ui/ZbomModalFrame.js";
import { InfoTooltip } from "../ui/InfoTooltip.js";
import { ManualKeyInput } from "../ui/ManualKeyInput.js";
import { txPending } from "../toast/toastManager.js";
import { getStoaChainAccountGuard, getIgnisBalance } from "../debouncer/monitoredReads.js";
import { KADENA_CHAIN_ID as STOACHAIN_CHAIN_ID, KADENA_NETWORK as STOACHAIN_NETWORK } from "@stoachain/stoa-core/constants";
import { KADENA_NAMESPACE as STOACHAIN_NAMESPACE, STOA_AUTONOMIC_OURONETGASSTATION } from "@ouronet/ouronet-core/constants";
import { safeCreationTime, mayComeWithDeimal } from "@stoachain/stoa-core/pact";
import { analyzeGuard, buildCodexPubSet } from "@stoachain/stoa-core/guard";
import type { IKeyset } from "@stoachain/stoa-core/guard";
import type { IOuroAccount } from "../../types/entities.js";
import { ZbomLayout } from "../cfm/ZbomLayout.js";
import { FunctionInfoZone } from "../cfm/FunctionInfoZone.js";
import { PatronZonePattern2 } from "../cfm/PatronSpend.js";
import { Zone2Wrapper } from "../cfm/Zone2Wrapper.js";
import { SigningZone } from "../cfm/SigningZone.js";
import { StringEntryInput } from "../cfm/inputs.js";
import { useWallet } from "../cfm/seam.js";
import { useActiveWallet, useSignTransaction } from "../../hooks/index.js";
import { useEnsureCodexUnlocked } from "../hooks/useEnsureCodexUnlocked.js";
import { usePatronSelectionDefaults } from "../patron/usePatronSelectionDefaults.js";
import { detectOriginCurve } from "../../ui/internal/originCurve.js";
import { getRevokeDualLinkInfoOnly, buildRevokeDualLinkPactCode } from "../pythia/dualLinkOps.js";

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
  /** DALOS owner of the Standard half. */
  standardOwner: string;
  /** DALOS owner of the Smart half — MAY differ from the Standard owner. */
  smartOwner: string;
  accounts: IOuroAccount[];
}

export default function RevokeDualLinkModal({
  open, onClose, dualLinkKey, standardOwner, smartOwner, accounts,
}: Props) {
  const { execute } = useSignTransaction();
  const ensureCodexUnlocked = useEnsureCodexUnlocked();
  const { kadena: kadenaSeeds, stoaChainAccounts } = useWallet();
  const { activeOuroAccount } = useActiveWallet();
  const { initialPatronMode, autoSelectBestPatron } = usePatronSelectionDefaults();

  const sameOwner = !!standardOwner && standardOwner === smartOwner;

  const [patronMode, setPatronMode] = useState<PatronMode>(initialPatronMode);
  const [selectedCustomAccount, setSelectedCustomAccount] = useState<IOuroAccount | null>(null);
  const [patronIgnisBalance, setPatronIgnisBalance] = useState<number | null>(null);
  const [stdGuard, setStdGuard] = useState<Guard>(null);
  const [smtGuard, setSmtGuard] = useState<Guard>(null);
  const [patronGuard, setPatronGuard] = useState<Guard>(null);
  const [stdGuardLoaded, setStdGuardLoaded] = useState(false);
  const [smtGuardLoaded, setSmtGuardLoaded] = useState(false);
  const [patronGuardLoaded, setPatronGuardLoaded] = useState(false);
  const [resolvedManualKeys, setResolvedManualKeys] = useState<Record<string, string>>({});
  const [info, setInfo] = useState<any | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

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

  const handleResolveKey = useCallback((pub: string, priv: string) => {
    setResolvedManualKeys((prev) => ({ ...prev, [pub]: priv }));
  }, []);

  // ── Reset on open ──
  useEffect(() => {
    if (!open) return;
    setPatronMode(initialPatronMode);
    setSelectedCustomAccount(null);
    setPatronIgnisBalance(null);
    setStdGuard(null); setSmtGuard(null); setPatronGuard(null);
    setStdGuardLoaded(false); setSmtGuardLoaded(false); setPatronGuardLoaded(false);
    setResolvedManualKeys({});
    setInfo(null); setLoadingInfo(false); setIsProcessing(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ── Patron IGNIS balance ──
  useEffect(() => {
    if (!open || !patronAccount?.address) { setPatronIgnisBalance(null); return; }
    setPatronIgnisBalance(null);
    getIgnisBalance(patronAccount.address)
      .then((v) => setPatronIgnisBalance(v ? parseFloat(v) : 0))
      .catch(() => setPatronIgnisBalance(0));
  }, [open, patronAccount?.address]);

  // ── Resolve the two half-owner guards + the patron guard from chain. ──
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
    if (!open || !patronAccount?.address) { setPatronGuard(null); setPatronGuardLoaded(false); return; }
    return resolveGuard(patronAccount.address, setPatronGuard, setPatronGuardLoaded);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, patronAccount?.address]);

  // ── INFO fetch (debounced) — IGNIS cost. ──
  useEffect(() => {
    if (!open || !patronAccount?.address) { setInfo(null); return; }
    setLoadingInfo(true);
    let aborted = false;
    const t = setTimeout(() => {
      getRevokeDualLinkInfoOnly({ patron: patronAccount.address, dualLinkKey })
        .then((r) => { if (!aborted) setInfo(r); })
        .catch(() => { if (!aborted) setInfo(null); })
        .finally(() => { if (!aborted) setLoadingInfo(false); });
    }, 400);
    return () => { aborted = true; clearTimeout(t); };
  }, [open, patronAccount?.address, dualLinkKey]);

  const ignisCost = toNum(info?.ignis?.["ignis-need"]);
  const virtualToggleActive = ignisCost > 0;
  const insufficientIgnis = ignisCost > 0 && (patronIgnisBalance ?? 0) < ignisCost;

  const codexPubs = useMemo(() => buildCodexPubSet(kadenaSeeds, stoaChainAccounts), [kadenaSeeds, stoaChainAccounts]);
  const stdAnalysis = useMemo(() => analyzeGuard(stdGuard, codexPubs, resolvedManualKeys), [stdGuard, codexPubs, resolvedManualKeys]);
  const smtAnalysis = useMemo(() => (sameOwner ? stdAnalysis : analyzeGuard(effectiveSmtGuard, codexPubs, resolvedManualKeys)), [sameOwner, stdAnalysis, effectiveSmtGuard, codexPubs, resolvedManualKeys]);

  const ownerName = (addr: string) => {
    const a = accounts.find((x) => x.address === addr);
    if (!a) return addr ? addr.slice(0, 16) + "…" : "—";
    return accounts.indexOf(a) === 0 ? "CodexPrime" : (a.name || addr.slice(0, 16) + "…");
  };

  // Guards for the signer: patron + both owners, deduped by keyset identity.
  const guards = useMemo<IKeyset[]>(() => {
    const out: IKeyset[] = [];
    const seen = new Set<string>();
    const push = (g: Guard) => {
      if (!g?.keys?.length) return;
      const id = `${g.pred}|${[...g.keys].sort().join(",")}`;
      if (seen.has(id)) return;
      seen.add(id); out.push(g as IKeyset);
    };
    push(patronGuard); push(stdGuard); if (!sameOwner) push(effectiveSmtGuard);
    return out;
  }, [patronGuard, stdGuard, effectiveSmtGuard, sameOwner]);

  const guardsLoaded = stdGuardLoaded && smtGuardLoaded && patronGuardLoaded;
  const blockerReason = (() => {
    if (isProcessing) return null;
    if (!patronAccount) return "Pick a patron";
    if (loadingInfo || info === null) return "Loading function info…";
    if (insufficientIgnis) return "Insufficient IGNIS";
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
    if (!canExecute || !patronAccount) return;
    setIsProcessing(true);
    const _tx = txPending("Revoke Dual API Key");
    try {
      if (!(await ensureCodexUnlocked())) { _tx.fail("Authentication required"); return; }
      const pactCode = buildRevokeDualLinkPactCode({ patron: patronAccount.address, dualLinkKey });
      const { requestKey } = await execute({
        build: ({ gasLimit, capsKeyPub, guardPubs }: { gasLimit: number; capsKeyPub: string; guardPubs: string[] }) => {
          let builder = Pact.builder
            .execution(pactCode)
            .setMeta({ senderAccount: STOA_AUTONOMIC_OURONETGASSTATION, creationTime: safeCreationTime(), chainId: STOACHAIN_CHAIN_ID, gasLimit })
            .setNetworkId(STOACHAIN_NETWORK)
            .addSigner(capsKeyPub, (w: any) => [
              w(`${STOACHAIN_NAMESPACE}.DALOS.GAS_PAYER`, "", { int: 0 }, { decimal: "0.0" }),
            ]);
          const seen = new Set<string>([capsKeyPub]);
          for (const gp of guardPubs) { if (seen.has(gp)) continue; seen.add(gp); builder = (builder as any).addSigner(gp); }
          return (builder as any).createTransaction();
        },
        guards,
        paymentKey: null,
        resolvedForeignKeys: resolvedManualKeys,
      } as any);
      _tx.submitted(requestKey);
      onClose();
    } catch (e: any) {
      console.error("[RevokeDualLink handleExecute]", e);
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
      <div className="flex items-center justify-between rounded-lg border p-2.5" style={{ borderColor: "#8b1a1a30", backgroundColor: "#0a0a0a" }}>
        <span className="text-xs" style={{ color: "#888" }}>IGNIS fee</span>
        <span className="text-xs font-bold" style={{ color: insufficientIgnis ? "#c0392b" : "#c0392b" }}>
          {loadingInfo || info === null ? "…" : ignisCost > 0 ? `${ignisCost} IGNIS` : "free"}
        </span>
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
              <Power className="h-5 w-5" style={{ color: "#c0392b" }} />
              <h2 className="text-lg font-bold" style={{ color: "#d2d3d4" }}>Revoke Dual API Key</h2>
              <InfoTooltip content="Deactivates (kill-switch) this active dual link. Authorized by BOTH half-owners; patron pays 1 IGNIS. Counterpart fields remain immutable afterward — deploy fresh halves to re-pair." />
            </div>
          </>
        }
        executeButton={{
          canExecute,
          isProcessing,
          onClick: handleExecute,
          bgColor: insufficientIgnis ? "#c0392b" : canExecute ? "#c0392b" : "#262626",
          textColor: canExecute || insufficientIgnis ? "#fff" : "#888",
          content: canExecute ? (<><Power className="inline h-4 w-4 mr-1.5 align-text-bottom" />Revoke</>) : (blockerReason ?? "Revoke"),
          processingContent: (<><Loader2 className="inline h-4 w-4 mr-2 animate-spin" />Processing…</>),
        }}
      >
        <FunctionInfoZone
          key={patronAccount?.address ?? ""}
          readId="INFO_UnlinkDualApiKey"
          label="PYTHIA.PYTHIA|INFO_UnlinkDualApiKey"
          pactCall={`(ouronet-ns.PYTHIA.PYTHIA|INFO_UnlinkDualApiKey "${(patronAccount?.address ?? "").slice(0, 12)}…" "${dualLinkKey.slice(0, 14)}…")`}
          fetcher={async () => await getRevokeDualLinkInfoOnly({ patron: patronAccount?.address ?? "", dualLinkKey })}
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
          functionName="ouronet-ns.TS01-C4.PYTHIA|C_RevokeLink"
          functionMeta={{
            locations: ["Ouronet Account -> Dual API -> Revoke"],
            name: "Revoke Dual API Key",
            description: "Deactivates an active Pythia dual link (kill-switch), authorized by both half-owners. Patron pays 1 IGNIS. Counterpart fields remain immutable.",
            icon: "power",
            addedInVersion: "0.9.0",
            addedDate: "2026-08-08",
          }}
          collapsedContent={inputsBlock}
        >
          <StringEntryInput variant="autonomous" labelIndex={1} varName="patron" value={patronAccount?.address ?? ""} />
          <StringEntryInput variant="autonomous" labelIndex={2} varName="dual-link-key" value={dualLinkKey} />
          {inputsBlock}
        </Zone2Wrapper>

        <SigningZone
          patronAccount={patronAccount ? ({ ...patronAccount, guard: (patronGuard ?? patronAccount.guard) } as any) : null}
          accountAccount={null}
          additionalGuards={signingGuards}
          stoaChainNeed={0}
        />
      </ZbomLayout>
    </ZbomModalFrame>
  );
}
