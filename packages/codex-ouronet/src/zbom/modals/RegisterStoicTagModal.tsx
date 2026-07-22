/**
 * RegisterStoicTagModal — CFM Architecture v2 (ZBOM). Registers (claims) a
 * StoicTag for an Ouronet account.
 *
 * Cost is NATIVE STOA (discounted by the account's Elite tier — the chain
 * computes it, so all amounts come from INFO_RegisterStoicTag, never client
 * side). The patron's payment key pays, split 10/20/30/40 across the protocol
 * receivers, so it signs `GAS_PAYER` + one `coin.TRANSFER` per receiver. The
 * tagged account's guard also signs (ownership).
 *
 * Pact functions:
 *   INFO    — (ouronet-ns.CODEX.CODEX|INFO_RegisterStoicTag patron tag-name account)
 *   EXECUTE — (ouronet-ns.TS01-C4.CODEX|C_RegisterStoicTag patron tag-name account)
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import { Pact } from "@stoachain/kadena-stoic-legacy/client";
import { ZbomModalFrame } from "../ui/ZbomModalFrame.js";
import { InfoTooltip } from "../ui/InfoTooltip.js";
import { useGetKeypair } from "../../hooks/index.js";
import { usePatronSelectionDefaults } from "../patron/usePatronSelectionDefaults.js";
import { txPending } from "../toast/toastManager.js";
import { Tag, Loader2, AlertTriangle, Trash2 } from "lucide-react";
import { getIgnisBalance, getStoaChainAccountGuard } from "../debouncer/monitoredReads.js";
import { getWrapperPaymentKey, getPaymentKeyBalance } from "@ouronet/ouronet-core/interactions/wrapFunctions";
import { getRegisterStoicTagInfo } from "@ouronet/ouronet-core/interactions/ouroAccountFunctions";
import { KADENA_CHAIN_ID as STOACHAIN_CHAIN_ID, KADENA_NETWORK as STOACHAIN_NETWORK } from "@stoachain/stoa-core/constants";
import {
  KADENA_NAMESPACE as STOACHAIN_NAMESPACE,
  STOA_AUTONOMIC_OURONETGASSTATION,
} from "@ouronet/ouronet-core/constants";
import { buildRegisterStoicTagPactCode } from "@ouronet/ouronet-core/pact";
import { safeCreationTime, mayComeWithDeimal } from "@stoachain/stoa-core/pact";
import { classifyPaymentKey, buildCodexPubSet } from "@stoachain/stoa-core/guard";
import type { IKeyset } from "@stoachain/stoa-core/guard";
import type { IKadenaKeypair as IStoaChainKeypair } from "@stoachain/stoa-core/signing";
import type { IOuroAccount, IStoaChainSeed, IStoaChainWallet } from "../../types/entities.js";
import { ZbomLayout } from "../cfm/ZbomLayout.js";
import { FunctionInfoZone } from "../cfm/FunctionInfoZone.js";
import { PatronZonePattern2 } from "../cfm/PatronSpend.js";
import { Zone2Wrapper } from "../cfm/Zone2Wrapper.js";
import { SigningZone } from "../cfm/SigningZone.js";
import { StringEntryInput } from "../cfm/inputs.js";
import { AuthPathZone, type AuthPathSelection } from "../cfm/AuthPathZone.js";
import { PaymentKeyInput } from "../ui/ManualKeyInput.js";
import { StoicTagDisplay } from "@ancientpantheon/codex-ui/ui";
import { filterToDalosGlyphs, MAX_STOIC_TAG_GLYPHS } from "../../ui/internal/dalosGlyphs.js";
import { useSignTransaction } from "../../hooks/index.js";
import { useEnsureCodexUnlocked } from "../hooks/useEnsureCodexUnlocked.js";

function toNum(v: any): number {
  if (v === null || v === undefined) return 0;
  const raw = mayComeWithDeimal(v);
  return typeof raw === "number" ? raw : parseFloat(String(raw)) || 0;
}

type PatronMode = "prime" | "resident" | "custom";

interface Props {
  open: boolean;
  onClose: () => void;
  /** The account the StoicTag is being applied to. */
  account: IOuroAccount;
  accounts: IOuroAccount[];
  kadenaSeeds: IStoaChainSeed[];
  stoaChainAccounts: IStoaChainWallet[];
}

export default function RegisterStoicTagModal({
  open,
  onClose,
  account,
  accounts,
  kadenaSeeds,
  stoaChainAccounts,
}: Props) {
  const getStoaChainKeyPairsByPublicKey = useGetKeypair();
  const { execute } = useSignTransaction();
  const ensureCodexUnlocked = useEnsureCodexUnlocked();
  const { initialPatronMode, autoSelectBestPatron } = usePatronSelectionDefaults();

  // Smart accounts (Σ.) authorise via enforce-one over THREE branches — the
  // account's own guard is NOT sufficient on its own. Standard accounts (Ѻ.)
  // use a single keyset and keep their existing behavior unchanged.
  const isSmart = account.isSmart === true;

  const [patronMode, setPatronMode] = useState<PatronMode>(initialPatronMode);
  const [selectedCustomAccount, setSelectedCustomAccount] = useState<IOuroAccount | null>(null);
  const [patronIgnisBalance, setPatronIgnisBalance] = useState<number | null>(null);

  const [tagName, setTagName] = useState("");

  const [paymentKeyAddr, setPaymentKeyAddr] = useState<string | null>(null);
  const [paymentKeyBal, setPaymentKeyBal] = useState<number | null>(null);
  const [loadingPK, setLoadingPK] = useState(false);

  const [fullInfo, setFullInfo] = useState<{ info: any; receivers: string[] } | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [resolvedManualKeys, setResolvedManualKeys] = useState<Record<string, string>>({});
  const [isProcessing, setIsProcessing] = useState(false);

  // ── Resolved account guard (for AuthPathZone — Smart accounts only).
  //    account.guard is an UNRESOLVED keyset-ref object; getStoaChainAccountGuard
  //    resolves it to a plain keyset so the Account-Guard branch classifies as
  //    key-based instead of "ZBOM cannot". ──
  const [resolvedAccountGuard, setResolvedAccountGuard] = useState<unknown>(null);
  const [accountGuardLoaded, setAccountGuardLoaded] = useState(false);

  // ── Sovereign guard fetch (for AuthPathZone — Smart accounts only) ──
  const [sovereignGuard, setSovereignGuard] = useState<unknown>(null);
  const [sovereignLoaded, setSovereignLoaded] = useState(false);

  // ── AuthPathZone selection (Smart accounts only) ──
  const [authSelection, setAuthSelection] = useState<AuthPathSelection>({
    branchIndex: -1,
    branch: null,
    chosenKeyset: null,
    satisfied: false,
    impossibleViaZbom: false,
  });

  const primeAccount = accounts[0] ?? null;
  const patronAccount = useMemo<IOuroAccount | null>(() => {
    if (patronMode === "prime")    return primeAccount;
    if (patronMode === "resident") return account;
    return selectedCustomAccount ?? primeAccount;
  }, [patronMode, selectedCustomAccount, primeAccount, account]);

  const glyphCount = Array.from(tagName).length;

  // ── Patron payment key (pays STOA) + balance ──
  useEffect(() => {
    if (!open || !patronAccount?.address) return;
    setLoadingPK(true);
    setPaymentKeyAddr(null);
    setPaymentKeyBal(null);
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
    if (!open || !patronAccount?.address || !tagName) { setFullInfo(null); return; }
    setLoadingInfo(true);
    setFullInfo(null);
    let aborted = false;
    const t = setTimeout(() => {
      getRegisterStoicTagInfo(patronAccount.address, tagName, account.address)
        .then((r) => { if (!aborted) setFullInfo(r); })
        .catch(() => { if (!aborted) setFullInfo(null); })
        .finally(() => { if (!aborted) setLoadingInfo(false); });
    }, 450);
    return () => { aborted = true; clearTimeout(t); };
  }, [open, patronAccount?.address, tagName, account.address]);

  // ── Account guard resolution — the stored account.guard is an UNRESOLVED
  //    keyset-ref object, which classifies as non-key-based. getStoaChainAccountGuard
  //    resolves it to a plain keyset so the Account-Guard branch is signable.
  //    Standard accounts don't use AuthPathZone, so leave inert. ──
  useEffect(() => {
    if (!open) return;
    setResolvedAccountGuard(null);
    setAccountGuardLoaded(false);
    if (!isSmart) {
      setAccountGuardLoaded(true);
      return;
    }
    let aborted = false;
    getStoaChainAccountGuard(account.address)
      .then((g) => { if (!aborted) setResolvedAccountGuard(g); })
      .catch(() => { if (!aborted) setResolvedAccountGuard(null); })
      .finally(() => { if (!aborted) setAccountGuardLoaded(true); });
    return () => { aborted = true; };
  }, [open, account, isSmart]);

  // ── Sovereign guard fetch — needed for the AuthPathZone middle branch.
  //    Only Smart accounts have a sovereign; for Standard accounts we leave
  //    sovereignGuard null / sovereignLoaded true so the zone is inert (and
  //    never rendered anyway). ──
  useEffect(() => {
    if (!open) return;
    setSovereignGuard(null);
    setSovereignLoaded(false);
    if (!isSmart) {
      // Standard account — no AuthPathZone, no fetch. Mark loaded so any
      // sovereignLoaded-gated blocker is inert.
      setSovereignLoaded(true);
      return;
    }
    const sov = (account as any).sovereign as string | false | undefined;
    if (!sov || typeof sov !== "string") {
      // Unactivated Smart account — no on-chain sovereign yet. AuthPathZone
      // will render the sovereign branch as 'unknown' / non-key-based.
      setSovereignLoaded(true);
      return;
    }
    let aborted = false;
    getStoaChainAccountGuard(sov)
      .then((g) => { if (!aborted) setSovereignGuard(g); })
      .catch(() => { if (!aborted) setSovereignGuard(null); })
      .finally(() => { if (!aborted) setSovereignLoaded(true); });
    return () => { aborted = true; };
  }, [open, account, isSmart]);

  // ── Reset on open ──
  useEffect(() => {
    if (!open) return;
    setPatronMode(initialPatronMode);
    setSelectedCustomAccount(null);
    setPatronIgnisBalance(null);
    setTagName("");
    setPaymentKeyAddr(null);
    setPaymentKeyBal(null);
    setFullInfo(null);
    setLoadingInfo(false);
    setResolvedManualKeys({});
    setIsProcessing(false);
    setResolvedAccountGuard(null);
    setAccountGuardLoaded(false);
    setSovereignGuard(null);
    setSovereignLoaded(false);
    setAuthSelection({
      branchIndex: -1,
      branch: null,
      chosenKeyset: null,
      satisfied: false,
      impossibleViaZbom: false,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ── Derived cost / split (ALL from INFO — discount applied on chain) ──
  const info = fullInfo?.info ?? null;
  const receivers: string[] = fullInfo?.receivers ?? [];
  const amounts: any[] = info?.kadena?.["kadena-split"] ?? [];
  const stoaCost = toNum(info?.kadena?.["kadena-full"]);
  const ignisCost = toNum(info?.ignis?.["ignis-need"]);
  const virtualToggleActive = ignisCost > 0;
  const insufficientIgnis = ignisCost > 0 && (patronIgnisBalance ?? 0) < ignisCost;

  // ── Payment key readiness ──
  const codexPubs = useMemo(() => buildCodexPubSet(kadenaSeeds, stoaChainAccounts), [kadenaSeeds, stoaChainAccounts]);
  const paymentKeyInfo = useMemo(() => classifyPaymentKey(paymentKeyAddr), [paymentKeyAddr]);
  const paymentPubKey = paymentKeyInfo?.pubkey ?? "";
  const paymentKeyIsK = paymentKeyInfo?.type === "k-account";
  const paymentKeyInCodex = paymentKeyIsK && (codexPubs.has(paymentPubKey) || !!resolvedManualKeys[paymentPubKey]);
  // Compare as guaranteed-finite numbers. paymentKeyBal/stoaCost should already
  // be numbers, but coerce defensively so no Pact-decimal representation
  // (`{decimal}`/string) can ever slip through and make a healthy balance
  // string-compare below the cost. Only block on a confidently-known balance.
  const balNum = paymentKeyBal === null ? null : Number(mayComeWithDeimal(paymentKeyBal));
  const costNum = Number(mayComeWithDeimal(stoaCost));
  const insufficientStoa =
    balNum !== null &&
    Number.isFinite(balNum) &&
    Number.isFinite(costNum) &&
    costNum > 0 &&
    balNum < costNum;

  const handleResolveKey = useCallback((pub: string, priv: string) => {
    setResolvedManualKeys((prev) => ({ ...prev, [pub]: priv }));
  }, []);

  // ── Stable callback for AuthPathZone (Smart accounts only) ──
  const handleAuthPathChange = useCallback((sel: AuthPathSelection) => {
    setAuthSelection(sel);
  }, []);

  const blockerReason = (() => {
    if (isProcessing)                                   return null;
    if (glyphCount === 0)                               return "Enter a StoicTag";
    if (loadingInfo || info === null)                   return "Loading function info…";
    if (!patronAccount)                                 return "Pick a patron";
    if (loadingPK)                                      return "Loading payment key…";
    if (!paymentKeyIsK)                                 return "Payment key not a k: account";
    if (!paymentKeyInCodex)                             return "Payment key not in Codex";
    if (insufficientStoa)                               return "Insufficient STOA";
    if (insufficientIgnis)                              return "Insufficient IGNIS";
    if (receivers.length === 0 || amounts.length === 0) return "No split returned by INFO";
    // Smart-account auth-path blockers (Standard accounts skip these entirely
    // — their account guard is used directly).
    if (isSmart) {
      if (!accountGuardLoaded)             return "Resolving account guard…";
      if (!sovereignLoaded)                return "Loading sovereign guard…";
      if (authSelection.impossibleViaZbom) return "No key-based auth path — use Execute Code";
      if (!authSelection.chosenKeyset)     return "Pick an auth path";
      if (!authSelection.satisfied)        return "Auth path needs more keys";
    }
    return null;
  })();
  const canExecute = blockerReason === null && !isProcessing;

  const patronGuard = useMemo<IKeyset | null>(() => ((patronAccount?.guard as any) ?? null), [patronAccount]);
  const accountGuard = (account.guard as any) ?? null;

  async function handleExecute() {
    if (!canExecute || !patronAccount || !paymentKeyAddr || !patronGuard) return;
    // Smart accounts resolve their OR-of-3 in the AuthPathZone; without a
    // chosen key-based branch there is nothing to sign with.
    if (isSmart && !authSelection.chosenKeyset) return;
    setIsProcessing(true);
    const _tx = txPending("Register StoicTag");
    try {
      if (!(await ensureCodexUnlocked())) { _tx.fail("Authentication required"); return; }

      // Pre-resolve the patron's payment key — strategy treats it as the
      // coin.TRANSFER spender (extraSigner), not a guard key.
      const raw = await getStoaChainKeyPairsByPublicKey(paymentPubKey).catch(async () => {
        const priv = resolvedManualKeys[paymentPubKey];
        return priv ? { publicKey: paymentPubKey, privateKey: priv } : null;
      });
      if (!raw) throw new Error("Payment key not found in Codex");
      const paymentKP: IStoaChainKeypair = {
        publicKey:          raw.publicKey,
        privateKey:         raw.privateKey,
        seedType:           (raw as any).seedType,
        encryptedSecretKey: (raw as any).encryptedSecretKey,
        password:           (raw as any).password,
      };

      const pactCode = buildRegisterStoicTagPactCode({
        patron:         patronAccount.address,
        tagName,
        accountAddress: account.address,
      });

      // Smart accounts (Σ.) pass the AuthPathZone-resolved branch keyset;
      // Standard accounts (Ѻ.) pass their own guard directly — unchanged.
      const accountAuthGuard = isSmart ? authSelection.chosenKeyset : accountGuard;

      const { requestKey } = await execute({
        build: ({ gasLimit, capsKeyPub, guardPubs }: { gasLimit: number; capsKeyPub: string; guardPubs: string[] }) => {
          let builder = Pact.builder
            .execution(pactCode)
            .setMeta({
              senderAccount: STOA_AUTONOMIC_OURONETGASSTATION,
              creationTime:  safeCreationTime(),
              chainId:       STOACHAIN_CHAIN_ID,
              gasLimit,
            })
            .setNetworkId(STOACHAIN_NETWORK)
            .addSigner(capsKeyPub, (w: any) => [
              w(`${STOACHAIN_NAMESPACE}.DALOS.GAS_PAYER`, "", { int: 0 }, { decimal: "0.0" }),
            ])
            // Patron's payment key: one coin.TRANSFER per protocol split receiver
            // (amounts are the on-chain, discount-applied kadena-split).
            .addSigner(paymentKP.publicKey, (w: any) =>
              receivers.map((receiver, i) =>
                w("coin.TRANSFER", paymentKeyAddr, receiver, { decimal: String(mayComeWithDeimal(amounts[i])) }),
              ),
            );
          for (const gp of guardPubs) builder = (builder as any).addSigner(gp);
          return (builder as any).createTransaction();
        },
        // Tagged account's guard proves ownership; patron alongside. For
        // Smart accounts this is the chosen enforce-one branch keyset.
        guards: [patronGuard, accountAuthGuard],
        paymentKey: paymentKP.publicKey,
        resolvedForeignKeys: resolvedManualKeys,
        extraSigners: [paymentKP],
      } as any);

      _tx.submitted(requestKey);
      onClose();
    } catch (e: any) {
      console.error("[RegisterStoicTag handleExecute]", e);
      _tx.fail(e?.message ?? "Failed");
    } finally {
      setIsProcessing(false);
    }
  }

  if (!open) return null;

  const displayAccountName = accounts.indexOf(account) === 0 ? "CodexPrime" : account.name || account.address?.slice(0, 20) + "…";

  return (
    <ZbomModalFrame onClose={onClose} width={720}>
      <ZbomLayout
        header={
          <>
            <div className="flex items-center gap-2">
              <Tag className="h-5 w-5" style={{ color: "#4ade80" }} />
              <h2 className="text-lg font-bold" style={{ color: "#d2d3d4" }}>Add StoicTag</h2>
              <InfoTooltip content="Registers a StoicTag (a human-readable alias) for this Ouronet account. Costs native STOA — paid by the patron's payment key, split across the protocol, less the account's Elite-tier discount (all amounts come from the chain). The account's guard signs for ownership." />
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs" style={{ color: "#888" }}>Account:</span>
              <span className="text-xs font-mono font-bold" style={{ color: "#4ade80" }}>{displayAccountName}</span>
            </div>
          </>
        }
        executeButton={{
          canExecute,
          isProcessing,
          onClick: handleExecute,
          bgColor: (insufficientStoa || insufficientIgnis) ? "#c0392b" : canExecute ? "#4ade80" : "#262626",
          textColor: (insufficientStoa || insufficientIgnis) ? "#fff" : canExecute ? "#0a0a0a" : "#888",
          content: canExecute
            ? (<><Tag className="inline h-4 w-4 mr-1.5 align-text-bottom" />Register StoicTag</>)
            : (blockerReason ?? "Register StoicTag"),
          processingContent: (<><Loader2 className="inline h-4 w-4 mr-2 animate-spin" />Processing…</>),
        }}
      >
        {/* ── Zone 0 — Function Info ── */}
        <FunctionInfoZone
          key={(patronAccount?.address ?? "") + tagName}
          readId="INFO_RegisterStoicTag"
          label="CODEX.CODEX|INFO_RegisterStoicTag"
          pactCall={`(ouronet-ns.CODEX.CODEX|INFO_RegisterStoicTag "${(patronAccount?.address ?? "").slice(0, 16)}…" "§${tagName.slice(0, 12)}${tagName.length > 12 ? "…" : ""}" "${account.address.slice(0, 16)}…")`}
          fetcher={async () => (tagName ? (await getRegisterStoicTagInfo(patronAccount?.address ?? "", tagName, account.address))?.info ?? null : null)}
        />

        {/* ── Zone 1 — Patron ── */}
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

        {/* ── Zone 2 — Inputs ── */}
        {(() => {
          const tagRow = (
            <div className="space-y-2">
              {/* Label + glyph counter */}
              <div className="flex items-center justify-between">
                <span style={{ fontFamily: "'Cinzel', serif", fontSize: "10px", fontWeight: 600, color: "#16a34a", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                  Claim Your StoicTag
                </span>
                <span className="inline-flex items-center gap-2 text-[10px]" style={{ color: "#555" }}>
                  <span>{glyphCount} / {MAX_STOIC_TAG_GLYPHS} glyphs</span>
                  {glyphCount > 0 && (
                    <button type="button" onClick={() => setTagName("")} className="inline-flex items-center gap-1" style={{ color: "#888" }}>
                      <Trash2 style={{ width: 10, height: 10 }} /> Clear
                    </button>
                  )}
                </span>
              </div>
              {/* Inscription-style input — fixed § + Cinzel green glow */}
              <div
                className="flex items-center rounded-xl overflow-hidden"
                style={{ backgroundColor: "#060608", border: "1px solid #16a34a55", boxShadow: "inset 0 0 22px rgba(22,163,74,0.10)" }}
              >
                <span
                  aria-hidden
                  style={{ fontFamily: "'Cinzel', serif", fontWeight: 700, fontSize: "24px", lineHeight: 1, color: "#7ef0a3", textShadow: "0 0 14px rgba(74,222,128,0.6)", padding: "0 4px 0 13px", userSelect: "none", flexShrink: 0 }}
                >
                  §
                </span>
                <input
                  value={tagName}
                  onChange={(e) => setTagName(filterToDalosGlyphs(e.target.value))}
                  placeholder="type your StoicTag…"
                  spellCheck={false}
                  autoFocus
                  className="flex-1 min-w-0 bg-transparent outline-none"
                  style={{ fontFamily: "'Cinzel', serif", fontSize: "19px", fontWeight: 600, color: "#7ef0a3", padding: "12px 14px 12px 2px", textShadow: "0 0 9px rgba(74,222,128,0.35)", letterSpacing: "0.01em" }}
                />
              </div>
              {/* Live "preview of things to come" — exactly the Dashboard rendering */}
              {glyphCount > 0 && (
                <div>
                  <p className="text-center" style={{ fontFamily: "'Cinzel', serif", fontSize: "8px", fontWeight: 600, color: "#16a34a", textTransform: "uppercase", letterSpacing: "0.14em", marginBottom: "3px" }}>
                    Preview · how it will appear on your Dashboard
                  </p>
                  <StoicTagDisplay tag={tagName} hideCopy />
                </div>
              )}
              {/* STOA cost */}
              <div className="flex items-center justify-between rounded-lg border p-2.5" style={{ borderColor: "#16a34a30", backgroundColor: "#08120c" }}>
                <span className="text-xs" style={{ color: "#888" }}>Cost (native STOA, Elite-tier discounted):</span>
                <span className="text-sm font-bold font-mono" style={{ color: insufficientStoa ? "#c0392b" : "#4ade80" }}>
                  {loadingInfo || info === null ? "…" : `${stoaCost} STOA`}
                </span>
              </div>
              {/* Payment key */}
              <div className="rounded-lg border p-2.5" style={{ borderColor: "#262626", backgroundColor: "#0a0a0a" }}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] uppercase tracking-wider" style={{ color: "#888" }}>Patron payment key</span>
                  <span className="text-[10px] font-mono" style={{ color: insufficientStoa ? "#c0392b" : "#888" }}>
                    {loadingPK ? "…" : paymentKeyBal !== null ? `${paymentKeyBal} STOA` : ""}
                  </span>
                </div>
                <code className="block text-[11px] font-mono break-all" style={{ color: paymentKeyIsK ? "#ceac5f" : "#c0392b" }}>
                  {paymentKeyAddr || (loadingPK ? "…" : "—")}
                </code>
                {paymentKeyAddr && !paymentKeyIsK && (
                  <p className="mt-1 flex items-start gap-1 text-[10px]" style={{ color: "#c0392b" }}>
                    <AlertTriangle className="h-3 w-3 mt-0.5 flex-shrink-0" /> Non-k: payment key — use the Ouronet console.
                  </p>
                )}
                {paymentKeyIsK && !paymentKeyInCodex && paymentPubKey && (
                  <div className="mt-2">
                    <PaymentKeyInput pubkey={paymentPubKey} resolved={resolvedManualKeys} onResolve={handleResolveKey} />
                  </div>
                )}
              </div>
            </div>
          );

          return (
            <Zone2Wrapper
              functionName="ouronet-ns.TS01-C4.CODEX|C_RegisterStoicTag"
              functionMeta={{
                locations:      ["Settings -> Ouronet Account -> StoicTag -> Add StoicTag"],
                name:           "Add StoicTag",
                description:    "Registers a StoicTag for an Ouronet account. Costs native STOA (1 per glyph, less Elite-tier discount), paid by the patron's payment key and split across protocol receivers.",
                icon:           "tag",
                addedInVersion: "1.2.5",
                addedDate:      "2026-05-30",
              }}
              collapsedContent={tagRow}
            >
              <StringEntryInput variant="autonomous" labelIndex={1} varName="patron" value={patronAccount?.address ?? ""} />
              <StringEntryInput variant="autonomous" labelIndex={3} varName="account" value={account.address} />
              {tagRow}
            </Zone2Wrapper>
          );
        })()}

        {/* ── Auth Path — Smart Account key-based branch picker (Σ. only) ── */}
        {isSmart && (
          <AuthPathZone
            accountGuard={isSmart ? resolvedAccountGuard : account.guard}
            sovereignGuard={sovereignGuard}
            sovereignLoaded={sovereignLoaded}
            onChange={handleAuthPathChange}
          />
        )}

        {/* ── Zone 3 — Signing ── */}
        <SigningZone
          patronAccount={patronAccount}
          accountAccount={isSmart ? null : account}
          additionalGuards={
            isSmart && authSelection.chosenKeyset
              ? [{
                  label: `Account auth — ${authSelection.branch === "sovereign" ? "Sovereign Guard" : "Account Guard"}`,
                  guard: authSelection.chosenKeyset,
                }]
              : undefined
          }
          stoaChainNeed={stoaCost}
          stoaChainReceivers={receivers}
          stoaChainAmounts={amounts.map((a) => String(mayComeWithDeimal(a)))}
        />
      </ZbomLayout>
    </ZbomModalFrame>
  );
}
