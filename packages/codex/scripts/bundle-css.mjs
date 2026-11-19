// Merge the member packages' shipped stylesheets into one `dist/ui.css` so a
// consumer loads a single `@ancientpantheon/codex/ui.css`. codex-ui and
// codex-ouronet each copy their own `tokens.css` to `dist/ui.css`; concatenating
// both is idempotent (identical token rules collapse; later wins) and covers any
// tokens one sheet has that the other lacks.
//
// CONCATENATION IS NOT A VALID CSS TRANSFORM BY ITSELF. Both member sheets open
// with the same Google-Fonts `@import` and both document that "`@import` MUST be
// the first statement" — true of each sheet alone, violated the moment they are
// joined: the second copy lands after ~95 lines of the first member's rules, and
// per CSS spec an `@import` following any rule is invalid and dropped (Turbopack
// and Lightning CSS warn or hard-error). So the join HOISTS every `@import` out
// of the member bodies to the head of the bundle, de-duplicating identical ones.
//
// Hoist-all rather than dedupe-only: dedupe alone is correct only while the two
// sheets' imports stay byte-identical, and the day one member adds a font or an
// `@import` of its own, dedupe silently re-emits the invalid trailing statement.
// Hoisting is the general transform and subsumes dedup.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Blanks out `/* ... *\/` comment bodies while preserving every byte offset, so
 * the scan below can match statements at real positions in the ORIGINAL text
 * without ever mistaking prose for code — both member sheets mention `@import`
 * inside a comment.
 * @param {string} css
 * @returns {string}
 */
function maskComments(css) {
  let out = "";
  let i = 0;
  while (i < css.length) {
    if (css.startsWith("/*", i)) {
      const end = css.indexOf("*/", i + 2);
      const stop = end === -1 ? css.length : end + 2;
      out += " ".repeat(stop - i);
      i = stop;
    } else {
      out += css[i];
      i += 1;
    }
  }
  return out;
}

/**
 * Index just past the `;` that terminates the statement starting at `from`.
 * A plain `[^;]*;` scan is WRONG here: the Google-Fonts URL carries six
 * semicolons of its own (`wght@400;500;600;700`), so a naive match truncates
 * the statement mid-URL and leaves the tail behind as orphan garbage.
 * Semicolons inside a quoted string or inside `url(...)` are not terminators.
 * @param {string} masked comment-masked view (offsets match the original)
 * @param {number} from index of the `@`
 * @returns {number}
 */
function endOfStatement(masked, from) {
  let depth = 0;
  /** @type {string | null} */
  let quote = null;
  for (let i = from; i < masked.length; i += 1) {
    const ch = masked[i];
    if (quote) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(") depth += 1;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (ch === ";" && depth === 0) return i + 1;
    else if (ch === "{" && depth === 0) return i; // malformed; do not swallow a block
  }
  return masked.length;
}

/**
 * Splits `@import ...;` statements out of a sheet, returning them alongside the
 * body they were removed from. Matching runs against a comment-masked view so a
 * documented `@import` stays documentation; the slices come from the original.
 * @param {string} css
 * @returns {{ imports: string[], body: string }}
 */
function extractImports(css) {
  const masked = maskComments(css);
  const imports = [];
  const keep = [];
  let cursor = 0;
  const re = /@import\b/g;
  let m;
  while ((m = re.exec(masked)) !== null) {
    const end = endOfStatement(masked, m.index);
    imports.push(css.slice(m.index, end).trim());
    keep.push(css.slice(cursor, m.index));
    cursor = end;
    re.lastIndex = end;
  }
  keep.push(css.slice(cursor));
  return { imports, body: keep.join("").replace(/\n{3,}/g, "\n\n").trim() };
}

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "..");
const sources = [
  resolve(pkgRoot, "../codex-ui/dist/ui.css"),
  resolve(pkgRoot, "../codex-ouronet/dist/ui.css"),
];

/** @type {string[]} */
const hoisted = [];
const parts = [];
for (const src of sources) {
  if (existsSync(src)) {
    const { imports, body } = extractImports(readFileSync(src, "utf8"));
    for (const statement of imports) {
      // First-seen order wins; identical imports collapse to one.
      if (!hoisted.includes(statement)) hoisted.push(statement);
    }
    parts.push(`/* ← ${src.replace(/\\/g, "/").split("/packages/")[1]} */`);
    parts.push(body);
  } else {
    console.warn(`[bundle-css] missing source (build members first): ${src}`);
  }
}

const head = hoisted.length
  ? [
      "/*",
      " * Hoisted from the member sheets by scripts/bundle-css.mjs. EVERY `@import`",
      " * in this file must stay above the first rule — an `@import` that follows a",
      " * rule is invalid per CSS spec and is dropped by browsers / hard-errors in",
      " * Lightning CSS and Turbopack.",
      " */",
      ...hoisted,
      "",
      "",
    ].join("\n")
  : "";

const distDir = resolve(pkgRoot, "dist");
if (!existsSync(distDir)) mkdirSync(distDir, { recursive: true });
writeFileSync(resolve(distDir, "ui.css"), head + parts.join("\n\n") + "\n", "utf8");
console.log(
  `[bundle-css] wrote dist/ui.css from ${parts.length / 2} member sheet(s), ` +
    `${hoisted.length} hoisted @import statement(s)`,
);
