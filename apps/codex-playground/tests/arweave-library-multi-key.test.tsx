/**
 * Bug report (follow-up to `arweave-upload-wizard-account-wiring`): the
 * Upload Wizard's own Account step genuinely lets an upload go out under ANY
 * of a codex's configured Arweave keys (its `accountId` is resolved per call
 * via `findEntryForAddress`, `realArweaveAdapter.ts`) — but
 * `ForeignChainsWiring.tsx`'s `buildArweaveWiring` resolved
 * `ArweavePanelDeps.address` (what `ArweavePanel.tsx` fed `LibraryArea`'s
 * `owner` prop as) via `foreignKeys.find((k) => k.chainId ===
 * ARWEAVE_CHAIN_ID)` — ALWAYS the FIRST configured key, regardless of which
 * one a given upload actually used. A codex with more than one configured
 * Arweave key could therefore upload under a non-first key and never see
 * that upload in the Library — "Rebuild from chain" silently found nothing,
 * even though the upload genuinely exists on chain under a key this very
 * codex holds.
 *
 * This drives the REAL composition path the bug lived in —
 * `buildArweaveWiring` (real mode) -> `ArweavePanelDeps` -> `ArweavePanel` ->
 * `LibraryArea` — rather than a narrower unit test of `LibraryArea` alone
 * (that unit-level coverage lives in
 * `packages/codex-arweave/tests/e4-panel-library.test.tsx`).
 *
 * The fix: `LibraryArea` is now handed the FULL list of this chain's
 * configured addresses (`ArweavePanel.tsx`'s own `libraryOwners`, derived
 * from `deps.foreignKeys`) and aggregates across every one of them, so
 * Library's "Rebuild from chain" / entry list cover every configured key, not
 * just the first.
 */
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { encryptStringV2 } from "@stoachain/stoa-core/crypto";
import type { ForeignKeyEntry } from "@ancientpantheon/codex-core";
import { ARWEAVE_CHAIN_ID } from "@ancientpantheon/codex-arweave/address-book";
import {
  ArweavePanel,
  ArweavePanelProvider,
  type ArweavePanelDeps,
} from "@ancientpantheon/codex-arweave/panel";
import { CodexProvider } from "@ancientpantheon/codex-ouronet/provider";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";

import {
  buildArweaveWiring,
  ARWEAVE_WIRING_MODE_REAL,
} from "../src/ForeignChainsWiring";

const TEST_PASSWORD = "correct horse battery staple";
// Canonical 43-char base64url addresses/tx-ids — `LibraryArea`'s own Open
// link composition (`isCanonicalAddress`) throws on anything shorter.
const ADDRESS_FIRST = "keyAkeyAkeyAkeyAkeyAkeyAkeyAkeyAkeyAkeyAkey";
const ADDRESS_SECOND = "keyBkeyBkeyBkeyBkeyBkeyBkeyBkeyBkeyBkeyBkey";
const ENTRY_ID_UNDER_FIRST = "entAentAentAentAentAentAentAentAentAentAent";
const ENTRY_ID_UNDER_SECOND = "entBentBentBentBentBentBentBentBentBentBent";

async function makeTwoConfiguredKeys(): Promise<ForeignKeyEntry[]> {
  const fakeJwk = { kty: "RSA", n: "fake", e: "AQAB" };
  const encryptedKeyfile = await encryptStringV2(JSON.stringify(fakeJwk), TEST_PASSWORD);
  return [
    { id: ADDRESS_FIRST, chainId: ARWEAVE_CHAIN_ID, encryptedKeyfile, address: ADDRESS_FIRST },
    { id: ADDRESS_SECOND, chainId: ARWEAVE_CHAIN_ID, encryptedKeyfile, address: ADDRESS_SECOND },
  ];
}

/** Mounts the composed panel: `buildArweaveWiring` (real mode) feeding
 *  `ArweavePanelProvider` feeding the real `ArweavePanel` — the SAME
 *  composition the app wires, with `getBalance` overridden to a no-network
 *  fake (Accounts, the panel's default category, fetches every configured
 *  key's balance on mount; this spec's whole concern is Library, not a live
 *  gateway read). */
function renderComposedPanel(deps: ArweavePanelDeps) {
  const noNetworkDeps: ArweavePanelDeps = { ...deps, getBalance: async () => 0n };
  render(
    // `SendArweaveModal` (mounted inside the default Accounts category) calls
    // `useEnsureCodexUnlocked`, which requires a `<CodexProvider>` ancestor —
    // the SAME wrapping `e4-panel-categories.test.tsx`'s own `renderPanel`
    // uses, and the SAME one `ForeignChainsWiring.tsx` always provides in the
    // real app ("Must be mounted INSIDE <CodexProvider>").
    <CodexProvider adapter={new MemoryCodexAdapter("dev")}>
      <ArweavePanelProvider deps={noNetworkDeps}>
        <ArweavePanel id={ARWEAVE_CHAIN_ID} />
      </ArweavePanelProvider>
    </CodexProvider>,
  );
}

describe("Library across multiple configured Arweave keys (buildArweaveWiring -> ArweavePanelDeps -> LibraryArea)", () => {
  it("shows an upload made under the SECOND configured key, not just the first", async () => {
    const foreignKeys = await makeTwoConfiguredKeys();
    const { panelDeps } = buildArweaveWiring({
      mode: ARWEAVE_WIRING_MODE_REAL,
      gatewayUrl: "https://arweave.example.invalid",
      foreignKeys,
      getPassword: () => TEST_PASSWORD,
    });

    // Seed the REAL library store the wiring built — one entry per
    // configured key's address, mirroring what a real upload under EACH key
    // would have produced (the store/owner-scoped read path this spec
    // exercises is unaffected by how the entry got there).
    await panelDeps.libraryStore.append({
      id: ENTRY_ID_UNDER_FIRST,
      owner: ADDRESS_FIRST,
      itemId: "item-under-first",
      contentType: "text/plain",
      status: "final",
      createdAt: 100,
      tags: [],
    });
    await panelDeps.libraryStore.append({
      id: ENTRY_ID_UNDER_SECOND,
      owner: ADDRESS_SECOND,
      itemId: "item-under-second",
      contentType: "text/plain",
      status: "final",
      createdAt: 200,
      tags: [],
    });

    renderComposedPanel(panelDeps);
    fireEvent.click(screen.getByTestId("arweave-subtab-library"));

    const items = await screen.findAllByTestId("library-entry");
    // Before the fix, `deps.address` (and therefore `LibraryArea`'s `owner`)
    // resolved to ONLY `ADDRESS_FIRST` (`foreignKeys.find(...)`'s first
    // match) — the second key's entry would never appear here at all.
    expect(items).toHaveLength(2);
    expect(items.some((item) => item.textContent?.includes(ENTRY_ID_UNDER_SECOND))).toBe(true);
    expect(items.some((item) => item.textContent?.includes(ENTRY_ID_UNDER_FIRST))).toBe(true);
  });
});
