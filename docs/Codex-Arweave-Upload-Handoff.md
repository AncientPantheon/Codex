# Handoff: Codex Arweave Upload & Library

**Target:** Codex module (Ouronet ecosystem)
**Goal:** Let a user upload a file / multiple files / a folder directly from Codex to Arweave, paying with **native AR from their own wallet**, using **Ouronet's own infrastructure** (no third-party bundler service). Codex maintains a per-account **library** of uploads with direct + download links, and supports **public** or **encrypted (private)** uploads using Ouronet's own encryption, with Codex-held keys.

> **⛔ Implementer protocol — read before writing any code.** Several design decisions in this handoff are deliberately left open (see **§11**). They are **blocking questions for the human owner — not choices for you (the implementing agent) to make.** When you reach a component whose behaviour depends on an open item, **stop and ask the owner directly, in plain language, and wait for an explicit answer before writing that code.** Do not silently pick a default, infer intent from this document, or proceed on assumption — a wrong guess is expensive to unwind here (data is permanent, public, and on-chain). Where §11 gives a recommended default you may *propose* it, but still get an explicit "yes" first. Ask **just-in-time** (when the item actually blocks the work), not all at once up front, and **write each answer back into §11** so the decision is captured for the next session.

---

## 0. Read this first — the Arweave mental model (non-negotiable facts)

1. **Arweave data is public and permanent.** You cannot edit or delete. "Delete from library" = hide in our index only; the bytes live forever.
2. **A single L1 transaction can hold a large file** (gigabytes). Size is *not* why we bundle.
3. **We bundle (ANS-104) to make one upload action = one L1 transaction = one payment**, even when it contains many files.
4. **Three ID types** (do not conflate):
   - **Data-item ID** — one per file; `https://arweave.net/<id>` returns that file. This is the primary handle.
   - **Bundle / L1 tx ID** — the container we post + pay for; not used for per-file retrieval.
   - **Manifest ID** — a small JSON mapping path strings → data-item IDs; this is the **"folder" link**: `https://arweave.net/<manifest-id>/sub/file.png`.
5. **Folders are not native.** Folder structure exists only inside a **manifest** (paths are strings with `/`).
6. **Gateways serve raw bytes.** Encrypted files therefore come back as **ciphertext** from any gateway/manifest link. Decryption must happen inside Codex.
7. **Tags are public and permanent.** Never put key material, secrets, or sensitive plaintext (e.g. private filenames) in a tag. Tag a key **reference/ID**, never the key.
8. **Confirmation is not instant.** We self-post L1 txs (no third-party bundler receipt), so an upload is *known* the moment it's signed (IDs are deterministic) but *confirmed* only after block inclusion (~2 min+). Design for a `pending → confirmed` lifecycle.

> Prior art worth reading, not adopting wholesale: **ArFS** (Arweave File System, ArDrive's open metadata standard) models drives/folders/files/versions/privacy on top of Arweave. We are building our own equivalent because we want our own encryption and tagging. Skim ArFS for design ideas.

---

## 1. Scope

### In scope
- Upload from Codex: single file, multiple files, or a folder (with subfolders), as **one atomic bundle** paid by the user's AR.
- Public uploads (openly accessible) **or** encrypted uploads (Ouronet encryption, Codex-held key).
- Per-account **library**: lists all uploads, exposes **direct link** (public) and **download link** (public or decrypt-mediated).
- Key management with the **non-removable-key invariant** (see §6).
- Cost estimate + balance check before signing.

### Out of scope (for this pass)
- Running a public bundler-as-a-service for third parties.
- Mutable file versioning / rename-in-place (can come later via manifest re-publish).
- Fiat / alt-token payment (native AR only, by design).

---

## 2. Architecture / components

```
Codex Upload Feature
├── UploadOrchestrator      # drives the flow, atomic per upload action
├── Encryptor               # Ouronet encryption (public bypass; envelope for private)
├── BundleBuilder           # arbundles: data items + manifest → one ANS-104 bundle
├── ChainClient             # arweave-js: price, sign, post, GraphQL, status polling
├── KeyManager              # account keys (KEKs), wrapped DEKs, non-removable invariant
├── LibraryIndex            # off-chain DB of uploads (rebuildable from chain via tags)
└── RetrievalService        # fetch by id/manifest; decrypt-on-download for private
```

**Tech stack**
- `arweave-js` (official) — tx create/sign/post, `getPrice`, GraphQL, status.
- `arbundles` (ANS-104) — `ArweaveSigner`, `createData`, `bundleAndSignData`, deterministic `dataItem.id`.
- Crypto — AES-256-GCM (WebCrypto in browser / `crypto` in Node) for symmetric; account KEK for wrapping.
- Gateway — `arweave.net` for MVP; make it configurable and support fallbacks (or a self-hosted ar.io gateway later).

---

## 3. Wallet & payment model

- The **user holds and pays with their own AR.** Their Arweave wallet (JWK keyfile in their Ouronet account, or a connected wallet) signs **both** the data items and the wrapping L1 bundle tx and pays the fee.
- **Before signing:** estimate cost with `arweave.transactions.getPrice(totalBytes)` (returns Winston), show it, and verify the wallet balance covers it. Abort clearly if underfunded.
- **Security:** treat the signing key as a payment credential. If Codex custodies it, encrypt at rest, scope access, and require explicit user consent per upload (or per session). Prefer user-side signing where the platform allows.

> **Note on bundling + payment:** because each user pays for their *own* upload, cross-user bundling gives no benefit here. We bundle **within a single upload action** (that user's N files → 1 tx → 1 payment). That's the only bundling we need.

---

## 4. Upload flows

### 4.1 Single public file
1. Read bytes, detect `Content-Type`.
2. `tx = arweave.createTransaction({ data }, jwk)`; add tags (§7); sign; post via chunked uploader.
3. Link = `https://arweave.net/<tx.id>`.
4. Record in LibraryIndex (`pending` → poll → `confirmed`).

*(A single file needs no bundle or manifest. Keep this path simple.)*

### 4.2 Multiple files / folder (one atomic bundle) — the main path
Data-item IDs are **deterministic after signing** (known before posting), so we can reference them in a manifest included in the *same* bundle.

1. For each input file:
   - (encrypted mode) `Encryptor.encrypt(bytes, accountKey)` → `{ciphertext, keyId, algo, iv}`; prepend `iv` to ciphertext; body = ciphertext.
   - `item = createData(body, signer, { tags: fileTags })`; `await item.sign(signer)`; capture `item.id` and its **path** (relative path within the upload, preserving subfolders).
2. Build **manifest** JSON (`arweave/paths`, v0.2.0) mapping each path → `{ id: item.id }`; optional `index`.
3. `manifestItem = createData(JSON, signer, { tags: manifestTags })`; sign; capture `manifestItem.id`.
4. `bundle = await bundleAndSignData(signer, [...fileItems, manifestItem])`.
5. Wrap + post as ONE L1 tx paid by the user:
   `tx = arweave.createTransaction({ data: bundle.getRaw() }, jwk)`; add `Bundle-Format: binary`, `Bundle-Version: 2.0.0`; sign; post.
6. Links:
   - **Folder link** = `https://arweave.net/<manifestItem.id>` (browse `.../sub/file`).
   - **Per-file link** = `https://arweave.net/<fileItem.id>`.
7. Record every item + the manifest in LibraryIndex under one `uploadId`.

**MVP simplification allowed:** if computing IDs pre-post is awkward in the chosen lib version, do it in two posts — upload files first (get IDs), then build + upload the manifest referencing them. Costs a second tiny tx; simpler. Prefer the single-bundle path once stable.

### 4.3 Encrypted specifics
- Encrypt **per-file** (envelope, §5). The manifest may be **public** (structure/filenames visible, contents encrypted) or **encrypted** (structure hidden; then gateway path-resolution won't work and RetrievalService must resolve paths itself). **Ask the owner before building this — see §11, item 2.**
- **Encrypted files cannot be served decrypted by a gateway.** The library's "download" for a private file MUST go through `RetrievalService` (fetch ciphertext → strip IV → decrypt with unwrapped DEK → stream plaintext with correct `Content-Type`).

---

## 5. Encryption design (Ouronet's own method)

Default recommended scheme (replace internals with Ouronet's method, keep the interface):

- **Envelope encryption:**
  - Random per-file **DEK** (data encryption key), AES-256-GCM. Encrypt file bytes → ciphertext + 12-byte IV + auth tag.
  - Wrap the DEK with the **account KEK** (key encryption key) held by KeyManager → `wrappedDEK`.
  - Store `wrappedDEK` in LibraryIndex (off-chain) — **not** on-chain. On-chain tags carry only `Ouronet-Key-Id` (the KEK reference) + algo + a scheme version.
- **Interface** (stable contract for the implementer):
  ```
  encrypt(bytes, accountKeyId) -> { ciphertext, iv, keyId, algo, wrappedDEK }
  decrypt(ciphertext, iv, keyId, wrappedDEK) -> plaintext
  ```
- **Why envelope:** lets you manage/rotate the account key without re-encrypting files, and keeps raw keys out of tags entirely.

> ⚠️ **Permanence + encryption is a one-way door.** Ciphertext is on-chain **forever**. Two hard consequences the product must own:
> 1. **Key leak = permanent exposure** of all past data encrypted under it — irrevocably. You can never rotate the ciphertext.
> 2. **Key loss = permanent loss of access.** The bytes persist forever but are undecryptable garbage. **KeyManager MUST back up / escrow account keys.** Losing a KEK bricks every file under it.

---

## 6. Key lifecycle & the non-removable-key invariant

Encodes the user's rule ("a key that has encrypted uploads tagged to it can no longer be removed"):

- A **key** = an Ouronet account KEK, identified by `keyId`, held by KeyManager.
- **Invariant:** a `keyId` is **non-removable** once **≥1 encrypted upload references it** (LibraryIndex has a live record, or a GraphQL tag query finds an on-chain item tagged `Ouronet-Key-Id: <keyId>` owned by that account). Deleting it would orphan permanent data → forbidden.
- Enforce at KeyManager (like a FK constraint): `deleteKey(keyId)` fails if `refCount(keyId) > 0`.
- Because on-chain data is permanent, `refCount` can never drop to 0 for a key with confirmed encrypted uploads → such keys are effectively **permanent**. Surface this to the user explicitly before their first encrypted upload with a key.
- Recommend: **auto-backup a key on first encrypted use**, and mark it `LOCKED_PERMANENT` in the UI.

---

## 7. Tag schema (public + permanent — no secrets!)

Applied to each data item / L1 tx as appropriate:

| Tag | Example | Notes |
|---|---|---|
| `App-Name` | `Ouronet-Codex` | library query anchor |
| `App-Version` | `1.0.0` | |
| `Ouronet-Account` | `<account-id>` | owner; library scoping |
| `Ouronet-Upload-Id` | `<uuid>` | groups files of one upload action |
| `Ouronet-Type` | `file` \| `manifest` | |
| `Content-Type` | `image/png` (public) / `application/octet-stream` (encrypted) | render/serve correctly |
| `Ouronet-Original-Content-Type` | `image/png` | real type of encrypted payload |
| `Ouronet-Original-Filename` | `logo.png` | ⚠️ omit/redact if filenames are sensitive |
| `Ouronet-Path` | `img/logo.png` | relative path for folder reconstruction |
| `Ouronet-Encrypted` | `true` \| `false` | |
| `Ouronet-Key-Id` | `<keyId>` | **reference only**, never key material |
| `Ouronet-Enc-Algo` | `AES-256-GCM` | |
| `Ouronet-Scheme-Version` | `1` | future-proofing |

Manifest tag: `Content-Type: application/x.arweave-manifest+json` (required so gateways treat it as a path manifest).

---

## 8. Library data model (off-chain index, rebuildable from chain)

```
Upload        { uploadId, account, createdAt, status, bundleTxId?, manifestId?, mode(public|encrypted), keyId? }
UploadItem    { itemId(dataItemId), uploadId, account, path, filename, contentType,
                size, encrypted, keyId?, iv?, wrappedDEK?, status(pending|confirmed|failed) }
AccountKey    { keyId, account, algo, createdAt, state(active|LOCKED_PERMANENT), backupRef, refCount }
```

- **Source of truth is the chain.** LibraryIndex is a cache for speed + UX. Provide a `rebuild(account)` that queries GraphQL:
  ```graphql
  transactions(
    owners: ["<user-address>"],
    tags: [{ name: "App-Name", values: ["Ouronet-Codex"] }],
    first: 100, after: $cursor
  ) { edges { cursor node { id tags } } pageInfo { hasNextPage } }
  ```
  Rehydrate items from tags. (Note: `wrappedDEK`/`iv` live only in the index/KeyManager, so a full rebuild restores structure but decryption still needs KeyManager state — back that up too.)

---

## 9. Retrieval / links

- **Public file:** direct link `https://arweave.net/<itemId>`; download = same (browser uses `Content-Type`).
- **Public folder:** `https://arweave.net/<manifestId>/<path>`.
- **Encrypted file:** direct link returns ciphertext (fine for "raw" access). **Download link → `RetrievalService`**: fetch ciphertext → strip IV → unwrap DEK via KeyManager → AES-GCM decrypt → stream with `Ouronet-Original-Content-Type` and `Ouronet-Original-Filename`. "Decrypt on the spot," user gets plaintext.
- Library UI per item: copy direct link, download (plain or decrypted), show encrypted badge + which key, status.

---

## 10. Edge cases & gotchas

- **Order of operations:** manifest must reference existing item IDs. Single-bundle path relies on deterministic post-sign IDs; two-step fallback posts files then manifest.
- **Confirmation lag:** show `pending`; poll `arweave.transactions.getStatus(id)` / GraphQL until confirmed. Don't claim success on sign alone.
- **Underfunded wallet:** pre-flight balance check; friendly abort.
- **Large uploads:** use the chunked uploader (`getUploader`/`uploadChunk` loop) and resume on failure.
- **No free tier:** the <100 KiB free perk is a *bundler-service* subsidy; self-posted L1 always costs AR. Expected — user pays.
- **Empty files / empty folders:** validate; skip or reject.
- **MIME detection:** set `Content-Type` for public files or they won't render.
- **Gateway trust/availability:** make gateway configurable; consider verifying data hash on retrieval; plan for a self-hosted gateway later.
- **Filename privacy:** for encrypted uploads, decide whether `Ouronet-Original-Filename` / `Ouronet-Path` may be public (§11).
- **Permanence UX:** before any upload, make it unmistakable that data is permanent and public (encrypted = ciphertext permanent). No "delete" — only library-hide.

---

## 11. Open decisions — the agent MUST ask the owner (do not assume)

These are unresolved and **owner-only**. Per the Implementer protocol at the top: when you reach the blocking work, **stop, ask the owner, propose the recommended default (if any), wait for an explicit answer, then record it in the _Answer_ column** before continuing. Never guess your way past a row.

| # | Decision | Ask before building… | Recommended default (still confirm) | Answer |
|---|---|---|---|---|
| 1 | **Wallet custody** — user-connected wallet signs, or Codex custodies the JWK and signs for them? (consent UX + key-at-rest) | ChainClient signing / §3 flow — i.e. *any* upload path | User-connected wallet signs; Codex never holds the AR-spending key | _pending_ |
| 2 | **Encrypted manifest** — may folder/file **names & structure** be public (contents encrypted), or must the manifest itself be encrypted (structure hidden, Codex resolves paths)? | §4.3 encrypted flow + RetrievalService | Manifest public, contents encrypted | _pending_ |
| 3 | **Encryption scheme** — AES-256-GCM + envelope, or a specific Ouronet cipher/KDF? | Encryptor internals (§5) | AES-256-GCM + envelope | _pending_ |
| 4 | **Key backup/escrow** — where do account KEKs get backed up? (Loss = permanent bricking.) | KeyManager (§6), before the first encrypted-upload path | *(none — owner must specify)* | _pending_ |
| 5 | **Index store** — which DB for LibraryIndex + KeyManager state? | LibraryIndex + KeyManager persistence | *(owner's stack choice)* | _pending_ |
| 6 | **Atomicity target** — always single-bundle (one payment) for multi-file, even via the pre-computed-ID path? | §4.2 build strategy | Yes — single-bundle | _pending_ |

Surfaced a new open decision mid-implementation? **Add a row and ask** — don't resolve it yourself.

---

## 12. Acceptance criteria

- [ ] Single file uploads → one tx → correct public link, renders in browser.
- [ ] Multi-file & folder (with subfolders) upload as **one bundle / one payment**; folder link browses subpaths; per-file links work.
- [ ] Public vs encrypted mode selectable per upload.
- [ ] Encrypted upload: ciphertext on-chain; tags carry only key **reference**; download via Codex returns correct plaintext + type.
- [ ] Library lists all uploads per account with direct + download links and status; survives an index wipe via GraphQL `rebuild`.
- [ ] KeyManager enforces the non-removable-key invariant and backs up keys on first encrypted use.
- [ ] Pre-flight cost estimate + balance check; graceful failure/resume.
- [ ] Permanence + key-loss warnings shown before first relevant action.

---

## 13. Reference APIs (implementer quickstart)

```js
// arweave-js: single public file
const tx = await arweave.createTransaction({ data: bytes }, jwk);
tx.addTag('Content-Type', mime);
tx.addTag('App-Name', 'Ouronet-Codex'); // + §7 tags
await arweave.transactions.sign(tx, jwk);
const up = await arweave.transactions.getUploader(tx);
while (!up.isComplete) { await up.uploadChunk(); }
// link: https://arweave.net/${tx.id}

// price + balance pre-flight
const winston = await arweave.transactions.getPrice(byteLength);
const bal = await arweave.wallets.getBalance(addr);

// arbundles: multi-file bundle + manifest (one L1 tx)
import { ArweaveSigner, createData, bundleAndSignData } from 'arbundles';
const signer = new ArweaveSigner(jwk);
const items = [];
for (const f of files) {
  const body = mode === 'encrypted' ? withIV(encrypt(f.bytes, keyId)) : f.bytes;
  const di = createData(body, signer, { tags: tagsFor(f) });
  await di.sign(signer);
  items.push({ di, path: f.path }); // di.id known here
}
const manifest = { manifest: 'arweave/paths', version: '0.2.0',
  paths: Object.fromEntries(items.map(x => [x.path, { id: x.di.id }])) };
const mi = createData(JSON.stringify(manifest), signer,
  { tags: [{ name: 'Content-Type', value: 'application/x.arweave-manifest+json' }, /* +§7 */] });
await mi.sign(signer);
const bundle = await bundleAndSignData(signer, [...items.map(x => x.di), mi]);
const btx = await arweave.createTransaction({ data: bundle.getRaw() }, jwk);
btx.addTag('Bundle-Format', 'binary'); btx.addTag('Bundle-Version', '2.0.0');
await arweave.transactions.sign(btx, jwk); /* post via uploader */
// folder link: https://arweave.net/${mi.id}   per-file: https://arweave.net/${di.id}
```

*(Pin exact library versions and re-check the arbundles API surface at implementation time.)*
