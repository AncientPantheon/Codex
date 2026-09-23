/**
 * DalosSecretReveal — `sourceLabelOverride` / `hideAddress` specs (Arweave
 * "View Seed" provenance fix).
 *
 * `DalosSecretReveal` has no dedicated test file elsewhere; its existing
 * behavior is only exercised indirectly through `ViewSeedModal` and
 * `ArweaveSeedsArea`. These specs pin the two NEW optional props in
 * isolation, and — just as importantly — pin that OMITTING them reproduces
 * today's exact output. `ViewSeedModal` never passes either prop, so a
 * regression here would silently change what every Ouronet account reveal
 * shows.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

import { DalosSecretReveal } from "@ancientpantheon/codex-ouronet/ui";
import { decodeBitmapBMP } from "@ancientpantheon/codex-core";
import {
  createDefaultRegistry,
  createOuronetAccount,
} from "@stoachain/stoa-core/dalos";

// A real, valid 1600-bit DALOS Genesis bitstring — minted the same way
// `codex-identity-rebuild-full-key.test.ts` builds its reference key, so
// `rebuildFullKey`'s `bitString` mode parses it without error and `full` is
// non-null (the derived-address block only renders when `full` exists).
const BITSTRING = createOuronetAccount(createDefaultRegistry(), {
  mode: "seedWords",
  data: ["alpha", "bravo", "charlie", "delta", "echo"],
  primitiveId: "dalos-gen-1",
}).privateKey.bitString;

describe("DalosSecretReveal — sourceLabelOverride", () => {
  it("renders the override text instead of the generic origin label", () => {
    render(
      <DalosSecretReveal
        plaintext={BITSTRING}
        originMode="bitString"
        originCurve="dalos"
        sourceLabelOverride='Ouronet account "Explorer"'
      />,
    );

    expect(screen.getByText('Ouronet account "Explorer"')).toBeTruthy();
    // The generic origin-computed text this override replaces must not also
    // be present — otherwise the override is additive noise, not a swap.
    expect(screen.queryByText(/bitstring \(1600 bits\)/)).toBeNull();
  });

  it("falls back to the generic origin label when the override is omitted (regression guard for ViewSeedModal)", () => {
    render(
      <DalosSecretReveal plaintext={BITSTRING} originMode="bitString" originCurve="dalos" />,
    );

    expect(screen.getByText(/bitstring \(1600 bits\)/)).toBeTruthy();
  });
});

describe("DalosSecretReveal — hideAddress", () => {
  it("hides the derived Smart/Standard address block when true", () => {
    render(
      <DalosSecretReveal
        plaintext={BITSTRING}
        originMode="bitString"
        originCurve="dalos"
        hideAddress
      />,
    );

    expect(screen.queryByText(/standard address/i)).toBeNull();
    expect(screen.queryByText(/smart address/i)).toBeNull();
  });

  it("still renders the address block when omitted (regression guard for ViewSeedModal)", () => {
    render(
      <DalosSecretReveal plaintext={BITSTRING} originMode="bitString" originCurve="dalos" />,
    );

    expect(screen.getByText(/standard address/i)).toBeTruthy();
  });
});

describe("DalosSecretReveal — Bitmap panel Download button", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("downloads a REAL 1bpp BMP whose pixels round-trip to the exact bitstring, named <curve>-key-<cols>x<rows>.bmp", async () => {
    let downloadedBlob: Blob | null = null;
    const createObjectURL = vi.fn((blob: Blob) => {
      downloadedBlob = blob;
      return "blob:mock-url";
    });
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    render(
      <DalosSecretReveal plaintext={BITSTRING} originMode="bitString" originCurve="dalos" />,
    );
    // Bitmap is not the default tab for a bitString-origin reveal — select it.
    fireEvent.click(screen.getByText("Bitmap"));

    const downloadBtn = screen.getByText("Download BMP").closest("button")!;
    fireEvent.click(downloadBtn);

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    // The anchor's `download` attribute carries the filename — read it off
    // the SAME element the click was dispatched through.
    const anchor = clickSpy.mock.instances[0] as unknown as HTMLAnchorElement;
    expect(anchor.download).toBe("dalos-key-40x40.bmp");

    expect(downloadedBlob).not.toBeNull();
    const buf = await downloadedBlob!.arrayBuffer();
    const decoded = decodeBitmapBMP(buf);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) throw new Error("unreachable");
    expect(decoded.bitmap.bits).toBe(BITSTRING);
    expect(decoded.bitmap.cols).toBe(40);
    expect(decoded.bitmap.rows).toBe(40);
  });
});

describe("DalosSecretReveal — Seed tab word layout", () => {
  it("renders short (dictionary-style) words in an 8-column grid, the position as a SEPARATE medallion badge — never eating into the word's own text", () => {
    const words = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india"];
    render(
      <DalosSecretReveal plaintext={words.join(" ")} originMode="seedWords" originCurve="dalos" />,
    );

    // Default active tab for a seedWords-origin reveal IS "seed" — no click needed.
    for (const w of words) expect(screen.getByText(w)).toBeTruthy();

    // The word's own text node is exactly the word — "1." is a SIBLING
    // element (the medallion), not prepended to the word's text content.
    const wordNode = screen.getByText(words[0]!);
    expect(wordNode.textContent).toBe(words[0]);

    // The medallion (its own element, holding only the 1-based index) sits
    // beside the word node in the same cell.
    const medallion = screen.getByText("1", { selector: "span" });
    expect(medallion).not.toBe(wordNode);
    expect(medallion.parentElement).toBe(wordNode.parentElement);

    // 8 columns, per the explicit "8 words per line, not 5" request.
    const grid = wordNode.closest('[style*="grid-template-columns"]') as HTMLElement;
    expect(grid.style.gridTemplateColumns).toBe("repeat(8, 1fr)");
  });

  // Round 24 owner correction: "we always fit max 8 horisontaly, (if they
  // fit) if not 6 then 4 then 2 then 1. but the word should be one per
  // line. if it doesnt fit one per line, we dont shorten it, but ratel
  // carusell it." Replaces the old fixed-8-column / middle-truncated-list
  // split with ONE responsive grid — these specs mock `ResizeObserver` to
  // control the measured width `fitWordColumns` reacts to (jsdom itself
  // never resolves real layout, so unmocked specs — like the one above —
  // exercise the wide 800px fallback, which is why an ordinary-length word
  // there always lands at 8 columns, unaffected).
  describe("responsive column count + marquee for words too wide to fit (round 24)", () => {
    class FakeResizeObserver {
      callback: ResizeObserverCallback;
      constructor(callback: ResizeObserverCallback) { this.callback = callback; }
      observe(target: Element) {
        this.callback([{ contentRect: { width: FakeResizeObserver.nextWidth } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
        void target;
      }
      unobserve() {}
      disconnect() {}
      static nextWidth = 800;
    }

    afterEach(() => vi.unstubAllGlobals());

    it("at the wide default (no mock — jsdom's own unmeasured fallback), even a 60-character word fits at 1 column and is never truncated", () => {
      // 60 DALOS-legal glyphs (plain Latin letters ARE in the 256-glyph
      // set) — too wide for 8 columns, but well within a single full-width
      // (1-column) cell at the 800px fallback.
      const longWord = "a".repeat(30) + "b".repeat(30);
      const words = ["short", longWord];
      render(
        <DalosSecretReveal
          plaintext={words.join(" ")}
          originMode="seedWords"
          originCurve="dalos"
          hideAddress
        />,
      );

      // The FULL word renders verbatim — no more shortening.
      expect(screen.getByText(longWord)).toBeTruthy();
      expect(screen.getByText("short")).toBeTruthy();
      expect(document.body.textContent ?? "").not.toContain("…");
    });

    it("narrows the grid from 8 columns as the measured width shrinks", () => {
      const words = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel"];

      FakeResizeObserver.nextWidth = 800;
      vi.stubGlobal("ResizeObserver", FakeResizeObserver);
      const { unmount } = render(
        <DalosSecretReveal plaintext={words.join(" ")} originMode="seedWords" originCurve="dalos" />,
      );
      let grid = screen.getByText("alpha").closest('[style*="grid-template-columns"]') as HTMLElement;
      expect(grid.style.gridTemplateColumns).toBe("repeat(8, 1fr)");
      unmount();

      // Narrow enough that an 8-cell row can't hold "foxtrot"/"charlie"
      // single-line any more — falls back to fewer, wider columns.
      FakeResizeObserver.nextWidth = 160;
      render(
        <DalosSecretReveal plaintext={words.join(" ")} originMode="seedWords" originCurve="dalos" />,
      );
      grid = screen.getByText("alpha").closest('[style*="grid-template-columns"]') as HTMLElement;
      expect(grid.style.gridTemplateColumns).not.toBe("repeat(8, 1fr)");
      expect(["repeat(6, 1fr)", "repeat(4, 1fr)", "repeat(2, 1fr)", "repeat(1, 1fr)"]).toContain(
        grid.style.gridTemplateColumns,
      );
    });

    it("a word too wide even at 1 column (full measured width) gets the marquee treatment — full text intact, never shortened, with its own copy button", () => {
      // Extreme case: a 256-glyph DALOS custom word (the format's own max)
      // against a genuinely narrow measured width.
      const hugeWord = "x".repeat(256);
      FakeResizeObserver.nextWidth = 180;
      vi.stubGlobal("ResizeObserver", FakeResizeObserver);
      render(
        <DalosSecretReveal plaintext={`short ${hugeWord}`} originMode="seedWords" originCurve="dalos" hideAddress />,
      );

      // The grid falls back to its narrowest column count...
      const grid = screen.getByText("short").closest('[style*="grid-template-columns"]') as HTMLElement;
      expect(grid.style.gridTemplateColumns).toBe("repeat(1, 1fr)");
      // ...and the huge word is STILL rendered verbatim, in full — not
      // truncated — inside an animated (marqueeing) span.
      const wordEl = screen.getByText(hugeWord);
      expect(wordEl.textContent).toBe(hugeWord);
      expect(wordEl.style.animation).toContain("codex-word-marquee");
      // A copy button sits alongside the marqueeing word (only marqueeing
      // cells get their own — a static-fitting word like "short" doesn't,
      // same as the original grid never had per-word copy buttons): 1 for
      // the huge word + 1 whole-plaintext = 2 (`hideAddress` removes the
      // address block's own).
      expect(screen.getAllByText("Copy Value")).toHaveLength(2);
    });

    it("a short word never gets the marquee treatment, even in a narrow grid", () => {
      FakeResizeObserver.nextWidth = 180;
      vi.stubGlobal("ResizeObserver", FakeResizeObserver);
      render(
        <DalosSecretReveal plaintext="alpha bravo" originMode="seedWords" originCurve="dalos" />,
      );
      const wordEl = screen.getByText("alpha");
      expect(wordEl.style.animation).toBe("");
    });
  });

  it("a seed with every word comfortably short never renders the truncation ellipsis", () => {
    const words = ["alpha", "bravo", "charlie"];
    render(
      <DalosSecretReveal plaintext={words.join(" ")} originMode="seedWords" originCurve="dalos" />,
    );

    expect(document.body.textContent ?? "").not.toContain("…");
  });
});
