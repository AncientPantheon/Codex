/**
 * CodexMigrationInformatics — "Codex ID" page informatics, part 2
 * (`codex-id-page` T2; re-styled + corrected TWICE per explicit owner
 * corrections after shipping — see the notes below).
 *
 * A static, presentational, plain-language explainer of WHAT the
 * `legacy-prime-migration` wizard will do once built. No internal
 * type/function/variable names anywhere below.
 *
 * CORRECTED (owner correction round 1, 2026-10-12): the original "why
 * isn't my codex eligible" paragraph claimed the cause was "a
 * wallet-imported word phrase, rather than words generated fresh by Codex
 * itself" — WRONG, replaced with the real historical reason.
 *
 * CORRECTED FURTHER (owner correction round 2, same day): round 1's own
 * replacement overstated Koala as the ONLY possible way to generate
 * Chainweb keys. The accurate framing, confirmed directly by the owner:
 * Koala (a 24-word, dictionary-gated scheme) is what onboarding has always
 * HISTORICALLY used, not the only mechanism that could exist — everyone
 * started from Koala-gated words, and most codices additionally derived
 * their Ouronet Account from those exact same words, since onboarding
 * reused them for both. Arweave support came later, so those words were
 * never also used to generate an Arweave account at the time — THAT
 * timing gap, not where the words came from, is the real reason an older
 * codex's words don't currently line up across all three.
 *
 * Also added (same correction round): the actual GOAL of migration, and
 * WHY a Master Seed matters at all beyond just "being eligible" — a
 * genuinely important addition the original content never explained. One
 * single set of seed words (ideally arbitrary — which is why new codices
 * now onboard through the Stoic Dalos Derivation instead of Koala, since
 * arbitrary words need it to produce Chainweb keys at all) that generates
 * all three of the Ouronet Account, the Chainweb keys, and the Prime
 * Arweave Seed can always regenerate those three from scratch — but
 * cannot regenerate anything ELSE a codex has additionally accumulated.
 * Recovering that extra context depends entirely on Arweave: a Master
 * Seed is what lets a seed-words-only restore actually LOCATE and decrypt
 * an already-made backup of everything else. This is the real reason the
 * whole Master Seed/eligibility mechanism exists, not just an arbitrary
 * gate.
 *
 * The "three choices" / fund-migration sections below are STILL UNCHANGED
 * from the original shipped content, pending a further owner
 * clarification on one specific mechanic (whether choosing brand-new
 * custom words can ALSO trigger a fund-sweep from the old CodexPrime
 * account's keys) — do not assume an answer here; revise once confirmed.
 */

import * as React from "react";
import {
  INFORMATICS_BODY_LAST_STYLE,
  INFORMATICS_BODY_STYLE,
  INFORMATICS_CARD_STYLE,
  INFORMATICS_HEADING_STYLE,
  INFORMATICS_LAST_SECTION_STYLE,
  INFORMATICS_LIST_ITEM_STYLE,
  INFORMATICS_LIST_STYLE,
  INFORMATICS_SECTION_STYLE,
} from "./informaticsStyles.js";

export function CodexMigrationInformatics(): React.ReactElement {
  return (
    <div data-testid="codex-migration-informatics" style={INFORMATICS_CARD_STYLE}>
      <h3 style={INFORMATICS_HEADING_STYLE}>What migration does</h3>

      <section style={INFORMATICS_SECTION_STYLE}>
        <p style={INFORMATICS_BODY_STYLE}>
          Some codexes aren&apos;t eligible for seed-words-only restore yet. Onboarding has
          always generated a dictionary-gated word phrase (Koala) to create your Chainweb
          keys — not because Koala is the only possible way to generate them, just because
          that is what onboarding has historically used — and most codexes also derived their
          Ouronet Account from those exact same words. Arweave support came later, so those
          words were never also used to generate an Arweave account at the time. That is the
          real reason an older codex&apos;s words don&apos;t currently line up across all
          three — not anything about where the words originally came from.
        </p>
        <p style={INFORMATICS_BODY_LAST_STYLE}>
          The goal of migration is to settle on one single set of seed words — ideally
          arbitrary, not dictionary-gated — that together generates all three: your Ouronet
          Account string, your Chainweb keys (arbitrary words need our Stoic Dalos Derivation
          for this, which is why every new codex now onboards through it instead of Koala), and
          your Prime Arweave Seed. That one shared word set is what is called your Master Seed.
        </p>
      </section>

      <section style={INFORMATICS_SECTION_STYLE}>
        <p style={INFORMATICS_BODY_LAST_STYLE}>
          A Master Seed is what makes full seed-words-only restore actually possible. Your seed
          words alone can always regenerate your Ouronet Account, your Chainweb keys, and your
          Prime Arweave Seed from scratch — but they cannot regenerate anything else your codex
          has additionally accumulated along the way (other accounts, extra keys, your watch
          list, settings, and so on). Recovering that depends entirely on Arweave: a Master
          Seed is what lets you find and download an actual backup already made of everything
          else. Without that alignment, there is no way to even locate that backup using your
          seed words alone.
        </p>
      </section>

      <section style={INFORMATICS_SECTION_STYLE}>
        <p style={INFORMATICS_BODY_STYLE}>
          Once it exists, the migration wizard will offer you three choices:
        </p>
        <ul style={INFORMATICS_LIST_STYLE}>
          <li data-testid="migration-option-new-words" style={INFORMATICS_LIST_ITEM_STYLE}>
            <strong>Write brand-new custom words.</strong> Creates a genuinely new identity.
            Recommended when no better option exists (see the next choice).
          </li>
          <li data-testid="migration-option-promote" style={INFORMATICS_LIST_ITEM_STYLE}>
            <strong>Promote an existing account already in your codex</strong> that is already
            using custom (non-dictionary) words. Recommended when such an account already
            exists — it avoids creating a new identity at all.
          </li>
          <li data-testid="migration-option-keep-current" style={INFORMATICS_LIST_ITEM_STYLE}>
            <strong>Keep your current words exactly as they are</strong>, properly re-derived.
            Always available, but always not recommended, since it keeps relying on
            dictionary-word entropy rather than fully custom words.
          </li>
        </ul>
      </section>

      <section style={INFORMATICS_LAST_SECTION_STYLE}>
        <p style={INFORMATICS_BODY_LAST_STYLE}>
          Whichever choice you make, migration moves your real on-chain money — native STOA and
          your staked and unstaked urSTOA — from your old keys to new ones. This is a genuinely
          necessary part of becoming eligible. It is not instant and not a single click:
          migration is a multi-step process, and once the wizard is built, every step that
          moves funds will require your explicit confirmation before it happens.
        </p>
      </section>
    </div>
  );
}

export default CodexMigrationInformatics;
