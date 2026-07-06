// The SEND AR area (FUNDS-CRITICAL).
//
// Recipient by paste (validated against D5's per-chain registry) or from the
// unified address book filtered to Arweave; amount + the MANDATORY fee-cap, both
// parsed via arweave-core `arToWinston` (never float, never `BigInt` directly);
// and the FULL send error matrix discriminated by error CLASS:
//   - RewardExceedsCapError {reward,cap}                → over-cap block
//   - InvalidTransferError reason:"missing-max-reward"  → cap-required (backstop)
//   - GatewayPoolExhaustedError / other throws          → generic non-crash error
// On an in-cap success the resolved {id,reward} confirms, then `pollStatus`
// transitions the status pending→final.

import * as React from "react";
import { useMemo, useState } from "react";

import {
  arToWinston,
  RewardExceedsCapError,
  InvalidTransferError,
} from "@ancientpantheon/arweave-core";
import { validateAddress } from "@ancientpantheon/codex-ouronet/hooks";

import { ARWEAVE_CHAIN_ID } from "../address-book/chainId.js";
import type {
  ArweaveSendRequest,
  ArweaveSendResult,
  PanelAddressBookEntry,
} from "./context.js";

export interface SendAreaProps {
  /** The unified address book — the recipient picker filters this to Arweave. */
  addressBook: PanelAddressBookEntry[];
  /** E2 send: resolves `{id,reward}` or throws the fee-cap/non-cap error matrix. */
  send: (req: ArweaveSendRequest) => Promise<ArweaveSendResult>;
  /** E2 status poll: resolves the current confirmation state for a tx id. */
  pollStatus: (id: string) => Promise<"pending" | "final">;
}

/** Parse a display-AR string to Winston, returning `null` (never throwing) when
 *  the input fails arweave-core's strict shape gate. Both the amount and the cap
 *  route through here so a malformed value becomes a form error, never a throw. */
function tryArToWinston(value: string): bigint | null {
  try {
    return arToWinston(value);
  } catch {
    return null;
  }
}

type SendPhase =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "confirmed"; id: string; status: "pending" | "final" };

type SubmitError =
  | { kind: "overcap"; reward: bigint; cap: bigint }
  | { kind: "cap-required" }
  | { kind: "generic" };

export function SendArea({ addressBook, send, pollStatus }: SendAreaProps): React.ReactElement {
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [cap, setCap] = useState("");

  const [recipientError, setRecipientError] = useState(false);
  const [amountError, setAmountError] = useState(false);
  const [capError, setCapError] = useState(false);
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);

  const [phase, setPhase] = useState<SendPhase>({ kind: "idle" });

  const arweaveContacts = useMemo(
    () => addressBook.filter((e) => e.chainId === ARWEAVE_CHAIN_ID),
    [addressBook],
  );

  const isSending = phase.kind === "sending";

  async function handleSubmit(): Promise<void> {
    setRecipientError(false);
    setAmountError(false);
    setCapError(false);
    setSubmitError(null);

    const recipientOk = validateAddress(ARWEAVE_CHAIN_ID, recipient);
    const quantity = tryArToWinston(amount);
    const maxRewardWinston = tryArToWinston(cap);

    let blocked = false;
    if (!recipientOk) {
      setRecipientError(true);
      blocked = true;
    }
    if (quantity === null) {
      setAmountError(true);
      blocked = true;
    }
    // The cap is MANDATORY: empty OR non-empty-but-unparseable are both a form
    // error. The gate is arToWinston-parseability, identical to the amount's.
    if (maxRewardWinston === null) {
      setCapError(true);
      blocked = true;
    }
    if (blocked || quantity === null || maxRewardWinston === null) {
      return;
    }

    setPhase({ kind: "sending" });
    let sentId: string;
    try {
      const result = await send({ target: recipient, quantity, maxRewardWinston });
      setPhase({ kind: "confirmed", id: result.id, status: "pending" });
      sentId = result.id;
    } catch (err) {
      if (err instanceof RewardExceedsCapError) {
        setSubmitError({ kind: "overcap", reward: err.reward, cap: err.cap });
      } else if (err instanceof InvalidTransferError && err.reason === "missing-max-reward") {
        // The protocol backstop for a missing cap — surface as a cap-required
        // error (defense in depth if the client gate is ever bypassed).
        setCapError(true);
        setSubmitError({ kind: "cap-required" });
      } else {
        // Any non-cap rejection (pool exhaustion, bad-target, generic): a clear
        // non-crash error. NEVER read `.reward`/`.cap` off a non-cap error.
        setSubmitError({ kind: "generic" });
      }
      setPhase({ kind: "idle" });
      return;
    }

    // The send SUCCEEDED on-chain — the confirmation is now locked in. A status
    // poll is best-effort refresh only: a transient gateway failure here must
    // NEVER clear the confirmation or masquerade as a send failure (which would
    // invite a double-spend re-submit). Keep the "pending" status on rejection.
    try {
      const status = await pollStatus(sentId);
      setPhase({ kind: "confirmed", id: sentId, status });
    } catch {
      // Status unknown — leave the confirmed "pending" state untouched.
    }
  }

  const confirmed = phase.kind === "confirmed" ? phase : null;

  return (
    <div data-testid="send-area">
      <div data-testid="send-book-picker">
        {arweaveContacts.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => {
              setRecipient(c.address);
              setRecipientError(false);
            }}
          >
            {c.name}
          </button>
        ))}
      </div>

      <input
        data-testid="send-recipient-input"
        value={recipient}
        onChange={(e) => setRecipient(e.target.value)}
      />
      {recipientError && (
        <div data-testid="send-recipient-error">Recipient is not a valid Arweave address.</div>
      )}

      <input
        data-testid="send-amount-input"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
      {amountError && (
        <div data-testid="send-amount-error">Amount is not a valid AR value.</div>
      )}

      <input
        data-testid="send-cap-input"
        value={cap}
        onChange={(e) => setCap(e.target.value)}
      />
      {capError && (
        <div data-testid="send-cap-error">A valid fee cap (in AR) is required.</div>
      )}

      <button
        type="button"
        data-testid="send-submit"
        disabled={isSending}
        onClick={() => {
          void handleSubmit();
        }}
      >
        Send
      </button>

      {submitError?.kind === "overcap" && (
        <div data-testid="send-overcap-error">
          Quoted reward {submitError.reward.toString()} Winston exceeds your fee cap{" "}
          {submitError.cap.toString()} Winston. The transaction was not sent.
        </div>
      )}
      {submitError?.kind === "generic" && (
        <div data-testid="send-generic-error">
          The transaction could not be sent. Please try again.
        </div>
      )}

      {confirmed && (
        <>
          <div data-testid="send-confirm">Sent — transaction id {confirmed.id}</div>
          {confirmed.status === "final" && (
            <div data-testid="send-status-final">Confirmed (final).</div>
          )}
        </>
      )}
    </div>
  );
}

export default SendArea;
