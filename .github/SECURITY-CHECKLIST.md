# Publish / Supply-Chain Security Checklist

Hardening that cannot live in workflow YAML and must be configured in GitHub
repo settings and on npmjs.org. These are action items for the repo owner /
org admin. The workflow files already apply everything that IS expressible in
YAML (least-privilege token, SHA-pinned actions, no persisted git credentials,
`npm ci --ignore-scripts`, non-blocking advisory audit, an `environment:
npm-publish` gate on the publish job, and — as of 2026-10-14 — npm Trusted
Publishing as the primary publish path: no `npm whoami`, `npm publish
--provenance` authenticates via the OIDC token `id-token: write` issues, run
from each package's own directory via `working-directory:` rather than
`--workspace=` from the monorepo root, with `actions/setup-node`'s
`registry-url:` and an upgrade to `npm >= 11.5.1` both present — both are
easy to silently omit and neither announces itself when missing: without
`registry-url:` npm never even attempts OIDC and fails in ~1.5s with
`ENEEDAUTH`, which reads exactly like a forgotten login. A `workflow_dispatch`
probe step in `publish.yml` asks npm's own exchange endpoint whether each
package's connection actually matches, without publishing anything — run it
via `gh workflow run publish.yml` before relying on a real tag push).

The npm-side registration itself (SF-010 below) is the one piece that
genuinely cannot live in YAML. **As of 2026-10-14 it has been done for
`@ancientpantheon/codex`** (owner-confirmed) but **not yet verified working**
— confirmed independently that the sibling `@ouronet/talos-registry` package
hit `ENEEDAUTH` on its own `v2.3.0` tag the same day after an otherwise
equivalent workflow switch, root-caused to a missing `registry-url:` on its
`setup-node` step (now fixed in that repo too). Run the probe before trusting
a real release.

## SF-011 — Restrict who can trigger a publish

The publish workflow runs on `push: tags: ["v*"]` **as committed at the tagged
ref**, so every gate in it is self-attested. Anyone with write access can tag
an arbitrary commit and ship it. Close this at the settings layer:

- [ ] **Tag ruleset (admins only).** Repo → Settings → Rules → Rulesets →
      New tag ruleset. Target `v*`. Restrict tag creation/update/deletion to
      admins (or a dedicated release team). This prevents a non-admin (or a
      compromised write-scoped token) from creating a `v*` tag that publishes.
- [ ] **Protected `environment: npm-publish` with a required reviewer.** Repo →
      Settings → Environments → New environment named `npm-publish` (the
      publish job already references it). Add a **required reviewer** so a human
      must approve each run before the publish job proceeds. Optionally scope
      the `NPM_TOKEN` secret to this environment (see SF-010) instead of the
      repo/org level, so it is only injectable into a reviewer-gated run.
- [ ] Optionally add a deployment branch/tag rule on the environment limiting
      it to `v*` tags.

## SF-010 — Retire the long-lived org-wide `NPM_PUBLISHER` token

**Workflow side: done (2026-10-14), revised same day after real failures on
the sibling repo taught us the actual requirements.** `publish.yml`:
- gives `actions/setup-node` a `registry-url:` (missing this is silent and
  fails fast with a misleading `ENEEDAUTH` — the actual root cause of the
  `@ouronet/talos-registry` failure referenced above, not an environment
  mismatch as first suspected);
- upgrades npm first (`npm install -g npm@latest` — Trusted Publishing needs
  >= 11.5.1, `setup-node` ships 10.x);
- publishes each package from its own directory (`working-directory:
  packages/codex` / `packages/arweave-core`) rather than `--workspace=` from
  the root, since npm resolves the OIDC-exchange identity from the current
  directory;
- tries OIDC first, always, for both packages, and falls back to the
  `NPM_PUBLISHER` secret ONLY if that specific publish attempt fails — this
  is deliberate, not a half-migration: a brand-new Trusted Publisher
  connection reads "Pending validation" on npmjs.com until one publish has
  actually landed through it, and OIDC exchanges 404 on every attempt before
  that first one (circular, by npm's own design). The fallback breaks that
  loop once, for whichever package needs it, and does nothing on every run
  after.
- runs a non-publishing `workflow_dispatch`-triggered probe step that asks
  npm's OIDC exchange endpoint directly whether each package's connection
  matches — `gh workflow run publish.yml`, ~40s, before trusting a real tag.

**npm side: owner-confirmed done for `@ancientpantheon/codex` (2026-10-14).**
Still to confirm for `@ancientpantheon/arweave-core` — same connection, since
it ships from this identical repo/workflow/environment, just a separate
npm package registration:

- [ ] For **both** `@ancientpantheon/codex` and `@ancientpantheon/arweave-core`:
      npmjs.com → package → Settings → "Trusted Publisher" → add:
      - Publisher: **GitHub Actions**
      - Organization or user: **AncientPantheon**
      - Repository: **Codex**
      - Workflow filename: **publish.yml**
      - Environment name: **npm-publish** (matches the `environment:
        npm-publish` key already in `publish.yml`)
      - Allow npm publish: **checked** (required — this is the whole point)
      - Allow npm dist-tag: optional; this workflow has no separate
        dist-tag-promotion step today, so it is not currently needed, but
        is low-risk to enable for future-proofing
- [ ] Run the probe (`gh workflow run publish.yml`, then check the "OIDC
      exchange probe" step's log) and confirm HTTP 201/200 for both packages
      before relying on a real tag push.
- [ ] Once a real tag push has published both packages successfully via
      OIDC (not the fallback branch), the `NPM_PUBLISHER` repo secret is
      dead code — safe to delete from Settings → Secrets, not required
      before.

## SF-028 — Keep actions SHA-pinned (ongoing)

`actions/checkout` and `actions/setup-node` are pinned to full commit SHAs in
both workflows. To keep them current and pinned without manual SHA lookups:

- [ ] Enable **Dependabot for GitHub Actions** (`.github/dependabot.yml` with a
      `package-ecosystem: "github-actions"` entry). It bumps the pinned SHA and
      updates the trailing version comment in PRs.
