/**
 * createHeadlessKadenaResolver — a pre-bound, server-safe Kadena `KeyResolver`
 * for headless Khronoton consumers (Pythia, Mnemosyne, …).
 *
 * The counterpart to the browser `InternalCodexResolver`: same ONE canonical
 * derivation path (codex-core's `createHeadlessCodexResolver`, seedType-complete
 * across koala / chainweaver / eckowallet / pure-foreign, with the wrong-key
 * refusal guard), same real `@stoachain` crypto binding (`HEADLESS` from
 * `headlessKadenaDeps.ts`) — but with ZERO browser coupling and, crucially, the
 * consumer binds NO `@stoachain` crypto itself.
 *
 * A consumer supplies only two thunks:
 *   - `loadSnapshot()` — its already-decrypted codex snapshot slice, re-read
 *     FRESH each call (fire-time). Mirrors how an automaton re-reads its sealed
 *     operator codex per Khronoton tick, so a codex edit is picked up next fire
 *     and plaintext key material never outlives the call.
 *   - `getPassword()` — the server-held machine password (auto-unlocked per the
 *     `automaton/02` master-key standard), read per call.
 *
 * The returned object satisfies `@stoachain/stoa-core/signing`'s `KeyResolver`
 * (`{ getKeyPairByPublicKey(pub), listCodexPubs() }`) and drops straight into the
 * Khronoton engine's `KeyResolver` seam. `requestForeignKey` is intentionally
 * OMITTED — per the `KeyResolver` contract, a server resolver that omits it gets
 * the strategy's fail-fast-on-first-foreign-key-need behaviour, correct for a
 * headless automaton with no user to prompt.
 *
 * SERVER-SAFE: this module and its entire import graph pull no React/DOM/zustand
 * — only `@stoachain/*` + codex-core (via `headlessKadenaDeps.ts`). Importing it
 * through `@ancientpantheon/codex/ouronet` loads headless in a plain Node process.
 *
 * See `HANDOFF-codex-headless-kadena-resolver.md` (Topic 1 of the Khronoton
 * keyresolver-delegation design).
 */

import type { KeyResolver, IKadenaKeypair as IStoaChainKeypair } from "@stoachain/stoa-core/signing";
import type {
  SnapshotSlice,
  StoaChainSeedLike,
  PureKeypairLike,
  ResolvedStoaChainKeypair,
} from "@ancientpantheon/codex-core";

import { HEADLESS, remapCoreKeyMissing } from "./headlessKadenaDeps.js";

export interface HeadlessKadenaResolverOptions {
  /**
   * The consumer's already-decrypted codex snapshot slice — its `kadenaSeeds`
   * and `pureKeypairs`. Re-read FRESH each call (fire-time), never cached by the
   * resolver. A full `CodexSnapshot` is structurally assignable (only the two
   * arrays are read); missing arrays are treated as empty.
   */
  loadSnapshot: () => SnapshotSlice | Promise<SnapshotSlice>;
  /**
   * The codex machine password that decrypts the snapshot's secrets — server-
   * held and auto-unlocked (per `automaton/02`), read per call. Never retained.
   */
  getPassword: () => string | Promise<string>;
}

/** Normalize a caller-fed snapshot to the exact slice the factory reads,
 *  tolerating a broader `CodexSnapshot` or a partial one (missing arrays → []). */
function toSlice(snapshot: SnapshotSlice): SnapshotSlice {
  return {
    kadenaSeeds: (snapshot.kadenaSeeds ?? []) as StoaChainSeedLike[],
    pureKeypairs: (snapshot.pureKeypairs ?? []) as PureKeypairLike[],
  };
}

/**
 * Build a headless Kadena `KeyResolver` bound to the real `@stoachain` crypto.
 * The consumer binds no derivation — it lives once in Codex.
 */
export function createHeadlessKadenaResolver(
  opts: HeadlessKadenaResolverOptions,
): KeyResolver {
  return {
    async listCodexPubs(): Promise<Set<string>> {
      const slice = toSlice(await opts.loadSnapshot());
      return HEADLESS.listCodexPubs(slice);
    },

    async getKeyPairByPublicKey(publicKey: string): Promise<IStoaChainKeypair> {
      // Fire-time: re-read both the snapshot and the password per call, never
      // cached — a codex edit between calls is picked up on the next resolution.
      const [snapshot, password] = await Promise.all([
        Promise.resolve(opts.loadSnapshot()),
        Promise.resolve(opts.getPassword()),
      ]);

      let resolved: ResolvedStoaChainKeypair;
      try {
        resolved = await HEADLESS.getKeyPairByPublicKey(toSlice(snapshot), publicKey, password);
      } catch (e) {
        // Re-throw core's CodexKeyMissingError as the ouronet-side class (same
        // structured counts); any other error passes through unchanged.
        remapCoreKeyMissing(e);
      }

      // Wrong-key refusal guard. Core's derived-account branch finds the seed
      // account by its RECORDED pubkey, then re-derives from the mnemonic and
      // returns the DERIVED pubkey — it does not itself assert the two agree. If a
      // codex is corrupt or a seed's `seedType` tag is wrong, the mnemonic can
      // derive a DIFFERENT key at the recorded index than the one requested; the
      // original hand-rolled consumer resolvers refused to sign in exactly that
      // case ("derived a different key than the codex recorded"). Delegation must
      // keep that refusal — signing under a pubkey the caller didn't ask for is a
      // funds-safety hazard, not a convenience. (The pure-keypair branch returns
      // the requested pubkey verbatim, so this only ever fires on a genuine
      // seed-derivation mismatch.) Secret-free message — names only public data.
      if (resolved.publicKey !== publicKey) {
        throw new Error(
          `createHeadlessKadenaResolver: the codex derived a different public key ` +
            `(${resolved.publicKey}) than the one requested (${publicKey}) — refusing to ` +
            `sign. The codex entry has drifted (corruption or a wrong seedType tag).`,
        );
      }

      // Compile-time assignability proof (same obligation as InternalCodexResolver):
      // the factory's structural `ResolvedStoaChainKeypair` must be assignable to the
      // real `@stoachain` `IKadenaKeypair` with no cast — a drift (truncated seedType
      // union, string-coerced encryptedSecretKey) fails `tsc` before it reaches the signer.
      const asContract: IStoaChainKeypair = resolved;
      return asContract;
    },
  };
}
