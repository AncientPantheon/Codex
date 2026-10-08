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
    const identity = screen.getByText(/Codex Identity/i, { selector: "li, p" });
    expect(identity.textContent).toMatch(/Standard/);
    expect(identity.textContent).toMatch(/not the combined identity/i);
    expect(identity.textContent).toMatch(/not the.*Smart.*half/i);

    expect(
      screen.getByText(/either one alone is enough/i, { selector: "p" }),
    ).toBeInTheDocument();
  });
});

describe("CodexBackupInformatics — the optional Arweave-PIN, unmissable warning", () => {
  it("describes the PIN as an optional 6-to-15-digit extra lock on EITHER restore path", () => {
    render(<CodexBackupInformatics />);
    const pinDesc = screen.getByText(/6-to-15-digit/i, { selector: "p" });
    expect(pinDesc.textContent).toMatch(/optional/i);
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
});

describe("CodexMigrationInformatics — why some codexes aren't eligible yet", () => {
  it("explains the Ouronet identity / Arweave recovery seed origin-words mismatch, most commonly from a wallet-imported phrase", () => {
    render(<CodexMigrationInformatics />);
    // design.md: "their Ouronet identity and their Arweave recovery seed
    // don't currently share the same origin words — most commonly because
    // the codex was originally set up using a wallet-imported word phrase
    // rather than being generated fresh by Codex itself."
    const el = screen.getByText(/Ouronet identity/i, { selector: "p" });
    expect(el.textContent).toMatch(/Arweave recovery seed/i);
    expect(el.textContent).toMatch(/don't.*share.*origin words/i);
    expect(el.textContent).toMatch(/wallet-imported/i);
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
