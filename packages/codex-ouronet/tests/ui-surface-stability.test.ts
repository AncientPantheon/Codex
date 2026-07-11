/**
 * ui-surface-stability.test.ts — SURFACE/shape lock for the `./ui` barrel
 * (`src/ui/index.ts`).
 *
 * The D5 carve moved the chain-generic, token-styled UI leaves + the two
 * pure-layout slot shells into `@ancientpantheon/codex-ui/ui`, and this barrel
 * RECONSTITUTES the pre-carve `./ui` public surface BYTE-FOR-BYTE (N-04): the
 * MOVE-set generic names are re-exported FROM codex-ui, the STAY-set names (the
 * 5 zbom-edged tabs, the zbom debouncer trio, the 3 zbom settings cards, the
 * @stoachain-edged CodexInfoCard + EncryptionCard, and the Ouronet-composed
 * CodexTabs / CodexSettingsSection aggregators) are exported LOCALLY.
 *
 * The reassembly is currently name-identical to the pre-carve source, but
 * nothing LOCKED it: a future edit could drop or rename a `./ui` export (a type
 * companion, or a less-tested name) undetected. This guard LOCKS the inventory
 * so a dropped, renamed, or leaked export fails LOUDLY — by name — before it
 * reaches a consumer. It is a SHAPE guard, not a behavior guard: the per-tab /
 * per-card render tests already drive behavior; here we assert ONLY the public
 * export INVENTORY.
 *
 * Lock is BOTH directions (mirrors guard-hook-surface.test.ts):
 *   (a) forward — each named value export is present (a drop/rename fails by
 *       name);
 *   (b) negative — the set of RUNTIME (own-key value) exports equals EXACTLY the
 *       known golden set, no extras (a silent widening / `export *` regression
 *       fails, naming the offending export via the sorted-set diff);
 *   (c) type-shape — the `*Props` + companion type exports are referenced through
 *       a typed-noop so a DROPPED type export fails the vitest TS transform at
 *       compile time (types erase at runtime, so this is the only lock for them).
 *
 * The golden set below is HARDCODED (derived from the current correct
 * src/ui/index.ts barrel that T9.6b reassembled name-identical to the pre-carve
 * source). Hardcoding makes the lock independent of the file it guards: an edit
 * to the barrel cannot silently move the target.
 */

import { describe, it, expect } from "vitest";

import * as ouronetUi from "@ancientpantheon/codex-ouronet/ui";
import type {
  // ── MOVE-set leaf type companions (re-exported from codex-ui) ──
  CodexUiRootProps,
  StoicTagDisplayProps,
  CodexLockControlProps,
  ObservationalCodexIdSettingsProps,
  ObservationalCodexIdDisplayProps,
  ObservationalCodexIdConfig,
  // ── MOVE-set settings-card type companions (re-exported from codex-ui) ──
  ChangePasswordCardProps,
  ChangePasswordPayload,
  DownloadCodexCardProps,
  ExperimentalCurvesCardProps,
  CodexIdentityCardProps,
  CodexGuardCardProps,
  ConsumerSettingsCardProps,
  GasSettingsCardProps,
  // ── STAY-set tab type companions (local) ──
  AddressBookTabProps,
  PureKeypairsTabProps,
  SeedWordsTabProps,
  StoaAccountsTabProps,
  OuronetAccountsTabProps,
  // ── STAY-set tabs aggregator type companions (local) ──
  CodexTabsProps,
  CodexTabKey,
  // ── STAY-set debouncer-trio type companions (local) ──
  CodexDebouncerPanelProps,
  CodexReadFn,
  // ── STAY-set @stoachain-edged card type companions (local) ──
  CodexInfoCardProps,
  EncryptionCardProps,
  // ── STAY-set zbom card type companions (local) ──
  ZbomSettingsCardProps,
  DebouncerSettingsCardProps,
  ReadFunctionsCardProps,
  // ── STAY-set settings aggregator type companion (local) ──
  CodexSettingsSectionProps,
} from "@ancientpantheon/codex-ouronet/ui";

// The authoritative golden allow-list of RUNTIME (value) exports the `./ui`
// barrel is contracted to expose. Order mirrors the barrel's export order for
// readability; both locks treat it as a SET. Derived from the current correct
// src/ui/index.ts (the byte-stable T9.6b reassembly of the pre-carve surface),
// hardcoded so the lock is independent of the file it guards.
const EXPECTED_UI_VALUE_EXPORTS = [
  // MOVE-set generic leaves (re-exported from codex-ui). CodexPasswordPrompt is
  // the 2nd value export of the CodexLockControl module — a multi-export
  // companion that must not silently drop.
  "CodexUiRoot",
  "StoicTagDisplay",
  "CodexLockControl",
  "CodexPasswordPrompt",
  "ObservationalCodexIdSettings",
  "ObservationalCodexIdDisplay",
  // MOVE-set settings cards (re-exported from codex-ui)
  "ChangePasswordCard",
  "DownloadCodexCard",
  "ExperimentalCurvesCard",
  "CodexIdentityCard",
  "CodexGuardCard",
  "ConsumerSettingsCard",
  "GasSettingsCard",
  // STAY-set: the five zbom-edged account tabs (local)
  "AddressBookTab",
  "PureKeypairsTab",
  "SeedWordsTab",
  "StoaAccountsTab",
  "OuronetAccountsTab",
  // STAY-set: the Ouronet-composed tabs aggregator (local)
  "CodexTabs",
  // STAY-set: the zbom debouncer trio (value zbom edge)
  "CodexDebouncerPanel",
  "codexClock",
  "CODEX_READ_REGISTRY",
  // STAY-set: the @stoachain-edged settings cards (C4)
  "CodexInfoCard",
  "EncryptionCard",
  // STAY-set: the three zbom settings cards (value zbom edge)
  "ZbomSettingsCard",
  "DebouncerSettingsCard",
  "ReadFunctionsCard",
  // STAY-set: the Ouronet-composed settings aggregator (local)
  "CodexSettingsSection",
  // Apollo-ownership verifier (/apollo-verify) — the generic RP verify page +
  // its signing seam (the Apollo-curve @stoachain value edge).
  "ApolloVerifyView",
  "signApolloOwnership",
  "buildApolloOwnershipMessage",
] as const;

describe("ui barrel — forward lock (every named value export present)", () => {
  // A single parametrized case per name: a DROP or RENAME of any export makes
  // its named entry fail here, naming the missing symbol in the failure — not a
  // bare count mismatch a reader must decode.
  it.each(EXPECTED_UI_VALUE_EXPORTS)(
    "exports %s as a defined runtime value",
    (name) => {
      const value = (ouronetUi as Record<string, unknown>)[name];
      expect(value, `./ui dropped or renamed the '${name}' export`).toBeDefined();
    },
  );

  it("exports all 31 contracted value names (no silent drop below the floor)", () => {
    // Guards the it.each roster itself: if the golden list is edited down, this
    // pins the intended cardinality of the VALUE surface at exactly 31 (28 pre-
    // carve names + the 3 Apollo-verifier exports).
    const present = EXPECTED_UI_VALUE_EXPORTS.filter(
      (name) => (ouronetUi as Record<string, unknown>)[name] !== undefined,
    );
    expect(present).toHaveLength(EXPECTED_UI_VALUE_EXPORTS.length);
    expect(EXPECTED_UI_VALUE_EXPORTS).toHaveLength(31);
  });
});

describe("ui barrel — negative lock (runtime surface does not widen)", () => {
  it("exposes EXACTLY the golden value exports — no extras", () => {
    // Compute the own runtime VALUE exports of the barrel namespace and assert
    // the set equals the golden list. An `export *` regression, a leaked helper,
    // or a new export added without updating the contract adds a name here and
    // FAILS, naming the offending export via the sorted-set diff. This is the
    // (b) direction of the both-directions lock — the surface may not widen.
    const runtimeValueExports = Object.keys(ouronetUi)
      .filter((name) => name !== "default")
      .sort();
    expect(runtimeValueExports).toEqual([...EXPECTED_UI_VALUE_EXPORTS].sort());
  });
});

describe("ui barrel — type-shape lock (Props / companion type exports present)", () => {
  it("references every contracted type companion so a dropped type export fails the TS transform", () => {
    // Types erase at runtime, so there is nothing to assert on `ouronetUi` for
    // them. Instead we bind one typed noop per type export: if any *Props type,
    // the two config/payload aliases (ObservationalCodexIdConfig,
    // ChangePasswordPayload), the CodexTabKey union, or the CodexReadFn function
    // type is dropped/renamed in the barrel, THIS FILE stops type-checking and
    // vitest's TS transform fails the test — the compile-time equivalent of the
    // runtime forward lock above.
    const acceptType = <T,>(_value?: T): void => {};

    // MOVE-set leaf companions
    acceptType<CodexUiRootProps>();
    acceptType<StoicTagDisplayProps>();
    acceptType<CodexLockControlProps>();
    acceptType<ObservationalCodexIdSettingsProps>();
    acceptType<ObservationalCodexIdDisplayProps>();
    acceptType<ObservationalCodexIdConfig>();
    // MOVE-set settings-card companions
    acceptType<ChangePasswordCardProps>();
    acceptType<ChangePasswordPayload>();
    acceptType<DownloadCodexCardProps>();
    acceptType<ExperimentalCurvesCardProps>();
    acceptType<CodexIdentityCardProps>();
    acceptType<CodexGuardCardProps>();
    acceptType<ConsumerSettingsCardProps>();
    acceptType<GasSettingsCardProps>();
    // STAY-set tab companions
    acceptType<AddressBookTabProps>();
    acceptType<PureKeypairsTabProps>();
    acceptType<SeedWordsTabProps>();
    acceptType<StoaAccountsTabProps>();
    acceptType<OuronetAccountsTabProps>();
    // STAY-set tabs aggregator companions
    acceptType<CodexTabsProps>();
    acceptType<CodexTabKey>();
    // STAY-set debouncer-trio companions
    acceptType<CodexDebouncerPanelProps>();
    acceptType<CodexReadFn>();
    // STAY-set @stoachain-edged card companions
    acceptType<CodexInfoCardProps>();
    acceptType<EncryptionCardProps>();
    // STAY-set zbom card companions
    acceptType<ZbomSettingsCardProps>();
    acceptType<DebouncerSettingsCardProps>();
    acceptType<ReadFunctionsCardProps>();
    // STAY-set settings aggregator companion
    acceptType<CodexSettingsSectionProps>();

    // A trivial runtime assertion so the case is not empty; the real lock is the
    // type references above resolving at compile time.
    expect(acceptType).toBeInstanceOf(Function);
  });
});
