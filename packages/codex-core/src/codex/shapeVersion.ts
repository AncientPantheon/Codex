/**
 * Pre-unlock `Codex_Shape_Version` detection — the `codex-shape-version-stamp`
 * topic's one new real capability.
 *
 * `detectCodexShapeVersion` is a defensive, NEVER-throwing probe of a raw
 * export's top-level `Codex_Shape_Version` field — no decryption, no
 * password, callable on a `File`'s raw text the instant it's selected,
 * before any store/adapter is touched. It mirrors the try/catch discipline
 * of `codex-arweave/src/library/flow.ts`'s own `deriveBackupLineage`: any
 * parse failure, non-object result, or missing/non-string field yields
 * `undefined` rather than throwing — a real `File`'s raw text can be
 * anything before the user has even picked the right file.
 *
 * `undefined` means "Unversioned" — a presence check, not a heuristic guess
 * (the codex-versioning project design's own narrowed-to-one-binary
 * decision). `formatCodexShapeVersionLabel` is the one canonical display
 * string every consumer (playground, OuronetUI, `CodexInfoCard`) should use,
 * so the wording never drifts between apps.
 */

/**
 * Probe raw export JSON text for a top-level `Codex_Shape_Version` string,
 * without decrypting or validating anything else about the envelope. Never
 * throws: malformed JSON, a non-object top level, or a present-but-non-string
 * field all yield `undefined`, exactly like an absent field does.
 */
export function detectCodexShapeVersion(rawJson: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(rawJson);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return undefined;
    }
    const value = (parsed as Record<string, unknown>).Codex_Shape_Version;
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The one canonical display string for a `Codex_Shape_Version` value —
 * `` `v${v}` `` when defined, else the literal `"Unversioned"`. Every
 * consumer (playground, OuronetUI, `CodexInfoCard`) should render through
 * this function so the wording never drifts between apps.
 */
export function formatCodexShapeVersionLabel(v: string | undefined): string {
  return v !== undefined ? `v${v}` : "Unversioned";
}
