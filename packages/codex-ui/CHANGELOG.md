# Changelog

## 0.0.1 — 2026-07-04

- Initial package skeleton: empty ESM entry point (`export {};`), layered tsconfig with browser support (`lib: ["ES2023", "DOM"]` + `jsx: "react-jsx"`), build/typecheck/test/clean scripts, and vitest config. Marked `"private": true` — internal interface layer, never published to npm.
