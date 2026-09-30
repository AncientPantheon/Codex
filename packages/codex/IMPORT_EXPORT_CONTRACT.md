# Codex Import/Export Contract

**This is a normative contract, not a description.** Every statement below
using MUST / MUST NOT / NEVER is a hard rule for any application embedding
`@ancientpantheon/codex`. It exists because a real production incident
happened without it: a host application hand-parsed a Codex JSON export
using invented field names, silently dropped the Arweave-seed keyring
entirely, and appended duplicate pure keys on every import because it never
reset prior state before writing. None of that failed to compile or failed a
lint — it silently produced wrong data on screen. This document is the
single place that ends the guessing that caused it, for every field that
exists today and every field added in the future.

If you are integrating Codex and you find yourself about to write code that
reads or writes the JSON shape described below by hand — stop. The answer is
always "call the sanctioned function," never "parse it yourself."

## 1. The only sanctioned entry points

`useCodexBackup()`, exported from `@ancientpantheon/codex/hooks`, is the
**entire** public import/export surface. It exposes exactly four operations:

| Function | Purpose |
|---|---|
| `importFromFile(file: File): Promise<void>` | Read a `.json` backup file (e.g. from a file picker) and restore it into the mounted codex. |
| `importFromCloud(json: string): Promise<void>` | Restore a backup already available as a string (e.g. fetched from cloud storage). |
| `exportForCloud(): Promise<string>` | Produce the backup JSON string for a caller that will store or transmit it itself (SSR-safe — no `window`/`document` dependency). |
| `downloadAsJson(filename?: string): Promise<void>` | Trigger a browser file download of the current codex as JSON. Browser-only; SSR callers use `exportForCloud` instead. |

**MUST:** any feature that loads or saves a Codex JSON snapshot calls one of
these four functions. There is no fifth way.

**MUST NOT:**
- Hand-parse an uploaded/fetched JSON string against your own idea of the
  schema (`JSON.parse(text).someField`) instead of calling `importFromFile`/
  `importFromCloud`.
- Call `deserializeCodex` / `buildCodexExport` / `serializeCodex` from
  `@ancientpantheon/codex-core` directly. These are the codec `useCodexBackup`
  is built on; calling them yourself means you also own re-implementing the
  version gate, the unknown-field rejection, and the per-keyring shape
  validation described in §4 — and you will get at least one of them wrong,
  the way the incident that prompted this document did.
- Read or write a host adapter's underlying storage keys directly (e.g.
  `localStorage.getItem("wallets")`). Adapter storage layout is internal (§3)
  and is not part of any contract with a consumer.
- Invent your own top-level field names. If a name below doesn't match what
  you expected, the expectation is wrong, not the field.

If the four operations above don't cover something you need, that is a
signal to extend `useCodexBackup` itself (see §5), not to bypass it.

### The one narrow exception — and why it does not apply to you

`apps/codex-playground/src/loadCodex.ts` contains a second path,
`hydrateFromPlaintextSnapshot` (its internal "mode-2"). It constructs a fresh
in-memory adapter and calls `adapter.saveAll(rawSnapshotObject)` **before**
`<CodexProvider>` ever mounts. This exists solely so the playground's own dev
harness can pre-seed a known `CodexSnapshot` object synchronously at
app-bootstrap time, for local development and fixture-driven tests.

**This is not a production integration point.** It:
- takes an already-typed, in-memory `CodexSnapshot` object, not a JSON
  string a user uploaded — there is nothing to "parse" in the first place;
- performs no version gating, no unknown-field rejection, no per-entry shape
  validation (§4) — it trusts its input completely, which is fine for a dev
  harness feeding itself known-good fixtures and unsafe for anything else;
- is not exported from the published package at all — it lives in the
  playground app's own source, not in `@ancientpantheon/codex`.

**MUST NOT:** copy this pattern into a real consuming application. A real
application always has `<CodexProvider>` mounted with a real adapter first,
then calls `importFromFile`/`importFromCloud` to load a user-supplied JSON
file — never a bespoke pre-mount snapshot injection.

## 2. The wire schema — every field, exactly

A Codex backup is a JSON object, currently written as envelope version
`"1.3"` (older `"1.2"` files remain readable forever — see §4's
reader-before-writer rule). Every field below is the actual, current shape —
verified directly against `packages/codex-core/src/codex/types.ts`,
`codec.ts`, `foreignKeys.ts`, and `pureKeypairs.ts` while writing this
document, not recalled from memory.

| Wire field | Wire shape | Omitted when | Maps to `CodexSnapshot` field |
|---|---|---|---|
| `version` | `"1.2"` \| `"1.3"` (string, always present) | never | — (not stored; synthesized on export) |
| `exportedAt` | ISO timestamp (string, always present) | never | — (not stored) |
| `kadenaWallets` | array (always present, possibly `[]`) | never | `kadenaSeeds` |
| `ouronetWallets` | array (always present, possibly `[]`) | never | `ouroAccounts` |
| `addressBook` | array (always present, possibly `[]`) | never | `addressBook` |
| `uiSettings` | object (always present) | never | `uiSettings` |
| `foreignKeys` | **BLOCK**: `{ schemaVersion: number, keys: ForeignKeyEntry[] }` | when the codex has no foreign keys | `foreignKeys` (bare `ForeignKeyEntry[]` in memory — the block wraps/unwraps only on the wire) |
| `pureKeypairs` | **BARE ARRAY**: `PureKeypairEntry[]` | when the codex has no pure keypairs | `pureKeypairs` |
| `arweaveSeeds` | **BARE ARRAY**: `ArweaveSeedEntry[]` | when the codex has no Arweave seeds | `arweaveSeeds` |
| `watchList` | **BARE ARRAY**: `WatchListEntry[]` | when the codex has no watched addresses | `watchList` |

**The block-vs-bare-array distinction is exact and load-bearing.**
`foreignKeys` is the *only* one of the four optional keyrings wrapped in a
`{ schemaVersion, keys }` object on the wire. `pureKeypairs`, `arweaveSeeds`,
and `watchList` are each a bare array with no wrapper and no per-block
version. Treating `foreignKeys` as a bare array (or the other three as
wrapped blocks) is a shape bug, not a style choice — the codec's own
structural validator (§4) will reject the malformed shape on the sanctioned
path; a hand-rolled parser has no such protection.

### Per-entry shapes

**`ArweaveSeedEntry`** (one entry of `arweaveSeeds`):
```
{
  id: string;          // stable identifier, addresses the seed on restore
  name?: string;        // optional human label
  secret: string;        // ciphertext ONLY — encryptStringV2(bitString, codexPassword). NEVER plaintext, NEVER logged.
  createdAt: string;      // ISO timestamp
  isPrime?: boolean;     // Prime Arweave Seed marker
}
```

**`WatchListEntry`** (one entry of `watchList`):
```
{
  id: string;
  label: string;         // empty string is a valid, unlabeled entry
  address: string;        // public material — never a secret, no key is held for it
  type: "ouronet" | "stoa" | "arweave";
  createdAt: string;
}
```

**`ForeignKeyEntry`** (one entry of `foreignKeys.keys`):
```
{
  id: string;
  chainId: string;
  label?: string;
  encryptedKeyfile: string;   // ciphertext ONLY. NEVER plaintext, NEVER logged.
  seedId?: string;        // OPTIONAL seed-provenance: which Arweave seed derived this key
  index?: number;        // OPTIONAL, only meaningful WITH seedId — position within that seed's own index space
  address?: string;       // OPTIONAL plaintext address (public material) so a list can render without decrypting
}
```
Both a legacy entry (none of `seedId`/`index`/`address`) and a seeded entry
(carrying provenance) are valid, permanently — do not assume every entry has
provenance fields.

**`PureKeypairEntry`** (one entry of `pureKeypairs`):
```
{
  id: string;
  label?: string;
  publicKey: string;       // hex, public material
  encryptedPrivateKey: string; // ciphertext ONLY. NEVER plaintext, NEVER logged.
  createdAt: string;
}
```

**Every ciphertext field above (`secret`, `encryptedKeyfile`,
`encryptedPrivateKey`) MUST NEVER be logged, transmitted outside the backup
file itself, or echoed into an error message.** The codec's own validators
follow this rule (they name the offending *path*, e.g. `arweaveSeeds[0]`,
never the entry's value) — anything you write around import/export must do
the same.

## 3. What Codex owns internally — do not reimplement any of this

A consuming application never needs to know *how* any of the following work.
Reimplementing any of them is both unnecessary and a way to reintroduce the
exact class of bug this document exists to prevent.

- **Schema migrations.** `CodexSnapshot.schemaVersion` and the migration
  chain (`migrateToCurrent` / `applyMigrations` in
  `codex-ouronet/src/state/store.ts`) run automatically inside the store's
  `actions.init`, which `importFromCloud` already calls after a successful
  restore. You never call a migration function yourself, and you never need
  to know what version a given backup predates.
- **The version-accept / version-write gate.** The codec always *writes*
  the current envelope version (`"1.3"` today) and always *reads* every
  version it has ever written (`"1.2"` and `"1.3"` today — see §4's
  reader-before-writer rule). A consuming app never chooses, checks, or
  branches on the envelope version itself.
- **Unknown-top-level-field rejection.** `deserializeCodex` throws
  `CodexUnknownFieldError` if the parsed JSON contains a top-level key that
  isn't in its allow-list (§2's table, plus `version`/`exportedAt`). This is
  what makes a genuinely foreign or corrupted file fail loudly instead of
  silently partially importing — but **only when the file actually goes
  through `deserializeCodex`**, i.e. only when you use the sanctioned entry
  points from §1. A hand-rolled parser that reads `json.someWrongFieldName`
  gets no such protection; it just gets `undefined` and moves on quietly.
- **Per-entry shape validation.** Every entry in every keyring is structurally
  validated (§2's per-entry shapes) before it reaches your application code.
  You do not need to re-validate an entry's shape after `importFromCloud`
  resolves without throwing.
- **Adapter storage mechanics.** How a `CodexSnapshot` actually round-trips
  to disk/localStorage/memory is the adapter's job
  (`MemoryCodexAdapter`/`LocalStorageCodexAdapter` in
  `codex-ouronet/src/adapters/`), injected into `<CodexProvider>` once at app
  setup. Import/export code never touches adapter storage keys directly (§1).

## 4. Versioning rules

- **Reader-before-writer, always.** The reader (`deserializeCodex`) accepts
  every envelope version ever written (currently `"1.2"` and `"1.3"`). The
  writer (`buildCodexExport`) emits only the current version. **Never**
  narrow the reader to reject an older version still in the wild, and
  **never** make the writer emit a version the current reader doesn't
  accept — either one makes a real user's own backup file permanently
  unrestorable, which is a funds-loss-class regression.
- **Secret-keyring fallback-on-omission discipline.** When a backup being
  imported *omits* a keyring field entirely (e.g. a `"1.2"` file predating
  Arweave seeds), the restore must not silently wipe that keyring's *live,
  already-in-store* value to empty. `foreignKeys`, `arweaveSeeds`, and
  `watchList` all fall back to the current in-store value when the parsed
  backup omits the field (`parsed.X ?? current.X ?? []`); only an *explicit*
  (possibly empty) array present in the backup itself replaces a live
  keyring. `pureKeypairs` is the one exception, by design: it falls back to
  `[]` with no `current` fallback, because a keypair-free codex has nothing
  to lose when an older backup simply never had the concept.
- **Unknown fields are always fatal**, never silently dropped, so that an
  actually-foreign or corrupted file is caught immediately rather than
  producing a plausible-looking but wrong import.

## 5. Extension protocol — adding a new blockchain, keyring, or encryption scheme

When Codex gains a new chain, a new keyring category, or a new at-rest
encryption scheme, the following files change **together, in the same
change**. Missing one of these is exactly how the earlier
`StoaChainSeedType`/`SeedType` drift bug happened this same session on a
different type, and exactly the shape of bug this document exists to end:

1. **`packages/codex-core/src/codex/types.ts`** — add the new field to
   `PlaintextCodex` (the in-memory generic source) and to `CodexExportV1_3`
   (the wire envelope), following the existing doc-comment discipline: state
   explicitly whether it's a block or a bare array, and whether it's
   OPTIONAL (so older consumers still compile).
2. **`packages/codex-core/src/codex/codec.ts`** — add the field name to
   `KNOWN_TOP_LEVEL_FIELDS` (or it will be rejected as unknown), add a
   structural shape validator mirroring `validateArweaveSeeds`/
   `validatePureKeypairs`/`validateForeignKeysBlock`, and add the
   emit-only-when-non-empty branch to `buildCodexExport`.
3. **`packages/codex-ui/src/hooks/useCodexBackup.ts`** — thread the new field
   through `buildSnapshotFromState` (read from live store state),
   `buildBackupPayload` (write into the codec source), and `importFromCloud`'s
   `next: CodexSnapshot` merge (decide, explicitly, whether this new keyring
   gets the secret-fallback-on-omission discipline from §4 or the
   `pureKeypairs`-style plain `?? []` — write down which and why, the same
   way this document does for every existing field).
4. **`packages/codex-ouronet/src/adapters/types.ts`** — add the field to the
   `CodexSnapshot` interface itself.
5. **`packages/codex-ouronet/src/state/store.ts`** — if the new field changes
   what a *migrated* codex must look like, add the migration step to the
   chain the same way existing fields' migrations are threaded through
   `migrateToCurrent`.
6. **This document** — add a row to §2's table, a per-entry shape block if
   the new field carries entries, and update §4 if the new field's
   fallback-on-omission behavior differs from the existing pattern.

A change that touches only some of these files is incomplete, even if it
compiles and its own unit tests pass — the earlier incident on
`StoaChainSeedType` compiled fine and passed its own tests too; it broke a
different consumer entirely, silently, at a distance.
