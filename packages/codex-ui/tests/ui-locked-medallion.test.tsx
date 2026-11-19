/**
 * ui-locked-medallion.test.tsx — the `LockedMedallion`, the one shape five
 * surfaces wear (docs/work/locked-entities-and-former-prime/design.md §B5).
 *
 * Every case here pins a constraint that an EXISTING test elsewhere in the
 * monorepo would break on, so the regression is named in each `it`:
 *
 *  - the word is "Locked", never "Protected" (owner decision 2 —
 *    `ArweaveAccountsArea` already uses "Protected" for an unrelated tier);
 *  - the glyph is never the `🔒` character — the Ouronet accounts row's Prime
 *    pill is `🔒 Prime` and `ui-ouronet-accounts-tab.test.tsx:426` does
 *    `getByText(/🔒\s*Prime/)`, which THROWS on a second match in that row;
 *  - the accessible name is never exactly `"Prime"` or `"Standard"` —
 *    `ui-ouronet-accounts-tab-mobile.test.tsx:264-266` uses
 *    `getByLabelText("Prime")` (throws on >1) and `:274` asserts
 *    `getAllByLabelText("Standard")` has length exactly 2;
 *  - the default colour is not the gold `#ceac5f` —
 *    `ui-ouronet-accounts-tab.test.tsx:415` asserts exactly one gold row;
 *  - the compact box is 20×20 — `ui-ouronet-accounts-tab-mobile.test.tsx`
 *    `:167-203` pins mobile chunk sizes derived from MEASURED row height, so
 *    the compact medallion must match `OuronetAccountsTab`'s existing
 *    `IconBadge` geometry exactly rather than growing the row;
 *  - the module must not import `lucide-react` — `codex-arweave` hand-rolls
 *    inline SVG glyphs specifically to avoid that package's documented
 *    dual-React-instance resolution bug (`ArweavePanel.tsx:161-165`), and T8
 *    renders this medallion from inside `codex-arweave`.
 *
 * Imports from `../src/ui/LockedMedallion` directly — the convention
 * `ui-codex-id-field.test.tsx:12` uses.
 */
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, cleanup } from "@testing-library/react";
import { LockedMedallion, LOCKED_MEDALLION_COLOR } from "../src/ui/LockedMedallion";
// The two public barrels, imported STATICALLY (as surface-stability.test.ts does):
// a dynamic `import()` of the whole `/ui` barrel inside an `it` transforms every
// component in it and blows the 5s test timeout under a full-suite run.
import * as uiBarrel from "../src/ui/index.js";
import * as hooksBarrel from "../src/hooks/index.js";

afterEach(() => cleanup());

const GOLD = "#ceac5f";

describe("LockedMedallion — the full (pill) form", () => {
  it("renders the word 'Locked' — NOT 'Protected', which the Arweave seeds area already owns", () => {
    render(<LockedMedallion />);
    const pill = screen.getByTestId("locked-medallion");
    expect(pill.textContent).toContain("Locked");
    expect(pill.textContent).not.toContain("Protected");
  });

  it("carries a Lock SVG glyph and NEVER the 🔒 character (the accounts row's Prime pill owns 🔒)", () => {
    render(<LockedMedallion reason="settled Master Account" />);
    const pill = screen.getByTestId("locked-medallion");
    expect(pill.querySelector("svg")).not.toBeNull();
    expect(pill.textContent ?? "").not.toContain("🔒");
  });

  it("wears PureKeypairsTab's exact pill geometry, so the ported surfaces stay visually identical", () => {
    render(<LockedMedallion />);
    const pill = screen.getByTestId("locked-medallion");
    expect(pill.style.display).toBe("inline-flex");
    expect(pill.style.alignItems).toBe("center");
    expect(pill.style.gap).toBe("4px");
    expect(pill.style.padding).toBe("2px 8px");
    expect(pill.style.borderRadius).toBe("9999px");
    expect(pill.style.fontSize).toBe("10px");
    expect(pill.style.fontWeight).toBe("600");
    expect(pill.style.flexShrink).toBe("0");
  });
});

describe("LockedMedallion — the compact (icon-only) form", () => {
  it("renders NO visible text, so a MEASURED mobile row never grows to fit it", () => {
    render(<LockedMedallion compact />);
    const badge = screen.getByTestId("locked-medallion");
    expect(badge.textContent).toBe("");
    expect(badge.querySelector("svg")).not.toBeNull();
  });

  it("is exactly 20×20 — OuronetAccountsTab's IconBadge geometry, which the mobile chunk sizes assume", () => {
    render(<LockedMedallion compact />);
    const badge = screen.getByTestId("locked-medallion");
    expect(badge.style.width).toBe("20px");
    expect(badge.style.height).toBe("20px");
    expect(badge.style.borderRadius).toBe("9999px");
    expect(badge.style.flexShrink).toBe("0");
  });

  it("still carries the word via aria-label, so the icon-only form stays accessible", () => {
    render(<LockedMedallion compact />);
    expect(screen.getByLabelText("Locked")).toBe(screen.getByTestId("locked-medallion"));
  });

  it("never renders the 🔒 character either", () => {
    render(<LockedMedallion compact reason="settled Master ArWeave Seed" />);
    expect(screen.getByTestId("locked-medallion").textContent ?? "").not.toContain("🔒");
  });
});

describe("LockedMedallion — the reason the store would give", () => {
  it("reaches BOTH the tooltip and the accessible name in the full form", () => {
    render(<LockedMedallion reason="holds the CodexGuard" />);
    const pill = screen.getByTestId("locked-medallion");
    expect(pill.getAttribute("title")).toBe("Locked — holds the CodexGuard");
    expect(pill.getAttribute("aria-label")).toBe("Locked — holds the CodexGuard");
  });

  it("reaches BOTH the tooltip and the accessible name in the compact form", () => {
    render(<LockedMedallion compact reason="holds the CodexGuard" />);
    const badge = screen.getByTestId("locked-medallion");
    expect(badge.getAttribute("title")).toBe("Locked — holds the CodexGuard");
    expect(badge.getAttribute("aria-label")).toBe("Locked — holds the CodexGuard");
  });

  it("falls back to the bare word when no reason is given", () => {
    render(<LockedMedallion />);
    const pill = screen.getByTestId("locked-medallion");
    expect(pill.getAttribute("title")).toBe("Locked");
    expect(pill.getAttribute("aria-label")).toBe("Locked");
  });

  it("an empty/whitespace reason does not leave a dangling em dash", () => {
    render(<LockedMedallion reason="   " />);
    expect(screen.getByTestId("locked-medallion").getAttribute("aria-label")).toBe("Locked");
  });
});

describe("LockedMedallion — the accessible name is never 'Prime' or 'Standard'", () => {
  it("a reason of 'Prime' still yields 'Locked — Prime', so getByLabelText('Prime') stays unique on the mobile row", () => {
    render(<LockedMedallion compact reason="Prime" />);
    expect(screen.queryByLabelText("Prime")).toBeNull();
    expect(screen.getByLabelText("Locked — Prime")).toBeInTheDocument();
  });

  it("a reason of 'Standard' still yields 'Locked — Standard', so the mobile tier count stays 2", () => {
    render(<LockedMedallion compact reason="Standard" />);
    expect(screen.queryByLabelText("Standard")).toBeNull();
    expect(screen.getByLabelText("Locked — Standard")).toBeInTheDocument();
  });
});

describe("LockedMedallion — colour", () => {
  it("defaults to a colour that is NOT the CodexPrime gold (exactly one gold row is the invariant)", () => {
    expect(LOCKED_MEDALLION_COLOR.toLowerCase()).not.toBe(GOLD);
    render(<LockedMedallion />);
    const pill = screen.getByTestId("locked-medallion");
    expect(pill.style.color).not.toBe("rgb(206, 172, 95)");
    expect(pill.style.backgroundColor).not.toBe("rgb(206, 172, 95)");
  });

  it("honours a caller's accent override on both fore- and background, as PureKeypairsTab's row accent needs", () => {
    render(<LockedMedallion color="#7c5cff" />);
    const pill = screen.getByTestId("locked-medallion");
    expect(pill.style.color).toBe("rgb(124, 92, 255)");
    // `C + "20"` — the 12.5%-alpha tint PureKeypairsTab:286-290 uses.
    expect(pill.style.backgroundColor).toBe("rgba(124, 92, 255, 0.125)");
  });

  it("the compact form takes the same override", () => {
    render(<LockedMedallion compact color="#7c5cff" />);
    const badge = screen.getByTestId("locked-medallion");
    expect(badge.style.color).toBe("rgb(124, 92, 255)");
    expect(badge.style.backgroundColor).toBe("rgba(124, 92, 255, 0.125)");
  });
});

describe("LockedMedallion — testid", () => {
  it("takes a testId override, so a surface rendering several can address each one", () => {
    render(<LockedMedallion testId="locked-medallion-acct-1" />);
    expect(screen.getByTestId("locked-medallion-acct-1").textContent).toContain("Locked");
  });
});

describe("LockedMedallion — the cross-package icon constraint", () => {
  it("does not import lucide-react, so codex-arweave (which avoids it) can render this component", () => {
    const source = readFileSync(resolve(__dirname, "../src/ui/LockedMedallion.tsx"), "utf8");
    expect(source).not.toMatch(/from\s+["']lucide-react["']/);
  });
});

describe("LockedMedallion — the public surface six Wave-2 call sites import", () => {
  it("is re-exported from the `/ui` barrel (and NOT from `/hooks`, whose enumerated barrel surface-stability.test.ts pins)", () => {
    expect(typeof uiBarrel.LockedMedallion).toBe("function");
    expect(uiBarrel.LOCKED_MEDALLION_COLOR).toBe(LOCKED_MEDALLION_COLOR);
    expect("LockedMedallion" in hooksBarrel).toBe(false);
  });
});
