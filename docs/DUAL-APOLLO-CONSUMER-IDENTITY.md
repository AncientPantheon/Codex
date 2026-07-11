# Dual-Apollo Consumer Identity — architecture & decisions

**Status:** design settled (this doc), implementation pending across three surfaces
(see the two HANDOFF docs alongside this one).
**Owner:** AncientHodler. **Date:** 2026-07-10.

This is the source-of-truth for how a Pythia API key is bound to a single
consumer so it can't be reused by a second consumer, how the consumer secures
its half, and where the key material lives. The two handoffs
(`HANDOFF-pythia-dual-apollo.md`, `HANDOFF-ouronetui-consumer-identity.md`)
implement the pieces; read this first for the *why*.

---

## 1. The problem

A classic API key **is** the secret — a bearer string you hide and rotate.
Pythia's keyless model already inverts this: only **public** keys + signatures
travel. But an activated Apollo key today is still effectively a **bearer
credential** — anyone who can sign with the seed is authorized, with **no
binding to *which* consumer**. Nothing stops a second consumer (or a leaked
build) from reusing an activated key. Activation is **absolute** when it should
be **relative to a consumer**.

## 2. The model — a dual-Apollo pair

Two Apollo accounts, mutually and immutably bound on-chain:

- **S** — the **Standard Apollo** registered in the Pythia module = the **API
  slot** (what the owner registers and pays STOA for).
- **C** — the **consumer's Apollo** (the consumer's identity, e.g. OuronetUI).

They form a **pair**. Pythia serves data for slot **S** **only** to a caller who
proves possession of **C**'s private key. A different consumer must mint its
**own** pair — it cannot ride an existing one.

### Why publishing the public keys is safe
On-chain data = **public keys** (safe to publish, like a username). The
**private** counterpart lives only in the consumer's **sealed Codex** and never
leaves. To use the API you must **prove possession of C's private key** via a
fresh signed challenge. Reading the chain gives an attacker public keys — which
grant nothing. Impersonation requires **stealing C's private key from the
consumer's server**, which is ordinary secret-management, not an on-chain
visibility problem. This is the load-bearing property; see §6.

## 3. Key decisions

- **D1 — Deploy is ungated; the LINK is cronoton-minted after off-chain
  ownership proof.** Deploying either half is the **same** ungated function,
  authorized by the ownership of the Ouronet account it sits under (STOA is the
  anti-spam). The authoritative link is minted by the **Dalos automaton
  (cronoton-keyset)** — but there is **no discretionary admin**: the cronoton
  only mints after Pythia has verified, via `dalos-crypto` challenge-response,
  that the requester controls **both** halves. So the automaton is a trusted
  *executor* acting on proven ownership, not a gatekeeper deciding who's worthy.
- **D2 — Immutable pairing + revocable status.** Each API-key row gains a
  `consumer` (counterpart) field, set once and immutable. Compromise ⇒ **revoke
  the pair** (`iz-active = false`) and **issue a new pair**. The *link* is
  immutable; the *active status* is revocable.
- **D3 — Each consumer holds its OWN sealed identity-Codex and signs LOCALLY.**
  Not centralized in the hub. Preserves autonomy + per-consumer blast radius.
  Mnemosyne (later) is **management of decentralized keys**, never a signer.
- **D4 — Per-call = zero chain reads.** Pythia verifies the signature against a
  **cached** consumer pubkey and a **cached** `iz-active`. Chain is read only on
  cache refresh: **binding/pubkey daily** (show a countdown timer), **revocation
  on a fast lane** (§5) so a revoked pair dies in minutes, not 24h.
- **D5 — Owner = recovery authority.** The owner holds **both** halves in his
  personal Codex, so he signs revoke + re-issue. That is the entire compromise
  story.

## 4. STORAGE ≠ SIGNING (the distinction that settles "where do keys live")

Two independent axes — keep them apart:

- **Signing** (critical path): **always local to the consumer.** The consumer
  loads its sealed Codex, unlocks it with **its own** secret, signs Pythia
  challenges locally. If the storage layer is down, already-running consumers
  keep working.
- **Storage** (convenience): where the sealed blob sits. **Centralize
  management, never signing.**

The consumer does **not** need online codex storage to *function*: it can hold
its own sealed identity-Codex locally (exactly as the AncientHoldings hub holds
its own). Pythia verifies off the **on-chain** pubkey + the signature over the
wire — it never touches the codex. So "store N codices online, reachable" is a
**portability/management convenience (Mnemosyne), not a runtime requirement.**

- **Automaton** (signs its own txns, has its own codex) → C rides in that codex.
- **Daimon** (hosts *users'* codices) that wants a consumer identity → is a
  **mini-automaton** for that purpose: a small own identity-codex holding just
  C. OuronetUI is this case (users' codices ≠ its own identity codex).
- **Mnemosyne** = one *service* managing many *independent* codices, each
  unlocked only by its owner = centralized management of decentralized keys →
  best of both. **The hub is storage-at-most, never the signer for everyone**
  (that model = hub down ⇒ all consumers down, hub compromised ⇒ all identities
  gone; rejected outright).

## 5. Caching + revocation (the freshness design)

| Signal | Freshness | Why |
|---|---|---|
| Consumer pubkey (for signature verify) | cached, daily refresh | rarely changes; show countdown |
| Binding `(S, C)` | cached, daily refresh | immutable once set |
| `iz-active` / revocation | **fast lane** (minutes / push) | compromise recovery must beat 24h |

**Per API call:** verify challenge signature against cached C-pubkey **∧**
cached `iz-active` **∧** cached binding. **Zero chain reads.** The chain is read
only by the refresh job. The daily binding cache is fine; the revocation signal
must be near-real-time (a cheap revocation-epoch/list read every few minutes, or
Pythia subscribes to revoke events). UX: a per-slot **"next read update in
HH:MM"** timer (reuse the Codex debouncer/read-timer pattern).

## 6. The ONE requirement that makes it secure (do not get wrong)

Pythia must authenticate **by signature (proof-of-possession), never by asserted
identity.**

- ✅ "Sign this nonce with C's key" → verify. Only C's server passes.
- ❌ "Tell me who you are" → caller sends C's pubkey/id in a header → Pythia
  trusts it. Then anyone copies the public id off the chain and impersonates.

Every call carries a **fresh nonce + request-bound payload (method, params, ts,
short TTL)**; Pythia rejects reused nonces (replay defense).

## 7. Consumer key hygiene (from the AncientHoldings review)

The consumer's C lives in a **sealed Codex** using the hub's proven model
(`lib/vault.ts`: libsodium XSalsa20-Poly1305 AEAD, 24-byte nonce per seal,
master key read per-op, no global cache, per-op unseal, no resident plaintext).

- **Master key** from **env (hub parity, at-rest only)** or **KMS-on-demand
  (survives live compromise, no human needed for restart)** — recommend KMS.
- **C is auth-only:** it signs Pythia challenges and **nothing else** (mirror the
  hub's observational-refusal so C can never sign a value tx even if reached).
  This bounds compromise to "impersonation until revoked, zero fund loss."
- **Encrypted at rest** defends stolen-DB/backups; **live server compromise** is
  bounded by the auth-only scope + fast revocation (§5) + owner re-issue (D5).

## 8. The finalized protocol (deploy → link → runtime → compromise)

**Deploy (owner, per half):** owner adds a **Standard** Apollo and a **Smart**
Apollo in his Codex → each is brought on-chain by the **same ungated deploy**
(authorized by the ownership of the Ouronet account it's under). Each Apollo row
carries a `counterpart` field initialized to the sentinel **`BAR`**. Cost:
**400 STOA per Apollo.**

**Link (owner asks Pythia, once — the pairing ceremony):**
1. Owner submits one Standard + one Smart to Pythia's **link** request.
2. Pythia **verifies ownership of both halves** via `dalos-crypto`
   challenge-response, through the Codex/OuronetUI, in one of two variants:
   - **(a) both in the same Codex** → one challenge, both signatures verified at
     once; or
   - **(b) halves in different Codices** → challenge for the Standard half
     (verify), then load the other Codex, second challenge for the Smart half
     (verify).
3. On success, Pythia commands the **Dalos automaton (cronoton-keyset)** to mint
   the **link tx**: it creates the **dual-table key** from the two halves with a
   single `is-active` entry set **true**, and writes each half's `counterpart`
   (BAR → the other half's id). **Immutable.** Cost: **200 STOA.**
4. A **C-only** sealed identity-codex is installed on the consumer server.

**`is-active` permission model (the kill switch):**
- **Only Pythia (cronoton)** may **create `true`** or flip **`false→true`**
  (activation is authoritative, gated on the verified ownership proof).
- **The owner** may flip **`true→false`** — **enforced by a half's signature**
  (ownership). This is the immediate, owner-held kill switch.
- **Counterpart writes happen ONLY on the ownership-verified link** (never on a
  permissionless create) — otherwise an attacker could set
  `S.counterpart = C_attacker` and permanently brick S (immutable). If a
  user-create-false path is kept, it MUST require **both** halves' signatures.

**Runtime (per session/call):** consumer server loads + unlocks its sealed codex
→ Pythia issues a nonce challenge → consumer signs with C → Pythia verifies
(cached pubkey + cached `is-active` + binding, **zero chain reads**) → serves.

**Compromise (owner):** owner flips `is-active → false` (kill switch, immediate
on-chain) → Pythia's **fast-lane poll** (§5) picks it up within minutes → owner
mints a **fresh** S'/C' pair and re-links (the old pair stays dead; you do NOT
reactivate a compromised key). Recovery cost: **~1000 STOA** (400+400+200).

## 9. Open questions to confirm during implementation

1. Exact Pythia table key + reverse-index shape (§ handoff).
2. Revocation fast-lane mechanism: polled revoke-epoch vs push/subscription.
3. Master-key provenance for the first OuronetUI prototype: env (hub parity) vs
   KMS (recommended) — env is acceptable for v1 given auth-only scope.
4. Does the consumer make any Pythia calls **not** tied to its own identity? If
   all calls are "consumer-authenticated," the pair fully covers it.
