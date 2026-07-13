// @ancientpantheon/codex/ouronet — the Ouronet (Kadena/Pact) chain module.
//
// The chain-wiring surface a consumer needs to construct + drive the Ouronet
// Codex: the concrete adapter, the connection seam (Pythia global + DirectNode),
// the double-Apollo identity derivation, the resolver + state slices, the typed
// errors, and the entity types. The React pieces of this same package are on the
// dedicated aggregator subpaths (`/provider`, `/hooks`, `/ui`) so a headless
// Ouronet consumer never pulls React through here.
//
// `rekeyCodex` (the pure, isomorphic password-rotation transform) is exported
// here so a server consumer (e.g. Mnemosyne) can `import { rekeyCodex } from
// "@ancientpantheon/codex/ouronet"` and re-key a snapshot in Node.
export * from "@ancientpantheon/codex-ouronet/rekey";
export * from "@ancientpantheon/codex-ouronet/adapters";
export * from "@ancientpantheon/codex-ouronet/connection";
export * from "@ancientpantheon/codex-ouronet/codex-identity";
export * from "@ancientpantheon/codex-ouronet/resolver";
export * from "@ancientpantheon/codex-ouronet/state";
export * from "@ancientpantheon/codex-ouronet/errors";
export * from "@ancientpantheon/codex-ouronet/types";
