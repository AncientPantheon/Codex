/**
 * RED matrix for the Arweave panel CODEX BACKUPS HISTORY area
 * (`CodexBackupHistoryArea`, arweave-upload-categories addendum, Part 2).
 *
 * A dedicated, filtered view over the SAME Library data `LibraryArea` already
 * lists — no new store/seam, no `LibraryEntry` schema change: `Codex-Category`
 * is read straight off each entry's existing `tags` array. Pins the contract:
 * list ONLY `Codex-Category: codex-backup`-tagged entries, newest-first
 * (mirrors `LibraryArea`'s own sort convention); show a "version" label
 * derived from `Codex-App-Version` when present, falling back to something
 * legible (createdAt/status) when absent (pre-lineage backups, or exports
 * whose `lastUpdatedAt` was missing); a working direct link via the SAME
 * `openUrl(id,{pool})` seam `LibraryArea`/`UploadArea` already use; and
 * entries sharing the same `Codex-App-Id` are visually identifiable as one
 * lineage (not a flat, unlabeled list).
 *
 * FAILS RED because `../src/panel/CodexBackupHistoryArea` does not exist yet.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";

import { CodexBackupHistoryArea } from "../src/panel/CodexBackupHistoryArea";
import type { LibraryEntry } from "../src/library/types";

const OWNER = "tzXauR_QBlPW3ZRey3xBzaiDqPqLfiqWk1SWmk2BjM4";
const HEALTHY_ENDPOINT = "https://healthy.example";
const ID_BACKUP_NEW = "bkpNewbkpNewbkpNewbkpNewbkpNewbkpNewbkpNewbk";
const ID_BACKUP_OLD = "bkpOldbkpOldbkpOldbkpOldbkpOldbkpOldbkpOldbk";
const ID_NON_BACKUP = "notBkpnotBkpnotBkpnotBkpnotBkpnotBkpnotBkpno";

function makeEntry(overrides: Partial<LibraryEntry>): LibraryEntry {
  return {
    id: "id",
    owner: OWNER,
    itemId: "item",
    contentType: "application/json",
    status: "final",
    createdAt: 0,
    tags: [],
    ...overrides,
  };
}

function backupEntry(overrides: Partial<LibraryEntry> = {}): LibraryEntry {
  return makeEntry({
    tags: [{ name: "Codex-Category", value: "codex-backup" }],
    ...overrides,
  });
}

function makePool() {
  return {
    getHealthSnapshot: () => [{ endpoint: HEALTHY_ENDPOINT, healthy: true, active: true }],
    getActiveEndpoint: () => HEALTHY_ENDPOINT,
    execute: vi.fn(),
  };
}

function makeProps(overrides: Record<string, unknown> = {}) {
  const pool = makePool();
  return {
    owner: OWNER,
    pool,
    listLibrary: vi.fn(async (): Promise<LibraryEntry[]> => [
      backupEntry({ id: ID_BACKUP_NEW, createdAt: 200 }),
      backupEntry({ id: ID_BACKUP_OLD, createdAt: 100 }),
      makeEntry({ id: ID_NON_BACKUP, createdAt: 300, tags: [] }),
    ]),
    openUrl: vi.fn((id: string) => `${HEALTHY_ENDPOINT}/${id}`),
    ...overrides,
  };
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CodexBackupHistoryArea — filters to codex-backup-tagged entries only", () => {
  it("lists only entries whose tags include Codex-Category: codex-backup, excluding other Library entries", async () => {
    render(<CodexBackupHistoryArea {...makeProps()} />);

    const items = await screen.findAllByTestId("codex-backup-history-entry");
    expect(items).toHaveLength(2);
    const ids = items.map((el) => el.textContent);
    expect(ids.some((t) => t?.includes(ID_NON_BACKUP))).toBe(false);
  });

  it("orders the filtered entries newest-first by createdAt", async () => {
    render(<CodexBackupHistoryArea {...makeProps()} />);

    const items = await screen.findAllByTestId("codex-backup-history-entry");
    expect(items[0].textContent).toContain(ID_BACKUP_NEW);
    expect(items[1].textContent).toContain(ID_BACKUP_OLD);
  });

  it("shows an empty state when the owner has no codex-backup entries", async () => {
    const props = makeProps({
      listLibrary: vi.fn(async (): Promise<LibraryEntry[]> => [
        makeEntry({ id: ID_NON_BACKUP, tags: [] }),
      ]),
    });
    render(<CodexBackupHistoryArea {...props} />);

    expect(await screen.findByTestId("codex-backup-history-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("codex-backup-history-entry")).toBeNull();
  });
});

describe("CodexBackupHistoryArea — version label", () => {
  it("shows the Codex-App-Version tag value when present", async () => {
    const props = makeProps({
      listLibrary: vi.fn(async (): Promise<LibraryEntry[]> => [
        backupEntry({
          id: ID_BACKUP_NEW,
          createdAt: 200,
          tags: [
            { name: "Codex-Category", value: "codex-backup" },
            { name: "Codex-App-Version", value: "2026-09-30T00:00:00.000Z" },
          ],
        }),
      ]),
    });
    render(<CodexBackupHistoryArea {...props} />);

    const entry = (await screen.findAllByTestId("codex-backup-history-entry"))[0];
    expect(within(entry).getByTestId("codex-backup-history-version").textContent).toContain(
      "2026-09-30T00:00:00.000Z",
    );
  });

  it("falls back to a legible label (not blank, not the raw tag miss) when Codex-App-Version is absent", async () => {
    const props = makeProps({
      listLibrary: vi.fn(async (): Promise<LibraryEntry[]> => [
        backupEntry({ id: ID_BACKUP_OLD, createdAt: 100, status: "pending" }),
      ]),
    });
    render(<CodexBackupHistoryArea {...props} />);

    const entry = (await screen.findAllByTestId("codex-backup-history-entry"))[0];
    const versionText = within(entry).getByTestId("codex-backup-history-version").textContent;
    expect(versionText).toBeTruthy();
    expect(versionText?.length).toBeGreaterThan(0);
  });
});

describe("CodexBackupHistoryArea — direct link via the shared openUrl seam", () => {
  it("composes each entry's link via the injected openUrl(id,{pool})", async () => {
    const props = makeProps();
    render(<CodexBackupHistoryArea {...props} />);
    await screen.findAllByTestId("codex-backup-history-entry");

    const link = screen.getAllByTestId("codex-backup-history-open-link")[0];
    expect(props.openUrl).toHaveBeenCalledWith(ID_BACKUP_NEW, expect.objectContaining({ pool: props.pool }));
    expect(link).toHaveAttribute("href", `${HEALTHY_ENDPOINT}/${ID_BACKUP_NEW}`);
  });
});

describe("CodexBackupHistoryArea — same Codex-App-Id lineage is visually identifiable", () => {
  it("entries sharing the same Codex-App-Id show a matching lineage label; entries with no Codex-App-Id show none", async () => {
    const props = makeProps({
      listLibrary: vi.fn(async (): Promise<LibraryEntry[]> => [
        backupEntry({
          id: ID_BACKUP_NEW,
          createdAt: 200,
          tags: [
            { name: "Codex-Category", value: "codex-backup" },
            { name: "Codex-App-Id", value: "codex-alice" },
          ],
        }),
        backupEntry({
          id: ID_BACKUP_OLD,
          createdAt: 100,
          tags: [
            { name: "Codex-Category", value: "codex-backup" },
            { name: "Codex-App-Id", value: "codex-alice" },
          ],
        }),
      ]),
    });
    render(<CodexBackupHistoryArea {...props} />);

    const items = await screen.findAllByTestId("codex-backup-history-entry");
    const badgeA = within(items[0]).getByTestId("codex-backup-history-lineage");
    const badgeB = within(items[1]).getByTestId("codex-backup-history-lineage");
    expect(badgeA.textContent).toContain("codex-alice");
    expect(badgeA.textContent).toBe(badgeB.textContent);
  });

  it("an entry with no Codex-App-Id tag renders no lineage badge", async () => {
    const props = makeProps({
      listLibrary: vi.fn(async (): Promise<LibraryEntry[]> => [
        backupEntry({ id: ID_BACKUP_NEW, createdAt: 200 }),
      ]),
    });
    render(<CodexBackupHistoryArea {...props} />);

    const entry = (await screen.findAllByTestId("codex-backup-history-entry"))[0];
    expect(within(entry).queryByTestId("codex-backup-history-lineage")).toBeNull();
  });
});
