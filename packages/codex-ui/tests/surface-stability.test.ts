/**
 * surface-stability.test.ts — the D-11 PUBLIC-SURFACE lock for the carved
 * `@ancientpantheon/codex-ui` package (the RED author for the D5 carve).
 *
 * RED-FIRST: at author time codex-ui's root barrel is `export {}` and there is
 * NO `src/hooks/` subtree yet, so the `../src/hooks/index.js` import below fails
 * to resolve and every case in this file errors. The guard goes GREEN only once
 * T9.4 lands the hooks barrel (consuming T9.5's provider) inside codex-ui.
 *
 * What this file pins (the byte-stable D-11 surface):
 *   (1) The ENUMERATED 18-hook FUNCTION set — BOTH directions: every one of the
 *       18 named hooks is present AND typeof "function"; NO extra runtime value
 *       export beyond the 18. NEVER `length === 18/19` alone — the NAME SET is
 *       the contract (a drop/rename/leak fails by name, per C4's precedent in
 *       codex-ouronet/tests/guard-hook-surface.test.ts). (Widened from the
 *       original 16 by the codex-session-lifecycle topic's T3, which added
 *       `useCodexUnsavedChangesGuard` and `useRequestLogout` — the first task
 *       in that topic to need a genuinely new public hook, not scope creep.)
 *   (2) The 14 *View + 3 Fn-type + UseSignTransactionOptions type exports resolve
 *       through the codex-ui `/hooks` barrel (types erase at runtime, so a typed
 *       noop referencing each is the only lock — a dropped type export fails the
 *       vitest TS transform at compile time). (The third Fn-type,
 *       `RequestLogoutFn`, is the T3 addition alongside the 18-hook widening.)
 *   (3) The THREE contracts stay stable:
 *         - storage-adapter contract: `CodexAdapter` (codex-core generic seam);
 *         - key-resolver contract: `ResolvedStoaChainKeypair` (codex-core) is
 *           ASSIGNABLE to the real `IStoaChainKeypair` (the funds-critical resolver
 *           shape codex-ui's two signing hooks consume via the injected seam);
 *         - consumer-settings contract: `ConsumerSettingsView` shape present.
 *
 * The two-signing-hook resolver edge is TYPE-ONLY in codex-ui (no VALUE
 * `@stoachain`/Ouronet import — enforced by the graph guard in
 * codex-ouronet/tests/structural-guards.test.ts). Here we only assert the TYPE
 * surface stays byte-stable, which the type-only imports below encode.
 */

import { describe, it, expect } from "vitest";

// RED anchor: the carved codex-ui hooks barrel. Does not exist yet (codex-ui is
// `export {}`), so this import fails to resolve at author time — the whole file
// is red until T9.4 lands `src/hooks/index.ts`.
import * as hooks from "../src/hooks/index.js";

// Type-only surface pins. `verbatimModuleSyntax` is on in codex-ui's tsconfig,
// so these are erased at compile — no runtime edge is created by them. They lock
// that codex-ui's `/hooks` barrel re-exports each View/Fn type by name.
import type {
  CodexView,
  ActiveWalletView,
  CodexAuthView,
  StoaChainSeedsView,
  PureKeypairsView,
  OuroAccountsView,
  AddressBookView,
  WatchListView,
  CodexBackupView,
  CodexLifecycleView,
  CodexIdentityView,
  CodexGuardView,
  ConsumerSettingsView,
  SignTransactionView,
  RequestPasswordFn,
  RequestLogoutFn,
  GetKeypairFn,
  UseSignTransactionOptions,
} from "../src/hooks/index.js";

// Contract-1 (storage adapter) + contract-2 (key resolver) types from the
// headless core substrate codex-ui builds on. Mapped via tsconfig `paths`
// (`@ancientpantheon/codex-core` → codex-core/src/index.ts).
import type {
  CodexAdapter,
  CodexSnapshotBase,
  ResolvedStoaChainKeypair,
} from "@ancientpantheon/codex-core";

// The real StoaChain keypair the resolver contract must produce. Type-only import
// from the Ouronet resolver subpath (erased at runtime — no VALUE edge, allowed
// by the type-only-import pin). `ResolvedStoaChainKeypair` must stay assignable to
// this or the two signing hooks break byte-stability (funds-critical, N-04).
import type { IStoaChainKeypair } from "@ancientpantheon/codex-ouronet/resolver";

// The authoritative enumerated hook set, mechanically mirrored from the source
// barrel `ouronet-codex/src/hooks/index.ts` (18 hook FUNCTIONS). The "hook"
// companions `RequestPasswordFn` and `RequestLogoutFn` in the spec prose are
// TYPES, not functions, so the FUNCTION surface is 18, not 20.
//
// `useCodexUnsavedChangesGuard` and `useRequestLogout` are the
// codex-session-lifecycle topic's T3 additions (widened from the original
// 16-hook D5-carve set — see this file's header comment).
const EXPECTED_HOOK_FUNCTIONS = [
  "useCodex",
  "useActiveWallet",
  "useCodexAuth",
  "useRequestPassword",
  "useGetKeypair",
  "useSignTransaction",
  "useStoaChainSeeds",
  "usePureKeypairs",
  "useOuroAccounts",
  "useAddressBook",
  "useWatchList",
  "useCodexBackup",
  "useCodexLifecycle",
  "useCodexIdentity",
  "useCodexGuard",
  "useConsumerSettings",
  "useCodexUnsavedChangesGuard",
  "useRequestLogout",
] as const;

describe("codex-ui /hooks surface — forward lock (each enumerated hook present)", () => {
  // A parametrized case per NAME: a dropped/renamed hook fails HERE naming the
  // missing symbol, not as an opaque count mismatch a reader must decode.
  it.each(EXPECTED_HOOK_FUNCTIONS)(
    "exports %s as a callable function",
    (name) => {
      const value = (hooks as Record<string, unknown>)[name];
      expect(typeof value).toBe("function");
    },
  );

  it("exposes all 18 contracted hook functions (cardinality floor pinned by the NAME set)", () => {
    // Guards the it.each roster itself: if the allow-list is edited down, the
    // count of PRESENT-and-callable names drops below 18 and this fails. The
    // count is derived from the enumerated names, never a bare `=== 18`.
    const present = EXPECTED_HOOK_FUNCTIONS.filter(
      (name) => typeof (hooks as Record<string, unknown>)[name] === "function",
    );
    expect(present).toHaveLength(EXPECTED_HOOK_FUNCTIONS.length);
  });
});

describe("codex-ui /hooks surface — negative lock (surface does not widen)", () => {
  it("exposes EXACTLY the 18 allow-listed function exports — no extras", () => {
    // An `export *` regression, a leaked helper, or an un-allow-listed new hook
    // adds a name to the sorted set here and FAILS, naming the offender via the
    // set diff.
    const runtimeFunctionExports = Object.keys(hooks)
      .filter(
        (name) => typeof (hooks as Record<string, unknown>)[name] === "function",
      )
      .sort();
    expect(runtimeFunctionExports).toEqual([...EXPECTED_HOOK_FUNCTIONS].sort());
  });

  it("exposes NO runtime VALUE export outside the 18 hook functions", () => {
    // Broader than the function-set check: any own enumerable runtime export
    // (const/object/class/re-exported value helper) that is not one of the 18
    // hooks is a surface widening. Types erase, so a clean barrel has only the
    // 18 function keys.
    const allow = new Set<string>(EXPECTED_HOOK_FUNCTIONS);
    const stray = Object.keys(hooks).filter((name) => !allow.has(name));
    expect(stray).toEqual([]);
  });
});

describe("codex-ui /hooks surface — type-shape lock (view/fn type exports present)", () => {
  it("references every contracted *View / Fn / options type so a dropped type export fails the TS transform", () => {
    // Types erase at runtime — nothing to assert on `hooks` for them. Bind one
    // typed noop per type export: if any of the 14 *View, the two Fn-type
    // aliases, or UseSignTransactionOptions is dropped/renamed from the codex-ui
    // barrel, THIS FILE stops type-checking and the vitest TS transform fails —
    // the compile-time equivalent of the runtime forward lock above.
    const acceptType = <T,>(_value?: T): void => {};

    acceptType<CodexView>();
    acceptType<ActiveWalletView>();
    acceptType<CodexAuthView>();
    acceptType<StoaChainSeedsView>();
    acceptType<PureKeypairsView>();
    acceptType<OuroAccountsView>();
    acceptType<AddressBookView>();
    acceptType<WatchListView>();
    acceptType<CodexBackupView>();
    acceptType<CodexLifecycleView>();
    acceptType<CodexIdentityView>();
    acceptType<CodexGuardView>();
    acceptType<ConsumerSettingsView>();
    acceptType<SignTransactionView>();
    acceptType<RequestPasswordFn>();
    acceptType<RequestLogoutFn>();
    acceptType<GetKeypairFn>();
    acceptType<UseSignTransactionOptions>();

    expect(acceptType).toBeInstanceOf(Function);
  });
});

describe("codex-ui surface — the three cross-package contracts stay stable", () => {
  it("contract-1 (storage adapter): CodexAdapter exposes the seam methods codex-ui builds on", () => {
    // Compile-time pin: a CodexAdapter value must carry the load/save/subscribe
    // seam. The typed shape below fails the TS transform if the codec-core
    // adapter contract drops or renames a method. The runtime assertion just
    // keeps the case non-empty; the real lock is the structural type.
    const shape = (
      adapter: CodexAdapter<CodexSnapshotBase, unknown>,
    ): CodexAdapter<CodexSnapshotBase, unknown> => adapter;
    expect(shape).toBeInstanceOf(Function);
  });

  it("contract-2 (key resolver): ResolvedStoaChainKeypair is ASSIGNABLE to the real IStoaChainKeypair (funds-critical)", () => {
    // The two signing hooks consume an injected resolver whose keypair is a
    // core-side `ResolvedStoaChainKeypair`. If that structural mirror ever drifts
    // from the real `@stoachain` `IStoaChainKeypair`, this assignment fails the TS
    // transform — catching a byte-stability break BEFORE it reaches the signer.
    const asKadenaKeypair = (r: ResolvedStoaChainKeypair): IStoaChainKeypair => r;
    expect(asKadenaKeypair).toBeInstanceOf(Function);
  });

  it("contract-3 (consumer settings): ConsumerSettingsView keeps its named per-consumer shape", () => {
    // ConsumerSettingsView is re-exported through codex-ui's /hooks barrel; the
    // typed noop above (type-shape lock) already pins its presence. Here we pin
    // that the type is USABLE as a value-carrying view shape a consumer reads.
    const readView = (v: ConsumerSettingsView): ConsumerSettingsView => v;
    expect(readView).toBeInstanceOf(Function);
  });
});
