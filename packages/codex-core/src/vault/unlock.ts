/**
 * The ABSOLUTE-window unlock model.
 *
 * When the user unlocks the codex, the CK is cached for a fixed TTL. The window
 * is ABSOLUTE, not sliding: the expiry instant is computed ONCE at unlock time
 * (`now + ttl`), and a read before expiry does NOT push it forward. This mirrors
 * the source's `expiresAt = Date.now() + ttl` construction and its
 * `!cache || cache.expiresAt <= now` lock check exactly — the expiry instant
 * itself is already locked (the boundary is closed).
 *
 * These are PURE helpers with an INJECTED clock (`now` as an epoch-ms argument):
 * no real `Date` is read here, so unlock semantics are deterministic and testable
 * without mocking time. Secrets are never logged — the cached `value` is the CK
 * and must be treated as sensitive by callers.
 */

/**
 * A cached codex password with an absolute epoch-ms expiry. `value` is the CK;
 * `expiresAt` is the instant (inclusive) at which the cache is considered locked.
 */
export interface PasswordCacheEntry {
  value: string;
  expiresAt: number;
}

/**
 * Build a password cache entry whose expiry is the ABSOLUTE instant `now + ttlMs`.
 * `ttlMs` is a duration in milliseconds and `now` is the caller-supplied epoch-ms
 * clock reading — the window never slides once set.
 */
export function makePasswordCache(
  value: string,
  ttlMs: number,
  now: number,
): PasswordCacheEntry {
  return { value, expiresAt: now + ttlMs };
}

/**
 * Report whether the cache is currently unlocked at epoch-ms `now`. A null or
 * absent cache is locked. Expiry is inclusive: at `expiresAt <= now` the cache is
 * locked (the window is absolute, so reaching the expiry instant locks it).
 */
export function isUnlocked(
  cache: PasswordCacheEntry | null,
  now: number,
): boolean {
  return cache != null && cache.expiresAt > now;
}
