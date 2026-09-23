/**
 * zbom/index.ts barrel — ActionTooltip export.
 *
 * `ActionTooltip` previously lived only as a private, unexported helper
 * inside `StoaAccountsTab.tsx`. Other packages (`codex-arweave`, for its
 * Send AR Max/Super Max buttons) need the SAME styled Radix hover tooltip —
 * a bounded-width dark card, not the browser's native `title=` bubble — so
 * it moved to `zbom/ui/ActionTooltip.tsx` and is re-exported here, reachable
 * from `@ancientpantheon/codex-ouronet/zbom` without a relative cross-package
 * import.
 */
import { describe, it, expect } from "vitest";
import { ActionTooltip } from "@ancientpantheon/codex-ouronet/zbom";

describe("zbom barrel ActionTooltip export", () => {
  it("reaches ActionTooltip from the public ./zbom entry point", () => {
    expect(typeof ActionTooltip).toBe("function");
  });
});
