# Arweave Streaming Post Core — Design

Sub-topic 1 of `docs/work/arweave-streaming-post/design.md` (read in
full for the complete grounding — the real `arweave-js` source findings
on `getChunk`/`TransactionUploader`/`prepareChunks` that this scope
builds on are documented there, not repeated here). Proves the
streaming-post mechanism works end to end for an uninterrupted upload;
resumability and the full real-browser verification are sub-topic 2.

## Scope

1. Extend Topic 1's `computeStreamingDataRoot` (`packages/arweave-core/
   src/upload/streaming/computeStreamingDataRoot.ts`, already built) to
   also return `proofs: Proof[]`, by calling `arweave-js`'s real
   `generateProofs` on the tree it already builds internally.
2. A per-chunk POST-body builder that reads ONLY one chunk's bytes via
   `BundleAssemblyFile.read(offset, length)` (Topic 2, already built)
   instead of slicing a full in-memory buffer — same body shape
   `Transaction.getChunk(idx, data)` already produces.
3. Transaction creation supplied the already-known `data_root`/
   `data_size`/`chunks`/`proofs` directly (ground the exact
   `createTransaction` mechanics against the real source — confirm
   whether its options accept pre-computed chunks or whether
   `Transaction.chunks`/`.data_root` must be set directly, bypassing its
   internal `prepareChunks(data)`) and the streaming post loop itself,
   reusing `postArweaveData`'s existing retry-in-place/pool-execute
   conventions (`packages/arweave-core/src/upload/nativeUpload.ts`).

## Acceptance criteria

- [ ] The extended `proofs` output is byte-identical to `arweave-js`'s
      own `generateTransactionChunks`'s `proofs` field for the same
      fixtures Topic 1's own tests already use.
- [ ] A streamed post of a real multi-chunk bundle sends a
      byte-identical sequence of per-chunk POST bodies to what the
      stock `TransactionUploader` would have sent for the same bundle.
- [ ] At no point does the implementation hold more than one chunk's
      bytes in memory at once — proven structurally.
- [ ] The resulting signed transaction's `id`/`data_root` match what
      signing the SAME bundle via the existing non-streaming
      `postArweaveData` path would produce, for the same input and key
      — proving the streaming path produces a protocol-identical
      transaction, not just "a" transaction.

## Out of scope

- Resumability, persisted progress state (sub-topic 2).
- The full real-browser, real-gateway end-to-end smoke test (sub-topic
  2) — this sub-topic's own verification is unit-level/comparison-based.
- Everything in the parent topic's own "Out of scope" section.
