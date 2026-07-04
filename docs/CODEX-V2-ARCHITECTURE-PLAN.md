# AncientCodex (Codex v2) — Architecture & Phased Build Plan

**Status:** planning COMPLETE (all §8 decisions resolved 2026-07-04). This is the
canonical design synthesis; the next step is to write the bee spec(s) from it.
Two items are intentionally left for the spec's own TDD (§8 #5, #7) — they are
design-in-spec details, not open blockers.
**Created:** 2026-07-04 (owner Mihai + Claude).
**Grounded in:** the current `@stoachain/ouronet-codex` source, the
`stoa-js/HANDOFF-codex-arweave-integration.md` prior art, and the full
Mnemosyne v0.1 design corpus. A 4-agent recon (2026-07-04) mapped the codex
internals, seams, invariants, and consumer usage; findings are woven in below.

---

## 0. The keystone insight — the Codex IS the multi-chain layer

Every autonomous or human-driven entity in the ecosystem composes the same
three Constructors + business logic:

```
Automaton = Codex (keys+signing, N chains) + Pythia (reads, N chains) + Khronoton (schedule) + logic
Daimon    = Codex (keys+signing, N chains) + Pythia (reads, N chains) + a human            + logic
```

The **Codex** is the universal multi-chain *transaction capability*: hold keys,
derive addresses, sign, broadcast — across every chain it has a module for.

The consequence, stated by the owner and central to this whole plan:

> **The Caduceus-Automaton can function as a bridge *precisely because* its
> Codex can handle both Ouronet-tx and Arweave-tx. Adding more blockchain
> modules to the Codex is what enables the bridge's multi-chain functionality
> itself.**

So there is **one chain roadmap, not two.** Each chain module added to the
Codex simultaneously:
- extends the **user wallet** (Mnemosyne / AncientCodex — users hold + send that chain), and
- extends the **bridge** (Caduceus-Automaton — it can now bridge that chain).

The Codex's 14-chain roadmap and Caduceus's 14-chain roadmap are the same list.
Build a chain module once; both the wallet and the bridge gain it.

---

## 1. What exists today (grounding)

### 1.1 The current codex is a ~29k-line Ouronet-native React package

`@stoachain/ouronet-codex@0.5.7` lives in `stoa-js/packages/ouronet-codex/`.
It is NOT a lean wallet primitive — it is a fat, Ouronet-and-React-native
application library. Module sizes:

| Module | ~lines | Nature |
| ------ | ------ | ------ |
| `zbom` | 12,366 | A **Pact language parser + code editor** (CodeMirror/lezer). Ouronet/Pact-specific. |
| `ui` | 8,756 | React UI components. |
| `state` | 1,999 | Zustand store (the state engine). |
| `components` | 1,676 | React modals (RotateGuard/RotatePayment — Ouronet Pact ops). |
| `hooks` | 939 | 17 React hooks (useSignTransaction, useGetKeypair, …). |
| `adapters` | 848 | storage adapters. |
| `codex-identity` | 608 | **DALOS/Apollo key derivation + encryption — the crypto core.** |
| types / errors / provider / resolver / google-drive | ~1,450 | supporting. |

`@stoachain/*` is imported across 30+ files. It peer-deps four `@stoachain`
packages (dalos-crypto, kadena-stoic-legacy, stoa-core, ouronet-core).

### 1.2 The three injection seams (these already exist — the modular hooks are there)

1. **Storage seam — `CodexAdapter`** (`adapters/types.ts`): passed to
   `<CodexProvider adapter={…}>`. Pure persistence of a flat `CodexSnapshot`;
   never encrypts/decrypts/validates (secrets arrive pre-encrypted). Ships
   `LocalStorageCodexAdapter` (browser) + `MemoryCodexAdapter` (SSR/tests);
   AncientHoldings implements its own `HubServerCodexAdapter` (sealed server
   blob). **Proof the seam works for radically different backends** — and the
   seam Mnemosyne's `MnemosyneCloudAdapter` plugs into.
2. **Signing / key-resolution seam — `KeyResolver`** (re-exported from
   `@stoachain/stoa-core/signing`), implemented by `InternalCodexResolver`.
   Currently **hard-bound to Kadena** (`IKadenaKeypair`, Pact signing,
   nacl/WASM, seedType routing koala→nacl vs chainweaver→WASM). Has an
   **optional `requestForeignKey(pub)` callback** already threaded through —
   the pre-existing hook for non-Kadena keys.
3. **Chain-client seam — `PactClient`** (`signingClient?` prop on
   `CodexProvider`): lazily built from kadena-stoic-legacy, or overridden
   (CF-worker proxy in prod, mock in tests). **This is the "reader/pactReader"
   injection point** — Pythia satisfies it; the codex doesn't hard-depend on it.

### 1.3 Hard invariants a v2 MUST preserve (these are load-bearing and Ouronet-structural)

- Exactly **one Prime Codex Seed** (`IKadenaSeed.isPrime`), guarded.
- Exactly **one CodexPrime ouro account** (`IOuroAccount.isPrime`), guarded.
- Exactly **one active CodexGuard pure key** (label-locked, undeletable,
  rotatable with `wasCodexGuard` history kept forever).
- An **immutable double-Apollo `ICodexIdentity`** that feeds the on-chain
  `ouronet-ns.CODEX` registration **byte-for-byte** (mutation throws).
- The **v1.2 CodexSnapshot wire format is frozen** (`ouronet-core/codex/codec.ts`
  hard-throws on any version ≠ "1.2"). Any new persisted field needs a
  **"1.3" forward-migration** (1.3 reader still accepts 1.2). — THE single
  most dangerous correctness surface; see §6.
- The **17 hooks + their `*View` shapes** are the consumer API. Must stay stable.
- **`IConsumerSettings`** already provides multi-consumer namespacing
  (`Record<consumerName, settings>`) — a built-in seam for new consumer apps
  (OuronetUI / AncientHoldings / Mnemosyne) to stash settings without collision.

### 1.4 The two live consumers (production — do not break)

- **OuronetUI** (browser, Vite 6): consumes `./provider ./hooks ./adapters
  (LocalStorage) ./components ./ui ./ui.css`; bridges the package Zustand store
  ↔ Redux bidirectionally.
- **AncientHoldings hub** (Node, Next.js, server-custody): consumes `./provider
  ./hooks ./ui ./ui.css ./adapters(types) ./types`; implements
  `HubServerCodexAdapter`; **re-implements (mirrors, does not import) the
  resolver's decrypt algorithm headlessly** for scheduled server signing
  (drops the passwordCache gate, reads a snapshot instead of the Zustand store).
  → A v2 should offer a **first-class headless resolver factory** so the hub
  stops mirroring internals.

Neither consumer imports `./resolver ./errors ./codex-identity ./google-drive
./zbom` directly — so v2 has freedom to refactor those internals as long as the
**hook surface + CodexAdapter + KeyResolver contracts** stay stable.

### 1.5 The Arweave handoff (prior art — the chain-module pattern)

`stoa-js/HANDOFF-codex-arweave-integration.md` already designed how a foreign
chain plugs in. Key decisions to carry forward verbatim:

- A **framework-agnostic protocol layer** (it called it `@stoachain/arweave-core`;
  we relocate to `@ancientpantheon/arweave-core`): keygen, `addressOf`, tx
  build/sign, **shared rotating gateway pool**, Turbo upload, GraphQL
  rebuild-from-chain, Winston↔AR units. arweave-js/Turbo calls confined here
  (so the hub/bridge can use them server-side).
- A generic **`ForeignChainAdapter` seam + chain registry**:
  `{ id, generateKey, importKey, addressOf, getBalance, buildSend, sign, post,
  upload? }`. The "Foreign Chains" UI renders generically off the registry —
  **a second chain (Bitcoin) registers without touching generic code.**
- Arweave keys are a **seedless JWK keyring** (`foreignKeys` store entity) —
  each key independent + encrypted separately, NEVER implying a shared seed.
  Mnemonic + EthAReum paths deferred behind default-off flags.
- Arweave signing is a **SIBLING path** (RSA-PSS + deephash over a JWK) — fully
  isolated from the Kadena `KeyResolver`/`CodexSigningStrategy`. **Do not
  shoehorn.**
- **Storage split**: small must-be-backed-up **keys** ride the encrypted codex
  snapshot (→ needs the "1.3" codec migration); large rebuildable-from-chain
  **upload library** lives in a SEPARATE store (IndexedDB browser / SQLite
  Node), never in the codex backup. Upload tags
  (`App-Name`, `Content-Type`, `Codex-Item-Id`, `Codex-Owner`) power the
  GraphQL rebuild — the on-chain tag index is the source of truth, the local
  library is a cache.
- The gateway pool is **shared with the observer** (one pool in arweave-core).

### 1.6 Mnemosyne (prior art — the AncientCodex app + storage)

Mnemosyne v0.1 (design locked) is a **Bitwarden-pattern cloud codex vault +
management dashboard** at `mnemosyne.ancientholdings.eu`. Load-bearing facts:

- It is a **new `MnemosyneCloudAdapter`** (implements `CodexAdapter`) — NOT a
  replacement for the codex package. It plugs into the storage seam (§1.2).
- **Technically non-custodial** via a CK-wrapping model: a random 256-bit Codex
  Key (CK) encrypts the codex JSON; CK is then *wrapped* by per-mode keys
  (password / mnemonic / facts / recovery-secret). The server stores only
  ciphertexts + verifiers; it cannot decrypt. Password/mode changes re-wrap CK
  without re-encrypting the blob.
- **4 identity modes** (Privacy / Wallet / Convenience / Streamlined), cumulative
  + switchable, for crypto-natives through grandma-tier movie-platform onboarding.
- **3-layer storage**: L1 Postgres (hot) + **L2 Arweave (opt-in encrypted
  backup)** + L3 Stoa `mnemosyne.CODEX` Pact module (immutable pointer to the
  arweave-tx-id, so a recovered blob is verifiably yours). The **self-backup
  recursion** the owner described is this L2 — and it is *powered by the codex's
  own Arweave module.*
- The dashboard = "codex contents, recovery, backups." → **Mnemosyne IS the
  AncientCodex standalone Exodus-like wallet** (owner-confirmed): the surface
  where a user manages their multi-chain codex without a consumer app.

---

## 2. The target architecture — one monorepo, the whole Codex family

**`AncientPantheon/Codex` becomes a monorepo (npm workspaces, like stoa-js)
that holds the ENTIRE Codex family.** `ouronet-codex` moves OUT of stoa-js into
it. This eliminates the cross-org awkwardness and cleans stoa-js back down to
pure chain-primitive libraries.

```
AncientPantheon/Codex/            (monorepo — npm workspaces)
├── packages/
│   ├── codex-core/               → @ancientpantheon/codex-core
│   │     Chain-agnostic substrate: the CK-wrapping vault + encryption model,
│   │     the CodexAdapter storage interface, the CodexSnapshot data model,
│   │     the ForeignChainAdapter registry seam, the foreignKeys keyring model,
│   │     the headless resolver factory. NO React, NO Ouronet, NO Pact.
│   │
│   ├── codex-ui/                 → @ancientpantheon/codex-ui
│   │     The React layer: CodexProvider, the 17 hooks, drop-in UI components,
│   │     ui.css. Chain-generic shell; per-chain UI contributed by modules.
│   │
│   ├── codex-ouronet/            → @ancientpantheon/codex-ouronet
│   │     MOVED from stoa-js. The Ouronet-native module: Kadena/Pact signer,
│   │     the double-Apollo ICodexIdentity, CodexPrime, CodexGuard, seed
│   │     derivation, the zbom Pact editor, ouronet-ns.CODEX registration.
│   │     peer-deps @stoachain/{stoa-core,ouronet-core,kadena-stoic-legacy,dalos-crypto}
│   │     (consumed from npm — a clean cross-repo boundary).
│   │
│   ├── codex-arweave/            → @ancientpantheon/codex-arweave
│   │     The Arweave module: foreignKeys JWK keyring integration, the sibling
│   │     RSA signer, the upload/library feature, the "Arweave" UI tab.
│   │     Depends on @ancientpantheon/arweave-core + codex-core.
│   │
│   └── (future) codex-bitcoin/, codex-ethereum/, codex-solana/, …
│         One package per chain the Codex (and therefore the bridge) supports.
│
└── (arweave-core — see §2.1: probably its own package, consumed by BOTH
     codex-arweave AND the Caduceus-Automaton bridge)
```

Everything `@ancientpantheon/*` scoped, one repo, one workspace. stoa-js is left
as: `stoa-core`, `ouronet-core`, `kadena-stoic-legacy` (chain primitives only).

### 2.1 Where `arweave-core` lives (the one nuance)

`arweave-core` (pure Arweave protocol: keygen, sign, gateway pool, Turbo,
GraphQL) is consumed by **both** the codex (`codex-arweave`) *and* the Caduceus
bridge (its releaser signs AR releases; its sniffer/Pythia shares the gateway
pool). It is a **shared foreign-chain primitive**, not codex-only.

Options (decide in the spec): (a) its own package in the Codex monorepo
(`packages/arweave-core`); (b) its own standalone repo `AncientPantheon/arweave-core`;
(c) belongs conceptually near Pythia (which also reads Arweave). **Lean: (a)** —
keep it in the Codex monorepo as `@ancientpantheon/arweave-core`; the bridge and
Pythia consume it from npm. Revisit if a second non-codex consumer makes a
standalone repo clearly better.

### 2.2 The chain-module contract (how every future chain plugs in)

Each `codex-<chain>` module provides:
- a **`ForeignChainAdapter`** registration (`id, generateKey, importKey,
  addressOf, getBalance, buildSend, sign, post, upload?`),
- its **key storage shape** in the `foreignKeys` keyring (encrypted, rides the
  codec),
- its **signer** (sibling to Kadena; e.g. RSA-PSS for AR, secp256k1 for BTC/ETH),
- optional **chain-specific extensions** (AR: upload/library/Turbo; others: none),
- optional **UI contributions** to the generic "Chains" tab.

Ouronet is the "native/complex" reference implementation (it predates the seam
and carries the identity model); Arweave is the "foreign/module" reference
(seedless, sibling signer, optional upload). Bitcoin/Ethereum follow Arweave's
shape.

### 2.3 What a consumer installs — the whole Codex, every chain (owner directive)

**There is no ouronet-only consumer package any more.** A consumer installs THE
Codex and automatically gets StoaChain + Ouronet + every foreign-chain module
that ships. Adding a chain benefits every consumer on the next version bump — no
opt-in, no per-chain package to bolt on. (This is the consumer-facing face of the
§0 keystone: one codex, growing chain support, shared by wallet and bridge.)

- **Consumer-facing surface = a single `@ancientpantheon/codex`.** It composes
  `codex-core` + `codex-ui` + every `codex-<chain>` module and re-exposes them
  through subpath exports (`./provider ./hooks ./ui` + per-chain entry points).
  A React app gets the full multi-chain wallet from one dependency; a **headless**
  consumer (the Caduceus-Automaton, Pythia) imports only the core + chain
  primitives it needs, without pulling React.
- **Internal packages** (`codex-core`, `codex-ui`, `codex-ouronet`,
  `codex-arweave`, …) stay as monorepo workspaces for build modularity + clean
  boundaries — they are the codex's *internals*, **NOT separately published to
  npm**. There is no standalone `@ancientpantheon/codex-ouronet` on the registry
  (that is the "no ouronet-only package" directive, enforced at the publish
  boundary). `arweave-core` is the deliberate exception that IS published
  independently (the bridge/Pythia use its raw Arweave protocol server-side, §2.1).
- **Exactly two packages publish to npm:** `@ancientpantheon/codex` (install this —
  the whole wallet, all chains) and `@ancientpantheon/arweave-core` (a shared
  low-level primitive for headless server use). Everything else is an internal
  workspace package the aggregator bundles. (If a future need arises to expose a
  mini package — e.g. a headless `codex-core` for a minimal signer — adding it to
  the publish list is a one-line, reversible change; nothing in the structure
  prevents it.)
- **"Whole codex" ≠ eager weight.** The 12k-line zbom Pact editor and other heavy
  pieces ride lazy/subpath imports, so a lean wallet (Mnemosyne) loads them only
  when the user does Ouronet-Pact things. Every chain is *available*; bundle
  weight is paid on use — reconciling "get everything" with the lean-wallet goal
  in §3.
- **Old `@stoachain/ouronet-codex@0.5.7` stays frozen** and published as-is.
  Consumers migrate off it to `@ancientpantheon/codex` when ready (§5); the moment
  they do, they gain every chain automatically.

---

## 3. Mnemosyne = AncientCodex (the app)

Mnemosyne is the standalone Exodus-like multi-chain wallet — the surface where a
user manages their Codex directly, no consumer app required. It composes the
Codex family:

- **`MnemosyneCloudAdapter`** (implements `codex-core`'s `CodexAdapter`) = L1
  cloud storage of the encrypted codex.
- The dashboard uses **`codex-ui`** + whichever `codex-<chain>` modules are
  enabled → a lean multi-chain wallet (doesn't drag the heavy Ouronet Pact
  editor unless the user does Ouronet things).
- **L2 self-backup** = `codex-arweave`'s upload capability writes the encrypted
  codex JSON to Arweave; **L3** = the `mnemosyne.CODEX` Pact module pins the
  arweave-tx-id. The wallet backs itself up permanently via a chain it manages.
- The 4 identity modes + CK-wrapping live in Mnemosyne's backend + the
  MnemosyneCloudAdapter; the codex data model underneath is unchanged.

So "AncientCodex" and "Mnemosyne" are one product with two names: Mnemosyne is
the operator/vault framing; AncientCodex is the end-user Exodus-wallet framing.

---

## 4. The Caduceus-Automaton relationship (the keystone, made concrete)

The Caduceus-Automaton is an operator-side entity that composes:
- **The Codex (headless subpaths of `@ancientpantheon/codex`) + `arweave-core`** —
  its keys + signing on every chain it bridges, pulled from the *same* whole-codex
  every wallet uses (§2.3), minus the React UI. Its Codex holds the bridge's
  Ouronet signer key + the Arweave custody key. When `codex-bitcoin` ships to the
  wallet, the bridge gains BTC from the identical package — no bridge-side rewrite.
- **Pythia** — its reads (StoaChain events + Arweave deposits).
- **Khronoton** — its schedule.
- **bridge business logic** — the 3-tx two-phase-commit orchestration.

It bridges Ouronet↔Arweave because its Codex speaks both. When `codex-bitcoin`
lands, the bridge gains BTC — same module, no bridge rewrite. **The Codex chain
modules are the bridge's chain support.** (Governance stays separate: the
Automaton's Codex holds only the narrow finalize/void/release keys; pause/fee
use a separate human-signed keyset.)

---

## 5. Migration strategy — strangler fig, don't break production

`@stoachain/ouronet-codex@0.5.7` is live (OuronetUI + hub). Rules:

1. **The old package stays frozen and published** through the whole migration —
   it keeps serving production untouched. No unpublish.
2. **Build the new monorepo family additively.** `codex-core`, `codex-ui`,
   `codex-ouronet`, `codex-arweave` are new packages. Nothing live breaks while
   they're built + tested.
3. **Migrate consumers just-in-time, individually, verified.** OuronetUI moves
   when it wants multi-chain (Arweave deposits for the bridge) or the identity
   refactor; the hub moves when it wants the first-class headless resolver.
   Never a big-bang.
4. **Preserve the API surface** (§1.3): the 17 hooks + `*View` shapes, the
   `CodexAdapter` contract, the `KeyResolver` contract, `IConsumerSettings`,
   and the frozen invariants. A consumer's migration should be "swap the import
   + the provider wiring," not a rewrite.
5. **Deprecate `@stoachain/ouronet-codex` only after all consumers are off it**
   (npm deprecate = soft warning, not breakage).

---

## 6. The single most dangerous surface — the backup codec

Arweave JWKs (and every future foreign key) are **unrecoverable if lost** and
must ride the encrypted backup. Get the codec wrong and a user generates an AR
address, backs up, restores → funds gone. So this gets its own dedicated,
exhaustively-tested spec phase. TDD mandatory.

**Verified mechanics (2026-07-04 code audit) — one writer, two readers.** The
scary version of this ("many exporters, any stale one silently drops the new
field") does NOT exist. The format has exactly:

- **One writer.** `buildCodexExport` / `serializeCodex` in
  `ouronet-core/codex/codec.ts` is the *only* place in the ecosystem that emits a
  codex JSON — funneled through the single `useCodexBackup` hook into the two UI
  surfaces. **Upgrading that one function to `"1.3"` (add the optional
  `foreignKeys` block) makes every export 1.3 in a single edit.** Nothing to hunt.
- **Two readers, with different strictness** (both **fail closed** — they reject
  an unknown version *loudly*, never silently drop fields, so there is no
  silent-loss path in any rollout ordering):

  | Reader | Consumer | To accept 1.3 | `foreignKeys` in allow-list? |
  | ------ | -------- | ------------- | ---------------------------- |
  | `deserializeCodex` (`ouronet-core`) | OuronetUI + hub | widen version gate | **yes** — it's strict-shape; throws `CodexUnknownFieldError` on any unlisted field |
  | `importCodex` (`StoaWallet/packages/core/src/codex`) | StoaWallet | widen version gate | **no** — minimal-slice reader; reads only `kadenaWallets` + `pureKeypairs`, ignores everything else |

- **Rollout discipline (the only real coordination):** ship both readers' version
  widening **before** anyone ships a 1.3 writer. Standing rule: no consumer
  hand-rolls its own *writer* — export stays the single shared construct. (Both
  current readers only read; this holds today.)

- **StoaWallet is safe by design.** It uses the codex *strictly* to import
  StoaSeeds + StoaAccounts (`kadenaWallets`) and optional pure keypairs; it
  explicitly does not read `ouronetWallets`/`addressBook`/`uiSettings` and, being
  a pick-what-I-need reader, is blind to a new `foreignKeys` block. Adding
  foreign-chain support cannot corrupt it; its *only* touchpoint is the hardcoded
  `exp.version !== '1.2'` gate, which a one-line widen (`{'1.2','1.3'}`) fixes.
  Candidate for the v2 work: collapse StoaWallet onto the shared reader so there
  is eventually *one* reader too.

**Codec ownership (decision for the spec).** The codec currently lives in
`ouronet-core` (part of the atomic triplet), so a codec change forces a lockstep
triplet bump. Leaning: move the *generic envelope* (`buildCodexExport` /
`serializeCodex` / `deserializeCodex` + the version gate + `foreignKeys`) into
`codex-core` (chain-agnostic ownership), and keep Ouronet-specific entity codecs
in `codex-ouronet`.

---

## 7. Phased build plan (the input to the bee spec[s])

Sequenced to de-risk: prove the modular seam with a real second chain *before*
the big extraction, keep production untouched throughout.

- **Phase A — Monorepo bootstrap.** Convert `AncientPantheon/Codex` to an npm
  workspaces monorepo; wire `/wasp:pollinate --init`; CI (lint/typecheck/test);
  empty package skeletons for codex-core / codex-ui / codex-ouronet /
  codex-arweave / arweave-core.
- **Phase B — `arweave-core`.** The framework-agnostic Arweave protocol layer
  (keygen, addressOf, sign, gateway pool, Turbo, GraphQL, units). Headless,
  fully unit-tested. First publishable package. (Also unblocks the bridge later.)
- **Phase C — Lift `ouronet-codex` into the monorepo as `codex-ouronet`.**
  Move source from stoa-js; re-scope to `@ancientpantheon/codex-ouronet`;
  keep it building against the `@stoachain/*` chain libs from npm; preserve the
  full API surface + invariants; ship a compatibility story so
  `@stoachain/ouronet-codex` can still be published (shim or dual-publish) until
  consumers migrate. This is the big, careful, security-critical move — its own
  spec, TDD, no consumer changes yet.
- **Phase D — Extract `codex-core` + `codex-ui`.** Carve the chain-agnostic
  substrate (vault, CK-wrapping envelope, CodexAdapter, CodexSnapshot,
  ForeignChainAdapter registry, foreignKeys model, headless resolver factory)
  out of `codex-ouronet`; carve the React layer into `codex-ui`; rewire
  `codex-ouronet` to consume both. The "1.3" codec migration lands here (§6).
- **Phase E — `codex-arweave`.** The Arweave module on top of arweave-core +
  codex-core: foreignKeys JWK keyring, sibling RSA signer, upload/library
  (separate store), Arweave UI tab. This is the first proof the modular seam
  works end-to-end for a real foreign chain — and the wallet capability the
  bridge needs.
- **Phase F — Consumer migration (just-in-time).** OuronetUI + hub move to the
  new family, individually, verified. Hub gets the first-class headless
  resolver. `@stoachain/ouronet-codex` deprecated once both are off it.
- **Phase G — Mnemosyne / AncientCodex.** The cloud vault + dashboard app built
  on the Codex family; `MnemosyneCloudAdapter`; 4 identity modes; 3-layer
  storage (L2 via codex-arweave, L3 via `mnemosyne.CODEX`). (Large; may be its
  own multi-phase program per the existing Mnemosyne design docs.)
- **Phase H+ — More chain modules.** `codex-bitcoin`, `codex-ethereum`, … each
  extending both the wallet AND the Caduceus bridge. This is where the Codex
  roadmap and the Caduceus 14-chain roadmap converge.

The **Caduceus-Automaton** (from `AncientPantheon/HANDOFF.md`) slots in after
Phase E gives it a multi-chain Codex + after Pythia/Khronoton exist — it
consumes codex-core + codex-ouronet + codex-arweave.

---

## 8. Decisions — resolved (2026-07-04)

Planning is complete; these are the settled inputs to the bee spec. Only the two
items marked *(spec-internal)* are deferred — not because they're unresolved
blockers, but because their exact shape is best designed inside the spec's TDD.

1. **arweave-core placement** → **monorepo package** `@ancientpantheon/arweave-core`,
   independently publishable (bridge/Pythia consume it server-side, §2.1). Revisit
   only if a standalone repo becomes clearly warranted.
2. **Codec ownership** → the **generic envelope** (`buildCodexExport` /
   `serializeCodex` / `deserializeCodex` + version gate + `foreignKeys`) moves to
   **`codex-core`**; Ouronet-specific entity codecs stay in `codex-ouronet` (§6).
3. **Consumer packaging** *(was "ouronet-codex end-state")* → **owner-resolved:**
   no ouronet-only consumer package. Consumers install the **whole Codex**
   (`@ancientpantheon/codex`) and get StoaChain + Ouronet + every foreign chain
   automatically (§2.3). Old `@stoachain/ouronet-codex@0.5.7` stays frozen.
   Publishing model: one consumer-facing `@ancientpantheon/codex` over internal
   workspace packages, subpath exports for headless consumers.
4. **codex-ui granularity** → **one UI shell** + module-contributed chain tabs;
   heavy pieces (zbom) lazy-loaded (§2.3).
5. **Headless resolver factory** → *(spec-internal)* the hub stops mirroring codex
   internals; the exact factory API shape is designed in the spec (§1.4).
6. **Bee repo hosting** → Codex/monorepo specs live in `AncientPantheon/Codex`;
   the Mnemosyne app spec in `Mnemosyne`; the `mnemosyne.CODEX` Pact module is
   operator-authored (existing handoff).
7. **Backup-codec "1.3" migration** → its own TDD phase. Surface **verified** (one
   writer, two fail-closed readers, §6); the exact `foreignKeys` field layout +
   forward-migration + test matrix is *(spec-internal)* — designed in that phase. Verified surface: one writer (`buildCodexExport`) + two fail-closed readers (`deserializeCodex` strict, StoaWallet `importCodex` minimal-slice); spec must widen both readers before shipping a 1.3 writer.

---

## 9. Sources (prior art this plan is built on)

- `stoa-js/packages/ouronet-codex/` — the current codex source (v0.5.7).
- `stoa-js/packages/ouronet-core/src/codex/codec.ts` — the single writer + strict reader (`buildCodexExport`/`serializeCodex`/`deserializeCodex`, frozen at "1.2").
- `StoaWallet/packages/core/src/codex/importCodex.ts` — the independent minimal-slice reader (StoaSeeds/StoaAccounts only; audited 2026-07-04).
- `stoa-js/HANDOFF-codex-arweave-integration.md` — the Arweave chain-module design + build spec (§3, lines 183–311).
- `Mnemosyne/docs/v0.1-design.md` — the cloud vault + 4-mode + 3-layer storage design.
- `Mnemosyne/docs/handoffs/01-mnemosyne-codex-pact-module.md` — the `mnemosyne.CODEX` Pact module handoff.
- `AncientPantheon/HANDOFF.md` — the AncientPantheon kickstart (Constructors, Automaton pattern, Caduceus-Automaton at Phase 9).
- `AncientPantheon/WORKSPACE.md` — the workspace overview.
- `StoaOuronet/MIGRATION-HANDOFF-Pantheon.md` — the ecosystem taxonomy + org map.
- The 2026-07-04 recon digests (codex seams/invariants/consumers; Arweave handoff; Mnemosyne) — captured in this doc.
