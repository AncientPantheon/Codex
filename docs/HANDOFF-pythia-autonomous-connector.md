# Handoff: autonomous Apollo re-authentication for Pythia's connector protocol

**Audience:** an agent working in the Codex repo (`constructors/Codex`, the `@ancientpantheon/*` monorepo).

**Status:** new work. This is NOT a request to build Apollo signing from scratch — most of the
cryptographic substance already exists and is production-proven via the browser `/apollo-verify`
flow. This handoff extends that into a **headless, fully autonomous** mode for server-side
Automaton consumers.

**Read first, in this order:**
1. `websites/Pantheon/docs/pantheonic-architecture/identity/HANDOFF-apollo-ownership-verifier.md`
   — the CURRENT, accurate spec for the existing browser-based Apollo-ownership verifier. This is
   ground truth for the crypto and message format.
2. `packages/codex-ouronet/src/apollo-verify/signApolloOwnership.ts` — the existing reference
   signing implementation this handoff builds on top of.
3. `websites/Pantheon/docs/pantheonic-architecture/automaton/02-automaton-master-key-codex-protection.md`
   — the canonical automaton Codex-protection standard (sealed vault, server-held auto-unlock, no
   human prompt). Whatever gets built here MUST follow this pattern, not invent a new one.
4. (Lower priority, partially superseded) `docs/HANDOFF-codex-pythia-key.md` — an earlier spec for
   a related but distinct piece (baking a consumer's PUBLIC key into request headers). Still
   relevant for §1 of that doc; its §2 (`signChallenge`) is effectively superseded by what's
   described below, now that `signApolloOwnership` exists.

## 0. One-paragraph model

Pythia's consumer-key system uses "dual Apollo" identities — a Standard (`₱.`) half and a Smart
(`Π.`) half, each deployed and then linked into one on-chain `DualLink` row (Pythia's live
`PYTHIA.pact` module, `C_LinkDualApiKey`/`A_LinkDualApiKey`). Once a consumer's pair is
deployed+linked+activated on-chain, Pythia needs **recurring, autonomous** proof that whoever is
calling her API still holds the private keys behind that pair — because the public halves are, by
design, public on-chain data, not a secret. This is a **different** thing from the existing
one-time "prove ownership before Link unlocks" browser flow: that one is human-driven (a person
visits a redirect URL, their browser signs, redirects back) and happens once. What's needed here
runs forever, on a timer (default every 3 hours), for the lifetime of the connector, with **zero**
human involvement — a server-side Automaton (Pythia herself is the first consumer of this) must be
able to prove Apollo ownership entirely on its own.

## 1. What already exists and is directly reusable — verified, do not rebuild

- **The exact canonical challenge message**, byte-for-byte: `buildApolloOwnershipMessage(account, nonce, rp)` in `signApolloOwnership.ts` (identical to Pythia's own `buildChallengeMessage` in `apps/pythia/src/connectors/verify/canonicalMessage.ts`):
  ```
  Apollo ownership proof
  apollo: <account>
  nonce: <nonce>
  rp: <rp>
  ```
  Four lines, `\n`-joined, UTF-8, no trailing newline. A single differing byte fails verification on Pythia's side — do not touch this format.
- **`Apollo.sign(keyPair, message)`** via `@stoachain/dalos-crypto/registry` — curve `dalos-apollo`, Schnorr v2. Already proven to round-trip against Pythia's `Apollo.verify`.
- **`signApolloOwnership(account: IOuroAccount, secretPlaintext: string, nonce: string, rp: string): { apollo: string; sig: string }`** (`packages/codex-ouronet/src/apollo-verify/signApolloOwnership.ts`) — the reference implementation of "re-derive the Apollo keypair from a decrypted secret, verify the derived address matches the claimed account, sign the canonical message." This function itself has no React/DOM import — it's plain TS. Whether its *transitive* dependencies are server-safe is an open question below, not something to assume.

## 2. What's missing — the actual new work

Everything in §1 assumes a **human**, in a **browser**, who has just password-unlocked their
Codex, handing the resulting decrypted secret to `signApolloOwnership` directly (see
`ApolloVerifyView.tsx` for how that assembly currently happens). None of that applies to a
server-side Automaton that needs to do this unattended, on a recurring schedule, forever.

Needed: a way for an Automaton's own Codex — already auto-unlocked at boot under its own master
key, per `automaton/02`, with zero human prompt — to locate one of its own Apollo accounts'
decrypted secret material and produce a signature over an arbitrary caller-supplied
`(nonce, rp)`, without any browser, redirect, or UI involved.

## 3. Proposed new function (confirm/adjust the shape while resolving §4)

```ts
export async function autoSignApolloChallenge(
  apolloAccount: string,   // the ₱. or Π. account to prove
  nonce: string,
  rp: string,
): Promise<{ apollo: string; sig: string }>
```

Behavior:
1. Read the Automaton's own Codex snapshot via whatever auto-unlock mechanism `automaton/02`
   already mandates — the master key comes from the environment, no human prompt. If the Codex is
   uninitialized, throw a clear, actionable error (mirror the pattern already used elsewhere for
   this exact situation — see Pythia's own `khronoton/keyResolver.ts`, a different repo, but the
   shape of "clear error, not a silent no-op" is the standard to match).
2. Locate the specific Apollo account's decrypted secret within that snapshot.
3. Call the existing `signApolloOwnership` (or, if its `IOuroAccount` shape turns out to be
   browser-account-specific rather than something a server-side snapshot naturally produces, call
   `Apollo.sign` + `buildApolloOwnershipMessage` directly with an adapted account object — this is
   exactly open question #2 below, don't guess which path is right, verify it).

## 4. Open questions to resolve while implementing — verify against the real code, don't assume

1. **Is `signApolloOwnership.ts` (and its imports — especially `detectOriginCurve` from
   `../ui/internal/originCurve.js`) actually safe to import from a plain Node/server process, or
   does something in that chain assume a browser/DOM environment?** If not fully server-safe,
   extract the pure derive+sign logic into a Node-safe module rather than importing the
   browser-coupled file as-is.
2. **Does a server-side Automaton's Codex snapshot (the shape `@ancientpantheon/codex` produces
   for a service like Pythia) store Apollo identities in the same `IOuroAccount` shape
   (`originCurve`, `originMode`, `address`, `isSmart`) that `signApolloOwnership` expects, or is
   that shape specific to the browser/wallet package (`codex-ouronet`)?** If there's a mismatch,
   either (a) extend the server-side snapshot format to also hold Apollo entries in a compatible
   shape, or (b) write a small, explicit adapter. Report back which is actually true — this
   determines the real scope of this work, and I don't have visibility into the server-side
   snapshot's exact schema from the Pythia repo alone.
3. **Where should `autoSignApolloChallenge` live** — inside `packages/codex-ouronet` next to
   `signApolloOwnership` (if that package is confirmed server-importable), or does it need a
   genuinely separate, server-only package? Your call, based on what §1 turns up.
4. Confirm the master-key auto-unlock pattern this must follow by reading
   `automaton/02-automaton-master-key-codex-protection.md` end to end — this function should
   assume/require an already-unlocked Codex per that standard, never invent its own unlock
   mechanism or prompt for a password.

## 5. How this gets called (context only — not in scope to build here)

A consumer Automaton (Pythia herself first) runs a scheduled loop, default every 3 hours, that:
calls Pythia's new headless challenge endpoint (`POST /connectors/auth/challenge` — being built on
the Pythia side, see the companion Pythia design doc,
`docs/work/pythia-connector-protocol/design.md` in the Pythia repo) → receives `{ nonce, rp }` →
calls `autoSignApolloChallenge(apolloAccount, nonce, rp)` (built here) → POSTs
`{ apolloAccount, signature }` back to Pythia's verify endpoint → receives a short-lived ephemeral
bearer secret → seals it into its own vault (per `automaton/02`) → uses it for API calls → repeats
before the secret expires. None of that HTTP/scheduling/storage logic is this handoff's job — this
handoff is scoped to `autoSignApolloChallenge` and its four open questions.

## 6. Explicit non-goals for this handoff

- Do NOT build or touch on-chain transaction submission — `C_LinkDualApiKey`/`A_LinkDualApiKey`
  already exist in the live `PYTHIA.pact` module; that's Pythia+chain-side work, not Codex-side.
- Do NOT change the existing browser `/apollo-verify` flow — it's separate, already working, and
  serves a different (one-time Link) purpose. This is purely additive alongside it.
- Do NOT build autonomous re-auth for browser-based Daimon consumers in this pass. Scope this
  strictly to server-side Automaton consumers (Pythia is the first). Daimon handling (if it's even
  the same shape — an interactive browser app may not need unattended re-auth the same way) is an
  explicit follow-up decision, not part of this work.

## 7. When done, report back

1. The resolved answers to all four open questions in §4.
2. The final function signature and its package location.
3. Test coverage proving a signature produced this way passes Pythia's *existing*
   `apolloVerify()` function (`apps/pythia/src/connectors/verify/apolloVerify.ts`, a different
   repo — describe the round-trip test even if you can't literally import Pythia's code; the
   message format and curve are what must match).

---

## Resolved — 2026-07-30

Implemented. Full resolution of §4's four open questions, the final function shape, and the
round-trip test evidence live in `docs/work/pythia-autonomous-connector/design.md` (this repo).
Short version: `autoSignApolloChallenge(snapshot, codexPassword, apolloAccount, nonce, rp)` lives
in `packages/codex-ouronet/src/apollo-verify/`, exported via a new React-free `./apollo-verify`
subpath and re-exported from the public `@ancientpantheon/codex/ouronet` barrel (same precedent
as `rekeyCodex`). Shipped in `codex-ouronet` 0.7.0 / `codex` 0.7.0.
