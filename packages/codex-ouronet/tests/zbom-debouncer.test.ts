/**
 * ZBOM package-local debouncer (Wave 3).
 *
 * Covers: (a) the pure ignis parsers (unwrap envelope + coerce decimal forms +
 * free-vs-cost), and (b) `useZbomInfoRead` behaviour over a mocked `pactRead`
 * reader — debounce timing (fake timers), single read per stable code, cost
 * commit from `infoData.ignis["ignis-need"]`, idle on null code, error path,
 * and `refresh()` forcing an immediate read.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { setPactReader } from "@stoachain/stoa-core/reads";
import {
  parseIgnisInfo,
  coercePactDecimal,
  unwrapReadResult,
  useZbomInfoRead,
} from "@ancientpantheon/codex-ouronet/zbom";

describe("coercePactDecimal", () => {
  it("passes through finite numbers", () => {
    expect(coercePactDecimal(1.5)).toBe(1.5);
    expect(coercePactDecimal(0)).toBe(0);
  });
  it("parses numeric strings", () => {
    expect(coercePactDecimal("2.25")).toBe(2.25);
  });
  it("unwraps Pact { decimal } shape", () => {
    expect(coercePactDecimal({ decimal: "3.5" })).toBe(3.5);
    expect(coercePactDecimal({ decimal: 4 })).toBe(4);
  });
  it("returns null for absent / unparseable", () => {
    expect(coercePactDecimal(null)).toBeNull();
    expect(coercePactDecimal(undefined)).toBeNull();
    expect(coercePactDecimal("abc")).toBeNull();
    expect(coercePactDecimal({})).toBeNull();
  });
});

describe("unwrapReadResult", () => {
  it("unwraps result.data", () => {
    expect(unwrapReadResult({ result: { data: { ignis: {} } } })).toEqual({ ignis: {} });
  });
  it("falls back to result when no data key", () => {
    expect(unwrapReadResult({ result: { status: "success" } })).toEqual({ status: "success" });
  });
  it("returns the value itself when no envelope", () => {
    expect(unwrapReadResult({ ignis: { "ignis-need": 1 } })).toEqual({ ignis: { "ignis-need": 1 } });
  });
});

describe("parseIgnisInfo", () => {
  it("reads ignis-need (cost) from a wrapped envelope", () => {
    const parsed = parseIgnisInfo({
      result: { data: { ignis: { "ignis-need": { decimal: "0.42" }, "ignis-text": "ok" } } },
    });
    expect(parsed.ignisNeed).toBe(0.42);
    expect(parsed.ignisText).toBe("ok");
  });
  it("reads a free (0) cost", () => {
    expect(parseIgnisInfo({ ignis: { "ignis-need": 0 } }).ignisNeed).toBe(0);
  });
  it("returns null ignisNeed when the block is missing", () => {
    expect(parseIgnisInfo({ result: { data: {} } }).ignisNeed).toBeNull();
  });
});

describe("useZbomInfoRead", () => {
  const CODE = '(ouronet-ns.INFO-ZERO.DALOS-INFO|URC_RotateGuard "Ѻ.A" "Ѻ.A")';

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does not read before the debounce window elapses", async () => {
    const reader = vi.fn().mockResolvedValue({ ignis: { "ignis-need": 1 } });
    setPactReader(reader);
    renderHook(() => useZbomInfoRead(CODE, { debounceMs: 400 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(399);
    });
    expect(reader).not.toHaveBeenCalled();
  });

  it("reads once after the debounce window and commits the cost", async () => {
    const reader = vi.fn().mockResolvedValue({ ignis: { "ignis-need": { decimal: "2.5" } } });
    setPactReader(reader);
    const { result } = renderHook(() => useZbomInfoRead(CODE, { debounceMs: 400 }));
    expect(result.current.status).toBe("loading");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(reader).toHaveBeenCalledTimes(1);
    expect(reader).toHaveBeenCalledWith(CODE, { tier: "T2" });
    expect(result.current.status).toBe("fresh");
    expect(result.current.ignisNeed).toBe(2.5);
    expect(result.current.isFree).toBe(false);
  });

  it("flags isFree when the cost is 0", async () => {
    setPactReader(vi.fn().mockResolvedValue({ ignis: { "ignis-need": 0 } }));
    const { result } = renderHook(() => useZbomInfoRead(CODE, { debounceMs: 100 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(result.current.isFree).toBe(true);
    expect(result.current.ignisNeed).toBe(0);
  });

  it("stays idle and never reads when pactCode is null", async () => {
    const reader = vi.fn().mockResolvedValue({ ignis: { "ignis-need": 1 } });
    setPactReader(reader);
    const { result } = renderHook(() => useZbomInfoRead(null, { debounceMs: 100 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(reader).not.toHaveBeenCalled();
    expect(result.current.status).toBe("idle");
    expect(result.current.ignisNeed).toBeNull();
  });

  it("surfaces an error when the read rejects", async () => {
    setPactReader(vi.fn().mockRejectedValue(new Error("node down")));
    const { result } = renderHook(() => useZbomInfoRead(CODE, { debounceMs: 50 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("node down");
  });

  it("debounces rapid code changes to a single read", async () => {
    const reader = vi.fn().mockResolvedValue({ ignis: { "ignis-need": 1 } });
    setPactReader(reader);
    const { rerender } = renderHook(({ code }) => useZbomInfoRead(code, { debounceMs: 300 }), {
      initialProps: { code: CODE + "1" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    rerender({ code: CODE + "2" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    rerender({ code: CODE + "3" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(reader).toHaveBeenCalledTimes(1);
    expect(reader).toHaveBeenCalledWith(CODE + "3", { tier: "T2" });
  });

  it("refresh() forces an immediate read without waiting for the debounce", async () => {
    const reader = vi.fn().mockResolvedValue({ ignis: { "ignis-need": 1 } });
    setPactReader(reader);
    const { result } = renderHook(() => useZbomInfoRead(CODE, { debounceMs: 10_000 }));
    await act(async () => {
      result.current.refresh();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(reader).toHaveBeenCalledTimes(1);
    expect(result.current.ignisNeed).toBe(1);
  });
});
