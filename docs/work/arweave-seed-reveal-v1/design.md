# Arweave Seed Reveal (v1) — Design

## Problem

Each Arweave `SeedRow` has no way to view the seed's actual key material. Ouronet accounts already have this via `DalosSecretReveal` (Seed/Bitmap/BitString/Base-10/Base-49 tabs), which is fully decoupled from `IOuroAccount` — it takes `{ plaintext, originMode, originCurve }` and derives everything from that (`rebuildFullKey`). Given a seed's `bits` (already held in `ArweaveSeedRecord` whenever decrypted), the same component works unmodified with `originMode: "bitString"` — which lights up Bitmap/BitString/Base-10/Base-49 (four of five tabs; the Seed/words tab needs the original words, which are not currently stored — that is `wordsSecret`, a separate, larger change tracked in the parent project's `arweave-seed-reveal` topic, deliberately deferred here).

## Approach

- Export `DalosSecretReveal` (+ its props type) from `packages/codex-ouronet/src/ui/index.ts` — it exists only in `ui/internal/` today, unreachable from outside the package. One-line addition to an existing barrel, no new subpath.
- Port codex-ouronet's 3-part lucide-react vitest fix (`optimizeDeps.exclude`, the `lucide-react` → absolute ESM barrel alias, `server.deps.inline`) into `packages/codex-arweave/vitest.config.ts`. `codex-arweave` already declares both `@ancientpantheon/codex-ouronet` and `lucide-react` in `package.json` — the gap is purely the test harness, not a missing dependency. Production is unaffected (the shipped bundle externalizes lucide-react; only vitest's jsdom transform hits the stale-React-18 hazard).
- Add a reveal button to each `SeedRow` in `ArweaveSeedsArea.tsx` that opens `DalosSecretReveal` in a small local modal overlay (matching the existing inline-overlay pattern already used for the leave-generation dialog in `ArweavePanel.tsx` — no new modal-shell dependency needed), passing `plaintext={seed.bits}`, `originMode="bitString"`, `originCurve="dalos"`. When `seed.bits === ""` (seed exists but not yet decrypted by the host), show an inline "codex is locked / still decrypting" notice instead of the reveal panel — never a crash, never a blank modal.

## Acceptance criteria

- [ ] Every seed row (prime and non-prime) has a visible reveal control.
- [ ] Clicking it opens `DalosSecretReveal` showing Bitmap, BitString, Base-10, and Base-49 tabs derived from the seed's bits; no Seed/words tab (out of scope this round).
- [ ] A seed whose `bits` is empty (undecrypted) shows an inline notice instead of the reveal panel — no crash, no blank modal.
- [ ] `DalosSecretReveal` is exported from `@ancientpantheon/codex-ouronet/ui`.
- [ ] `codex-arweave`'s vitest harness mounts `DalosSecretReveal` without the "React Element from an older version of React" crash.

## Out of scope

- `wordsSecret` storage, rekey, and the Seed/words tab — parent project's `arweave-seed-reveal` topic (criteria B in `key-material-provenance/design.md`).
- Any change to `DalosSecretReveal` itself.
