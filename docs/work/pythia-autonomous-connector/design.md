# Design: autonomous Apollo re-authentication for Pythia's connector protocol

Source: `docs/HANDOFF-pythia-autonomous-connector.md`. Audience for that handoff was an agent
in the Codex repo; this doc is the resolved shape.

## Outcome (confirmed with the user)

A new exported function, `autoSignApolloChallenge`, that a server-side Automaton (Pythia
first) can call — with its Codex snapshot + codex password already held decrypted, per
`automaton/02`'s auto-unlock pattern — to produce `{ apollo, sig }` proving Apollo (₱./Π.)
ownership. Zero browser, zero human prompt, safe on a repeating timer (Pythia's plan: every
3h). Reuses the exact canonical challenge message + `dalos-apollo` Schnorr signing already
proven in the browser `/apollo-verify` flow, so its output verifies against Pythia's existing
verifier. Reachable through the **public** `@ancientpantheon/codex` npm package (not just the
private `codex-ouronet` workspace member), because that's the package external Automatons
(Mnemosyne today, Pythia next) actually install and pull via their "Update & Deploy" pipeline.

## Decisions

Autonomous run confirmed 2026-07-30.

- **Investigation delegated to a background research agent** (not guessed) — see "Resolved
  open questions" below. Every claim there is evidence-backed (file:line), gathered by reading
  the actual import chains, type definitions, and an existing production precedent
  (`constructors/Pythia/pythia-khronoton/.../keyResolver.ts`) rather than assumed.
- **No new package.** `codex-core`'s D3/D4/D5 injectable-seam discipline exists specifically so
  `codex-core` never imports `@stoachain/*` — Apollo is entirely a `codex-ouronet`-side concept
  today (confirmed: zero "apollo" hits anywhere in `codex-core/src`). Extending the D4 headless
  resolver pattern to cover Apollo would mean inventing a whole new injected-deps seam for a
  single function, when `codex-ouronet` (the already-designated `@stoachain` value edge) can
  host this directly, node-safely, with far less surface area. Rejected in favor of the smaller
  change.
- **The blocking issue was export surface, not logic.** `signApolloOwnership` itself is already
  Node-safe (verified: no DOM/window/document/navigator anywhere in its transitive import
  chain). But it's currently reachable ONLY via `codex-ouronet`'s `./ui` subpath barrel
  (`src/ui/index.ts`), which also exports the React+lucide-react-coupled `ApolloVerifyView` —
  importing `signApolloOwnership` today means eagerly loading React in a headless process. Fix:
  add a new `./apollo-verify` subpath to `codex-ouronet`'s `package.json` exports, pointing
  directly at a React-free barrel. `./ui` keeps re-exporting the same three names too (byte-
  for-byte back-compat, matches the package's own N-04 convention) — purely additive.
- **`autoSignApolloChallenge` mirrors an existing, already-shipped, production pattern** —
  Pythia's own `khronoton/keyResolver.ts` (a different repo) already does "sealed operator
  codex → `smartDecrypt` the matching entry → sign, throw a named error if not found" for
  Kadena seeds, server-side, in Node, today. The new function is the same shape for Apollo
  accounts: caller supplies the (already-decrypted-at-rest-by-the-Automaton) snapshot +
  codex password + target account address; the function locates the matching `IOuroAccount`,
  `smartDecrypt`s its secret, and calls the existing `signApolloOwnership`. This directly
  answers open question #4 — no global "current unlocked codex" getter is invented, because no
  such thing exists anywhere in this repo and inventing one here would be exactly the kind of
  new unlock mechanism the handoff explicitly forbids.
- **Signature: `autoSignApolloChallenge(snapshot, codexPassword, apolloAccount, nonce, rp): Promise<ApolloProof>`**
  rather than the handoff's originally-proposed `(apolloAccount, nonce, rp)` alone — because Q4
  established there is no in-repo mechanism for a bare account string to "find its own secret"
  without a caller-supplied snapshot + password. This keeps the Codex library credential-free
  and free of any global state (consistent with `docs/HANDOFF-codex-pythia-key.md` §4's
  "library stays credential-free" rule, applied here by analogy even though that section is
  about a different feature).
- **Re-export path:** `packages/codex/src/ouronet/index.ts` gets one added line,
  `export * from "@ancientpantheon/codex-ouronet/apollo-verify";` — the exact precedent already
  set by `rekeyCodex` in v0.6.0 (a pure, isomorphic, Node+browser server-callable transform
  added to this same barrel for the same reason: a server consumer needs it via
  `@ancientpantheon/codex/ouronet`, no new public subpath needed).
- **Version bump lands on `@ancientpantheon/codex-ouronet` (0.6.1 → 0.7.0, private, internal
  record) and `@ancientpantheon/codex` (0.6.1 → 0.7.0, public, this is what actually ships) —
  both MINOR, additive-only, no breaking changes.** `codex-core` is untouched, no bump there.
- **The pre-existing React-peer-dependency friction on `@ancientpantheon/codex`** (flagged by
  the investigation as an "other surprise": `react`/`react-dom` are required, not optional,
  peers on the whole aggregate) is explicitly OUT of scope — it predates this work, Pythia
  already tolerates it today for its existing `@ancientpantheon/codex/ouronet` imports
  (`keyResolver.ts`), and fixing it is a separate, unrelated cleanup the handoff's non-goals
  don't ask for.
- **CRLF working-tree noise (473 files) is left untouched** — confirmed byte-identical content
  via `od -c`, unrelated to this work, not committed.
- **No push/tag/publish performed by this run** — this sandbox has no GitHub push credentials
  (verified: `git push` fails with "could not read Username", no token/credential-helper/deploy
  key present). All commits are local; the final report hands over the exact commands.

## Resolved open questions (handoff §4)

**Q1 — Is `signApolloOwnership.ts`'s import chain server/Node-safe?**
Yes, verified. `@stoachain/stoa-core/dalos` (→ `@ouronet/dalos-crypto/registry`) has plain
Node-compatible `exports` conditions, no `browser` field; `grep` across both packages' `dist/`
for `window.`/`document.`/`navigator.`/`localStorage` returns zero hits.
`../types/entities.js` is a `type`-only import (erased at compile time).
`../ui/internal/originCurve.js`'s `detectOriginCurve` is pure string-prefix logic over
`account.originCurve`/`account.address`, no DOM. `codex-ouronet`'s package-wide `jsdom` test
environment is not evidence against this — it's set because the package also ships React
components, not because this function needs a DOM.

**Q2 — Does a server-side Automaton's Codex snapshot store Apollo identities in the same
`IOuroAccount` shape the browser package expects?**
Yes, exact match, same type. `packages/codex-ouronet/src/adapters/types.ts`'s
`CodexSnapshot.ouroAccounts: IOuroAccount[]` IS the same `IOuroAccount`
(`packages/codex-ouronet/src/types/entities.ts`) `signApolloOwnership` already consumes — no
adapter or shape-translation needed. Separately confirmed: `codex-core` has zero Apollo
notion today (its D4 headless-resolver pattern only knows StoaChain seeds / pure keypairs) —
Apollo is entirely `codex-ouronet`-side, which is consistent with the "no new package" decision
above.

**Q3 — Where should `autoSignApolloChallenge` live?**
`packages/codex-ouronet/src/apollo-verify/` (new file, alongside `signApolloOwnership.ts`),
exported through a NEW `./apollo-verify` subpath (not the existing React-coupled `./ui`
subpath), and re-exported from the public `@ancientpantheon/codex`'s `./ouronet` barrel. See
"Decisions" above for the full reasoning.

**Q4 — What does "already-unlocked Codex, zero human prompt" look like from code's
perspective?**
No global "give me the current unlocked codex" getter exists anywhere in this repo — confirmed
by reading every `CodexAdapter` shape in `codex-core`/`codex-ouronet` (`loadAll(): Promise<TSnapshot>`,
caller-constructed, no ambient singleton) and by precedent: Pythia's own
`khronoton/keyResolver.ts` (different repo, already shipped) reads its OWN sealed vault via its
OWN `CodexStore`, decrypts with `smartDecrypt`, and passes the plaintext secret into signing —
the Automaton, not the Codex library, owns "how do I get my own decrypted snapshot." This
Codex-side function therefore takes an already-available snapshot + codex password as
arguments; it does not reach for global state or invent a new unlock mechanism.

## Final function

```ts
// packages/codex-ouronet/src/apollo-verify/autoSignApolloChallenge.ts
export interface ApolloSnapshotLike {
  ouroAccounts?: IOuroAccount[];
}

export async function autoSignApolloChallenge(
  snapshot: ApolloSnapshotLike,
  codexPassword: string,
  apolloAccount: string,
  nonce: string,
  rp: string,
): Promise<ApolloProof>
```

Behavior: find the `IOuroAccount` in `snapshot.ouroAccounts` whose `address === apolloAccount`;
throw a clear, actionable error (naming the missing account, mirroring `keyResolver.ts`'s
"clear error, not silent no-op" convention) if absent; `smartDecrypt` its `secret` field with
`codexPassword`; call the existing `signApolloOwnership(account, secretPlaintext, nonce, rp)`
(which itself re-verifies the derived address matches before signing) and return its result.

## Test proof (handoff §7 requirement)

A local round-trip test: build an `IOuroAccount` from a known seed-word list via
`Apollo.generateFromSeedWords`, encrypt its derived private-key form into `account.secret` with
`encryptStringV2`, call `autoSignApolloChallenge(...)`, then independently verify the returned
signature with `Apollo.verify(sig, buildApolloOwnershipMessage(account, nonce, rp), keyPair.publ)`
— the same message-builder and curve Pythia's `apolloVerify()` uses. A passing assertion proves
message-format + curve compatibility without needing a cross-repo import.

## Acceptance criteria

- [ ] `autoSignApolloChallenge` implemented in `codex-ouronet`, Node-safe, no React import in
      its module graph.
- [ ] Reachable via `@ancientpantheon/codex-ouronet/apollo-verify` (new subpath) AND via the
      public `@ancientpantheon/codex/ouronet` barrel.
- [ ] Existing `./ui` subpath's 3 Apollo exports (`ApolloVerifyView`, `signApolloOwnership`,
      `buildApolloOwnershipMessage`) untouched — byte-for-byte back-compat.
- [ ] Missing-account case throws a clear, named error (not a silent no-op / not `undefined`).
- [ ] Round-trip test proves a produced signature verifies via `Apollo.verify` against the
      canonical message + curve.
- [ ] `guard-subpath-resolution.test.ts` updated to cover the new subpath (14th module).
- [ ] Full `codex-ouronet` + `codex` typecheck/build/test green.
- [ ] `codex-ouronet` and `codex` package.json versions bumped 0.6.1 → 0.7.0, CHANGELOG entries
      added in the repo's existing format.
- [ ] No on-chain, browser-flow, or Daimon-consumer changes (non-goals preserved).
- [ ] No Pythia-repo changes.
