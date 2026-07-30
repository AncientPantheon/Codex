# Plan: autonomous Apollo re-authentication for Pythia's connector protocol

See `design.md` for full context, resolved open questions, and acceptance criteria.

## Wave 1 — TDD: the new function + its test (sequential, single file chain)

- [x] **T1. Failing round-trip test first.** New
      `packages/codex-ouronet/tests/apollo-verify-auto-sign.test.ts`: build an `IOuroAccount`
      from `Apollo.generateFromSeedWords`, encrypt the derived private-key form into
      `account.secret` via `encryptStringV2`, call `autoSignApolloChallenge(...)` (not yet
      implemented — this test fails to even import), then assert `Apollo.verify(sig,
      buildApolloOwnershipMessage(account.address, nonce, rp), keyPair.publ)` is `true`. Also
      cover: missing-account throws a named error; wrong-password / corrupt-secret throws
      (via `smartDecrypt`'s own failure path, not swallowed). Confirm RED (import failure or
      assertion failure) before implementing.
      Acceptance: test file exists, `npx vitest run` shows it failing for the right reason
      (module not found / assertion, not a typo).

- [x] **T2. Implement `autoSignApolloChallenge`.**
      `packages/codex-ouronet/src/apollo-verify/autoSignApolloChallenge.ts` per design.md's
      signature. Reuses `signApolloOwnership` + `smartDecrypt` (`@stoachain/stoa-core/crypto`,
      already a real dependency of this package). Clear thrown error on missing account,
      naming the requested address (mirror `keyResolver.ts`'s message style).
      Acceptance: T1's test goes GREEN.

- [x] **T3. New React-free barrel + subpath export.**
      `packages/codex-ouronet/src/apollo-verify/index.ts` exporting
      `{ signApolloOwnership, buildApolloOwnershipMessage, ApolloProof, autoSignApolloChallenge }`
      (no `ApolloVerifyView`). Add `"./apollo-verify"` to `codex-ouronet/package.json`
      `exports`, pointing at `dist/apollo-verify/index.{js,d.ts}`. Leave `src/ui/index.ts`'s
      existing 3 Apollo exports untouched (byte-for-byte back-compat, N-04).
      Acceptance: `packages/codex-ouronet` builds; `dist/apollo-verify/index.js` exists and
      exports all 4 names; `./ui`'s existing export set is unchanged (diff the built dist
      export list before/after).

- [x] **T4. Extend the subpath-resolution guard.**
      `packages/codex-ouronet/tests/guard-subpath-resolution.test.ts`: add `"apollo-verify"` to
      `JS_SUBPATHS`, bump the docstring's "13 importable JS modules" to 14.
      Acceptance: guard test green against the freshly-built dist.

## Wave 2 — surface it through the public package (depends on Wave 1)

- [x] **T5. Re-export from `@ancientpantheon/codex`.** One line in
      `packages/codex/src/ouronet/index.ts`:
      `export * from "@ancientpantheon/codex-ouronet/apollo-verify";` — same pattern as every
      other line already there.
      Acceptance: `packages/codex` builds; `autoSignApolloChallenge` resolves from
      `@ancientpantheon/codex/ouronet`'s built dist.

- [x] **T6. Full workspace verification.** `npm run typecheck && npm run build && npm run test`
      from the repo root (arweave-core → codex-core → codex-arweave → codex-ouronet →
      codex-ui → codex, in the existing script order).
      Acceptance: all green, quoted output captured for the final report.

## Wave 3 — versioning + docs (depends on Wave 2 passing clean)

- [x] **T7. Version + CHANGELOG: `codex-ouronet`.** `0.6.1` → `0.7.0` (MINOR, additive). New
      CHANGELOG.md entry in the package's existing format describing
      `autoSignApolloChallenge` + the new `./apollo-verify` subpath.
- [x] **T8. Version + CHANGELOG: `codex` (public).** `0.6.1` → `0.7.0`. New CHANGELOG.md entry,
      matching the style of the existing 0.6.0 (`rekeyCodex`) entry — same precedent, same
      "server consumer can now import X from `@ancientpantheon/codex/ouronet`" framing.
      Note explicitly: no other public package (`arweave-core`) changed, so this is a
      codex-only release per `publish.yml`'s documented use case.
- [x] **T9. Update `docs/HANDOFF-pythia-autonomous-connector.md`** with a "Resolved" status
      note pointing at `design.md`, so a future reader doesn't re-open questions already
      answered (do not delete/rewrite the original handoff — append).

## Wave 4 — review (depends on Wave 3)

- [x] **T10. Adversarial review pass** — correctness, security (no secret material logged/
      thrown in error messages, matches `VaultCryptoError`'s secret-free contract), scope
      (no non-goal creep), and export-surface integrity (nothing else in `./ui` or `./ouronet`
      accidentally changed). Fix loop to clean.

## Wave 5 — close out (depends on Wave 4)

- [x] **T11. Local commit(s).** No push (no credentials in this sandbox — see design.md).
      Report exact `git push` / tag commands for the user.
