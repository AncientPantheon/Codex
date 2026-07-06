/**
 * ArweavePanel — the Arweave chain panel contributed into codex-ui's generic
 * `ForeignChainsTab` slot.
 *
 * Conforms to codex-ui's chain-agnostic `PanelProps` (`{ id, ctx? }`, imported
 * TYPE-ONLY via the bare package name so the edge erases at build), so the E5
 * consumer can wire `foreignChainPanels[ARWEAVE_CHAIN_ID] = ArweavePanel`. It
 * hosts a subtab switcher over the 5 Arweave areas (Keyring / Balance / Send /
 * Upload / Library) and reads its E1-E3 seams from the panel context — the
 * codex-ui slot stays chain-blind; the Arweave panel obtains its own seams here.
 *
 * Kadena-free: imports ONLY `@ancientpantheon/{arweave-core,codex-core,
 * codex-arweave,codex-ui}` + the codex-ouronet address-book registry (indirectly,
 * via the injected `addressBook` seam). The subtab id vocabulary is namespaced
 * off the ARWEAVE_CHAIN_ID const — the chain id string is never re-spelled here.
 */

import * as React from "react";
import { useState } from "react";

import type { PanelProps } from "@ancientpantheon/codex-ui";

import { ARWEAVE_CHAIN_ID } from "../address-book/chainId.js";

import { useArweavePanelDeps } from "./context.js";
import { KeyringArea } from "./KeyringArea.js";
import { BalanceArea } from "./BalanceArea.js";
import { SendArea } from "./SendArea.js";
import { UploadArea } from "./UploadArea.js";
import { LibraryArea } from "./LibraryArea.js";

/** The Arweave panel's 5 subtabs, in display order. */
const SUBTABS = ["keyring", "balance", "send", "upload", "library"] as const;
type SubtabId = (typeof SUBTABS)[number];

/** Human labels for the subtab strip. */
const SUBTAB_LABELS: Record<SubtabId, string> = {
  keyring: "Keyring",
  balance: "Balance",
  send: "Send",
  upload: "Upload",
  library: "Library",
};

export function ArweavePanel(_props: PanelProps): React.ReactElement {
  const deps = useArweavePanelDeps();
  const [active, setActive] = useState<SubtabId>("keyring");

  return (
    <div data-testid="arweave-panel" data-chain-id={ARWEAVE_CHAIN_ID}>
      <div role="tablist" aria-label="Arweave panel">
        {SUBTABS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={id === active}
            data-testid={`arweave-subtab-${id}`}
            onClick={() => setActive(id)}
          >
            {SUBTAB_LABELS[id]}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {active === "keyring" && (
          <KeyringArea
            foreignKeys={deps.foreignKeys}
            keygenRunner={deps.keygenRunner}
            generateArweaveKey={deps.generateArweaveKey}
            importArweaveKey={deps.importArweaveKey}
            decryptArweaveKey={deps.decryptArweaveKey}
            addForeignKey={deps.addForeignKey}
            renameForeignKey={deps.renameForeignKey}
            deleteForeignKey={deps.deleteForeignKey}
          />
        )}
        {active === "balance" && (
          <BalanceArea address={deps.address} getBalance={deps.getBalance} />
        )}
        {active === "send" && (
          <SendArea
            addressBook={deps.addressBook}
            send={deps.send}
            pollStatus={deps.pollStatus}
          />
        )}
        {active === "upload" && (
          <UploadArea
            address={deps.address}
            uploadAndTrack={deps.uploadAndTrack}
            openUrl={deps.openUrl}
          />
        )}
        {active === "library" && (
          <LibraryArea
            owner={deps.address}
            pool={deps.pool}
            listLibrary={deps.listLibrary}
            openUrl={(id, opts) => deps.openUrl(id, opts)}
            rebuildLibrary={deps.rebuildLibrary}
          />
        )}
      </div>
    </div>
  );
}

export default ArweavePanel;
