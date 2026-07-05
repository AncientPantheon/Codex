/**
 * The foreign-chain adapter registry — the dispatch surface.
 *
 * `createForeignChainRegistry()` is a FACTORY returning a fresh, INSTANCE-SCOPED
 * registry (a `Map<id, adapter>` behind `register`/`get`/`list`). There is NO
 * global mutable singleton: two registries are fully isolated, and a freshly
 * created registry is empty. This keeps the seam injectable (a consumer owns its
 * registry) and keeps tests from leaking state into each other.
 *
 * Lookup and registration both FAIL CLOSED:
 *   - `get(unknownId)` THROWS `ForeignChainError` naming the missing id, rather
 *     than returning `undefined` — a caller dispatching on an unregistered chain
 *     is committing a programmer error and must fail loudly, and the named id
 *     makes the failure diagnosable.
 *   - a DUPLICATE-id `register` THROWS `ForeignChainError` naming the id, rather
 *     than silently replacing (last-wins) — letting one chain overwrite another's
 *     live dispatch would be a hijack; failing closed forces an explicit
 *     re-registration decision and leaves the ORIGINAL adapter registered.
 *
 * No registry error ever echoes an adapter's key material — messages name the
 * chain id only.
 */

import type { ForeignChainAdapter } from "./ForeignChainAdapter.js";
import { ForeignChainError } from "./ForeignChainError.js";

/**
 * A fresh, instance-scoped foreign-chain registry. Maps `adapter.id` → adapter
 * behind `register`/`get`/`list`.
 */
export type ForeignChainRegistry = {
  /** Register an adapter under its `id`. Throws `ForeignChainError` if the id is
   *  already registered (fail-closed; the original stays registered). */
  register(adapter: ForeignChainAdapter): void;
  /** Look up an adapter by id. Throws `ForeignChainError` naming the id if it is
   *  not registered (a miss is a programmer error, not `undefined`). */
  get(id: string): ForeignChainAdapter;
  /** All registered ids. */
  list(): string[];
};

/**
 * Create a fresh, empty, instance-scoped foreign-chain registry.
 */
export function createForeignChainRegistry(): ForeignChainRegistry {
  const adapters = new Map<string, ForeignChainAdapter>();

  return {
    register(adapter: ForeignChainAdapter): void {
      if (adapters.has(adapter.id)) {
        throw new ForeignChainError(
          `Foreign chain adapter already registered for id "${adapter.id}"`,
        );
      }
      adapters.set(adapter.id, adapter);
    },

    get(id: string): ForeignChainAdapter {
      const adapter = adapters.get(id);
      if (adapter === undefined) {
        throw new ForeignChainError(
          `No foreign chain adapter registered for id "${id}"`,
        );
      }
      return adapter;
    },

    list(): string[] {
      return [...adapters.keys()];
    },
  };
}
