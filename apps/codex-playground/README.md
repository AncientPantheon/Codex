# Codex Playground

**Private, unpublished, dev-only.** A self-contained local Codex — a Vite + React
devtool that mounts the **real** codex-ouronet dashboard against the workspace
source for manual verification. It is a `workspace` member marked `"private": true`
with **no `publishConfig`**; it is never published to any registry and stays out of
the library `tsc --build` graph.

Use it to load, view, edit, and export any codex locally, and — with the opt-in
Arweave path — to exercise the foreign-chain (Arweave) wallet against a
testnet/local gateway. It persists nothing remotely: **no cloud adapter, no cloud
login, no remote storage** (see [No cloud persistence](#no-cloud-persistence-n-11)).

---

## Run it locally

From this app directory:

```bash
npm run dev
```

Vite serves the shell against the workspace source (hot-reloadable). The other
scripts: `npm run build` (production bundle), `npm run preview`, `npm run test`
(the jsdom + RTL suite), `npm run typecheck` (`tsc --noEmit`).

---

## Load a codex — two modes

The landing screen has two explicit entry points (no byte-sniffing):

### Mode 1 — encrypted backup + password

Upload an encrypted backup `.json` and unlock it with its password. Under the
hood an **empty** local adapter is mounted first, the uploaded backup is restored
**into** the mounted store via the real `useCodexBackup().importFromCloud(text)`,
and an unlock screen gates the dashboard until `useCodexAuth().authenticate(...)`
seeds the password cache.

The backup wire format is the **`"1.3"` codec envelope carrying
`{ foreignKeys, pureKeypairs }`** — the format the codex family emits after the
foreign-keys rewire. The reader also accepts the older `"1.2"` backups (they
restore forever), so both a with-Arweave-keys `"1.3"` backup and a legacy `"1.2"`
backup load correctly.

### Mode 2 — plaintext fixture

Load a plaintext `OuronetSnapshot` fixture (an empty codex or a populated-Kadena
codex). The snapshot is hydrated **verbatim** into a fresh local adapter
pre-mount, so the dashboard renders directly with **no unlock** (mode 2 carries
no encrypted secrets).

---

## View / edit / export any codex

Once loaded (either mode), the **real** shipped dashboard renders — the same
codex-ouronet shell (`CodexUiRoot` + the STAY tabs) the production wallet uses,
not a throwaway fork. View and edit the codex normally, then **Export codex to
JSON** re-emits the current store via the real `useCodexBackup().downloadAsJson()`
— the symmetric counterpart to the mode-1 restore (same `"1.3"` format), not a
bespoke serializer.

---

## The Arweave path — mock ⇄ real toggle

The dashboard composes a **Foreign Chains** tab wired to the Arweave panel, plus
a **mock ⇄ real Arweave mode toggle**.

### Funds-safety: default mock + offline, real is opt-in

- **The app boots in MOCK + OFFLINE mode by default.** The mock Arweave adapter
  returns deterministic fake balances/addresses/keys with **no network and no
  real keys** — nothing can spend anything in mock mode.
- **Real mode is OPT-IN.** You must explicitly flip the toggle to real. Only then
  is the real adapter (the E1 `createArweaveAdapter` + real send/balance/status +
  real upload/Library) constructed against the configured gateway.
- **A visible funds-safety warning** appears in real mode: real mode transacts
  against the configured gateway and **must not be pointed at Arweave mainnet with
  real funds**.

### Gateway URL config

Real mode reads a **configurable gateway URL** text input, fed to arweave-core's
`createGatewayPool`. It **defaults to a testnet/local endpoint
(`http://localhost:1984`)** — an arlocal/localhost dev gateway, deliberately
**never** the `arweave.net` mainnet gateway. Point it only at a testnet/local
node.

### Throwaway-fixture policy

Any committed keyfile fixture is **THROWAWAY and NEVER funded**. The real-toggle
import path reuses E1's canonical throwaway keyfile
(`packages/codex-arweave/tests/fixtures/throwaway-arweave-keyfile.json`, mirrored
here at `fixtures/throwaway-arweave-keyfile.json`) — a real 9-field RSA JWK that
backs no funds. **Never generate or commit a funded key.** The committed
`"1.3"`+foreignKeys backup fixture carries only **encrypted** keyfile blobs (never
plaintext) with a clearly-labeled dev-only password.

### Caveat — keygen in the playground is unsupported (main-thread)

The playground does **not** support worker-based Arweave key generation. Real-mode
keygen would run **main-thread**, and worker-driven keygen-in-the-playground is
**documented as unsupported** — **import a throwaway keyfile instead** of
generating one here. (Automated tests always use a fake keygen runner regardless.)

### Caveat — real-mode browser upload is best-effort

Real-mode **browser upload** (Turbo / `arweave`) is **best-effort**. The
`arweave`/Turbo browser polyfill shims provisioned for the bundle are throw-on-use
for unreachable Node branches, so a live browser upload may require additional real
polyfills at the point of use. The automated tests exercise the "real" path via
**injected fakes** (fake pool / apiFactory / fetch / Turbo client), never a live
gateway — so the polyfill gap is invisible to CI and only surfaces on a manual live
upload. Treat live browser upload as a manual, opt-in dev affordance.

---

## No cloud persistence (N-11)

The playground is a **self-contained local Codex**. It persists the codex through
**uploaded JSON + local stores only**:

- **No cloud adapter.** The codex is mounted on a local in-memory
  `MemoryCodexAdapter` (hydrated from the uploaded backup / plaintext fixture).
- **No cloud login.** Mode 1 uses the local unlock screen; mode 2 needs no login.
- **No remote storage.** Nothing is written to a remote/cloud backend; export is a
  local file download.

The Arweave real-mode gateway RPC (opt-in) is the **only** network the app can
reach, and it is a foreign-chain transaction gateway — not codex persistence. The
codex store itself never leaves the machine.
