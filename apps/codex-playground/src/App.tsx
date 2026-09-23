// ============================================================================
// The codex-playground App shell — the standalone local Codex.
//
// It mounts the REAL codex-ouronet dashboard (CodexProvider + CodexUiRoot + the
// STAY tabs) against a file-upload-hydrated MemoryCodexAdapter. The product flow
// is a single path: no codex loaded → a clean "Load your Codex" screen; upload
// the encrypted `.json` you exported from your wallet → restore it into the
// mounted store via the REAL useCodexBackup().importFromCloud → unlock with your
// password → the full Codex UI.
//
//   mount an EMPTY adapter FIRST, restore the uploaded backup INTO the mounted
//   store via importFromCloud (the single-reader restore path — a hook that
//   operates on the mounted store, so it can't run pre-mount), gate on
//   <UnlockScreen/> until useCodexAuth().authenticate seeds the cache, THEN
//   render the dashboard.
//
// The export-to-JSON button reuses the REAL useCodexBackup().downloadAsJson —
// SYMMETRIC with the restore (both speak useCodexBackup's own codec format);
// NOT a bespoke serializer.
//
// NOTE: `Dashboard` is exported so tests can mount it directly against a
// plaintext-hydrated store (see loadCodex.hydrateFromPlaintextSnapshot) without
// exercising the encrypt/unlock round-trip — that hydration utility is a test/dev
// seam and is deliberately NOT surfaced in the product UI (you always load a real
// exported codex).
//
// SECRET HYGIENE (N-06): nothing here logs a password, a snapshot, or a backup
// blob. The uploaded backup text is handed straight to importFromCloud; the
// password lives only inside <UnlockScreen>'s masked input.
// ============================================================================

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ReactElement,
  type ReactNode,
} from "react";

import { CodexProvider } from "@ancientpantheon/codex-ouronet/provider";
import { useCodexStore } from "@ancientpantheon/codex-ouronet/provider";
import {
  CodexUiRoot,
  CodexSettingsSection,
  CodexDebouncerPanel,
  DebouncerInfoModal,
  ApolloVerifyView,
  ViewSeedModal,
} from "@ancientpantheon/codex-ouronet/ui";
import {
  ObservationalCodexIdDisplay,
  CodexPasswordPrompt,
  ControlsProvider,
  SwipeDeck,
} from "@ancientpantheon/codex-ui/ui";
import {
  useCodex,
  useCodexAuth,
  useCodexBackup,
} from "@ancientpantheon/codex-ouronet/hooks";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import type { NetworkSettingsModel } from "@ancientpantheon/codex-core";

import { UnlockScreen } from "./UnlockScreen";
// THE Codex tab shell for the playground: `ForeignChainsWiring` renders
// `CodexTabs` with Class 2 already fed the Arweave + Chainweb rail. Mounting a
// bare `<CodexTabs />` here instead would leave Blockchain Accounts empty.
// Mock+offline by DEFAULT; the mock ⇄ real toggle drives the mode.
import { ForeignChainsWiring } from "./ForeignChainsWiring";
import { ARWEAVE_WIRING_MODE_REAL } from "./ForeignChainsWiring";
import {
  loadNetworkSettings,
  saveNetworkSettings,
  resolveNetworkModel,
  STOACHAIN_CHAIN_ID,
  ARWEAVE_CHAIN_ID,
  type NetworkSettings,
} from "./networkSettings";
// The mobile testing scaffold (see that file's own doc comment): mimics
// OuronetUI's real mobile shell (7-icon bottom tab bar), only the "Codex" tab
// wired, so the mobile view is exercised EMBEDDED (a constrained rectangle),
// not just full-viewport standalone — the case that actually matters in
// production, per docs/work/codex-ui-mobile/design.md §1/§6.
import { OuronetShellMock, useOuronetMockMobile } from "./OuronetShellMock";
import "./app.css";

// Injected by vite.config `define` from @ancientpantheon/codex-ouronet's version.
declare const __CODEX_VERSION__: string;

/** What the App is currently rendering: the load screen, or a mounted codex. */
type LoadedState =
  | { kind: "idle" }
  | { kind: "encrypted"; adapter: MemoryCodexAdapter; backupText: string };

/**
 * The dashboard — the real shipped shell inside a slim playground chrome (title
 * + export + "load a different codex"). Rendered inside <CodexProvider> so its
 * hooks (useCodexBackup) see the mounted store. Exported so tests can mount it
 * directly against a hydrated store.
 *
 * A thin wrapper around `DashboardBody`: it owns nothing itself except the
 * `<ControlsProvider>` — the Controls registry (docs/work/codex-ui-mobile/
 * design.md §5) that `OuronetShellMock`'s Controls riser/drawer need an
 * ancestor of (currently unused — nothing registers into it yet; "Export
 * codex to JSON" / "Load a different codex" moved to the Codex-tap tier-2
 * menu instead, §8 — but future ghosted chain-tab buttons will). The
 * provider has to live OUTSIDE `DashboardBody` (a component can't consume a
 * context its own return provides), which is also why it's a separate
 * component rather than inlined into `Dashboard` itself.
 */
export function Dashboard(props: { onReset?: () => void } = {}): ReactElement {
  return (
    <ControlsProvider>
      <DashboardBody {...props} />
    </ControlsProvider>
  );
}

function DashboardBody({
  onReset,
}: {
  onReset?: () => void;
}): ReactElement {
  const { downloadAsJson } = useCodexBackup();
  const { isReady } = useCodex();
  const store = useCodexStore();

  // The full-screen modal-portal target (design.md §8 feedback round: "the
  // whole screen, not Zone 2 only"). Zone 2's own CodexUiRoot is a small,
  // fixed-height box (`.cxpg-zone2`) — a modal rendered inline there (e.g.
  // ObservationalCodexIdDisplay's seed-reveal / Guard full-screen popups)
  // would be bounded to that same small box, since CodexModalShell's mobile
  // flip is `position: absolute` against the nearest CodexUiRoot. This node
  // spans the WHOLE mobile body instead (`.cxpg-modal-portal-root`,
  // `position: absolute; inset: 0` against `.cxpg-container--mobile`) — a
  // callback ref captures it into state once mounted, since `createPortal`
  // needs the REAL DOM node, not a ref object.
  const [modalPortalRoot, setModalPortalRoot] = useState<HTMLDivElement | null>(null);

  // The header debouncer's own "What is this?" trigger (`CodexDebouncerPanel`'s
  // `onInfo`, wired identically at both its mounts below — mobile Zone 1 and
  // the desktop top bar) — this package has no router (it's embedded, not a
  // standalone page app), so the host decides what that trigger opens; here
  // it's `DebouncerInfoModal`, the package's own full-screen explainer.
  const [debouncerInfoOpen, setDebouncerInfoOpen] = useState(false);

  // The Address Book riser's target slot — owned by OuronetShellMock itself
  // (it sits flush against ITS OWN tab bar, `.cxpg-osm-addressbook-riser-
  // slot`), reported UP via a callback prop and threaded back DOWN through
  // ForeignChainsWiring to CodexTabs (owner directive: "the address book
  // stripe isn't sitting flush to the footer bar... similar to the controls
  // stripe" — CodexTabs' own frame sits above the real tab bar, so only the
  // shell that OWNS the tab bar can supply a node truly flush against it).
  const [addressBookRiserTarget, setAddressBookRiserTarget] = useState<HTMLDivElement | null>(null);

  // Same idea, for the Ouronet Accounts pagination stripe (design.md §8,
  // the "Zone 3" round) — centered between the Controls and Address Book
  // risers, flush to the tab bar.
  const [paginationRiserTarget, setPaginationRiserTarget] = useState<HTMLDivElement | null>(null);

  // Same idea again, for the Zone 3 swipe-bullets strip specifically
  // (design.md §8, the follow-up "Zone 3" feedback round) — a SEPARATE band
  // from the riser row above, sitting directly below Zone 3's own bordered
  // box (`.cxpg-osm-swipe-indicator-riser-slot`). Owner correction: "the
  // bullet... is something beneath Zone 3... a different entity" from the
  // Prev/Next pagination stripe. (The Ouronet Accounts / Blockchain Accounts
  // EdgeRails do NOT use this target — see `edgeRailAnchorTarget` below,
  // which the owner later redirected them to.)
  const [swipeIndicatorRiserTarget, setSwipeIndicatorRiserTarget] = useState<HTMLDivElement | null>(null);

  // The Ouronet Accounts / Blockchain Accounts EdgeRails' own anchor —
  // Zone 2's own box (via a ref set on an overlay `div` INSIDE `.cxpg-zone2`
  // below), NOT the swipe-bullets band. Owner correction (the Settings-page
  // cleanup round): "I think we should add them higher (where I've drawn
  // with red)" — pointing at the Zone 2 / Zone 3 seam. See that overlay
  // div's own doc comment for why anchoring to Zone 2 (not Zone 3) is what
  // keeps the rails from being clipped there too.
  const [edgeRailAnchorTarget, setEdgeRailAnchorTarget] = useState<HTMLDivElement | null>(null);

  // Zone 3's OWN border-box anchor (design.md §8, round 8 follow-up) — a
  // DIFFERENT target from `edgeRailAnchorTarget` above: that one is Zone
  // 2's own box, used as an (imprecise — it sits ~10px above the real
  // seam, across the inter-zone gap) proxy for "the top of Zone 3." This
  // one is Zone 3's OWN rendered border box exactly (see the wrapper `div`
  // around `.cxpg-zone3` below for how its rect is made pixel-identical),
  // so `edge="top"`/`edge="bottom"` against it are the ACTUAL visible top/
  // bottom border lines of the Zone 3 rectangle — what a badge that must
  // sit "half above the line, half below it" needs for EITHER of Zone 3's
  // own two borders, not just the seam with Zone 2 above it.
  const [zone3AnchorTarget, setZone3AnchorTarget] = useState<HTMLDivElement | null>(null);

  // The surfaced, editable, UNLOCKED network config (CL-13): the StoaChain node +
  // Arweave gateway, restored from localStorage (defaults to the local/testnet
  // endpoints). Standalone → both chains are LOCAL, editable rows.
  const [network, setNetwork] = useState<NetworkSettings>(() => loadNetworkSettings());

  // The Arweave mock ⇄ real mode + its raw, unstyled `<ArweaveModeToggle>`
  // settings-page mount were REMOVED (owner directive, the Settings-page
  // cleanup round: "that mockup bad text arweave blockchain selector...
  // it's got no purpose any more, I don't want it showing in production").
  // This is a DIFFERENT removal from a prior one (see the old comment this
  // replaces) that regressed real mode to UNREACHABLE by hardcoding mock —
  // this one does NOT touch the default: `network.arweaveMode` already
  // defaults to REAL (below) and stays that way; only the leftover,
  // never-restyled dev toggle UI is gone. The gateway URL itself was never
  // owned by that toggle anyway — it's `network.arweaveGatewayUrl`, the same
  // state the proper (already-styled) Settings → Network card's per-chain
  // URL field edits via `setChainUrl`, persisted the same way as every other
  // `network` field (the `useEffect` below saves the whole object on
  // change). `arweaveMode` itself has no user-facing control anymore —
  // fixed at REAL (its default) unless a future need reintroduces one.
  const arweaveMode = network.arweaveMode ?? ARWEAVE_WIRING_MODE_REAL;
  const gatewayUrl = network.arweaveGatewayUrl;

  // Persist the surfaced config on every edit so it survives a reload.
  useEffect(() => {
    saveNetworkSettings(network);
  }, [network]);

  // Push the StoaChain node into uiSettings (selectedNode:"custom"/customNodeUrl —
  // the Phase-3 seam the dashboard's signing/reads follow). Gated on `isReady`:
  // updateUiSettings persists through the adapter, which is wired only after the
  // provider's init effect runs — writing earlier throws "no adapter wired".
  useEffect(() => {
    if (!isReady) return;
    void store
      .getState()
      .actions.updateUiSettings({
        selectedNode: "custom",
        customNodeUrl: network.stoaChainNodeUrl,
      });
  }, [isReady, network.stoaChainNodeUrl, store]);

  // Build the per-chain NetworkSettingsModel off the surfaced state (async
  // resolve — the resolver probes coverage; standalone has no global so it
  // resolves both chains local without a network round-trip).
  const [networkModel, setNetworkModel] = useState<NetworkSettingsModel | null>(null);
  useEffect(() => {
    let live = true;
    void resolveNetworkModel(network).then((model) => {
      if (live) setNetworkModel(model);
    });
    return () => {
      live = false;
    };
  }, [network]);

  const setChainUrl = useCallback((chainId: string, url: string) => {
    setNetwork((prev) => {
      if (chainId === STOACHAIN_CHAIN_ID) return { ...prev, stoaChainNodeUrl: url };
      if (chainId === ARWEAVE_CHAIN_ID) return { ...prev, arweaveGatewayUrl: url };
      return prev;
    });
  }, []);

  const setPythiaUrl = useCallback(
    (url: string) => setNetwork((prev) => ({ ...prev, pythiaUrl: url })),
    [],
  );

  // The Codex UI / Codex UI Settings view toggle (consumer-composed — CodexUiRoot
  // is only a token-scope boundary; the split is the app's to build).
  const [activeView, setActiveView] = useState<"ui" | "settings">("ui");

  // Mobile (docs/work/codex-ui-mobile/design.md §8): the localhost-only
  // "Export codex to JSON" / "Load a different codex" buttons, AND the
  // Codex UI / Settings view toggle, are relocated OUT of the header — they
  // don't belong in a real host's persistent chrome. All three are reached
  // instead through OuronetShellMock's Codex-tap tier-2 menu (passed down as
  // `activeView`/`onSelectView`/`onExport`/`onImport` below). Desktop is
  // UNCHANGED — everything stays inline there.
  const isMobile = useOuronetMockMobile();

  const body = (
    <div className={isMobile ? "cxpg-container cxpg-container--mobile" : "cxpg-container"}>
      {/* Full-screen modal-portal target — LAST in DOM order (renders on top
          via normal stacking, no z-index needed against Zone 1/2/3), `flex:
          none` so it never consumes the container--mobile flex column's own
          space, `pointer-events: none` while empty so it doesn't block taps
          on Zone 1/2/3 beneath it — whatever gets portaled into it (a real
          CodexModalShell) sets its OWN `pointer-events: auto`. Mobile-only:
          desktop's own CodexID card never had this bug (its modals already
          render in the normal, unbounded page flow). */}
      {isMobile && (
        <div
          ref={setModalPortalRoot}
          className="cxpg-modal-portal-root"
          style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
        />
      )}

      {/* The header debouncer's own "What is this?" explainer — a SINGLE
          shared mount common to BOTH the mobile (Zone 1) and desktop
          (top bar) `CodexDebouncerPanel`s below, both of which wire their
          `onInfo` to the SAME `debouncerInfoOpen` state; portals to
          `document.body` regardless of where it sits in this tree, so its
          position here is arbitrary — this spot just avoids duplicating the
          conditional render once per branch. */}
      {debouncerInfoOpen && <DebouncerInfoModal onClose={() => setDebouncerInfoOpen(false)} />}

      {/* Global codex password prompt — the modal the CodexID lock control opens.
          Kept OUT of the header flow (mirrors OuronetUI's codex-ui route).
          MOBILE: bug fix, take 2 (design.md §8, the "further optimize round
          6" — the first attempt didn't actually fix it): `CodexUiRoot`
          renders ITS OWN `position: relative` box (see that component's own
          doc comment — it's the deliberate anchor its mobile chrome
          positions against), which is the NEAREST positioned ancestor to
          `CodexModalShell`'s mobile `position: absolute; inset: 0` sheet —
          not the outer wrapper div one level up. That inner box has no
          explicit size, so it stays 0×0 (its own content is `null` until a
          request is pending, and even pending, an absolutely-positioned
          child never contributes to ITS parent's intrinsic size either) —
          the outer wrapper being correctly sized never mattered, because
          the sheet's REAL containing block was still 0-height one level
          further in. Giving `CodexUiRoot` itself `style={{ height: "100%" }}`
          (matching every OTHER `<CodexUiRoot>` in this file, e.g. below at
          the Zone 2/Zone 3 mounts) makes ITS OWN box — the actual containing
          block — full-size, so `inset: 0` finally resolves against
          something real. `ensureCodexUnlocked()` (the seed-view /
          private-key-reveal gate) was hanging forever waiting on a prompt
          the user could never see or submit — "clicking it it rotates
          forever and nothing happens." Desktop's own dialog is `position:
          fixed` (viewport-relative, ancestor size never mattered), which is
          why this never surfaced there. */}
      {isMobile ? (
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
          <CodexUiRoot style={{ height: "100%" }}>
            <CodexPasswordPrompt />
          </CodexUiRoot>
        </div>
      ) : (
        <CodexUiRoot>
          <CodexPasswordPrompt />
        </CodexUiRoot>
      )}

      {isMobile ? (
        <>
          {/* Thin mobile brand row — above Zone 1, matching OuronetUI's own
              ordering (brand row, THEN the account/timers zone). Codex UI /
              Settings / Export / Import all moved to OuronetShellMock's
              Codex-tap tier-2 menu. `flex: none` — reserved, never scrolls. */}
          <div className="cxpg-titlerow cxpg-titlerow--mobile">
            <h1 className="cxpg-brand">
              <span className="cxpg-brand-mark" aria-hidden="true">◈</span>
              Codex
            </h1>
            <span className="cxpg-version" title="@ancientpantheon/codex-ouronet version">
              v{__CODEX_VERSION__}
            </span>
            <span className="cxpg-badge">standalone</span>
          </div>

          {/* ── Zone 1 (design.md §8, corrected) — the debouncer, alone, in
              the SAME reserved rectangle OuronetUI keeps its account-card ⇄
              timers swipe rail in. RESERVED — `flex: none`, never scrolls
              away, exactly like OuronetUI's own header doesn't. No account
              selector exists standalone, so this zone is just the one pane —
              but it's the same slot/shape a real embedded host would give
              this zone its 3rd swipe pane in (see the cross-repo request
              filed against OuronetUI's MobileHeader). ── */}
          <div className="cxpg-zone1">
            <CodexUiRoot style={{ width: "100%" }}>
              {/* `showSingleDot`: the SAME zone shape a real embedded host's
                  2-swipe (account ⇄ timers) rail has — just ONE dot here,
                  not zero, since standalone has only the one pane. */}
              {/* Owner correction (the Settings-page cleanup round): "the
                  debouncer should be positioned in the middle, since it
                  isn't." `.cxpg-zone1`'s own `justify-content: center`
                  centered the debouncer fine before it was wrapped in a
                  `SwipeDeck` (design.md §8's Zone 1 round) — `SwipeDeck`'s
                  internal scroller (`display: flex; overflow-x: auto`) plus
                  its slide's `flexBasis: "100%"` resolve to an indefinite
                  width up that chain, so `CodexDebouncerPanel`'s own
                  shrink-to-fit `inline-grid` box no longer reliably centers
                  within it. An explicit `justify-content: center` wrapper
                  INSIDE the slide fixes it regardless of whatever width the
                  slide itself ends up resolving to. */}
              <SwipeDeck showSingleDot>
                <div style={{ display: "flex", justifyContent: "center" }}>
                  <CodexDebouncerPanel onInfo={() => setDebouncerInfoOpen(true)} />
                </div>
              </SwipeDeck>
            </CodexUiRoot>
          </div>

          {/* The "fixed bar separator from everything else" between Zone 1
              and the rest of the shell. */}
          <div className="cxpg-zone1-separator" aria-hidden="true" />

          {/* ── Zone 2 (design.md §8, corrected) — the CodexID SwipeDeck, in
              a BOUNDED box matching OuronetUI's own Zone 2 card (title bar +
              ~3 content lines + dots, same size/area/positioning) — ALSO
              reserved (`flex: none`), stays in place exactly like Zone 1,
              never scrolling with Zone 3 beneath it. `renderViewSeedModal`
              wires the REAL Ouronet-account seed-reveal UI (full-screen on
              mobile via CodexModalShell's existing flip) so the Reveal Seed
              buttons actually work, instead of silently doing nothing. ── */}
          <div className="cxpg-zone2" style={{ position: "relative" }}>
            <CodexUiRoot style={{ height: "100%" }}>
              <ObservationalCodexIdDisplay
                renderViewSeedModal={(args) => (
                  <ViewSeedModal isOpen={args.isOpen} onClose={args.onClose} account={args.account} name={args.name} />
                )}
                fullScreenPortalTarget={modalPortalRoot}
              />
            </CodexUiRoot>
            {/* The EdgeRail semicircles' anchor — owner correction (the
                Settings-page cleanup round): "I think we should add them
                higher (where I've drawn with red)" — pointing at the
                Zone 2 / Zone 3 seam, not the gap below Zone 3. A DESCENDANT
                of `.cxpg-zone2` (which has NO `overflow` clipping, unlike
                `.cxpg-zone3`'s `overflow-y: auto`), `inset: 0` so its own
                box exactly matches Zone 2's — `edge="bottom"` on the portaled
                rails then straddles ITS bottom seam (= the Zone 2/Zone 3
                boundary), and the half that spills below Zone 2's border
                into Zone 3's visual space is NEVER clipped, because CSS
                `overflow` only clips DESCENDANTS of the clipping element,
                and this node isn't one — it just happens to render in the
                same screen region. `pointer-events: none` while otherwise
                empty so it doesn't block taps on the CodexID content beneath
                it; the rails set their own `pointer-events: auto`. */}
            <div ref={setEdgeRailAnchorTarget} style={{ position: "absolute", inset: 0, pointerEvents: "none" }} />
          </div>

          {/* ── Zone 3 / core zone (design.md §8) — the ONLY scrolling
              region. `height: 100%` on this CodexUiRoot gives `CodexTabs`
              (mounted inside, via ForeignChainsWiring) a bounded box to fill
              exactly, so ITS OWN EdgeRails-vs-inner-scroller split (not this
              div's `overflow-y: auto`, which is Settings' fallback only)
              is what keeps the rails pinned to the screen edge.
              Wrapped in an extra `position: relative` shell (round 8 follow-
              up — owner correction: "the expand/collapse medallion needs to
              be placed on the lower line of the zone 3 rectangle... half
              above the line and half below it... that's true for the other
              two medallions [top]... they now sit ON the line [not
              straddling it]"): `.cxpg-zone3`'s OWN box has `overflow-y:
              auto`, so anything positioned to poke past ITS OWN border (to
              straddle it half-in-half-out) gets clipped by that same
              overflow — the exact clipping bug `edgeRailAnchorTarget`
              already solves for Zone 2's seam. `.cxpg-zone3`'s own margin
              (10px 14px 46px) moves up to THIS wrapper (zeroed on the
              class itself below) so the wrapper's box is pixel-identical to
              `.cxpg-zone3`'s rendered border box — `zone3AnchorTarget`'s
              `top`/`bottom` edges are then EXACTLY the rectangle's visible
              top/bottom border lines, not an approximation via a
              neighbouring zone's own edge (Zone 2's bottom, used before,
              sits ~10px too high — the actual bug this replaces: "you
              placed them one level to high"). ── */}
          <div style={{ position: "relative", flex: 1, minHeight: 0, display: "flex", flexDirection: "column", margin: "10px 14px 46px" }}>
            <div className="cxpg-zone3" style={{ margin: 0, flex: 1, minHeight: 0 }}>
              <CodexUiRoot style={{ height: "100%" }}>
                {activeView === "ui" ? (
                  <ForeignChainsWiring
                    mode={arweaveMode}
                    gatewayUrl={gatewayUrl}
                    addressBookRiserTarget={addressBookRiserTarget}
                    paginationRiserTarget={paginationRiserTarget}
                    swipeIndicatorRiserTarget={swipeIndicatorRiserTarget}
                    edgeRailAnchorTarget={edgeRailAnchorTarget}
                    zone3AnchorTarget={zone3AnchorTarget}
                    fullScreenPortalTarget={modalPortalRoot}
                  />
                ) : (
                <CodexSettingsSection
                  consumerName="Codex Playground"
                  network={
                    networkModel
                      ? {
                          model: networkModel,
                          urls: {
                            [STOACHAIN_CHAIN_ID]: network.stoaChainNodeUrl,
                            [ARWEAVE_CHAIN_ID]: network.arweaveGatewayUrl,
                          },
                          onSetChainUrl: setChainUrl,
                          pythiaUrl: network.pythiaUrl,
                          onSetPythiaUrl: setPythiaUrl,
                        }
                      : undefined
                  }
                />
                )}
              </CodexUiRoot>
            </div>
            {/* Zone 3's OWN border-box anchor — see the wrapper's doc
                comment above. `pointer-events: none` while otherwise empty
                so it never blocks ordinary Zone 3 taps/scrolls underneath
                it; the portaled medallions set their own `pointer-events:
                auto` the same way `edgeRailAnchorTarget`'s occupants do. */}
            <div ref={setZone3AnchorTarget} style={{ position: "absolute", inset: 0, pointerEvents: "none" }} />
          </div>
        </>
      ) : (
        <>
          {/* ── Header — title + version + badge + tagline, section pills BELOW
              (all left-aligned); the standalone Export/Load + the debouncer
              pinned right. Desktop-only, unchanged. ── */}
          <div className="cxpg-topbar">
            <div className="cxpg-topbar-left">
              <div className="cxpg-titlerow">
                <h1 className="cxpg-brand">
                  <span className="cxpg-brand-mark" aria-hidden="true">◈</span>
                  Codex
                </h1>
                <span className="cxpg-version" title="@ancientpantheon/codex-ouronet version">
                  v{__CODEX_VERSION__}
                </span>
                <span className="cxpg-badge">standalone</span>
                <p className="cxpg-tagline">The standalone Codex — your multi-chain key vault, local &amp; offline.</p>
              </div>
              <div className="cxpg-viewtabs" role="tablist" aria-label="Codex view">
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeView === "ui"}
                  className={`cxpg-viewtab${activeView === "ui" ? " cxpg-viewtab--active" : ""}`}
                  onClick={() => setActiveView("ui")}
                >
                  Codex UI
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeView === "settings"}
                  className={`cxpg-viewtab${activeView === "settings" ? " cxpg-viewtab--active" : ""}`}
                  onClick={() => setActiveView("settings")}
                >
                  Codex UI Settings
                </button>
              </div>
            </div>
            <div className="cxpg-topbar-right">
              <div className="cxpg-codexbar-actions">
                <button
                  type="button"
                  className="cxpg-btn cxpg-btn--primary cxpg-btn--sm"
                  onClick={() => void downloadAsJson()}
                >
                  Export codex to JSON
                </button>
                {onReset ? (
                  <button
                    type="button"
                    className="cxpg-btn cxpg-btn--ghost cxpg-btn--sm"
                    onClick={onReset}
                  >
                    Load a different codex
                  </button>
                ) : null}
              </div>
              <CodexUiRoot>
                <CodexDebouncerPanel onInfo={() => setDebouncerInfoOpen(true)} />
              </CodexUiRoot>
            </div>
          </div>

          {/* ── Body card — the CodexID surface + a golden separator + the
              tabs/settings, unified into ONE card (mirrors OuronetUI).
              ObservationalCodexIdDisplay owns its own Copy/Lock/details, so
              no separate lock control here. Desktop-only, unchanged. ── */}
          <div className="cxpg-bodycard">
            <CodexUiRoot>
              <ObservationalCodexIdDisplay />
            </CodexUiRoot>
            <div className="cxpg-separator" aria-hidden="true" />
            <CodexUiRoot>
              {activeView === "ui" ? (
                /* THE single Codex tab shell. `ForeignChainsWiring` renders
                   `CodexTabs` itself, fed the Arweave+Chainweb rail — so the
                   Blockchain Accounts Class tab IS the wired rail rather than an
                   empty Class 2 with a duplicate rail section beside it. Real
                   mode is now the default (owner directive) — no toggle box
                   sits on this view any more; it lives in Settings → Network
                   instead, alongside the gateway URL field it edits. */
                <ForeignChainsWiring mode={arweaveMode} gatewayUrl={gatewayUrl} />
              ) : (
                <CodexSettingsSection
                  consumerName="Codex Playground"
                  network={
                    networkModel
                      ? {
                          model: networkModel,
                          urls: {
                            [STOACHAIN_CHAIN_ID]: network.stoaChainNodeUrl,
                            [ARWEAVE_CHAIN_ID]: network.arweaveGatewayUrl,
                          },
                          onSetChainUrl: setChainUrl,
                          pythiaUrl: network.pythiaUrl,
                          onSetPythiaUrl: setPythiaUrl,
                        }
                      : undefined
                  }
                />
              )}
            </CodexUiRoot>
          </div>
        </>
      )}
    </div>
  );

  // Mobile: wrap the whole dashboard in the OuronetUI mock shell (see that
  // file's doc comment) — a constrained "embedded" rectangle with a 7-icon
  // bottom tab bar, only "Codex" wired. Desktop is unaffected — same `body`
  // as before this wave, rendered bare.
  return isMobile ? (
    <OuronetShellMock
      activeView={activeView}
      onSelectView={setActiveView}
      onExport={() => void downloadAsJson()}
      onImport={onReset}
      onAddressBookRiserSlotChange={setAddressBookRiserTarget}
      onPaginationRiserSlotChange={setPaginationRiserTarget}
      onSwipeIndicatorRiserSlotChange={setSwipeIndicatorRiserTarget}
    >
      {body}
    </OuronetShellMock>
  ) : (
    body
  );
}

/**
 * Mounted inside an EMPTY <CodexProvider>. On mount it restores the uploaded
 * backup INTO the mounted store via the REAL importFromCloud (a hook that
 * operates on the mounted store — it cannot run pre-mount), then gates the
 * dashboard behind <UnlockScreen/> until authenticate() unlocks the store.
 */
function EncryptedSession({
  backupText,
  onReset,
}: {
  backupText: string;
  onReset: () => void;
}): ReactElement {
  const { importFromCloud } = useCodexBackup();
  const { isLocked } = useCodexAuth();
  const { isReady } = useCodex();
  const [restored, setRestored] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const restoreStarted = useRef(false);

  useEffect(() => {
    // The provider's OWN init effect (a parent effect) sets the store's adapter;
    // child effects run first, so restore must WAIT for `isReady` — otherwise
    // importFromCloud reads a null adapter and throws. Restore exactly once
    // (StrictMode double-invokes effects; re-running would re-hydrate needlessly).
    if (!isReady || restoreStarted.current) return;
    restoreStarted.current = true;
    importFromCloud(backupText)
      .then(() => setRestored(true))
      // A malformed / wrong-version upload rejects with CodexImportError, whose
      // message names only the stage + field (already secret-free — no uploaded
      // bytes, no password). Surface it and offer the load screen instead of
      // hanging forever on the "Restoring backup…" spinner.
      .catch((err: unknown) => {
        setRestoreError(err instanceof Error ? err.message : String(err));
      });
  }, [isReady, importFromCloud, backupText]);

  if (restoreError !== null) {
    return (
      <StatusScreen>
        <p className="cxpg-error" role="alert">
          Could not restore backup: {restoreError}
        </p>
        <button type="button" className="cxpg-btn cxpg-btn--primary" onClick={onReset}>
          Try another file
        </button>
      </StatusScreen>
    );
  }
  if (!restored) {
    return (
      <StatusScreen>
        <p className="cxpg-status">Restoring backup…</p>
      </StatusScreen>
    );
  }
  if (isLocked) {
    return <UnlockScreen />;
  }
  return IS_APOLLO_VERIFY ? <ApolloVerifyView /> : <Dashboard onReset={onReset} />;
}

/** True when opened at the generic Apollo-ownership verifier route. The
 *  playground is a Vite SPA (serves index.html for unknown paths), so we branch
 *  on the pathname and render <ApolloVerifyView> instead of the Dashboard once
 *  the loaded Codex is unlocked. Relying parties (Pythia et al.) deep-link here
 *  as `/apollo-verify?accounts=…&challenge=…&rp=…&callback=…`. */
const IS_APOLLO_VERIFY =
  typeof window !== "undefined" && window.location.pathname === "/apollo-verify";

export function App(): ReactElement {
  const [loaded, setLoaded] = useState<LoadedState>({ kind: "idle" });
  const [loadError, setLoadError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setLoadError(null);
    setLoaded({ kind: "idle" });
  }, []);

  const loadEncrypted = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        const backupText = await file.text();
        // Mount an EMPTY adapter; EncryptedSession restores INTO it post-mount.
        setLoaded({
          kind: "encrypted",
          adapter: new MemoryCodexAdapter("dev"),
          backupText,
        });
      } catch (err: unknown) {
        setLoadError(err instanceof Error ? err.message : String(err));
      }
    },
    [],
  );

  if (loadError !== null) {
    return (
      <StatusScreen>
        <p className="cxpg-error" role="alert">
          Could not load codex: {loadError}
        </p>
        <button type="button" className="cxpg-btn cxpg-btn--primary" onClick={reset}>
          Try another file
        </button>
      </StatusScreen>
    );
  }

  if (loaded.kind === "idle") {
    return <LoadCodexScreen onUploadBackup={loadEncrypted} />;
  }

  // Mount empty → restore → unlock → dashboard.
  return (
    <CodexProvider adapter={loaded.adapter} deviceVariant="dev">
      <EncryptedSession backupText={loaded.backupText} onReset={reset} />
    </CodexProvider>
  );
}

/** A centered chrome wrapper for the load / status / error screens. */
function StatusScreen({ children }: { children: ReactNode }): ReactElement {
  return (
    <div className="cxpg-app cxpg-landing">
      <div className="cxpg-card cxpg-card--status">{children}</div>
    </div>
  );
}

/**
 * The load screen — the single product entry point: upload the encrypted codex
 * `.json` you exported from your wallet. No demo/fixture shortcuts; you always
 * load a real codex.
 */
function LoadCodexScreen({
  onUploadBackup,
}: {
  onUploadBackup: (event: ChangeEvent<HTMLInputElement>) => void;
}): ReactElement {
  return (
    <div className="cxpg-app cxpg-landing">
      <div className="cxpg-card">
        <div className="cxpg-logo" aria-hidden="true">
          ◈
        </div>
        <h1 className="cxpg-title">Codex</h1>
        <span className="cxpg-version cxpg-version--landing" title="@ancientpantheon/codex-ouronet version">
          v{__CODEX_VERSION__}
        </span>
        <p className="cxpg-subtitle">
          Your multi-chain key vault — local &amp; offline.
        </p>

        <label htmlFor="codex-file" className="cxpg-upload">
          <span className="cxpg-upload-icon" aria-hidden="true">
            ⭳
          </span>
          <span className="cxpg-upload-title">Load your Codex</span>
          <span className="cxpg-upload-hint">
            Choose the <code>.json</code> you exported from your wallet
          </span>
          <input
            id="codex-file"
            className="cxpg-file-input"
            type="file"
            accept="application/json,.json"
            onChange={onUploadBackup}
          />
        </label>

        <p className="cxpg-note">
          Nothing leaves this device — no account, no cloud.
        </p>
      </div>
    </div>
  );
}
