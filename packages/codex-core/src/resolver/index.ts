/**
 * Resolver subpath barrel for @ancientpantheon/codex-core.
 *
 * Exposes the headless, snapshot-fed codex resolver factory + its local
 * structural types (Ouronet-free mirrors of the codex state slice and the
 * signing-ready keypair). The root barrel (`src/index.ts`) re-exports these
 * names; consumers may import from either. Core holds no real crypto — every
 * Kadena primitive is caller-injected via `HeadlessResolverDeps`.
 */

export {
  createHeadlessCodexResolver,
  type HeadlessCodexResolver,
  type HeadlessResolverDeps,
  type ResolvedKadenaKeypair,
  type SnapshotSlice,
  type KadenaSeedLike,
  type PureKeypairLike,
  type KadenaSeedType,
} from "./headlessResolver.js";
