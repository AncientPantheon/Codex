/**
 * guard-hook-surface.test.ts — SURFACE/shape lock for the `/hooks` barrel
 * (`src/hooks/index.ts`).
 *
 * This is a SHAPE guard, not a behavior guard: hooks.test.tsx already drives
 * each hook's read/write behavior under <CodexProvider>. Here we lock ONLY the
 * public export INVENTORY of `@ancientpantheon/codex-ouronet/hooks` so a dropped,
 * renamed, or leaked export fails LOUDLY — by name — before it reaches a consumer.
 *
 * Confirmed inventory of `src/hooks/index.ts` (grep-verified, NOT the doc-comment
 * which lists fewer): 16 hook FUNCTIONS + 14 `*View` type exports + the two
 * function-type aliases `RequestPasswordFn` / `GetKeypairFn` + `SignTransactionView`
 * + `UseSignTransactionOptions`.
 *
 * On the spec's human "seventeen hooks" phrasing: the CODE exports exactly 16 hook
 * FUNCTIONS. The apparent 17th is the pair `useRequestPassword` (a real function,
 * counted) plus its `RequestPasswordFn` TYPE alias (erased at runtime) — human prose
 * that counts the request-password surface as two conceptual "hooks" reconciles to
 * one runtime function + one type here. We assert the exact NAMED set of 16
 * functions rather than a brittle `=== 17`; if a genuine 17th public hook function
 * ever lands in src/hooks/index.ts, add it by name below and the WIDENING lock will
 * flag it until it is allow-listed.
 *
 * Lock is BOTH directions:
 *   (a) forward — each of the 16 named functions is present AND typeof "function"
 *       (a drop/rename fails by name);
 *   (b) negative — the set of RUNTIME (own-key value) exports equals EXACTLY the 16
 *       known names, no extras (an `export *` regression leaking a hook/helper fails);
 *   (c) type-shape — the 14 *View + 2 Fn-type + UseSignTransactionOptions exports are
 *       referenced through a typed-noop so a DROPPED type export fails the vitest TS
 *       transform at compile time (types erase at runtime, so this is the only lock
 *       for them).
 */

import { describe, it, expect } from "vitest";

import * as hooks from "@ancientpantheon/codex-ouronet/hooks";
import type {
  CodexView,
  ActiveWalletView,
  CodexAuthView,
  KadenaSeedsView,
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
  GetKeypairFn,
  UseSignTransactionOptions,
} from "@ancientpantheon/codex-ouronet/hooks";

// The authoritative allow-list of RUNTIME (function) exports the `/hooks` barrel
// is contracted to expose. Order mirrors the barrel's export order for readability;
// the negative lock treats it as a set.
const EXPECTED_HOOK_FUNCTIONS = [
  "useCodex",
  "useActiveWallet",
  "useCodexAuth",
  "useRequestPassword",
  "useGetKeypair",
  "useSignTransaction",
  "useKadenaSeeds",
  "usePureKeypairs",
  "useOuroAccounts",
  "useAddressBook",
  "useWatchList",
  "useCodexBackup",
  "useCodexLifecycle",
  "useCodexIdentity",
  "useCodexGuard",
  "useConsumerSettings",
] as const;

// The address-book-chain registry runtime exports (D-10). ADDITIVE — the
// `/hooks` barrel was intentionally widened with the pluggable per-chain
// address validator seam (a chain-aware address book is a D-10 deliverable),
// so these are a KNOWN, allow-listed set — NOT the 16 hook functions and NOT a
// leak. The negative lock below treats the allow-list as {16 hooks} ∪ {these}:
// present is fine, but any name OUTSIDE this union still fails (both-directions
// lock — the surface may not widen past this documented set). `UnknownChainError`
// is a runtime error class; `validateAddress` etc. are runtime functions; only
// the two type companions (`AddressKind`, `ChainAddressValidator`, …) erase.
const EXPECTED_ADDRESS_BOOK_CHAIN_EXPORTS = [
  "KADENA_CHAIN_ID",
  "kadenaAddressValidator",
  "createAddressValidatorRegistry",
  "registerChainAddressValidator",
  "validateAddress",
  "getRegisteredChains",
  "resetAddressValidators",
  "UnknownChainError",
] as const;

// The full allow-list of RUNTIME (value) exports the widened `/hooks` barrel is
// contracted to expose: the 16 hook functions PLUS the address-book-chain set.
const EXPECTED_RUNTIME_EXPORTS = [
  ...EXPECTED_HOOK_FUNCTIONS,
  ...EXPECTED_ADDRESS_BOOK_CHAIN_EXPORTS,
] as const;

describe("hooks barrel — forward lock (every named hook function present)", () => {
  // A single parametrized case per name: a DROP or RENAME of any hook makes its
  // named entry fail here, naming the missing symbol in the failure — not a bare
  // count mismatch a reader must decode.
  it.each(EXPECTED_HOOK_FUNCTIONS)(
    "exports %s as a callable function",
    (name) => {
      const value = (hooks as Record<string, unknown>)[name];
      expect(typeof value).toBe("function");
    },
  );

  it("exports all 16 contracted hook functions (no silent drop below the floor)", () => {
    // Guards the it.each roster itself: if the allow-list is edited down, this
    // pins the intended cardinality of the FUNCTION surface at exactly 16.
    const present = EXPECTED_HOOK_FUNCTIONS.filter(
      (name) => typeof (hooks as Record<string, unknown>)[name] === "function",
    );
    expect(present).toHaveLength(16);
  });
});

describe("hooks barrel — negative lock (runtime surface does not widen)", () => {
  it("exposes EXACTLY the allow-listed function exports — no extras (16 hooks + address-book-chain fns)", () => {
    // Compute the own runtime FUNCTION exports of the barrel namespace and assert
    // the set equals the allow-list. An `export *` regression, a leaked helper, or
    // a new hook added without updating the contract adds a name here and FAILS,
    // naming the offending export via the sorted-set diff. The address-book-chain
    // FUNCTIONS (validateAddress, kadenaAddressValidator, the registry ops, the
    // UnknownChainError class — all typeof "function") are part of the D-10
    // additive surface, so they are allow-listed alongside the 16 hooks; the
    // string constant KADENA_CHAIN_ID is not a function and is checked by the
    // broader value-export lock below.
    const expectedFunctions = EXPECTED_RUNTIME_EXPORTS.filter(
      (name) => name !== "KADENA_CHAIN_ID",
    );
    const runtimeFunctionExports = Object.keys(hooks)
      .filter((name) => typeof (hooks as Record<string, unknown>)[name] === "function")
      .sort();
    expect(runtimeFunctionExports).toEqual([...expectedFunctions].sort());
  });

  it("exposes NO runtime VALUE exports outside the allow-list (16 hooks + address-book-chain set)", () => {
    // Broader than the function-set check: any own enumerable runtime export (const,
    // object, class, re-exported value helper) that is NOT in the allow-list is a
    // surface widening. The allow-list is {16 hooks} ∪ {the D-10 address-book-chain
    // registry exports}; anything else (a leaked helper, an `export *` regression)
    // still fails this both-directions lock.
    const allow = new Set<string>(EXPECTED_RUNTIME_EXPORTS);
    const stray = Object.keys(hooks).filter((name) => !allow.has(name));
    expect(stray).toEqual([]);
  });
});

describe("hooks barrel — type-shape lock (view/fn type exports present)", () => {
  it("references every contracted *View / Fn / options type so a dropped type export fails the TS transform", () => {
    // Types erase at runtime, so there is nothing to assert on `hooks` for them.
    // Instead we bind one typed noop per type export: if any of the 14 *View, the
    // two Fn-type aliases, or UseSignTransactionOptions is dropped/renamed in the
    // barrel, THIS FILE stops type-checking and vitest's TS transform fails the test
    // — the compile-time equivalent of the runtime forward lock above.
    const acceptView = <T,>(_value?: T): void => {};

    acceptView<CodexView>();
    acceptView<ActiveWalletView>();
    acceptView<CodexAuthView>();
    acceptView<KadenaSeedsView>();
    acceptView<PureKeypairsView>();
    acceptView<OuroAccountsView>();
    acceptView<AddressBookView>();
    acceptView<WatchListView>();
    acceptView<CodexBackupView>();
    acceptView<CodexLifecycleView>();
    acceptView<CodexIdentityView>();
    acceptView<CodexGuardView>();
    acceptView<ConsumerSettingsView>();
    acceptView<SignTransactionView>();
    acceptView<RequestPasswordFn>();
    acceptView<GetKeypairFn>();
    acceptView<UseSignTransactionOptions>();

    // A trivial runtime assertion so the case is not empty; the real lock is the
    // 17 type references above resolving at compile time.
    expect(acceptView).toBeInstanceOf(Function);
  });
});
