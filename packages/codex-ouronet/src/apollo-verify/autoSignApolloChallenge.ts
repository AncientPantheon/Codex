/**
 * autoSignApolloChallenge — headless, fully autonomous Apollo-ownership signing
 * for server-side Automaton consumers (docs/HANDOFF-pythia-autonomous-connector.md).
 *
 * `signApolloOwnership` (this same directory) already does the hard part —
 * re-derive the Apollo keypair from a DECRYPTED secret, verify the derived
 * address matches, sign the canonical challenge — but assumes a human has just
 * password-unlocked their Codex in a browser and handed over the plaintext
 * secret directly (`ApolloVerifyView.tsx`'s `handleSign`). This function is the
 * zero-human, zero-browser counterpart: given a Codex snapshot an Automaton
 * already holds decrypted (per the `automaton/02` master-key auto-unlock
 * standard — the master key comes from the environment, no human prompt) plus
 * its codex password, locate the requested Apollo account, `smartDecrypt` its
 * secret, and produce the same `{ apollo, sig }` proof.
 *
 * No global "current unlocked codex" state is read here — there is no such
 * singleton anywhere in this repo (every `CodexAdapter` is caller-constructed,
 * `loadAll(): Promise<TSnapshot>`). The caller supplies its own already-unlocked
 * material, exactly mirroring the pattern Pythia's own
 * `khronoton/keyResolver.ts` already uses in production for Kadena-seed
 * signing: read the sealed snapshot + machine password, `smartDecrypt` the one
 * entry that matches, throw a clear named error if it's missing rather than a
 * silent no-op.
 */

import { smartDecrypt } from "@stoachain/stoa-core/crypto";
import type { IOuroAccount } from "../types/entities.js";
import { signApolloOwnership, type ApolloProof } from "./signApolloOwnership.js";

/**
 * The minimal snapshot slice this function reads. The real `CodexSnapshot`
 * (`../adapters/types.js`) satisfies this structurally — kept minimal so a
 * caller doesn't have to construct a full snapshot just to call this.
 */
export interface ApolloSnapshotLike {
  ouroAccounts?: IOuroAccount[];
}

/**
 * Prove ownership of one Apollo account with zero human/browser involvement.
 *
 * @param snapshot       An already-decrypted Codex snapshot slice (its
 *                        `ouroAccounts` array) — the Automaton's own vault,
 *                        already unlocked per `automaton/02`.
 * @param codexPassword   The codex password that decrypts `account.secret`
 *                        (the Automaton holds this decrypted too, per the same
 *                        auto-unlock standard).
 * @param apolloAccount   The `₱.…`/`Π.…` account to prove.
 * @param nonce            The relying party's single-use challenge nonce.
 * @param rp                The relying party id (audience) — goes verbatim
 *                        into the signed message.
 * @throws {Error} If `apolloAccount` isn't present in `snapshot.ouroAccounts`
 *   — named in the message, never a silent no-op.
 * @throws Whatever `smartDecrypt` throws (`WrongPasswordError` /
 *   `CorruptEnvelopeError`) on a bad `codexPassword` or corrupt secret,
 *   unmodified.
 */
export async function autoSignApolloChallenge(
  snapshot: ApolloSnapshotLike,
  codexPassword: string,
  apolloAccount: string,
  nonce: string,
  rp: string,
): Promise<ApolloProof> {
  const accounts = Array.isArray(snapshot.ouroAccounts) ? snapshot.ouroAccounts : [];
  const account = accounts.find((a) => a.address === apolloAccount);
  if (!account) {
    throw new Error(
      `autoSignApolloChallenge: "${apolloAccount}" isn't in this Codex snapshot — ` +
        "the Automaton's operator codex must hold this Apollo account before it can " +
        "sign autonomous challenges for it.",
    );
  }
  const secretPlaintext = await smartDecrypt(account.secret, codexPassword);
  return signApolloOwnership(account, secretPlaintext, nonce, rp);
}
