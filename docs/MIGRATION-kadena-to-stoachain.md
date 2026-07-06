# Migration: `Kadena` → `StoaChain` (Codex v0.2.0)

**Breaking change.** As of Codex v0.2.0 the network formerly referred to as "Kadena"
is named **StoaChain** throughout the public API. Consumers (OuronetUI and any other
app embedding the Codex) must update their imports and symbol references.

> "Kadena" now survives **only** as the dependency package `@stoachain/kadena-stoic-legacy`.
> Everything the Codex exposes is StoaChain.

## What did NOT change (safe — no action needed)

- **The backup/codec wire format.** The serialized keys `kadenaWallets` and
  `kadenaSeeds` (and the localStorage `wallets` key) are **unchanged**. Every existing
  Codex backup restores exactly as before. The codec version is unchanged.
- **On-chain Pact data keys** (`kadena-need`, `kadena-split`, `kadena-full`, the
  `data.kadena` namespace, the `getKadenaAccountOwner` helper, etc.) — these mirror the
  on-chain contract shape and are untouched.
- **`@stoachain/kadena-stoic-legacy` imports** (`kadenaDecrypt`, `kadenaEncrypt`,
  `legacyKadenaChangePassword`) — the legacy package keeps its name.

## The rule for everything else

Mechanical, case-preserving:

| Old            | New                |
|----------------|--------------------|
| `Kadena`       | `StoaChain`        |
| `KADENA`       | `STOACHAIN`        |
| `kadena` (identifier) | `stoaChain` |

## Notable public-API renames consumers import

**`@ancientpantheon/codex-ouronet` (+ `/types`, `/hooks`, `/connection`, `/components`):**

- `IKadenaSeed` → `IStoaChainSeed`
- `IKadenaWallet` → `IStoaChainWallet`
- `useKadenaSeeds` → `useStoaChainSeeds`
- `KadenaSeedsView` → `StoaChainSeedsView`
- `kadenaAddressValidator` → `stoaChainAddressValidator`
- `createKadenaConnection` → `createStoaChainConnection`
- `KadenaConnection` / `KadenaConnectionDescriptor` / `CreateKadenaConnectionOptions` / `KadenaSigningOptions`
  → `StoaChainConnection` / `StoaChainConnectionDescriptor` / `CreateStoaChainConnectionOptions` / `StoaChainSigningOptions`
- `KADENA_DEFAULT_NODE_URL` / `KADENA_NODE1_URL` / `KADENA_NODE2_URL` / `KADENA_CONNECTION_CHAIN_ID`
  → `STOACHAIN_DEFAULT_NODE_URL` / `STOACHAIN_NODE1_URL` / `STOACHAIN_NODE2_URL` / `STOACHAIN_CONNECTION_CHAIN_ID`
- `KADENA_CHAIN_ID` (re-export) → `STOACHAIN_CHAIN_ID`
- Components: `CreateKadenaSeedModal` → `CreateStoaChainSeedModal`, `KadenaCostDisplay` → `StoaChainCostDisplay`

**`@ancientpantheon/codex-core`:**

- `ResolvedKadenaKeypair` → `ResolvedStoaChainKeypair`
- `KadenaSeedLike` → `StoaChainSeedLike`
- `KadenaSeedType` → `StoaChainSeedType`
- `deriveKadenaKeypair` (on `HeadlessResolverDeps`) → `deriveStoaChainKeypair`

**`@ancientpantheon/codex-ui`:**

- `useKadenaSeeds` → `useStoaChainSeeds`, `StoaChainSeedsView`

## Suggested consumer-side migration

A whole-word replace of `Kadena`→`StoaChain`, `KADENA`→`STOACHAIN`, and the specific
`kadena…` identifiers above will cover almost all call sites. **Do not** touch:
`kadenaWallets` / `kadenaSeeds` (wire), the `kadena-*` on-chain data keys, or
`@stoachain/kadena-stoic-legacy` imports.
