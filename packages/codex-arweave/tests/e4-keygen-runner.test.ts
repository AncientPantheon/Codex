// @vitest-environment node
/**
 * E4 RED matrix — the off-main-thread KEYGEN-RUNNER seam (E-10, N-10 — FIX-5).
 *
 * The seam runs RSA-4096 `generateKey` OFF the main thread with COARSE progress
 * via an INJECTABLE `KeygenRunner`. The unit tests NEVER construct a real Web
 * Worker and NEVER run real RSA-4096: a `FakeKeygenRunner` emits scripted coarse
 * progress + resolves the fixture JWK, and `createWorkerKeygenRunner` is driven
 * by an INJECTED `workerFactory` returning a FAKE `Worker` that posts typed
 * `KeygenWorkerMsg` messages.
 *
 * PINNED CONTRACT (so T14.10 GREEN matches):
 *   - module path: `../src/keygen`
 *   - `runKeygen(onProgress: (p: KeygenProgress) => void): Promise<ArweaveJwk>`
 *   - `KeygenProgress` — COARSE state only (start/working/done/error); NO jwk/d/n.
 *   - `KeygenWorkerMsg` — discriminated union on `.kind`:
 *       { kind: "progress"; state: KeygenProgress }
 *     | { kind: "done"; jwk: ArweaveJwk }
 *     | { kind: "error"; message: string }
 *   - `FakeKeygenRunner` — a test double resolving/rejecting synchronously.
 *   - `createWorkerKeygenRunner({ workerFactory })` — injected, NOT hardcoded
 *     `new Worker(new URL(...))`.
 *
 * This is `// @vitest-environment node` (FIX-9): no React, no DOM — the coarse
 * message typing + the injected worker are node-logic. The default codex-arweave
 * vitest env is jsdom (for the `.tsx` panel tests).
 *
 * RED: `../src/keygen` does not exist yet (T14.10 GREEN). Every import below
 * fails to resolve — that is the expected RED reason.
 */

import { describe, it, expect, vi } from "vitest";

// RED: none of these exist yet (T14.10 GREEN provisions `../src/keygen`).
import {
  createWorkerKeygenRunner,
  FakeKeygenRunner,
  type KeygenRunner,
  type KeygenProgress,
  type KeygenWorkerMsg,
} from "../src/keygen";

import { throwawayJwk } from "./e3-helpers";

/** Assert the `// @vitest-environment node` pragma is present at the top of this
 *  file (FIX-9). The pragma is a comment esbuild strips, so we read the source. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const THIS_FILE = fileURLToPath(import.meta.url);

describe("keygen seam — the file carries the node-env pragma (FIX-9)", () => {
  it("has `// @vitest-environment node` at the top so the coarse-message + injected-worker logic runs in node, not jsdom", () => {
    const src = readFileSync(THIS_FILE, "utf8");
    // The pragma MUST be on the FIRST line (vitest only honors the top-of-file form).
    expect(src.split("\n")[0].trim()).toBe("// @vitest-environment node");
  });
});

describe("KeygenRunner contract — FakeKeygenRunner (E-10/N-10, FIX-5)", () => {
  it("(a) runKeygen emits scripted COARSE progress (working → done) IN ORDER and resolves the fixture JWK — no real RSA-4096", async () => {
    const runner: KeygenRunner = new FakeKeygenRunner({ jwk: throwawayJwk });
    const seen: KeygenProgress[] = [];

    const jwk = await runner.runKeygen((p) => seen.push(p));

    // Coarse states fire in order; the terminal "done" is present.
    expect(seen.map((p) => p.state)).toEqual(["working", "done"]);
    // The resolved key IS the injected fixture (structural equality — it never
    // ran a real generateKey).
    expect(jwk).toEqual(throwawayJwk);
  });

  it("(b) the error path: a reject-configured FakeKeygenRunner emits a coarse `error` state and REJECTS with no JWK", async () => {
    const runner: KeygenRunner = new FakeKeygenRunner({
      failWith: "worker crashed",
    });
    const seen: KeygenProgress[] = [];

    await expect(runner.runKeygen((p) => seen.push(p))).rejects.toThrow(
      /worker crashed/,
    );

    // The last coarse state is "error"; no JWK ever surfaced through progress.
    expect(seen.at(-1)?.state).toBe("error");
    for (const p of seen) {
      expect(p).not.toHaveProperty("jwk");
    }
  });

  it("(c) KeygenProgress is COARSE — carries NO JWK field (no jwk/d/n) at runtime (FIX-5)", async () => {
    const runner: KeygenRunner = new FakeKeygenRunner({ jwk: throwawayJwk });
    const seen: KeygenProgress[] = [];
    await runner.runKeygen((p) => seen.push(p));

    for (const p of seen) {
      const keys = Object.keys(p);
      // The coarse status never smuggles key material through the progress channel.
      for (const forbidden of ["jwk", "d", "n", "p", "q", "dp", "dq", "qi"]) {
        expect(keys).not.toContain(forbidden);
      }
      // Positive shape: it carries ONLY a coarse `state` discriminant.
      expect(keys).toContain("state");
    }
  });

  it("(c-type) KeygenProgress is a coarse-state union at COMPILE time — assigning a jwk-bearing shape is a type error (FIX-5)", () => {
    // Compile-time check: KeygenProgress accepts only the coarse states. A shape
    // with a `jwk` field must NOT be assignable to KeygenProgress. `@ts-expect-error`
    // FAILS the typecheck if the assignment is (wrongly) permitted.
    // @ts-expect-error — KeygenProgress carries no `jwk` field.
    const bad: KeygenProgress = { state: "done", jwk: throwawayJwk };
    const good: KeygenProgress = { state: "working" };
    expect(good.state).toBe("working");
    // reference `bad` so it is not flagged unused (the assertion is the @ts-expect-error above).
    expect(bad).toBeDefined();
  });
});

/** A minimal FAKE `Worker`: it records `postMessage` calls and lets the test
 *  drive `onmessage` with a typed `KeygenWorkerMsg`. It is NOT a real Web Worker
 *  — the injected `workerFactory` returns this, proving `createWorkerKeygenRunner`
 *  never hardcodes `new Worker(new URL(...))`. */
class FakeWorker {
  onmessage: ((ev: { data: KeygenWorkerMsg }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  posted: unknown[] = [];
  terminated = false;
  postMessage(msg: unknown): void {
    this.posted.push(msg);
  }
  terminate(): void {
    this.terminated = true;
  }
  /** Drive a typed message into the runner (structured-clone stand-in). */
  emit(data: KeygenWorkerMsg): void {
    this.onmessage?.({ data });
  }
}

describe("createWorkerKeygenRunner — injected workerFactory + typed message (FIX-5)", () => {
  it("(d) accepts an INJECTED workerFactory (a fake Worker), narrows on data.kind, and resolves on { kind: 'done'; jwk } — no real Worker constructed", async () => {
    const worker = new FakeWorker();
    const workerFactory = vi.fn(() => worker as unknown as Worker);

    const runner = createWorkerKeygenRunner({ workerFactory });
    const seen: KeygenProgress[] = [];
    const done = runner.runKeygen((p) => seen.push(p));

    // The runner obtained its worker THROUGH the injected factory (not `new Worker`).
    expect(workerFactory).toHaveBeenCalledTimes(1);

    // Drive a typed progress message then a typed done message.
    worker.emit({ kind: "progress", state: { state: "working" } });
    worker.emit({ kind: "done", jwk: throwawayJwk });

    const jwk = await done;
    expect(jwk).toEqual(throwawayJwk);
    // The seam forwarded the coarse progress via onProgress.
    expect(seen.map((p) => p.state)).toContain("working");
  });

  it("(d-error) narrows { kind: 'error'; message } → REJECTS with the message; the error branch carries ONLY message (no JWK) (FIX-5 JWK hygiene)", async () => {
    const worker = new FakeWorker();
    const runner = createWorkerKeygenRunner({
      workerFactory: () => worker as unknown as Worker,
    });

    const rejected = runner.runKeygen(() => {});
    worker.emit({ kind: "error", message: "keygen failed in worker" });

    await expect(rejected).rejects.toThrow(/keygen failed in worker/);

    // The error message the worker posted carries no key material.
    const errMsg = worker.posted; // nothing the MAIN thread posts contains a JWK either
    expect(JSON.stringify(errMsg)).not.toContain(throwawayJwk.d);
  });

  it("(e) JWK hygiene: no console.log / serialize path in the seam emits the JWK on any branch", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const worker = new FakeWorker();
    const runner = createWorkerKeygenRunner({
      workerFactory: () => worker as unknown as Worker,
    });

    const done = runner.runKeygen(() => {});
    worker.emit({ kind: "done", jwk: throwawayJwk });
    await done;

    // No log/error call ever serialized the private key material `d`.
    const allLogged = [...spy.mock.calls, ...errSpy.mock.calls]
      .flat()
      .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
      .join("\n");
    expect(allLogged).not.toContain(throwawayJwk.d);

    spy.mockRestore();
    errSpy.mockRestore();
  });
});
