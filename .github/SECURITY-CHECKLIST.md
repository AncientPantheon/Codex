# Publish / Supply-Chain Security Checklist

Hardening that cannot live in workflow YAML and must be configured in GitHub
repo settings and on npmjs.org. These are action items for the repo owner /
org admin. The workflow files already apply everything that IS expressible in
YAML (least-privilege token, SHA-pinned actions, no persisted git credentials,
`npm ci --ignore-scripts`, token-on-disk only immediately before publish,
non-blocking advisory audit, and an inert `environment: npm-publish` gate on
the publish job).

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

## SF-010 — Kill the long-lived org-wide `NPM_TOKEN`

The workflow half-wires npm Trusted Publishing already (`id-token: write` +
`npm publish --provenance`) but still authenticates with a long-lived,
org-wide `NPM_TOKEN`. An org-level secret has a blast radius spanning every
repo the org grants it to, with no expiry and no per-package scope.

- [ ] **Adopt npm Trusted Publishing (OIDC)** for both public packages
      (`@ancientpantheon/arweave-core`, `@ancientpantheon/codex`): on npmjs.com,
      each package → Settings → Trusted Publisher → add this GitHub repo +
      `publish.yml` workflow. Then **drop `NPM_TOKEN`** and the `.npmrc`
      token-write step entirely — OIDC replaces the `_authToken`.
- [ ] **If a token is still required** (e.g. for the first-ever publish before
      the package exists on npm), issue a **granular access token** that is:
      short-expiry, scoped to exactly these two packages, and stored as an
      **environment-scoped** secret on `npm-publish` (not repo-wide, never
      org-wide). Rotate/revoke it once Trusted Publishing is live.

## SF-028 — Keep actions SHA-pinned (ongoing)

`actions/checkout` and `actions/setup-node` are pinned to full commit SHAs in
both workflows. To keep them current and pinned without manual SHA lookups:

- [ ] Enable **Dependabot for GitHub Actions** (`.github/dependabot.yml` with a
      `package-ecosystem: "github-actions"` entry). It bumps the pinned SHA and
      updates the trailing version comment in PRs.
