# SeedType/StoaChainSeedType stoic parity — Design

## Problem

`packages/codex-ouronet/src/types/entities.ts`'s `SeedType` (the real type on
`IStoaChainSeed.seedType`) was widened to four members —
`"koala" | "chainweaver" | "eckowallet" | "stoic"` — when Stoa Dalos ("stoic")
seeds were added. `packages/codex-core/src/resolver/headlessResolver.ts`'s
`StoaChainSeedType` is Codex's own separate, hand-kept copy of the same union,
still three members, with a doc comment claiming it mirrors the real type
"verbatim." It doesn't anymore.

`StoaChainSeedType` types `StoaChainSeedLike.seedType`, which is what
`SnapshotSlice` (the parameter type of both codex-core's
`createHeadlessCodexResolver` and codex-ouronet's public
`createHeadlessKadenaResolver` — the export built specifically for headless
automaton consumers like Pythia/Khronoton) requires. Since a real
`CodexSnapshot`'s `kadenaSeeds[].seedType` is the 4-member `SeedType`, it has
been un-assignable to `SnapshotSlice` since "stoic" shipped — breaking the
typecheck for every consumer of the headless resolver on every codex release
since, confirmed externally by Pythia's build failures on every deploy that
bumps `@ancientpantheon/codex` to `@latest`.

A bare widen is not safe, because the three original members and "stoic" are
not interchangeable at runtime. Koala/chainweaver/eckowallet are mnemonic-based
— derived via the injected `HeadlessResolverDeps.deriveStoaChainKeypair`, bound
in `codex-ouronet` to `StoaChainWalletBuilder.createWalletPairFromMnemonic`.
"Stoic" seeds decrypt to a 1600-bit DALOS bitstring, not a mnemonic, and are
derived through an entirely different function
(`generateFromBitStringAtIndex`, from `@ouronet/dalos-crypto/chainweb`) that
codex-core has never heard of. Both call sites that resolve real keys already
know this: `InternalCodexResolver.ts` and `headlessKadenaResolver.ts` each call
`resolveStoicKeypair()` FIRST and only fall through to codex-core's generic
factory when it returns `undefined` (no stoic seed owns the pubkey). Widening
`StoaChainSeedType` without touching the factory's own derived-account loop
would make that loop *capable* of accepting a stoic seed and calling
`deriveStoaChainKeypair(..., "stoic")` — silently deriving a wrong key via the
wrong algorithm the one time something upstream forgets to check stoic first
(corrupt state, a future direct caller, a reordering bug). That is a
funds-critical silent-wrong-answer, strictly worse than today's type error.

There is also a concrete compile-time trap a plain widen would walk into:
`@stoachain/stoa-core/wallet`'s own `SeedType` (the external library's type,
unrelated to Codex) is *still* three members
(`"koala" | "chainweaver" | "eckowallet"`), and
`packages/codex-ouronet/src/resolver/headlessKadenaDeps.ts`'s
`REAL_STOA_DEPS.deriveStoaChainKeypair` forwards its `seedType` parameter
straight into that external call. If `HeadlessResolverDeps.deriveStoaChainKeypair`'s
own parameter type widens to four members (because it shares the same
`StoaChainSeedType` alias `StoaChainSeedLike.seedType` uses), that forwarding
call stops type-checking outright — a second, previously-undiagnosed build
break sitting right behind the first one.

## Approach

Split the one overloaded type into two, instead of widening a single alias:

- **`StoaChainSeedType`** (existing exported name, kept) widens to all four
  members and becomes purely a *data label* — what `StoaChainSeedLike.seedType`
  (i.e. what a snapshot can honestly say a seed *is*) carries. This is the
  half of the bug Pythia's handoff is actually blocked on, and this alone
  restores `CodexSnapshot` → `SnapshotSlice` assignability.
- **`MnemonicSeedType`** (new, `"koala" | "chainweaver" | "eckowallet"`) —
  a *capability* type: exactly the seed types codex-core's generic factory can
  actually derive a mnemonic-based key from. It replaces `StoaChainSeedType` in
  exactly two positions: `HeadlessResolverDeps.deriveStoaChainKeypair`'s
  `seedType` parameter, and `ResolvedStoaChainKeypair.seedType`. Neither
  position needs to widen — the factory never derives a "stoic" key (that's
  `resolveStoicKeypair`'s job, entirely outside codex-core, returning its own
  `StoicKeypair` shape) and never resolves one either.
- The derived-account loop in `getKeyPairByPublicKey` (headlessResolver.ts,
  the `for (const seed of kadenaSeeds)` block) gets one added line:
  `if (seed.seedType === "stoic") continue;`, placed before the
  `account.publicKey === publicKey` check. This is not just documentation —
  it's a TypeScript control-flow narrowing point. After that line,
  `seed.seedType` is statically narrowed from `StoaChainSeedType` (4 members)
  down to exactly `MnemonicSeedType` (3 members) for the rest of the loop body,
  so `deps.deriveStoaChainKeypair(password, mnemonic, account.index, seed.seedType)`
  type-checks with **zero** change to `HeadlessResolverDeps`'s signature and
  **zero** change to `headlessKadenaDeps.ts`'s binding — the compiler proves the
  guard is in place; a future refactor that deletes the `continue` line breaks
  the build, it doesn't quietly reopen the silent-wrong-answer path.
- A behavioral consequence worth being explicit about: if a corrupt/drifted
  codex ever has a `"stoic"`-tagged seed whose account wasn't caught by
  `resolveStoicKeypair` (shouldn't happen; belt-and-suspenders), the factory
  now falls through to the existing "not found" `CodexKeyMissingError` instead
  of the pre-fix behavior (a type error at compile time — never a runtime
  behavior at all, since this path never compiled before). That's strictly
  safer and is the intended tradeoff.
- Fix the stale "mirrors `SeedType` verbatim" doc comment on
  `StoaChainSeedType` — replace with a comment describing the actual
  relationship: `StoaChainSeedType` = every real seed label (kept in parity
  with codex-ouronet's `SeedType` by the new test below, not by a comment
  promise); `MnemonicSeedType` = the derivable subset.
- Add a compile-time parity proof — following this codebase's own existing
  idiom for this exact kind of cross-package shape check (see
  `InternalCodexResolver.ts`'s and `headlessKadenaResolver.ts`'s
  `const asContract: IStoaChainKeypair = resolved;` "compile-time assignability
  proof" comments) rather than inventing a new mechanism. Lives in
  `codex-ouronet` (the only package that can import both types — codex-core
  deliberately imports no Ouronet types, per its own module doc). A type-level
  mutual-assignability check between `SeedType` and codex-core's
  `StoaChainSeedType` fails `tsc` the moment the two next diverge, closing the
  exact gap both handoffs identified ("a comment is not enforcement").

**Alternatives considered:**
- *Derive `StoaChainSeedType` from `SeedType` directly (single source of
  truth).* Rejected: codex-core is a lower layer that must not import
  Ouronet types (existing, deliberate architectural rule, stated in
  `headlessResolver.ts`'s own module doc) — codex-ouronet depends on
  codex-core, not the reverse, so this would be a real dependency inversion,
  not a small tweak.
- *Widen `StoaChainSeedType` in place everywhere it's used, no new type.*
  Rejected: reopens the silent-wrong-derivation risk (nothing stops "stoic"
  reaching `deriveStoaChainKeypair`) and breaks `headlessKadenaDeps.ts`'s
  forwarding call into the external 3-member `@stoachain` `SeedType`, as
  detailed in Problem above.
- *Route "stoic" through codex-core's factory too, teaching it the DALOS
  bitstring derivation.* Rejected: codex-core imports no `@stoachain`/
  `@ouronet/dalos-crypto` crypto at all by design (the whole point of the D4
  injectable-seam split) — the derivation call
  (`deriveStoaDalosKeypairAtIndex`) lives in codex-ouronet already, correctly,
  and is already shared correctly between the browser and headless paths via
  `resolveStoicKeypair`. Moving it would be a large, unjustified rearchitecture
  for a bug that's actually just a type-parity gap.

## Acceptance criteria

- [ ] A `CodexSnapshot` whose `kadenaSeeds` includes a `"stoic"`-typed entry is
      assignable to `SnapshotSlice` with no cast — `tsc` passes where it
      currently fails (reproduces and fixes Pythia's `keyResolver.ts:88` error).
- [ ] `createHeadlessKadenaResolver`/`createHeadlessCodexResolver`'s derived-
      account loop never calls `deriveStoaChainKeypair` with `seedType: "stoic"`
      — enforced by the compiler (narrowing), verified by a test that a
      `"stoic"`-tagged seed reaching the factory directly (bypassing
      `resolveStoicKeypair`) resolves to the "not found" error, not a derived
      key.
- [ ] Existing koala/chainweaver/eckowallet/pure-foreign resolution behavior in
      `createHeadlessCodexResolver`, `InternalCodexResolver`, and
      `createHeadlessKadenaResolver` is unchanged (existing resolver test
      suites stay green with no assertion changes).
- [ ] A new type-level test fails to compile if `SeedType`
      (codex-ouronet) and `StoaChainSeedType` (codex-core) diverge in either
      direction (member added/removed on either side without the other).
- [ ] `StoaChainSeedType`'s doc comment accurately describes its relationship
      to `SeedType` and to the new `MnemonicSeedType`; no comment claims
      "verbatim" mirroring without the parity test backing it.
- [ ] Full workspace typecheck + test suite green; `codex-core`,
      `codex-ouronet`, and the `@ancientpantheon/codex` aggregator version
      bumped and published, so Pythia's next deploy resolves cleanly on
      `@latest` with no fallback/pin needed.

## Out of scope

- `packages/codex-ouronet/src/codex-identity/kickstart-types.ts`'s
  `DuoPrimeMode`'s `"kadena-seed"` variant, which also hand-lists
  `"koala" | "chainweaver" | "eckowallet"` — checked, and this is a real,
  separate, deliberate restriction (kickstart only supports importing an
  *existing mnemonic* seed at setup time; Stoa Dalos seeds are always created
  fresh afterward via `CreateStoaChainSeedModal`, never imported at
  kickstart). Not a drift bug — leave as-is.
- Any change to `resolveStoicKeypair`, `stoaDalosKeygen.ts`, or the DALOS
  bitstring derivation itself — all already correct and unaffected by this fix.
- Pythia's own fallback/pin (added as their v3.3.2 stopgap) — theirs to revert
  once this ships, not this repo's concern.
- Renaming or restructuring `IStoaChainSeed`/`SeedType` in codex-ouronet —
  unaffected; this fix only touches codex-core's mirror and the boundary
  between the two.
