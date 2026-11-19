/**
 * The Codex ID page's Codex Master Seed section.
 *
 * The behaviour worth pinning is the HONESTY: three faces are established at
 * different moments, so the section must name what is missing rather than
 * render a blank that looks identical to a bug.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CodexMasterSeedSection } from "../src/panel/CodexMasterSeedSection.js";
import { OURONET_CODEX_MASTER, type CodexMasterSeed } from "@ancientpantheon/codex-core";

const FULL: CodexMasterSeed = {
  ouroAccountId: "ouro-1",
  chainwebSeedId: "seed-1",
  arweaveSeedId: "arw-1",
  establishedAt: "2026-10-28T10:00:00.000Z",
};

const lists = {
  ouroAccounts: [{ id: "ouro-1", name: "AncientHodler" }],
  chainwebSeeds: [{ id: "seed-1", name: "Initial Seed" }],
  arweaveSeeds: [{ id: "arw-1", name: "Master ArWeave Seed" }],
};

describe("CodexMasterSeedSection", () => {
  it("names all THREE faces of the one seed", () => {
    render(<CodexMasterSeedSection row={FULL} {...lists} />);
    expect(screen.getByTestId("codex-master-seed-face-ouronet").textContent)
      .toMatch(/Codex Ouronet Master/);
    expect(screen.getByTestId("codex-master-seed-face-chainweb").textContent)
      .toMatch(/Master Chainweb Seed/);
    expect(screen.getByTestId("codex-master-seed-face-arweave").textContent)
      .toMatch(/Master ArWeave Seed/);
  });

  it("resolves each face to the entity it actually points at", () => {
    render(<CodexMasterSeedSection row={FULL} {...lists} />);
    expect(screen.getByTestId("codex-master-seed-face-ouronet").textContent)
      .toMatch(/AncientHodler/);
    expect(screen.getByTestId("codex-master-seed-face-chainweb").textContent)
      .toMatch(/Initial Seed/);
  });

  it("says 'not derived yet' for an ArWeave face that does not exist, not a blank", () => {
    const { arweaveSeedId, ...twoFace } = FULL;
    void arweaveSeedId;
    render(<CodexMasterSeedSection row={twoFace} {...lists} />);
    expect(screen.getByTestId("codex-master-seed-face-arweave").textContent)
      .toMatch(/not derived yet/i);
    expect(screen.getByTestId("codex-master-seed-established").textContent)
      .toMatch(/still to come/i);
  });

  it("distinguishes 'named but missing' from 'not derived yet'", () => {
    // A row pointing at an id this codex does not hold is a DIFFERENT problem
    // from a face that was never established, and must not read the same.
    render(<CodexMasterSeedSection row={FULL} ouroAccounts={[]} chainwebSeeds={[]} arweaveSeeds={[]} />);
    expect(screen.getByTestId("codex-master-seed-face-ouronet").textContent)
      .toMatch(/not found in this codex/i);
    expect(screen.getByTestId("codex-master-seed-face-arweave").textContent)
      .toMatch(/not found in this codex/i);
  });

  // Owner (live testing): "What do you mean Master Chainweb Seed
  // 9845c79e-6958-4a49-8c64-8f064367dbe6? ... wtf is that number? that is
  // completely wrong." A seed that exists but carries no human name used to
  // fall back to rendering its raw `id`, which reads as leaked internals and
  // tells the user nothing — exactly the "indistinguishable from a bug"
  // rendering this component's own doc comment forbids.
  it("never renders a raw id for a face that exists but has no name", () => {
    const nameless = {
      ouroAccounts: [{ id: "ouro-1", name: "AncientHodler" }],
      chainwebSeeds: [{ id: "seed-1" }],
      arweaveSeeds: [{ id: "arw-1", name: "Master ArWeave Seed" }],
    };
    render(<CodexMasterSeedSection row={FULL} {...nameless} />);
    const chainweb = screen.getByTestId("codex-master-seed-face-chainweb").textContent ?? "";
    expect(chainweb).not.toMatch(/seed-1/);
    expect(chainweb).toMatch(/unnamed/i);
    // ...and it must NOT be mistaken for a face that was never established.
    expect(chainweb).not.toMatch(/not derived yet/i);
    expect(chainweb).not.toMatch(/not found in this codex/i);
  });

  // `settled-master-identity` T5. The defect this pins: the row names the
  // account the eligibility wizard SETTLED as master, so that account is the
  // master by definition — yet this card kept reading it out under its own
  // stored name ("AncientHodler"), which is the design's defect 1 ("It still
  // shows its old name") on this surface. The role has to be the value, with
  // the displaced stored name demoted beneath rather than destroyed — one
  // rule (`masterOuronetAccountParts`) shared with the account rows and the
  // ZBOM pickers, so one account can never read under two names.
  it("names the Ouronet face by ROLE, with the pointed-at account's stored name demoted beneath", () => {
    render(<CodexMasterSeedSection row={FULL} {...lists} />);
    expect(screen.getByTestId("codex-master-seed-face-ouronet-value").textContent)
      .toBe(OURONET_CODEX_MASTER);
    expect(screen.getByTestId("codex-master-seed-face-ouronet-former").textContent)
      .toBe("AncientHodler");
  });

  // An account with nothing to demote must not render an empty/placeholder
  // second line — the design says so explicitly ("An account with no prior
  // name of its own simply shows `Codex Ouronet Master` with nothing
  // beneath"), and a blank secondary row here would be exactly the
  // "indistinguishable from a bug" rendering this component exists to forbid.
  it("shows the Ouronet role alone, with NO second line, for a master account with no stored name", () => {
    render(
      <CodexMasterSeedSection
        row={FULL}
        ouroAccounts={[{ id: "ouro-1" }]}
        chainwebSeeds={lists.chainwebSeeds}
        arweaveSeeds={lists.arweaveSeeds}
      />,
    );
    expect(screen.getByTestId("codex-master-seed-face-ouronet-value").textContent)
      .toBe(OURONET_CODEX_MASTER);
    expect(screen.queryByTestId("codex-master-seed-face-ouronet-former")).toBeNull();
  });

  // The role treatment must be earned by an account this codex actually
  // HOLDS. A naive "the Ouronet face is always the master, so always print
  // the role" implementation would claim the master is established while the
  // id dangles — the opposite of this card's whole purpose.
  it("does NOT give the role treatment to an Ouronet id this codex does not hold", () => {
    render(
      <CodexMasterSeedSection
        row={FULL}
        ouroAccounts={[]}
        chainwebSeeds={lists.chainwebSeeds}
        arweaveSeeds={lists.arweaveSeeds}
      />,
    );
    const value = screen.getByTestId("codex-master-seed-face-ouronet-value").textContent ?? "";
    expect(value).toMatch(/not found in this codex/i);
    expect(value).not.toMatch(/Codex Ouronet Master/);
    expect(screen.queryByTestId("codex-master-seed-face-ouronet-former")).toBeNull();
  });

  // The two-line treatment is deliberately Ouronet-ONLY (there is no "former
  // name" concept for a seed — a seed is named, or it is `UNNAMED_FACE_NOTE`).
  // Generalising it to the seed faces would invent a second line with nothing
  // true to put in it.
  it("leaves the Chainweb and ArWeave faces single-line", () => {
    render(<CodexMasterSeedSection row={FULL} {...lists} />);
    expect(screen.queryByTestId("codex-master-seed-face-chainweb-former")).toBeNull();
    expect(screen.queryByTestId("codex-master-seed-face-arweave-former")).toBeNull();
    expect(screen.getByTestId("codex-master-seed-face-chainweb-value").textContent)
      .toBe("Initial Seed");
    expect(screen.getByTestId("codex-master-seed-face-arweave-value").textContent)
      .toBe("Master ArWeave Seed");
  });

  it("states plainly when the codex has no master seed at all", () => {
    render(<CodexMasterSeedSection row={undefined} {...lists} />);
    expect(screen.getByTestId("codex-master-seed-none").textContent)
      .toMatch(/has not settled on a Codex Master Seed yet/i);
    expect(screen.queryByTestId("codex-master-seed-face-ouronet")).toBeNull();
  });

  it("confirms completion once all three faces are established", () => {
    render(<CodexMasterSeedSection row={FULL} {...lists} />);
    expect(screen.getByTestId("codex-master-seed-established").textContent)
      .toMatch(/All three faces established/i);
  });
});
