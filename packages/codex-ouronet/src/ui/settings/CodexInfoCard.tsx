/**
 * CodexInfoCard — token-styled, Redux-free port of OuronetUI's CodexInfoSection.
 *
 * A read-only status panel: schema version, codex shape version, encryption
 * level (V1/V2 derived from the codex secrets), last-updated timestamp +
 * device, live counts of each codex slice, and (added 2026-09-26) the
 * "Codex Package" build version + a blockchain-support breakdown. All data
 * flows through `useCodex` over a mounted <CodexProvider>; nothing here
 * mutates. Styled exclusively via `--codex-*` tokens so consumers reskin by
 * overriding tokens.
 *
 * THREE distinct version-shaped rows, each answering a DIFFERENT question —
 * never one repurposed as another (docs/work/codex-shape-version-stamp):
 *
 *  - "Schema Version" (`useCodex().schemaVersion`) — the at-rest, device-
 *    local migration-step counter (an integer state machine other code does
 *    arithmetic on, e.g. the V1→V2 encryption upgrade). Never travels in an
 *    export.
 *  - "Codex Shape" (`formatCodexShapeVersionLabel(useCodex().Codex_Shape_Version)`)
 *    — the REAL per-codex-instance data shape, sourced live from the store
 *    (`Codex_Shape_Version`). Travels in the export, grows independently
 *    per codex as the migration engine advances it, and reads "Unversioned"
 *    for a codex that predates the field — never silently stamped as
 *    current just because it loaded.
 *  - "Codex Package" (`CODEX_PACKAGE_VERSION_OUTPUT`) — a global, build-time
 *    constant: what version of the Codex app/package is running RIGHT NOW,
 *    identical for every codex opened in this session regardless of that
 *    codex's own age/shape. See `codexPackageVersionOutput.ts`'s own doc
 *    comment (codex-core) for the full reasoning.
 *
 * Conflating "Codex Shape" and "Codex Package" into one row (as this file
 * used to, under the single misleading label "Codex Form") is exactly how
 * every codex ended up visibly showing the same "v1.0.0" regardless of its
 * real age — the two are independently sourced here specifically so that
 * divergence is visible again.
 *
 * BLOCKCHAINS_SUPPORTED (owner ruling, 2026-09-26): "the Chainweb that we
 * are supporting now, is basically Stoa-Chainweb, but it isnt named as
 * such... and we'd be adding the third one Kadena-Chainweb." Kadena-Chainweb
 * is listed here as a SUPPORTED chain-identity (the same seeds/accounts are
 * already cryptographically Kadena-compatible) even though the actual
 * blockchain-switcher UI (repointing the Chainweb read-point at Kadena
 * mainnet, morphing the Stoa/UrStoa selector to Kadena-named) is explicit
 * FUTURE work — owner's own words: "that would be the next round of
 * refinement." Nothing here implies a working switcher exists yet.
 */

import {
  CODEX_PACKAGE_VERSION_OUTPUT,
  formatCodexShapeVersionLabel,
} from "@ancientpantheon/codex-core";
import { useCodex } from "../../hooks/index.js";
import { collectCodexSecrets, encryptionLevel } from "./encryptionState.js";

/**
 * The blockchains this Codex build supports, in the order they should list.
 * "Stoa-Chainweb" is the chain this package's `ChainwebPanel`/Ouronet stack
 * already talks to today (previously just labeled "Chainweb" — inaccurate,
 * since it is specifically Stoa's chainweb, not upstream Kadena mainnet).
 * "Kadena-Chainweb" is the third entry per the owner ruling above — a
 * chain-IDENTITY-level support claim (compatible seeds/keys/accounts), not
 * yet a live switcher; see this file's own doc comment.
 */
const BLOCKCHAINS_SUPPORTED = ["Arweave", "Stoa-Chainweb", "Kadena-Chainweb"] as const;

export interface CodexInfoCardProps {
  /** Consumer class merged onto the card root. */
  className?: string;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function InfoRow({
  label,
  value,
  testId,
}: {
  label: string;
  value: string;
  testId?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "4px 0",
        borderTop: "1px solid var(--codex-border)",
      }}
    >
      <span style={{ fontSize: "12px", color: "var(--codex-text-dim)" }}>
        {label}
      </span>
      <span
        data-testid={testId}
        style={{
          fontSize: "12px",
          fontFamily: "var(--codex-font-mono)",
          color: "var(--codex-text)",
        }}
      >
        {value}
      </span>
    </div>
  );
}

export function CodexInfoCard({ className }: CodexInfoCardProps) {
  const {
    schemaVersion,
    Codex_Shape_Version,
    lastUpdatedAt,
    lastUpdatedDevice,
    kadenaSeeds,
    ouroAccounts,
    pureKeypairs,
    addressBook,
    watchList,
  } = useCodex();

  const abOuronet = addressBook.filter(
    (e: { type?: string }) => e.type === "ouronet" || !e.type,
  ).length;
  const abStoa = addressBook.filter((e: { type?: string }) => e.type === "stoa").length;

  const secrets = collectCodexSecrets({
    kadenaSeeds,
    ouroAccounts,
    pureKeypairs,
  });
  const level = encryptionLevel(secrets);
  const encryptionLabel =
    level === "none"
      ? "No secrets"
      : level === "v2"
        ? "V2 (PBKDF2 600k SHA-512)"
        : "V1 Legacy (PBKDF2 10k SHA-256)";

  return (
    <div
      className={className}
      style={{
        borderRadius: "var(--codex-radius-lg)",
        border: "1px solid var(--codex-border)",
        backgroundColor: "var(--codex-surface-2)",
        padding: "16px",
        fontFamily: "var(--codex-font)",
        color: "var(--codex-text)",
      }}
    >
      <h3
        style={{
          fontSize: "12px",
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          marginBottom: "12px",
          color: "var(--codex-text-dim)",
        }}
      >
        Codex Info
      </h3>
      <div>
        <InfoRow
          label="Codex Shape"
          value={formatCodexShapeVersionLabel(Codex_Shape_Version)}
          testId="info-shape-version"
        />
        <InfoRow
          label="Codex Package"
          value={CODEX_PACKAGE_VERSION_OUTPUT}
          testId="info-form-version"
        />
        <InfoRow
          label="Schema Version"
          value={String(schemaVersion)}
          testId="info-schema"
        />
        <InfoRow
          label="Encryption"
          value={encryptionLabel}
          testId="info-encryption"
        />
        <InfoRow
          label="Last Updated"
          value={formatDate(lastUpdatedAt)}
          testId="info-updated"
        />
        <InfoRow
          label="Device"
          value={lastUpdatedDevice}
          testId="info-device"
        />
        <InfoRow
          label="Seeds"
          value={String(kadenaSeeds.length)}
          testId="info-seeds"
        />
        <InfoRow
          label="Ouro Accounts"
          value={String(ouroAccounts.length)}
          testId="info-ouro"
        />
        <InfoRow
          label="Pure Keys"
          value={String(pureKeypairs.length)}
          testId="info-pure"
        />
        <InfoRow
          label="AddressBook Ouronet Accounts"
          value={String(abOuronet)}
          testId="info-ab-ouronet"
        />
        <InfoRow
          label="AddressBook Stoa Accounts"
          value={String(abStoa)}
          testId="info-ab-stoa"
        />
        <InfoRow
          label="Watched Stoa"
          value={String(watchList.length)}
          testId="info-watch"
        />
        <InfoRow
          label="Blockchains Supported"
          value={String(BLOCKCHAINS_SUPPORTED.length)}
          testId="info-chains-count"
        />
        {BLOCKCHAINS_SUPPORTED.map((chain) => (
          <InfoRow
            key={chain}
            label={chain}
            value="Supported"
            testId={`info-chain-${chain.toLowerCase()}`}
          />
        ))}
      </div>
      <p
        style={{
          marginTop: "12px",
          fontSize: "10px",
          color: "var(--codex-text-dim)",
        }}
      >
        Encrypted locally. Cloud sync stores encrypted data only.
      </p>
    </div>
  );
}

export default CodexInfoCard;
