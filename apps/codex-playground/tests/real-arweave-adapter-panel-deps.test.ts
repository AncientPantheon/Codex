/**
 * `arweave-upload-wizard-deps-wiring-gap`: `buildRealPanelDeps` has always
 * constructed `runDryRunUpload`/`isStreamingUploadSupported` (see
 * `codex-backup-wiring.test.ts`'s own dedicated describe blocks for both),
 * but until this task widened `ArweavePanelDeps` (`context.tsx`) to declare
 * them, they were visible only on this function's own intersection return
 * type — `ArweavePanel.tsx`, typed against the narrower `ArweavePanelDeps`,
 * had no way to even SEE them, let alone thread them to the mounted
 * `UploadWizard`. This pins that the WIDENED interface now actually carries
 * both fields: assigning `buildRealPanelDeps`'s return value to an
 * `ArweavePanelDeps`-typed variable and reading `runDryRunUpload`/
 * `isStreamingUploadSupported` straight off that DECLARED (not inferred)
 * type is a genuine compile-time proof the fields exist on the interface
 * itself — before this task, `tsc --noEmit` would have failed here with
 * "Property 'runDryRunUpload' does not exist on type 'ArweavePanelDeps'."
 * The runtime assertions below are the SAME proof's belt-and-suspenders
 * sibling: a real function actually ends up at both property reads, not
 * just a type that happens to compile.
 */
import { describe, it, expect } from "vitest";
import type { ArweavePanelDeps } from "@ancientpantheon/codex-arweave/panel";
import { buildRealPanelDeps } from "../src/realArweaveAdapter";

describe("buildRealPanelDeps — return value structurally satisfies the widened ArweavePanelDeps", () => {
  it("exposes runDryRunUpload/isStreamingUploadSupported as real functions when read through the ArweavePanelDeps-DECLARED type (not just this function's own wider return type)", () => {
    const deps: ArweavePanelDeps = buildRealPanelDeps({
      gatewayUrl: "https://arweave.example.invalid",
    });

    expect(typeof deps.runDryRunUpload).toBe("function");
    expect(typeof deps.isStreamingUploadSupported).toBe("function");
  });
});
