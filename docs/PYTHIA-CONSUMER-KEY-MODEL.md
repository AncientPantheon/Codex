# Pythia ⇄ Codex consumer-key model (design conclusion — for the Pythia repo)

**Status:** agreed direction (owner + assistant, 2026-07-07). NOT yet implemented.
This is the Codex-side conclusion to hand to the **Pythia** repo/team to refine and
settle the implementation. The Codex side is tiny; the substance is Pythia's.

---

## The problem

A consumer of the Codex needs a Pythia connection to serve blockchain reads/relays.
Three deployment styles exist, and they seem to conflict:

1. **Server-backed consumer** — an admin logs in and sets the Pythia connection at
   runtime; the value lives in the consumer's database (mutable, rotatable).
2. **Static / permaweb consumer** — no backend, no DB. Deployed immutably (e.g. on
   Arweave). Cannot hold a mutable admin-set value.
3. **Zero-setup standalone** — "just works" out of the box with no per-user config.

The tension: a runtime admin-set global (style 1) is **not permaweb-capable** (static
sites can't mutate config), yet we still want **per-consumer reporting/metering**.

## The core insight that unlocks everything

> **Pythia is keyless.** It only does reads and relays *already-signed* transactions.
> The Codex signs client-side; Pythia never holds a private key. Therefore a Pythia
> API key embedded in a static bundle grants **read + relay-of-signed-tx only — it can
> never move funds.** That is what makes a *public, embeddable* key acceptable.

(If Pythia ever held signing power, embedding a key would be catastrophic. It does not.)

## The conclusion: don't choose a variant — layer them, and make keys DATA not code

### 1. The key **is** the consumer identity (the "lane")

Pythia issues **one key per Core Consumer** (`pk_ouronet_…`, `pk_ouronet_dev_…`,
`pk_mnemosyne_…`, `pk_aletheya_…`). Each consumer **bakes its own key at build time**.
When the Codex (running inside OuronetUI) calls Pythia carrying OuronetUI's key,
**Pythia already knows it's OuronetUI — the key told it.** Per-key metering = per-consumer
reporting, for free. No host-detection, no lane negotiation.

- **Declaration beats detection.** The Codex must NOT try to detect its host (a static
  bundle can't reliably know if it's OuronetUI vs Mnemosyne — domain-sniffing is fragile,
  spoofable, breaks on forks/custom domains). The consumer *declares* its identity by
  baking its key.
- **The Codex hardcodes NO consumer list.** Adding Aletheya = Pythia issues a key = one
  DB insert. **No Codex release, no Pythia redeploy.** This is the property that keeps the
  Codex a reusable, consumer-agnostic template.

### 2. Keys are a **registry (database)**, not hardcoded lanes

Pythia is a server — its keys/lanes are **data** (issue / rotate / revoke = admin DB
operations), never code. This is the single decision that removes the "locked / must
redeploy to add a lane" feeling. (Only the *consumer's copy* of its key is static/baked;
Pythia's side is fully dynamic.)

### 3. Classify keys by **secrecy**, not mutability

- **Public / embeddable keys** — for permaweb + any static consumer. Safe to ship in the
  bundle *because Pythia is keyless*. Scope: **read + relay-signed-tx only**. Rate-limited
  per key. **Revoke = rotate** (the consumer redeploys with a new key — fine, permaweb apps
  redeploy to update anyway).
- **Secret keys** — for server consumers that proxy through a backend and keep the key
  hidden, rotating at runtime.

### 4. The Codex resolves the **best-available** connection (a fallback chain)

1. **Admin-set at runtime** (server consumers) → use it.
2. **Consumer-baked key** (permaweb + normal consumers) → use it. *(segregated, metered)*
3. **Community / default key** → a shared, **hard-rate-limited** "unregistered" lane the
   standalone build ships, so it *just works* with zero setup. Real consumers upgrade off it.
4. **None** → the user wires a local node by hand; no Pythia at all.

> "Master key" is the wrong framing — a single all-powerful key can't be revoked without
> breaking everyone and gives no metering. The shipped fallback is a **distinct, low-trust,
> hard-rate-limited community lane**, not a master.

### 5. Keep the Codex npm **package** credential-free

A *package* that embeds a key would need republishing to rotate it. Instead, the **standalone
build** (the shippable app) bakes the community key. Every deployment is a consumer; each
bakes a key (community or its own); the Codex-the-library stays a pure template. Rotation =
the *build* redeploys, never the package.

---

## What each side builds

### Pythia (the real work — this repo's task)
- A **consumer-key registry** (DB): issue / list / rotate / revoke keys, each mapped to a
  Core Consumer identity.
- **Two key classes:** public/embeddable (read+relay scope, rate-limited, rotate-to-revoke)
  and secret (server-proxied).
- **Per-key metering + rate-limiting** → per-consumer reporting.
- A **community/default key** (shared, hard-rate-limited) for unregistered/standalone use.
- Auth on every read/relay request via the presented key (header).

### Codex (tiny — this repo)
- One optional `apiKey` on the injected Pythia connection config, sent by `PythiaConnection`
  as a request header. (`createPythiaConnection` already exists; this is one field.)
- The consumer's **build** bakes `{ pythiaBaseUrl, pythiaApiKey }` as build-time constants
  (permaweb-safe). Local per-user node overrides still work client-side.
- Doc: `docs/CONSUMER-INTEGRATION.md` gains the "bake your Pythia key at build time; here's
  why public is safe" section.

## Core Consumer registry (initial)
`OuronetUI`, `OuronetUI-DEV`, `Mnemosyne`, `Aletheya`, … (extend freely — each is just a
registry row + a baked key; the Codex never changes).

## Open questions to settle with Pythia
- Key format + rotation cadence; how a permaweb consumer is notified to redeploy on rotate.
- Rate-limit tiers per class (community vs registered) and per Core Consumer.
- Whether the community key is per-build-version or global; abuse containment.
- Exact request-auth shape (header name, error semantics on revoked/over-limit).
