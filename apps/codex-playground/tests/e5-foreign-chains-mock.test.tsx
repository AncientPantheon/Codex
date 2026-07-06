// ============================================================================
// RED SPEC (T15.5) — the PG-01 render matrix: the wired Foreign Chains tab +
// the Arweave subtab + the 5 ArweavePanel areas rendered against the MOCK
// adapter + injected fake seams, with NO real key and NO network.
//
// These tests DRIVE the not-yet-existing GREEN wiring (T15.4):
//   - `../src/mockArweaveAdapter`   — the mock ForeignChainAdapter + fake seams
//   - `../src/ForeignChainsWiring`  — builds the registry, wires
//                                     foreignChainPanels[ARWEAVE_CHAIN_ID] =
//                                     ArweavePanel, provides the panel context
// so the dominant RED failure is "module ../src/ForeignChainsWiring does not
// exist" (right reason) — NOT a harness/fixture/alias resolution error (the
// T15.2 aliases + T15.3 fixtures + the E4 seams must all resolve cleanly).
//
// The mock adapter returns a FIXED fake Winston balance of 1_500_000_000_000n,
// which `winstonToAr` renders as the bare token "1.5" — the deterministic
// no-network anchor the balance-area assertion drives off (NOT a hardcoded
// literal unrelated to the input).
// ============================================================================

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { winstonToAr } from "@ancientpantheon/arweave-core";
import { ARWEAVE_CHAIN_ID } from "@ancientpantheon/codex-arweave/address-book";

// The not-yet-existing GREEN wiring (T15.4). Importing it is what makes this
// file RED until T15.4 lands. `ForeignChainsWiring` mounts the generic
// ForeignChainsTab wired with the mock Arweave adapter + the fake panel context.
import { ForeignChainsWiring } from "../src/ForeignChainsWiring";
// The fixed fake balance the mock adapter resolves — the balance-area token is
// `winstonToAr(MOCK_FAKE_BALANCE_WINSTON)`, so the render assertion is driven
// from this input, not an unrelated constant.
import { MOCK_FAKE_BALANCE_WINSTON } from "../src/mockArweaveAdapter";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Render the wired Foreign Chains tab and select the Arweave subtab. Returns
 *  the user-event handle so each test can drive the panel's own subtabs. */
async function renderWiredForeignChainsTab() {
  const user = userEvent.setup();
  render(<ForeignChainsWiring />);
  // The tab strip dispatches an Arweave subtab keyed by ARWEAVE_CHAIN_ID (the
  // generic tab is id-blind — the id text on the tab IS the chain id string).
  const arweaveTab = await screen.findByRole("tab", { name: ARWEAVE_CHAIN_ID });
  await user.click(arweaveTab);
  return { user };
}

describe("PG-01 — the wired Foreign Chains tab dispatches the Arweave subtab", () => {
  it("renders a subtab keyed by ARWEAVE_CHAIN_ID (dispatched from the injected foreignChains list)", async () => {
    render(<ForeignChainsWiring />);
    // The subtab label is the injected id (the generic strip renders `id`), so a
    // tab named ARWEAVE_CHAIN_ID proves the mock adapter's id reached the list.
    expect(
      await screen.findByRole("tab", { name: ARWEAVE_CHAIN_ID }),
    ).toBeInTheDocument();
  });

  it("renders the ArweavePanel when the Arweave subtab is selected", async () => {
    await renderWiredForeignChainsTab();
    // The panel roots a `data-testid="arweave-panel"` node carrying the chain id
    // — selecting the subtab dispatched the ArweavePanel into the slot.
    const panel = await screen.findByTestId("arweave-panel");
    expect(panel).toHaveAttribute("data-chain-id", ARWEAVE_CHAIN_ID);
  });
});

describe("PG-01 — the 5 ArweavePanel areas render against the mock adapter + fakes", () => {
  it("keyring area lists the fake foreign key entry (no real key)", async () => {
    const { user } = await renderWiredForeignChainsTab();
    await user.click(await screen.findByTestId("arweave-subtab-keyring"));
    const keyring = await screen.findByTestId("keyring-area");
    // The fake keyring is seeded with >=1 entry, so the area shows the list, NOT
    // the empty state. A disconnected wiring would render `keyring-empty`.
    expect(
      within(keyring).queryByTestId("keyring-empty"),
    ).not.toBeInTheDocument();
    expect(within(keyring).getByRole("listitem")).toBeInTheDocument();
  });

  it("balance area shows the fake Winston as the winstonToAr display token '1.5'", async () => {
    const { user } = await renderWiredForeignChainsTab();
    await user.click(await screen.findByTestId("arweave-subtab-balance"));
    // The mock getBalance resolves MOCK_FAKE_BALANCE_WINSTON; the area renders the
    // BARE winstonToAr token. Driving the expectation from the input (not "1.5"
    // hardcoded) fails if the mock balance or the display conversion drifts.
    const expectedToken = winstonToAr(MOCK_FAKE_BALANCE_WINSTON);
    expect(await screen.findByTestId("balance-amount")).toHaveTextContent(
      expectedToken,
    );
    expect(screen.getByTestId("balance-unit")).toHaveTextContent("AR");
  });

  it("send area renders the fee-cap form (the mandatory fee cap input)", async () => {
    const { user } = await renderWiredForeignChainsTab();
    await user.click(await screen.findByTestId("arweave-subtab-send"));
    // The fee-cap input is the funds-critical field the Send area gates every
    // transfer behind — its presence proves the real SendArea mounted.
    expect(await screen.findByTestId("send-cap-input")).toBeInTheDocument();
    expect(screen.getByTestId("send-submit")).toBeInTheDocument();
  });

  it("upload area surfaces the permanence warning on confirm (E3 UPLOAD_PERMANENCE_WARNING)", async () => {
    const { user } = await renderWiredForeignChainsTab();
    await user.click(await screen.findByTestId("arweave-subtab-upload"));
    // The permanence confirm gate (verbatim E3 warning) is the mandatory step the
    // Upload area renders before any upload — the file picker + start control mount.
    expect(await screen.findByTestId("upload-file-input")).toBeInTheDocument();
    expect(screen.getByTestId("upload-start")).toBeInTheDocument();
  });

  it("library area renders the MemoryLibraryStore-backed list (empty state after load, no network)", async () => {
    const { user } = await renderWiredForeignChainsTab();
    await user.click(await screen.findByTestId("arweave-subtab-library"));
    const library = await screen.findByTestId("library-area");
    // A fresh MemoryLibraryStore lists zero owned entries, so the area resolves to
    // its loaded empty state — proving the injected fake store seam is wired and
    // was queried (not a crash / null store).
    expect(
      await within(library).findByTestId("library-empty"),
    ).toBeInTheDocument();
  });
});

describe("PG-01 — no real key / no network (deterministic fakes)", () => {
  it("does not invoke window.fetch while rendering the panel + all 5 areas", async () => {
    // A live-network render would call fetch; the deterministic fakes never do.
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { user } = await renderWiredForeignChainsTab();
    for (const sub of ["keyring", "balance", "send", "upload", "library"]) {
      await user.click(await screen.findByTestId(`arweave-subtab-${sub}`));
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("PG-01 — id-blind gate: the generic tab source carries no 'arweave' literal", () => {
  it("has no hardcoded 'arweave' string in the codex-ui ForeignChainsTab source", () => {
    // The chain id literal lives ONLY in the app's mock/wiring (and the codex-
    // arweave address-book const) — never in the GENERIC codex-ui tab, which must
    // dispatch purely off the injected `foreignChains`/`foreignChainPanels` props.
    // A regression that special-cases "arweave" in the generic layer fails here.
    const tabSource = readFileSync(
      resolve(
        __dirname,
        "../../../packages/codex-ui/src/ui/foreign-chains/ForeignChainsTab.tsx",
      ),
      "utf8",
    );
    expect(tabSource).not.toContain("arweave");
  });
});
