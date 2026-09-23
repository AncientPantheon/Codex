// ============================================================================
// The App composition (D6 terminus, revised for the single-load-screen UX).
//
// The product flow is one path: no codex loaded → a clean "Load your Codex"
// upload screen; upload the encrypted backup `.json` → restore it into the
// mounted store via the REAL useCodexBackup().importFromCloud → unlock with the
// password → the full dashboard.  mount → restore → unlock → dashboard.
//
// The dashboard itself is also exercised DIRECTLY (mounted against a plaintext-
// hydrated store via the hydrateFromPlaintextSnapshot dev/test seam), so the
// real shell renders the fixture content without the encrypt/unlock round-trip.
//
//   - the export-to-JSON button calls the REAL useCodexBackup().downloadAsJson()
//     (Blob + <a>.click), asserted via the jsdom download side-effect — SYMMETRIC
//     with the upload, NOT a bespoke serializer.
//
// These tests mount the REAL provider + shell under the jsdom+RTL harness (single
// React copy, zustand inlined). They do NOT mock the codex hooks — the point is
// that the real store/shell renders the fixtures — except that the async chain
// read (URC_0027) is a caught no-op under jsdom (no node reachable), which the
// shell tolerates, so the at-rest store content still renders synchronously.
// ============================================================================

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ARWEAVE_CHAIN_ID } from "@ancientpantheon/codex-arweave/address-book";
import { CodexProvider } from "@ancientpantheon/codex-ouronet/provider";

import { App, Dashboard } from "../src/App";
import { CHAINWEB_RAIL_ID } from "../src/ForeignChainsWiring";
import { hydrateFromPlaintextSnapshot } from "../src/loadCodex";
import {
  backupJson,
  backupPassword,
  emptySnapshot,
  populatedStoaChainSnapshot,
} from "../fixtures";

/** The chain rail renders ids Capitalised for display ("arweave" -> "Arweave"),
 *  so match the id case-insensitively rather than hardcoding the display form —
 *  the id stays the single source of truth. */
const railName = (id: string) => new RegExp(`^${id}$`, "i");


afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

/**
 * Navigate a mounted dashboard to the Chainweb SEEDS surface.
 *
 * The Chainweb seed words used to be a TOP-LEVEL "Seed Words" tab. Class IA (T5)
 * collapsed the top level to three Class tabs, so that same `<SeedWordsTab />` is
 * now re-parented under Class 2: the Blockchain Accounts Class tab, then the
 * blockchain rail's `chainweb` entry, then the `Seeds` category of
 * `ChainwebPanel`. That full three-step walk is the REAL user path — the rail no
 * longer has a shortcut surface of its own outside the Class tabs (T9).
 */
async function openChainwebSeeds(
  user: ReturnType<typeof userEvent.setup>,
): Promise<HTMLElement> {
  await user.click(
    await screen.findByRole("tab", { name: /blockchain accounts/i }),
  );
  const rail = await screen.findByRole("tablist", { name: /foreign chains/i });
  await user.click(
    await within(rail).findByRole("tab", { name: railName(CHAINWEB_RAIL_ID) }),
  );
  const panel = await screen.findByTestId("chainweb-panel");
  // ChainwebPanel lands on `accounts`, so Seeds must be selected explicitly.
  await user.click(within(panel).getByTestId("chainweb-subtab-seeds"));
  // The panel's single tabpanel holds ONLY the active category's content, so
  // scoping assertions to it proves they read the Seeds surface specifically.
  return within(panel).getByRole("tabpanel");
}

describe("Dashboard — renders a plaintext-hydrated store directly (dev/test seam)", () => {
  it("mounts the populated-StoaChain fixture and renders the dashboard with the StoaChain seed entry visible (no unlock)", async () => {
    const user = userEvent.setup();
    const adapter = await hydrateFromPlaintextSnapshot(populatedStoaChainSnapshot);
    render(
      <CodexProvider adapter={adapter} deviceVariant="dev">
        <Dashboard />
      </CodexProvider>,
    );

    // The dashboard mounts directly — the Class IA tab strip (real shell) is
    // present and there is NO unlock prompt (a hydrated plaintext store has no
    // locked secrets).
    await screen.findByRole("tab", { name: /blockchain accounts/i });
    expect(screen.queryByRole("button", { name: /^unlock$/i })).toBeNull();

    // Chainweb → Seeds surfaces the fixture's ONE StoaChain seed — the index-0
    // seed renders as "Prime Codex Seed", proving the real store hydrated from
    // the fixture (not an empty codex, which shows the empty-state text).
    const seeds = await openChainwebSeeds(user);
    expect(await within(seeds).findByText(/prime codex seed/i)).toBeInTheDocument();
  });

  it("mounts the empty fixture and renders an empty codex dashboard (no StoaChain seeds)", async () => {
    const user = userEvent.setup();
    const adapter = await hydrateFromPlaintextSnapshot(emptySnapshot);
    render(
      <CodexProvider adapter={adapter} deviceVariant="dev">
        <Dashboard />
      </CodexProvider>,
    );

    const seeds = await openChainwebSeeds(user);
    // The empty fixture hydrates a valid-but-empty codex — Chainweb → Seeds shows
    // its empty state, NOT a seed count of 1.
    expect(
      await within(seeds).findByText(/no seeds in the codex/i),
    ).toBeInTheDocument();
  });
});

describe("App — encrypted backup: load screen → upload → restore → unlock → dashboard", () => {
  it("uploads the backup, restores via importFromCloud, shows the unlock screen, then the dashboard after authenticate", async () => {
    const user = userEvent.setup();
    render(<App />);

    // Upload the backup JSON via the single "Load your Codex" file input.
    const file = new File([backupJson], "codex-backup.json", {
      type: "application/json",
    });
    const fileInput = screen.getByLabelText(/load your codex/i) as HTMLInputElement;
    await user.upload(fileInput, file);

    // After restore-into-the-mounted-store, the UNLOCK screen gates the dashboard
    // (the secrets are still encrypted). The dashboard's tab strip is NOT yet
    // shown — the sequence is mount → restore → unlock → (authenticate) → dashboard.
    const passwordInput = await screen.findByLabelText(/^password$/i);
    expect(passwordInput).toHaveAttribute("type", "password");
    expect(screen.queryByRole("tab", { name: /blockchain accounts/i })).toBeNull();

    // Authenticate with the throwaway password — the real useCodexAuth path.
    await user.type(passwordInput, backupPassword);
    await user.click(screen.getByRole("button", { name: /^unlock$/i }));

    // The dashboard now renders, hydrated from the restored backup: the backup's
    // ONE StoaChain seed is present (restore mapped kadenaWallets → kadenaSeeds); the
    // index-0 seed renders as "Prime Codex Seed" under Chainweb → Seeds.
    await screen.findByRole("tab", { name: /blockchain accounts/i });
    const seeds = await openChainwebSeeds(user);
    expect(await within(seeds).findByText(/prime codex seed/i)).toBeInTheDocument();
  });

  it("surfaces a secret-free error and offers the load screen (never hangs) when a wrong-version backup is uploaded", async () => {
    // A caught unhandled rejection would leave the effect's restore-once flag set
    // with restored===false — the pin the fix removes. Fail the test if any
    // rejection escapes to the process.
    const rejections: unknown[] = [];
    const onRejection = (e: PromiseRejectionEvent): void => {
      rejections.push(e.reason);
    };
    window.addEventListener("unhandledrejection", onRejection);

    // Spy the console so we can prove the failure path logs no secret/password.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      const user = userEvent.setup();
      render(<App />);

      // A syntactically-valid but WRONG-VERSION backup — importFromCloud's own
      // parseBackupFile gate rejects it with CodexImportError at the "shape" stage.
      const badBackup = '{"version":"1.1"}';
      const file = new File([badBackup], "codex-backup.json", {
        type: "application/json",
      });
      const fileInput = screen.getByLabelText(
        /load your codex/i,
      ) as HTMLInputElement;
      await user.upload(fileInput, file);

      // (a) An error message renders (the CodexImportError message names the
      // unsupported version — secret-free).
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(/could not restore backup/i);
      expect(alert).toHaveTextContent(/unsupported version 1\.1/i);

      // (b) The app is NOT stuck on the restoring spinner, and a recovery path
      // back to the load screen is offered.
      expect(screen.queryByText(/restoring backup/i)).toBeNull();
      expect(
        screen.getByRole("button", { name: /try another file/i }),
      ).toBeInTheDocument();

      // (c) No unhandled rejection escaped, and no secret/password/raw-bytes
      // leaked to the console or the DOM. The bad-upload bytes ('1.1' payload)
      // must not be echoed; the dev password must never appear.
      expect(rejections).toEqual([]);
      const consoleText = [...errorSpy.mock.calls, ...logSpy.mock.calls]
        .flat()
        .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
        .join(" ");
      expect(consoleText).not.toContain(badBackup);
      expect(consoleText).not.toContain(backupPassword);
      expect(document.body.textContent ?? "").not.toContain(backupPassword);
    } finally {
      window.removeEventListener("unhandledrejection", onRejection);
      errorSpy.mockRestore();
      logSpy.mockRestore();
    }
  });
});

describe("Dashboard — the export-to-JSON button reuses the REAL useCodexBackup().downloadAsJson", () => {
  it("triggers the browser download side-effect (Blob + <a>.click) when clicked in the dashboard context", async () => {
    const user = userEvent.setup();

    // Spy the browser download primitives the REAL downloadAsJson drives. If the
    // button called a bespoke serializer instead of the hook, these would not fire.
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:mock");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    // Mount the dashboard directly against a hydrated store so the export button
    // is reachable without the encrypt/unlock round-trip.
    const adapter = await hydrateFromPlaintextSnapshot(populatedStoaChainSnapshot);
    render(
      <CodexProvider adapter={adapter} deviceVariant="dev">
        <Dashboard />
      </CodexProvider>,
    );
    await screen.findByRole("tab", { name: /blockchain accounts/i });

    const exportBtn = screen.getByRole("button", { name: /export.*json/i });
    await user.click(exportBtn);

    // The real hook serialized the current store to a Blob URL and clicked a
    // download anchor — the export path went through useCodexBackup, not a fork.
    await waitFor(() => {
      expect(createObjectURL).toHaveBeenCalledTimes(1);
      expect(anchorClick).toHaveBeenCalledTimes(1);
    });
    const blobArg = createObjectURL.mock.calls[0][0] as Blob;
    expect(blobArg).toBeInstanceOf(Blob);
    expect(blobArg.type).toBe("application/json");
  });
});

describe("Dashboard — the Arweave mode toggle is gone (Settings-page cleanup round)", () => {
  // WHY (history): `arweaveMode` was first hardcoded to mock entirely
  // (commit 12c135d0, no toggle mounted anywhere) — real mode was
  // UNREACHABLE. That was fixed by restoring the toggle. Later, the owner
  // relocated the raw/unstyled toggle into Settings rather than removing it.
  // This latest round removed it ENTIRELY (owner directive: "that mockup bad
  // text arweave blockchain selector... it's got no purpose any more, I
  // don't want it showing in production") — real mode is now simply the
  // fixed default (`network.arweaveMode ?? ARWEAVE_WIRING_MODE_REAL`), with
  // no user-facing control left anywhere. The proper, already-styled
  // Settings → Network card's per-chain URL field is the sole remaining way
  // to edit the Arweave gateway.
  it("the 'Arweave mode' region is not present on the Accounts view OR the Settings view", async () => {
    const user = userEvent.setup();
    const adapter = await hydrateFromPlaintextSnapshot(emptySnapshot);
    render(
      <CodexProvider adapter={adapter} deviceVariant="dev">
        <Dashboard />
      </CodexProvider>,
    );

    await screen.findByRole("tab", { name: /blockchain accounts/i });
    expect(screen.queryByRole("region", { name: /arweave mode/i })).toBeNull();

    await user.click(screen.getByRole("tab", { name: /codex ui settings/i }));
    await screen.findByText(/network/i);
    expect(screen.queryByRole("region", { name: /arweave mode/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /switch to (mock|real)/i })).toBeNull();
  });

  it("a prior session's persisted arweaveMode:'mock' still applies internally (the underlying default/persistence is unchanged — only the UI control is gone)", async () => {
    window.localStorage.setItem(
      "codex-playground:network-settings",
      JSON.stringify({
        pythiaUrl: "",
        stoaChainNodeUrl: "",
        arweaveGatewayUrl: "https://arweave.net",
        arweaveMode: "mock",
      }),
    );

    const adapter = await hydrateFromPlaintextSnapshot(emptySnapshot);
    render(
      <CodexProvider adapter={adapter} deviceVariant="dev">
        <Dashboard />
      </CodexProvider>,
    );

    // Renders without throwing and reaches the normal dashboard — no crash
    // from the now-unreachable "mock" mode persisting with no toggle to
    // display it.
    await screen.findByRole("tab", { name: /blockchain accounts/i });
  });
});

describe("Dashboard — relabeling a watched Arweave address updates it in place", () => {
  it("does not duplicate the row: watch an address, then set its label, and exactly one row remains for that address", async () => {
    // WHY: ForeignChainsWiring's addWatchedAddress ALWAYS minted a fresh
    // crypto.randomUUID() id, for both the genuine "add new address" call
    // (ArweaveAccountsArea's Watch button) AND the "relabel" call (WatchedRow's
    // inline label editor reuses the same onAddWatched prop, per its own
    // upsert-by-id-semantics intent). Since the store's addWatchListEntry
    // upserts BY ID, and relabel never reused the original entry's id, every
    // relabel silently created a SECOND watch-list entry for the same address
    // instead of updating the first — the address then appears twice, one
    // unlabeled, one with the new label.
    const user = userEvent.setup();
    const adapter = await hydrateFromPlaintextSnapshot(emptySnapshot);
    render(
      <CodexProvider adapter={adapter} deviceVariant="dev">
        <Dashboard />
      </CodexProvider>,
    );

    await user.click(await screen.findByRole("tab", { name: /blockchain accounts/i }));
    const rail = await screen.findByRole("tablist", { name: /foreign chains/i });
    await user.click(within(rail).getByRole("tab", { name: railName(ARWEAVE_CHAIN_ID) }));
    await user.click(await screen.findByTestId("arweave-accounts-subtab-watch"));

    const address = "kvxXYE6q7v6LrmQJLBEQZ2abWDdVyjQDERqM1YeMvf0";
    await user.type(screen.getByTestId("arweave-watch-input"), address);
    await user.click(screen.getByTestId("arweave-watch-submit"));

    // Round 19 owner correction ("the arweave account must be shorted same
    // as stoa accounts, first 3 last 3 characters coloured, and ... in the
    // middle") means the row's address now renders as 3 sibling spans
    // (head/mid/tail), not one text node — RTL's `getByText` doesn't match
    // text split across elements by default. This matcher targets the
    // element whose own FULL (concatenated-children) text is exactly the
    // address — `ArweaveAddressHighlight`'s own outer wrapper span.
    const byAddressText = (_: string, element: Element | null) => element?.textContent === address;

    await waitFor(() => {
      expect(screen.getAllByText(byAddressText)).toHaveLength(1);
    });

    // Set a label on the now-single row.
    await user.click(screen.getByText("(set label)"));
    await user.type(screen.getByTestId(/^arweave-watched-label-input-/), "BigMoney");
    await user.click(screen.getByTestId(/^arweave-watched-label-save-/));

    await waitFor(() => {
      expect(screen.getByText("BigMoney")).toBeInTheDocument();
    });

    // The address must still appear exactly once — relabeling updated the
    // SAME row, it did not create a second one.
    expect(screen.getAllByText(byAddressText)).toHaveLength(1);
  });
});

describe("Dashboard — Class 2 is wired into the REAL shell (not a second, parallel surface)", () => {
  it("reveals the chainweb AND arweave rail entries when the Blockchain Accounts Class tab is selected", async () => {
    // WHY: the shell used to render a BARE <CodexTabs /> — no foreignChains /
    // foreignChainPanels — so Blockchain Accounts showed "No foreign chains."
    // while the working rail lived in a SEPARATE section below it. Two
    // disconnected surfaces. This is the guard that the Class 2 tab a user
    // actually clicks in the dashboard is the one carrying the wired rail: it
    // fails the moment anyone reverts to an unwired <CodexTabs />.
    const user = userEvent.setup();
    const adapter = await hydrateFromPlaintextSnapshot(emptySnapshot);
    render(
      <CodexProvider adapter={adapter} deviceVariant="dev">
        <Dashboard />
      </CodexProvider>,
    );

    // The rail is INSIDE Class 2's panel, and the shell mounts only the active
    // Class tab's content — so on the landing tab there must be no rail at all.
    // A rail visible here means it is mounted as a SECOND, parallel surface.
    expect(screen.queryByRole("tablist", { name: /foreign chains/i })).toBeNull();

    await user.click(
      await screen.findByRole("tab", { name: /blockchain accounts/i }),
    );

    const rail = await screen.findByRole("tablist", { name: /foreign chains/i });
    expect(
      within(rail).getByRole("tab", { name: railName(CHAINWEB_RAIL_ID) }),
    ).toBeInTheDocument();
    expect(
      within(rail).getByRole("tab", { name: railName(ARWEAVE_CHAIN_ID) }),
    ).toBeInTheDocument();
    // The empty state of an unwired Class 2 must be gone, not merely shadowed.
    expect(screen.queryByText(/no foreign chains\./i)).toBeNull();
  });

  it("can actually add a watched Arweave address end to end from the real mounted app", async () => {
    // WHY: ArweaveAccountsArea's "Watch" button calls validateAddress(ARWEAVE_CHAIN_ID, ...),
    // which throws UnknownChainError unless registerArweaveAddressValidator() has run
    // somewhere in this app's real boot path first. The ONLY place that call existed was
    // packages/codex/src/ui/CodexTabsWired.tsx — a composition this playground app does
    // NOT depend on or import (it has its own composition, ForeignChainsWiring.tsx).
    // So the button was unconditionally broken end to end despite passing every isolated
    // component/unit test (which either mock validateAddress or never exercise the real
    // registry). This test mounts the REAL app tree and drives the REAL click, the only
    // way this class of gap reliably surfaces.
    const user = userEvent.setup();
    const adapter = await hydrateFromPlaintextSnapshot(emptySnapshot);
    render(
      <CodexProvider adapter={adapter} deviceVariant="dev">
        <Dashboard />
      </CodexProvider>,
    );

    await user.click(
      await screen.findByRole("tab", { name: /blockchain accounts/i }),
    );
    const rail = await screen.findByRole("tablist", { name: /foreign chains/i });
    await user.click(
      within(rail).getByRole("tab", { name: railName(ARWEAVE_CHAIN_ID) }),
    );

    await user.click(await screen.findByTestId("arweave-accounts-subtab-watch"));

    const submit = await screen.findByTestId("arweave-watch-submit");
    expect((submit as HTMLButtonElement).disabled).toBe(false);

    const input = screen.getByTestId("arweave-watch-input");
    await user.type(input, "tzXauR_QBlPW3ZRey3xBzaiDqPqLfiqWk1SWmk2BjM4");
    await user.click(submit);

    await waitFor(() => {
      expect(
        screen.queryByTestId("arweave-accounts-watched-empty"),
      ).toBeNull();
    });
  });
});
