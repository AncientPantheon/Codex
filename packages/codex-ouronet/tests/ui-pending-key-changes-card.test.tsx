/**
 * The stage-3A card. Its most important behaviour is being ABSENT.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PendingKeyChangesCard } from "../src/ui/settings/PendingKeyChangesCard.js";
import type { PendingKeyChange } from "../src/ui/internal/outstandingKeyChanges.js";

const K0 = "a".repeat(64);
const K1 = "b".repeat(64);
const OLD = "9".repeat(64);

const guardChange: PendingKeyChange = {
  kind: "guard", from: [OLD], to: [K1], pred: "keys-all",
};
const paymentChange: PendingKeyChange = { kind: "payment", from: [OLD], to: [K0] };

describe("when nothing is pending", () => {
  it("renders NOTHING — not an empty card", () => {
    // A user who kept both keys has no work to do. A card saying otherwise
    // would push them toward transactions they do not need.
    const { container } = render(<PendingKeyChangesCard changes={[]} />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId("pending-key-changes-card")).toBeNull();
  });
});

describe("when changes are pending", () => {
  it("states plainly that applying them is OPTIONAL and the old keys still work", () => {
    render(<PendingKeyChangesCard changes={[guardChange]} />);
    const note = screen.getByTestId("pending-key-changes-optional").textContent ?? "";
    expect(note).toMatch(/optional/i);
    expect(note).toMatch(/already eligible/i);
    expect(note).toMatch(/keep working/i);
  });

  /**
   * `migration-execute` T10. This card and
   * `codex-arweave/src/panel/CodexMigrationInformatics.tsx` shipped
   * contradicting each other: this one said applying was OPTIONAL and
   * "nothing is lost by never pressing these buttons", that one said moving
   * funds was "a genuinely necessary part of becoming eligible".
   *
   * Both were half right, which is why both could ship. Eligibility is
   * structural and reads nothing from chain, so this card is right that none
   * of this is required. The OTHER surface was right about the funds: once the
   * chosen payment key is in force, money still sitting on the old one is
   * money the account no longer names.
   *
   * The single reconciled statement, on the owner's ruling, is therefore
   * "applying is optional; applying PARTIALLY is not". Both halves are
   * asserted here precisely because dropping either half is how the
   * contradiction started: a card that only says "optional" invites a
   * half-applied rotation that strands funds, and a card that only says
   * "finish it" pushes users into transactions they do not need.
   */
  it("says applying is OPTIONAL and, in the same breath, that it must not be left half-applied", () => {
    render(<PendingKeyChangesCard changes={[paymentChange]} />);
    const note = screen.getByTestId("pending-key-changes-optional").textContent ?? "";
    // Half one — unchanged, and asserted again above.
    expect(note).toMatch(/optional/i);
    // Half two — the part the old copy was missing.
    expect(note).toMatch(/half-applied|half applied|part of the way|half-way/i);
    expect(note).toMatch(/without stopping to ask/i);
  });

  it("shows a guard change as FROM -> TO with its predicate", () => {
    render(<PendingKeyChangesCard changes={[guardChange]} />);
    const row = screen.getByTestId("pending-key-change-guard");
    expect(row.textContent).toMatch(/FROM/);
    expect(row.textContent).toMatch(/under keys-all/);
    expect(row.querySelector(`[title="${OLD}"]`)).toBeTruthy();
    expect(row.querySelector(`[title="${K1}"]`)).toBeTruthy();
  });

  it("says 'none on record' rather than showing a blank FROM", () => {
    render(<PendingKeyChangesCard changes={[{ ...guardChange, from: null }]} />);
    expect(screen.getByTestId("pending-key-change-guard").textContent)
      .toMatch(/none on record/i);
  });

  it("lists BOTH pending changes when both apply", () => {
    render(<PendingKeyChangesCard changes={[guardChange, paymentChange]} />);
    expect(screen.getByTestId("pending-key-change-guard")).toBeTruthy();
    expect(screen.getByTestId("pending-key-change-payment")).toBeTruthy();
  });

  it("launches the matching rotate flow for each", () => {
    const onApplyGuard = vi.fn();
    const onApplyPaymentKey = vi.fn();
    render(
      <PendingKeyChangesCard
        changes={[guardChange, paymentChange]}
        onApplyGuard={onApplyGuard}
        onApplyPaymentKey={onApplyPaymentKey}
      />,
    );
    fireEvent.click(screen.getByTestId("pending-key-change-apply-guard"));
    fireEvent.click(screen.getByTestId("pending-key-change-apply-payment"));
    expect(onApplyGuard).toHaveBeenCalledTimes(1);
    expect(onApplyPaymentKey).toHaveBeenCalledTimes(1);
  });

  it("omits the button when no launcher is supplied, rather than rendering a dead one", () => {
    render(<PendingKeyChangesCard changes={[guardChange]} />);
    expect(screen.queryByTestId("pending-key-change-apply-guard")).toBeNull();
  });
});
