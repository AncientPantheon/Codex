# Changelog

All notable changes to `@ancientpantheon/codex`.

## 0.6.0 — 2026-07-12

Add codex password rotation — the transform was missing from the package (only the `ChangePasswordCard` form + a consumer seam existed; the actual re-encryption lived in OuronetUI's app).

- **`rekeyCodex(snapshot, oldPassword, newPassword)`** — a pure, isomorphic (Node + browser), store-free `snapshot → snapshot` transform exported from `@ancientpantheon/codex/ouronet`. Re-encrypts EVERY codex-password secret (kadenaSeeds, ouroAccounts secret+backup, pureKeypairs, foreignKeys, and all CodexID `encrypted*` fields — the full inventory, owned in one place so it can't drift) old→new (output V2). Pre-flight verifies the old password (`WrongPasswordError` before any mutation); un-decryptable fields are skip-not-dropped (kept verbatim + reported).
- **`changeCodexPassword(old, new)`** store action + default `onChangePassword` wiring — `ChangePasswordCard` now works out of the box (rekey + `saveAll` + re-cache the session). A consumer-supplied `onChangePassword` still wins.

Resolves Mnemosyne Handoff 07. Additive — no breaking changes.

## 0.5.1 — 2026-07-12

Fix the STOA fee mark in the zbom cost row (`StoaChainCostDisplay`): it pointed at `/images/coins/WSTOA.svg` from the host app's public root, which broke (missing image) in consumers that don't ship that asset — e.g. Mnemosyne consuming the bundled package. Now renders the gold ❖ glyph inline (OuronetUI's canonical Stoa glyph), self-contained in the bundle so it displays identically in every consumer. No API changes.

## 0.5.0 — 2026-07-11

First functional aggregate. The six subpath barrels (root + `./provider`, `./hooks`, `./ui`, `./ouronet`, `./arweave`) are wired to the internal members, and the members (`codex-core`, `codex-ui`, `codex-ouronet`, `codex-arweave`) are **bundled** into `dist` via tsup — both the runtime JS and the `.d.ts` are self-contained, so a TypeScript consumer type-checks against only this package + `@ancientpantheon/arweave-core`. Added the merged `./ui.css` export, the `arweave`/`@ardrive/turbo-sdk` external deps, and an auto-generated bundled-member-versions table in the README.

## 0.0.1 — 2026-07-04

Initial package skeleton — the empty-but-buildable consumer-facing aggregator scaffold. Wires the root entry point plus the five subpath barrels (`./provider`, `./hooks`, `./ui`, `./ouronet`, `./arweave`), each an empty `export {};` module. No aggregation content yet; publish-eligible but unpublished.
