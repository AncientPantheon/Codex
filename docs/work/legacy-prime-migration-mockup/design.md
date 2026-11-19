# Legacy Prime Migration Mockup Mode — Design

Sibling to `legacy-prime-migration-wizard/design.md` (sub-topic 3), modeled
directly on the already-shipped `arweave-upload-dry-run` project — same
pattern, same discipline, applied to the StoaChain/Kadena domain instead of
Arweave. Read both of those first; this document only covers what's
different.

## Problem

Owner's explicit ask: the ability to click through the ENTIRE migration
wizard — real account selection, real balance reads, real decisions — on a
REAL codex, and see exactly which transactions it would construct and
submit, without any of them actually happening and without the codex's own
local state (which account is Prime, which seeds exist) being touched
either. The stakes here are higher than the upload dry-run's (that risked
wasted AR; this risks real on-chain funds and an irreversible lock-in), so
the same category of safety net is even more clearly warranted, not less.

## Grounding

**One seam covers the entire on-chain surface this wizard needs.**
Confirmed directly against the real dependency source, not assumed:
`@stoachain/stoa-core/network`'s `getFailoverClient(chainId)` — returning
`{dirtyRead, submit, listen, pollOne}` — is the one underlying client every
relevant `@ouronet/ouronet-core` interaction function calls through:
`activateFunctions.js` (account activation — Page 2's "type new words"
path), `urStoaFunctions.js`/`ouroUrStoaFunctions.js` (unstake/collect/
restake — the sweep), `crossChainFunctions.js` (native STOA cross-chain
aggregation — the sweep), `guardFunctions.js`/`ouroRotateFunctions.js`
(rotate payment/guard key — Page 3's "define new keys" path). A single
local, no-op stand-in for `{dirtyRead, submit}`, injected in place of the
real `getFailoverClient`, intercepts every one of these — mirroring
`arweave-upload-dry-run`'s own "implement the real interface contract at
the lowest network boundary" strategy exactly, not inventing a new
technique.

**`promoteSeedAndAccountToPrime` (`stoachain-prime-promotion`) is pure
local state — already zero-risk on its own terms**, per that sub-topic's
own design. But a TRUE "nothing happens" mockup run still must not
actually call it against the real store, for the same reason the upload
dry run "never calls `store.append`" even though a Library entry isn't
itself dangerous — a mockup run that quietly changes which account is
Prime would not be a mockup.

## Approach

### A shippable local no-op chain client (new production code, mirrors `localDryRunGateway.ts`)

`packages/codex-ouronet/src/mockup/localDryRunChainClient.ts` (naming/
location TBD at build time — state the real final choice when built):
a `createLocalDryRunFailoverClient()` implementing the SAME `{dirtyRead,
submit}` shape `getFailoverClient` returns. `dirtyRead` runs the REAL
simulation logic structurally (so a genuinely malformed transaction still
reports a realistic simulation failure, exactly like a real `dirtyRead`
would) but against no real node. `submit` never touches the network —
returns a synthetic-but-realistic `requestKey`, recorded in an in-memory
log keyed by the action that produced it. Zero `fetch`/real-client calls
anywhere in this module, by construction, same as the Arweave dry-run
gateway's own guarantee.

### A parallel, ephemeral local-state scratch layer

The wizard's own Page 7 (finalize) calls three real store actions:
`promoteSeedAndAccountToPrime`, `addArweaveSeed`, and the new
`primeAlignment` stamp. In mockup mode, these are NOT called against the
real codex store — instead, the SAME wizard page components receive an
injected, in-memory scratch copy of just the fields they read/write
(current Prime seed/account, the seeds/accounts collections, the
`primeAlignment` value), seeded from the real store's CURRENT values at
mockup-session start, mutated only in that scratch copy. This lets every
page's own logic (which account is "currently Prime," whether a candidate
already exists, etc.) run completely unchanged and genuinely exercised —
the real store is never touched, and the scratch copy is discarded when
the mockup session ends.

### The mockup engine

`runMigrationMockup(choices, opts) → Promise<MigrationMockupResult>` —
drives the SAME page-by-page decision sequence a real wizard run would
(the choices the user made on Pages 2/3), with the local no-op chain
client and the scratch state layer both injected, and:

1. Runs the SAME construction/signing code every real path uses — account
   activation, key derivation, sweep transaction building, prime
   promotion, Arweave seed creation — against the injected fakes above.
2. Records every transaction that WOULD have been submitted: its real
   Pact code, its real signer set, its real capability list — exactly
   what a real `submit` call would have received, captured before the
   fake intercepts it.
3. Records every local-state change that WOULD have been made (old Prime
   → new Prime, which seed/account, the Arweave seed(s) that would be
   created, the `primeAlignment` value before/after).
4. Returns a plain, readable result mirroring the upload dry run's own
   `DryRunResult` shape: `{ success, transactionsSimulated: [{ label,
   pactCode, signers }], stateChanges: {...}, errors: string[] }` — a
   non-engineer can read this as "here is everything that would have
   happened."

### The UI entry point

A second button alongside the real "Start Migration" entry on the Codex
ID page (or Page 1 of the wizard itself) — matching the upload dry run's
own established convention of a clearly-labeled SEPARATE button, not a
mode toggle buried in settings: **"Test This Migration (mockup — nothing
is submitted or saved)"**. Runs the exact same Page 1→7 flow, same
choices, same screens — only Page 4's "confirm and proceed" and Page 5's
execution checklist operate against the mockup engine instead of the
real one, and Page 7 shows the recorded state changes instead of applying
them. A dedicated result summary at the end, separate from the real
wizard's own completion state, so a mockup run can never be confused with
a real completed migration.

## Acceptance criteria

- [ ] Running the mockup against a real codex's real account/seed
      selections produces a transaction list and state-change report that
      a real run with the same choices would actually need — verified by
      comparing the mockup's captured Pact code/signers against what the
      real (not-yet-built) sweep engine constructs for the same inputs,
      once that engine exists.
- [ ] No real network request to any StoaChain/Kadena node occurs during a
      mockup run — verified structurally (a spy on the real client
      asserting zero calls), across the full Page 1→7 flow.
- [ ] No real store mutation (`promoteSeedAndAccountToPrime`,
      `addArweaveSeed`, the `primeAlignment` stamp) occurs during a
      mockup run — verified directly against the real store's state
      before/after.
- [ ] A deliberately-broken input (e.g. insufficient balance for the
      sweep, or the vault-floor condition) makes the mockup report that
      failure clearly, not a false pass.
- [ ] The mockup button and the real "Start Migration" button are
      visually and behaviorally distinct enough that a user cannot
      mistake one for the other.

## Out of scope

- Changing how the real wizard/sweep engine behaves — this only adds a
  parallel, safe way to exercise the same logic.
- A general-purpose StoaChain mock client for other features beyond what
  this wizard's mockup mode itself needs.

## Sequencing note (owner-suggested, 2026-10-13)

Building this ALONGSIDE the wizard UI (sub-topic 3) — both before the
real fund-moving engine (sub-topic 2) — lets the owner verify the ENTIRE
migration flow's logic and UX end-to-end, with zero real-fund risk,
before `stoachain-migration-sweep` needs to exist at all. By the time
sub-topic 2 is built, it only needs to slot in as the real execution
backend behind an already-proven wizard flow — exactly how the real
Arweave gateway slots in alongside the already-proven local dry-run
gateway for uploads. This likely lowers the bar for giving go-ahead on
sub-topic 2, since the wizard's own correctness will already be settled
by then.
