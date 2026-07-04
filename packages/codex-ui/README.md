# @ancientpantheon/codex-ui

The React/browser interface layer of the Codex family — the DOM-facing package that will host the `<CodexProvider>`, hooks, and headless components. Compiled with the `DOM` lib and `react-jsx` transform so browser-side TypeScript type-checks, but ships no React runtime dependency yet.

Internal member package: `"private": true`, never published to npm. The public consumer-facing surface is re-exported through the [`@ancientpantheon/codex`](../codex) aggregator.

## Status

`0.0.1` — internal (never published to npm). Empty, buildable skeleton: `src/index.ts` is an empty ESM module and there are no components, hooks, or React dependencies yet. Browser support is enabled at the compiler level (`lib: ["ES2023", "DOM"]` + `jsx: "react-jsx"`); real UI content arrives in a later spec.

## Version history

**v0.0.1** — Initial package skeleton.
