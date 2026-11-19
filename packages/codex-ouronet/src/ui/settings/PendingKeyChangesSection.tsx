/**
 * STAGE 3A SECTION — the container that turns the recorded migration into an
 * offer to apply it, and mounts the real rotate flows.
 *
 * Why a container here rather than in the Codex ID page: the rotate modals
 * are INTERNAL to this package (`zbom/modals`), and exporting them would
 * drag the whole ZBOM graph — CodeMirror, the Pact grammar, the chain read
 * layer — into every consumer that merely wants to show this card. Keeping
 * the mount beside the modals means the page composes one prop-less section
 * and the dependency stays where it already was.
 *
 * {@link PendingKeyChangesCard} stays presentational and separately tested;
 * this only supplies it with data and launchers.
 */

import * as React from "react";
import { useState } from "react";
import { useCodexStoreOptional } from "../../provider/index.js";
import type { CodexStoreState } from "../../state/store.js";
import { flattenStoaChainAccounts } from "../../zbom/cfm/seam.js";
import { computeOutstandingKeyChanges } from "../internal/outstandingKeyChanges.js";
import { PendingKeyChangesCard } from "./PendingKeyChangesCard.js";
import RotateGuardModal from "../../zbom/modals/RotateGuardModal.js";
import RotatePaymentKeyModal from "../../zbom/modals/RotatePaymentKeyModal.js";

export function PendingKeyChangesSection(): React.ReactElement | null {
  const codexStore = useCodexStoreOptional();
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const recordedRun = codexStore
    ? codexStore((s: CodexStoreState) => s.migrationProgress)
    : undefined;
  // Read through the NON-throwing store handle, never the throwing
  // `useOuroAccounts()` / `useStoaChainSeeds()` hooks: `CodexIdPage` is
  // deliberately mountable with NO `<CodexProvider>` ancestor (its own
  // extraction suite asserts it "degrades honestly (no crash)"), and a
  // throwing hook here took the whole page down with it.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const accounts = codexStore ? codexStore((s: CodexStoreState) => s.ouroAccounts) : [];
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const seeds = codexStore ? codexStore((s: CodexStoreState) => s.kadenaSeeds) : [];
  const [openModal, setOpenModal] = useState<"guard" | "payment" | null>(null);

  // The master account is resolved POSITIONALLY, the same rule the accounts
  // tab and the wizard use — a stray `isPrime` stamp can sit on a non-first
  // account, and this must agree with what the rest of the UI calls master.
  const masterAccount = accounts[0] ?? null;
  const outstanding = computeOutstandingKeyChanges(recordedRun, masterAccount);

  if (outstanding.none || !masterAccount) return null;

  const stoaChainAccounts = flattenStoaChainAccounts(seeds);

  return (
    <div data-testid="pending-key-changes-section">
      <PendingKeyChangesCard
        changes={outstanding.changes}
        onApplyGuard={() => setOpenModal("guard")}
        onApplyPaymentKey={() => setOpenModal("payment")}
      />
      {openModal === "guard" ? (
        <RotateGuardModal
          open
          onClose={() => setOpenModal(null)}
          account={masterAccount}
          accounts={accounts}
          kadenaSeeds={seeds}
          stoaChainAccounts={stoaChainAccounts}
        />
      ) : null}
      {openModal === "payment" ? (
        <RotatePaymentKeyModal
          open
          onClose={() => setOpenModal(null)}
          account={masterAccount}
          accounts={accounts}
          kadenaSeeds={seeds}
          stoaChainAccounts={stoaChainAccounts}
        />
      ) : null}
    </div>
  );
}

export default PendingKeyChangesSection;
