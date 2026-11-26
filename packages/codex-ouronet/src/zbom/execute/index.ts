/**
 * `zbom/execute` — the HEADLESS transaction surface, and the engine that
 * drives it (docs/work/migration-execute/design.md).
 *
 * Until this directory existed, not one leaf operation in the migration chain
 * could be invoked without mounting a React modal and a human pressing
 * Execute. Every module here is callable with no React anywhere in the call
 * stack, and every one of them takes its chain edge as an INJECTED dependency:
 *
 *   `awaitConfirmation.ts`      the verdict-returning gate — only `"success"`
 *                               unblocks the next step; `"failure"` AND
 *                               `"pending"` both halt
 *   `chainState.ts`             design §4's predicates, read from chain
 *   `crossChainStoaTransfer.ts` A — one consolidation hop (extracted from
 *                               `SendStoaModal`, not re-implemented)
 *   `nativeStoaTransfer.ts`     B — the same-chain drain
 *   `urStoaOps.ts`              C, D, E — unstake → move → re-stake
 *   `collectUnstakeUrStoa.ts`   C — Collect THEN Unstake in ONE sponsored
 *                               transaction, so no reward dust is left on a
 *                               key the account stops naming
 *   `rotateOps.ts`              F, G — the two rotations, plus the ONE copy of
 *                               the guard signer resolution
 *   `defineKeysetOps.ts`        the keyset-ref update — `define-keyset`, the
 *                               one step here the Ouronet gas station cannot
 *                               pay for, so its gas is SELF-PAID
 *   `engine.ts`                 `runMigrationChain` — the uninterrupted loop
 *
 * This barrel is re-exported from `../index.ts`, i.e. the package's `./zbom`
 * subpath, which is the only subpath this topic ships through: no new
 * `package.json` `exports` entry is added, because
 * `tests/guard-subpath-resolution.test.ts` imports every declared subpath from
 * a built `dist/` the test environment does not produce.
 *
 * MAINNET HAZARD, restated here because this is the file a consumer reads
 * first: nothing in this directory reaches `getFailoverClient`, `pactRead`,
 * `sign` or `getKeypair` through a module-level import a test cannot displace.
 * The PRODUCTION wirings are named exactly once each and must be opted into
 * explicitly — `liveNativeStoaChainEdge`, `liveChainStateDeps`,
 * `awaitTxVerdictLiveDeps`, `liveRotatePaymentKeySubmitter`,
 * `liveRotateGuardSubmitter` — and they are assembled at the React boundary,
 * never by the engine itself. The two 2026-11-26 builders add
 * `liveCollectUnstakeChainEdge` and `liveDefineKeysetChainEdge`, which
 * DELEGATE to `liveNativeStoaChainEdge` rather than naming `getFailoverClient`
 * a second and third time: one place in this directory reaches the network.
 */

export * from "./awaitConfirmation.js";
export * from "./chainState.js";
export * from "./crossChainStoaTransfer.js";
export * from "./nativeStoaTransfer.js";
export * from "./urStoaOps.js";
export * from "./collectUnstakeUrStoa.js";
export * from "./rotateOps.js";
export * from "./defineKeysetOps.js";
export * from "./engine.js";
