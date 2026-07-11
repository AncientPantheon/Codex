// @ancientpantheon/codex — the aggregate ROOT surface.
//
// The chain-agnostic base: the codec, the plaintext/encrypted Codex model, the
// generic adapter/snapshot + foreign-chain-adapter contracts, the vault/crypto
// seam, and the headless resolver factory. Everything re-exported here is
// React-free and chain-free, so a headless consumer can
// `import { … } from "@ancientpantheon/codex"` without pulling in React or any
// single chain's value edge.
//
// The React surface + the per-chain modules live on the dedicated subpaths:
//   @ancientpantheon/codex/provider   — the composed CodexProvider
//   @ancientpantheon/codex/hooks      — the React hooks
//   @ancientpantheon/codex/ui         — the full UI (tabs, settings, cards)
//   @ancientpantheon/codex/ouronet    — the Ouronet (Kadena/Pact) chain module
//   @ancientpantheon/codex/arweave    — the Arweave chain module
export * from "@ancientpantheon/codex-core";
