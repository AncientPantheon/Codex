// @ancientpantheon/codex-ouronet/apollo-verify — the React-free Apollo-ownership
// signing surface (docs/HANDOFF-apollo-ownership-verifier.md +
// docs/HANDOFF-pythia-autonomous-connector.md).
//
// Deliberately separate from `./ui` (which additionally exports the
// React+lucide-react-coupled `ApolloVerifyView`): a headless/server consumer
// (an Automaton calling `autoSignApolloChallenge` on a repeating timer) must be
// able to import the signing primitives WITHOUT eagerly loading React. `./ui`
// keeps re-exporting the same 3 signing names too (byte-for-byte back-compat,
// N-04) — this subpath is purely additive, never a replacement.
export { signApolloOwnership, buildApolloOwnershipMessage } from "./signApolloOwnership.js";
export type { ApolloProof } from "./signApolloOwnership.js";
export { autoSignApolloChallenge } from "./autoSignApolloChallenge.js";
export type { ApolloSnapshotLike } from "./autoSignApolloChallenge.js";
