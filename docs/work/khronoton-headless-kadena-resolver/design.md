# Design: server-safe pre-bound headless Kadena KeyResolver from `/ouronet`

Source handoff: `constructors/Pythia/docs/HANDOFF-codex-headless-kadena-resolver.md` (Topic 1 of
`constructors/Pythia/docs/work/khronoton-keyresolver-delegation/design.md`). This is the Codex-side
enablement that BLOCKS Pythia (Topic 2) and Mnemosyne (Topic 3) from deleting their hand-rolled,
koala-only `KeyResolver` derivations — one of which caused a real live gas-payer signing failure on a
`chainweaver`/`eckowallet` operator seed.

## Outcome

A new export from `@ancientpantheon/codex/ouronet`:

```ts
import { createHeadlessKadenaResolver } from "@ancientpantheon/codex/ouronet";

const resolver = createHeadlessKadenaResolver({
  loadSnapshot: () => codexStore.loadSnapshot(),   // re-read fresh each call (fire-time)
  getPassword:  () => machinePassword(),            // server-held, auto-unlocked
});
// resolver satisfies @stoachain/stoa-core/signing's KeyResolver:
//   { getKeyPairByPublicKey(pub): Promise<IKadenaKeypair>; listCodexPubs(): Promise<Set<string>> }
```

A Khronoton consumer (Pythia, Mnemosyne) drops this straight into the engine's `KeyResolver` seam
and binds **zero** `@stoachain` crypto itself — all derivation lives in Codex, seedType-complete
(koala / chainweaver / eckowallet / pure-foreign), with the wrong-key refusal guard preserved.

## Decisions

Autonomous run confirmed 2026-08-03.

- **Reuse, don't reimplement.** The seedType-complete derivation plumbing already exists once, in
  codex-core's `createHeadlessCodexResolver(deps)` (`packages/codex-core/src/resolver/headlessResolver.ts`).
  The real `@stoachain` binding of its `HeadlessResolverDeps` seam ALSO already exists — as the
  private constants `REAL_STOA_DEPS`, `buildExtendedForeignSigningKey`, `EXTENDED_FOREIGN_SCRAMBLE_PW`,
  and the shared `HEADLESS` instance inside the BROWSER `InternalCodexResolver.ts`. The new headless
  resolver must share that exact binding, not copy it — copying would recreate the very
  per-consumer-derivation drift this whole handoff exists to remove.
- **Extract the shared binding into one server-safe module.** New file
  `packages/codex-ouronet/src/resolver/headlessKadenaDeps.ts` holds `REAL_STOA_DEPS`,
  `buildExtendedForeignSigningKey`, `EXTENDED_FOREIGN_SCRAMBLE_PW`, the shared `HEADLESS =
  createHeadlessCodexResolver(REAL_STOA_DEPS)`, and the `remapCoreKeyMissing` helper (core's
  `CodexKeyMissingError` → the ouronet-side class, for `instanceof` parity). `InternalCodexResolver.ts`
  is refactored to import `HEADLESS` + `remapCoreKeyMissing` from it — behavior byte-identical, its
  own auth-gate/store-assembly/foreign-key-callback logic unchanged, existing `resolver-internal.test.ts`
  stays green as the regression proof.
- **The extracted module is already server-safe.** Its only runtime imports are `@stoachain/*`
  primitives + codex-core — the same set the existing `/ouronet` barrel and the v0.7.0
  `autoSignApolloChallenge` already pull headless (Pythia consumes `/ouronet` in Node today). No
  React/DOM/zustand runtime import enters this module (`InternalCodexResolver`'s zustand + store
  imports are `import type`, erased at compile, and stay in `InternalCodexResolver.ts`, not the
  extracted module).
- **Pre-bound factory over "export the factory + deps."** The handoff offered a fallback (re-export
  `createHeadlessCodexResolver` + a ready `defaultStoaChainHeadlessDeps`). Rejected in favor of the
  pre-bound `createHeadlessKadenaResolver` — the whole point is the consumer binds NOTHING; exposing
  the deps seam invites a consumer to partially re-bind it and drift again.
- **Fire-time snapshot + password, never cached.** The factory closes over `loadSnapshot`/`getPassword`
  thunks and calls them per resolution — mirroring how Pythia's sealed operator codex is re-read each
  Khronoton fire so a codex edit is picked up next tick and plaintext key material never outlives the
  call. No snapshot/password is retained on the returned object.
- **Wrong-key refusal guard lives at the delegation boundary.** codex-core's
  `createHeadlessCodexResolver` derived-account branch finds the seed account by its RECORDED pubkey,
  re-derives from the mnemonic, and returns the DERIVED pubkey — it does not itself assert the two
  agree (verified: `packages/codex-core/src/resolver/headlessResolver.ts` has no such comparison; this
  is pre-existing core behaviour, and core is out of scope to change here). The hand-rolled consumer
  resolvers this handoff replaces DID refuse to sign on a mismatch ("derived a different key than the
  codex recorded"), and dropping that on delegation would be a funds-safety regression. So
  `createHeadlessKadenaResolver` re-adds the guard at its own delegation boundary: after core resolves,
  it asserts `resolved.publicKey === requestedPublicKey` and throws (secret-free, names only public
  keys) otherwise. The pure-keypair branch returns the requested pubkey verbatim, so the guard only
  ever fires on a genuine seed-derivation mismatch (corrupt codex / wrong `seedType` tag). The browser
  `InternalCodexResolver` is left exactly as it was (pre-existing behaviour, out of scope) — the guard
  is added only on the new headless path the handoff's acceptance criteria cover.
- **`requestForeignKey` omitted.** Per the `KeyResolver` contract, a server resolver that omits it
  gets the strategy's fail-fast-on-first-foreign-key-need behavior — correct for a headless automaton
  (there is no user to prompt). The Kadena-only public-key filtering the handoff mentions
  (`isKadenaPublicKey`, Apollo accounts never entering the signer list) stays CONSUMER-side (Pythia's
  Topic 2) — it's a policy concern about which pubkeys to offer, not a derivation concern; Codex's
  resolver faithfully resolves whatever Kadena pubkey it's asked for and lists what the codex holds.
- **Version: `codex-ouronet` 0.7.0 → 0.8.0, `codex` 0.7.0 → 0.8.0** — MINOR, additive, no breaking
  changes. `arweave-core` untouched (0.2.0). Published via tag `v0.8.0` (codex-only release).

## API

```ts
// packages/codex-ouronet/src/resolver/headlessKadenaResolver.ts
import type { KeyResolver } from "@stoachain/stoa-core/signing";
import type { SnapshotSlice } from "@ancientpantheon/codex-core";

export interface HeadlessKadenaResolverOptions {
  /** Re-read fresh each call (fire-time), never cached. A full CodexSnapshot is
   *  structurally assignable — only kadenaSeeds + pureKeypairs are read. */
  loadSnapshot: () => SnapshotSlice | Promise<SnapshotSlice>;
  /** The codex machine password (server-held, auto-unlocked); read per call. */
  getPassword: () => string | Promise<string>;
}

export function createHeadlessKadenaResolver(
  opts: HeadlessKadenaResolverOptions,
): KeyResolver;
```

Behavior:
- `listCodexPubs()` → `await loadSnapshot()`, delegate to `HEADLESS.listCodexPubs(slice)` (cheap, no
  decryption). Returns `Promise<Set<string>>` (allowed by the `KeyResolver` union).
- `getKeyPairByPublicKey(pub)` → `await loadSnapshot()` + `await getPassword()`, delegate to
  `HEADLESS.getKeyPairByPublicKey(slice, pub, password)`; on core's `CodexKeyMissingError`, rethrow the
  ouronet-side `CodexKeyMissingError` with the same structured counts. Returns the resolved
  `IKadenaKeypair` (compile-time assignability asserted, same as `InternalCodexResolver`).
- No `requestForeignKey` method (fail-fast server contract).

Exported through `packages/codex-ouronet/src/resolver/index.ts` → the `/resolver` subpath → the public
`@ancientpantheon/codex/ouronet` barrel (which already `export *`s `/resolver`). The option type plus
the `SnapshotSlice` / `StoaChainSeedLike` / `PureKeypairLike` / `StoaChainSeedType` structural types
are re-exported so a consumer can type `loadSnapshot` without reaching into codex-core.

## Acceptance criteria (from the handoff)

- [ ] `import { createHeadlessKadenaResolver } from "@ancientpantheon/codex/ouronet"` yields a working
      `{ getKeyPairByPublicKey, listCodexPubs }` binding NO `@stoachain` crypto in the consumer.
- [ ] Importing it from `/ouronet` loads no UI/React/DOM (verified by a plain-Node import test that
      constructs the resolver + lists pubs headless).
- [ ] Resolves + signs for `koala`, `chainweaver`/`eckowallet` (extended-key WASM path), AND
      `pure`/foreign accounts, and keeps the wrong-key refusal guard (re-derived pubkey ≠ recorded → throw).
- [ ] Fire-time: `loadSnapshot`/`getPassword` re-invoked each call (a snapshot mutation between calls
      is reflected without rebuilding the resolver).
- [ ] `InternalCodexResolver` behavior unchanged — `resolver-internal.test.ts` stays green.
- [ ] Full workspace typecheck/build/test green; published as `@ancientpantheon/codex@0.8.0`.

## Out of scope

- Pythia's / Mnemosyne's actual delegation (Topics 2–3, their own repos) — this only ships the Codex
  export they'll adopt.
- The consumer-side Kadena-only pubkey filter + `SignerSource` picker (stays in Pythia).
- Any change to codex-core's derivation, `createHeadlessCodexResolver`, or how seeds are recorded.
- Reverting Pythia's v2.7.13 stopgap (Pythia does that in Topic 2, after adopting this).
