/**
 * AccountSeedRevealModal — the real seed-reveal popup for the Settling
 * Dashboard's "account has no matching Chainweb seed on record" fallback
 * card (`docs/work/wizard-page2-and-dashboard-fixes/design.md`, round 3).
 *
 * Owner (live testing, this round): "Selecting AncientHolder, and then
 * clicking reveal seed, still doesn't show its Ouronet Seed, which is
 * what it should happen" — and, the round before that: "whatever Ouronet
 * Account you choose, it makes seed word recuperation possible, so i
 * dont know what you had to write that [a 'no known words' warning]."
 * Both point at the same fact: an `IOuroAccount`'s own `secret` is
 * ALWAYS independently decryptable/revealable (`ViewSeedModal.tsx`
 * already proves this for every real account in the app), entirely
 * independent of whether some `IStoaChainSeed` ENTITY in the codex's own
 * seed list happens to share its words. The Settling Dashboard's
 * "View seed" buttons are all scoped to a CARD, and a card only exists
 * for a seed `computeSeedDashboardCards` actually found a role-match
 * for — an account genuinely unmatched by any recorded seed (common for
 * the legacy/imported accounts this whole wizard exists to rescue)
 * never gets a card, so there was nothing to click that would ever show
 * THAT account's own material. `LegacyPrimeMigrationWizard.tsx`'s own
 * `SeedDashboard` now renders one extra, always-present fallback card
 * for the chosen account specifically when `accountSeedId` didn't
 * resolve to anything — this is THAT fallback card's own reveal modal.
 *
 * Mirrors `ViewSeedModal.tsx`'s own decrypt sequence (`smartDecrypt`
 * `account.secret`, then `DalosSecretReveal` with
 * `account.originMode ?? "seedWords"` / `detectOriginCurve(account)`)
 * exactly — but PROP-DRIVEN (`getPassword` prop, never `useCodexAuth()`/
 * `useCodex()` hooks), matching this wizard's own established
 * convention (`AccountStep`/`SeedRevealModal` already receive
 * `getPassword?` as a prop, for the same testability reason) rather than
 * the hook-based pattern `ViewSeedModal.tsx` uses.
 *
 * PASSWORD FAILURES ARE RECOVERABLE (`docs/work/wizard-unlock-lifecycle/
 * design.md`, T3). Owner, live: "View seed" showed
 * `Codex is locked; operation "getPassword" requires authentication. Call
 * authenticate(password) first.` — the raw store error, verbatim, inside a
 * modal titled with their own account's name. The wizard is a long,
 * think-about-it flow and the unlock window is short and ABSOLUTE, so
 * hitting it mid-run is ordinary rather than exceptional. Both password
 * failures now render {@link InlineUnlockPrompt} instead, and a correct
 * entry reveals the account's words in the SAME open modal:
 *
 *   - `"locked"` — `getPassword()` threw (or wasn't supplied at all).
 *   - `"wrong"`  — `getPassword()` SUCCEEDED, but `account.secret` would
 *                  not decrypt with what it returned. (`authenticate()`
 *                  never validates what it caches, so a stale/typo'd
 *                  password reads back out without complaint.)
 *
 * This modal has exactly ONE decrypt, so a `smartDecrypt` failure is
 * always one of those two — there is no third, non-password failure mode
 * here to preserve a separate message for. A correct, freshly-entered
 * password that STILL fails is the mixed-password data situation the
 * design puts explicitly out of scope; this prompt's job is to make sure
 * the user is asked, and told which case they are in.
 */

import * as React from "react";
import { useCallback, useEffect, useState } from "react";
import { smartDecrypt } from "@stoachain/stoa-core/crypto";

import { CodexModalShell } from "./CodexModalShell.js";
import { DalosSecretReveal } from "./DalosSecretReveal.js";
import { InlineUnlockPrompt } from "./InlineUnlockPrompt.js";
import { detectOriginCurve } from "./originCurve.js";
import { useCodexStoreOptional } from "../../provider/index.js";
import type { IOuroAccount } from "../../types/entities.js";

export interface AccountSeedRevealModalProps {
  open: boolean;
  onClose: () => void;
  account: IOuroAccount;
  /** Optional, matching this wizard's own prop-driven convention — absent
   *  or throwing (e.g. `CodexLockedError`) is the "locked" case: it
   *  prompts for the password inline, never crashes. */
  getPassword?: () => string;
}

/** Which of the two recoverable password failures happened, or `null` when
 *  the password was never the problem. Same two names the Account step's
 *  own inline prompt already uses (`LegacyPrimeMigrationWizard.tsx`). */
type PasswordProblem = "locked" | "wrong";

const LOCKED_PROMPT_MESSAGE =
  "Your codex is locked — enter your password to view this account's seed.";
const WRONG_PROMPT_MESSAGE =
  "The password this codex currently holds could not decrypt this account. "
  + "Re-enter it to view its seed.";

export function AccountSeedRevealModal({
  open, onClose, account, getPassword,
}: AccountSeedRevealModalProps): React.ReactElement | null {
  const [plain, setPlain] = useState<string | null>(null);
  const [needsPassword, setNeedsPassword] = useState<PasswordProblem | null>(null);
  // The NON-throwing store hook, deliberately: this modal is mounted in
  // tests (and in the Settling Dashboard's own standalone render paths)
  // with no `<CodexProvider>` ancestor at all. `null` means "no unlock
  // window to manage here" — the typed password is still used for the
  // decrypt, which is the behaviour that matters to the user. Read via
  // `getState()` inside the handler, never subscribed, so no conditional
  // hook call arises. Same reasoning `useEnsureCodexUnlockedOptional`
  // documents (`zbom/hooks/useEnsureCodexUnlocked.ts`).
  const codexStore = useCodexStoreOptional();

  /** The one decrypt, for one known password — shared verbatim by the
   *  mount effect (which respects its own cancellation) and the prompt. */
  const decryptWith = useCallback(async (
    password: string,
  ): Promise<{ ok: true; plain: string } | { ok: false }> => {
    try {
      return { ok: true, plain: await smartDecrypt(account.secret, password) };
    } catch {
      // The raw crypto-library error (an AES-GCM auth-tag failure) said
      // nothing a user could act on; the caller turns this into the
      // "wrong password" prompt instead.
      return { ok: false };
    }
  }, [account.secret]);

  useEffect(() => {
    if (!open) return;
    setPlain(null);
    setNeedsPassword(null);
    let cancelled = false;
    void (async () => {
      let password: string;
      try {
        if (!getPassword) throw new Error("the codex is locked");
        password = getPassword();
      } catch {
        // `getPassword()` threw: locked (or never supplied). The thrown
        // message is an internal API instruction ("Call
        // authenticate(password) first") — deliberately NOT surfaced.
        if (!cancelled) setNeedsPassword("locked");
        return;
      }
      const result = await decryptWith(password);
      if (cancelled) return;
      if (!result.ok) {
        setNeedsPassword("wrong");
        return;
      }
      setPlain(result.plain);
    })();
    return () => { cancelled = true; };
  }, [open, account.id, decryptWith, getPassword]);

  /**
   * Prompt submit: decrypt FIRST, then cache — the Account step's own
   * `handleUnlockAndProbe()` order, so a wrong password is never written
   * into the store's cache.
   *
   * The unlock window is ABSOLUTE, not sliding: `authenticate()` may only
   * fire when the codex was genuinely locked. `src/zbom/hooks/
   * useEnsureCodexUnlocked.ts` records the bug where calling it
   * unconditionally reset the TTL on every operation, so the visible
   * "re-authenticate in X" countdown meant nothing. The `"wrong"` case
   * reaches here on an UNLOCKED codex (its `getPassword()` succeeded), and
   * must leave that countdown exactly where it was.
   */
  async function handleUnlock(password: string): Promise<{ ok: boolean }> {
    const state = codexStore?.getState();
    const cache = state?.passwordCache ?? null;
    const wasUnlocked = !!cache && cache.expiresAt > Date.now();

    const result = await decryptWith(password);
    // `{ ok: false }` with no `error` → InlineUnlockPrompt's own
    // "Incorrect password — try again.", with the typed value kept.
    if (!result.ok) return { ok: false };

    if (!wasUnlocked) state?.actions.authenticate(password);
    setPlain(result.plain);
    setNeedsPassword(null);
    return { ok: true };
  }

  if (!open) return null;

  return (
    <CodexModalShell
      title={account.name ?? "Ouronet Account"}
      onClose={onClose}
      dialogTestId="legacy-prime-migration-account-seed-reveal-modal"
    >
      {needsPassword !== null ? (
        <InlineUnlockPrompt
          message={needsPassword === "locked" ? LOCKED_PROMPT_MESSAGE : WRONG_PROMPT_MESSAGE}
          submitLabel="Unlock & View"
          onUnlock={handleUnlock}
        />
      ) : plain ? (
        <DalosSecretReveal
          plaintext={plain}
          originMode={account.originMode ?? "seedWords"}
          originCurve={detectOriginCurve(account)}
          hideAddress
        />
      ) : (
        <p style={{ fontSize: 13, color: "#8b8b96" }}>Decrypting…</p>
      )}
    </CodexModalShell>
  );
}
