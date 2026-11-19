# Prime Two-Name Model — Design

## Problem

The owner sealed a codex and the Ouronet accounts list still pinned "Initial
Seed" to the top with the 🔒 Prime badge and the gold treatment, while the
settled master — "Ouronet Codex Master / AncientHodler" — sat below under
"Other standard accounts". His words:

> "the Ouronet Codex Master had to become prime and yellow instead of Initial
> Seed, and the proper designation is, by the way, **Codex Ouronet Master**.
> [...] The same would have to be done with the Arweave Seed when a new one is
> created: the one being Master Arweave Seed needs to be Master Arweave Seed,
> and the one that isn't anymore would be designated **Former Master Arweave
> Seed**. Same for Initial Seed on Ouronet Account — it was Ouronet Codex
> Master before, and would become after apply **Former Codex Ouronet Master**.
> [...] The prime account has its **golden designation** [...] as an extra
> designation field, given only to golden entities [...] apart from the normal
> name the other seeds and accounts have. This means a prime seed or account
> has **2 names**: its golden prime name, and its normal name. [...] This has
> to be properly constructed like so, because **as non-prime accounts become
> prime, their names mangle**."

Four defects, in increasing severity.

**1. The constant is wrong.** `OURONET_CODEX_MASTER` is `"Ouronet Codex
Master"`; it must read `"Codex Ouronet Master"`. Defined once
(`masterNames.ts:43`); ~35 string assertions across 12 test files follow it.

**2. Account gold and pinning are positional, not identity-based.**
`OuronetAccountsTab.tsx:1311` pins `hydratedAccounts[0]`, and `:587` paints
gold from `isFirst`. Only the *name* follows `codexMasterSeed.ouroAccountId`
(`:512`). So after a settlement that moves the master, **the gold row and the
"Codex Ouronet Master" row are different rows** — exactly the screenshot. This
is the same defect `resolveMasterArweaveSeed` fixed on the Arweave side; the
account side never got the equivalent.

**3. There is no record of a former master.** An exhaustive search finds
nothing storing a previous master account, Chainweb seed, or Arweave seed. When
the master moves, the prior holder's identity is destroyed three separate ways:
`setCodexMasterSeed` overwrites the id in place, `promoteSeedAndAccountToPrime`
sets the old `isPrime` to `false`, and `CodexIdPage.tsx:901-908` overwrites the
displaced Arweave seed's stored name. So "Former Codex Ouronet Master" and
"Former Master Arweave Seed" cannot be derived from anything that exists.

**4. Arweave seed names are being DESTROYED, not shadowed.** A user's typed
name is discarded at creation (`CodexIdPage.tsx:880`;
`ArweaveSeedsArea.tsx:1476-1478`, `:1596-1603` drop `labelText` when
`isPrime`), and the displaced holder's name is overwritten with "Arweave Seed
N" (`CodexIdPage.tsx:901-908`). There is no rename UI for Arweave seeds at all,
so the name cannot be restored. This is data loss, and it is live today —
partly shipped by this session's own demotion fix.

## Approach

**The golden designation is DERIVED from the role. It is never stored on the
entity, and it never touches the entity's own `name`.**

This is the whole fix for "names mangle". Today the role name *replaces* the
stored name at render (accounts, Chainweb seeds) or *overwrites it on disk*
(Arweave seeds). Instead:

| | source | written by |
|---|---|---|
| normal name | the entity's own `name` field | only the user |
| golden designation | computed from the master record | nobody — derived |

Stored golden names were rejected: twice this session a stored title drifted
(two seeds both named "Master ArWeave Seed"; name saying one thing while gold
and position said another). Nothing would stop two entities claiming the title,
and `CodexIdPage.tsx:903`'s existing name-string demotion predicate is already
that bug waiting to recur — the moment designations leave the `name` field it
silently matches nothing.

### What gets stored instead: the former-master ids

`CodexMasterSeed` gains former-holder ids, following the discipline of the
codebase's one existing former-role marker, `IPureKeypair.wasCodexGuard`
(`entities.ts:216-233`, which keeps retired CodexGuards "stored forever" with a
retirement-ordered label). From those ids, both "Codex Ouronet Master" and
"Former Codex Ouronet Master" are computed, and the Arweave demotion predicate
gets an **id** to match on instead of a name string.

### The designation follows the SEAL, not the finalize

The owner: *"after settlement and apply, it becomes the Prime account."*

`codexMasterSeed` is written at finalize (Write 2), is non-fatal on failure, and
is re-writable by a later finalize while unsealed. `migrationProgress.appliedAt`
is monotone and permanent — there is no un-seal. So the golden designation,
gold treatment and pinning are gated on
`isMigrationSealed(progress) && codexMasterSeed?.<field>` — one derived
predicate, in one place, consumed by every surface. A finalized-but-unapplied
codex therefore does **not** move its gold, which matches the pending/apply
model: the preview is in the wizard, the lock-in is at Apply.

### Scope: this is project scale

Decomposed into three topics, shaped and built one at a time.

## Topics

1. **`prime-designation-rename`** — `OURONET_CODEX_MASTER` becomes "Codex
   Ouronet Master"; update the ~35 test assertions and the pinned
   product-decision test. Smallest, independent, ships first.
2. **`prime-identity-display`** — a `resolveMasterOuronetAccount` mirroring
   `resolveMasterArweaveSeed`; account gold, top-pinning and the 🔒 Prime badge
   follow the sealed master identity instead of index 0; the two-name rendering
   (golden designation + normal name) extended to all four helper surfaces.
3. **`former-master-record`** — store former-holder ids on `CodexMasterSeed`;
   derive "Former Codex Ouronet Master" / "Former Master Arweave Seed"; replace
   the Arweave demotion's name-string predicate with an id match and **stop
   overwriting stored names** (the data-loss fix).

## Acceptance criteria

- [ ] The master Ouronet account reads "Codex Ouronet Master" everywhere, and
      no surface renders the old string.
- [ ] On a SEALED codex, the settled master account is pinned first, carries
      the 🔒 Prime badge and the gold treatment, and "Initial Seed" does not.
- [ ] A prime account shows BOTH its golden designation and its own stored
      name, and the stored name is never overwritten on disk.
- [ ] An account renamed before becoming prime keeps that name visible
      afterwards.
- [ ] The displaced Ouronet account reads "Former Codex Ouronet Master"; the
      displaced Arweave seed reads "Former Master Arweave Seed".
- [ ] A user-typed Arweave seed name survives the seed becoming, or ceasing to
      be, the master.
- [ ] A finalized-but-not-yet-applied codex does NOT move its gold or Prime
      badge; only Apply does.

## Out of scope

- The 14 ZBOM modals that hand-roll `accounts.indexOf(x) === 0 ?
  OURONET_CODEX_MASTER : …` and so name the wrong account after a settlement
  (`LinkDualApiKeyModal.tsx:164`, `RotateGuardModal.tsx:121`, and 12 more).
  Real bug, separate topic — logged in `backlog.md`.
- The duplicated `seedNames.ts` in `codex-ui` and `codex-ouronet`, and its
  `seed.name === "Initial Seed"` string match.
- Chainweb seed two-name rendering (`masterChainwebSeedName` has no `Parts`
  variant and no second-line consumer anywhere).
- Reserving the golden strings against user renames.
- An account that is BOTH the settled master and a CodexID APOLLO half, which
  would need three names; `primeName` currently outranks the master name
  outright (`masterNames.ts:155`).
