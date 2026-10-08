# Arweave Library Export — Design

## Problem

The owner is about to upload ~6.8 GB of NFT images. Each uploaded image
appears in the Library with its own Arweave access link. To construct the
on-chain metadata-update transactions afterward, every filename→link
pairing needs to leave the app as data — not be manually copied one row
at a time out of a paginated UI.

## Grounding

- `LibraryArea.tsx`'s `entries` state already holds the FULL dataset —
  aggregated across every configured owner (`Promise.all(uniqueOwners.map(
  o => listLibrary(o)))`), merged, unfiltered. Pagination
  (`LIBRARY_PAGE_SIZE = 25`) is purely a rendering slice
  (`flatUnits.slice(...)`) — the export does not need to "see" every page,
  it reads the same already-loaded `entries` array the page itself reads.
- `openHrefFor(entry, entries, openUrl, pool)` already computes each row's
  real, correct access link — including the manifest-aware case (a bundled
  file's manifest entry links to `<manifestId>/<path>`, not just the bare
  manifest id). The export reuses this exact function, not a re-derived
  link.
- `tagValue(entry.tags, TAG_CODEX_PATH) ?? entry.itemId` is the existing
  filename-extraction convention, already used for display.
- `saveBytesAsFile(bytes, filename, contentType)` is the existing browser-
  download trigger (object URL + anchor click), already used for
  individual file downloads — directly reusable for a JSON file.

## Approach

A new "Export Library" button in `LibraryArea.tsx`, next to the existing
"Rebuild" control. On click: map every entry in `entries` (ALL of them,
regardless of current page) to a plain JSON-serializable record:

```ts
{
  filename: string;       // TAG_CODEX_PATH value, or itemId if untagged
  link: string;            // openHrefFor's real access URL
  id: string;               // the raw data-item/tx id
  owner: string;
  contentType: string;
  status: "pending" | "final";
  isManifest: boolean;     // true for a bundle's own manifest entry
  uploadId?: string;        // groups files from the same upload action
}
```

Wrapped in `{ exportedAt: <ISO timestamp>, itemCount: number, items: [...] }`.
No pre-filtering — manifest entries are included (clearly flagged via
`isManifest`) rather than silently dropped, since filtering on the
consumer's own tooling is cheaper to get right than guessing what this
particular owner wants excluded.

Triggers a real browser download via `saveBytesAsFile` (filename e.g.
`codex-library-export-<ISO-date>.json`, content type `application/json`) —
same mechanism already used for individual file downloads, not a new
download pattern.

## Acceptance criteria

- [ ] Clicking Export downloads a JSON file containing EVERY entry
      currently in the Library (across every owner, every page — not just
      the current page), each with a correct `filename`/`link` pair
      matching exactly what that row's own "Open"/"Copy" link would
      produce.
- [ ] A bundled file's exported `link` matches its real per-file access
      URL (the manifest-aware composition), not a bare manifest link.
- [ ] An empty Library exports a valid, empty-but-well-formed JSON file
      (`items: []`), not an error or a disabled/missing button.
