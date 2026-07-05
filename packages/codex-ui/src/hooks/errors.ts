/**
 * codex-ui-LOCAL error classes for the hooks layer.
 *
 * `CodexImportError` is a plain `Error` subclass owned by this package. In
 * codex-ouronet the backup hook value-imported codex-ouronet's `CodexImportError`
 * — a REVERSE value edge that the D5 carve forbids (codex-ui must carry no value
 * Ouronet import). Consumers only ever catch import failures as an `Error` (there
 * is no `instanceof CodexImportError` check anywhere), so a local class preserves
 * the throwing contract (typed `stage`, structured message, `cause`) without the
 * cross-package value edge.
 */

/** Thrown by useCodexBackup when an import fails — JSON parse failure or a
 *  malformed backup-file shape. `stage` distinguishes the failure point. */
export class CodexImportError extends Error {
  public override readonly name = "CodexImportError";
  public readonly stage: "parse" | "shape";

  constructor(stage: "parse" | "shape", detail: string, cause?: unknown) {
    super(`Codex import failed at "${stage}" stage: ${detail}`, { cause });
    this.stage = stage;
    // Maintain the prototype chain across transpilation targets.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
