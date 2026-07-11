// @ancientpantheon/codex/arweave — the Arweave chain module.
//
// The codex-arweave root barrel already aggregates the adapter, address-book
// (ARWEAVE_CHAIN_ID + entities), keyring, and library. Add the connection seam
// (injectable endpoints) and the React panel (the Foreign-Chains Arweave UI) so
// a consumer gets the whole Arweave module from one subpath.
export * from "@ancientpantheon/codex-arweave";
export * from "@ancientpantheon/codex-arweave/connection";
export * from "@ancientpantheon/codex-arweave/panel";
