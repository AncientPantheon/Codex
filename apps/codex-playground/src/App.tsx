// ============================================================================
// The codex-playground App shell — the D6 terminus.
//
// It mounts the REAL codex-ouronet dashboard (CodexProvider + CodexUiRoot + the
// STAY tabs) against a file-upload-hydrated MemoryCodexAdapter, driving the two
// explicit load modes (D-12, N-11). No dashboard fork, no throwaway UI: the
// shipped shell renders verbatim; the playground differs from the future
// standalone wallet only in the adapter (file-upload instead of cloud) and the
// login (a minimal unlock screen / no login instead of cloud login).
//
//   - mode-2 (plaintext fixture): loadCodex("plaintext", snapshot) hydrates a
//     fresh adapter PRE-MOUNT (pure saveAll), then <CodexProvider adapter=…>
//     renders the dashboard DIRECTLY — no encrypted secrets, so no unlock.
//
//   - mode-1 (encrypted backup .json + password): mount an EMPTY adapter FIRST,
//     restore the uploaded backup INTO the mounted store via the REAL
//     useCodexBackup().importFromCloud (the single-reader restore path), gate on
//     <UnlockScreen/> until useCodexAuth().authenticate seeds the cache, THEN
//     render the dashboard.
//
// The export-to-JSON button reuses the REAL useCodexBackup().downloadAsJson —
// SYMMETRIC with the mode-1 restore (both speak useCodexBackup's own
// "1.2"+pureKeypairs format); NOT a bespoke serializer.
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
} from "react";

import { CodexProvider } from "@ancientpantheon/codex-ouronet/provider";
import { CodexUiRoot, CodexTabs } from "@ancientpantheon/codex-ouronet/ui";
import {
  useCodex,
  useCodexAuth,
  useCodexBackup,
} from "@ancientpantheon/codex-ouronet/hooks";
import {
  MemoryCodexAdapter,
  type CodexSnapshot,
} from "@ancientpantheon/codex-ouronet/adapters";

import { UnlockScreen } from "./UnlockScreen";
import { hydrateFromPlaintextSnapshot } from "./loadCodex";
// The E5 app-side wiring of the generic Foreign Chains tab to the concrete
// Arweave panel. Mock+offline by DEFAULT; the mock ⇄ real toggle drives the mode.
import { ForeignChainsWiring } from "./ForeignChainsWiring";
import {
  ArweaveModeToggle,
  DEFAULT_GATEWAY_URL,
} from "./ArweaveModeToggle";
import {
  ARWEAVE_WIRING_MODE_MOCK,
  type ArweaveWiringMode,
} from "./ForeignChainsWiring";
// The T10.3 committed throwaway fixtures — CONSUMED here (not created).
import { emptySnapshot, populatedKadenaSnapshot } from "../fixtures";

/** What the App is currently rendering: the landing picker, or a mounted mode. */
type LoadedState =
  | { kind: "idle" }
  | { kind: "plaintext"; adapter: MemoryCodexAdapter }
  | { kind: "encrypted"; adapter: MemoryCodexAdapter; backupText: string };

/**
 * The dashboard body — the real shipped shell + the export button. Rendered
 * inside <CodexProvider> so its hooks (useCodexBackup) see the mounted store.
 */
function Dashboard(): ReactElement {
  const { downloadAsJson } = useCodexBackup();

  // The Arweave path defaults to MOCK + OFFLINE (funds-safety, N-11): the app
  // boots mock; the user must explicitly opt into real via the toggle. The
  // toggle owns the mode + gateway-URL UI and reports them upward here, so the
  // wiring below only constructs the real E1-E3 stack once mode === "real".
  const [arweaveMode, setArweaveMode] = useState<ArweaveWiringMode>(
    ARWEAVE_WIRING_MODE_MOCK,
  );
  const [gatewayUrl, setGatewayUrl] = useState<string>(DEFAULT_GATEWAY_URL);

  return (
    <CodexUiRoot>
      <button type="button" onClick={() => void downloadAsJson()}>
        Export codex to JSON
      </button>
      <CodexTabs />
      {/* The Arweave path — the generic Foreign Chains tab wired to the concrete
          ArweavePanel via the app (codex-ui stays Arweave-free). The mock ⇄ real
          toggle drives the wiring mode; default is mock+offline (funds-safety). */}
      <section aria-label="Foreign chains">
        <h2>Foreign chains</h2>
        <ArweaveModeToggle
          initialMode={arweaveMode}
          initialGatewayUrl={gatewayUrl}
          onModeChange={setArweaveMode}
          onGatewayUrlChange={setGatewayUrl}
        />
        <ForeignChainsWiring mode={arweaveMode} gatewayUrl={gatewayUrl} />
      </section>
    </CodexUiRoot>
  );
}

/**
 * Mode-1 body — mounted inside an EMPTY <CodexProvider>. On mount it restores the
 * uploaded backup INTO the mounted store via the REAL importFromCloud (a hook
 * that operates on the mounted store — it cannot run pre-mount), then gates the
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
      // bytes, no password). Surface it and offer the picker instead of hanging
      // forever on the "Restoring backup…" spinner.
      .catch((err: unknown) => {
        setRestoreError(err instanceof Error ? err.message : String(err));
      });
  }, [isReady, importFromCloud, backupText]);

  if (restoreError !== null) {
    return (
      <main>
        <p role="alert">Could not restore backup: {restoreError}</p>
        <button type="button" onClick={onReset}>
          Try another file
        </button>
      </main>
    );
  }
  if (!restored) {
    return <p>Restoring backup…</p>;
  }
  if (isLocked) {
    return <UnlockScreen />;
  }
  return <Dashboard />;
}

export function App(): ReactElement {
  const [loaded, setLoaded] = useState<LoadedState>({ kind: "idle" });
  const [loadError, setLoadError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setLoadError(null);
    setLoaded({ kind: "idle" });
  }, []);

  const loadPlaintext = useCallback(async (snapshot: CodexSnapshot) => {
    try {
      const adapter = await hydrateFromPlaintextSnapshot(snapshot);
      setLoaded({ kind: "plaintext", adapter });
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
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
      <main>
        <p role="alert">Could not load codex: {loadError}</p>
        <button type="button" onClick={reset}>
          Try another file
        </button>
      </main>
    );
  }

  if (loaded.kind === "idle") {
    return (
      <LandingPicker
        onLoadEmpty={() => void loadPlaintext(emptySnapshot)}
        onLoadPopulated={() => void loadPlaintext(populatedKadenaSnapshot)}
        onUploadBackup={loadEncrypted}
      />
    );
  }

  if (loaded.kind === "plaintext") {
    // Mode-2: hydrated pre-mount → render the dashboard directly (skip unlock).
    return (
      <CodexProvider adapter={loaded.adapter} deviceVariant="dev">
        <Dashboard />
      </CodexProvider>
    );
  }

  // Mode-1: mount empty → restore → unlock → dashboard.
  return (
    <CodexProvider adapter={loaded.adapter} deviceVariant="dev">
      <EncryptedSession backupText={loaded.backupText} onReset={reset} />
    </CodexProvider>
  );
}

/**
 * The landing screen — two explicit entry points (NO byte-sniffing): the
 * plaintext-fixture buttons (mode-2) and the encrypted-backup file input (mode-1).
 */
function LandingPicker({
  onLoadEmpty,
  onLoadPopulated,
  onUploadBackup,
}: {
  onLoadEmpty: () => void;
  onLoadPopulated: () => void;
  onUploadBackup: (event: ChangeEvent<HTMLInputElement>) => void;
}): ReactElement {
  return (
    <main>
      <h1>Codex Playground</h1>

      <section>
        <h2>Load plaintext fixture</h2>
        <button type="button" onClick={onLoadEmpty}>
          Load empty plaintext fixture
        </button>
        <button type="button" onClick={onLoadPopulated}>
          Load populated Kadena plaintext fixture
        </button>
      </section>

      <section>
        <h2>Load encrypted backup</h2>
        <label htmlFor="codex-backup-file">Load encrypted backup (.json)</label>
        <input
          id="codex-backup-file"
          type="file"
          accept="application/json,.json"
          onChange={onUploadBackup}
        />
      </section>
    </main>
  );
}
