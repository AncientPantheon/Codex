// @ancientpantheon/codex/provider — the composed top-level CodexProvider.
//
// codex-ouronet's provider renders codex-ui's chain-generic <CodexProvider>
// wired to the Ouronet store + resolver, and re-exports codex-ui's provider
// helper hooks byte-stable. Re-exporting it here is a single source, so no name
// collisions.
export * from "@ancientpantheon/codex-ouronet/provider";
