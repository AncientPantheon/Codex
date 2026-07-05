import { encryptString, decryptString } from "@stoachain/stoa-core/crypto";
import { migrateSeedType } from "@stoachain/ouronet-core/codex";
import { CodexAdapterError } from "../errors/types.js";
import {
  DEFAULT_UI_SETTINGS,
  type IKadenaSeed,
  type IOuroAccount,
  type IPureKeypair,
  type AddressBookEntry,
  type UiSettings,
  type DeviceVariant,
  type WatchListEntry,
  type IConsumerSettings,
  type ICodexIdentity,
} from "../types/entities.js";
import type { CodexAdapter, CodexSnapshot } from "./types.js";
import { emptySnapshot } from "./types.js";

/**
 * LocalStorageCodexAdapter — browser-side codex adapter using
 * `window.localStorage`. Ports OuronetUI's `LocalStorageCodexAdapter` v1.0.9
 * verbatim to preserve byte-identical persistence semantics — every existing
 * OuronetUI user's localStorage continues to work without re-loading the
 * codex when they migrate to consuming this package.
 *
 * Storage key inventory (kept stable for backwards-compat):
 *   - "wallets"                kadena seeds (JSON array)
 *   - "ouronetWallets"         ouro accounts (JSON array)
 *   - "pureKeypairs"           pure keypairs (JSON array)
 *   - "addressBook"            address book (JSON array) — NEW canonical
 *                              key (v0.1.0); legacy data was stored under
 *                              "persist:root".wallet.addressBook and is
 *                              read from there as a fallback for codices
 *                              that haven't been written-back yet.
 *   - "stoa-watch-list"        watchlist (JSON array)
 *   - "uiSettings"             plain UI settings (JSON object)
 *   - "uiSettings_enc"         encrypted UI settings sidecar
 *   - "consumerSettings"       per-consumer settings registry (JSON object,
 *                              v0.3.0+; absent on v0.2 codices → {})
 *   - "codexIdentity"          double-Apollo codex identity (JSON object,
 *                              v0.3.0+; absent/"null" on v0.2 codices →
 *                              undefined)
 *   - "codex_schema_version"   in-band schema version (string -> int)
 *   - "codex_last_updated"     ISO timestamp
 *   - "codex_device"           "dev" | "main"
 *
 * Encryption note: the `secret` fields on seeds + ouro accounts and the
 * `encryptedPrivateKey` field on pure keypairs are ALREADY encrypted by
 * the hook layer before they reach `saveAll()` / `saveKadenaSeeds()` etc.
 * This adapter does not encrypt or decrypt those — it only persists bytes.
 * The `loadUiSettingsEncrypted` / `saveUiSettingsEncrypted` pair is the
 * one exception: it owns the encrypt + decrypt of the UI-settings sidecar
 * because that's how OuronetUI does it today.
 */
export class LocalStorageCodexAdapter implements CodexAdapter {
  public readonly name = "LocalStorageCodexAdapter";

  /** Device variant — Vite consumers usually inject from
   *  `import.meta.env.VITE_APP_VARIANT`; defaults to "dev" otherwise. */
  private readonly deviceVariant: DeviceVariant;

  constructor(deviceVariant: DeviceVariant = "dev") {
    if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
      // Construct still allowed for SSR pre-hydration; methods will throw
      // CodexAdapterError on call. This lets consumers `new LocalStorage
      // CodexAdapter()` at module-eval time without crashing the bundle.
    }
    this.deviceVariant = deviceVariant;
  }

  // ----- snapshot read/write -----

  public async loadAll(): Promise<CodexSnapshot> {
    this.assertBrowser("loadAll");
    try {
      const kadenaSeeds = this.loadKadenaSeedsWithMigration();
      const ouroAccounts = this.parseArray<IOuroAccount>("ouronetWallets");
      const pureKeypairs = this.parseArray<IPureKeypair>("pureKeypairs");
      const addressBook = this.loadAddressBookWithLegacyFallback();
      const watchList = this.parseArray<WatchListEntry>("stoa-watch-list");
      const uiSettings = this.loadUiSettingsPlain();
      const consumerSettings = this.loadConsumerSettings();
      const codexIdentity = this.loadCodexIdentity();
      const schemaVersion = this.loadSchemaVersion();
      const lastUpdatedAt = window.localStorage.getItem("codex_last_updated");
      const lastUpdatedDevice = this.loadDeviceVariant();

      return {
        kadenaSeeds,
        ouroAccounts,
        pureKeypairs,
        addressBook,
        watchList,
        uiSettings,
        consumerSettings,
        codexIdentity,
        schemaVersion,
        lastUpdatedAt,
        lastUpdatedDevice,
      };
    } catch (e) {
      throw new CodexAdapterError(this.name, "loadAll", e);
    }
  }

  public async saveAll(snapshot: CodexSnapshot): Promise<void> {
    this.assertBrowser("saveAll");
    try {
      window.localStorage.setItem("wallets", JSON.stringify(snapshot.kadenaSeeds));
      window.localStorage.setItem("ouronetWallets", JSON.stringify(snapshot.ouroAccounts));
      window.localStorage.setItem("pureKeypairs", JSON.stringify(snapshot.pureKeypairs));
      window.localStorage.setItem("addressBook", JSON.stringify(snapshot.addressBook));
      window.localStorage.setItem("stoa-watch-list", JSON.stringify(snapshot.watchList));
      window.localStorage.setItem("uiSettings", JSON.stringify(snapshot.uiSettings));
      window.localStorage.setItem(
        "consumerSettings",
        JSON.stringify(snapshot.consumerSettings ?? {})
      );
      // JSON cannot encode undefined; null is the canonical absence marker.
      window.localStorage.setItem(
        "codexIdentity",
        JSON.stringify(snapshot.codexIdentity ?? null)
      );
      window.localStorage.setItem("codex_schema_version", String(snapshot.schemaVersion));
      if (snapshot.lastUpdatedAt) {
        window.localStorage.setItem("codex_last_updated", snapshot.lastUpdatedAt);
      }
      window.localStorage.setItem("codex_device", snapshot.lastUpdatedDevice);
    } catch (e) {
      throw new CodexAdapterError(this.name, "saveAll", e);
    }
  }

  // ----- per-entity convenience writes -----

  public async saveKadenaSeeds(seeds: IKadenaSeed[]): Promise<void> {
    this.assertBrowser("saveKadenaSeeds");
    try {
      window.localStorage.setItem("wallets", JSON.stringify(seeds));
    } catch (e) {
      throw new CodexAdapterError(this.name, "saveKadenaSeeds", e);
    }
  }

  public async saveOuroAccounts(accounts: IOuroAccount[]): Promise<void> {
    this.assertBrowser("saveOuroAccounts");
    try {
      window.localStorage.setItem("ouronetWallets", JSON.stringify(accounts));
    } catch (e) {
      throw new CodexAdapterError(this.name, "saveOuroAccounts", e);
    }
  }

  public async savePureKeypairs(keypairs: IPureKeypair[]): Promise<void> {
    this.assertBrowser("savePureKeypairs");
    try {
      window.localStorage.setItem("pureKeypairs", JSON.stringify(keypairs));
    } catch (e) {
      throw new CodexAdapterError(this.name, "savePureKeypairs", e);
    }
  }

  public async saveAddressBook(entries: AddressBookEntry[]): Promise<void> {
    this.assertBrowser("saveAddressBook");
    try {
      window.localStorage.setItem("addressBook", JSON.stringify(entries));
    } catch (e) {
      throw new CodexAdapterError(this.name, "saveAddressBook", e);
    }
  }

  public async saveWatchList(entries: WatchListEntry[]): Promise<void> {
    this.assertBrowser("saveWatchList");
    try {
      window.localStorage.setItem("stoa-watch-list", JSON.stringify(entries));
    } catch (e) {
      throw new CodexAdapterError(this.name, "saveWatchList", e);
    }
  }

  public async saveUiSettings(settings: UiSettings): Promise<void> {
    this.assertBrowser("saveUiSettings");
    try {
      window.localStorage.setItem("uiSettings", JSON.stringify(settings));
    } catch (e) {
      throw new CodexAdapterError(this.name, "saveUiSettings", e);
    }
  }

  public async saveConsumerSettings(
    consumerSettings: Record<string, IConsumerSettings>
  ): Promise<void> {
    this.assertBrowser("saveConsumerSettings");
    try {
      window.localStorage.setItem(
        "consumerSettings",
        JSON.stringify(consumerSettings ?? {})
      );
    } catch (e) {
      throw new CodexAdapterError(this.name, "saveConsumerSettings", e);
    }
  }

  public async saveCodexIdentity(
    identity: ICodexIdentity | undefined
  ): Promise<void> {
    this.assertBrowser("saveCodexIdentity");
    try {
      // JSON cannot encode undefined; storing null (the JSON-canonical absence
      // marker) lets loadAll normalize both "never written" and "cleared" back
      // to undefined uniformly.
      window.localStorage.setItem(
        "codexIdentity",
        JSON.stringify(identity ?? null)
      );
    } catch (e) {
      throw new CodexAdapterError(this.name, "saveCodexIdentity", e);
    }
  }

  // ----- metadata -----

  public async touch(deviceVariant: DeviceVariant): Promise<{
    lastUpdatedAt: string;
    lastUpdatedDevice: DeviceVariant;
  }> {
    this.assertBrowser("touch");
    try {
      const lastUpdatedAt = new Date().toISOString();
      window.localStorage.setItem("codex_last_updated", lastUpdatedAt);
      window.localStorage.setItem("codex_device", deviceVariant);
      return { lastUpdatedAt, lastUpdatedDevice: deviceVariant };
    } catch (e) {
      throw new CodexAdapterError(this.name, "touch", e);
    }
  }

  public async getSchemaVersion(): Promise<number> {
    this.assertBrowser("getSchemaVersion");
    return this.loadSchemaVersion();
  }

  public async setSchemaVersion(v: number): Promise<void> {
    this.assertBrowser("setSchemaVersion");
    try {
      window.localStorage.setItem("codex_schema_version", String(v));
    } catch (e) {
      throw new CodexAdapterError(this.name, "setSchemaVersion", e);
    }
  }

  // ----- encrypted UI settings sidecar -----

  public async loadUiSettingsEncrypted(
    password: string
  ): Promise<UiSettings | null> {
    this.assertBrowser("loadUiSettingsEncrypted");
    const enc = window.localStorage.getItem("uiSettings_enc");
    if (!enc) return null;
    try {
      const decrypted = await decryptString(enc, password);
      const parsed = JSON.parse(decrypted) as UiSettings;
      return parsed;
    } catch (e) {
      // Per OuronetUI's prior behaviour: on decrypt failure, fall through
      // to the plain settings (caller resolves to plain via loadAll).
      // We return null here instead of throwing so the caller has a
      // clean "no encrypted settings available" signal.
      return null;
    }
  }

  public async saveUiSettingsEncrypted(
    settings: UiSettings,
    password: string
  ): Promise<void> {
    this.assertBrowser("saveUiSettingsEncrypted");
    try {
      const enc = await encryptString(JSON.stringify(settings), password);
      window.localStorage.setItem("uiSettings_enc", enc);
    } catch (e) {
      throw new CodexAdapterError(this.name, "saveUiSettingsEncrypted", e);
    }
  }

  // ----- destructive -----

  public async clearAll(): Promise<void> {
    this.assertBrowser("clearAll");
    try {
      const keys = [
        "wallets",
        "ouronetWallets",
        "pureKeypairs",
        "addressBook",
        "stoa-watch-list",
        "uiSettings",
        "uiSettings_enc",
        "consumerSettings",
        "codexIdentity",
        "codex_schema_version",
        "codex_last_updated",
        "codex_device",
        "codex_last_downloaded",
      ];
      for (const k of keys) window.localStorage.removeItem(k);
    } catch (e) {
      throw new CodexAdapterError(this.name, "clearAll", e);
    }
  }

  // ===== Private helpers =====

  private assertBrowser(operation: string): void {
    if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
      throw new CodexAdapterError(
        this.name,
        operation,
        new Error(
          "window.localStorage is not available in this environment. " +
            "Use MemoryCodexAdapter for SSR / Node.js contexts."
        )
      );
    }
  }

  /** Parse a JSON-array localStorage value, returning [] on missing/invalid. */
  private parseArray<T>(key: string): T[] {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }

  /** Load kadena seeds with the seed-type migration applied per-entry.
   *
   *  ouronet-core v4's `migrateSeedType` is strict-by-default (throws on
   *  unknown seed types). At this boot-boundary we soften per-entry: a
   *  single corrupted entry shouldn't crash the codex load and lock the
   *  user out of Settings → Recovery. Falling back to "koala" matches
   *  OuronetUI's pre-v0.1.0 behaviour. If any migration was applied, we
   *  write back the migrated seeds so subsequent loads are clean.
   */
  private loadKadenaSeedsWithMigration(): IKadenaSeed[] {
    const raw = window.localStorage.getItem("wallets");
    if (!raw) return [];
    let parsed: unknown[];
    try {
      parsed = JSON.parse(raw) as unknown[];
      if (!Array.isArray(parsed)) return [];
    } catch {
      return [];
    }
    let migratedAny = false;
    const seeds = parsed.map((w) => {
      const wallet = w as IKadenaSeed & { seedType: string };
      const before = wallet.seedType;
      let after: IKadenaSeed["seedType"];
      try {
        after = migrateSeedType(before) as IKadenaSeed["seedType"];
      } catch {
        after = "koala";
      }
      if (before !== after) migratedAny = true;
      return { ...wallet, seedType: after } as IKadenaSeed;
    });
    if (migratedAny) {
      try {
        window.localStorage.setItem("wallets", JSON.stringify(seeds));
      } catch {
        // best-effort write-back; failure here doesn't block the load
      }
    }
    return seeds;
  }

  /** Load address book with the legacy-redux-persist fallback path.
   *
   *  Pre-v0.1.0 OuronetUI stored the address book inside
   *  `localStorage["persist:root"].wallet.addressBook` (redux-persist's
   *  serialized state). v0.1.0+ stores it under its own canonical
   *  `localStorage["addressBook"]` key. To migrate existing users, read
   *  from the canonical key first; fall back to the legacy location.
   *  Don't auto-write-back here — the hook layer does the migration
   *  on first explicit save.
   */
  private loadAddressBookWithLegacyFallback(): AddressBookEntry[] {
    const canonical = this.parseArray<AddressBookEntry>("addressBook");
    if (canonical.length > 0) return canonical;
    const persistRoot = window.localStorage.getItem("persist:root");
    if (!persistRoot) return [];
    try {
      const root = JSON.parse(persistRoot) as { wallet?: string };
      if (!root.wallet) return [];
      const wallet = JSON.parse(root.wallet) as {
        addressBook?: AddressBookEntry[];
      };
      return Array.isArray(wallet.addressBook) ? wallet.addressBook : [];
    } catch {
      return [];
    }
  }

  private loadUiSettingsPlain(): UiSettings {
    const raw = window.localStorage.getItem("uiSettings");
    if (!raw) return { ...DEFAULT_UI_SETTINGS };
    try {
      const parsed = JSON.parse(raw) as Partial<UiSettings>;
      // Merge with defaults so newly-added settings don't break older codices.
      return { ...DEFAULT_UI_SETTINGS, ...parsed };
    } catch {
      return { ...DEFAULT_UI_SETTINGS };
    }
  }

  /** Load the per-consumer settings registry, returning {} on
   *  missing/invalid. v0.2 codices have no `consumerSettings` key — they
   *  load as an empty registry. */
  private loadConsumerSettings(): Record<string, IConsumerSettings> {
    const raw = window.localStorage.getItem("consumerSettings");
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, IConsumerSettings>;
      }
      return {};
    } catch {
      return {};
    }
  }

  /** Load the codex's double-Apollo identity (v0.3.0+), returning undefined
   *  on missing/cleared/corrupted values. v0.2 codices have no `codexIdentity`
   *  key. Stored as `"null"` when cleared. The shape guard rejects scalars and
   *  arrays so a corrupted value can't masquerade as an identity and falsely
   *  satisfy a downstream truthy presence check. */
  private loadCodexIdentity(): ICodexIdentity | undefined {
    const raw = window.localStorage.getItem("codexIdentity");
    if (raw == null) return undefined;
    try {
      const parsed = JSON.parse(raw);
      if (parsed === null) return undefined;
      // codexIdentity must be a non-null object (not a number, string,
      // boolean, or array).
      if (typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
      return parsed as ICodexIdentity;
    } catch {
      // Corrupted localStorage value (third-party tampering, partial-write
      // crash) — treat as absent rather than crashing the codex load.
      return undefined;
    }
  }

  private loadSchemaVersion(): number {
    const raw = window.localStorage.getItem("codex_schema_version");
    if (!raw) return 0;
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private loadDeviceVariant(): DeviceVariant {
    const raw = window.localStorage.getItem("codex_device");
    return raw === "main" ? "main" : "dev";
  }

  /** Useful for the consumer's app-shell to plug in the right variant
   *  at provider-setup time (e.g. from `import.meta.env.VITE_APP_VARIANT`). */
  public getDeviceVariant(): DeviceVariant {
    return this.deviceVariant;
  }

  // Suppress unused-warning on emptySnapshot import — kept available so
  // consumers can `import { emptySnapshot } from "@ancientpantheon/codex-ouronet/adapters"`.
  // (Re-exported via the barrel.)
  protected readonly _emptySnapshot = emptySnapshot;
}
