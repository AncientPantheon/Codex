/**
 * ReleaseStoicTagModal — CFM Architecture v2 (ZBOM). Releases the StoicTag
 * currently bound to an Ouronet account.
 *
 * Ownership of the bound account is enforced on chain, so the transaction is
 * signed with BOTH the patron's guard (pays IGNIS) and the bound account's own
 * guard. `tag-name` is sent BARE (no § sigil — the sigil is a UI marker).
 *
 * Pact functions:
 *   INFO    — (ouronet-ns.CODEX.CODEX|INFO_ReleaseStoicTag patron tag-name)
 *   EXECUTE — (ouronet-ns.TS01-C4.CODEX|C_ReleaseStoicTag patron tag-name)
 *
 * Cost: IGNIS only — 1 per glyph of the tag (surfaced by INFO).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Pact } from "@stoachain/kadena-stoic-legacy/client";
import { ZbomModalFrame } from "../ui/ZbomModalFrame.js";
import { InfoTooltip } from "../ui/InfoTooltip.js";
import { usePatronSelectionDefaults } from "../patron/usePatronSelectionDefaults.js";
import { txPending } from "../toast/toastManager.js";
import { Unlink, Loader2 } from "lucide-react";
import { getIgnisBalance, getStoaChainAccountGuard } from "../debouncer/monitoredReads.js";
import { pactRead } from "@stoachain/stoa-core/reads";
import { KADENA_CHAIN_ID as STOACHAIN_CHAIN_ID, KADENA_NETWORK as STOACHAIN_NETWORK } from "@stoachain/stoa-core/constants";
import {
  KADENA_NAMESPACE as STOACHAIN_NAMESPACE,
  STOA_AUTONOMIC_OURONETGASSTATION,
} from "@ouronet/ouronet-core/constants";
import { buildReleaseStoicTagPactCode } from "@ouronet/ouronet-core/pact";
import { safeCreationTime, mayComeWithDeimal } from "@stoachain/stoa-core/pact";
import type { IKeyset } from "@stoachain/stoa-core/guard";
import type { IOuroAccount, IStoaChainSeed, IStoaChainWallet } from "../../types/entities.js";
import { ZbomLayout } from "../cfm/ZbomLayout.js";
import { FunctionInfoZone } from "../cfm/FunctionInfoZone.js";
import { PatronZonePattern2 } from "../cfm/PatronSpend.js";
import { Zone2Wrapper } from "../cfm/Zone2Wrapper.js";
import { SigningZone } from "../cfm/SigningZone.js";
import { StringEntryInput } from "../cfm/inputs.js";
import { AuthPathZone, type AuthPathSelection } from "../cfm/AuthPathZone.js";
import { StoicTagDisplay } from "@ancientpantheon/codex-ui/ui";
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
  /** The account whose StoicTag is being released (its guard signs). */
  account: IOuroAccount;
  /** Full codex Ouronet accounts — for the patron Custom selector. */
  accounts: IOuroAccount[];
  kadenaSeeds: IStoaChainSeed[];
  stoaChainAccounts: IStoaChainWallet[];
}

export default function ReleaseStoicTagModal({
  open,
  onClose,
  account,
  accounts,
  kadenaSeeds: _stoaChainSeeds,
  stoaChainAccounts: _stoaChainAccounts,
}: Props) {
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

  const [infoData, setInfoData] = useState<any>(null);
  const [loadingInfo, setLoadingInfo] = useState(false);

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

  // The bare on-chain tag name bound to this account.
  const tagName = typeof account.stoicTag === "string" ? account.stoicTag : "";
  const glyphCount = Array.from(tagName).length;

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

  // ── INFO fetch (INFO_ReleaseStoicTag) ──
  useEffect(() => {
    if (!open || !patronAccount?.address || !tagName) return;
    setLoadingInfo(true);
    setInfoData(null);
    let aborted = false;
    pactRead(
      `(${STOACHAIN_NAMESPACE}.CODEX.CODEX|INFO_ReleaseStoicTag "${patronAccount.address}" "${tagName}")`,
      { tier: "T7" },
    )
      .then((res: any) => { if (!aborted) setInfoData(res?.result?.data ?? null); })
      .catch(() => { if (!aborted) setInfoData(null); })
      .finally(() => { if (!aborted) setLoadingInfo(false); });
    return () => { aborted = true; };
  }, [open, patronAccount?.address, tagName]);

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
    setInfoData(null);
    setLoadingInfo(false);
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

  const ignisCost = toNum(infoData?.ignis?.["ignis-need"]);
  const virtualToggleActive = ignisCost > 0;
  const hasEnoughIgnis = (patronIgnisBalance ?? 0) >= ignisCost;
  const insufficientIgnis = !hasEnoughIgnis && infoData !== null && ignisCost > 0;

  // ── Stable callback for AuthPathZone (Smart accounts only) ──
  const handleAuthPathChange = useCallback((sel: AuthPathSelection) => {
    setAuthSelection(sel);
  }, []);

  const blockerReason = (() => {
    if (isProcessing)                     return null;
    if (!tagName)                         return "No StoicTag to release";
    if (loadingInfo || infoData === null) return "Loading function info…";
    if (!patronAccount)                   return "Pick a patron";
    if (insufficientIgnis)                return "Insufficient IGNIS";
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

  const patronGuard = useMemo<IKeyset | null>(
    () => ((patronAccount?.guard as any) ?? null),
    [patronAccount],
  );
  // Ownership enforcement: the bound account's own guard must sign.
  const accountGuard = (account.guard as any) ?? null;

  async function handleExecute() {
    if (!canExecute || !patronAccount || !patronGuard || !tagName) return;
    // Standard accounts require their own guard; Smart accounts require a
    // chosen key-based branch from the AuthPathZone instead.
    if (isSmart) {
      if (!authSelection.chosenKeyset) return;
    } else if (!accountGuard) {
      return;
    }
    setIsProcessing(true);
    const _tx = txPending("Release StoicTag");
    try {
      if (!(await ensureCodexUnlocked())) { _tx.fail("Authentication required"); return; }

      const pactCode = buildReleaseStoicTagPactCode({
        patron:  patronAccount.address,
        tagName,
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
            ]);
          for (const gp of guardPubs) builder = (builder as any).addSigner(gp);
          return (builder as any).createTransaction();
        },
        // patron pays IGNIS; the bound account's guard proves ownership. For
        // Smart accounts this is the chosen enforce-one branch keyset.
        guards: [patronGuard, accountAuthGuard],
        paymentKey: null,
      });

      _tx.submitted(requestKey);
      onClose();
    } catch (e: any) {
      console.error("[ReleaseStoicTag handleExecute]", e);
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
              <Unlink className="h-5 w-5" style={{ color: "#4ade80" }} />
              <h2 className="text-lg font-bold" style={{ color: "#d2d3d4" }}>
                Release StoicTag
              </h2>
              <InfoTooltip content="Releases the StoicTag bound to this Ouronet account, freeing the name. The chain enforces ownership of the bound account, so its guard signs alongside the patron. Cost is IGNIS only — 1 per glyph of the tag." />
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs" style={{ color: "#888" }}>Account:</span>
              <span className="text-xs font-mono font-bold" style={{ color: "#4ade80" }}>
                {displayAccountName(account)}
              </span>
            </div>
          </>
        }
        executeButton={{
          canExecute,
          isProcessing,
          onClick: handleExecute,
          bgColor: insufficientIgnis ? "#c0392b" : canExecute ? "#4ade80" : "#262626",
          textColor: insufficientIgnis ? "#fff" : canExecute ? "#0a0a0a" : "#888",
          content: canExecute
            ? (<><Unlink className="inline h-4 w-4 mr-1.5 align-text-bottom" />Release StoicTag</>)
            : (blockerReason ?? "Release StoicTag"),
          processingContent: (<><Loader2 className="inline h-4 w-4 mr-2 animate-spin" />Processing…</>),
        }}
      >

        {/* ── Zone 0 — Function Info ── */}
        <FunctionInfoZone
          key={patronAccount?.address}
          readId="INFO_ReleaseStoicTag"
          label="CODEX.CODEX|INFO_ReleaseStoicTag"
          pactCall={`(ouronet-ns.CODEX.CODEX|INFO_ReleaseStoicTag "${(patronAccount?.address ?? "").slice(0, 20)}…" "§${tagName.slice(0, 16)}${tagName.length > 16 ? "…" : ""}")`}
          fetcher={async () => {
            const res = await pactRead(
              `(${STOACHAIN_NAMESPACE}.CODEX.CODEX|INFO_ReleaseStoicTag "${patronAccount?.address ?? ""}" "${tagName}")`,
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

        {/* ── Zone 2 — Inputs ── */}
        {(() => {
          const tagRow = (
            <div className="space-y-2">
              <StoicTagDisplay tag={tagName} hideCopy />
              <p className="text-[10px] text-center" style={{ color: "#888" }}>
                {glyphCount} glyph{glyphCount === 1 ? "" : "s"} · {glyphCount} IGNIS
              </p>
            </div>
          );
          return (
            <Zone2Wrapper
              functionName="ouronet-ns.TS01-C4.CODEX|C_ReleaseStoicTag"
              functionMeta={{
                locations:      ["Settings -> Ouronet Account -> StoicTag -> Release StoicTag"],
                name:           "Release StoicTag",
                description:    "Releases the StoicTag bound to an Ouronet account, freeing the human-readable name. Ownership of the bound account is enforced on chain. IGNIS cost is 1 per glyph of the tag.",
                icon:           "unlink",
                addedInVersion: "1.2.5",
                addedDate:      "2026-05-30",
              }}
              collapsedContent={tagRow}
            >
              {/* INPUT I — patron (autonomous) */}
              <StringEntryInput
                variant="autonomous"
                labelIndex={1}
                varName="patron"
                value={patronAccount?.address ?? ""}
              />

              {/* INPUT II — tag-name (the StoicTag being released) */}
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

        {/* ── Zone 3 — Signing (patron + bound account guard for ownership) ── */}
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
        />
      </ZbomLayout>
    </ZbomModalFrame>
  );
}
