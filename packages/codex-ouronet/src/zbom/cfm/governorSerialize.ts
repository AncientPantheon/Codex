/**
 * Governor guard serializer — reverse-renders a resolved on-chain governor
 * object (the shapes GuardTree handles) back into editable Pact source so the
 * Rotate-Governor flow can pre-fill NonKeyGuardEntryInput with the exact
 * current governor.
 *
 * Lives in its own (component-free) module so the Pact-string formatting is
 * shared between inputs.tsx and the modal without tripping React Fast Refresh.
 */

import type { NonKeyGuardConstructor } from "@ouronet/ouronet-core/pact";
import { detectGuardKind } from "../../ui/internal/GuardTree.js";
import type { UserGuard, CapabilityGuard, KeysetGuard, KeysetRefGuard } from "../../ui/internal/GuardTree.js";

/** Pact decimal wrapper `{ decimal: "1.2" }`. */
const isDecimalBox = (v: unknown): v is { decimal: string } =>
  typeof v === "object" && v !== null && !Array.isArray(v) &&
  "decimal" in v && typeof (v as Record<string, unknown>).decimal === "string" &&
  Object.keys(v).length === 1;

/** Pact integer wrapper `{ int: "12" }`. */
const isIntBox = (v: unknown): v is { int: string } =>
  typeof v === "object" && v !== null && !Array.isArray(v) &&
  "int" in v && typeof (v as Record<string, unknown>).int === "string" &&
  Object.keys(v).length === 1;

const MAX_ONELINE = 72;

/**
 * Lay out `(head c1 c2 …)` — one line when short, else head on the opening
 * line, args indented one level, and the closing `)` on its own line aligned
 * under the opening `(` (block style):
 *
 *   (head
 *     arg1
 *     arg2
 *   )
 */
function applyStr(head: string, childStrs: string[], ind: number): string {
  if (childStrs.length === 0) return `(${head})`;
  const oneLine = `(${head} ${childStrs.join(" ")})`;
  if (!oneLine.includes("\n") && oneLine.length <= MAX_ONELINE) return oneLine;
  const pad = "  ".repeat(ind + 1);
  return `(${head}\n${childStrs.map((c) => pad + c).join("\n")}\n${"  ".repeat(ind)})`;
}

/** Lay out a Pact list `[ i1 i2 … ]` (space-separated, commas optional). */
function bracketStr(childStrs: string[], ind: number): string {
  if (childStrs.length === 0) return "[]";
  const oneLine = `[ ${childStrs.join(" ")} ]`;
  if (!oneLine.includes("\n") && oneLine.length <= MAX_ONELINE) return oneLine;
  const pad = "  ".repeat(ind + 1);
  return `[\n${childStrs.map((c) => pad + c).join("\n")}\n${"  ".repeat(ind)}]`;
}

/** A guard VALUE (nested inside args) → its full `(create-* …)` constructor form. */
function serGuard(guard: unknown, ind: number): string {
  const kind = detectGuardKind(guard);
  if (kind === "user") {
    const g = guard as UserGuard;
    const args = Array.isArray(g.args) ? g.args : [];
    const inner = applyStr(g.fun, args.map((a) => serValue(a, ind + 1)), ind + 1);
    return applyStr("create-user-guard", [inner], ind);
  }
  if (kind === "capability") {
    const g = guard as CapabilityGuard;
    const args = Array.isArray(g.cgArgs) ? g.cgArgs : [];
    const ctor: NonKeyGuardConstructor =
      g.cgPactId != null ? "create-capability-pact-guard" : "create-capability-guard";
    const inner = applyStr(g.cgName, args.map((a) => serValue(a, ind + 1)), ind + 1);
    return applyStr(ctor, [inner], ind);
  }
  if (kind === "keyset-ref") {
    const g = guard as KeysetRefGuard;
    return `(keyset-ref-guard "${g.keysetref.ns}.${g.keysetref.ksn}")`;
  }
  if (kind === "keyset") {
    // Key-based — not valid in a governor slot, but render a best-effort
    // Pact object literal so nested occurrences don't silently vanish.
    const g = guard as KeysetGuard;
    const keys = g.keys.map((k) => `"${k}"`).join(" ");
    return `{ "keys": [ ${keys} ], "pred": "${g.pred}" }`;
  }
  return JSON.stringify(guard);
}

/** Any Pact value → source text (recurses into nested guards via serGuard). */
function serValue(v: unknown, ind: number): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "string") return `"${v}"`;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return String(v);
  if (isDecimalBox(v)) return v.decimal;
  if (isIntBox(v)) return v.int;
  if (Array.isArray(v)) return bracketStr(v.map((x) => serValue(x, ind + 1)), ind);
  if (detectGuardKind(v) !== null) return serGuard(v, ind);
  return JSON.stringify(v);
}

export type NonKeyGuardValue = { constructor: NonKeyGuardConstructor; body: string } | null;

/**
 * Reverse-render a resolved on-chain governor object into { constructor, body }
 * for pre-filling NonKeyGuardEntryInput. `body` is the inner argument the
 * constructor receives (NOT wrapped in `(create-* …)` — that wrap is the
 * constructor selection). Key-based / unrecognised governors fall back to an
 * empty user-guard body for the user to author from scratch.
 */
export function serializeGovernorToInput(governor: unknown): { constructor: NonKeyGuardConstructor; body: string } {
  const kind = detectGuardKind(governor);
  if (kind === "user") {
    const g = governor as UserGuard;
    const args = Array.isArray(g.args) ? g.args : [];
    return { constructor: "create-user-guard", body: applyStr(g.fun, args.map((a) => serValue(a, 1)), 0) };
  }
  if (kind === "capability") {
    const g = governor as CapabilityGuard;
    const args = Array.isArray(g.cgArgs) ? g.cgArgs : [];
    const ctor: NonKeyGuardConstructor =
      g.cgPactId != null ? "create-capability-pact-guard" : "create-capability-guard";
    return { constructor: ctor, body: applyStr(g.cgName, args.map((a) => serValue(a, 1)), 0) };
  }
  return { constructor: "create-user-guard", body: "" };
}
