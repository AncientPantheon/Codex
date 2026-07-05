/**
 * Adapter-local typed errors.
 *
 * `NotImplementedError` marks the transaction-signing surface that E1 does NOT
 * ship: `sign`/`post`/`buildSend` are stubbed and throw this until the RSA-PSS
 * deep-hash signer + native AR send land in E2/Phase 12. The error is a distinct
 * class so callers `instanceof`-catch the "not yet built" condition rather than
 * parsing message strings.
 *
 * SECRET-FREE BY CONSTRUCTION: the message names only the unimplemented
 * operation and its owning phase — it never accepts, embeds, or echoes any JWK
 * field, address, or key material. A funds-critical adapter must never leak
 * private material through an error path.
 */
export class NotImplementedError extends Error {
  constructor(operation: string) {
    super(
      `Arweave adapter operation "${operation}" is not implemented in E1 — the ` +
        `transaction signer lands in E2/Phase 12.`,
    );
    this.name = "NotImplementedError";
  }
}
