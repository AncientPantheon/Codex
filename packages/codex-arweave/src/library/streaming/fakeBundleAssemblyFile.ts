/**
 * The in-memory `BundleAssemblyFile` fake (T1 of `arweave-opfs-bundle-assembly`).
 *
 * Neither Node nor jsdom has OPFS at all, so this fake is what T2's
 * incremental-assembler tests actually exercise directly — the real
 * `openOpfsBundleAssemblyFile` (`bundleAssemblyFile.ts`) is verified separately
 * (typechecked here; a real-browser run is a later task's job). It satisfies
 * the exact same seam, including the same non-sequential-write and
 * zero-fill-on-extend behavior a real `FileSystemSyncAccessHandle` gives, so a
 * test written against this fake stays true against the real impl.
 */

import type { BundleAssemblyFile } from "./bundleAssemblyFile.js";

export class FakeBundleAssemblyFile implements BundleAssemblyFile {
  #buffer = new Uint8Array(0);
  #closed = false;

  async write(offset: number, bytes: Uint8Array): Promise<void> {
    this.#requireOpen();
    const end = offset + bytes.byteLength;
    if (end > this.#buffer.byteLength) {
      // Grow in place: a fresh, larger, zero-initialized buffer with the
      // existing content copied in — matches `FileSystemSyncAccessHandle
      // .write()` zero-filling the gap when `offset` lands past the current
      // end (e.g. the reserved-but-not-yet-backfilled header region).
      const grown = new Uint8Array(end);
      grown.set(this.#buffer, 0);
      this.#buffer = grown;
    }
    this.#buffer.set(bytes, offset);
  }

  async read(offset: number, length: number): Promise<Uint8Array> {
    this.#requireOpen();
    // Always resolves a `length`-byte buffer, zero-filled for any portion
    // past the current end — the fresh `Uint8Array` is already zero, and
    // only the in-range slice (if any) gets copied over it.
    const out = new Uint8Array(length);
    const available = Math.max(
      0,
      Math.min(length, this.#buffer.byteLength - offset),
    );
    if (available > 0) {
      out.set(this.#buffer.subarray(offset, offset + available), 0);
    }
    return out;
  }

  async close(): Promise<void> {
    // Idempotent: a second call finds `#closed` already `true` and does
    // nothing further — mirrors the real impl's own idempotent `close()`.
    this.#closed = true;
  }

  #requireOpen(): void {
    if (this.#closed) {
      throw new Error("FakeBundleAssemblyFile: already closed");
    }
  }
}
