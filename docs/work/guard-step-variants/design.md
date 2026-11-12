# Guard Step — Variant-Aware Options — Design

## Problem

Step 3B (`GuardSection`/`GuardStep` in `LegacyPrimeMigrationWizard.tsx`) offers
the same three options — upgrade to a recommended single-key keyset, keep as
is, define a custom keyset — regardless of what the account's CURRENT guard
actually is. That collapses two meaningfully different situations into one
screen:

- **A keyset reference** (`{keysetref:{ns,ksn}}`) — the account's guard
  points at a keyset defined once on a namespace; other accounts may share
  that same reference. "Upgrading" today means abandoning the reference for
  a brand-new direct keyset, which is heavier-handed than necessary — the
  referenced keyset could instead be updated in place, leaving every account
  that shares it upgraded together.
- **A direct keyset, or no guard at all** — there is no shared reference to
  preserve; "upgrade" is unambiguously "install a new direct keyset."

The owner's ask: detect which situation the account is actually in and offer
the right option set for each, with an explicit recommendation tier
(`DALOS Highly Recommended` > `DALOS Recommended` > the rest), and keep the
genuinely dangerous/expert paths (arbitrary custom keys, pointing at some
other existing keyset) separate and clearly marked.

## Approach

**Detection reuses what already exists.** `resolveGuardKeys()` already
classifies the current guard into a `GuardKeyResolution`. Its `kind` already
sorts into exactly the two variants needed:

- Variant A (keyset reference): `"keyset-ref"` or `"keyset-ref-unresolved"`.
- Variant B (direct keyset or none): `"keyset"` or `"none"`.
- Neither (`"unsupported"`/`"unknown"` — a capability/user guard, or a shape
  this code doesn't recognise): keeps today's existing fallback copy and
  options unchanged — there is nothing variant-specific to offer when the
  current guard isn't a keyset at all.

**The choice type grows by three new kinds, reusing two existing ones.**
`"recommended-single-key"` and `"custom"` already mean exactly "install a
direct keyset" (recommended / arbitrary) regardless of what came before, so
both variants' "switch to an on-the-spot keyset" options reuse them
unchanged — no migration concern, their meaning doesn't change.

Three new kinds, one per genuinely new action:

```ts
| { kind: "update-keyset-recommended" }                                  // keep the ref, update IT to key #1 / keys-all
| { kind: "update-keyset-custom"; keys: readonly string[]; pred: string } // keep the ref, update IT to custom keys/pred
| { kind: "use-existing-keyset"; ns: string; ksn: string;
    keys: readonly string[]; pred: string }                              // point the guard at a DIFFERENT existing keyset
```

Added to both `LegacyPrimeMigrationGuardChoice` (the wizard's live type) and
`MigrationGuardSelection` (`codex-core`, the persisted/resumable form) — kept
in lockstep, same as every other field in that pair.

**Locking needs no new branches.** The session's standing rule — Stage 2
locks whatever the INTENDED final key set is, whether or not a Stage 3
transaction is still needed to make it true on chain (this is exactly how
"derive"/"recommended-single-key" already work before their on-chain
rotation happens) — covers all three new kinds directly: `"update-keyset-*"`
locks the intended key(s) the SAME way `"recommended-single-key"`/`"custom"`
already do; `"use-existing-keyset"` locks the keys `describeKeyset` already
resolved before the choice became selectable (see below — never a
user-typed, unverified list).

**`"use-existing-keyset"`'s keys come from `describeKeyset`, never from a
free-form field.** The owner's own spec says "you must provide the keys to
use such a keyset" — but this project's standing safety rule (pinned
repeatedly this session: absence of evidence must not unlock or mis-lock a
funds-bearing key) means trusting a manually typed key list would be the one
place in this screen that could silently lock the WRONG thing. Instead: the
user types the `ns.ksn` name, the screen resolves it through the SAME
`describeKeyset` mechanism Variant A's display already uses, shows the
real resolved keys/predicate, and only then does Continue unblock — mirrors
the existing "custom keyset must have ≥1 key" gate exactly. A resolution
failure shows the same honest "could not be read — unknown, not empty" state
Variant A's reference display already has, never a silent empty list.

**On-chain execution of `"update-keyset-*"` is explicitly NOT built this
round.** Confirmed by research, not assumed: no Pact call or TS wrapper
anywhere in this codebase updates an existing namespace keyset's own
definition — `RotateGuardModal`/Stage 3A's rotate flow only ever repoint an
ACCOUNT's guard, never mutate what a reference resolves to. The choice is
fully selectable and recorded (so a future Stage 3 can read exactly what the
user asked for), but nothing attempts to execute it — same parked status as
every other Stage 3 transaction this session has deferred.

### Alternatives considered

- **Model as `{action, keys?, pred?, ns?, ksn?}` instead of one kind per
  concrete choice.** Rejected: every sibling choice type in this file
  (`LegacyPrimeMigrationPaymentChoice`, `LegacyPrimeMigrationAccountChoice`)
  is a tagged union of concrete choices, not action+params. Matching that
  convention keeps pattern-matching (`.kind === "..."`) consistent
  everywhere it's already used, including the lock computation and
  `migrationResume.ts`.
- **Let the user type arbitrary keys for `"use-existing-keyset"`.** Rejected
  above — the one place this screen would trust an unverified assertion
  instead of a real resolution.

## UI structure

Two option sets, chosen by `resolution.kind`:

**Variant A** (keyset-ref): four top-level options —
0. Keep as is — tag **Not Recommended**
1. Keep the reference, update the keyset to key #1 / keys-all — tag
   **DALOS Highly Recommended**
2. Switch to a direct keyset, key #1 / keys-all — tag **DALOS Recommended**
3. Define Custom Guard — tag **Expert Mode**; expands to a 3A/3B toggle
   (keep ref + custom keys/pred, or switch to direct + custom keys/pred)

**Variant B** (direct keyset or none): three top-level options —
1. Switch to a direct keyset, key #1 / keys-all — tag **DALOS Recommended**
2. Keep as is — tag **Not Recommended**
3. Define Custom Guard — tag **Expert Mode**; expands to a 3A/3B toggle
   (a custom direct keyset, or point at a different existing keyset by name)

New badge components (`DalosHighlyRecommendedBadge`, `DalosRecommendedBadge`,
`NotRecommendedBadge`) — the existing plain `RecommendedBadge` stays
unchanged everywhere else it's already used (payment "derive", the
derivation-method options); this is new vocabulary specific to the guard
step's own tiering, not a rename sweep.

## Acceptance criteria

- [ ] On an account whose current guard is a keyset reference, Step 3B
      shows exactly the four Variant A options, correctly tagged.
- [ ] On an account whose current guard is a direct keyset or absent, Step
      3B shows exactly the three Variant B options, correctly tagged.
- [ ] On an account whose guard is a capability/user guard or an
      unrecognised shape, Step 3B's existing (unchanged) option set and
      copy still render — no crash, no wrong variant guess.
- [ ] Choosing "update the keyset" (recommended or custom) locks the
      intended key(s) at Stage 2 commit, the same as "recommended-single-key"
      already does — provable without any chain call.
- [ ] "Use an existing keyset" requires a successful `describeKeyset`
      resolution before Continue unblocks; a failed resolution shows the
      same honest "could not be read" state Variant A's own reference
      display already uses, never an empty/wrong key list.
- [ ] A resumed run correctly restores any of the three new choice kinds,
      including a demote-to-warn for custom/existing keys the codex no
      longer holds (same treatment the existing `"custom"` kind already
      gets in `migrationResume.ts`).
- [ ] No code path executes an on-chain "update this keyset" transaction —
      the choice is recorded and locked, never submitted.

## Out of scope

- Actually executing "update the keyset's own definition" on chain (Stage
  3, parked — needs real research against the deployed contracts first).
- Renaming the existing plain `RecommendedBadge` used elsewhere in the
  wizard to match the new "DALOS Recommended" wording.
- Any change to the payment step (3A) — this topic is Step 3B only.
