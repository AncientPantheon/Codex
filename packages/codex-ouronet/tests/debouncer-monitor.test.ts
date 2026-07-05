/**
 * codexClock + readRegistry — the CodexUI debouncer's real read monitor.
 *
 * Verifies the monitor observes reads (start → fresh/error), keys activity off
 * the readRegistry, exposes per-tier state + per-id status, and that the
 * registry is the complete, consistent source of truth the panel/Settings use.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { codexClock } from "@ancientpantheon/codex-ouronet/zbom";
import { CODEX_READ_REGISTRY, READ_BY_ID } from "@ancientpantheon/codex-ouronet/zbom";

beforeEach(() => codexClock._reset());

describe("readRegistry", () => {
  it("is the 16-entry source of truth with unique ids + canonical names", () => {
    expect(CODEX_READ_REGISTRY.length).toBe(16);
    const ids = CODEX_READ_REGISTRY.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    const canon = CODEX_READ_REGISTRY.map((r) => r.canonical);
    expect(new Set(canon).size).toBe(canon.length);
    // every id resolves through the lookup
    for (const r of CODEX_READ_REGISTRY) expect(READ_BY_ID[r.id]).toBe(r);
  });

  it("only uses defined tiers", () => {
    for (const r of CODEX_READ_REGISTRY) {
      expect(["T1", "T2", "T3", "T4", "T5", "T6", "T7"]).toContain(r.tier);
    }
  });
});

describe("codexClock monitor", () => {
  it("starts idle — no reads observed", () => {
    expect(codexClock.getReadStatus("URC_0027")).toBe("idle");
    expect(codexClock.getTierState("T5").queryCount).toBe(0);
  });

  it("records a successful read as fresh on its registry tier", async () => {
    const result = await codexClock.report("URC_0027", undefined, async () => "ok");
    expect(result).toBe("ok"); // instrumentation is transparent
    expect(codexClock.getReadStatus("URC_0027")).toBe("fresh");
    // URC_0027 rides T5
    const t5 = codexClock.getTierState("T5");
    expect(t5.queryCount).toBe(1);
    expect(t5.isFetching).toBe(false);
    // a different tier stays idle
    expect(codexClock.getTierState("T2").queryCount).toBe(0);
  });

  it("records a failed read as error and re-throws unchanged", async () => {
    const boom = new Error("node down");
    await expect(
      codexClock.report("URC_0028", undefined, async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
    expect(codexClock.getReadStatus("URC_0028")).toBe("error");
  });

  it("counts per-chain reads as distinct queries on the same tier", async () => {
    await codexClock.report("coin.get-balance", { chainId: "0" }, async () => 1);
    await codexClock.report("coin.get-balance", { chainId: "1" }, async () => 2);
    // coin.get-balance rides T5 — two chains ⇒ two query rows
    expect(codexClock.getTierState("T5").queryCount).toBe(2);
    expect(codexClock.getReadStatus("coin.get-balance")).toBe("fresh");
  });

  it("lists active reads per tier for the medallion tooltip", async () => {
    await codexClock.report("URC_0027", undefined, async () => "ok");
    const t5Rows = codexClock.getQueriesByTier().get("T5") ?? [];
    expect(t5Rows.length).toBe(1);
    expect(t5Rows[0].id).toBe("URC_0027");
    expect(t5Rows[0].status).toBe("fresh");
  });
});
