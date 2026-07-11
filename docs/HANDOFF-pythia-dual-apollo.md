# HANDOFF — Pythia dual-Apollo: Pact contract + service

**Target repos:** the `PYTHIA` Pact module (stoa-js / on-chain), and the Pythia
API service (off-chain). **Read `DUAL-APOLLO-CONSUMER-IDENTITY.md` first** — this
doc implements §2–§8 of it.
**Prereq:** the existing deploy surface from
`HANDOFF-codex-apollo-activation-ui.md` §2 (`PYTHIA|C_DeployApiKey`,
`A_DeploySmartApiKey`, `INFO_DeployApiKey`).

---

## PART A — On-chain (PYTHIA Pact module) — FINALIZED PROTOCOL

### A1. Deploy — ungated, same function for both halves
One deploy function for **Standard AND Smart**, authorized by the ownership of
the **Ouronet account the Apollo sits under** (no admin / no `dh_master-keyset`;
STOA is the anti-spam — **400 STOA / Apollo**). Each Apollo registry row carries
a `counterpart` field initialized to the sentinel **`BAR`**.

### A2. Registry fields
| field | type | semantics |
|---|---|---|
| `counterpart` | string | the other half's Apollo id. Starts `"BAR"`; written **once** by the link (A3), then **immutable** (fail if `counterpart != "BAR"` at link time). |

The **dual entry** (keyed by both halves, A3) carries the single `is-active` bool.

### A3. Link — cronoton-minted after OFF-CHAIN ownership proof
The link is **not** a user tx and **not** a mutual on-chain co-sign. Flow:
1. User requests link at Pythia (one Standard + one Smart).
2. Pythia verifies ownership of **both** halves **off-chain** via `dalos-crypto`
   challenge-response through the Codex/OuronetUI — two variants: **(a)** both in
   the same Codex → one challenge, both sigs; **(b)** halves in different Codices
   → Standard challenge (verify), then Smart challenge (verify).
3. On success Pythia commands the **Dalos automaton (cronoton-keyset)** to mint
   the link tx (**200 STOA**), which: derives the **dual-table key** from
   `(standard, smart)`, creates its `is-active` entry = **`true`**, and writes
   each half's `counterpart` (`BAR` → the other half).
Do this **atomically / before the halves are exposed** so no one can pre-bind.

### A4. `is-active` permission model (the kill switch)
- **cronoton-keyset ONLY** may **create `true`** or flip **`false→true`**
  (activation is authoritative — gated on the A3 ownership proof).
- **Owner** may flip **`true→false`** — **enforced by a half's signature**
  (ownership). Immediate, owner-held kill switch.
- **⚠ counterpart is written ONLY by the cronoton link (A3)** — never by any
  permissionless / user create. If a user-create-`false` path is kept, it MUST
  require **both** halves' signatures; otherwise an attacker writes
  `S.counterpart = C_attacker` and **permanently bricks S** (immutable). Safest:
  **no user-create at all** — users may only flip an *existing* row off.
- **Compromise:** owner flips off → mint a **fresh** pair + relink (≈1000 STOA);
  do **not** reactivate a compromised pair.

### A5. Reads the service needs
- Read the dual entry by `standard` **and** by `smart/consumer` (both lookup
  directions) → `{ counterparts, is-active }`.
- A cheap, O(1) **`is-active` / revocation-epoch** read the service can poll
  **frequently** — the fast lane (B3).

---

## PART B — Off-chain (Pythia API service)

### B1. Local table (mirror of on-chain, for zero-chain-read auth)
Keyed by standard Apollo, with a reverse index on `consumer`:
```
api_key_binding(
  standard_pub    TEXT PRIMARY KEY,
  consumer_pub    TEXT UNIQUE,      -- reverse-lookup index
  is_active       BOOLEAN,          -- mirrors the on-chain dual entry
  lane            TEXT,
  cached_at       TIMESTAMP,        -- drives the daily binding-refresh timer
  next_refresh_at TIMESTAMP
)
```

### B2. Auth flow (per session/call — ZERO chain reads) (D4, §6)
1. Caller: "I'm consumer `C`, serve slot for me."
2. Pythia: issue **challenge** = fresh nonce + request-bound payload (method,
   params, timestamp, short TTL).
3. Caller signs the challenge with **C's private key**; sends `{request, sig}`.
4. Pythia: look up `consumer_pub = C` in `api_key_binding`; **verify sig against
   the cached `consumer_pub`** (via `dalos-crypto`, the production Apollo/DALOS
   curve engine); require `is_active`; reject reused nonce.
5. Pass → serve + meter under `(standard_pub, C)`.

**Never** authorize on an *asserted* identifier (a pubkey in a header) — always
the signed challenge. This is the whole security hinge (§6).

### B3. Cache freshness (D4, §5)
- **Binding + pubkey:** refresh from chain **once/day** per slot
  (`URC_ApiKeyBySlot` / `URC_ApiKeyByConsumer`). Surface `next_refresh_at` so the
  UI can show a per-slot **"next update in HH:MM"** timer.
- **Revocation:** poll the `is-active` / revocation-epoch read on a **short
  interval (minutes)** (or subscribe to events); on change, immediately re-pull
  affected rows and flip `is_active=false`. The owner's on-chain kill switch is
  instant, so this poll interval **is** the real kill-switch latency — keep it
  short, NOT the daily binding-refresh interval.
- Per API call touches **only the local table** — no chain read.

### B4. Metering / attribution
Meter usage under `standard_pub` (the slot / billable unit). `consumer_pub`
confirms *which* consumer; `lane` is the human label.

---

## Test / acceptance checklist
- Deploy works with **no** admin keyset present, for both forms (A1).
- `counterpart` starts `"BAR"`, is written **only** by the cronoton link, and
  cannot be overwritten once set (A2/A3 immutability).
- Link requires the **off-chain both-halves** ownership proof; a single-half
  proof fails; the cronoton mints on success (A3).
- **Only** the cronoton writes `is-active=true`; an owner `true→false` flip
  requires a half's signature; a **permissionless** flip fails (A4).
- **Brick test:** no permissionless/single-half path can write `counterpart` —
  attempting `(S_yours, C_attacker)` from a caller lacking S's key fails (A4).
- Service auth **rejects** a request that only *asserts* C's pubkey without a
  valid `dalos-crypto` signature (B2, the hinge).
- A killed pair stops working within the **fast-lane interval (minutes)**, not a
  day (B3).
- Per-call auth path issues **zero** chain reads (B2).

## Open questions (confirm with owner)
- Signature curve/verify lib for the Apollo pubkey on the service side.
- Revocation fast-lane: polled epoch vs event subscription (B3).
- Exact FQN/module path of the deploy + read functions (mirror StoicTag
  resolution, per the activation handoff §2).
