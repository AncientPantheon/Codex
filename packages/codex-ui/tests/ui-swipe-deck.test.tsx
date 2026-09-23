/**
 * SwipeDeck — ported from OuronetUI's own component (docs/work/
 * codex-ui-mobile/design.md §5). jsdom doesn't compute real layout
 * (offsetTop/clientWidth are all 0), so these specs cover what's actually
 * observable without real layout: every pane's content renders, the
 * dot/arrow controls appear only with >1 pane, `onActiveChange` fires with
 * the initial index on mount, and clicking a dot/arrow never throws.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { createRef } from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { SwipeDeck, type SwipeDeckHandle } from "../src/ui/mobile/SwipeDeck";

afterEach(() => cleanup());

describe("SwipeDeck", () => {
  it("renders every pane's content", () => {
    render(
      <SwipeDeck>
        <div>Pane A</div>
        <div>Pane B</div>
        <div>Pane C</div>
      </SwipeDeck>,
    );
    expect(screen.getByText("Pane A")).toBeInTheDocument();
    expect(screen.getByText("Pane B")).toBeInTheDocument();
    expect(screen.getByText("Pane C")).toBeInTheDocument();
  });

  it("a single pane shows no dot/arrow controls by default", () => {
    render(
      <SwipeDeck>
        <div>Only pane</div>
      </SwipeDeck>,
    );
    expect(screen.queryByLabelText(/go to pane/i)).toBeNull();
    expect(screen.queryByLabelText("Next")).toBeNull();
  });

  it("showSingleDot: a single pane shows ONE static dot (no arrows, no click target) — design.md §8's Zone 1 shape rule", () => {
    const { container } = render(
      <SwipeDeck showSingleDot>
        <div>Only pane</div>
      </SwipeDeck>,
    );
    // No arrows, no clickable "go to pane" dot button (nowhere to go with 1 pane).
    expect(screen.queryByLabelText(/go to pane/i)).toBeNull();
    expect(screen.queryByLabelText("Next")).toBeNull();
    // But a plain, non-interactive dot element is present.
    expect(container.querySelector("button")).toBeNull();
    const dot = container.querySelector('div[style*="border-radius: 9999px"]');
    expect(dot).not.toBeNull();
  });

  it("without showSingleDot, a single pane shows no dot at all", () => {
    const { container } = render(
      <SwipeDeck>
        <div>Only pane</div>
      </SwipeDeck>,
    );
    expect(container.querySelector('div[style*="border-radius: 9999px"]')).toBeNull();
  });

  it("multiple panes show one dot per pane, plus Previous/Next arrows", () => {
    render(
      <SwipeDeck>
        <div>A</div>
        <div>B</div>
      </SwipeDeck>,
    );
    expect(screen.getByLabelText("Go to pane 1")).toBeInTheDocument();
    expect(screen.getByLabelText("Go to pane 2")).toBeInTheDocument();
    expect(screen.getByLabelText("Previous")).toBeInTheDocument();
    expect(screen.getByLabelText("Next")).toBeInTheDocument();
  });

  it("fires onActiveChange with the initial index on mount", () => {
    const onActiveChange = vi.fn();
    render(
      <SwipeDeck initialIndex={0} onActiveChange={onActiveChange}>
        <div>A</div>
        <div>B</div>
      </SwipeDeck>,
    );
    expect(onActiveChange).toHaveBeenCalledWith(0);
  });

  it("the Previous arrow starts disabled (already on the first pane)", () => {
    render(
      <SwipeDeck>
        <div>A</div>
        <div>B</div>
      </SwipeDeck>,
    );
    expect(screen.getByLabelText("Previous")).toBeDisabled();
    expect(screen.getByLabelText("Next")).not.toBeDisabled();
  });

  it("clicking a dot or arrow never throws, even without real jsdom layout", () => {
    render(
      <SwipeDeck>
        <div>A</div>
        <div>B</div>
      </SwipeDeck>,
    );
    expect(() => fireEvent.click(screen.getByLabelText("Go to pane 2"))).not.toThrow();
    expect(() => fireEvent.click(screen.getByLabelText("Next"))).not.toThrow();
  });

  it("hideIndicators: suppresses the dot/arrow strip even with multiple panes, and drops its own reserved bottom padding (design.md §8, the 'swipe lines must live OUTSIDE the box' round)", () => {
    const { container } = render(
      <SwipeDeck hideIndicators>
        <div>A</div>
        <div>B</div>
      </SwipeDeck>,
    );
    expect(screen.queryByLabelText(/go to pane/i)).toBeNull();
    expect(screen.queryByLabelText("Previous")).toBeNull();
    expect(screen.queryByLabelText("Next")).toBeNull();
    const scroller = container.querySelector(".codex-swipedeck-scroller") as HTMLElement;
    expect(scroller.style.paddingBottom).toBe("");
  });

  it("hideIndicators also suppresses showSingleDot's static dot", () => {
    const { container } = render(
      <SwipeDeck hideIndicators showSingleDot>
        <div>Only pane</div>
      </SwipeDeck>,
    );
    expect(container.querySelector('div[style*="border-radius: 9999px"]')).toBeNull();
  });

  it("exposes scrollToIndex via ref for an external driver (e.g. a Prev/Next riser outside the deck's own box) — a no-op in jsdom (no real scrollTo), but must never throw", () => {
    const ref = createRef<SwipeDeckHandle>();
    render(
      <SwipeDeck ref={ref}>
        <div>A</div>
        <div>B</div>
      </SwipeDeck>,
    );
    expect(ref.current).not.toBeNull();
    expect(() => ref.current!.scrollToIndex(1)).not.toThrow();
  });

  it("vertical mode renders the same pane content and dot count, without Previous/Next arrows", () => {
    render(
      <SwipeDeck vertical>
        <div>A</div>
        <div>B</div>
        <div>C</div>
      </SwipeDeck>,
    );
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getAllByLabelText(/go to pane/i)).toHaveLength(3);
    expect(screen.queryByLabelText("Next")).toBeNull();
  });
});
