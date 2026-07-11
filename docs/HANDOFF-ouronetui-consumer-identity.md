# HANDOFF — OuronetUI-dev consumer identity Codex

**Target repo:** `D:\_Claude\StoaOuronet\OuronetUI` (DEV side first, prototype).
**Read `DUAL-APOLLO-CONSUMER-IDENTITY.md` first** (esp. §4, §7). This gives
OuronetUI its **own** sealed identity-Codex (holding the consumer Apollo **C**),
secured with the AncientHoldings hub model, and signs Pythia challenges locally.
Do this **before** the Arweave-into-Codex-package work.

**Reference implementation to PORT (do not re-invent):**
`D:\_Claude\StoaOuronet\AncientHoldings`:
- `lib/vault.ts` — `seal()`/`unseal()`, libsodium XSalsa20-Poly1305, 24-byte
  nonce per seal, master key from `SECRETS_MASTER_KEY`, read per-op, no global
  cache.
- `lib/hub-codex-store.ts` — `loadSnapshot()`/`saveSnapshot()`/
  `getOrCreateCodexPassword()` (machine-generated 32-byte codex password, sealed
  under the master key, auto-unlock — no operator prompt).
- `lib/codex-cronoton/codex-key-resolver.ts` — `getKeyPairByPublicKey()`: unseal
  snapshot → unseal password → `smartDecrypt` the entry → derive/sign. This is
  the exact "unlock to sign" pattern to reuse.

---

## What to build

### 1. Separate the TWO codices (critical distinction)
OuronetUI already hosts **users'** codices (Daimon role). This adds a **second,
distinct** codex: OuronetUI's **own** identity-codex. Keep them completely
separate — different storage, different keys, different code path. The identity
codex is server-side only; the browser never touches it.

### 2. Server-side identity vault module
Port the hub's `vault.ts` + `hub-codex-store.ts` pattern into OuronetUI's server
(Next.js API / server module — mirror wherever OuronetUI keeps server secrets):
- Store a **sealed identity-Codex** = a `CodexSnapshot` whose `ouroAccounts`
  holds **exactly one** Apollo account **C** (`originCurve: "apollo"`); all other
  arrays empty. (A one-entry codex is valid — confirmed against the schema.)
- Double envelope, same as the hub: inner per-entry secret under the
  machine-generated codex password; outer whole-snapshot `seal()` under the
  master key.
- **Master key** from `env` for the DEV prototype (`OURONETUI_IDENTITY_MASTER_KEY`
  or reuse the hub's `SECRETS_MASTER_KEY` convention). Note in code that
  **production should source it from KMS-on-demand** (see model §7). Never in the
  frontend bundle, never logged.

### 3. `signPythiaChallenge(nonce, requestPayload)` — the ONLY operation
Expose one server-side function:
1. `unseal()` the identity snapshot + password (per-op, no resident plaintext).
2. Resolve C's keypair (port `getKeyPairByPublicKey`).
3. Sign the **request-bound challenge** (nonce + method + params + timestamp).
4. Return `{ publicKey: C.pub, signature }`. Re-lock (drop plaintext).

**Auth-only scope (hard rule):** this module must be able to sign **only** a
Pythia auth challenge — never a value/transfer transaction. Mirror the hub's
observational-refusal: any attempt to sign anything other than a challenge
payload throws. This bounds a server compromise to "impersonation until revoked,
zero fund loss."

### 4. Wire into OuronetUI's Pythia call path
Find where OuronetUI-dev calls Pythia today and insert the challenge handshake
(per `HANDOFF-pythia-dual-apollo.md` §B2):
1. Request a challenge (nonce) from Pythia.
2. `signPythiaChallenge(...)` → `{pub, sig}`.
3. Send `{request, sig}`; Pythia verifies against the on-chain-cached C pubkey +
   `iz-active`. No codex data crosses the wire — only pub + signature.

### 5. Provisioning the identity codex (dev bootstrap)
The **owner** (AncientHodler) creates S + C in his **personal standalone Codex**
and binds S↔C on-chain (per the Pythia handoff A3). Export a **C-only** sealed
codex and install it as OuronetUI's identity-codex (env-configured path or DB
row). Document the exact export step so a fresh dev deploy can be provisioned.
Do **not** put C's seed in the repo or the frontend.

---

## Acceptance checklist
- OuronetUI server holds a sealed one-Apollo identity codex; the browser bundle
  contains **no** private key material.
- `signPythiaChallenge` returns a valid signature verifiable against C's public
  key; the plaintext key is not resident after the call.
- Attempting to sign a non-challenge (value) payload **throws** (auth-only).
- A full Pythia round-trip works end-to-end against the dev Pythia (challenge →
  sign → verify → serve).
- Identity codex is independent of the users'-codex hosting path.

## Open questions (confirm with owner)
- Where OuronetUI-dev keeps server secrets today (env file / DB / KMS) — pick the
  identity-codex storage to match.
- Master-key provenance for the prototype: env (hub parity) now; KMS later.
- Signature scheme expected by the Pythia service (coordinate with the Pythia
  handoff §B2).
