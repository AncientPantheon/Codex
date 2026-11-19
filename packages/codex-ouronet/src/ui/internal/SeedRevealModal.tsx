/**
 * The real seed-reveal popup for the Settling Dashboard's sub-row buttons
 * (`docs/work/wizard-page2-and-dashboard-fixes/design.md`) — reuses this
 * codex's OWN existing reveal primitive, `DalosSecretReveal` (Seed/Bitmap/
 * BitString/Base-10/Base-49 tabs), exactly as `ViewSeedModal.tsx` (for an
 * `IOuroAccount`) and `SeedWordsTab.tsx`'s own inline reveal (for an
 * `IStoaChainSeed`) already do — nothing here is rebuilt.
 *
 * Unlike both of those, this component is PROP-DRIVEN (a `getPassword`
 * prop, never `useCodexAuth()`/`useCodex()` hooks) — matching this
 * wizard's own established convention (`AccountStep` already receives
 * `getPassword?`/`authenticate?` as props, for the same testability
 * reason) rather than the hook-based pattern those two other callers use.
 *
 * `seed.secret` is NOT always a bitstring — owner correction (live
 * testing, real-data bug, round 1): "when i click view seed, it cant
 * tell me the seed words". Per `entities.ts`'s own doc comments (and
 * `CreateStoaChainSeedModal.tsx`'s two creation paths), `secret` decrypts
 * to a valid 1600-bit bitstring ONLY for `seedType: "stoic"`; for every
 * OTHER type (koala/chainweaver/eckowallet) it is the encrypted MNEMONIC
 * directly, never run through `seedWordsToBitString`.
 *
 * Round 1's first fix branched on this by showing a bare plain-text box
 * for non-stoic seeds instead of `DalosSecretReveal` — owner correction
 * (round 2, REGRESSION): "it is shown like this, instead of using the
 * whole seed view we had previously... its good that the seed is
 * recognized, but its a regression that we are not shown the full popup
 * we settled before we'd use." The actual fix is simpler: feed
 * `DalosSecretReveal` the real WORDS via `originMode="seedWords"` (which
 * it derives every other tab — Bitmap/BitString/Base-10/Base-49 — FROM
 * itself) instead of `originMode="bitString"` (the mode that actually
 * crashed in round 1, because a non-stoic seed's `secret` isn't a
 * bitstring). A non-stoic seed's `secret` IS the real mnemonic, so it
 * gets the EXACT same full tabbed reveal a `"stoic"` seed's own
 * `wordsSecret` already gets — no separate plain-text fallback needed at
 * all. The bitstring-only view (`originMode="bitString"`) is reserved
 * for the one case where no words exist to show: a `"stoic"` seed with
 * no (or an undecryptable) `wordsSecret`.
 *
 * PASSWORD FAILURES ARE RECOVERABLE (`docs/work/wizard-unlock-lifecycle/
 * design.md`, T3). Owner, live: clicking "View seed" showed
 * `Codex is locked; operation "getPassword" requires authentication. Call
 * authenticate(password) first.` — the raw store error, verbatim, inside a
 * modal titled with their own seed's name. The wizard is a long, think-
 * about-it flow and the unlock window is short, so hitting it mid-run is
 * ordinary, not exceptional. Both password failures now render
 * {@link InlineUnlockPrompt} instead, and a correct entry reveals the seed
 * in the SAME open modal:
 *
 *   - `"locked"` — `getPassword()` threw (or wasn't supplied at all).
 *   - `"wrong"`  — `getPassword()` SUCCEEDED, but `seed.secret` would not
 *                  decrypt with what it returned. (`authenticate()` never
 *                  validates what it caches, so a stale/typo'd password
 *                  sits in the cache and reads back without complaint.)
 *
 * Every OTHER failure keeps its existing behaviour untouched — in
 * particular a `"stoic"` seed whose `wordsSecret` won't decrypt while
 * `secret` DID still falls back to the bitstring-only view, with no
 * prompt: the password is provably correct there (it just decrypted
 * `secret`), so asking for it again would be a lie.
 */

import * as React from "react";
import { useCallback, useEffect, useState } from "react";
import { smartDecrypt } from "@stoachain/stoa-core/crypto";

import { CodexModalShell } from "./CodexModalShell.js";
import { DalosSecretReveal } from "./DalosSecretReveal.js";
import { InlineUnlockPrompt } from "./InlineUnlockPrompt.js";
import { seedDisplayNameFallback } from "./seedDashboard.js";
import { useCodexStoreOptional } from "../../provider/index.js";
import type { IStoaChainSeed } from "../../types/entities.js";

export interface SeedRevealModalProps {
  open: boolean;
  onClose: () => void;
  seed: IStoaChainSeed;
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
  "Your codex is locked — enter your password to view this seed.";
const WRONG_PROMPT_MESSAGE =
  "The password this codex currently holds could not decrypt this seed. "
  + "Re-enter it to view it.";

export function SeedRevealModal({
  open, onClose, seed, getPassword,
}: SeedRevealModalProps): React.ReactElement | null {
  // For `seedType: "stoic"`, this holds the decrypted BITSTRING. For
  // every other seed type, this holds the decrypted MNEMONIC directly —
  // see the module doc for why there is no single universal meaning.
  const [secretPlain, setSecretPlain] = useState<string | null>(null);
  const [wordsPlain, setWordsPlain] = useState<string | null>(null);
  const [needsPassword, setNeedsPassword] = useState<PasswordProblem | null>(null);
  const isStoic = seed.seedType === "stoic";
  // The NON-throwing store hook, deliberately: these modals are mounted in
  // tests (and in the Settling Dashboard's own standalone render paths)
  // with no `<CodexProvider>` ancestor at all. `null` means "no unlock
  // window to manage here" — the typed password is still used for the
  // decrypt, which is the behaviour that matters to the user. Read via
  // `getState()` inside the handler, never subscribed, so no conditional
  // hook call arises. Same reasoning `useEnsureCodexUnlockedOptional`
  // documents (`zbom/hooks/useEnsureCodexUnlocked.ts`).
  const codexStore = useCodexStoreOptional();

  /**
   * The decrypt sequence for one known password. Returns the plaintexts
   * rather than setting state, so the mount effect (which must respect its
   * own cancellation) and the unlock prompt can share it verbatim.
   */
  const decryptWith = useCallback(async (
    password: string,
  ): Promise<{ ok: true; secretPlain: string; wordsPlain: string | null } | { ok: false }> => {
    let plain: string;
    try {
      plain = await smartDecrypt(seed.secret, password);
    } catch {
      // The raw crypto-library error (e.g. an AES-GCM auth-tag failure) is
      // alarming and uninformative to a real user, and this outcome is
      // ordinary rather than a system fault — so the caller turns it into
      // the "wrong password" prompt, never a verbatim crypto string.
      return { ok: false };
    }
    let words: string | null = null;
    if (seed.seedType === "stoic" && seed.wordsSecret) {
      try {
        words = await smartDecrypt(seed.wordsSecret, password);
      } catch {
        // Swallowed on purpose — `secret` already decrypted successfully
        // with the SAME password, so a `wordsSecret` failure means
        // corrupt/foreign ciphertext, not a wrong password. Falls back to
        // the bitstring-only view rather than blocking (or, worse,
        // prompting again for) a reveal that already succeeded.
      }
    }
    return { ok: true, secretPlain: plain, wordsPlain: words };
  }, [seed.secret, seed.wordsSecret, seed.seedType]);

  useEffect(() => {
    if (!open) return;
    setSecretPlain(null);
    setWordsPlain(null);
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
      setSecretPlain(result.secretPlain);
      setWordsPlain(result.wordsPlain);
    })();
    return () => { cancelled = true; };
  }, [open, seed.id, decryptWith, getPassword]);

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
    setSecretPlain(result.secretPlain);
    setWordsPlain(result.wordsPlain);
    setNeedsPassword(null);
    return { ok: true };
  }

  if (!open) return null;

  // The real WORDS to show, regardless of seed type: for `"stoic"`,
  // that's the separately-decrypted `wordsSecret` (when present and
  // decryptable); for every OTHER type, `secretPlain` itself already IS
  // the real mnemonic — no second field needed, per the module doc.
  const wordsToShow = isStoic ? wordsPlain : secretPlain;

  return (
    <CodexModalShell
      title={seedDisplayNameFallback(seed)}
      onClose={onClose}
      dialogTestId="legacy-prime-migration-seed-reveal-modal"
    >
      {needsPassword !== null ? (
        <InlineUnlockPrompt
          message={needsPassword === "locked" ? LOCKED_PROMPT_MESSAGE : WRONG_PROMPT_MESSAGE}
          submitLabel="Unlock & View"
          onUnlock={handleUnlock}
        />
      ) : wordsToShow ? (
        <DalosSecretReveal
          key="seed-words"
          plaintext={wordsToShow}
          originMode="seedWords"
          originCurve="dalos"
          hideAddress
        />
      ) : isStoic && secretPlain ? (
        // Only reached for a `"stoic"` seed with no (or an
        // undecryptable) `wordsSecret` — no words to show, so this falls
        // back to the bitstring-only view instead.
        <DalosSecretReveal
          key="seed-bitstring"
          plaintext={secretPlain}
          originMode="bitString"
          originCurve="dalos"
          hideAddress
        />
      ) : (
        <p style={{ fontSize: 13, color: "#8b8b96" }}>Decrypting…</p>
      )}
    </CodexModalShell>
  );
}
