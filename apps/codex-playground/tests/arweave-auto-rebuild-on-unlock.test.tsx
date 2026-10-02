/**
 * REAL composition spec — `arweave-auto-rebuild-on-unlock`.
 *
 * Unlocking a codex with MULTIPLE configured Arweave addresses must
 * automatically run "rebuild from chain" across EVERY one of them, with NO
 * manual click required: the Library must end up populated with uploads from
 * every address once the auto-rebuild completes, and a visible progress
 * status must show real page/record numbers while it runs (never a fake/
 * animated placeholder), disappearing again once done.
 *
 * Drives the REAL composition path — `buildArweaveWiring` (real mode) ->
 * `ForeignChainsWiring`'s own OWN mount-effect trigger -> `rebuildLibraryFor-
 * AllOwners` -> `ArweavePanel` -> `LibraryArea`/`LibraryAutoRebuildProgress` —
 * rather than a narrower isolated unit test of `rebuildLibraryForAllOwners`
 * alone (that unit-level coverage lives in `packages/codex-arweave/tests/
 * e3-rebuild.test.ts`). A real (fake, no-network) `GatewayPool` answers the
 * GraphQL rebuild query PER OWNER, so the Library's final contents are
 * genuinely reconstructed from "chain" data, not seeded directly into the
 * store the way `arweave-library-multi-key.test.tsx` does for its own
 * (unrelated) concern.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

import { buildUploadTags, TAG_CODEX_OWNER, type Tag } from "@ancientpantheon/arweave-core";
import type { GatewayPool } from "@ancientpantheon/arweave-core";
import type { ForeignKeyEntry } from "@ancientpantheon/codex-core";
import { ARWEAVE_CHAIN_ID } from "@ancientpantheon/codex-arweave/address-book";
import { CodexProvider } from "@ancientpantheon/codex-ouronet/provider";
import type { CodexSnapshot } from "@ancientpantheon/codex-ouronet/adapters";

import { hydrateFromPlaintextSnapshot } from "../src/loadCodex";
import { emptySnapshot } from "../fixtures/index.js";
import { ForeignChainsWiring, ARWEAVE_WIRING_MODE_REAL } from "../src/ForeignChainsWiring";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const GATEWAY_ENDPOINT = "https://arweave.example.invalid";

/** Two distinct, valid canonical (43-char base64url) addresses — same literal
 *  shapes `arweave-library-multi-key.test.tsx`'s own ADDRESS_FIRST/SECOND
 *  already prove resolve through the real `isCanonicalAddress` gate. */
const ADDRESS_FIRST = "keyAkeyAkeyAkeyAkeyAkeyAkeyAkeyAkeyAkeyAkey";
const ADDRESS_SECOND = "keyBkeyBkeyBkeyBkeyBkeyBkeyBkeyBkeyBkeyBkey";
const ENTRY_ID_UNDER_FIRST = "entAentAentAentAentAentAentAentAentAentAent";
const ENTRY_ID_UNDER_SECOND = "entBentBentBentBentBentBentBentBentBentBent";

function makeTwoConfiguredKeys(): ForeignKeyEntry[] {
  return [
    { id: ADDRESS_FIRST, chainId: ARWEAVE_CHAIN_ID, encryptedKeyfile: "CIPHERTEXT-NOT-A-JWK", address: ADDRESS_FIRST },
    { id: ADDRESS_SECOND, chainId: ARWEAVE_CHAIN_ID, encryptedKeyfile: "CIPHERTEXT-NOT-A-JWK", address: ADDRESS_SECOND },
  ];
}

/** A real-shaped single-endpoint `GatewayPool` fake — `execute` runs the op
 *  straight against the one configured (origin-only) endpoint, same "no
 *  rotation" shape `codex-arweave`'s own `makeHealthPool` test helper uses. */
function makePool(): GatewayPool {
  return {
    execute: async <T,>(op: (endpoint: string, ctx: { signal: AbortSignal }) => Promise<T>): Promise<T> =>
      op(GATEWAY_ENDPOINT, { signal: new AbortController().signal }),
    getHealthSnapshot: () => [{ endpoint: GATEWAY_ENDPOINT, healthy: true, active: true }],
    getActiveEndpoint: () => GATEWAY_ENDPOINT,
  } as unknown as GatewayPool;
}

function graphqlBody(records: ReadonlyArray<{ id: string; tags: ReadonlyArray<Tag> }>) {
  return {
    data: {
      transactions: {
        pageInfo: { hasNextPage: false },
        edges: records.map((r) => ({ cursor: `cursor-${r.id}`, node: { id: r.id, tags: r.tags } })),
      },
    },
  };
}

/**
 * Stubs `globalThis.fetch` for the WHOLE test — every real-mode network call
 * (both `getBalance`'s `GET {endpoint}/wallet/{address}/balance`, fired by
 * the Accounts category's own on-mount balance read, AND `rebuildLibraryFor-
 * AllOwners`'s own GraphQL POSTs) routes through the injected pool's `execute`
 * straight into the runtime-global `fetch` — neither seam accepts an
 * injectable `fetchFn` through this real-mode wiring path, so stubbing the
 * global is the only interception seam available here (mirrors arweave-
 * core's own documented "binding-safe, call-time-resolved" default-fetch
 * contract — a stub installed before the call is what it is designed to
 * pick up).
 */
function stubFetchAnsweringOwnersAndBalances(
  recordsByOwner: Readonly<Record<string, ReadonlyArray<{ id: string; tags: ReadonlyArray<Tag> }>>>,
): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/graphql")) {
        const body = JSON.parse(String(init?.body)) as {
          variables: { tags: Array<{ name: string; values: string[] }> };
        };
        const ownerTag = body.variables.tags.find((t) => t.name === TAG_CODEX_OWNER);
        const owner = ownerTag?.values[0] ?? "";
        const responseBody = graphqlBody(recordsByOwner[owner] ?? []);
        return new Response(JSON.stringify(responseBody), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/wallet/")) {
        // Every configured key's balance read, benign and network-free.
        return new Response("0", { status: 200 });
      }
      throw new Error(`unexpected fetch in auto-rebuild composition spec: ${url}`);
    }),
  );
}

/** Mounts the wiring AND navigates to the Arweave rail — "Blockchain
 *  Accounts" (Class 2) hosts the rail; selecting it is what the generic
 *  `CodexTabs` shell requires before the Arweave-specific subtabs (e.g.
 *  `arweave-subtab-library`) exist at all, mirroring `e5-foreign-chains-
 *  mock.test.tsx`'s own `renderWiring`/`renderWiredForeignChainsTab` shape. */
async function renderUnlockedWiringOnArweaveRail(
  adapterSnapshot: CodexSnapshot,
  pool: GatewayPool,
): Promise<void> {
  const adapter = await hydrateFromPlaintextSnapshot(adapterSnapshot);
  render(
    <CodexProvider adapter={adapter} deviceVariant="dev">
      <ForeignChainsWiring mode={ARWEAVE_WIRING_MODE_REAL} gatewayUrl={GATEWAY_ENDPOINT} pool={pool} />
    </CodexProvider>,
  );
  fireEvent.click(await screen.findByRole("tab", { name: /blockchain accounts/i }));
  fireEvent.click(await screen.findByRole("tab", { name: new RegExp(`^${ARWEAVE_CHAIN_ID}$`, "i") }));
}

describe("arweave-auto-rebuild-on-unlock — unlock with 2 configured addresses auto-populates the Library from BOTH, with no manual click", () => {
  it("shows a real, non-fake progress status while running, and the Library ends up carrying entries from both addresses once it settles", async () => {
    const recordFirst = {
      id: ENTRY_ID_UNDER_FIRST,
      tags: buildUploadTags({ ownerAddress: ADDRESS_FIRST, contentType: "text/plain", itemId: "item-first" }),
    };
    const recordSecond = {
      id: ENTRY_ID_UNDER_SECOND,
      tags: buildUploadTags({ ownerAddress: ADDRESS_SECOND, contentType: "text/plain", itemId: "item-second" }),
    };
    stubFetchAnsweringOwnersAndBalances({
      [ADDRESS_FIRST]: [recordFirst],
      [ADDRESS_SECOND]: [recordSecond],
    });

    await renderUnlockedWiringOnArweaveRail(
      { ...emptySnapshot, foreignKeys: makeTwoConfiguredKeys() },
      makePool(),
    );

    // NO manual "Rebuild from chain" click anywhere in this test — the
    // auto-rebuild must have fired on its own.
    fireEvent.click(screen.getByTestId("arweave-subtab-library"));

    const items = await waitFor(() => {
      const found = screen.getAllByTestId("library-entry");
      expect(found).toHaveLength(2);
      return found;
    });
    expect(items.some((item) => item.textContent?.includes(ENTRY_ID_UNDER_FIRST))).toBe(true);
    expect(items.some((item) => item.textContent?.includes(ENTRY_ID_UNDER_SECOND))).toBe(true);

    // The progress status is gone once the rebuild has settled — never left
    // stuck visible after completion.
    expect(screen.queryByTestId("library-auto-rebuild-progress")).not.toBeInTheDocument();
  });

  it("one address's rebuild failing does not hide the other address's uploads", async () => {
    const recordSecond = {
      id: ENTRY_ID_UNDER_SECOND,
      tags: buildUploadTags({ ownerAddress: ADDRESS_SECOND, contentType: "text/plain", itemId: "item-second" }),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/wallet/")) return new Response("0", { status: 200 });
        if (url.endsWith("/graphql")) {
          const body = JSON.parse(String(init?.body)) as {
            variables: { tags: Array<{ name: string; values: string[] }> };
          };
          const ownerTag = body.variables.tags.find((t) => t.name === TAG_CODEX_OWNER);
          const owner = ownerTag?.values[0] ?? "";
          if (owner === ADDRESS_FIRST) {
            // Simulates a genuine gateway failure for this ONE address.
            return new Response(JSON.stringify({ e: "boom" }), { status: 500 });
          }
          return new Response(JSON.stringify(graphqlBody([recordSecond])), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    await renderUnlockedWiringOnArweaveRail(
      { ...emptySnapshot, foreignKeys: makeTwoConfiguredKeys() },
      makePool(),
    );
    fireEvent.click(screen.getByTestId("arweave-subtab-library"));

    const items = await waitFor(() => {
      const found = screen.getAllByTestId("library-entry");
      expect(found).toHaveLength(1);
      return found;
    });
    expect(items[0]!.textContent).toContain(ENTRY_ID_UNDER_SECOND);
  });
});
