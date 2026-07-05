/**
 * The ForeignChainAdapter contract — the per-chain driver seam.
 *
 * This is a GREENFIELD injection seam (no ancestor in the ouronet-codex source):
 * a per-chain driver exposing the operations a foreign (non-Kadena) chain needs.
 * A second chain registers with ZERO change to generic code by implementing this
 * contract and registering under its own `id` (see `createForeignChainRegistry`).
 *
 * The method signatures are deliberately CHAIN-AGNOSTIC and opaque: D3 owns the
 * CONTRACT shape (which operations exist, which are required, which is optional),
 * not the concrete Arweave types. E1/Phase 11 supplies the real Arweave adapter
 * and REFINES these `unknown` param/return placeholders into concrete shapes.
 * Keeping them generic here prevents baking Arweave concepts into a package whose
 * whole purpose is to stay chain-agnostic.
 *
 * `upload?` is OPTIONAL because it is the Arweave-specific data-write operation:
 * a native-send-only chain conforms to this contract WITHOUT it, while Arweave
 * (which can persist arbitrary data) supplies it.
 */
export type ForeignChainAdapter = {
  /** Stable id this adapter registers under. Shares the string namespace with
   *  `ForeignKeyEntry.chainId`, so a foreign key resolves to its driver. */
  id: string;

  /** Create fresh key material for this chain. Returns the new key (E1 refines
   *  the concrete shape, e.g. an Arweave JWK + address). */
  generateKey(...args: unknown[]): Promise<unknown>;

  /** Import existing key material (E1 refines the input/output shapes). */
  importKey(...args: unknown[]): Promise<unknown>;

  /** Derive the chain address for a key (E1 refines the key/address shapes). */
  addressOf(...args: unknown[]): unknown;

  /** Read the on-chain balance for an address (E1 refines the shape). */
  getBalance(...args: unknown[]): Promise<unknown>;

  /** Build an unsigned transfer transaction (E1 refines the shape). */
  buildSend(...args: unknown[]): Promise<unknown>;

  /** Sign a built transaction with a key (E1 refines the shape). */
  sign(...args: unknown[]): Promise<unknown>;

  /** Broadcast a signed transaction to the chain (E1 refines the shape). */
  post(...args: unknown[]): Promise<unknown>;

  /** OPTIONAL data-write (Arweave-specific). A native-send-only chain omits it;
   *  a chain that persists arbitrary data (Arweave) supplies it. E1 refines. */
  upload?(...args: unknown[]): Promise<unknown>;
};
