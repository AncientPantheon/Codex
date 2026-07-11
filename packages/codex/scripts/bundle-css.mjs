// Merge the member packages' shipped stylesheets into one `dist/ui.css` so a
// consumer loads a single `@ancientpantheon/codex/ui.css`. codex-ui and
// codex-ouronet each copy their own `tokens.css` to `dist/ui.css`; concatenating
// both is idempotent (identical token rules collapse; later wins) and covers any
// tokens one sheet has that the other lacks.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "..");
const sources = [
  resolve(pkgRoot, "../codex-ui/dist/ui.css"),
  resolve(pkgRoot, "../codex-ouronet/dist/ui.css"),
];

const parts = [];
for (const src of sources) {
  if (existsSync(src)) {
    parts.push(`/* ← ${src.replace(/\\/g, "/").split("/packages/")[1]} */`);
    parts.push(readFileSync(src, "utf8").trim());
  } else {
    console.warn(`[bundle-css] missing source (build members first): ${src}`);
  }
}

const distDir = resolve(pkgRoot, "dist");
if (!existsSync(distDir)) mkdirSync(distDir, { recursive: true });
writeFileSync(resolve(distDir, "ui.css"), parts.join("\n\n") + "\n", "utf8");
console.log(`[bundle-css] wrote dist/ui.css from ${parts.length / 2} member sheet(s)`);
