/**
 * The hand-written `LOCAL_STOA_SIGNATURES` stopgap still matches the
 * deployed `coin` contract. Mirrors the (now-deleted, but same-shaped)
 * `zbom-native-stoa-specs.test.ts` pattern exactly: re-read the source, fail
 * loudly on drift, skip visibly (not silently) when the sibling Pact
 * checkout is absent from this machine.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LOCAL_STOA_SIGNATURES, resolveLocalStoaSlots } from "../src/zbom/cfm/localStoaSignatures.js";

/** The Pact repo is a SIBLING top-level checkout on this machine, not a
 *  dependency — it may legitimately be absent. 6 levels up from `tests/`
 *  reaches the shared parent both workspaces sit under (confirmed via
 *  `realpath` earlier this session). */
const COIN = join(
  __dirname, "..", "..", "..", "..", "..", "..",
  "OuroborosNetwork", "_onchain", "Ouronet", "0_Stoa", "coin-contract", "coin-live.pact",
);
const HAVE_SOURCE = existsSync(COIN);

function signaturesFromSource(src: string): Map<string, Array<[string, string]>> {
  const out = new Map<string, Array<[string, string]>>();
  for (const m of src.matchAll(/^\s*\(defun\s+([A-Za-z0-9_|]+):\w+\s*\(([^)]*)\)/gm)) {
    const params = m[2]
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((tok): [string, string] => {
        const [name, type] = tok.split(":");
        return [name, type];
      });
    out.set(m[1], params);
  }
  return out;
}

describe("LOCAL_STOA_SIGNATURES match the deployed coin contract", () => {
  const maybe = HAVE_SOURCE ? it : it.skip;

  it("knows whether it can check at all", () => {
    if (!HAVE_SOURCE) {
      console.warn(
        `[zbom-local-stoa-signatures] SKIPPED — no coin source at ${COIN}. ` +
          `These signatures are hand-written and UNVERIFIED in this checkout.`,
      );
    }
    expect(typeof HAVE_SOURCE).toBe("boolean");
  });

  maybe("every local signature is the contract's own, parameter for parameter, NAME AND TYPE", () => {
    const src = readFileSync(COIN, "utf8");
    const real = signaturesFromSource(src);
    expect(real.size, "parsed no defuns from the coin contract").toBeGreaterThan(20);

    for (const [key, spec] of Object.entries(LOCAL_STOA_SIGNATURES)) {
      const fn = key.replace(/^coin\./, "");
      const actual = real.get(fn);
      expect(actual, `${fn} is not defined in the deployed coin contract`).toBeDefined();
      expect(
        spec.signature.map(([name, type]) => `${name}:${type}`),
        `${key} signature drifted from the contract`,
      ).toEqual(actual!.map(([name, type]) => `${name}:${type}`));
    }
  });

  it("every entry is a coin.* key", () => {
    for (const key of Object.keys(LOCAL_STOA_SIGNATURES)) {
      expect(key.startsWith("coin."), `${key} must be a coin.* key`).toBe(true);
    }
  });
});

describe("resolveLocalStoaSlots — the type-aware caller-value/ghost fallback, mirroring tooltipModel's own for every other stoa/kadena key", () => {
  const sig = LOCAL_STOA_SIGNATURES["coin.C_TransferAcross"];

  it("a caller-supplied value for a name wins over any ghost, and is not a placeholder", () => {
    const slots = resolveLocalStoaSlots(sig, { sender: '"k:realsender"', "target-chain": '"1"' });
    const sender = slots.find((s) => s.name === "sender")!;
    const targetChain = slots.find((s) => s.name === "target-chain")!;
    expect(sender.value).toBe('"k:realsender"');
    expect(sender.isPlaceholder).toBe(false);
    expect(targetChain.value).toBe('"1"');
    expect(targetChain.isPlaceholder).toBe(false);
  });

  it("an unsupplied name falls back to a TYPE-appropriate ghost, never a placeholder for a type this table knows", () => {
    const slots = resolveLocalStoaSlots(sig, { sender: '"k:realsender"' });
    const receiverGuard = slots.find((s) => s.name === "receiver-guard")!;
    const amount = slots.find((s) => s.name === "amount")!;
    expect(receiverGuard.value).toBe('(read-keyset "ks")'); // guard-type ghost
    expect(receiverGuard.isPlaceholder).toBe(false);
    expect(amount.value).toBe("1.0"); // decimal-type ghost
    expect(amount.isPlaceholder).toBe(false);
  });

  it("receiver and target-chain resolve to DIFFERENT real values when both are supplied — the exact bug this round fixed for the registry-backed Kadena sibling (both string-typed, so an unsupplied pair would share the SAME generic ghost)", () => {
    const slots = resolveLocalStoaSlots(sig, {
      sender: '"k:sender"',
      receiver: '"k:receiver"',
      "target-chain": '"1"',
    });
    const receiver = slots.find((s) => s.name === "receiver")!;
    const targetChain = slots.find((s) => s.name === "target-chain")!;
    expect(receiver.value).toBe('"k:receiver"');
    expect(targetChain.value).toBe('"1"');
    expect(receiver.value).not.toBe(targetChain.value);
  });

  it("with no values supplied at all, every slot falls back to its type's ghost, index/name/type stay in the signature's own declared order", () => {
    const slots = resolveLocalStoaSlots(sig);
    expect(slots.map((s) => s.name)).toEqual(["sender", "receiver", "receiver-guard", "target-chain", "amount"]);
    expect(slots.map((s) => s.index)).toEqual([1, 2, 3, 4, 5]);
    expect(slots.every((s) => !s.isPlaceholder)).toBe(true); // every type in this signature has a known ghost
  });
});
