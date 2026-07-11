# Handoff: wiring the Codex into a consumer app

**Audience:** an agent (or dev) modifying a **consumer** — OuronetUI, an Automaton
(Caduceus, Dalos, Mnemosyne), any Daimon — to host the AncientPantheon **Codex**
for real users.

**Scope of this handoff:** how to **wire the Codex in** — i.e. how to give it its
blockchain **connections** and surface them. It is **not** a login/auth guide.

**Premise:** the Codex is a **keys + signing** primitive with **no blockchain access
of its own**. It cannot read balances or broadcast transactions by itself — it must
be *given* blockchain **connections**. A consumer hosting the Codex supplies those.

> **Status pin:** the Codex-side connection seam (exact prop/interface names) is
> defined by the **Codex Connection Layer** spec (in progress). This handoff
> describes the consumer-facing *shape* + invariants; take exact symbol names from
> that spec when it lands.

---

## 0. Prerequisite (OUT OF SCOPE here): the AncientHub admin gate

To let an operator set a **site-wide (global)** connection for all users, the
consumer must be able to answer one question: **"is the current user an
`ancientadmin`?"** That comes from the shared **AncientHoldings admin login** (the
same SSO every `*.ancientholdings.eu` app uses).

- **How to implement that login is NOT covered here** — it is a separate integration
  with its **own how-to**, owned by the hub side (being finalized separately). Do not
  reimplement or pre-empt it in the course of this wiring.
- **All the Codex wiring needs from it** is that boolean `ancientadmin` gate, used to
  protect the global-connection admin surface (§2.1).
- **If a consumer has no admin gate** (a static or single-user deployment), that is
  fine — it simply runs **local-only** (no global connection; see §4). The admin gate
  is only required for the *global* tier.

Everything below assumes that gate already exists (or is intentionally absent).

---

## 1. The mental model (load-bearing)

```
Automaton = Codex (keys + signing, N chains) + Pythia (reads, N chains) + Khronoton + logic
Daimon    = Codex (keys + signing, N chains) + Pythia (reads, N chains) + a human    + logic
```
*(from `docs/CODEX-V2-ARCHITECTURE-PLAN.md` §0)*

- **Codex owns:** keys, signing, the backup codec, the wallet UI, and *building*
  chain requests (Pact for StoaChain, tx-build for Arweave). It never reads or
  broadcasts on its own.
- **A `ChainConnection` is keyless transport** — `read` / `send`(a *caller-signed*
  tx) / `poll` / `health`. **Keys never touch it.**
- **Pythia is the multi-chain connection provider** — an **injection point Pythia
  satisfies; the Codex does not hard-depend on it** (V2 plan §1.2–1.3). A **direct
  node/gateway URL** is the per-chain fallback.
- **The Codex stays auth-free.** The admin gate (§0) lives in the **consumer**; the
  Codex only receives an injected connection + a `locked` flag.

**Two tiers of connection:**

| Tier | Set by | Scope | Persisted | Needs |
| --- | --- | --- | --- | --- |
| **Global** | a user with `ancientadmin` (via the consumer's gate) | whole deployment, all users | server-side (consumer's store) | the admin gate (§0) + §2 |
| **Local** | any user, via the Network tab | that user's browser only | client-side (localStorage) | §2 only |

**Per-chain resolution rule** (the Network tab renders one row per chain):

| Chain covered by… | Row shows | Manual node field |
| --- | --- | --- |
| the **global** connection (e.g. StoaChain via admin-Pythia) | **Live (global)** | **disabled** — the site provides it |
| **not** globally covered (e.g. Arweave — Pythia has no Arweave adapter yet) | **Missing** | **enabled** — a user may add their own node → **Live (local)** for them only |
| neither | **Not connected** | enabled |

Coverage is **dynamic** — the row is driven by the connected Pythia's advertised
coverage (`health()`), never hard-coded. The day Pythia gains a chain, that row flips
to **Live (global)** and its field auto-disables, **no code change**.

---

## 2. The Codex connection wiring

Applies to **every** consumer (a standalone Codex uses only the local half, §4).

### 2.1 Global connection store (server-side, behind the consumer's `ancientadmin` gate)

- Behind the admin gate (§0), the admin sets the **global connection**: a **Pythia
  base URL** (covers every chain Pythia serves — StoaChain today) and/or **per-chain
  global node URLs** (e.g. a site-wide Arweave gateway for a chain Pythia doesn't
  cover yet).
- Persist it in the consumer's store.
- **Serve the resolved global config to the browser at load — URLs only, no secrets.**
  A Pythia base URL and per-chain node URLs are public-safe.

> This requires a **backend surface** on the consumer (to persist + serve the global
> config; and to host the admin gate of §0). A pure static SPA can only do **local**
> connections (§2.2) — it cannot host a global admin-set connection.

### 2.2 Local connection layer (client-side)

- The Codex's **Network settings** tab lets a user set **per-chain overrides** for
  chains the global connection does **not** cover (the "enabled field" rows).
- Persist locally (browser `localStorage`), **browser-scoped** — affects only that
  user, never touches the global store.

### 2.3 Inject into the Codex provider

When mounting the Codex, hand it:

- **the connection**, resolved **per chain** from `global (base) ⊕ local (override)`
  using the rule in §1 (global covers → use it, field disabled; else local if set;
  else "Missing");
- a **`locked`** flag: `true` for non-admin users (the Network tab is **read-only
  status**), `false` in standalone (fully editable).

> Conceptually the Codex exposes: a `ChainConnection`
> (`read`/`send`/`poll`/`health`) per chain, a `PythiaConnection` impl (wraps
> `@ancientpantheon/pythia-client`) and a `DirectNodeConnection` impl (from a URL),
> and a network-settings model the Network tab binds to. The **consumer supplies the
> global base + the `locked` flag**; the Codex owns the resolution, the local layer,
> and the UI. Exact prop names come from the Connection Layer spec.

### 2.4 The Network tab

Renders one row per supported chain per §1 (Live-global / Live-local / Missing /
Not-connected + the enabled/disabled manual field) + per-connection health. Read-only
when `locked`. This is what a regular user sees ("Connected via Pythia · StoaChain
Live · Arweave Missing"); the admin surface (§2.1, behind the §0 gate) is where
`global` is actually set.

> ⚠ **Implementation gap (2026-07-11) — see `HANDOFF-codex-ui-managed-network-tab.md`.**
> The shipped `NetworkSettingsCard` currently does `readOnly = locked || model.locked`
> and `fieldEnabled = manualFieldEnabled && !readOnly`, so `locked` freezes **every**
> per-chain field — contradicting this section (the not-globally-covered fields must
> stay **editable** for a regular user's local layer). A **managed** consumer therefore
> cannot today get "read-only Pythia + editable local nodes" at once. The referenced
> handoff decouples them (`lockLocalFields`, not a blanket `locked`) and adds the
> **consumer-key display**: for a managed consumer the read-only Pythia connector shows
> the bound consumer Apollo **C** public key (or "Not wired in yet"). Until that lands,
> a consumer must choose all-locked or all-editable.

---

## 3. The implementing agent's checklist (Codex wiring only)

Assumes the §0 admin gate exists (or is intentionally absent → local-only).

1. [ ] **Global store** (multi-user only): behind the consumer's existing
       `ancientadmin` gate, add an admin surface + persisted store to set/clear the
       **Pythia URL** and **per-chain global node URLs**.
2. [ ] **Serve** the resolved global connection (URLs only, no secrets) to the client
       at load.
3. [ ] **Inject** the connection (`global ⊕ local`) + `locked` (`true` for regular
       users) into the Codex provider (per the Connection Layer spec).
4. [ ] Surface the **Network tab** — read-only for users; only the per-chain fields
       for chains the global doesn't cover are editable (→ that user's local layer).
5. [ ] **Verify:** a fresh user sees **StoaChain Live (via Pythia)** + **Arweave
       Missing** with an editable Arweave-gateway field; an admin setting the global
       Pythia connection applies to everyone; a user's local Arweave gateway affects
       only that browser.

---

## 4. Standalone (single operator — e.g. the codex-playground)

No admin gate needed. Mount the Codex with `locked=false`; the user configures Pythia
and/or per-chain nodes directly in the Network tab, persisted locally. `global ==
local` (one user). None of §0 / §2.1 applies.

---

## 5. Invariants — do not break

- **Keys never leave the Codex.** The connection is keyless transport.
- **The Codex stays auth-free** — the admin gate lives in the consumer; the Codex only
  takes an injected connection + a `locked` flag. Do not add auth to the Codex.
- **Pythia coverage is dynamic**, read from `health()` — never hard-code which chains
  Pythia serves. (Arweave-in-Pythia is a separate Pythia-repo task; until then,
  StoaChain-via-Pythia + Arweave-via-direct is the working state.)
- **Do not break the two live production consumers** (V2 plan §1.4). New wiring is
  additive; the existing hooks + `IConsumerSettings` multi-consumer namespacing are
  the stable seam.
- **Align with the Codex Connection Layer spec** for the exact seam contract before
  writing §2 code.

## References

- `docs/CODEX-V2-ARCHITECTURE-PLAN.md` — Codex v2 architecture (Codex = keys, Pythia =
  reads injection point).
- `@ancientpantheon/pythia-client` — the `read`/`send`(keyless)/`poll`/`health` client
  a `PythiaConnection` wraps.
- The AncientHub admin-login integration — **separate handoff, owned by the hub side**
  (out of scope here; §0 only needs its `ancientadmin` boolean).
