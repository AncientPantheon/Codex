/**
 * RED matrix for `LibraryAutoRebuildProgress` — the visible, non-blocking
 * status pill shown while the multi-address auto-rebuild-on-unlock
 * (`arweave-auto-rebuild-on-unlock`) runs.
 *
 * Pins:
 *   - `progress === null` renders NOTHING (the component's own "disappear
 *     once the rebuild completes" contract — no separate "hide" prop, no
 *     leftover empty wrapper element);
 *   - a non-null progress renders a REAL, informative status reflecting the
 *     actual numbers handed in (not a hardcoded string, not a fake/animated
 *     placeholder) — "address N of M" + the running pages/records counts;
 *   - it re-renders to nothing the moment `progress` flips back to `null`
 *     (same component instance, proving "disappear" is driven by the prop,
 *     not a mount/unmount the host happens to do).
 *
 * RED: `../src/panel/LibraryAutoRebuildProgress` does not exist yet.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { LibraryAutoRebuildProgress } from "../src/panel/LibraryAutoRebuildProgress";
import type { MultiOwnerRebuildProgress } from "../src/library/rebuild.js";

beforeEach(() => {
  cleanup();
});

describe("LibraryAutoRebuildProgress — hidden while no auto-rebuild is running", () => {
  it("renders nothing when progress is null", () => {
    const { container } = render(<LibraryAutoRebuildProgress progress={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("LibraryAutoRebuildProgress — visible, real progress while running", () => {
  it("shows the CURRENT owner (1-based) of the total, plus the running pages/records counts", () => {
    const progress: MultiOwnerRebuildProgress = {
      ownerIndex: 0,
      totalOwners: 3,
      currentOwnerProgress: { pagesFetched: 2, recordsFound: 14 },
    };
    render(<LibraryAutoRebuildProgress progress={progress} />);

    const status = screen.getByTestId("library-auto-rebuild-progress");
    expect(status).toBeInTheDocument();
    // Real numbers from the prop — "address 1 of 3" (ownerIndex is 0-based).
    expect(status.textContent).toMatch(/1 of 3/);
    expect(status.textContent).toMatch(/2/);
    expect(status.textContent).toMatch(/14/);
  });

  it("reflects a DIFFERENT owner/counts on a later progress event — never a hardcoded string", () => {
    const progress: MultiOwnerRebuildProgress = {
      ownerIndex: 2,
      totalOwners: 5,
      currentOwnerProgress: { pagesFetched: 7, recordsFound: 103 },
    };
    render(<LibraryAutoRebuildProgress progress={progress} />);

    const status = screen.getByTestId("library-auto-rebuild-progress");
    expect(status.textContent).toMatch(/3 of 5/);
    expect(status.textContent).toMatch(/7/);
    expect(status.textContent).toMatch(/103/);
  });
});

describe("LibraryAutoRebuildProgress — disappears once the rebuild completes", () => {
  it("re-rendering the SAME component with progress:null removes the status", () => {
    const { rerender } = render(
      <LibraryAutoRebuildProgress
        progress={{ ownerIndex: 0, totalOwners: 1, currentOwnerProgress: { pagesFetched: 1, recordsFound: 1 } }}
      />,
    );
    expect(screen.getByTestId("library-auto-rebuild-progress")).toBeInTheDocument();

    rerender(<LibraryAutoRebuildProgress progress={null} />);

    expect(screen.queryByTestId("library-auto-rebuild-progress")).not.toBeInTheDocument();
  });
});
