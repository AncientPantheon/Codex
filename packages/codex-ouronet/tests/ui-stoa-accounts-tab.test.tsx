/**
 * StoaAccountsTab specs.
 *
 * Rebuilt tab: a "Total Addresses" header, a Codex/Watched sub-tab toggle, and
 * per-source collapsible groups whose rows each map a seed account / pure
 * keypair to its `k:<publicKey>` Stoa address (carried on a `data-stoa-address`
 * attribute; the visible code is truncated). The first seed is the
 * "Prime Codex Seed". Live per-chain balances flow through the `pactRead` seam,
 * which we stub here so the specs stay hermetic.
 */

import * as React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import { CodexProvider } from "@ancientpantheon/codex-ouronet/provider";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import { useCodex, useKadenaSeeds, usePureKeypairs } from "@ancientpantheon/codex-ouronet/hooks";
import { StoaAccountsTab } from "@ancientpantheon/codex-ouronet/ui";
import type { IKadenaSeed, IPureKeypair } from "@ancientpantheon/codex-ouronet/types";
import { setPactReader } from "@stoachain/stoa-core/reads";

// Stub the read seam so the tab's live-balance effect never touches the network.
beforeEach(() => {
  setPactReader(async () => ({ result: { data: [] } }) as never);
});

const seedFx = (over: Partial<IKadenaSeed> = {}): IKadenaSeed => ({
  id: over.id ?? "s1",
  name: over.name ?? "My Seed",
  seedType: "koala",
  version: "1.0.0",
  index: 0,
  secret: "enc",
  main: "k:" + "0".repeat(64),
  createdAt: "2026-05-25T10:00:00.000Z",
  accounts: over.accounts ?? [],
  ...over,
});

const kpFx = (over: Partial<IPureKeypair> = {}): IPureKeypair => ({
  id: over.id ?? "kp1",
  label: over.label,
  publicKey: over.publicKey ?? "f".repeat(64),
  encryptedPrivateKey: "enc",
  createdAt: "2026-05-25T10:00:00.000Z",
  ...over,
});

function Seeder({ seeds, pairs }: { seeds: IKadenaSeed[]; pairs: IPureKeypair[] }) {
  const { addSeed } = useKadenaSeeds();
  const { addKeypair } = usePureKeypairs();
  const { isReady } = useCodex();
  React.useEffect(() => {
    if (!isReady) return;
    seeds.forEach((s) => void addSeed(s));
    pairs.forEach((p) => void addKeypair(p));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady]);
  return null;
}

async function renderTab(seeds: IKadenaSeed[] = [], pairs: IPureKeypair[] = []) {
  const adapter = new MemoryCodexAdapter("dev");
  const utils = render(
    <CodexProvider adapter={adapter}>
      <Seeder seeds={seeds} pairs={pairs} />
      <StoaAccountsTab />
    </CodexProvider>,
  );
  // The "Total Addresses" header is always present once mounted.
  await waitFor(() => expect(screen.getByText(/Total Addresses/i)).toBeTruthy());
  return utils;
}

describe("<StoaAccountsTab>", () => {
  it("renders the empty state when the codex has no seeds or keys", async () => {
    await renderTab([], []);
    expect(screen.getByText(/No Stoa accounts in the codex/i)).toBeTruthy();
  });

  it("derives a k: address per seed account so the list mirrors useKadenaSeeds", async () => {
    const { container } = await renderTab([
      seedFx({
        id: "s1",
        name: "Trading",
        accounts: [
          { index: 0, publicKey: "a".repeat(64), derivationPath: "m/0" },
          { index: 1, publicKey: "b".repeat(64), derivationPath: "m/1" },
        ],
      }),
    ]);
    // First (and only) seed surfaces as the Prime Codex Seed group.
    expect(await screen.findByText("Prime Codex Seed")).toBeTruthy();
    // One row per account, each carrying its full k: address on the data attr.
    expect(container.querySelector(`[data-stoa-address="k:${"a".repeat(64)}"]`)).toBeTruthy();
    expect(container.querySelector(`[data-stoa-address="k:${"b".repeat(64)}"]`)).toBeTruthy();
    // Per-account sublabels.
    expect(screen.getByText("Key #0")).toBeTruthy();
    expect(screen.getByText("Key #1")).toBeTruthy();
  });

  it("derives a k: address per pure keypair under a Pure Key Pairs group", async () => {
    const { container } = await renderTab([], [kpFx({ id: "kp1", publicKey: "f".repeat(64) })]);
    expect(await screen.findByText(/Pure Key Pairs/i)).toBeTruthy();
    expect(container.querySelector(`[data-stoa-address="k:${"f".repeat(64)}"]`)).toBeTruthy();
  });
});
