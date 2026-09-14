# Handoff — wiring @ouronet/dalos-crypto's RSA-4096 module into Codex's Arweave path

**Scope: CRYPTOGRAPHY WIRING ONLY.** UI construction (panels, flows, buttons) is
being handled separately, in stages, directly with the project owner — this
handoff does not propose or build any UI. It exists so you know exactly where
the Arweave code and the DALOS_Crypto cryptography live, and exactly what needs
to connect to what.

**Created:** 2026-09-12, from a direct code investigation of this repo
(`AncientPantheon/constructors/Codex/`) done specifically to answer this
question — every claim below traces to an actual file read this session, not
memory or assumption.

---

## 0. The one fact that changes everything: today's Arweave key generation is NOT seeded

`packages/arweave-core/src/keys/generate.ts`'s `generateKey()` is deliberate,
documented, structural randomness — raw WebCrypto `crypto.subtle.generateKey()`,
no seed parameter exists anywhere in its signature. Its own header comment says
this outright: *"non-determinism is a structural property of this function, not
a runtime option."* This is completely disconnected from DALOS_Crypto — grep
confirms ZERO references to `dalos-crypto` anywhere in `arweave-core` or
`codex-arweave`. Every DALOS_Crypto usage in the whole Codex monorepo is
isolated to `codex-ouronet` (Apollo/Kadena identity only).

**This is the actual work**: adding a NEW seeded generation path alongside (or
replacing) `generateKey()`, wired to `@ouronet/dalos-crypto/rsa4096`. Nothing
downstream (signing, sending, uploading, address derivation) needs to change —
`sendTransfer`, `uploadData`, `signTransaction`, `address.ts` all already work
with any valid RSA-4096 JWK regardless of how it was generated.

---

## 1. Blocking prerequisite: bump @ouronet/dalos-crypto before anything else

The monorepo has `@ouronet/dalos-crypto@4.0.4` installed (peer dep `>=4.0.0` in
`packages/codex-ouronet/package.json` and `packages/codex/package.json`). **That
version has no `/rsa4096` subpath at all** — it doesn't exist yet in 4.0.4; it
shipped later. You need `^4.4.0` (current published version, real, live on npm,
verified this session) to get the RSA4096 module, including the multi-address
indexed/batch/ranges generation described below.

**Action:** bump the peer/dev dependency in `codex-ouronet/package.json` and
`codex/package.json` to `^4.4.0`, reinstall, confirm
`node_modules/@ouronet/dalos-crypto/package.json` resolves to `4.4.0`+ and that
a `./dist/rsa4096/` directory now exists.

---

## 2. The exact RSA4096 API surface (from @ouronet/dalos-crypto/rsa4096)

```ts
import {
  generateFromBitString, generateFromBitStringAsync,     // one seed -> one Arweave address (position 0)
  generateFromBitStringAtIndex, generateFromBitStringAtIndexAsync,   // one seed -> address at any index, direct access
  generateBatchFromBitString, generateBatchFromBitStringAsync,       // one seed -> a contiguous range [start, start+count-1]
  generateFromBitStringAtRanges, generateFromBitStringAtRangesAsync, // one seed -> an arbitrary LIST of ranges, index 0 always included
  toJWK, addressOf, selfCheckTextbookRSA,
  ALLOWED_SEED_BIT_STRING_LENGTHS,   // exactly [1024, 1600] -- nothing else accepted
} from "@ouronet/dalos-crypto/rsa4096";
```

Every generation function takes a raw **bitstring** (exactly 1024 or 1600 chars
of `'0'`/`'1'`), not seed words directly — see §3 for the bridge. Every function
has an `Async` sibling that yields to the event loop every 8 candidate draws
(generation takes low-single-digit seconds — the Async variants are what let a
UI progress bar actually repaint; use them, not the sync versions, anywhere near
UI code). `generateFromBitStringAtIndex`'s `index === 0` is structurally
guaranteed byte-identical to `generateFromBitString` forever — that's the
"default" address. Progress callbacks (`ProgressEvent`/`BatchProgressEvent`)
give `{stage, attempts, overallProgress}` for a real, honest (geometric-CDF-based)
progress bar, not a fake animation.

For "generate N positions" style UI (default / custom position / up-to /
skipping-intervals — whatever the UI design lands on), **all four modes reduce
to constructing one `ranges` array and calling `generateFromBitStringAtRangesAsync`
once**:

```ts
// default:        ranges = []                        -> just [0]
// custom position: ranges = [{start: P, end: P}]      -> [0, P]
// up to N:         ranges = [{start: 0, end: N}]       -> [0..N]
// skip intervals:  ranges = [...userAddedRanges]        -> deduplicated union, sorted, 0 always included
```

---

## 3. The missing bridge: seed words -> bitstring (RSA4096 does NOT do this step)

RSA4096 only accepts an already-derived bitstring. Converting the user's actual
typed seed words into that bitstring is a `/gen1` (or `/historical` for Apollo)
concern:

```ts
import { seedWordsToBitString, DALOS_ELLIPSE } from "@ouronet/dalos-crypto/gen1";
import { APOLLO } from "@ouronet/dalos-crypto/historical";

const bits1600 = seedWordsToBitString(words);          // DALOS, default param
const bits1024 = seedWordsToBitString(words, APOLLO);  // Apollo, explicit curve param
```

This is the SAME function, and the SAME raw bitstring shape, that
`codex-ouronet`'s Apollo/Kadena identity derivation consumes before its own
EC-specific clamping — **but `codex-ouronet`'s `deriveDoubleApollo` does NOT
export or expose that raw bitstring for reuse** (confirmed by reading its
source directly — it only returns already-Apollo-shaped output). So the new
Arweave module cannot pull the bitstring out of the existing Apollo derivation;
it needs to derive it independently, directly from the same raw seed-words
input the user already typed (which the UI/vault layer holds), by calling
`seedWordsToBitString` itself.

**Decide (product call, not a crypto call): does Codex's Arweave identity
derive from the DALOS 1600-bit seed (the user's primary Ouronet identity) or
the Apollo 1024-bit seed?** Either is a fully valid, already-supported input —
this is a product/UX decision for whoever's designing the flow, not a
cryptography constraint. Recommend defaulting to DALOS (1600-bit) since that's
the seed backing the user's actual primary identity, matching the framing
"one seed, the format everyone already uses" — but that's a recommendation,
not a requirement.

---

## 4. Where to actually put the new code

Natural landing spot: `packages/arweave-core/src/keys/derivation.ts` **already
exists as a deliberate, currently-nonfunctional extension point** —
`generateFromMnemonic(mnemonic, flags)` and `deriveFromEthereumSignature(...)`,
both flag-gated off by default, both unconditionally reject with "NOT
implemented." This is clearly where the Codex team already anticipated seeded
generation would eventually go. Two options, both reasonable, worth a quick
team decision:

- **(a)** implement real logic inside `generateFromMnemonic` itself (naming
  caveat: DALOS's seed-word contract isn't BIP39 "mnemonic" — it's DALOS's own
  closed 256-glyph alphabet, 1-256 words — so the name may be misleading for
  what actually gets implemented), or
- **(b)** leave the mnemonic/ethereum stubs alone and add a new,
  accurately-named function/module (e.g. `generateFromDalosSeed`) alongside
  them.

Either way, the new function's job is exactly: take seed words (or an
already-derived bitstring) + optional index/range params, call
`seedWordsToBitString` (§3) then the appropriate `rsa4096` generator (§2),
return the resulting JWK(s) in the same `ArweaveJwk` shape `generate.ts`
already produces — so `codex-arweave`'s `foreignKeys.ts` (`generateArweaveKey()`)
can call the new seeded function exactly where it currently calls `generateKey()`,
with no changes needed to the vault/keyring encryption layer downstream.

---

## 5. Testing this locally before any UI work touches it

DALOS_Crypto's own repo ships frozen, cross-language test-vector corpora
(`testvectors/v2_rsa4096.json`, `testvectors/v3_rsa4096_indexed.json`) — real
seed→address pairs already proven byte-identical between Go and TypeScript.
Once the bridge function above exists, write a unit test that feeds one of
those corpus vectors' `input_bitstring` through your new function and asserts
the output address matches the corpus's `address` field exactly. That's a
real, independent correctness check before any UI ever calls this code.

---

## 6. Explicitly out of scope for this handoff

- Any UI component, panel, or flow — being handled separately, in stages.
- Signing/sending/uploading logic — already complete and correct in
  `arweave-core` (`sendTransfer`, `uploadData`, `signTransaction`), untouched
  by this work.
- Pythia, Mnemosyne, Caduceus's own Arweave wiring — separate handoffs, same
  underlying `arweave-core` package, different consumption pattern (headless,
  no UI) — ask if you need that context too.

---

## 7. Addendum — the "Create new key" button in codex-playground is a known, documented stub

If you're looking at `apps/codex-playground`'s "Foreign chains" panel (mock/real
toggle, Keyring/Balance/Send/Upload/Library tabs): that app is explicitly
self-described in its own README as "Private, unpublished, dev-only," with a
code comment noting "the foreign-chain UX itself is a later pass." It is
scaffolding the team already knows is incomplete, not a partially-wired real
feature.

**Neither mode generates a real key today.** Traced `KeyringArea.handleCreate`
-> `keygenRunner.runKeygen()` + `generateArweaveKey()` in both adapters:

- **Mock mode** (`mockArweaveAdapter.ts`): returns a hardcoded, discarded,
  all-empty-fields fake JWK. `addForeignKey` is a no-op. Nothing persists.
- **Real mode** (`realArweaveAdapter.ts`): **always throws**, by design — their
  own comment: *"Keygen-in-the-playground is unsupported (main-thread)... the
  real toggle's supported affordance is IMPORTING a key via a keyfile, not
  generating one in the browser."*

**Why this matters for us specifically**: their stated reason for punting on
real-mode keygen is that it's CPU-blocking main-thread work — exactly the
concern that applies to RSA-4096 generation (random OR seeded), which takes
low-single-digit seconds of synchronous prime search. The `Async` variants in
`@ouronet/dalos-crypto/rsa4096` (§2 above) yield every 8 candidate draws, which
helps a progress bar repaint, but that is NOT the same as running in a Web
Worker — the main thread still does the work, just with yield points. If real
in-browser keygen is wanted (as opposed to import-only, which is what this
devtool currently supports), a Worker-based keygen runner is probably needed —
that's a separate, real piece of work the DALOS_Crypto library itself doesn't
solve for you.

**What this means for scope, concretely**: do NOT treat "get the playground's
Create-new-key button working" as the integration target for this task — it's
explicitly out-of-scope stub UI in the team's own docs, in a private devtool
that's never published. The actual target is exactly what §4-5 above already
describe: a correct, tested, standalone seeded-generation function in
`arweave-core`/`codex-arweave`, verified against DALOS_Crypto's own frozen test
vectors directly (§5) — independent of whether any particular devtool's UI
button currently calls it. Wiring a REAL (worker-based, most likely) keygen
UI — in this devtool, in OuronetUI, or somewhere else — is a distinct, later
piece of work once the underlying function exists and is proven correct.
