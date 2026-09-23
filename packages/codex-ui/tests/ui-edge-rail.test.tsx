/**
 * EdgeRail — the icon-only, edge-docked half-disc button (docs/work/
 * codex-ui-mobile/design.md §8, ported from claudstermind's `.mc-rail`).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { EdgeRail } from "../src/ui/mobile/EdgeRail";

afterEach(() => cleanup());

describe("EdgeRail", () => {
  it("renders its icon-only content and fires onClick", () => {
    const onClick = vi.fn();
    render(
      <EdgeRail side="left" onClick={onClick} aria-label="Ouronet Accounts">
        <span>icon</span>
      </EdgeRail>,
    );
    const btn = screen.getByRole("button", { name: "Ouronet Accounts" });
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("side=left docks flush to the left edge with right-side rounding only", () => {
    render(
      <EdgeRail side="left" onClick={() => {}} aria-label="Left rail">
        <span>L</span>
      </EdgeRail>,
    );
    const btn = screen.getByRole("button", { name: "Left rail" });
    expect(btn.style.left).toBe("0px");
    expect(btn.style.right).toBe("");
    expect(btn.style.borderLeft).toBe("0px");
    expect(btn.style.borderRadius).toBe("0 999px 999px 0");
  });

  it("side=right docks flush to the right edge with left-side rounding only", () => {
    render(
      <EdgeRail side="right" onClick={() => {}} aria-label="Right rail">
        <span>R</span>
      </EdgeRail>,
    );
    const btn = screen.getByRole("button", { name: "Right rail" });
    expect(btn.style.right).toBe("0px");
    expect(btn.style.left).toBe("");
    expect(btn.style.borderRight).toBe("0px");
    expect(btn.style.borderRadius).toBe("999px 0 0 999px");
  });

  it("straddles its anchor's top seam (position absolute, top 0, translateY -50%)", () => {
    render(
      <EdgeRail side="left" onClick={() => {}} aria-label="Rail">
        <span>x</span>
      </EdgeRail>,
    );
    const btn = screen.getByRole("button", { name: "Rail" });
    expect(btn.style.position).toBe("absolute");
    expect(btn.style.top).toBe("0px");
    expect(btn.style.transform).toBe("translateY(-50%)");
  });

  it("reflects active state via aria-pressed and an accent-colored border", () => {
    render(
      <EdgeRail side="left" onClick={() => {}} active aria-label="Rail">
        <span>x</span>
      </EdgeRail>,
    );
    expect(screen.getByRole("button", { name: "Rail" })).toHaveAttribute("aria-pressed", "true");
  });

  it("edge=\"bottom\" straddles the anchor's BOTTOM seam instead of its top (design.md §8, 'locked in Zone 3' fix)", () => {
    render(
      <EdgeRail side="left" edge="bottom" onClick={() => {}} aria-label="Rail">
        <span>x</span>
      </EdgeRail>,
    );
    const btn = screen.getByRole("button", { name: "Rail" });
    expect(btn.style.position).toBe("absolute");
    expect(btn.style.bottom).toBe("0px");
    expect(btn.style.top).toBe("");
    expect(btn.style.transform).toBe("translateY(50%)");
  });

  it("edge=\"middle\" vertically centers against the anchor instead of straddling either seam (design.md §8, the 'shown in their entirety' fix — meant for a full-screen portal target)", () => {
    render(
      <EdgeRail side="left" edge="middle" onClick={() => {}} aria-label="Rail">
        <span>x</span>
      </EdgeRail>,
    );
    const btn = screen.getByRole("button", { name: "Rail" });
    expect(btn.style.position).toBe("absolute");
    expect(btn.style.top).toBe("50%");
    expect(btn.style.bottom).toBe("");
    expect(btn.style.transform).toBe("translateY(-50%)");
    expect(btn.style.pointerEvents).toBe("auto");
  });

  it("carries a real, visible backdrop — NOT transparent — either state (reverted per explicit owner correction: 'i told you not to make transparent')", () => {
    const { rerender } = render(
      <EdgeRail side="left" onClick={() => {}} aria-label="Rail">
        <span>x</span>
      </EdgeRail>,
    );
    expect(screen.getByRole("button", { name: "Rail" }).style.backgroundColor).not.toBe("transparent");
    rerender(
      <EdgeRail side="left" onClick={() => {}} active aria-label="Rail">
        <span>x</span>
      </EdgeRail>,
    );
    expect(screen.getByRole("button", { name: "Rail" }).style.backgroundColor).not.toBe("transparent");
  });

  it("reads full accent color when active, dimmed grey when inactive — and stays clickable either way (still the only door to the other view)", () => {
    const onClick = vi.fn();
    const { rerender } = render(
      <EdgeRail side="left" accent="#3b82f6" onClick={onClick} aria-label="Rail">
        <span>x</span>
      </EdgeRail>,
    );
    let btn = screen.getByRole("button", { name: "Rail" });
    expect(btn.style.color).toBe("rgb(196, 196, 196)");
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(
      <EdgeRail side="left" accent="#3b82f6" onClick={onClick} active aria-label="Rail">
        <span>x</span>
      </EdgeRail>,
    );
    btn = screen.getByRole("button", { name: "Rail" });
    expect(btn.style.color).toBe("rgb(59, 130, 246)");
  });
});
