/**
 * RED matrix for the "Codex ID" page's extraction into a standalone,
 * reusable component (`CodexIdPage`), independent of `ArweavePanel`'s own
 * tab-bar/category-switching machinery.
 *
 * The real-world motivation: a top-level nav entry (`apps/codex-playground`'s
 * desktop `.cxpg-viewtabs` row + mobile `CodexTierTwoMenu`) needs to render
 * this SAME page directly, without going three clicks deep through
 * `ArweavePanel`'s own Blockchain Accounts -> Arweave -> Codex ID tabs. This
 * only works if the page's content/behaviour is identical whether reached
 * via `ArweavePanel`'s own `active === "codex-id"` branch (unchanged, see
 * `e4-panel-codex-id.test.tsx`) or mounted directly as `<CodexIdPage />`.
 *
 * `CodexIdPage` takes the SAME `deps: ArweavePanelDeps | null` shape
 * `ArweavePanel` itself already reads out of `ArweavePanelContext` — no new,
 * narrower prop surface was invented, so a host that already has an
 * `ArweavePanelDeps` bundle (every host does, to mount `ArweavePanel` at
 * all) can mount this page with literally the same object.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, within, cleanup, fireEvent, waitFor } from "@testing-library/react";

import type { ArweaveJwk, GatewayPool } from "@ancientpantheon/arweave-core";

import {
  ARWEAVE_RESTORE_ELIGIBLE_MESSAGE,
  ARWEAVE_RESTORE_NOT_ELIGIBLE_MESSAGE,
} from "../src/panel/ArweaveRestoreEligibilityStatus";
import { CodexIdPage } from "../src/panel/CodexIdPage";
import type { ArweavePanelDeps } from "../src/panel/context";
import { ARWEAVE_CHAIN_ID } from "../src/address-book/chainId";

import throwawayKeyfile from "./fixtures/throwaway-arweave-keyfile.json" assert { type: "json" };

const ARWEAVE_ADDRESS = "tzXauR_QBlPW3ZRey3xBzaiDqPqLfiqWk1SWmk2BjM4";
const fixtureJwk = throwawayKeyfile as unknown as ArweaveJwk;
const fakePool = { pick: () => ARWEAVE_ADDRESS } as unknown as GatewayPool;

function makeDeps(overrides: Partial<ArweavePanelDeps> = {}): ArweavePanelDeps {
  return {
    address: ARWEAVE_ADDRESS,
    foreignKeys: [],
    keygenRunner: { runKeygen: vi.fn(async () => fixtureJwk) },
    generateArweaveKey: vi.fn(async () => ({
      id: ARWEAVE_ADDRESS,
      chainId: ARWEAVE_CHAIN_ID,
      encryptedKeyfile: "CIPHERTEXT",
      label: "key",
    })),
    importArweaveKey: vi.fn(async () => ({
      id: ARWEAVE_ADDRESS,
      chainId: ARWEAVE_CHAIN_ID,
      encryptedKeyfile: "CIPHERTEXT",
      label: "key",
    })),
    decryptArweaveKey: vi.fn(async () => fixtureJwk),
    addForeignKey: vi.fn(async () => {}),
    renameForeignKey: vi.fn(async () => {}),
    deleteForeignKey: vi.fn(async () => {}),
    getBalance: vi.fn(async () => 0n),
    send: vi.fn(async () => ({ id: ARWEAVE_ADDRESS, reward: 0n })),
    sendFrom: vi.fn(async () => ({ id: ARWEAVE_ADDRESS, reward: 0n })),
    estimateFee: vi.fn(async () => 0n),
    pollStatus: vi.fn(async () => "final" as const),
    uploadAndTrack: vi.fn(async () => ({
      id: "item-id",
      itemId: "codex-item-1",
      ownerAddress: ARWEAVE_ADDRESS,
      tags: [],
    })),
    uploadFilesAndTrack: vi.fn(async () => ({
      manifestId: "manifest-id",
      fileIds: [],
      uploadId: "upload-id",
    })),
    getExportJson: vi.fn(async () => "{}"),
    backupCodex: vi.fn(async () => ({ id: "backup-id" })),
    listLibrary: vi.fn(async () => []),
    openUrl: vi.fn((id: string) => `https://arweave.net/${id}`),
    rebuildLibrary: vi.fn(async () => {}),
    libraryStore: {
      append: vi.fn(async () => {}),
      get: vi.fn(async () => undefined),
      updateStatus: vi.fn(async () => {}),
      list: vi.fn(async () => []),
    } as unknown as ArweavePanelDeps["libraryStore"],
    pool: fakePool,
    addressBook: [],
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe("CodexIdPage — standalone, direct mount (no ArweavePanel tab bar involved)", () => {
  it("renders the same page shell testid as ArweavePanel's deep-link codex-id branch", () => {
    render(<CodexIdPage deps={makeDeps()} />);
    expect(screen.getByTestId("arweave-codex-id-page")).toBeInTheDocument();
  });

  it("shows the real eligibility status for an ELIGIBLE codex, with no second implementation", async () => {
    render(
      <CodexIdPage deps={makeDeps({ checkArweaveRestoreEligibility: vi.fn(async () => true) })} />,
    );
    await waitFor(() =>
      expect(screen.getByText(ARWEAVE_RESTORE_ELIGIBLE_MESSAGE)).toBeInTheDocument(),
    );
    expect(screen.queryByText(ARWEAVE_RESTORE_NOT_ELIGIBLE_MESSAGE)).not.toBeInTheDocument();
    expect(screen.getByTestId("arweave-codex-id-already-eligible")).toBeInTheDocument();
    expect(screen.queryByTestId("arweave-codex-id-make-eligible")).toBeNull();
  });

  it("shows the real eligibility status for a NOT-eligible codex, with the disabled 'make eligible' button and its honest messaging", async () => {
    render(
      <CodexIdPage deps={makeDeps({ checkArweaveRestoreEligibility: vi.fn(async () => false) })} />,
    );
    await waitFor(() =>
      expect(screen.getByText(ARWEAVE_RESTORE_NOT_ELIGIBLE_MESSAGE)).toBeInTheDocument(),
    );
    const makeEligible = screen.getByTestId("arweave-codex-id-make-eligible");
    expect(makeEligible).toBeDisabled();
    expect(makeEligible).toHaveTextContent(/coming soon/i);
  });

  it("the real backup trigger opens a popup wired to the injected getExportJson/backupCodex seams, once eligible", async () => {
    const exportJson = '{"labels":["seed-1"]}';
    const resultId = "aXcDefGhIjKlMnOpQrStUvWxYz0123456789_-ABCDE";
    const getExportJson = vi.fn(async () => exportJson);
    const backupCodex = vi.fn(async (_json: string) => ({ id: resultId }));
    render(
      <CodexIdPage
        deps={makeDeps({
          getExportJson,
          backupCodex,
          checkArweaveRestoreEligibility: vi.fn(async () => true),
        })}
      />,
    );

    const page = screen.getByTestId("arweave-codex-id-page");
    const trigger = await within(page).findByTestId("codex-backup-wizard-open");
    await waitFor(() => expect(trigger).toBeEnabled());

    fireEvent.click(trigger);
    const modal = screen.getByTestId("codex-backup-wizard-modal");
    fireEvent.click(within(modal).getByTestId("codex-backup-start"));
    fireEvent.click(await within(modal).findByTestId("codex-backup-permanence-accept"));
    await waitFor(() => expect(backupCodex).toHaveBeenCalledWith(exportJson));

    const result = await within(modal).findByTestId("codex-backup-result");
    expect(result.textContent).toContain(resultId);
  });

  it("the backup trigger is disabled until eligible — the real backend throws otherwise", async () => {
    render(
      <CodexIdPage deps={makeDeps({ checkArweaveRestoreEligibility: vi.fn(async () => false) })} />,
    );
    const page = screen.getByTestId("arweave-codex-id-page");
    await waitFor(() =>
      expect(within(page).getByTestId("codex-backup-wizard-open")).toBeDisabled(),
    );
  });

  it("renders all three informatics tabs (T2's components, now split), composed unmodified", () => {
    render(<CodexIdPage deps={makeDeps()} />);
    expect(screen.getByTestId("codex-backup-informatics")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("codex-id-informatics-tab-encryption"));
    expect(screen.getByTestId("codex-encryption-informatics")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("codex-id-informatics-tab-migration"));
    expect(screen.getByTestId("codex-migration-informatics")).toBeInTheDocument();
  });

  it("degrades honestly (no crash) when mounted with deps === null — mirrors ArweavePanel's own no-provider tolerance", () => {
    render(<CodexIdPage deps={null} />);
    expect(screen.getByTestId("arweave-codex-id-page")).toBeInTheDocument();
    expect(screen.getByTestId("arweave-codex-id-backup-unavailable")).toBeInTheDocument();
  });
});
