/**
 * LinkDualApiKeyModal — "Link Dual API Key".
 *
 * Links a deployed Standard (₱.) half to a deployed Smart (Π.) half into an
 * INACTIVE dual row via the LIVE `ouronet-ns.TS01-C4.PYTHIA|C_Link` — with NO
 * STOA/IGNIS fee (Cronoton activates the row later, after the off-chain
 * dual-ownership proof). 3 args: standard-apollo + smart-apollo are auto-filled
 * from the two picked halves; consumer-lane is the only user input.
 *
 * OWNERSHIP (the load-bearing part): C_Link is authorized by the ownership of
 * BOTH halves. Each half's owner is a DALOS Ouronet account
 * (`(PYTHIA.UR_OwnerAccount apollo)`, surfaced as `owner-account` on the API-key
 * row) — and the two halves MAY have DIFFERENT owners. So this modal resolves
 * EACH owner's on-chain guard, checks the Codex holds enough keys for EACH (and
 * asks for any missing key via `ManualKeyInput`, standard-zbom style), and signs
 * BOTH ownership guards. When both halves share one owner, the single guard is
 * shown/signed once (one signature satisfies both enforce-keysets).
 *
 * ZBOM/CFM flow — the no-fee sibling of ActivateApolloPythiaKeyModal, minus the
 * entire patron / payment-key / STOA-cost / coin.TRANSFER machinery. Gas is
 * covered by the Ouronet gas station (GAS_PAYER on the auto-selected caps key).
 * HARD RULE: no seed leaves the Codex.
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import { Pact } from "@stoachain/kadena-stoic-legacy/client";
import { Link2, Loader2 } from "lucide-react";
import { ZbomModalFrame } from "../ui/ZbomModalFrame.js";
import { InfoTooltip } from "../ui/InfoTooltip.js";
import { ManualKeyInput } from "../ui/ManualKeyInput.js";
import { txPending } from "../toast/toastManager.js";
import { getStoaChainAccountGuard } from "../debouncer/monitoredReads.js";
import { KADENA_CHAIN_ID as STOACHAIN_CHAIN_ID, KADENA_NETWORK as STOACHAIN_NETWORK } from "@stoachain/stoa-core/constants";
import { KADENA_NAMESPACE as STOACHAIN_NAMESPACE, STOA_AUTONOMIC_OURONETGASSTATION } from "@ouronet/ouronet-core/constants";
import { safeCreationTime } from "@stoachain/stoa-core/pact";
import { analyzeGuard, buildCodexPubSet } from "@stoachain/stoa-core/guard";
import type { IKeyset } from "@stoachain/stoa-core/guard";
import type { IOuroAccount } from "../../types/entities.js";
import { ZbomLayout } from "../cfm/ZbomLayout.js";
import { FunctionInfoZone } from "../cfm/FunctionInfoZone.js";
import { Zone2Wrapper } from "../cfm/Zone2Wrapper.js";
import { SigningZone } from "../cfm/SigningZone.js";
import { StringEntryInput } from "../cfm/inputs.js";
import { useWallet } from "../cfm/seam.js";
import { useSignTransaction } from "../../hooks/index.js";
import { useEnsureCodexUnlocked } from "../hooks/useEnsureCodexUnlocked.js";
import { getLinkDualApiKeyInfo, buildLinkDualApiKeyPactCode } from "../pythia/linkDualApiKey.js";

const MONO = "var(--codex-font-mono, 'JetBrains Mono', ui-monospace, monospace)";
type Guard = { keys: string[]; pred: string } | null;

interface Props {
  open: boolean;
  onClose: () => void;
  /** The picked Standard ₱. half. */
  standardAccount: IOuroAccount;
  /** The picked Smart Π. half. */
  smartAccount: IOuroAccount;
  /** The DALOS owner account of the Standard half (`owner-account` = `UR_OwnerAccount`). */
  standardOwner: string;
  /** The DALOS owner account of the Smart half — MAY differ from the Standard owner. */
  smartOwner: string;
  /** All codex accounts — for pretty owner labels only. */
  accounts: IOuroAccount[];
}

export default function LinkDualApiKeyModal({
  open, onClose, standardAccount, smartAccount, standardOwner, smartOwner, accounts,
}: Props) {
  const { execute } = useSignTransaction();
  const ensureCodexUnlocked = useEnsureCodexUnlocked();
  const { kadena: kadenaSeeds, stoaChainAccounts } = useWallet();

  const [consumerLane, setConsumerLane] = useState("");
  const [stdGuard, setStdGuard] = useState<Guard>(null);
  const [smtGuard, setSmtGuard] = useState<Guard>(null);
  const [stdGuardLoaded, setStdGuardLoaded] = useState(false);
  const [smtGuardLoaded, setSmtGuardLoaded] = useState(false);
  const [resolvedManualKeys, setResolvedManualKeys] = useState<Record<string, string>>({});
  const [info, setInfo] = useState<any | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  // Both halves MAY share one DALOS owner (common) or have DIFFERENT owners.
  const sameOwner = !!standardOwner && standardOwner === smartOwner;

  const args = useMemo(
    () => ({ standardApollo: standardAccount.address, smartApollo: smartAccount.address, consumerLane }),
    [standardAccount.address, smartAccount.address, consumerLane],
  );

  const handleResolveKey = useCallback((pub: string, priv: string) => {
    setResolvedManualKeys((prev) => ({ ...prev, [pub]: priv }));
  }, []);

  // ── Reset on open ──
  useEffect(() => {
    if (!open) return;
    setConsumerLane("");
    setStdGuard(null); setSmtGuard(null);
    setStdGuardLoaded(false); setSmtGuardLoaded(false);
    setResolvedManualKeys({});
    setInfo(null); setLoadingInfo(false); setIsProcessing(false);
  }, [open]);

  // ── Resolve the STANDARD half-owner's on-chain guard (stored guard is often an
  //    unresolved keyset-ref that can't be signed). ──
  useEffect(() => {
    if (!open || !standardOwner) { setStdGuard(null); setStdGuardLoaded(false); return; }
    let aborted = false;
    setStdGuard(null); setStdGuardLoaded(false);
    getStoaChainAccountGuard(standardOwner)
      .then((g) => { if (!aborted) setStdGuard(((g as unknown) as Guard) ?? null); })
      .catch(() => { if (!aborted) setStdGuard(null); })
      .finally(() => { if (!aborted) setStdGuardLoaded(true); });
    return () => { aborted = true; };
  }, [open, standardOwner]);

  // ── Resolve the SMART half-owner's guard. When both halves share one owner the
  //    standard guard already covers it (one enforce-keyset, one signature) — skip
  //    the duplicate chain read; `effectiveSmtGuard` below reuses stdGuard. ──
  useEffect(() => {
    if (!open || !smartOwner) { setSmtGuard(null); setSmtGuardLoaded(false); return; }
    if (sameOwner) { setSmtGuard(null); setSmtGuardLoaded(true); return; }
    let aborted = false;
    setSmtGuard(null); setSmtGuardLoaded(false);
    getStoaChainAccountGuard(smartOwner)
      .then((g) => { if (!aborted) setSmtGuard(((g as unknown) as Guard) ?? null); })
      .catch(() => { if (!aborted) setSmtGuard(null); })
      .finally(() => { if (!aborted) setSmtGuardLoaded(true); });
    return () => { aborted = true; };
  }, [open, smartOwner, sameOwner]);

  // The guard that actually enforces the Smart half's ownership (reuses the
  // Standard guard when the owner is the same account).
  const effectiveSmtGuard: Guard = sameOwner ? stdGuard : smtGuard;

  // ── INFO fetch (debounced) — the no-cost ClientInfo preview. ──
  useEffect(() => {
    if (!open) { setInfo(null); return; }
    setLoadingInfo(true);
    let aborted = false;
    const t = setTimeout(() => {
      getLinkDualApiKeyInfo(args)
        .then((r) => { if (!aborted) setInfo(r); })
        .catch(() => { if (!aborted) setInfo(null); })
        .finally(() => { if (!aborted) setLoadingInfo(false); });
    }, 400);
    return () => { aborted = true; clearTimeout(t); };
  }, [open, args]);

  // ── Guard analysis: which owner keys the Codex holds vs must be provided. ──
  const codexPubs = useMemo(
    () => buildCodexPubSet(kadenaSeeds, stoaChainAccounts),
    [kadenaSeeds, stoaChainAccounts],
  );
  const stdAnalysis = useMemo(
    () => analyzeGuard(stdGuard, codexPubs, resolvedManualKeys),
    [stdGuard, codexPubs, resolvedManualKeys],
  );
  const smtAnalysis = useMemo(
    () => (sameOwner ? stdAnalysis : analyzeGuard(effectiveSmtGuard, codexPubs, resolvedManualKeys)),
    [sameOwner, stdAnalysis, effectiveSmtGuard, codexPubs, resolvedManualKeys],
  );

  // Owner guards passed to the signer — deduped when both halves share an owner.
  const ownerGuards = useMemo<IKeyset[]>(() => {
    const out: IKeyset[] = [];
    if (stdGuard?.keys?.length) out.push(stdGuard as IKeyset);
    if (!sameOwner && effectiveSmtGuard?.keys?.length) out.push(effectiveSmtGuard as IKeyset);
    return out;
  }, [stdGuard, effectiveSmtGuard, sameOwner]);

  const ownerName = (addr: string) => {
    const a = accounts.find((x) => x.address === addr);
    if (!a) return addr ? addr.slice(0, 16) + "…" : "—";
    return accounts.indexOf(a) === 0 ? "CodexPrime" : (a.name || addr.slice(0, 16) + "…");
  };

  const guardsLoaded = stdGuardLoaded && smtGuardLoaded;
  const stdReady = stdAnalysis.satisfied;
  const smtReady = sameOwner || smtAnalysis.satisfied;

  const blockerReason = (() => {
    if (isProcessing) return null;
    if (!consumerLane.trim()) return "Enter a consumer lane";
    if (loadingInfo || info === null) return "Loading function info…";
    if (!guardsLoaded) return "Resolving owner guards…";
    if (!stdGuard?.keys?.length) return "Standard owner guard unavailable";
    if (!sameOwner && !effectiveSmtGuard?.keys?.length) return "Smart owner guard unavailable";
    if (!stdReady) return `Provide Standard owner key${stdAnalysis.neededMore > 1 ? "s" : ""}`;
    if (!smtReady) return `Provide Smart owner key${smtAnalysis.neededMore > 1 ? "s" : ""}`;
    return null;
  })();
  const canExecute = blockerReason === null && !isProcessing;

  async function handleExecute() {
    if (!canExecute) return;
    setIsProcessing(true);
    const _tx = txPending("Link Dual API Key");
    try {
      if (!(await ensureCodexUnlocked())) { _tx.fail("Authentication required"); return; }
      const pactCode = buildLinkDualApiKeyPactCode({
        standardApollo: standardAccount.address,
        smartApollo: smartAccount.address,
        consumerLane: consumerLane.trim(),
      });
      const { requestKey } = await execute({
        build: ({ gasLimit, capsKeyPub, guardPubs }: { gasLimit: number; capsKeyPub: string; guardPubs: string[] }) => {
          // Gas via the Ouronet gas station (GAS_PAYER on the caps key). The
          // ownership guard keys (from BOTH owners) sign their enforce-keysets.
          // No coin.TRANSFER — no fee.
          let builder = Pact.builder
            .execution(pactCode)
            .setMeta({
              senderAccount: STOA_AUTONOMIC_OURONETGASSTATION,
              creationTime: safeCreationTime(),
              chainId: STOACHAIN_CHAIN_ID,
              gasLimit,
            })
            .setNetworkId(STOACHAIN_NETWORK)
            .addSigner(capsKeyPub, (w: any) => [
              w(`${STOACHAIN_NAMESPACE}.DALOS.GAS_PAYER`, "", { int: 0 }, { decimal: "0.0" }),
            ]);
          // Each pubkey signs EXACTLY once — dedup the caps key and any key that
          // appears in both owners' guards (same-owner or overlapping keysets).
          const seen = new Set<string>([capsKeyPub]);
          for (const gp of guardPubs) {
            if (seen.has(gp)) continue;
            seen.add(gp);
            builder = (builder as any).addSigner(gp);
          }
          return (builder as any).createTransaction();
        },
        guards: ownerGuards,
        resolvedForeignKeys: resolvedManualKeys,
      } as any);
      _tx.submitted(requestKey);
      onClose();
    } catch (e: any) {
      console.error("[LinkDualApiKey handleExecute]", e);
      _tx.fail(e?.message ?? "Failed");
    } finally {
      setIsProcessing(false);
    }
  }

  if (!open) return null;

  const label = (text: string) => (
    <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "#555" }}>{text}</span>
  );

  const halfRow = (accent: string, tag: string, acct: IOuroAccount, owner: string) => (
    <div className="rounded-lg border p-2.5" style={{ borderColor: "#262626", backgroundColor: "#0a0a0a" }}>
      <div className="flex items-center gap-2" style={{ marginBottom: 4 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: accent }}>{tag}</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: "#d2d3d4" }}>{acct.name || "—"}</span>
      </div>
      <code style={{ display: "block", fontFamily: MONO, fontSize: 10, wordBreak: "break-all", color: "#8a8a8a" }}>{acct.address}</code>
      <div style={{ marginTop: 4 }}>{label(`owner · ${ownerName(owner)}`)}</div>
    </div>
  );

  const inputsBlock = (
    <div className="space-y-2">
      {halfRow("#ceac5f", "₱. Standard", standardAccount, standardOwner)}
      {halfRow("#a78bfa", "Π. Smart", smartAccount, smartOwner)}
      <div>
        {label("Consumer lane (you type this)")}
        <div style={{ marginTop: 4 }}>
          <StringEntryInput
            variant="free"
            labelIndex={3}
            varName="consumer-lane"
            value={consumerLane}
            onChange={setConsumerLane}
            placeholder="e.g. Mnemosyne"
          />
        </div>
      </div>

      {/* Missing owner keys — ask for any key the Codex doesn't already hold, per
          half-owner (standard-zbom manual-key resolution). */}
      {guardsLoaded && stdGuard && stdAnalysis.foreignKeys.length > 0 && !stdReady && (
        <ManualKeyInput
          label={`${sameOwner ? "Owner" : "Standard owner"} — ${ownerName(standardOwner)}`}
          foreignKeys={stdAnalysis.foreignKeys}
          resolved={resolvedManualKeys}
          neededMore={stdAnalysis.neededMore}
          onResolve={handleResolveKey}
        />
      )}
      {guardsLoaded && !sameOwner && effectiveSmtGuard && smtAnalysis.foreignKeys.length > 0 && !smtReady && (
        <ManualKeyInput
          label={`Smart owner — ${ownerName(smartOwner)}`}
          foreignKeys={smtAnalysis.foreignKeys}
          resolved={resolvedManualKeys}
          neededMore={smtAnalysis.neededMore}
          onResolve={handleResolveKey}
        />
      )}

      <div className="flex items-center justify-between rounded-lg border p-2.5" style={{ borderColor: "#16a34a30", backgroundColor: "#0a0a0a" }}>
        <span className="text-xs" style={{ color: "#888" }}>Fee</span>
        <span className="text-xs font-bold" style={{ color: "#4ade80" }}>No STOA / IGNIS — Cronoton activates later</span>
      </div>
    </div>
  );

  // Both ownerships shown explicitly. Same owner → one row (covers both halves);
  // different owners → two rows, each enforced independently.
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
              <Link2 className="h-5 w-5" style={{ color: "#a78bfa" }} />
              <h2 className="text-lg font-bold" style={{ color: "#d2d3d4" }}>Link Dual API Key</h2>
              <InfoTooltip content="Links a deployed Standard (₱.) half to a deployed Smart (Π.) half into an inactive dual row. Authorized by BOTH half-owners (which may be different Ouronet accounts); no STOA/IGNIS fee. The Cronoton activates the row later after the off-chain dual-ownership proof." />
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs font-mono font-bold" style={{ color: "#ceac5f" }}>{standardAccount.name || "₱."}</span>
              <span className="text-xs" style={{ color: "#555" }}>↔</span>
              <span className="text-xs font-mono font-bold" style={{ color: "#a78bfa" }}>{smartAccount.name || "Π."}</span>
            </div>
          </>
        }
        executeButton={{
          canExecute,
          isProcessing,
          onClick: handleExecute,
          bgColor: canExecute ? "#a78bfa" : "#262626",
          textColor: canExecute ? "#0a0a0a" : "#888",
          content: canExecute
            ? (<><Link2 className="inline h-4 w-4 mr-1.5 align-text-bottom" />Link halves</>)
            : (blockerReason ?? "Link halves"),
          processingContent: (<><Loader2 className="inline h-4 w-4 mr-2 animate-spin" />Processing…</>),
        }}
      >
        {/* ── Zone 0 — Function Info (no-cost ClientInfo) ── */}
        <FunctionInfoZone
          key={consumerLane}
          readId="INFO_LinkDualApiKey"
          label="PYTHIA.PYTHIA|INFO_LinkDualApiKey"
          pactCall={`(ouronet-ns.PYTHIA.PYTHIA|INFO_LinkDualApiKey "${standardAccount.address.slice(0, 12)}…" "${smartAccount.address.slice(0, 12)}…" "${consumerLane}")`}
          fetcher={async () => await getLinkDualApiKeyInfo(args)}
        />

        {/* ── Zone 2 — Inputs (args 1–2 autonomous, arg 3 user-typed) ── */}
        <Zone2Wrapper
          functionName="ouronet-ns.TS01-C4.PYTHIA|C_Link"
          functionMeta={{
            locations: ["Ouronet Account -> Single API -> Link"],
            name: "Link Dual API Key",
            description: "Links a deployed Standard + Smart Apollo half into an inactive dual row, authorized by both half-owners. No STOA/IGNIS fee; the Cronoton activates the row after the off-chain dual-ownership proof.",
            icon: "link",
            addedInVersion: "0.9.0",
            addedDate: "2026-08-08",
          }}
          collapsedContent={inputsBlock}
        >
          <StringEntryInput variant="autonomous" labelIndex={1} varName="standard-apollo" value={standardAccount.address} />
          <StringEntryInput variant="autonomous" labelIndex={2} varName="smart-apollo" value={smartAccount.address} />
          <StringEntryInput variant="free" labelIndex={3} varName="consumer-lane" value={consumerLane} onChange={setConsumerLane} placeholder="e.g. Mnemosyne" />
          {inputsBlock}
        </Zone2Wrapper>

        {/* ── Zone 3 — Signing: BOTH half-owner ownership guards. No patron / no cost. ── */}
        <SigningZone
          patronAccount={null}
          accountAccount={null}
          additionalGuards={signingGuards}
          stoaChainNeed={0}
        />
      </ZbomLayout>
    </ZbomModalFrame>
  );
}
