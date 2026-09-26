/**
 * CODEX_FORM_VERSION — the product-facing "shape of the codex" milestone
 * version, distinct from every OTHER thing already named "schema version" in
 * this codebase.
 *
 * WHY THIS IS A SEPARATE CONSTANT, NOT A REPURPOSING OF AN EXISTING ONE.
 * Owner ask (2026-09-26): "schema version reads 0, now that we settled the
 * form with foreign blockchain integration on arweave, id say lets name it
 * version 1.0.0." The "Schema Version" row the owner is looking at
 * (`codex-ouronet`'s `CodexInfoCard.tsx`) reads `useCodex().schemaVersion` —
 * which is `codex-ouronet`'s `CURRENT_SCHEMA_VERSION` (`state/migrations.ts`),
 * a plain, monotonically-incrementing INTEGER state-machine counter (0→1→2→3)
 * that the migration runner, the adapter interface (`getSchemaVersion(): number`
 * / `setSchemaVersion(v: number)`), and ~40 existing tests all compare with
 * numeric operators (`<`, `<=`, `===`). Converting THAT field to a string like
 * `"1.0.0"` would break the migration runner's own version arithmetic for no
 * functional gain — it answers "how many migrations has this snapshot been
 * through", not "what shape milestone is the product at". (There are also two
 * OTHER unrelated "schema version" fields in this codebase —
 * `ForeignKeysBlock.schemaVersion` in `codex/foreignKeys.js`'s wire format, and
 * each consumer's own `IConsumerSettings.schemaVersion` — naming collisions
 * that make "just rename the existing field" actively risky to reason about.)
 *
 * So: THIS is a new, purely additive, cosmetic constant living in codex-core
 * (the chain-agnostic root every chain module and the aggregator share) —
 * nothing about the at-rest migration counter changes. `CodexInfoCard.tsx`
 * surfaces it as a NEW "Codex Form" row, alongside (not replacing) "Schema
 * Version".
 *
 * VERSIONING POLICY GOING FORWARD (owner ask: "future shapes will only,
 * probably... need to be additive, or somehow back compatible with every
 * previous version, so as not to break past codices" — this mirrors the
 * additive-only discipline ALREADY in force on every other version axis in
 * this codebase: the codec's "1.2"/"1.3" envelope reader accepts both and
 * never narrows [`codex/codec.ts`'s own doc comment calls narrowing a
 * "funds-loss inversion"], `ForeignKeysBlock.schemaVersion` is "forward-stamp
 * only" and never refuses an older stamp, and every `CodexSnapshotBase`
 * extension field is optional/coalesced-on-read). Extending that same
 * discipline to this product-facing version:
 *
 *   MAJOR (2.0.0) — reserved for a genuinely BREAKING snapshot-shape change:
 *     an old codex export becomes literally unreadable without a migration
 *     step. Should be rare to never, by design — see MINOR below.
 *   MINOR (1.1.0, 1.2.0, …) — a new capability lands (a new chain module, a
 *     new account/key type, a new optional field on the snapshot). MUST be
 *     addable without touching how an OLDER codex reads: new fields are
 *     optional and `??`-coalesced on read, never required, exactly like
 *     `CodexSnapshotBase.foreignKeys?` already is.
 *   PATCH (1.0.1, …) — internal fixes with no shape change at all.
 *
 * 1.0.0 marks the milestone the owner is pointing at: the codex snapshot
 * shape "settled" once foreign-blockchain integration (Arweave) landed
 * alongside the native Ouronet/StoaChain side — i.e. the aggregate's current
 * two-chain-module shape is the form this version freezes as a baseline.
 */
export const CODEX_FORM_VERSION = "1.0.0" as const;
