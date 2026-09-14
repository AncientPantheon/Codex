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

  it("switches to ONE WORD PER LINE, single line, middle-truncated with its own copy button, when any word exceeds the long-word threshold", () => {
    // 60 DALOS-legal glyphs (plain Latin letters ARE in the 256-glyph set) —
    // well past the point an 8-column grid cell can hold on one line.
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

    // The FULL word is never rendered verbatim (that's the whole point of
    // truncating it) — only its head+tail with a single "…" in between.
    expect(screen.queryByText(longWord)).toBeNull();
    const truncated = `${longWord.slice(0, 48)}…${longWord.slice(-8)}`;
    expect(screen.getByText(truncated)).toBeTruthy();

    // Short words switch to the SAME one-per-line layout too — never mixed
    // with the grid in one seed.
    expect(screen.getByText("short")).toBeTruthy();

    // Every row gets its OWN copy button in addition to the whole-plaintext
    // one: 2 words + 1 whole-plaintext button = 3 "Copy Value" buttons total
    // (`hideAddress` above removes the address block's own 4th one, keeping
    // this count about the words, not incidental to the address).
    expect(screen.getAllByText("Copy Value")).toHaveLength(3);
  });

  it("a seed with NO word past the threshold never renders the truncation ellipsis", () => {
    const words = ["alpha", "bravo", "charlie"];
    render(
      <DalosSecretReveal plaintext={words.join(" ")} originMode="seedWords" originCurve="dalos" />,
    );

    expect(document.body.textContent ?? "").not.toContain("…");
  });
});
