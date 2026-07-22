/**
 * ActivateStandardAccountModal — CFM Architecture v2
 *
 * Patronless function — no Patron zone.
 *
 * Zones:
 *   0 — Function Info  → FunctionInfoZone (direct INFO call, no receiver resolution)
 *   1 — Function Inputs:
 *         INPUT I   <account:string>  → StringEntryInput autonomous ALWAYS
 *         INPUT II  <guard:guard>     → GuardEntryInput autonomous (auto ON) / GuardEntryInput free (auto OFF)
 *         INPUT III <kadena:string>   → StringEntryInput autonomous (auto ON) / StringEntryInput free (auto OFF)
 *         INPUT IV  <public:string>   → StringEntryInput autonomous ALWAYS
 *   2 — Signing        → inline (CodexPrime Key #0 dual role)
 *   3 — Actions        → Activate
 *
 * Driven by `useCFMStrategy().execute` — gas-payer key carries
 * `GAS_PAYER` + N `coin.TRANSFER` (one per kadena-split receiver); the
 * new account's keyset guard signs pure. The keyset is also handed to
 * the Pact code via the "ks" data slot.
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import { ZbomModalFrame } from "../ui/ZbomModalFrame.js";
import { InfoTooltip } from "../ui/InfoTooltip.js";
import { Switch } from "../ui/Switch.js";
import { IOuroAccount, IStoaChainSeed, IStoaChainWallet } from "../../types/entities.js";
import { useUiSetting } from "../cfm/seam.js";
import { StoaChainBrand } from "../ui/StoaChainBrand.js";
import { toast } from "sonner";
import { txPending } from "../toast/toastManager.js";
import { ZbomLayout } from "../cfm/ZbomLayout.js";
import {
  getDeployStandardAccountInfoOnly,
  getDeployStandardAccountInfo,
} from "@ouronet/ouronet-core/interactions/activateFunctions";
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Key, Loader2, Zap,
} from "lucide-react";
import { Input } from "../ui/Input.js";
import { FunctionInfoZone } from "../cfm/FunctionInfoZone.js";
import { Zone2Wrapper } from "../cfm/Zone2Wrapper.js";
import { StringEntryInput, GuardEntryInput, type GuardChangeValue } from "../cfm/inputs.js";
import { publicKeyFromPrivateKey, publicKeyFromExtendedKey } from "@stoachain/stoa-core/signing";
import { useSignTransaction } from "../../hooks/index.js";
import { useEnsureCodexUnlocked } from "../hooks/useEnsureCodexUnlocked.js";
import { buildDeployStandardAccountPactCode } from "@ouronet/ouronet-core/pact";
import { safeCreationTime } from "@stoachain/stoa-core/pact";
import { Pact } from "@stoachain/kadena-stoic-legacy/client";
import {
  KADENA_NAMESPACE as STOACHAIN_NAMESPACE,
  STOA_AUTONOMIC_OURONETGASSTATION,
} from "@ouronet/ouronet-core/constants";
import { KADENA_CHAIN_ID as STOACHAIN_CHAIN_ID, KADENA_NETWORK as STOACHAIN_NETWORK } from "@stoachain/stoa-core/constants";

// ─── Zone tokens ──────────────────────────────────────────────────────────────

const ZONE_SIGNING = { bg: "#22c55e0d", border: "#22c55e50", label: "#4ade80" };

// ─── Signing sub-components (specific dual-role logic) ────────────────────────

function SignerRow({ label, pred, found, total, ready, keys }: {
  label: string; pred: string; found: number; total: number; ready: boolean; keys: string[];
}) {
  return (
    <div className="rounded-lg border space-y-1.5 p-2"
      style={{ backgroundColor: "#0a0a0a", borderColor: ready ? "#22c55e30" : "#8b1a1a30" }}>
      <div className="flex items-center gap-2">
        {ready
          ? <CheckCircle2 className="h-4 w-4 flex-shrink-0" style={{ color: "#4ade80" }} />
          : <AlertTriangle className="h-4 w-4 flex-shrink-0" style={{ color: "#c0392b" }} />}
        <span className="text-xs flex-1" style={{ color: "#d2d3d4" }}>{label}</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full"
          style={{ backgroundColor: "#262626", color: "#ceac5f" }}>{pred}</span>
        <span className="text-[10px] font-mono"
          style={{ color: ready ? "#4ade80" : "#c0392b" }}>{found}/{total} in Codex</span>
      </div>
      {keys.map((k, i) => (
        <code key={i} className="block text-[10px] font-mono truncate pl-6" style={{ color: "#555" }}>
          {k.slice(0, 16)}…{k.slice(-8)}
        </code>
      ))}
    </div>
  );
}

function CapRow({ capability, params, signer, signerKey, description }: {
  capability: string; params: string[]; signer: string; signerKey: string; description: string;
}) {
  return (
    <div className="rounded-lg border p-2.5 space-y-1.5"
      style={{ backgroundColor: "#0a0a0a", borderColor: "#22c55e25" }}>
      <div className="flex items-start justify-between gap-2">
        <code className="text-[10px] font-mono font-bold break-all" style={{ color: "#4ade80" }}>{capability}</code>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0 whitespace-nowrap"
          style={{ backgroundColor: "#262626", color: "#888" }}>{signer}</span>
      </div>
      {params.length > 0 && (
        <div className="pl-2 border-l" style={{ borderColor: "#22c55e30" }}>
          <span className="text-[9px] uppercase tracking-wider font-bold mr-1" style={{ color: "#555" }}>params:</span>
          <code className="text-[10px] font-mono" style={{ color: "#888" }}>({params.join(", ")})</code>
        </div>
      )}
      <div className="pl-2 border-l" style={{ borderColor: "#22c55e30" }}>
        <span className="text-[9px] uppercase tracking-wider font-bold mr-1" style={{ color: "#555" }}>signed by:</span>
        <code className="text-[10px] font-mono" style={{ color: "#555" }}>
          {signerKey.length > 20 ? `${signerKey.slice(0, 16)}…${signerKey.slice(-8)}` : signerKey}
        </code>
      </div>
      <p className="text-[10px]" style={{ color: "#555" }}>{description}</p>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function derivePubKey(privHex: string): string | null {
  try {
    if (privHex.length === 128) return publicKeyFromExtendedKey(privHex.slice(0, 64));
    if (privHex.length === 64)  return publicKeyFromPrivateKey(privHex);
    return null;
  } catch { return null; }
}

function findCodexKeys(keys: string[], seeds: IStoaChainSeed[], accs: IStoaChainWallet[]) {
  const all = new Set<string>();
  for (const s of seeds) for (const a of s.accounts) all.add(a.publicKey);
  for (const a of accs) all.add(a.publicKey);
  return { found: keys.filter(k => all.has(k)), missing: keys.filter(k => !all.has(k)) };
}

// ─── CollapsibleZoneHeader ────────────────────────────────────────────────────

function CollapsibleZoneHeader({
  text, color, subLabel, isOpen, onToggle,
}: {
  text: string; color: string; subLabel?: string; isOpen: boolean; onToggle: () => void;
}) {
  const Chevron = isOpen ? ChevronDown : ChevronRight;
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full flex items-center gap-1.5 py-1 text-left"
      style={{ background: "transparent", border: "none", cursor: "pointer" }}
    >
      <Chevron style={{ width: 13, height: 13, color: "#555", flexShrink: 0 }} />
      <span className="text-[10px] font-bold uppercase tracking-widest flex-shrink-0" style={{ color }}>
        {text}
      </span>
      {subLabel && (
        <span className="text-[9px] font-mono truncate" style={{ color: color + "80" }}>
          ({subLabel})
        </span>
      )}
    </button>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  open: boolean; onClose: () => void;
  ouroAccount: IOuroAccount; accounts: IOuroAccount[];
  kadenaSeeds: IStoaChainSeed[]; stoaChainAccounts: IStoaChainWallet[];
}

type SigningTab = "signing" | "caps";

// ─── Component ───────────────────────────────────────────────────────────────

export default function ActivateStandardAccountModal({
  open, onClose, ouroAccount, accounts, kadenaSeeds, stoaChainAccounts,
}: Props) {
  // CodexSigningStrategy — patronless flow. Gas-payer key carries
  // GAS_PAYER + N coin.TRANSFER caps; the new account's guard keyset
  // signs pure (passed via `guards`); the keyset also feeds the Pact
  // code's (read-keyset "ks") via addData on the build closure.
  const { execute } = useSignTransaction();
  const ensureCodexUnlocked = useEnsureCodexUnlocked();

  // ── Zone defaults (consumer uiSettings via seam) ──
  const zone3DefaultOpen = useUiSetting("zbomZone3", false);
  const [zone3Open, setZone3Open] = useState(zone3DefaultOpen);
  useEffect(() => { setZone3Open(zone3DefaultOpen); }, [zone3DefaultOpen]);

  // ── State ──
  const [autoMode,     setAutoMode]     = useState(true);
  const [signingTab,   setSigningTab]   = useState<SigningTab>("signing");
  const [isProcessing, setIsProcessing] = useState(false);

  // Manual guard (auto OFF INPUT II)
  const [guardValue,   setGuardValue]   = useState<GuardChangeValue>(null);

  // Manual kadena address (auto OFF INPUT III)
  const [manualStoaChain, setManualStoaChain] = useState("");

  // Info for receivers + cost checks
  const [fullInfo,    setFullInfo]    = useState<any>(null);
  const [loadingInfo, setLoadingInfo] = useState(false);

  // Manual missing keys
  const [manualKeys,         setManualKeys]         = useState<Record<string, string>>({});
  const [resolvedManualKeys, setResolvedManualKeys] = useState<Record<string, string>>({});

  // ── CodexPrime keys ──
  const primeKey0      = useMemo(() => kadenaSeeds[0]?.accounts?.[0]?.publicKey ?? "", [kadenaSeeds]);
  const primeKey1      = useMemo(() => kadenaSeeds[0]?.accounts?.[1]?.publicKey ?? "", [kadenaSeeds]);
  const autoStoaChainAddr = useMemo(() => primeKey0 ? `k:${primeKey0}` : "", [primeKey0]);
  const autoStoaChainAcc  = useMemo(() => stoaChainAccounts.find(a => a.address === autoStoaChainAddr) ?? null, [stoaChainAccounts, autoStoaChainAddr]);

  // ── Effective values ──
  const effectiveGuardKeys  = autoMode
    ? (primeKey1 ? [primeKey1] : [])
    : (guardValue?.mode === "define" ? guardValue.keys : guardValue?.mode === "existing" ? guardValue.resolvedKeys : []);
  const effectiveGuardPred  = autoMode
    ? "keys-all"
    : (guardValue?.mode === "define" ? guardValue.pred : guardValue?.mode === "existing" ? guardValue.resolvedPred : "keys-all");
  const effectiveStoaChainAddr = autoMode ? autoStoaChainAddr : manualStoaChain.trim();
  const effectiveStoaChain     = autoMode ? autoStoaChainAcc : stoaChainAccounts.find(a => a.address === effectiveStoaChainAddr) ?? null;

  // ── Info fetch (full — for execute) ──
  useEffect(() => {
    if (!open || !ouroAccount?.address) return;
    setFullInfo(null); setLoadingInfo(true);
    getDeployStandardAccountInfo(ouroAccount.address)
      .then(r => { setFullInfo(r); setLoadingInfo(false); });
  }, [open, ouroAccount?.address]);

  const stoaChainNeed = fullInfo?.info?.kadena?.["kadena-full"] ?? 0;
  const receivers  = fullInfo?.receivers ?? [];
  const amounts    = fullInfo?.info?.kadena?.["kadena-split"] ?? [];

  const stoaChainBalance = parseFloat(effectiveStoaChain?.balance ?? "0");
  const hasEnoughStoa = stoaChainBalance >= stoaChainNeed;
  const showStoaWarn  = effectiveStoaChainAddr.length > 0 && !hasEnoughStoa && !!fullInfo;

  // ── Signing analysis (for SigningZone display only — actual signing
  // is routed through strategy.execute) ──
  const guardAnalysis    = useMemo(() => findCodexKeys(effectiveGuardKeys, kadenaSeeds, stoaChainAccounts), [effectiveGuardKeys, kadenaSeeds, stoaChainAccounts]);
  const gasPayerAnalysis = useMemo(() => findCodexKeys(primeKey0 ? [primeKey0] : [], kadenaSeeds, stoaChainAccounts), [primeKey0, kadenaSeeds, stoaChainAccounts]);
  const gasPayerReady    = gasPayerAnalysis.found.length > 0;
  const guardReady       = effectiveGuardKeys.length > 0 && guardAnalysis.found.length >= effectiveGuardKeys.length;

  // ── CAPS ──
  const caps = useMemo(() => [
    {
      capability: "ouronet-ns.DALOS.GAS_PAYER",
      params: [`""`, `{ int: 0 }`, `{ decimal: "0.0" }`],
      signer: "Ouronet GasStation",
      signerKey: primeKey0 || "CodexPrime Key #0",
      description: "Authorises the Ouronet Gas Station to cover StoaChain™ network gas fees.",
    },
    ...receivers.map((receiver: string, i: number) => ({
      capability: "coin.TRANSFER",
      params: [`"${effectiveStoaChainAddr.slice(0, 10)}…"`, `"${receiver.slice(0, 10)}…"`, `{ decimal: "${amounts[i] ?? "?"}" }`],
      signer: "coin.TRANSFER",
      signerKey: primeKey0 || "CodexPrime Key #0",
      description: `Transfers STOA from payment account to protocol receiver ${i + 1}.`,
    })),
  ], [primeKey0, effectiveStoaChainAddr, receivers, amounts]);

  // ── canExecute ──
  const canExecute = useMemo(() => {
    if (isProcessing || loadingInfo) return false;
    if (!effectiveStoaChainAddr) return false;
    if (stoaChainNeed > 0 && !hasEnoughStoa) return false;
    if (!autoMode && !guardValue) return false;
    if (effectiveGuardKeys.length === 0) return false;
    return true;
  }, [isProcessing, loadingInfo, effectiveStoaChainAddr, stoaChainNeed, hasEnoughStoa,
      autoMode, guardValue, effectiveGuardKeys.length]);

  // ── Reset ──
  useEffect(() => {
    if (open) {
      setAutoMode(true); setSigningTab("signing");
      setGuardValue(null); setManualStoaChain("");
      setManualKeys({}); setResolvedManualKeys({}); setIsProcessing(false);
    }
  }, [open]);

  // ── Manual key handler ──
  const handleManualKeyInput = useCallback((pub: string, priv: string) => {
    setManualKeys(prev => ({ ...prev, [pub]: priv }));
    if (priv.length === 64 || priv.length === 128) {
      const derived = derivePubKey(priv);
      if (derived === pub) {
        setResolvedManualKeys(prev => ({ ...prev, [pub]: priv }));
        toast.success("Key matched ✓");
      } else {
        setResolvedManualKeys(prev => { const n = { ...prev }; delete n[pub]; return n; });
      }
    }
  }, []);

  // ── Execute — CodexSigningStrategy with N coin.TRANSFER caps on payer ─────
  // Pact: (ouronet-ns.TS01-C1.DALOS|C_DeployStandardAccount
  //         <account> (read-keyset "ks") <kadena> <public>)
  // Signers:
  //   1. Payer key (CodexPrime Key #0) — GAS_PAYER + N coin.TRANSFER (one
  //      per kadena-split receiver). Driven via paymentKey: primeKey0.
  //   2. Guard keyset (synthetic — { keys, pred }) — pure signers for the
  //      new account's guard. Strategy resolves the codex keys + uses
  //      `resolvedManualKeys` for any foreign ones.
  // Pact-side keyset binding: addData("ks", { keys, pred }) feeds the
  // (read-keyset "ks") site in the pact code.
  const handleExecute = useCallback(async () => {
    if (!canExecute) return;
    if (!primeKey0) { toast.error("[A] CodexPrime Key #0 not found."); return; }
    setIsProcessing(true);
    const _tx = txPending("Activate Account");
    try {
      // Prompt for the codex password if locked; abort on cancel. Without this
      // the resolver throws CodexLockedError mid-sign.
      if (!(await ensureCodexUnlocked())) { _tx.fail("Authentication required"); return; }

      // Preserve the guard TYPE: "Use Existing Keyset" (a keyset-ref) binds
      // on-chain as (keyset-ref-guard "<ref>"), not an expanded literal keyset.
      // (Auto mode + "Define Keyset" stay on (read-keyset "ks").)
      const guardMode = guardValue?.mode === "existing" ? "existing" : "define";
      const guardRef  = guardValue?.mode === "existing" ? guardValue.keysetRef : undefined;
      const pactCode = buildDeployStandardAccountPactCode({
        account:       ouroAccount.address,
        kadenaAddress: effectiveStoaChainAddr,
        publicKey:     ouroAccount.publicKey,
        mode:          guardMode,
        keysetRef:     guardRef,
      });

      // Synthetic guard for the new account — strategy.execute resolves
      // its keys from codex via the standard analyzeGuard path.
      const newAccountGuard = {
        keys: effectiveGuardKeys,
        pred: effectiveGuardPred,
      };

      const { requestKey } = await execute({
        build: ({ gasLimit, capsKeyPub, guardPubs }: { gasLimit: number; capsKeyPub: string; guardPubs: string[] }) => {
          let builder = Pact.builder
            .execution(pactCode)
            .addData("ks", { keys: effectiveGuardKeys, pred: effectiveGuardPred })
            .setMeta({
              senderAccount: STOA_AUTONOMIC_OURONETGASSTATION,
              creationTime:  safeCreationTime(),
              chainId:       STOACHAIN_CHAIN_ID,
              gasLimit,
            })
            .setNetworkId(STOACHAIN_NETWORK)
            .addSigner(capsKeyPub, (w: any) => [
              w(`${STOACHAIN_NAMESPACE}.DALOS.GAS_PAYER`, "", { int: 0 }, { decimal: "0.0" }),
              ...receivers.map((receiver: string, i: number) =>
                w("coin.TRANSFER", effectiveStoaChainAddr, receiver, { decimal: String(amounts[i]) })
              ),
            ]);
          for (const gp of guardPubs) builder = (builder as any).addSigner(gp);
          return (builder as any).createTransaction();
        },
        guards: [newAccountGuard],
        paymentKey: primeKey0,
        resolvedForeignKeys: resolvedManualKeys,
      });

      _tx.submitted(requestKey);
      onClose();
    } catch (err) {
      _tx.fail((err as any)?.message ?? "Failed");
    } finally { setIsProcessing(false); }
  }, [canExecute, primeKey0, guardValue, effectiveGuardKeys, effectiveGuardPred, effectiveStoaChainAddr,
      ouroAccount, receivers, amounts, resolvedManualKeys,
      execute, ensureCodexUnlocked, onClose]);

  if (!open) return null;

  return (
    <ZbomModalFrame onClose={onClose} width={600}>
      <ZbomLayout
        header={<>
          <div className="flex items-center gap-2">
            <Zap className="h-5 w-5 flex-shrink-0" style={{ color: "#ceac5f" }} />
            <h2 className="text-lg font-bold" style={{ color: "#d2d3d4" }}>Activate Standard Ouronet Account</h2>
            <InfoTooltip content={<span>Activates this Standard Ouronet Account on the <StoaChainBrand /></span>} />
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs" style={{ color: "#888" }}>Account:</span>
            <span className="text-xs font-mono font-bold" style={{ color: "#ceac5f" }}>
              {accounts.indexOf(ouroAccount as any) === 0 ? "CodexPrime" : ouroAccount.name || ouroAccount.address?.slice(0, 20) + "…"}
            </span>
          </div>
          <div className="inline-flex items-center gap-2 mt-2 px-2 py-1 rounded-lg border"
            style={{ backgroundColor: "#0a0a0a", borderColor: autoMode ? "#ceac5f40" : "#262626" }}>
            <Switch checked={autoMode} onCheckedChange={setAutoMode} />
            <span className="text-xs font-semibold" style={{ color: autoMode ? "#ceac5f" : "#555" }}>Auto</span>
            <InfoTooltip content="Autonomous mode — uses CodexPrime keys for guard and payment account." />
          </div>
        </>}
        executeButton={{
          canExecute,
          isProcessing,
          onClick: handleExecute,
          bgColor: canExecute ? "#ceac5f" : "#262626",
          textColor: canExecute ? "#0a0a0a" : "#555",
          content: <><Zap className="inline h-4 w-4 mr-1.5 align-text-bottom" />Activate</>,
          processingContent: <><Loader2 className="inline h-4 w-4 mr-2 animate-spin" />Activating…</>,
        }}
      >

        {/* ── Zone 0 — Function Info ── */}
        <FunctionInfoZone
          key={ouroAccount.address}
          readId="INFO_DeployStandardAccount"
          label="DALOS-INFO|URC_DeployStandardAccount"
          pactCall={`(ouronet-ns.INFO-ZERO.DALOS-INFO|URC_DeployStandardAccount "${ouroAccount.address.slice(0, 20)}…")`}
          fetcher={() => getDeployStandardAccountInfoOnly(ouroAccount.address)}
        />

        {/* ── Zone 1 — Function Inputs ── */}
        <Zone2Wrapper
          functionName="ouronet-ns.TS01-C1.DALOS|C_DeployStandardAccount"
          functionMeta={{
            locations:      ["Settings -> Ouronet Account -> Activate"],
            name:           "Activate Standard Ouronet Account",
            description:    "Deploys and activates a Standard Ouronet account on the Stoa Chain, assigning its guard, payment key, and public key. Supports Auto mode (CodexPrime keys) and full manual override.",
            icon:           "zap",
            addedInVersion: "0.3.21",
            addedDate:      "2026-03-05",
          }}
          collapsedContent={!autoMode ? (
            <>
              {/* INPUT III — kadena:string (free, visible when collapsed) */}
              <div>
                <StringEntryInput
                  labelIndex={3}
                  varName="kadena"
                  value={manualStoaChain}
                  onChange={setManualStoaChain}
                  variant="free"
                  placeholder="(k:, c:, u:, w:, or custom account)"
                  addressBookType="stoa"
                />
                {effectiveStoaChain && (
                  <p className="text-[10px] mt-1" style={{ color: hasEnoughStoa ? "#4ade80" : "#c0392b" }}>
                    Balance: {effectiveStoaChain.balance} STOA{!hasEnoughStoa && ` (need ≥ ${stoaChainNeed})`}
                  </p>
                )}
              </div>
              {/* INPUT II — guard:guard (free, visible when collapsed) */}
              <GuardEntryInput
                labelIndex={2}
                varName="guard"
                variant="free"
                onChange={setGuardValue}
              />
            </>
          ) : undefined}
        >
          {/* INPUT I — account:string (autonomous ALWAYS) */}
          <div data-autonomous="true">
            <StringEntryInput
              labelIndex={1}
              varName="account"
              value={ouroAccount.address}
              variant="autonomous"
            />
          </div>

          {/* INPUT II — guard:guard */}
          {autoMode ? (
            <div data-autonomous="true">
              <GuardEntryInput
                labelIndex={2}
                varName="guard"
                variant="autonomous"
                autonomousKeys={primeKey1 ? [primeKey1] : []}
                autonomousPred="keys-all"
              />
            </div>
          ) : (
            <div data-autonomous="false">
              <GuardEntryInput
                labelIndex={2}
                varName="guard"
                variant="free"
                onChange={setGuardValue}
              />
            </div>
          )}

          {/* INPUT III — kadena:string */}
          {autoMode ? (
            <div data-autonomous="true">
              <StringEntryInput
                labelIndex={3}
                varName="kadena"
                value={autoStoaChainAddr}
                variant="autonomous"
              />
            </div>
          ) : (
            <div data-autonomous="false">
              <StringEntryInput
                labelIndex={3}
                varName="kadena"
                value={manualStoaChain}
                onChange={setManualStoaChain}
                variant="free"
                placeholder="(k:, c:, u:, w:, or custom account)"
                addressBookType="stoa"
              />
              {effectiveStoaChain && (
                <p className="text-[10px] mt-1" style={{ color: hasEnoughStoa ? "#4ade80" : "#c0392b" }}>
                  Balance: {effectiveStoaChain.balance} STOA{!hasEnoughStoa && ` (need ≥ ${stoaChainNeed})`}
                </p>
              )}
            </div>
          )}

          {showStoaWarn && (
            <div className="flex items-start gap-1.5 rounded-lg border p-2"
              style={{ backgroundColor: "#8b1a1a10", borderColor: "#8b1a1a30" }}>
              <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" style={{ color: "#c0392b" }} />
              <p className="text-xs" style={{ color: "#c0392b" }}>
                Insufficient STOA ({effectiveStoaChain?.balance ?? "0"} / {stoaChainNeed} required).
              </p>
            </div>
          )}

          {/* INPUT IV — public:string (autonomous ALWAYS) */}
          <div data-autonomous="true">
            <StringEntryInput
              labelIndex={4}
              varName="public"
              value={ouroAccount.publicKey}
              variant="autonomous"
            />
          </div>
        </Zone2Wrapper>

        {/* ── Zone 2 — Signing ── */}
        <div className="rounded-lg border overflow-hidden"
          style={{ backgroundColor: ZONE_SIGNING.bg, borderColor: ZONE_SIGNING.border }}>
          {/* Collapsible header */}
          <div className="px-3 py-2" style={{ borderBottom: zone3Open ? `1px solid ${ZONE_SIGNING.border}` : "none" }}>
            <div className="flex items-center justify-between">
              <CollapsibleZoneHeader
                text="Zone 3 — SIGNING"
                color={ZONE_SIGNING.label}
                isOpen={zone3Open}
                onToggle={() => setZone3Open((v: boolean) => !v)}
              />
              {zone3Open && (
                <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: "#262626" }}>
                  {(["signing", "caps"] as SigningTab[]).map((t, i) => (
                    <button key={t} onClick={() => setSigningTab(t)}
                      className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider transition-all"
                      style={{
                        backgroundColor: signingTab === t ? "#22c55e20" : "#0a0a0a",
                        color:           signingTab === t ? "#4ade80"   : "#555",
                        borderRight: i === 0 ? "1px solid #262626" : "none",
                      }}>
                      {t === "signing" ? "Signing (Pure)" : "CAPS"}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Collapsible content */}
          {zone3Open && (
            <div className="p-3 space-y-2.5">
              {signingTab === "signing" && (
                <div className="space-y-1.5">
                  <p className="text-[10px]" style={{ color: "#555" }}>Keys that must sign this transaction.</p>
                  <SignerRow label="CodexPrime Key #0 (GAS_PAYER + TRANSFERs)"
                    pred="keys-all" found={gasPayerAnalysis.found.length} total={1}
                    ready={gasPayerReady} keys={primeKey0 ? [primeKey0] : []} />
                  {effectiveGuardKeys.length > 0 && (
                    <SignerRow label="Guard Keyset" pred={effectiveGuardPred}
                      found={guardAnalysis.found.length} total={effectiveGuardKeys.length}
                      ready={guardReady} keys={effectiveGuardKeys} />
                  )}
                  {guardAnalysis.missing.length > 0 && (
                    <div className="space-y-2 p-3 rounded-lg border mt-2"
                      style={{ backgroundColor: "#8b1a1a10", borderColor: "#8b1a1a40" }}>
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4" style={{ color: "#c0392b" }} />
                        <span className="text-xs font-semibold" style={{ color: "#c0392b" }}>Missing keys — provide private key(s)</span>
                      </div>
                      {guardAnalysis.missing.map(pub => (
                        <div key={pub} className="space-y-1">
                          <div className="flex items-center gap-2">
                            <code className="text-[10px] font-mono truncate flex-1" style={{ color: "#c0c0c0" }}>{pub.slice(0, 16)}…{pub.slice(-8)}</code>
                            {resolvedManualKeys[pub]
                              ? <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" style={{ color: "#4ade80" }} />
                              : <Key className="h-3.5 w-3.5 flex-shrink-0" style={{ color: "#f59e0b" }} />}
                          </div>
                          {!resolvedManualKeys[pub] && (
                            <Input value={manualKeys[pub] || ""} onChange={e => handleManualKeyInput(pub, e.target.value)}
                              placeholder="Private key (64 or 128 hex chars)" className="font-mono text-[10px]"
                              style={{ backgroundColor: "#0a0a0a", borderColor: "#262626", color: "#d2d3d4" }} />
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {signingTab === "caps" && (
                <div className="space-y-1.5">
                  <p className="text-[10px]" style={{ color: "#555" }}>Capabilities automatically attached by the UI.</p>
                  {loadingInfo
                    ? <p className="text-xs flex items-center gap-1.5" style={{ color: "#555" }}><Loader2 className="h-3 w-3 animate-spin" /> Loading…</p>
                    : caps.map((cap, i) => <CapRow key={i} {...cap} />)}
                </div>
              )}
            </div>
          )}
        </div>

      </ZbomLayout>
    </ZbomModalFrame>
  );
}
