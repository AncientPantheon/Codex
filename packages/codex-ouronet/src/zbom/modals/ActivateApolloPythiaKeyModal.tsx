/**
 * ActivateApolloPythiaKeyModal — "Activate as {Standard|Smart} Pythia Key".
 *
 * Deploys an Apollo account (₱./Π.) on-chain as a Pythia API key via the LIVE
 * `ouronet-ns.TS01-C4.PYTHIA|C_DeployApiKey` — ONE ungated function for both
 * forms (4 args, no consumer-lane; the user inputs nothing). The account row's
 * `counterpart` field is set to the sentinel `BAR`; the LINK (pairing) is a
 * later, Pythia-mediated step. Registration charges native STOA (from INFO).
 *
 * ZBOM/CFM flow cloned from RegisterStoicTagModal. The deploy/INFO builders live
 * locally in `../pythia/deployApiKey.js`. HARD RULE: the Apollo SEED never leaves
 * the Codex — only the public key travels.
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import { Pact } from "@stoachain/kadena-stoic-legacy/client";
import { ZbomModalFrame } from "../ui/ZbomModalFrame.js";
import { InfoTooltip } from "../ui/InfoTooltip.js";
import { useGetKeypair } from "../../hooks/index.js";
import { useActiveWallet } from "../../hooks/index.js";
import { usePatronSelectionDefaults } from "../patron/usePatronSelectionDefaults.js";
import { txPending } from "../toast/toastManager.js";
import { KeyRound, Loader2, AlertTriangle } from "lucide-react";
import { getIgnisBalance, getStoaChainAccountGuard } from "../debouncer/monitoredReads.js";
import { getWrapperPaymentKey, getPaymentKeyBalance } from "@stoachain/ouronet-core/interactions/wrapFunctions";
import { KADENA_CHAIN_ID as STOACHAIN_CHAIN_ID, KADENA_NETWORK as STOACHAIN_NETWORK } from "@stoachain/stoa-core/constants";
import {
  KADENA_NAMESPACE as STOACHAIN_NAMESPACE,
  STOA_AUTONOMIC_OURONETGASSTATION,
} from "@stoachain/ouronet-core/constants";
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
import { PaymentKeyInput } from "../ui/ManualKeyInput.js";
import { IconCopyBtn } from "../../ui/internal/IconButtons.js";
import { detectOriginCurve } from "../../ui/internal/originCurve.js";
import { useSignTransaction } from "../../hooks/index.js";
import { useEnsureCodexUnlocked } from "../hooks/useEnsureCodexUnlocked.js";
import {
  getDeployApiKeyInfo,
  getDeployApiKeyInfoOnly,
  buildDeployApiKeyPactCode,
} from "../pythia/deployApiKey.js";

const MONO = "var(--codex-font-mono, 'JetBrains Mono', ui-monospace, monospace)";

function toNum(v: any): number {
  if (v === null || v === undefined) return 0;
  const raw = mayComeWithDeimal(v);
  return typeof raw === "number" ? raw : parseFloat(String(raw)) || 0;
}

type PatronMode = "prime" | "resident" | "custom";

interface Props {
  open: boolean;
  onClose: () => void;
  /** The Apollo account (₱./Π.) being deployed as a Pythia key. */
  account: IOuroAccount;
  accounts: IOuroAccount[];
  kadenaSeeds: IStoaChainSeed[];
  stoaChainAccounts: IStoaChainWallet[];
}

export default function ActivateApolloPythiaKeyModal({
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

  // Standard ₱. / Smart Π. — same ungated deploy; only labelling/accent differ.
  const isSmart = account.isSmart === true;
  const accent = isSmart ? "#a01b3f" : "#f97316";
  const formLabel = isSmart ? "Smart" : "Standard";

  // owner-account: the globally-SELECTED Ouronet account (chosen in the list via
  // the ⊗ icon). Its guard is enforced on-chain. Must be an activated, non-Apollo
  // account (an Apollo key cannot own itself).
  const { activeOuroAccount } = useActiveWallet();
  // Owner = the selected non-Apollo Ouronet account. We DON'T gate on the local
  // `isActive` flag (a freshly-loaded codex preselects CodexPrime without it) —
  // whether the account is usable is decided by its on-chain guard resolving
  // below (the "Owner ownership guard unavailable" blocker catches an account
  // that has no on-chain guard).
  const ownerAccount = useMemo<IOuroAccount | null>(
    () =>
      activeOuroAccount && detectOriginCurve(activeOuroAccount) !== "apollo"
        ? activeOuroAccount
        : null,
    [activeOuroAccount],
  );

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

  // Owner-account guard, resolved from chain (stored guard is often null/an
  // unresolved keyset-ref, which can't be signed).
  const [resolvedOwnerGuard, setResolvedOwnerGuard] = useState<{ keys: string[]; pred: string } | null>(null);
  const [ownerGuardLoaded, setOwnerGuardLoaded] = useState(false);

  // Patron ACCOUNT guard (its dead-hand keyset) — the key that spends the payment
  // key, resolved from the DALOS account (NOT the raw k: payment address).
  const [patronPaymentGuard, setPatronPaymentGuard] = useState<{ keys: string[]; pred: string } | null>(null);
  const [patronPaymentGuardLoaded, setPatronPaymentGuardLoaded] = useState(false);

  const primeAccount = accounts[0] ?? null;
  const patronAccount = useMemo<IOuroAccount | null>(() => {
    if (patronMode === "prime")    return primeAccount;
    if (patronMode === "resident") return ownerAccount;
    return selectedCustomAccount ?? primeAccount;
  }, [patronMode, selectedCustomAccount, primeAccount, ownerAccount]);

  // The 4 INFO/deploy args (patron varies; owner + apollo + public are fixed).
  const deployArgs = useMemo(
    () => ({
      patron: patronAccount?.address ?? "",
      ownerAccount: ownerAccount?.address ?? "",
      apolloAccount: account.address,
      publicKey: account.publicKey,
    }),
    [patronAccount?.address, ownerAccount?.address, account.address, account.publicKey],
  );

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
    if (!open || !deployArgs.patron || !deployArgs.ownerAccount) {
      setFullInfo(null);
      return;
    }
    setLoadingInfo(true);
    setFullInfo(null);
    let aborted = false;
    const t = setTimeout(() => {
      getDeployApiKeyInfo(deployArgs)
        .then((r) => { if (!aborted) setFullInfo(r); })
        .catch(() => { if (!aborted) setFullInfo(null); })
        .finally(() => { if (!aborted) setLoadingInfo(false); });
    }, 450);
    return () => { aborted = true; clearTimeout(t); };
  }, [open, deployArgs]);

  // ── Resolve the owner account's guard from chain ──
  useEffect(() => {
    if (!open || !ownerAccount?.address) { setResolvedOwnerGuard(null); setOwnerGuardLoaded(false); return; }
    setResolvedOwnerGuard(null);
    setOwnerGuardLoaded(false);
    let aborted = false;
    getStoaChainAccountGuard(ownerAccount.address)
      .then((g) => { if (!aborted) setResolvedOwnerGuard((g as any) ?? null); })
      .catch(() => { if (!aborted) setResolvedOwnerGuard(null); })
      .finally(() => { if (!aborted) setOwnerGuardLoaded(true); });
    return () => { aborted = true; };
  }, [open, ownerAccount?.address]);

  // ── Resolve the patron ACCOUNT's on-chain guard (its dead-hand keyset) ──
  useEffect(() => {
    if (!open || !patronAccount?.address) {
      setPatronPaymentGuard(null); setPatronPaymentGuardLoaded(false); return;
    }
    setPatronPaymentGuard(null);
    setPatronPaymentGuardLoaded(false);
    let aborted = false;
    getStoaChainAccountGuard(patronAccount.address)
      .then((g) => { if (!aborted) setPatronPaymentGuard((g as any) ?? null); })
      .catch(() => { if (!aborted) setPatronPaymentGuard(null); })
      .finally(() => { if (!aborted) setPatronPaymentGuardLoaded(true); });
    return () => { aborted = true; };
  }, [open, patronAccount?.address]);

  // ── Reset on open ──
  useEffect(() => {
    if (!open) return;
    setPatronMode(initialPatronMode);
    setSelectedCustomAccount(null);
    setPatronIgnisBalance(null);
    setPaymentKeyAddr(null);
    setPaymentKeyBal(null);
    setFullInfo(null);
    setLoadingInfo(false);
    setResolvedManualKeys({});
    setIsProcessing(false);
    setResolvedOwnerGuard(null);
    setOwnerGuardLoaded(false);
    setPatronPaymentGuard(null);
    setPatronPaymentGuardLoaded(false);
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
  const paymentPubKey = paymentKeyInfo?.pubkey ?? "";       // the k: ADDRESS key (often NOT the signer)
  const paymentKeyIsK = paymentKeyInfo?.type === "k-account";
  // The key that signs the coin.TRANSFER FROM the payment account. A plain k:
  // account is guarded by its OWN pubkey — prefer the address key (which the
  // Codex holds). Only fall back to a separate keyset for a genuinely dead-hand
  // payment account. Using the address key keeps the coin.TRANSFER signer
  // DISTINCT from the owner's ownership guard, so one key never has to satisfy
  // both a scoped cap AND a bare enforce-keyset.
  const paymentSignerPub = useMemo(() => {
    if (paymentPubKey && (codexPubs.has(paymentPubKey) || !!resolvedManualKeys[paymentPubKey])) return paymentPubKey;
    const gkeys = patronPaymentGuard?.keys ?? [];
    return gkeys.find((k) => codexPubs.has(k) || !!resolvedManualKeys[k]) ?? "";
  }, [paymentPubKey, codexPubs, resolvedManualKeys, patronPaymentGuard]);
  const paymentKeyInCodex = paymentKeyIsK && !!paymentSignerPub;
  const balNum = paymentKeyBal === null ? null : Number(mayComeWithDeimal(paymentKeyBal));
  const costNum = Number(mayComeWithDeimal(stoaCost));
  const insufficientStoa =
    balNum !== null && Number.isFinite(balNum) && Number.isFinite(costNum) && costNum > 0 && balNum < costNum;

  const handleResolveKey = useCallback((pub: string, priv: string) => {
    setResolvedManualKeys((prev) => ({ ...prev, [pub]: priv }));
  }, []);

  const ownerGuard = (ownerAccount?.guard as any) ?? null;
  // Ownership guard actually attached to the tx: prefer the chain-resolved guard.
  const ownershipGuard: IKeyset | null = ((resolvedOwnerGuard as any) ?? ownerGuard) ?? null;
  const ownershipReady = !!(ownershipGuard && (ownershipGuard as any).keys?.length);

  const blockerReason = (() => {
    if (isProcessing)                                   return null;
    if (!ownerAccount)                                  return "Select an Ouronet account in the list first";
    if (loadingInfo || info === null)                   return "Loading function info…";
    if (!patronAccount)                                 return "Pick a patron";
    if (loadingPK)                                      return "Loading payment key…";
    if (!paymentKeyIsK)                                 return "Payment key not a k: account";
    if (!patronPaymentGuardLoaded)                      return "Resolving payment guard…";
    if (!paymentKeyInCodex)                             return "Payment key not signable by Codex";
    if (insufficientStoa)                               return "Insufficient STOA";
    if (insufficientIgnis)                              return "Insufficient IGNIS";
    if (receivers.length === 0 || amounts.length === 0) return "No split returned by INFO";
    if (!ownerGuardLoaded)                              return "Resolving owner guard…";
    if (!ownershipReady)                                return "Owner ownership guard unavailable";
    return null;
  })();
  const canExecute = blockerReason === null && !isProcessing;

  async function handleExecute() {
    if (!canExecute || !patronAccount || !paymentKeyAddr || !paymentSignerPub || !ownerAccount) return;
    setIsProcessing(true);
    const _tx = txPending(`Deploy ${formLabel} Pythia Key`);
    try {
      if (!(await ensureCodexUnlocked())) { _tx.fail("Authentication required"); return; }

      // Sign the payment with the key the Codex holds from the payment account's
      // dead-hand keyset (paymentSignerPub), NOT the k: address key.
      if (!paymentSignerPub) throw new Error("No signable payment key resolved");
      let raw: any = null;
      try {
        raw = await getStoaChainKeyPairsByPublicKey(paymentSignerPub);
      } catch (err) {
        const priv = resolvedManualKeys[paymentSignerPub];
        if (priv) {
          raw = { publicKey: paymentSignerPub, privateKey: priv };
        } else {
          const locked = (err as any)?.name === "CodexLockedError";
          console.error("[ActivateApolloPythiaKey] payment-key resolve failed", {
            paymentSignerPub, paymentKeyAddr, patron: patronAccount.address,
            paymentGuard: patronPaymentGuard, inCodexPubSet: codexPubs.has(paymentSignerPub), error: err,
          });
          throw new Error(
            locked
              ? "Codex is locked — unlock and retry."
              : `Payment key ${paymentSignerPub.slice(0, 12)}… (from the payment account's keyset) ` +
                `is not signable by this Codex (${(err as any)?.message ?? "key missing"}). Pick a patron ` +
                `whose payment keyset you hold.`,
          );
        }
      }
      if (!raw) throw new Error("Payment key not found in Codex");
      const paymentKP: IStoaChainKeypair = {
        publicKey:          raw.publicKey,
        privateKey:         raw.privateKey,
        seedType:           (raw as any).seedType,
        encryptedSecretKey: (raw as any).encryptedSecretKey,
        password:           (raw as any).password,
      };

      const pactCode = buildDeployApiKeyPactCode(deployArgs);

      // Pure signers: patron payment-account guard (dead-hand keyset) + owner
      // ownership guard. The payment signer also carries coin.TRANSFER caps.
      const guards = [patronPaymentGuard, ownershipGuard].filter(Boolean);

      console.log("[ActivateApolloPythiaKey] signing setup", {
        isSmart,
        patron: patronAccount.address,
        owner: ownerAccount.address,
        apollo: account.address,
        paymentKeyAddr,
        paymentSignerPub,
        patronPaymentGuard,
        ownershipGuard,
        guardCount: guards.length,
        receivers,
        amounts,
      });

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
            .addSigner(paymentKP.publicKey, (w: any) =>
              receivers.map((receiver, i) =>
                w("coin.TRANSFER", paymentKeyAddr, receiver, { decimal: String(mayComeWithDeimal(amounts[i])) }),
              ),
            );
          // Each pubkey must be a signer EXACTLY ONCE. When the payment signer
          // (dead-hand keyset key) is ALSO a guard key — which happens when the
          // patron/owner account shares the payment account's dh_<tag>-keyset
          // (the same 0ddd… key signs coin.TRANSFER AND the ownership keyset) —
          // adding it a second time here produces a duplicate signer entry that
          // the on-chain enforce-keyset stops counting → "Keyset failure
          // (keys-all)". So skip any guard pub already added above.
          const alreadySigned = new Set<string>([capsKeyPub, paymentKP.publicKey]);
          for (const gp of guardPubs) {
            if (alreadySigned.has(gp)) continue;
            alreadySigned.add(gp);
            builder = (builder as any).addSigner(gp);
          }
          console.log("[ActivateApolloPythiaKey] tx signers", {
            capsKeyPub, paymentSigner: paymentKP.publicKey, guardPubs,
            finalSigners: [...alreadySigned],
          });
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
      console.error("[ActivateApolloPythiaKey handleExecute]", e);
      _tx.fail(e?.message ?? "Failed");
    } finally {
      setIsProcessing(false);
    }
  }

  if (!open) return null;

  const apolloName = account.name || (isSmart ? "Smart Apollo (Π.)" : "Standard Apollo (₱.)");

  const label = (text: string) => (
    <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "#555" }}>{text}</span>
  );

  // Zone 2 collapsed content — the owner/cost/payment info + the "bake this" key.
  const inputsBlock = (
    <div className="space-y-2">
      {/* Apollo public key to bake */}
      <div>
        {label("Apollo public key (bake this into your consumer build)")}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 4, padding: 10, borderRadius: 8, border: "1px solid #262626", backgroundColor: "#0a0a0a" }}>
          <code style={{ fontFamily: MONO, fontSize: 11, wordBreak: "break-all", flex: 1, color: "#c0c0c0" }}>{account.publicKey}</code>
          <IconCopyBtn text={account.publicKey} size={28} />
        </div>
      </div>

      {/* Owner-account — the globally-selected ("current") Ouronet account. */}
      <div className="rounded-lg border p-2.5" style={{ borderColor: ownerAccount ? "#262626" : `${accent}40`, backgroundColor: "#0a0a0a" }}>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] uppercase tracking-wider" style={{ color: "#888" }}>Owner account (guard signs)</span>
          <InfoTooltip content="The selected/active Ouronet (DALOS) account that owns this Apollo key — its guard signs to prove ownership on-chain. Select it in the account list with the ⊗ icon (activated non-Apollo accounts only)." />
        </div>
        {ownerAccount ? (
          <span className="text-xs font-mono font-bold" style={{ color: "#ceac5f" }}>
            {accounts.indexOf(ownerAccount) === 0 ? "CodexPrime" : ownerAccount.name || (ownerAccount.address?.slice(0, 28) + "…")}
          </span>
        ) : (
          <p className="text-[11px]" style={{ margin: 0, color: "#f0a978" }}>
            No Ouronet account selected. Close this, then click the ⊗ icon on an activated Ouronet account in the list to make it the owner.
          </p>
        )}
      </div>

      {/* STOA cost */}
      <div className="flex items-center justify-between rounded-lg border p-2.5" style={{ borderColor: `${accent}30`, backgroundColor: "#0a0a0a" }}>
        <span className="text-xs" style={{ color: "#888" }}>Cost (native STOA, from INFO):</span>
        <span className="text-sm font-bold font-mono" style={{ color: insufficientStoa ? "#c0392b" : accent }}>
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
    <ZbomModalFrame onClose={onClose} width={720}>
      <ZbomLayout
        header={
          <>
            <div className="flex items-center gap-2">
              <KeyRound className="h-5 w-5" style={{ color: accent }} />
              <h2 className="text-lg font-bold" style={{ color: "#d2d3d4" }}>Activate as {formLabel} Pythia Key</h2>
              <InfoTooltip content="Deploys this Apollo public key on-chain as a Pythia API key (charges native STOA, paid by the patron and split across the protocol). One ungated function for both forms. The pairing (link) is a later, Pythia-mediated step; the Apollo seed never leaves the Codex." />
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs" style={{ color: "#888" }}>Apollo:</span>
              <span className="text-xs font-mono font-bold" style={{ color: accent }}>{apolloName}</span>
            </div>
          </>
        }
        executeButton={{
          canExecute,
          isProcessing,
          onClick: handleExecute,
          bgColor: (insufficientStoa || insufficientIgnis) ? "#c0392b" : canExecute ? accent : "#262626",
          textColor: (insufficientStoa || insufficientIgnis) ? "#fff" : canExecute ? "#0a0a0a" : "#888",
          content: canExecute
            ? (<><KeyRound className="inline h-4 w-4 mr-1.5 align-text-bottom" />Deploy + Pay</>)
            : (blockerReason ?? "Deploy + Pay"),
          processingContent: (<><Loader2 className="inline h-4 w-4 mr-2 animate-spin" />Processing…</>),
        }}
      >
        {/* ── Zone 0 — Function Info ── */}
        <FunctionInfoZone
          key={patronAccount?.address ?? ""}
          readId="INFO_DeployApiKey"
          label="PYTHIA.PYTHIA|INFO_DeployApiKey"
          pactCall={`(ouronet-ns.PYTHIA.PYTHIA|INFO_DeployApiKey "${(patronAccount?.address ?? "").slice(0, 14)}…" "${(ownerAccount?.address ?? "").slice(0, 14)}…" "${account.address.slice(0, 14)}…" "${account.publicKey.slice(0, 12)}…")`}
          fetcher={async () => await getDeployApiKeyInfoOnly(deployArgs)}
        />

        {/* ── Zone 1 — Patron ── */}
        <PatronZonePattern2
          patronMode={patronMode}
          onPatronModeChange={setPatronMode}
          primeAccount={primeAccount}
          residentAccount={ownerAccount}
          codexAccounts={accounts}
          selectedCustomAccount={selectedCustomAccount}
          onSelectCustomAccount={setSelectedCustomAccount}
          ignisCost={ignisCost}
          virtualToggleActive={virtualToggleActive}
          patronIgnisBalance={patronIgnisBalance}
          loading={loadingInfo}
          autoSelectBestPatron={autoSelectBestPatron}
        />

        {/* ── Zone 2 — Inputs (4 args, all autonomous — user inputs nothing) ── */}
        <Zone2Wrapper
          functionName="ouronet-ns.TS01-C4.PYTHIA|C_DeployApiKey"
          functionMeta={{
            locations:      ["Ouronet Account -> Apollo -> Activate as Pythia Key"],
            name:           "Deploy Pythia API Key",
            description:    "Deploys an Apollo public key on-chain as a Pythia API key (both forms, ungated). Costs native STOA (from INFO), paid by the patron. The counterpart field starts BAR; pairing is a later Pythia-mediated step.",
            icon:           "key-round",
            addedInVersion: "0.6.0",
            addedDate:      "2026-07-10",
          }}
          collapsedContent={inputsBlock}
        >
          <StringEntryInput variant="autonomous" labelIndex={1} varName="patron" value={patronAccount?.address ?? ""} />
          <StringEntryInput variant="autonomous" labelIndex={2} varName="owner-account" value={ownerAccount?.address ?? ""} />
          <StringEntryInput variant="autonomous" labelIndex={3} varName="apollo-account" value={account.address} />
          <StringEntryInput variant="autonomous" labelIndex={4} varName="public" value={account.publicKey} />
          {inputsBlock}
        </Zone2Wrapper>

        {/* ── Zone 3 — Signing ── patron payment guard (as patronAccount) + owner
            ownership guard (explicit, chain-resolved so it always shows). ── */}
        <SigningZone
          patronAccount={patronAccount ? ({ ...patronAccount, guard: (patronPaymentGuard ?? patronAccount.guard) } as any) : null}
          accountAccount={null}
          additionalGuards={
            ownershipGuard
              ? [{
                  label: `Owner ownership — ${ownerAccount ? (accounts.indexOf(ownerAccount) === 0 ? "CodexPrime" : ownerAccount.name || ownerAccount.address?.slice(0, 14) + "…") : ""}`,
                  guard: ownershipGuard as any,
                }]
              : []
          }
          stoaChainNeed={stoaCost}
          stoaChainReceivers={receivers}
          stoaChainAmounts={amounts.map((a) => String(mayComeWithDeimal(a)))}
        />
      </ZbomLayout>
    </ZbomModalFrame>
  );
}
