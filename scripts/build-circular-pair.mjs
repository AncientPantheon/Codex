// Cold-build bootstrap for the codex-ui ↔ codex-ouronet CIRCULAR pair.
//
// The two packages import each other (the D5 carve left codex-ui depending on
// codex-ouronet/{state,types,components} while codex-ouronet depends on
// codex-ui/{provider,hooks,ui,components}). Each `tsconfig.build.json` clears
// `paths`, so each resolves the other through its published `exports` → `dist`.
// On a fresh checkout neither dist exists, so a naive ordered build deadlocks:
// whichever builds first can't resolve the other.
//
// Break the cycle with a two-pass bootstrap. `tsc` emits `.js` + `.d.ts` even
// when type errors are present (noEmitOnError defaults to false), so pass 1
// emits a codex-ouronet dist good enough for codex-ui to build against; pass 2
// then rebuilds codex-ouronet cleanly now that codex-ui's dist exists. Node
// (not shell `|| true`) so it is cross-platform for Windows dev + Linux CI.
import { execSync } from "node:child_process";

const run = (cmd, { tolerate = false } = {}) => {
  try {
    execSync(cmd, { stdio: "inherit" });
  } catch (err) {
    if (!tolerate) throw err;
    console.log(`[build-circular-pair] tolerated non-zero exit (bootstrap): ${cmd}`);
  }
};

// Pass 1 — emit a bootstrap codex-ouronet dist despite the (expected) unresolved
// codex-ui references. Errors are tolerated; we only need the emitted artifacts.
run("npx tsc -p packages/codex-ouronet/tsconfig.build.json", { tolerate: true });

// codex-ui now resolves codex-ouronet through the bootstrap dist and builds clean.
run("npm run build --workspace=@ancientpantheon/codex-ui");

// Pass 2 — full, clean codex-ouronet build now that codex-ui's dist exists (this
// runs its own clean + tsc + the ui-css / pact-parser copy steps).
run("npm run build --workspace=@ancientpantheon/codex-ouronet");
