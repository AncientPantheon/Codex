/**
 * zbom/index.ts barrel — toast surface export (T1).
 *
 * `txPending` and its supporting types previously lived only at
 * `zbom/toast/toastManager.ts`, reachable inside `codex-ouronet` via a
 * relative import (e.g. `SendStoaModal.tsx`). Other packages (`codex-arweave`)
 * need to show the same standard submit/confirming/confirmed toast without a
 * relative cross-package import, so `./toast` must be re-exported from the
 * public `./zbom` barrel alongside `./debouncer`, `./patron`, `./zbomProfiles`.
 */

import { describe, it, expect } from "vitest";
import type { ToastController, ToastEntry } from "@ancientpantheon/codex-ouronet/zbom";
import { txPending } from "@ancientpantheon/codex-ouronet/zbom";

describe("zbom barrel toast export", () => {
  it("reaches txPending from the public ./zbom entry point and exposes a submitted/fail controller", () => {
    const ctrl = txPending("test");
    expect(typeof ctrl.submitted).toBe("function");
    expect(typeof ctrl.fail).toBe("function");
  });

  it("re-exports the ToastController/ToastEntry types used by txPending's return shape", () => {
    // Type-only usage: this assignment only compiles if both types are
    // reachable from the barrel — asserted at compile time via `tsc --noEmit`,
    // exercised here so the test file references both imported symbols.
    const entry: ToastEntry = {
      id: "t-1",
      title: "test",
      steps: [{ label: "Processing", status: "pending" }],
      createdAt: Date.now(),
    };
    expect(entry.id).toBe("t-1");

    const assertController = (_c: ToastController) => {};
    assertController({
      id: "t-1",
      updateStep: () => {},
      dismiss: () => {},
    });
  });
});
