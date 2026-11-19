// ============================================================================
// RED SPEC — pre-unlock shape-version label (T5 of
// docs/work/codex-shape-version-stamp/plan.md).
//
// UnlockScreen must ALWAYS render formatCodexShapeVersionLabel(shapeVersion)
// — "v1.0.0" when a shapeVersion prop is supplied, "Unversioned" when it is
// undefined (or omitted entirely) — visible before the password <input>
// receives focus or any keystroke. This is the pre-unlock demonstration that
// detectCodexShapeVersion/formatCodexShapeVersionLabel (codex-core, Wave 1)
// actually reach a real screen.
//
// useCodexAuth is mocked the same way unlock-screen.test.tsx already mocks
// it — this test is only pinning the NEW shapeVersion-label behavior, not
// re-covering the submit/guard/hygiene behavior already covered there.
// ============================================================================

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("@ancientpantheon/codex-ouronet/hooks", () => ({
  useCodexAuth: () => ({
    isLocked: true,
    authenticate: vi.fn(),
    lock: vi.fn(),
    getCurrentPassword: () => {
      throw new Error("locked");
    },
    passwordCacheExpiresAt: null,
  }),
}));

import { UnlockScreen } from "../src/UnlockScreen";

afterEach(() => {
  cleanup();
});

describe("UnlockScreen — pre-unlock shape-version label", () => {
  it('shows "v1.0.0" when rendered with shapeVersion="1.0.0", rendered unconditionally', () => {
    render(<UnlockScreen shapeVersion="1.0.0" />);

    // Rendered up-front (not behind any interaction gate) — present in the
    // same initial render pass as the password input itself.
    expect(screen.getByText("v1.0.0")).toBeInTheDocument();
    expect(screen.getByLabelText(/^password$/i)).toHaveValue("");
  });

  it('shows "Unversioned" when shapeVersion is explicitly undefined', () => {
    render(<UnlockScreen shapeVersion={undefined} />);

    expect(screen.getByText("Unversioned")).toBeInTheDocument();
  });

  it('shows "Unversioned" when rendered with no props at all', () => {
    render(<UnlockScreen />);

    expect(screen.getByText("Unversioned")).toBeInTheDocument();
  });
});
