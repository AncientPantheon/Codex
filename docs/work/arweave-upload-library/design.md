# Codex PermaLibrary — Project Design

## Problem

`docs/Codex-Arweave-Upload-Handoff.md` asks Codex to become a real Arweave
uploader — and the shape conversation that followed grew this into a larger
vision than "add an upload button": a durable, categorized, generational
personal archive on the permaweb, built to still make sense at tens of
thousands of entries, decades from now, potentially browsed by someone who
inherits the codex rather than the person who filled it.

That's two genuinely different engineering problems, so this is a
**project**, split into topics shaped one at a time:

1. **The data foundation** — native (non-third-party) upload/payment,
   public-or-encrypted storage keyed to an Ouronet account, a versioned and
   categorized tag schema, and the account-deletion/session-safety guarantees
   that keep permanent on-chain ciphertext from ever being silently orphaned.
2. **The browsing experience** — a real PermaLibrary browser capable of
   Public/Private-first, multi-account, category-and-filter navigation over
   a large accumulated archive, as a metadata list (no thumbnail/media
   gallery) rather than today's flat unfiltered `<ul>`.

Explicitly **not** part of either topic: an Arweave-native email/chat engine
(the Weavemail-style precedent that prompted the question). That's a
protocol-level product on top of this storage layer — different addressing
model (send *to* someone else, not just archive your own), different query
shape, different UI entirely. This design keeps the door open for it (see
Topic 1's tag-namespace discipline) without building it.

## Approach

Ship Topic 1 first — it determines what data exists. Topic 2 is shaped and
built once Topic 1 is approved, since it consumes Topic 1's schema (category,
public/private, which account encrypted what) directly.

## Topics

1. `arweave-native-upload` — native bundled upload/payment, Ouronet-account
   encryption, the versioned + categorized tag schema, non-removable-account
   invariant, and session-safety (dirty/logout/reminder) infrastructure.
2. `arweave-permalibrary` — the Public/Private-first, multi-account,
   category-filtered browsing experience over the data Topic 1 produces, at
   generational scale. Shaped after Topic 1 is approved.
