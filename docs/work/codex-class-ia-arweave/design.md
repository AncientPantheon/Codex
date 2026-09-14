# Codex Class IA + Arweave — Design

## Problem

Codex's top level presents five tabs as peers, but three of them are all
Chainweb sub-concerns: "Seed Words" holds **BIP39 Chainweb mnemonics**, "Pure
Key Pairs" holds raw `pact -g` Chainweb ed25519 keys, and "Stoa Accounts" holds
the `k:` accounts those two produce. Worse, "Seed Words" reads as *Ouronet* seed
words, which it is not — Ouronet uses DALOS's 256-glyph character set (1–256
invented words, no dictionary), while Chainweb uses BIP39's fixed 2048-word list
(12 or 24 words, checksummed). The two are disjoint systems, not subsets.

There is also no home for additional blockchains. `ArweavePanel` exists but is
mounted nowhere, so users cannot generate an Arweave address, check a balance,
send AR, or store Arweave addresses in the Address Book. A horizontal tab strip
would not scale past a handful of chains.

## Approach

Reorganise the top level into **three Class tabs**:

1. **Ouronet Accounts** (Class 1) — unchanged this pass.
2. **Blockchain Accounts** (Class 2) — a vertical left rail listing blockchains;
   selecting one shows that chain's panel, presented as the same three
   categories: **Seeds · Pure Keys · Accounts**.
3. **Address Book** (Class 3) — unchanged this pass except gaining Arweave entries.

Class 2 reuses the existing chain-generic `ForeignChainsTab` (codex-ui), whose
injected contract — a `foreignChains` id list plus an `id → panel` slot map —
already supports arbitrary chains and carries no chain-specific branch. Only its
**layout** changes: horizontal strip → vertical rail. The rail gets a search
field that renders only above a chain-count threshold, so it earns its space.

Each chain **declares its own category list**, so the shell stays generic and a
chain is not forced into a fixed set. Seeds / Pure Keys / Accounts is the common
spine; a chain may add its own beyond it.

- **Chainweb** registers a panel that re-parents today's `SeedWordsTab`,
  `PureKeypairsTab`, and `StoaAccountsTab` **unchanged** → Seeds / Pure / Accounts.
- **Arweave** registers **all five** categories from the start — Seeds · Pure Keys
  · Accounts · Upload · Library.

**The full menu is built up front; functionality is wired incrementally.** Every
category button exists and is selectable immediately, so the structure is
visible and navigable. Upload and Library mount their EXISTING, already-working
areas (`UploadArea`, `LibraryArea`) — "parked" means we invest nothing further in
them, NOT that working behaviour is replaced. Only **Arweave Seeds** lacks an
implementation, and it alone renders an explicit "not yet wired" placeholder —
never a blank panel, never a crash.

Arweave key generation runs through the existing off-main-thread
`createWorkerKeygenRunner(workerFactory)`; the consuming app supplies the
bundler-specific `workerFactory` (the shared seam never hardcodes `new Worker`).

**Alternatives considered**

- *Keep Chainweb's three tabs top-level, group only Arweave* — rejected: keeps
  the misnaming and the false peer relationship, and still does not scale.
- *Horizontal chain strip inside Class 2* — rejected: dies past ~6 chains, which
  is the whole reason for the rail.
- *Mount `ArweavePanel` directly as its own top-level tab* — rejected: discards
  the already-written generic registry and needs restructuring at chain #3.

## Acceptance criteria

- [ ] The Codex top level shows exactly three tabs: Ouronet Accounts,
      Blockchain Accounts, Address Book.
- [ ] Selecting Blockchain Accounts shows a vertical list of blockchains;
      selecting a blockchain shows its supported categories as horizontal buttons.
- [ ] Chainweb → Seeds / Pure Keys / Accounts show the same content and support
      the same actions as today's Seed Words / Pure Key Pairs / Stoa Accounts
      tabs, with no behaviour change.
- [ ] Arweave shows all five category buttons — Seeds, Pure Keys, Accounts,
      Upload, Library — and every one is selectable.
- [ ] Arweave Seeds — the one category with no implementation — shows a clear
      "not yet wired" placeholder rather than a blank panel or an error.
- [ ] Arweave Upload and Library still render their existing working areas,
      unchanged from today.
- [ ] A user can generate a new Arweave key from Arweave → Pure Keys without the
      UI freezing, and the new key appears in the list.
- [ ] A user can see an Arweave address's balance and send AR to a recipient.
- [ ] An Arweave address can be saved in the Address Book and selected as a
      recipient from the Send flow.
- [ ] Registering a hypothetical third blockchain requires no change to the
      Class 2 shell — only a registry entry plus a panel, with its own
      category list.
- [ ] The blockchain search field is absent at two chains and appears once the
      chain count exceeds the threshold.

## Out of scope

- Address Book rework beyond storing/selecting Arweave entries — flagged
  separately by the owner as its own pass.
- Further investment in Arweave **Upload** / **Library** — their existing
  working areas are mounted as-is; no changes, no new features.
- **Seeded RSA-4096 generation from DALOS seed words** — the Arweave **Seeds
  menu button is built this pass**; only the crypto behind it is deferred to
  `docs/HANDOFF-arweave-dalos-crypto-seeded-keygen.md`. That wiring still
  requires the `@ouronet/dalos-crypto` bump — this repo currently resolves
  **4.0.4 with `dist/rsa4096` absent**. Pure-key generation this pass uses the
  existing random `generateKey()`.
- Ouronet (Class 1) internal restructuring into its own three categories.
- Publishing. Everything is built and verified locally; the release is a
  separate, later step.
