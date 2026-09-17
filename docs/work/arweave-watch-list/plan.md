## Wave 1
- [ ] T1: Wire real watch-list data (filtered to Arweave) from the codex store through to the Arweave panel's injected wiring, stopping at `ForeignChainsWiring.tsx`'s assembled `panelDeps` — no UI yet, verified by calling the exported `buildArweaveWiring` directly and by a render-level smoke test.
  - files: `packages/codex-ouronet/src/types/entities.ts`, `apps/codex-playground/src/ForeignChainsWiring.tsx`, `apps/codex-playground/tests/e5-foreign-chains-mock.test.tsx`
  - done when:
    - `entities.ts`'s `WatchListEntry.type` union (currently `"ouronet" | "stoa"` at line ~360) becomes `"ouronet" | "stoa" | "arweave"`. Grep the repo for any exhaustive `switch`/type-narrowing on `WatchListEntry.type` outside this file and `StoaAccountsTab.tsx` (which only ever constructs `type: "stoa"`, never switches on it) — none should exist; if one does, it is out of this task's scope to fix and must be reported, not silently patched.
    - `ForeignChainsWiring.tsx`'s import block gains `useWatchList` added to the existing `@ancientpantheon/codex-ouronet/hooks` import list (line ~47-52), a new `import type { WatchListEntry } from "@ancientpantheon/codex-ouronet/types";`, and `useCallback` added to the existing `react` import (line 32, currently `useEffect, useMemo, useState`).
    - Inside the `ForeignChainsWiring` component body (alongside the other hook calls, e.g. near the `chainwebSeeds`/`revealSeedWords` block at lines ~732-746), add:
      ```ts
      const { entries: watchListEntries, addEntry: addWatchListEntry, deleteEntry: deleteWatchListEntry } = useWatchList();
      const watchedAddresses = useMemo(
        () => watchListEntries.filter((w) => w.type === "arweave"),
        [watchListEntries],
      );
      const addWatchedAddress = useCallback(
        (address: string, label?: string) =>
          addWatchListEntry({
            id: globalThis.crypto.randomUUID(),
            label: label ?? "",
            address,
            type: "arweave",
            createdAt: new Date().toISOString(),
          }),
        [addWatchListEntry],
      );
      const removeWatchedAddress = useCallback(
        (id: string) => deleteWatchListEntry(id),
        [deleteWatchListEntry],
      );
      ```
      (Naming the destructured `useWatchList()` members `watchListEntries`/`addWatchListEntry`/`deleteWatchListEntry` avoids colliding with the `entries`/`addEntry`/`deleteEntry` names Chainweb's own `StoaAccountsTab.tsx` uses locally — this file has no such local names yet, but match this naming for clarity against the filtered `watchedAddresses`.)
    - `WiredArweavePanelDeps` (line ~469) gains three new required fields, with JSDoc matching the style of the existing `arweaveSeeds`/`onSeedDefined` fields on the same type: `watchedAddresses: WatchListEntry[]`, `addWatchedAddress: (address: string, label?: string) => Promise<void>`, `removeWatchedAddress: (id: string) => Promise<void>`.
    - `BuildArweaveWiringOptions` (line ~497) gains matching OPTIONAL fields: `watchedAddresses?: WatchListEntry[]`, `addWatchedAddress?: (address: string, label?: string) => Promise<void>`, `removeWatchedAddress?: (id: string) => Promise<void>`.
    - `buildArweaveWiring`'s destructured parameters (line ~551) gain `watchedAddresses = []`, `addWatchedAddress`, `removeWatchedAddress` (no default function — matches how `onSeedDefined`/`revealAccountSecret` are left undefined-able), and its `panelDeps` construction (lines ~632-642) splices all three in alongside `arweaveSeeds`/`onSeedDefined` (mode-independent — codex-local data, exactly like the seed seams' own comment states).
    - The `ForeignChainsWiring` component's call to `buildArweaveWiring(...)` (lines ~798-817) passes `watchedAddresses`, `addWatchedAddress`, `removeWatchedAddress` through.
    - New tests in `e5-foreign-chains-mock.test.tsx`:
      1. Call `buildArweaveWiring({ ...minimal required options..., watchedAddresses: [fixtureArweaveWatchEntry] })` directly and assert `result.panelDeps.watchedAddresses` equals `[fixtureArweaveWatchEntry]` (pass-through proof — `buildArweaveWiring` itself does no filtering, filtering is `ForeignChainsWiring`'s own `useMemo`, tested separately below).
      2. Call `buildArweaveWiring({ ...minimal required options... })` with `addWatchedAddress`/`removeWatchedAddress` omitted, and assert `result.panelDeps.watchedAddresses` is `[]` and the two function fields are `undefined` (proves the options stay optional and the wiring doesn't crash without them).
      3. Render `<ForeignChainsWiring>` inside a store hydrated (via this file's existing `hydrateFromPlaintextSnapshot`/fixture convention) with a snapshot whose `watchList` contains one `{ type: "stoa", ... }` entry and one `{ type: "arweave", ... }` entry; assert the render completes without throwing (a smoke guard — full DOM-visible proof that only the Arweave entry surfaces arrives with T2, since `ArweaveAccountsArea` does not yet consume `watchedAddresses`).
    - `npx vitest run apps/codex-playground/tests/e5-foreign-chains-mock.test.tsx --root apps/codex-playground` passes.
    - `npx tsc --noEmit -p packages/codex-ouronet/tsconfig.json` clean (the `entities.ts` type-union widening must not break anything there).
    - `npx vitest run --root packages/codex-ouronet` shows no new failures versus a baseline run captured immediately before this task's edits (quote both counts) — proves the shared `WatchListEntry.type` widening leaves Chainweb's own watch-list (`StoaAccountsTab.tsx`, `useWatchList`, the store actions, and the state/adapter test files covering `watchList`) completely unaffected, per the design's own acceptance criterion.
    - `npx tsc --noEmit -p apps/codex-playground/tsconfig.json` clean.

## Wave 2 (depends on Wave 1)
- [ ] T2: Build the Arweave "Watched Accounts" UI — an add-address form (validated via the real Arweave address validator), a watched-row rendering (live balance, copy, explorer link, editable label, remove — no Send button), replacing the hardcoded `WATCHED_COUNT = 0` stub.
  - files: `packages/codex-arweave/src/panel/ArweavePanel.tsx`, `packages/codex-arweave/src/panel/ArweaveAccountsArea.tsx`, `packages/codex-arweave/tests/e5-accounts-area.test.tsx`
  - done when:
    - `ArweavePanel.tsx` gains a new local interface mirroring `ArweaveSeedStoreSeams`'s exact pattern (line ~65), placed alongside it:
      ```ts
      interface ArweaveWatchListSeams {
        watchedAddresses: WatchListEntry[];
        addWatchedAddress: (address: string, label?: string) => Promise<void>;
        removeWatchedAddress: (id: string) => Promise<void>;
      }
      ```
      (with `import type { WatchListEntry } from "@ancientpantheon/codex-ouronet/types";` added), and a narrowed read mirroring line ~294's exact pattern: `const watchSeams = deps as (typeof deps & ArweaveWatchListSeams) | null;`, placed right after the existing `seedSeams` line.
    - The `<ArweaveAccountsArea>` call site (lines ~505-526) gains three new props: `watchedEntries={watchSeams?.watchedAddresses ?? []}`, `onAddWatched={watchSeams?.addWatchedAddress}`, `onRemoveWatched={watchSeams?.removeWatchedAddress}`.
    - `ArweaveAccountsAreaProps` (in `ArweaveAccountsArea.tsx`, line ~154-178) gains matching OPTIONAL props: `watchedEntries?: WatchListEntry[]`, `onAddWatched?: (address: string, label?: string) => Promise<void>`, `onRemoveWatched?: (id: string) => Promise<void>` — with JSDoc matching the file's existing `onDeleteKey?`/`getBalance?` style (each states what omitting it renders: no watched tab content / add form disabled, etc.). `ArweaveAccountsArea.tsx`'s current import block (lines 48-55) has none of `ARWEAVE_CHAIN_ID`, `validateAddress`, or `WatchListEntry` yet (confirmed by reading the file — the test file imports them, the source does not) — this task adds all three: `import type { WatchListEntry } from "@ancientpantheon/codex-ouronet/types";`, `import { validateAddress } from "@ancientpantheon/codex-ouronet/hooks";`, `import { ARWEAVE_CHAIN_ID } from "../address-book/chainId.js";` (matching the test file's own relative-import path for the same constant).
    - `WATCHED_COUNT = 0` (line ~731) is replaced by `const watchedEntries = props.watchedEntries ?? [];` (or destructured directly) used everywhere `WATCHED_COUNT` was referenced (the "Total Addresses" counter at line ~768-771, the subtab count at line ~812-816) — now `watchedEntries.length`.
    - The watched-tab body (replacing the static stub at lines ~886-901) becomes, when `watchedEntries.length === 0` AND no add form has been touched yet: keep the existing empty-state block (`data-testid="arweave-accounts-watched-empty"`) as a rendered-above-the-list state (mirroring Chainweb's own tab, which shows the add-input regardless of whether the list is empty) — i.e. the add-input/button ALWAYS renders in the watch tab; the empty-state message renders additionally only when `watchedEntries.length === 0`.
    - Add-address form: a text input (`data-testid="arweave-watch-input"`) + button (`data-testid="arweave-watch-submit"`), mirroring `StoaAccountsTab.tsx`'s `handleAddWatch` shape (lines ~380-390) exactly but with Arweave's own validation and error copy:
      ```ts
      const [watchInput, setWatchInput] = useState("");
      const [watchError, setWatchError] = useState<string | null>(null);
      const handleAddWatch = async () => {
        setWatchError(null);
        const addr = watchInput.trim();
        if (!validateAddress(ARWEAVE_CHAIN_ID, addr)) {
          setWatchError("Not a valid Arweave address.");
          return;
        }
        if (entries.some((e) => e.address === addr)) {
          setWatchError("That address is already a Codex account.");
          return;
        }
        if (watchedEntries.some((w) => w.address === addr)) {
          setWatchError("Already watched.");
          return;
        }
        try {
          await props.onAddWatched?.(addr);
          setWatchInput("");
        } catch (e) {
          setWatchError(e instanceof Error ? e.message : "Could not add.");
        }
      };
      ```
      (`validateAddress` imported from `@ancientpantheon/codex-ouronet/hooks`, `ARWEAVE_CHAIN_ID` already imported in this file per its existing `address-book/chainId.js` import.) The submit button is disabled while `props.onAddWatched` is undefined (mirrors `onDeleteKey &&` gating elsewhere in this file — an unwired add seam must not silently no-op on click) — `data-testid="arweave-watch-submit"` still renders but with `disabled`, and a validation/duplicate error renders via `role="alert"`, matching `StoaAccountsTab.tsx`'s pattern.
    - Watched-row rendering: a new internal component `WatchedRow` (in this same file, since `AccountRow` takes `entry: ForeignKeyEntry` and cannot accept a `WatchListEntry` unmodified — confirmed structural mismatch), visually mirroring `AccountRow`'s layout (address text, value cell using the SAME `getBalance` prop already wired — `data-testid="arweave-watched-value-${w.id}"` rendering `winstonToAr(balance)` / loading / error-fallback exactly like `AccountRow`'s existing value-cell logic) plus: copy button (`data-testid="arweave-watched-copy-${w.id}"`), ViewBlock explorer link (`data-testid="arweave-watched-explorer-${w.id}"`, same `https://viewblock.io/arweave/address/<address>` template `AccountRow` already uses), an inline label editor (mirroring `StoaAccountsTab.tsx`'s lines ~235-249 edit/save/cancel pattern, calling `props.onAddWatched?.(w.address, newLabel)` to relabel — the upsert-by-id semantics from `addWatchListEntry` make this the correct relabel mechanism, same as Chainweb's own `onRelabel={(label) => void addEntry({ ...w, label })}`), and a remove button (`data-testid="arweave-watched-remove-${w.id}"`, calling `props.onRemoveWatched?.(w.id)`, gated on `props.onRemoveWatched` being defined). Deliberately NO Send button and no `deps`/`sendFrom` usage anywhere in `WatchedRow` — there is no private key to sign with.
    - New tests in `e5-accounts-area.test.tsx`:
      1. With no `watchedEntries`/`onAddWatched` props passed, the watch tab shows the existing empty state and a disabled add button (backward-compatible default).
      2. Typing a syntactically invalid address and submitting shows a validation error and does not call `onAddWatched`.
      3. Typing a valid Arweave address (use the same fixture address format `ARWEAVE_ADDRESS` this file's other tests already use) and submitting calls `onAddWatched` with that address.
      4. Typing an address matching an existing (owned) `entries` row and submitting shows "already a Codex account" and does not call `onAddWatched`.
      5. Typing an address matching an existing `watchedEntries` row and submitting shows "Already watched." and does not call `onAddWatched`.
      6. A `watchedEntries` row renders its live balance via a mocked `getBalance`, formatted with `winstonToAr` (mirror the existing "renders a live balance" test's structure from T4's earlier work in this file, applied to a watched row instead of a codex row).
      7. A watched row's remove button calls `onRemoveWatched` with that entry's `id`.
      8. A watched row never renders a Send button/test-id, even when a full `deps` prop is also supplied.
    - `npx vitest run packages/codex-arweave/tests/e5-accounts-area.test.tsx --root packages/codex-arweave` passes.
    - `npx tsc --noEmit -p packages/codex-arweave/tsconfig.json` clean.
    - `npx tsc --noEmit -p apps/codex-playground/tsconfig.json` clean (confirms `ArweavePanel.tsx`'s new call-site props compile against `ArweaveAccountsAreaProps`'s new fields end to end through the playground's own build).
