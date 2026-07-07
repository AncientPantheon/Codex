/** @type {import('tailwindcss').Config} */
// Build-time-ONLY config. codex-ui is the canonical CSS entry (its `./ui.css`
// export is what consumers import — the vite exact-match alias lets it fall
// through to dist). At build, Tailwind compiles the utility classes used across
// the whole assembled Codex UI into a self-contained dist/ui.css so consumers
// need NO Tailwind (variant B). Preflight (global reset) is OFF — a SCOPED
// `.codex-ui` reset in tw-utilities.css supplies the border/box-sizing defaults
// the utilities rely on without touching the host page.
module.exports = {
  darkMode: "class",
  corePlugins: { preflight: false },
  // Scan every package whose components render inside a consumer's Codex UI.
  // A plain file scan for class names — no import/build coupling is created.
  content: [
    "./src/**/*.{ts,tsx}",
    "../codex-ouronet/src/**/*.{ts,tsx}",
    "../codex-arweave/src/**/*.{ts,tsx}",
  ],
  theme: { extend: {} },
  plugins: [],
};
