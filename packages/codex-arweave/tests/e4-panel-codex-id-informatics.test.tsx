/**
 * RED matrix for the "Codex ID" page's two informatics explainer components
 * (`codex-id-page` T2).
 *
 * Both components are purely presentational, static-content explainers —
 * no fakes/mocks needed, just render and assert the real, rendered copy.
 * Every assertion below is written against the actual design documents
 * (`codex-backup-envelope-encryption/design.md`,
 * `legacy-prime-migration/design.md`), quoted/paraphrased in each test's
 * own comment, so a reviewer can confirm accuracy by reading THIS file
 * alone, without re-reading the component source:
 *
 * - `CodexBackupInformatics`: what gets backed up (the whole codex, every
 *   keyring, as ONE upload, distinct from the per-file Upload Wizard); the
 *   envelope encryption in plain terms (fresh one-time key, wrapped under
 *   real secrets, the whole backup sealed again as one opaque block hiding
 *   the shape itself, not just values); the two independent restore paths
 *   (Master Seed words; Codex Identity's "Standard" half specifically, NOT
 *   the combined identity, NOT "Smart") — either alone suffices; the
 *   optional Arweave-PIN, with its unmissable "as unrecoverable as the seed
 *   words, no reset, ever" warning, and its opt-in/never-default framing.
 * - `CodexMigrationInformatics`: why some codexes aren't eligible (Ouronet
 *   identity and Arweave recovery seed not sharing origin words, usually a
 *   wallet-imported phrase); the three-option menu with
 *   `legacy-prime-migration/design.md`'s EXACT conditional-default framing
 *   (option 2 recommended when an existing custom-worded account exists,
 *   option 1 recommended otherwise, option 3 always available but always
 *   marked not-recommended); the explicit "moves real on-chain STOA/urSTOA,
 *   never instant, never one click, every fund-moving step needs
 *   confirmation" statement.
 */

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { CodexBackupInformatics } from "../src/panel/CodexBackupInformatics";
import { CodexMigrationInformatics } from "../src/panel/CodexMigrationInformatics";

afterEach(() => {
  cleanup();
});

describe("CodexBackupInformatics — what gets backed up", () => {
  it("states the WHOLE running codex (every keyring) is backed up as ONE Arweave upload", () => {
    render(<CodexBackupInformatics />);
    expect(
      screen.getByText(/entire running codex/i, { selector: "p" }),
    ).toBeInTheDocument();
    // design.md: "every keyring: Ouronet accounts, Arweave seeds, pure
    // keypairs, foreign keys, watch list, UI settings" — each keyring kind
    // must be named, not summarized away.
    const kinds = screen.getByText(/Ouronet accounts/i, { selector: "p" });
    expect(kinds).toBeInTheDocument();
    expect(kinds.textContent).toMatch(/Arweave seeds/i);
    expect(kinds.textContent).toMatch(/pure keypairs/i);
    expect(kinds.textContent).toMatch(/foreign keys/i);
    expect(kinds.textContent).toMatch(/watch list/i);
    expect(kinds.textContent).toMatch(/UI settings/i);
    expect(kinds.textContent).toMatch(/single Arweave upload/i);
  });

  it("explicitly distinguishes this from the regular per-file Upload Wizard", () => {
    render(<CodexBackupInformatics />);
    // design.md: "distinct from backing up individual FILES through the
    // regular Upload Wizard (a different, already-existing feature)."
    const distinction = screen.getByText(/Upload Wizard/i, { selector: "p" });
    expect(distinction.textContent).toMatch(/individual files/i);
  });
});

describe("CodexBackupInformatics — the encryption, in plain terms", () => {
  it("describes a fresh, one-time, per-backup key used to re-encrypt everything inside", () => {
    render(<CodexBackupInformatics />);
    // design.md: "A fresh, random 256-bit AES key is generated per
    // upload" (IDEK) — plain-language: fresh/random/one-time, generated
    // just for THIS backup, re-encrypts everything inside it.
    const el = screen.getByText(/fresh.*random.*one-time key/i, { selector: "p" });
    expect(el.textContent).toMatch(/re-encrypt/i);
  });

  it("states that one-time key is itself locked ('wrapped') under the user's own real secrets, never stored directly usable", () => {
    render(<CodexBackupInformatics />);
    // design.md: "each is immediately wrapped (encrypted) under one or
    // more real keys" — plain language: locked/wrapped under YOUR OWN real
    // secrets, never stored anywhere in a directly-usable form.
    const el = screen.getByText(/wrapped/i, { selector: "p" });
    expect(el.textContent).toMatch(/your own real secrets/i);
    expect(el.textContent).toMatch(/never stored/i);
  });

  it("states the whole backup is sealed again as ONE opaque block, hiding the SHAPE itself (not just the values)", () => {
    render(<CodexBackupInformatics />);
    // design.md gap #1: "the JSON shape itself... is plaintext-readable";
    // the fix seals the whole export as one opaque blob so "nothing about
    // field names or array lengths survives" — a reader of the permanent
    // public record can't even tell HOW MANY accounts/seeds exist.
    const el = screen.getByText(/opaque block/i, { selector: "p" });
    expect(el.textContent).toMatch(/how many accounts or seeds/i);
    expect(el.textContent).toMatch(/shape/i);
  });
});

describe("CodexBackupInformatics — the two independent restore paths", () => {
  it("names BOTH restore paths explicitly and states either alone suffices", () => {
    render(<CodexBackupInformatics />);
    const masterSeed = screen.getByText(/Master Seed words/i, { selector: "li, p" });
    expect(masterSeed).toBeInTheDocument();
    // design.md: "Standard Apollo (the Codex Identity's Standard half —
    // NOT the Smart half, and NOT the two combined)". The non-engineer
    // explainer must preserve this exact distinction, not blur it.
    // Scoped to "li" specifically: the component's new multi-backup section
    // (below) also legitimately mentions "Codex Identity" in a <p>, which
    // would otherwise make this match ambiguous.
    const identity = screen.getByText(/Codex Identity/i, { selector: "li" });
    expect(identity.textContent).toMatch(/Standard/);
    expect(identity.textContent).toMatch(/not the combined identity/i);
    expect(identity.textContent).toMatch(/not the.*Smart.*half/i);

    expect(
      screen.getByText(/either one alone is enough/i, { selector: "p" }),
    ).toBeInTheDocument();
  });

  // ARWEAVE_TAG_SCHEMA.md §4 "Wrap sources": both default sources wrap BOTH
  // DEKs independently — i.e. each one on its own is sufficient to unlock the
  // backup. A reader who only sees "either one is enough" as a bare claim
  // has no way to tell that from a design flaw (e.g. a weaker fallback path)
  // — this asserts the WHY is actually explained: both paths lock the SAME
  // one-time key, so either one can later unlock it on its own, and losing
  // ONE of them does not lock you out as long as the other still exists.
  it("explains WHY either path alone suffices — both independently lock the same one-time key, so losing one doesn't lock you out", () => {
    render(<CodexBackupInformatics />);
    const mechanism = screen.getByText(/independently lock/i, { selector: "p" });
    expect(mechanism.textContent).toMatch(/the very same one-time key/i);
    expect(mechanism.textContent).toMatch(/does not lock you out/i);
    expect(mechanism.textContent).toMatch(/as long as you still have the other/i);
  });
});

describe("CodexBackupInformatics — the optional Arweave-PIN, unmissable warning", () => {
  it("describes the PIN as an optional 6-to-15-digit extra lock on EITHER restore path", () => {
    render(<CodexBackupInformatics />);
    const pinDesc = screen.getByText(/6-to-15-digit/i, { selector: "p" });
    expect(pinDesc.textContent).toMatch(/optional/i);
  });

  // ARWEAVE_TAG_SCHEMA.md §4 "The Arweave-PIN wrap path": turning on a PIN
  // derives a REAL, second RSA-4096 keypair from the PIN's digits, and that
  // new key WRAPS the same one-time key in place of — not alongside — that
  // source's ordinary (Default) wrap. "Mutual exclusivity" is the section's
  // own stated "single most safety-critical property", so the plain-language
  // explainer must say a real key is generated (not just "extra protection"
  // vagueness) AND that it replaces the normal lock for that path rather than
  // stacking a third lock on top, AND that the OTHER path is unaffected.
  it("explains the PIN mechanism: a real second key is generated from the PIN's digits, and it replaces (not stacks atop) that path's ordinary lock", () => {
    render(<CodexBackupInformatics />);
    const pinMechanism = screen.getByText(/generates a real, second key/i, { selector: "p" });
    expect(pinMechanism.textContent).toMatch(/from the pin's digits/i);
    expect(pinMechanism.textContent).toMatch(/takes the place of/i);
    expect(pinMechanism.textContent).toMatch(/not.*on top of it/i);
    expect(pinMechanism.textContent).toMatch(/other (restore )?path/i);
    expect(pinMechanism.textContent).toMatch(/keeps working/i);
  });

  it("renders the PIN-unrecoverable warning as genuinely visible (not inside a collapsed/closed disclosure, no [hidden])", () => {
    render(<CodexBackupInformatics />);
    const warning = screen.getByTestId("pin-unrecoverable-warning");
    expect(warning).toBeVisible();
    // Never buried in a <details> at all for this specific warning — it
    // must always be rendered open, by construction.
    expect(warning.closest("details")).toBeNull();
    // design.md: "Forgetting a PIN is exactly as catastrophic as
    // forgetting the seed words themselves — no recovery, ever."
    expect(warning.textContent).toMatch(/exactly as unrecoverable as/i);
    expect(warning.textContent).toMatch(/seed words/i);
    expect(warning.textContent).toMatch(/no .*reset.*ever/i);
  });

  it("states the PIN is opt-in and never presented as a recommended default", () => {
    render(<CodexBackupInformatics />);
    const optIn = screen.getByText(/opt-in/i, { selector: "p" });
    expect(optIn.textContent).toMatch(/never.*default/i);
  });

  // NEW (owner correction, 2026-10-12): a backup taken before a Codex
  // Identity existed only ever has the Master Seed unlock path — adding a
  // Codex Identity later does not retroactively add it to that already-
  // permanent record. A fresh backup is required, and restoring must let
  // the user pick which of possibly several past backups to restore from.
  it("explains that each backup is independent (a later one never updates an earlier one) and a Codex Identity added after a backup isn't retroactively covered by it", () => {
    render(<CodexBackupInformatics />);
    const el = screen.getByText(/independent record/i, { selector: "p" });
    expect(el.textContent).toMatch(/never replaces or updates/i);
    expect(el.textContent).toMatch(/Master Seed/i);
  });

  it("explains restoring is designed around picking which past backup to use, each prompting its own unlock", () => {
    render(<CodexBackupInformatics />);
    const el = screen.getByText(/picking WHICH/i, { selector: "p" });
    expect(el.textContent).toMatch(/every backup/i);
    expect(el.textContent).toMatch(/prompts you again/i);
  });
});

describe("CodexMigrationInformatics — why some codexes aren't eligible yet", () => {
  // CORRECTED TWICE (owner corrections, 2026-10-12):
  //   Round 1 — eligibility is NOT about where the words came from
  //   (wallet-imported vs. Codex-generated); the real cause is chronology.
  //   Round 2 — round 1's own text overstated Koala as the ONLY possible
  //   way to generate Chainweb keys. Accurate framing: Koala is what
  //   onboarding has always HISTORICALLY used (everyone started from it,
  //   most codexes also derived their Ouronet Account from the same
  //   words); Arweave support simply came later, so those words were
  //   never also used for an Arweave account at the time.
  it("explains Koala as what onboarding historically used (not the only possible way), and that most codexes also derived their Ouronet Account from the same words", () => {
    render(<CodexMigrationInformatics />);
    // Unique to the first paragraph — "Koala" alone now also appears in
    // the second paragraph (the Stoic Dalos Derivation contrast), so this
    // anchors on text that's only in the "why not eligible" paragraph.
    const el = screen.getByText(/historically used/i, { selector: "p" });
    expect(el.textContent).toMatch(/Koala/i);
    expect(el.textContent).toMatch(/not.*the only possible way/i);
    expect(el.textContent).toMatch(/Ouronet Account/i);
    expect(el.textContent).not.toMatch(/wallet-imported/i);
  });

  // NEW (owner correction round 2): the actual GOAL of migration, and WHY
  // a Master Seed matters at all — a genuinely important addition the
  // original content never explained.
  it("states migration's goal: one single (ideally arbitrary) seed generating the Ouronet Account, Chainweb keys (via Stoic Dalos Derivation), and the Prime Arweave Seed together — called the Master Seed", () => {
    render(<CodexMigrationInformatics />);
    const el = screen.getByText(/Stoic Dalos Derivation/i, { selector: "p" });
    expect(el.textContent).toMatch(/Ouronet Account/i);
    expect(el.textContent).toMatch(/Prime Arweave Seed/i);
    expect(el.textContent).toMatch(/Master Seed/i);
  });

  it("explains WHY a Master Seed matters: seed words alone can regenerate the three core identities, but recovering everything else a codex holds depends entirely on locating an Arweave backup", () => {
    render(<CodexMigrationInformatics />);
    const el = screen.getByText(/makes full seed-words-only restore actually possible/i, { selector: "p" });
    expect(el.textContent).toMatch(/cannot regenerate anything else/i);
    expect(el.textContent).toMatch(/find and download an actual backup/i);
  });
});

describe("CodexMigrationInformatics — the three-option menu, exact conditional-default framing", () => {
  it("marks promoting an existing custom-worded account as recommended WHEN one exists", () => {
    render(<CodexMigrationInformatics />);
    // legacy-prime-migration/design.md: option 2 is "the conditional top
    // default whenever the codex already contains such an account."
    const promote = screen.getByTestId("migration-option-promote");
    expect(promote.textContent).toMatch(/promote/i);
    expect(promote.textContent).toMatch(/already.*custom/i);
    expect(promote.textContent).toMatch(/recommended/i);
    expect(promote.textContent).toMatch(/when/i);
  });

  it("marks writing brand-new custom words as the default ONLY otherwise (when no promotable account exists)", () => {
    render(<CodexMigrationInformatics />);
    // design.md: option 1 is "Default recommended choice when no better
    // option exists (see #2)."
    const newWords = screen.getByTestId("migration-option-new-words");
    expect(newWords.textContent).toMatch(/brand-new.*words/i);
    expect(newWords.textContent).toMatch(/recommended.*when no/i);
  });

  it("marks keeping current words (re-derived) as always available but always NOT recommended", () => {
    render(<CodexMigrationInformatics />);
    // design.md: option 3 "Not recommended... but available".
    const keep = screen.getByTestId("migration-option-keep-current");
    expect(keep.textContent).toMatch(/keep.*current words/i);
    expect(keep.textContent).toMatch(/re-derived/i);
    expect(keep.textContent).toMatch(/always available/i);
    expect(keep.textContent).toMatch(/not recommended/i);
  });
});

describe("CodexMigrationInformatics — migration moves real on-chain funds", () => {
  it("states migration moves native STOA and urSTOA, is never instant/one-click, and needs confirmation at every fund-moving step", () => {
    render(<CodexMigrationInformatics />);
    const el = screen.getByText(/native STOA/i, { selector: "p" });
    expect(el.textContent).toMatch(/urSTOA/);
    expect(el.textContent).toMatch(/not instant/i);
    expect(el.textContent).toMatch(/not .*single click|never.*single click/i);
    expect(el.textContent).toMatch(/multi-step|multiple steps|several steps/i);
    expect(el.textContent).toMatch(/confirmation/i);
  });
});
