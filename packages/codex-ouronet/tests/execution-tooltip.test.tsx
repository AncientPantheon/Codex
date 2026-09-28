/**
 * ExecutionTooltip — the hover verification card itself: renders the
 * execution function + parameter list from the manifest, arguments
 * positionally aligned, and the live INFO preview. `setPactReader` (the
 * same seam `ouronet-execute-wiring.test.ts` uses) captures the exact
 * INFO call this component fires, without a real network round trip.
 *
 * `ExecutionTooltipCard` (the always-rendered content, exported separately
 * from the hover-gated `ExecutionTooltip` default export) is what's tested
 * here — no hover simulation needed to exercise the three things it
 * renders.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { setPactReader } from "@stoachain/stoa-core/reads";
import { ExecutionTooltipCard, type ExecutionSpec } from "../src/zbom/cfm/ExecutionTooltip.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mockReader(response: unknown) {
  const reader = vi.fn().mockResolvedValue(response);
  setPactReader(reader);
  return reader;
}

describe("ExecutionTooltipCard", () => {
  it("shows the real parameter list for a function that exists on chain", () => {
    mockReader({ result: { status: "success", data: null } });
    const spec: ExecutionSpec = {
      exec: "ouronet-ns.TS01-C4.CODEX|C_ReleaseStoicTag",
      args: ['"Ѻ.PATRON"', '"Ѻ.ACCOUNT"', '"MyTag"'],
    };
    render(<ExecutionTooltipCard spec={spec} />);
    expect(screen.getByText(spec.exec)).toBeTruthy();
    expect(screen.getByText("(patron executor tag-name)")).toBeTruthy();
  });

  it('shows "not on chain" for a function the contract does not define — the failure this component exists to surface BEFORE a click', () => {
    const spec: ExecutionSpec = {
      exec: "ouronet-ns.TS01-C4.CODEX|C_ThisFunctionWasNeverReal",
      args: [],
    };
    render(<ExecutionTooltipCard spec={spec} />);
    expect(screen.getByText(/not on chain/)).toBeTruthy();
  });

  it("shows only the plain signature (no argument-match block, no MISSING flags) when args is deliberately empty — Zone2Wrapper's signature-only use", () => {
    const spec: ExecutionSpec = {
      exec: "ouronet-ns.TS01-C4.CODEX|C_ReleaseStoicTag",
      args: [],
    };
    render(<ExecutionTooltipCard spec={spec} />);
    // The plain param-name signature line still shows (function exists, with
    // what parameters) — that's the whole point of the signature-only call.
    expect(screen.getByText("(patron executor tag-name)")).toBeTruthy();
    // But no per-argument comparison — an intentionally-empty args array is
    // not "every argument is missing".
    expect(screen.queryByText(/MISSING/)).toBeNull();
  });

  it("flags a MISSING argument distinctly from a provided one — positional misalignment is the class no static check catches", () => {
    mockReader({ result: { status: "success", data: null } });
    const spec: ExecutionSpec = {
      exec: "ouronet-ns.TS01-C4.CODEX|C_ReleaseStoicTag",
      // Only 2 of 3 args supplied — `tag-name`'s slot should read MISSING.
      args: ['"Ѻ.PATRON"', '"Ѻ.ACCOUNT"'],
    };
    render(<ExecutionTooltipCard spec={spec} />);
    expect(screen.getByText(/MISSING/)).toBeTruthy();
  });

  it("runs the live INFO preview against the SEPARATE infoArgs when EXEC and INFO arities differ (Release StoicTag's own case)", async () => {
    const reader = mockReader({
      result: {
        status: "success",
        data: { "pre-text": ["Operation: Release StoicTag §MyTag."], ignis: { "ignis-need": { decimal: "1.0" } } },
      },
    });
    const spec: ExecutionSpec = {
      exec: "ouronet-ns.TS01-C4.CODEX|C_ReleaseStoicTag",
      info: "ouronet-ns.CODEX.INFO_CODEX|ReleaseStoicTag",
      args: ['"Ѻ.PATRON"', '"Ѻ.ACCOUNT"', '"MyTag"'],
      // INFO_CODEX|ReleaseStoicTag is 2-arg (patron, tag-name) — drops `executor`.
      infoArgs: ['"Ѻ.PATRON"', '"MyTag"'],
    };
    render(<ExecutionTooltipCard spec={spec} />);

    await waitFor(() => expect(reader).toHaveBeenCalled());
    const [code] = reader.mock.calls[0];
    expect(code).toBe('(ouronet-ns.CODEX.INFO_CODEX|ReleaseStoicTag "Ѻ.PATRON" "MyTag")');

    await waitFor(() => expect(screen.getByText(/Operation: Release StoicTag/)).toBeTruthy());
    expect(screen.getByText(/1\.0 IGNIS/)).toBeTruthy();
  });

  it("surfaces a chain-side refusal as an error, not a silent blank", async () => {
    mockReader({ result: { status: "failure", error: { message: "StoicTag not found" } } });
    const spec: ExecutionSpec = {
      exec: "ouronet-ns.TS01-C4.CODEX|C_ReleaseStoicTag",
      info: "ouronet-ns.CODEX.INFO_CODEX|ReleaseStoicTag",
      // A DIFFERENT tag name than the previous test's — the preview cache is
      // keyed by the rendered INFO call string (by design, so sweeping a
      // toolbar doesn't fire a request per pixel), and reusing the exact
      // same args here would hit that cache instead of this test's own mock.
      args: ['"Ѻ.PATRON"', '"Ѻ.ACCOUNT"', '"NoSuchTag"'],
      infoArgs: ['"Ѻ.PATRON"', '"NoSuchTag"'],
    };
    render(<ExecutionTooltipCard spec={spec} />);
    await waitFor(() => expect(screen.getByText("StoicTag not found")).toBeTruthy());
  });
});
