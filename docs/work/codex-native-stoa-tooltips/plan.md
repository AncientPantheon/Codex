## Wave 1
- [x] T1: Hand-author `NATIVE_SPECS` + a source-verification test for the 7 `coin.*` signatures
  Codex's 5 launchers need.
  - Create `packages/codex-ouronet/src/zbom/cfm/nativeStoaSpecs.ts`:
    ```ts
    export interface NativeStoaSpec {
      /** Fully-qualified `coin.<Fn>` key, e.g. "coin.C_URV|Stake" — root-namespace,
       *  no "ouronet-ns." prefix; that absence is itself information. */
      exec: string;
      /** Parameter names, in declared order — verified against the deployed
       *  contract by zbom-native-stoa-specs.test.ts, never hand-trusted alone. */
      signature: string[];
      /** One illustrative example value per signature slot, same order.
       *  Kadena-shaped (`k:...`) accounts, never an Ouronet glyph string — a
       *  glyph account in a `coin` call would teach a call shape that cannot
       *  work. A `guard`-typed slot's example is the string
       *  `(read-keyset "ks")` (matches this package's own established
       *  ghost.use.display convention for guard-shaped values, not a
       *  hand-derived object literal). */
      args: unknown[];
    }
    const K_ACCOUNT = "k:1ac0d8b0a4f6e2c9d3b5a7e1f4c6089d2b3e5a7c9f1d3b5e7a9c1f3d5b7e9a1c";
    const AMOUNT = 1.0;
    const GUARD_EXAMPLE = '(read-keyset "ks")';
    export const NATIVE_SPECS: Readonly<Record<string, NativeStoaSpec>> = {
      "coin.C_Transfer": { exec: "coin.C_Transfer", signature: ["sender", "receiver", "amount"], args: [K_ACCOUNT, K_ACCOUNT, AMOUNT] }, // coin-live.pact:583
      "coin.C_TransferAnew": { exec: "coin.C_TransferAnew", signature: ["sender", "receiver", "receiver-guard", "amount"], args: [K_ACCOUNT, K_ACCOUNT, GUARD_EXAMPLE, AMOUNT] }, // coin-live.pact:586
      "coin.C_UR|Transfer": { exec: "coin.C_UR|Transfer", signature: ["sender", "receiver", "amount"], args: [K_ACCOUNT, K_ACCOUNT, AMOUNT] }, // coin-live.pact:1075
      "coin.C_UR|TransferAnew": { exec: "coin.C_UR|TransferAnew", signature: ["sender", "receiver", "receiver-guard", "amount"], args: [K_ACCOUNT, K_ACCOUNT, GUARD_EXAMPLE, AMOUNT] }, // coin-live.pact:1080
      "coin.C_URV|Stake": { exec: "coin.C_URV|Stake", signature: ["account", "urstoa-amount"], args: [K_ACCOUNT, AMOUNT] }, // coin-live.pact:1407
      "coin.C_URV|Unstake": { exec: "coin.C_URV|Unstake", signature: ["account", "urstoa-amount"], args: [K_ACCOUNT, AMOUNT] }, // coin-live.pact:1439
      "coin.C_URV|Collect": { exec: "coin.C_URV|Collect", signature: ["account"], args: [K_ACCOUNT] }, // coin-live.pact:1467
    };
    export function isNativeKey(key: string): key is keyof typeof NATIVE_SPECS {
      return Object.hasOwn(NATIVE_SPECS, key);
    }
    ```
    (Exact signatures re-verified live against `_onchain/Ouronet/0_Stoa/coin-contract/coin-live.pact`
    on this machine during shaping — see design.md's table. `args.length === signature.length` for
    every entry.)
  - Create `packages/codex-ouronet/tests/zbom-native-stoa-specs.test.ts`, mirroring
    `/home/ancientbox/ClaudeWS/OuroborosNetwork/daimons/OuronetUI/src/__tests__/native-stoa-specs.test.ts`
    structure exactly:
    - `const COIN = join(__dirname, "..", "..", "..", "..", "..", "..", "OuroborosNetwork", "_onchain", "Ouronet", "0_Stoa", "coin-contract", "coin-live.pact")`
      (6 levels up from `packages/codex-ouronet/tests/` reaches the shared `ClaudeWS` parent both
      `AncientPantheon` and `OuroborosNetwork` sit under on this machine — confirmed resolving via
      `realpath` during shaping) — `const HAVE_SOURCE = existsSync(COIN)`.
    - `signaturesFromSource(src)`: same regex as the reference
      (`/^\s*\(defun\s+([A-Za-z0-9_|]+):\w+\s*\(([^)]*)\)/gm`), returns `Map<string, string[]>` of
      function name → param names (strips `:type` suffixes).
    - `it("knows whether it can check at all", ...)`: unconditional; `console.warn`s the skip reason
      when `!HAVE_SOURCE`, asserts `typeof HAVE_SOURCE === "boolean"` — always runs, always visible.
    - `const maybe = HAVE_SOURCE ? it : it.skip;` — `maybe("every spec's signature is the contract's own, parameter for parameter", ...)`:
      reads `COIN`, asserts `real.size` (parsed defun count) `> 20` (regex-matched-nothing guard),
      then for every `NATIVE_SPECS` entry asserts `real.get(key.replace(/^coin\./, ""))` is defined
      and deep-equals `spec.signature`.
    - `it("every spec is a coin.* key with one arg per signature slot", ...)` (runs regardless of
      `HAVE_SOURCE` — independent of the Pact checkout): for every `NATIVE_SPECS` entry, asserts
      `key.startsWith("coin.")` and `spec.args.length === spec.signature.length`.
  - done when:
    - `npx vitest run tests/zbom-native-stoa-specs.test.ts` (from `packages/codex-ouronet`) passes,
      with the source-comparison test ACTUALLY running (not skipped) on this machine — confirm by
      temporarily changing one `NATIVE_SPECS` signature (e.g. drop `"urstoa-amount"` from
      `coin.C_URV|Stake`), re-running to see it fail with a message naming the drifted key, then
      reverting — proves the check is real, not vacuously green.
    - `npx tsc --noEmit` clean.
  - files: `packages/codex-ouronet/src/zbom/cfm/nativeStoaSpecs.ts`, `packages/codex-ouronet/tests/zbom-native-stoa-specs.test.ts`

## Wave 2 (depends on Wave 1)
- [x] T2: `PreZbomTooltipCard` renders a gold native card for any `isNativeKey(entrypoint)`, bypassing
  registry resolution entirely; `PreZbomHint`/`PreZbomTooltipCard` gain an optional `description` prop.
  - In `packages/codex-ouronet/src/zbom/cfm/PreZbomHint.tsx`:
    - Import `NATIVE_SPECS`, `isNativeKey` from `./nativeStoaSpecs.js`.
    - At the very top of `PreZbomTooltipCard` (before the existing `tryGetEntrypoint` call), branch:
      `if (isNativeKey(entrypoint)) return <NativeStoaCard spec={NATIVE_SPECS[entrypoint]} description={description} />;`
      — a new module-scope function `NativeStoaCard({ spec, description }: { spec: NativeStoaSpec; description?: React.ReactNode })`
      rendering: `<div className="rounded-lg border" style={{ ...previewCardStyle, border: "2px solid #ceac5f" }}>`,
      `<CodexBadge />`, a header line reading `STOA NATIVE` (color `#ceac5f`, bold, same `mono` font as
      every other header line in this file), then `{description}` when present (small, `#9a9a9a`,
      `marginTop: 4`), then `{spec.exec}` (mono, `#ceac5f`, unchanged styling from the registry-key
      display line elsewhere in this file), then a numbered list over `spec.signature`/`spec.args`
      (same `shorten(String(v))` + `title={String(v)}` rendering already used for a real preview
      value's row — reusing the existing helper, not a new one), then a footer:
      `no IGNIS — this costs native STOA gas, paid by the signer directly` (mono, `#5a5a5a`,
      `marginTop: 8`, `borderTop: "1px solid #1c1c1c"`, `paddingTop: 6`) — no preview/cost section, no
      live `pactRead` call anywhere in this branch.
    - `PreZbomTooltipCard`'s own props gain `description?: React.ReactNode` (passed through to
      `NativeStoaCard` in the native branch; unused, harmlessly ignored, in the registry-resolution
      branch — topic 1's existing callers never pass it, so their rendering is byte-for-byte
      unchanged).
    - `PreZbomHintProps` gains the same `description?: React.ReactNode`, threaded straight to
      `PreZbomTooltipCard` in the `content=` prop of the existing `ActionTooltip` call.
  - In `packages/codex-ouronet/tests/zbom-prezbom-hint.test.tsx`, add (new `describe` block):
    - `render(<PreZbomTooltipCard entrypoint="coin.C_URV|Stake" />)`: asserts `container.textContent`
      contains `"STOA NATIVE"`, contains `"coin.C_URV|Stake"`, contains `"01 account"` and
      `"02 urstoa-amount"`, contains the Kadena `k:` example account text, contains
      `"no IGNIS"`, does NOT contain `"IGNIS"` immediately after a numeric value (i.e. no cost-preview
      IGNIS line renders) — assert via `expect(container.textContent).not.toMatch(/\d\s*IGNIS/)`.
    - `render(<PreZbomTooltipCard entrypoint="coin.C_URV|Stake" description="Stake your liquid UrStoa. 12.5 UrStoa available." />)`:
      asserts `screen.getByText(/12\.5 UrStoa available/)` renders, alongside the native section
      still present (`screen.getByText("STOA NATIVE")`) — proves `description` and the native card
      coexist in one tooltip, not two.
    - `render(<PreZbomTooltipCard entrypoint="coin.C_TransferAnew" />)`: asserts the numbered list
      shows exactly 4 rows (`01 sender`, `02 receiver`, `03 receiver-guard`, `04 amount`) and row 3's
      value is the literal text `(read-keyset "ks")`, not `[object Object]` or `MISSING`.
    - `render(<PreZbomTooltipCard entrypoint="TS01-C4.CODEX|C_ReleaseStoicTag" />)` (a REGISTRY key,
      unchanged from topic 1): re-run the exact assertions from topic 1's own
      `"shows exactly the PREVIEW's own 2 params..."` test inline here, confirming byte-identical
      behavior — the native branch addition changed nothing about the registry-resolution path.
  - done when:
    - `npx vitest run tests/zbom-prezbom-hint.test.tsx` — all new + all topic-1 tests in this file
      pass unmodified; `npx tsc --noEmit` clean.
  - files: `packages/codex-ouronet/src/zbom/cfm/PreZbomHint.tsx`, `packages/codex-ouronet/src/zbom/cfm/nativeStoaSpecs.ts`, `packages/codex-ouronet/tests/zbom-prezbom-hint.test.tsx`

## Wave 3 (depends on Wave 2)
- [x] T3: Wire the 4 desktop button instances (5 launchers — Send/Transfer share one mode-dependent
  slot) in `StoaAccountsTab.tsx` with `PreZbomHint`, replacing each one's standalone `ActionTooltip`
  wrapper with `PreZbomHint`'s own (`description=` carrying the same text verbatim) — and extend the
  class-wide launcher-coverage test to cover this file too.
  - In `packages/codex-ouronet/src/ui/tabs/StoaAccountsTab.tsx`:
    - Import `PreZbomHint` (mirrors `OuronetAccountsTab.tsx`'s own `import PreZbomHint from
      "../../zbom/cfm/PreZbomHint.js";`).
    - Replace the `<ActionTooltip content={mode === "urstoa" ? "Transfer UrStoa to another account." : "Send native Stoa to another account."}>...<button onClick={() => setActiveModal(mode === "urstoa" ? "transfer" : "send")} .../></ActionTooltip>`
      block (around line 782-797) with
      `<PreZbomHint entrypoint={mode === "urstoa" ? "coin.C_UR|Transfer" : "coin.C_Transfer"} description={mode === "urstoa" ? "Transfer UrStoa to another account." : "Send native Stoa to another account."}><button ...unchanged.../></PreZbomHint>`
      — the button's own `onClick`/`title`/icon/style untouched, only the wrapping tag changes.
    - Replace the Stake `<ActionTooltip content={\`Stake your liquid UrStoa into the vault. ${fmt12(urBal?.balance ?? 0)} UrStoa available.\`}>...</ActionTooltip>` (line ~801-803) with
      `<PreZbomHint entrypoint="coin.C_URV|Stake" description={\`Stake your liquid UrStoa into the vault. ${fmt12(urBal?.balance ?? 0)} UrStoa available.\`}>...</PreZbomHint>`.
    - Replace the Unstake block (line ~804-806) the same way with `entrypoint="coin.C_URV|Unstake"`.
    - Replace the Collect block (line ~807-809) the same way with `entrypoint="coin.C_URV|Collect"`.
    - The mobile-specific `leftEdgeStack`/`rightEdgeStack` blocks (their own separate `ActionTooltip`
      usages later in the file) are UNTOUCHED — out of scope per design.md.
  - In `packages/codex-ouronet/tests/zbom-prezbom-launcher-coverage.test.ts`:
    - Add `stoa: resolve(SRC, "ui/tabs/StoaAccountsTab.tsx")` to `FILES`.
    - Add 4 entries to `EXPECTED_OPEN_CALLS`:
      `{ file: "stoa", needle: 'setActiveModal(mode === "urstoa" ? "transfer" : "send")', expectedEntrypoints: ["coin.C_UR|Transfer", "coin.C_Transfer"] }`,
      `{ file: "stoa", needle: 'setActiveModal("stake")', expectedEntrypoints: ["coin.C_URV|Stake"] }`,
      `{ file: "stoa", needle: 'setActiveModal("unstake")', expectedEntrypoints: ["coin.C_URV|Unstake"] }`,
      `{ file: "stoa", needle: 'setActiveModal("collect")', expectedEntrypoints: ["coin.C_URV|Collect"] }`.
    - Update the `it("inventories exactly the 11 known open-call sites...")` title/count and the
      `sources`/`regions` object literals in both `it` blocks to include `stoa` alongside
      `accounts`/`single`/`dual` (15 total open-call sites after this addition).
  - done when:
    - `npx vitest run tests/zbom-prezbom-launcher-coverage.test.ts tests/zbom-prezbom-hint.test.tsx` passes.
    - `npx tsc --noEmit` clean; full `packages/codex-ouronet` suite green (`npx vitest run`).
    - Full workspace `npm run typecheck` (root) clean.
  - files: `packages/codex-ouronet/src/ui/tabs/StoaAccountsTab.tsx`, `packages/codex-ouronet/tests/zbom-prezbom-launcher-coverage.test.ts`
