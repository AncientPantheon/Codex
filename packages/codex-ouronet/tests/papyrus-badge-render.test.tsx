/**
 * The Papyrus badge, RENDERED. The sibling `papyrus-designation.test.ts`
 * asserts over source; this one proves the thing actually appears, because a
 * source assertion cannot tell a rendered badge from a dead branch.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PAPYRUS_VERSION, PAPYRUS_COPY } from "@ouronet/papyrus";
import { ZbomLayout } from "../src/zbom/cfm/ZbomLayout.js";
import { CodexProvider } from "@ancientpantheon/codex-ouronet/provider";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";

function renderLayout(kind: "page" | "roll" | "leaf" = "page") {
  return render(
    <CodexProvider adapter={new MemoryCodexAdapter("dev")}>
    <ZbomLayout
      kind={kind}
      header={<h2>Rotate Guard</h2>}
      executeButton={{
        canExecute: false,
        isProcessing: false,
        onClick: () => {},
        bgColor: "#1a1a1a",
        textColor: "#444",
        content: "Execute",
      }}
    >
      <div>zone content</div>
    </ZbomLayout>
    </CodexProvider>,
  );
}

describe("PapyrusBadge renders", () => {
  it("shows the member name and the engine version", () => {
    renderLayout("page");
    expect(screen.getByTestId("papyrus-badge-member").textContent).toBe(
      PAPYRUS_COPY.page.label,
    );
    expect(screen.getByTestId("papyrus-badge-version").textContent).toBe(
      `v${PAPYRUS_VERSION}`,
    );
  });

  it("puts them at OPPOSITE corners of one justify-between row", () => {
    renderLayout("page");
    const badge = screen.getByTestId("papyrus-badge");
    expect(badge.className).toContain("justify-between");
    const member = screen.getByTestId("papyrus-badge-member");
    const version = screen.getByTestId("papyrus-badge-version");
    // left before right in document order
    expect(badge.contains(member)).toBe(true);
    expect(badge.contains(version)).toBe(true);
    expect(
      member.compareDocumentPosition(version) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("appears BEFORE the execute button in the document", () => {
    renderLayout("page");
    const badge = screen.getByTestId("papyrus-badge");
    const button = screen.getByRole("button", { name: /execute/i });
    expect(
      badge.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("names the right member for each kind, from the package's own copy", () => {
    for (const k of ["page", "roll", "leaf"] as const) {
      const { unmount } = renderLayout(k);
      expect(screen.getByTestId("papyrus-badge-member").textContent).toBe(
        PAPYRUS_COPY[k].label,
      );
      unmount();
    }
  });
});
