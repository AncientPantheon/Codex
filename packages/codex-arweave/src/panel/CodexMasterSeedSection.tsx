/**
 * CodexMasterSeedSection — the Codex ID page's record of the one seed this
 * codex is built on, and the three entities that are its faces.
 *
 * Owner: *"we would add it as a section in the Codex ID, as the Codex Master
 * Seed … as basically the Seed of the Codex, even though the codex is
 * basically a collection of multiple seeds and keys, it will henceforth have
 * its own Codex Master Seed."*
 *
 * STATES WHAT IS MISSING rather than rendering blanks. Three faces are
 * established at different moments — the ArWeave one is an RSA-4096
 * derivation taking seconds, so a codex with two faces settled is a normal
 * intermediate state. A row of empty values would be indistinguishable from
 * a bug; naming the gap is not.
 *
 * Presentational only: it resolves ids against the lists it is handed and
 * renders. It never reads a store, so it is testable without a provider.
 *
 * `settled-master-identity`: the Ouronet face reads by ROLE
 * (`Codex Ouronet Master`), with the pointed-at account's stored name
 * demoted to a second line beneath it — never destroyed, only demoted. The
 * rule comes from `masterOuronetAccountParts` in codex-core, shared verbatim
 * with the Ouronet account rows and both ZBOM pickers, so one account cannot
 * read under two different names depending on where you are looking.
 */

import * as React from "react";
import {
  describeCodexMasterSeed,
  masterOuronetAccountParts,
  MASTER_ARWEAVE_SEED,
  MASTER_CHAINWEB_SEED,
  OURONET_CODEX_MASTER,
  CODEX_MASTER_SEED,
  type CodexMasterSeed,
} from "@ancientpantheon/codex-core";
import {
  INFORMATICS_BODY_LAST_STYLE,
  INFORMATICS_BODY_STYLE,
  INFORMATICS_CARD_STYLE,
  INFORMATICS_HEADING_STYLE,
  INFORMATICS_SECTION_STYLE,
} from "./informaticsStyles.js";

export interface CodexMasterSeedSectionProps {
  row: CodexMasterSeed | undefined;
  /** Minimal shapes, so this component needs no entity types. */
  ouroAccounts?: readonly { id: string; name?: string }[];
  chainwebSeeds?: readonly { id: string; name?: string }[];
  arweaveSeeds?: readonly { id: string; name?: string }[];
}

/** Shown for an entity that IS established but carries no human name —
 *  never its raw `id`. Owner (live testing): *"What do you mean Master
 *  Chainweb Seed 9845c79e-6958-4a49-8c64-8f064367dbe6? … wtf is that
 *  number? that is completely wrong."* A bare UUID in a value column is
 *  precisely the "indistinguishable from a bug" rendering this
 *  component's own doc comment exists to forbid — it reads as leaked
 *  internals, and it tells the user nothing about the seed.
 *
 *  Reached by the two SEED faces only: the Ouronet face resolves through
 *  {@link masterOuronetAccountParts}, which always has a role name
 *  ({@link OURONET_CODEX_MASTER}) to show for the settled master, named or
 *  not. */
export const UNNAMED_FACE_NOTE = "established — unnamed";

function resolveName(
  id: string | undefined,
  list: readonly { id: string; name?: string }[] | undefined,
): string | null {
  if (!id) return null;
  const hit = list?.find((x) => x.id === id);
  if (!hit) return null;
  // A found-but-nameless entity is ESTABLISHED (so it must not fall through
  // to the caller's "not derived yet" note, which would be a different and
  // false claim) but has nothing human to show — say exactly that, rather
  // than dumping `hit.id`.
  return hit.name && hit.name.length > 0 ? hit.name : UNNAMED_FACE_NOTE;
}

/**
 * The Ouronet face, resolved through the ONE naming rule
 * ({@link masterOuronetAccountParts}) the account rows and both ZBOM pickers
 * also use — so this account can never read under two different names
 * depending on which surface you are looking at.
 *
 * Returns `value: null` for the two states that are NOT "the master is
 * established here": no id at all, and an id this codex does not hold. Both
 * must keep reading as the caller's missing-note; printing the role for a
 * dangling id would claim an establishment that did not happen.
 *
 * On `index`: `row.ouroAccountId` IS the settled master's id by definition —
 * this row is the codex's own record of its master — so `accountId` and
 * `settledMasterAccountId` are necessarily the same id here. That makes the
 * helper's identity branch fire and return {@link OURONET_CODEX_MASTER}
 * before position is consulted at all, so passing 0 is honest rather than a
 * guess: with a non-empty `settledMasterAccountId` equal to `accountId`,
 * `index` can only ever be read by the `"Account #N"` fallback, which is
 * unreachable from here. This card has no list position, and must not invent
 * one.
 */
function resolveOuronetFace(
  id: string | undefined,
  accounts: readonly { id: string; name?: string }[] | undefined,
): { value: string | null; former?: string } {
  if (!id) return { value: null };
  const hit = accounts?.find((a) => a.id === id);
  if (!hit) return { value: null };
  const parts = masterOuronetAccountParts(0, hit.name, null, {
    accountId: id,
    settledMasterAccountId: id,
  });
  return parts.formerName === undefined
    ? { value: parts.name }
    : { value: parts.name, former: parts.formerName };
}

function FaceRow({
  testId,
  face,
  resolved,
  missingNote,
  secondary,
}: {
  testId: string;
  face: string;
  resolved: string | null;
  missingNote: string;
  /** Optional second line beneath the value, as muted secondary text — the
   *  Ouronet face's demoted former name. Omitted (not rendered at all, not
   *  rendered empty) for every face that has nothing to demote, which keeps
   *  the Chainweb and ArWeave rows exactly as they were. */
  secondary?: string;
}): React.ReactElement {
  const value = (
    <span
      data-testid={`${testId}-value`}
      style={{
        ...INFORMATICS_BODY_STYLE,
        margin: 0,
        textAlign: "right",
        color: resolved ? "#d2d3d4" : "#8b8b96",
        fontStyle: resolved ? "normal" : "italic",
      }}
    >
      {resolved ?? missingNote}
    </span>
  );

  return (
    <div
      data-testid={testId}
      style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "4px 0" }}
    >
      <span style={{ ...INFORMATICS_BODY_STYLE, margin: 0 }}>{face}</span>
      {secondary === undefined ? (
        value
      ) : (
        <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", minWidth: 0 }}>
          {value}
          <span
            data-testid={`${testId}-former`}
            style={{
              ...INFORMATICS_BODY_STYLE,
              margin: 0,
              fontSize: 12,
              lineHeight: 1.4,
              textAlign: "right",
              color: "#8b8b96",
            }}
          >
            {secondary}
          </span>
        </span>
      )}
    </div>
  );
}

export function CodexMasterSeedSection({
  row,
  ouroAccounts,
  chainwebSeeds,
  arweaveSeeds,
}: CodexMasterSeedSectionProps): React.ReactElement {
  const faces = describeCodexMasterSeed(row);
  const ouronet = resolveOuronetFace(row?.ouroAccountId, ouroAccounts);

  return (
    <div data-testid="codex-master-seed-section" style={INFORMATICS_CARD_STYLE}>
      <h3 style={INFORMATICS_HEADING_STYLE}>{CODEX_MASTER_SEED}</h3>

      <section style={INFORMATICS_SECTION_STYLE}>
        <p style={INFORMATICS_BODY_STYLE}>
          One set of seed words, doing three jobs. A codex is a collection of many seeds and
          keys, but exactly one of them is the seed the codex itself is built on &mdash; and
          every chain added later derives its addresses from this same one.
        </p>

        {row === undefined ? (
          <p data-testid="codex-master-seed-none" style={INFORMATICS_BODY_LAST_STYLE}>
            This codex has not settled on a {CODEX_MASTER_SEED} yet. Making it Permaweb eligible
            is what establishes one.
          </p>
        ) : (
          <>
            <FaceRow
              testId="codex-master-seed-face-ouronet"
              face={OURONET_CODEX_MASTER}
              resolved={ouronet.value}
              secondary={ouronet.former}
              missingNote="named, but not found in this codex"
            />
            <FaceRow
              testId="codex-master-seed-face-chainweb"
              face={MASTER_CHAINWEB_SEED}
              resolved={resolveName(row.chainwebSeedId, chainwebSeeds)}
              missingNote="named, but not found in this codex"
            />
            <FaceRow
              testId="codex-master-seed-face-arweave"
              face={MASTER_ARWEAVE_SEED}
              resolved={resolveName(row.arweaveSeedId, arweaveSeeds)}
              missingNote={
                faces.arweave ? "named, but not found in this codex" : "not derived yet"
              }
            />
            <p data-testid="codex-master-seed-established" style={INFORMATICS_BODY_LAST_STYLE}>
              {faces.complete
                ? `All three faces established ${row.establishedAt.slice(0, 10)}.`
                : `Established ${row.establishedAt.slice(0, 10)} — the ${MASTER_ARWEAVE_SEED} is still to come.`}
            </p>
          </>
        )}
      </section>
    </div>
  );
}

export default CodexMasterSeedSection;
