import { CodexAdapterError } from "../errors/types.js";
import type {
  IKadenaSeed,
  IOuroAccount,
  IPureKeypair,
  AddressBookEntry,
  UiSettings,
  DeviceVariant,
  WatchListEntry,
  IConsumerSettings,
  ICodexIdentity,
} from "../types/entities.js";
import type { CodexAdapter, CodexSnapshot } from "./types.js";
import { emptySnapshot } from "./types.js";

/**
 * MemoryCodexAdapter — non-persistent in-memory adapter.
 *
 * Used for:
 *   - SSR / Next.js server render — `<CodexProvider>` mounts on the
 *     server with this adapter; real LocalStorageCodexAdapter takes
 *     over on hydration.
 *   - Test suites — every test case gets a clean adapter instance,
 *     no cross-test contamination from shared localStorage.
 *   - Development with the consumer running in a worker / non-browser
 *     context that doesn't have `window.localStorage`.
 *
 * State lives in plain object fields. Lost on adapter instance destruction;
 * NEVER use this in a real consumer app's browser session.
 */
export class MemoryCodexAdapter implements CodexAdapter {
  public readonly name = "MemoryCodexAdapter";

  private snapshot: CodexSnapshot;
  private uiSettingsEncrypted: Map<string, UiSettings> = new Map();

  constructor(deviceVariant: DeviceVariant = "dev") {
    this.snapshot = emptySnapshot(deviceVariant);
  }

  // ----- snapshot read/write -----

  public async loadAll(): Promise<CodexSnapshot> {
    // Return a defensive copy so callers can't mutate our internal state.
    return structuredClone(this.snapshot);
  }

  public async saveAll(snapshot: CodexSnapshot): Promise<void> {
    this.snapshot = structuredClone(snapshot);
  }

  // ----- per-entity convenience writes -----

  public async saveKadenaSeeds(seeds: IKadenaSeed[]): Promise<void> {
    this.snapshot.kadenaSeeds = structuredClone(seeds);
  }

  public async saveOuroAccounts(accounts: IOuroAccount[]): Promise<void> {
    this.snapshot.ouroAccounts = structuredClone(accounts);
  }

  public async savePureKeypairs(keypairs: IPureKeypair[]): Promise<void> {
    this.snapshot.pureKeypairs = structuredClone(keypairs);
  }

  public async saveAddressBook(entries: AddressBookEntry[]): Promise<void> {
    this.snapshot.addressBook = structuredClone(entries);
  }

  public async saveWatchList(entries: WatchListEntry[]): Promise<void> {
    this.snapshot.watchList = structuredClone(entries);
  }

  public async saveUiSettings(settings: UiSettings): Promise<void> {
    this.snapshot.uiSettings = structuredClone(settings);
  }

  public async saveConsumerSettings(
    consumerSettings: Record<string, IConsumerSettings>
  ): Promise<void> {
    this.snapshot.consumerSettings = structuredClone(consumerSettings);
  }

  public async saveCodexIdentity(
    identity: ICodexIdentity | undefined
  ): Promise<void> {
    // The conditional preserves the undefined-clear semantic: clone-on-write
    // for value-type immutability when present, but a bare clear when absent
    // (structuredClone(undefined) is undefined, but the branch reads clearer).
    this.snapshot.codexIdentity =
      identity === undefined ? undefined : structuredClone(identity);
  }

  // ----- metadata -----

  public async touch(deviceVariant: DeviceVariant): Promise<{
    lastUpdatedAt: string;
    lastUpdatedDevice: DeviceVariant;
  }> {
    const lastUpdatedAt = new Date().toISOString();
    this.snapshot.lastUpdatedAt = lastUpdatedAt;
    this.snapshot.lastUpdatedDevice = deviceVariant;
    return { lastUpdatedAt, lastUpdatedDevice: deviceVariant };
  }

  public async getSchemaVersion(): Promise<number> {
    return this.snapshot.schemaVersion;
  }

  public async setSchemaVersion(v: number): Promise<void> {
    this.snapshot.schemaVersion = v;
  }

  // ----- encrypted UI settings sidecar -----
  //
  // Memory adapter "encryption" is a no-op (we just key by password
  // string). Real consumers MUST NOT use this in a security-sensitive
  // context — that's what LocalStorageCodexAdapter is for.

  public async loadUiSettingsEncrypted(
    password: string
  ): Promise<UiSettings | null> {
    return this.uiSettingsEncrypted.get(password) ?? null;
  }

  public async saveUiSettingsEncrypted(
    settings: UiSettings,
    password: string
  ): Promise<void> {
    this.uiSettingsEncrypted.set(password, structuredClone(settings));
  }

  // ----- destructive -----

  public async clearAll(): Promise<void> {
    this.snapshot = emptySnapshot(this.snapshot.lastUpdatedDevice);
    this.uiSettingsEncrypted.clear();
  }
}

/** Defensive guard — throws a typed error if the consumer accidentally
 *  passes a plain object instead of a real adapter instance. Used by
 *  CodexProvider's adapter prop validation. */
export function assertCodexAdapter(x: unknown): asserts x is CodexAdapter {
  if (
    x === null ||
    typeof x !== "object" ||
    typeof (x as CodexAdapter).loadAll !== "function" ||
    typeof (x as CodexAdapter).saveAll !== "function"
  ) {
    throw new CodexAdapterError(
      "unknown",
      "assertCodexAdapter",
      new Error("Provided adapter is missing required methods")
    );
  }
}
