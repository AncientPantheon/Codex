/**
 * zbom/index.ts barrel — codex-unlock gate export.
 *
 * `useEnsureCodexUnlocked` previously lived only at
 * `zbom/hooks/useEnsureCodexUnlocked.ts`, reachable inside `codex-ouronet` via
 * a relative import (used by all seven `zbom/modals/*` clones). Other
 * packages (`codex-arweave`) need the SAME "pop the real password prompt and
 * resume automatically" gate for their own send modals — this fixes the
 * reported bug where a locked-codex send just dead-ended on a text error
 * ("Codex is locked...") instead of prompting for the password right there.
 */

import { describe, it, expect } from "vitest";
import { useEnsureCodexUnlocked } from "@ancientpantheon/codex-ouronet/zbom";

describe("zbom barrel codex-unlock-gate export", () => {
  it("reaches useEnsureCodexUnlocked from the public ./zbom entry point", () => {
    expect(typeof useEnsureCodexUnlocked).toBe("function");
  });
});
