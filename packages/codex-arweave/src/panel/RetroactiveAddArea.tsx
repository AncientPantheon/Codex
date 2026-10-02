// The RETROACTIVE-ADD area of the Arweave panel (T7, `arweave-upload-encryption`).
//
// A small, separate component from `LibraryArea.tsx` — this is an id/URL
// lookup + a single submit action, not a Library listing. A paste/select
// id-or-URL input + a submit button. On submit: calls the injected
// `queryUploadById(id)`. A `null` result (no matching transaction) shows a
// clear, specific "not found" message — never a crash, never a generic error.
// A found record's `Codex-Owner` tag is read BY NAME (never by tag array
// position — a gateway/consumer may return tags in any order) and checked
// against EVERY address in the injected `ownedAddresses` list (not just a
// single "currently active" address — a user may be retroactively adding
// something that belongs to a DIFFERENT account they also hold). A
// non-matching (or absent) owner shows a clear "doesn't belong to any account
// in this codex" message and the insert callback is NEVER called. A matching
// owner calls the injected `addToLibrary` with the found record and shows a
// success result.
//
// Mirrors `UploadArea.tsx`/`CodexBackupArea.tsx`'s own injected-async-function
// dependency-injection pattern (`queryUploadById`/`addToLibrary` are both
// injected — this component never reaches into a `GatewayPool` or
// `LibraryStore` directly) and their idle/pending/done/error phase-machine
// shape rather than inventing a new one. Unlike `UploadArea`/`CodexBackupArea`,
// this action posts nothing new to chain (it only looks up and locally
// records an upload that already exists on-chain), so it carries no
// permanence-confirm dialog.

import * as React from "react";
import { useState } from "react";

import { TAG_CODEX_OWNER, type OwnerUploadRecord } from "@ancientpantheon/arweave-core";

export interface RetroactiveAddAreaProps {
  /** EVERY Arweave address this codex holds — not just the currently-active
   *  one. The found record's `Codex-Owner` tag is checked against this full
   *  list, since a retroactively-added upload may belong to any held account. */
  ownedAddresses: readonly string[];
  /** Looks up a single upload by transaction/data-item id (the arweave-core
   *  `queryUploadById` seam, already bound to the host's gateway pool).
   *  Resolves `null` for "not found" — never throws for that case; only a
   *  genuine network/gateway failure rejects. */
  queryUploadById: (id: string) => Promise<OwnerUploadRecord | null>;
  /** Inserts a verified (owned) record into that owner's Library. This
   *  component does not know how the host maps a record to a Library entry —
   *  matching `UploadArea.tsx`/`CodexBackupArea.tsx`'s own injected-callback
   *  pattern rather than reaching into a `LibraryStore` directly. */
  addToLibrary: (record: OwnerUploadRecord) => Promise<void>;
}

type RetroactiveAddPhase =
  | "idle"
  | "looking-up"
  | "not-found"
  | "owner-mismatch"
  | "adding"
  | "done"
  | "error";

/**
 * Extracts a transaction/data-item id from the raw input, which may be a bare
 * id or a pasted gateway URL (e.g. `https://arweave.net/<id>`) — the last
 * non-empty path segment, stripped of any query/fragment, mirroring how a
 * user would naturally copy an "Open on the permaweb" link. A bare id (no
 * `/`) is returned trimmed, unchanged.
 */
function extractId(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.includes("/")) return trimmed;
  const withoutQuery = trimmed.split(/[?#]/)[0];
  const segments = withoutQuery.split("/").filter((s) => s.length > 0);
  return segments.length > 0 ? segments[segments.length - 1] : trimmed;
}

/** Reads a tag value by name from a record's tag list; `undefined` when absent. */
function tagValue(tags: OwnerUploadRecord["tags"], name: string): string | undefined {
  return tags.find((t) => t.name === name)?.value;
}

export function RetroactiveAddArea(props: RetroactiveAddAreaProps): React.ReactElement {
  const { ownedAddresses, queryUploadById, addToLibrary } = props;

  const [rawInput, setRawInput] = useState("");
  const [phase, setPhase] = useState<RetroactiveAddPhase>("idle");
  const [addedRecord, setAddedRecord] = useState<OwnerUploadRecord | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const pending = phase === "looking-up" || phase === "adding";

  async function onSubmit(): Promise<void> {
    const id = extractId(rawInput);
    if (id === "" || pending) return;

    setPhase("looking-up");
    setErrorMessage(null);
    setAddedRecord(null);

    try {
      const record = await queryUploadById(id);
      if (record === null) {
        setPhase("not-found");
        return;
      }

      // Read Codex-Owner BY NAME (never tag array position) and check it
      // against EVERY held address — not only a single active one.
      const owner = tagValue(record.tags, TAG_CODEX_OWNER);
      if (owner === undefined || !ownedAddresses.includes(owner)) {
        setPhase("owner-mismatch");
        return;
      }

      setPhase("adding");
      await addToLibrary(record);
      setAddedRecord(record);
      setPhase("done");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Lookup failed.");
      setPhase("error");
    }
  }

  return (
    <div data-testid="retroactive-add-area">
      <input
        type="text"
        data-testid="retroactive-add-input"
        placeholder="Paste a data-item id or its permaweb URL"
        value={rawInput}
        onChange={(ev) => setRawInput(ev.target.value)}
      />
      <button
        type="button"
        data-testid="retroactive-add-submit"
        disabled={extractId(rawInput) === "" || pending}
        onClick={() => {
          void onSubmit();
        }}
      >
        Add existing upload
      </button>

      {pending ? (
        <div data-testid="retroactive-add-progress" role="status">
          {phase === "adding" ? "Adding to your Library…" : "Looking up…"}
        </div>
      ) : null}

      {phase === "not-found" ? (
        <div data-testid="retroactive-add-not-found" role="alert">
          Not found: no on-chain upload matches that id.
        </div>
      ) : null}

      {phase === "owner-mismatch" ? (
        <div data-testid="retroactive-add-owner-mismatch" role="alert">
          This upload doesn&apos;t belong to any account in this codex.
        </div>
      ) : null}

      {phase === "done" && addedRecord ? (
        <div data-testid="retroactive-add-result">
          <p>{addedRecord.id}</p>
          <p>Added to your Library.</p>
        </div>
      ) : null}

      {phase === "error" ? (
        <div data-testid="retroactive-add-error" role="alert">
          {errorMessage}
        </div>
      ) : null}
    </div>
  );
}

export default RetroactiveAddArea;
