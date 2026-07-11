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
  CodexTabs,
  CodexSettingsSection,
  CodexDebouncerPanel,
  ApolloVerifyView,
} from "@ancientpantheon/codex-ouronet/ui";
import { ObservationalCodexIdDisplay, CodexPasswordPrompt } from "@ancientpantheon/codex-ui/ui";
import {
  useCodex,
  useCodexAuth,
  useCodexBackup,
} from "@ancientpantheon/codex-ouronet/hooks";
import { MemoryCodexAdapter } from "@ancientpantheon/codex-ouronet/adapters";
import type { NetworkSettingsModel } from "@ancientpantheon/codex-core";

import { UnlockScreen } from "./UnlockScreen";
// The E5 app-side wiring of the generic Foreign Chains tab to the concrete
// Arweave panel. Mock+offline by DEFAULT; the mock ⇄ real toggle drives the mode.
import { ForeignChainsWiring } from "./ForeignChainsWiring";
import { ArweaveModeToggle } from "./ArweaveModeToggle";
import {
  ARWEAVE_WIRING_MODE_MOCK,
  type ArweaveWiringMode,
} from "./ForeignChainsWiring";
import {
  loadNetworkSettings,
  saveNetworkSettings,
  resolveNetworkModel,
  STOACHAIN_CHAIN_ID,
  ARWEAVE_CHAIN_ID,
  type NetworkSettings,
} from "./networkSettings";
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
 */
export function Dashboard({
  onReset,
}: {
  onReset?: () => void;
} = {}): ReactElement {
  const { downloadAsJson } = useCodexBackup();
  const { isReady } = useCodex();
  const store = useCodexStore();

  // The surfaced, editable, UNLOCKED network config (CL-13): the StoaChain node +
  // Arweave gateway, restored from localStorage (defaults to the local/testnet
  // endpoints). Standalone → both chains are LOCAL, editable rows.
  const [network, setNetwork] = useState<NetworkSettings>(() => loadNetworkSettings());

  // The Arweave path defaults to MOCK + OFFLINE (funds-safety, N-11): the app
  // boots mock; the user must explicitly opt into real via the toggle. The
  // toggle owns the mode + gateway-URL UI and reports them upward here, so the
  // wiring below only constructs the real E1-E3 stack once mode === "real".
  // The gateway seed comes from the surfaced network state so the Network card
  // and the toggle read one source of truth.
  const [arweaveMode, setArweaveMode] = useState<ArweaveWiringMode>(
    ARWEAVE_WIRING_MODE_MOCK,
  );
  const gatewayUrl = network.arweaveGatewayUrl;
  const setGatewayUrl = useCallback(
    (url: string) => setNetwork((prev) => ({ ...prev, arweaveGatewayUrl: url })),
    [],
  );

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

  return (
    <div className="cxpg-container">
      {/* Global codex password prompt — the modal the CodexID lock control opens.
          Kept OUT of the header flow (mirrors OuronetUI's codex-ui route). */}
      <CodexUiRoot>
        <CodexPasswordPrompt />
      </CodexUiRoot>

      {/* ── Header — title + version + badge + tagline, section pills BELOW (all
          left-aligned); the standalone Export/Load + the debouncer pinned right. */}
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
            <CodexDebouncerPanel />
          </CodexUiRoot>
        </div>
      </div>

      {/* ── Body card — the CodexID surface + a golden separator + the tabs/settings,
          unified into ONE card (mirrors OuronetUI). ObservationalCodexIdDisplay owns
          its own Copy/Lock/details, so no separate lock control here. */}
      <div className="cxpg-bodycard">
        <CodexUiRoot>
          <ObservationalCodexIdDisplay />
        </CodexUiRoot>
        <div className="cxpg-separator" aria-hidden="true" />
        <CodexUiRoot>
          {activeView === "ui" ? (
            <>
              <CodexTabs />
              {/* The Arweave path — the generic Foreign Chains tab wired to the
                  concrete ArweavePanel via the app; mock ⇄ real toggle (default
                  mock+offline). The foreign-chain UX itself is a later pass. */}
              <section className="cxpg-foreign" aria-label="Foreign chains">
                <h2 className="cxpg-foreign-title">Foreign chains</h2>
                <ArweaveModeToggle
                  initialMode={arweaveMode}
                  initialGatewayUrl={gatewayUrl}
                  onModeChange={setArweaveMode}
                  onGatewayUrlChange={setGatewayUrl}
                />
                <ForeignChainsWiring mode={arweaveMode} gatewayUrl={gatewayUrl} />
              </section>
            </>
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
    </div>
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
