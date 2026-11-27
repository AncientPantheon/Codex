/**
 * decryptFailure.ts — the SHARED decrypt-failure classifier
 * (docs/work/honest-failure-reporting/design.md §5, acceptance criterion 7).
 *
 * The defect this locks: `SeedWordsTab`'s reveal catch printed `err.message`
 * verbatim, so a wrong password rendered as the crypto primitive's own
 * internal string — `AES-GCM auth-tag failure`. Five distinct, differently
 * actionable failures (wrong password, corrupt envelope, unsupported format,
 * a module-load failure, a codex that locked mid-flight) collapsed into one
 * opaque line.
 *
 * Every assertion below is driven by a REAL error instance of the class the
 * `@stoachain/stoa-core/crypto` paths actually throw (or, for the two cases
 * with no typed class, by the real shapes the loader/`String(x)` paths
 * produce) — never by a hand-built lookalike.
 */

import { describe, it, expect } from "vitest";
import {
  WrongPasswordError,
  CorruptEnvelopeError,
  UnsupportedFormatError,
} from "@stoachain/stoa-core/crypto";

import { CodexLockedError } from "@ancientpantheon/codex-ouronet/errors";
import { classifyDecryptFailure } from "../src/ui/internal/decryptFailure.js";

/** The noun phrase `SeedWordsTab` passes. */
const SEED = "This seed phrase";

describe("classifyDecryptFailure", () => {
  // The owner's actual case: the codex unlocks and private keys reveal while
  // both seeds fail the auth tag — the signature of blobs encrypted under a
  // DIFFERENT password. The regression this catches is the one that cost him
  // hours: the UI showing a crypto primitive's internal string instead of
  // saying the bytes are fine and the key is wrong.
  it("classifies WrongPasswordError as a different-password failure that says the data is intact", () => {
    const failure = classifyDecryptFailure(
      new WrongPasswordError("AES-GCM auth-tag failure"),
      SEED,
    );

    expect(failure.kind).toBe("wrong-password");
    expect(failure.message).toMatch(/different password/i);
    expect(failure.message).toMatch(/data is intact/i);
    // The whole point: the library's internal wording never reaches the user.
    expect(failure.message).not.toMatch(/AES-GCM|auth-tag/i);
  });

  // `WrongPasswordError` and `CorruptEnvelopeError` demand OPPOSITE user
  // actions — retry with another password versus stop retrying entirely.
  // Rendering one as the other sends the owner into an unbounded password
  // guessing loop against bytes no password can open.
  it("classifies CorruptEnvelopeError as unfixable by any password", () => {
    const failure = classifyDecryptFailure(
      new CorruptEnvelopeError("Failed to parse V1 envelope"),
      SEED,
    );

    expect(failure.kind).toBe("corrupt-envelope");
    expect(failure.message).toMatch(/no password will/i);
    expect(failure.message).not.toMatch(/different password/i);
    expect(failure.message).not.toMatch(/Failed to parse V1 envelope/);
  });

  // A format this BUILD cannot read is a "your app is behind" problem, not a
  // damaged-seed problem. Mislabeling it as corruption invites the owner to
  // discard recoverable key material.
  it("classifies UnsupportedFormatError as a build-support gap, not corruption", () => {
    const failure = classifyDecryptFailure(
      new UnsupportedFormatError("schema version 3 is not supported"),
      SEED,
    );

    expect(failure.kind).toBe("unsupported-format");
    expect(failure.message).toMatch(/format this build does not support/i);
    expect(failure.message).not.toMatch(/corrupt|malformed/i);
  });

  // The reveal path checks `ensureUnlocked()` and THEN calls
  // `getCurrentPassword()`; the cache can expire in between. That race must
  // read as "unlock and retry", not as a decryption failure — otherwise a
  // perfectly healthy seed looks broken.
  it("classifies CodexLockedError as a lock race, telling the user to unlock and retry", () => {
    const failure = classifyDecryptFailure(new CodexLockedError("getCurrentPassword"), SEED);

    expect(failure.kind).toBe("locked");
    expect(failure.message).toMatch(/unlock/i);
    expect(failure.message).not.toMatch(/different password|corrupt/i);
    // Never the raw class text ("Codex is locked; operation ... requires
    // authentication. Call authenticate(password) first.") — that names an
    // API the user cannot call.
    expect(failure.message).not.toMatch(/authenticate\(/);
  });

  // `smartDecrypt` reaches its V1 branch through `await import("./v1")`. When
  // that import fails there is no crypto result at all, so calling it a
  // decryption failure is simply false — and it is the one case where
  // retrying with a different password is guaranteed to waste the user's time.
  it("classifies a dynamic-import failure as infrastructure — never as a decryption failure", () => {
    const browserShape = classifyDecryptFailure(
      new TypeError("Failed to fetch dynamically imported module: /crypto/v1.js"),
      SEED,
    );
    const nodeShape = classifyDecryptFailure(
      Object.assign(new Error("Cannot find module './v1'"), { code: "ERR_MODULE_NOT_FOUND" }),
      SEED,
    );

    for (const failure of [browserShape, nodeShape]) {
      expect(failure.kind).toBe("infrastructure");
      expect(failure.message).toMatch(/could not be loaded|loading failure/i);
      expect(failure.message).not.toMatch(/password|corrupt/i);
    }
  });

  // The fallback must stay DIAGNOSTIC. An unrecognized error swallowed into a
  // generic "could not decrypt" would re-create defect §4 (`rebuildFullKey`
  // throwing away a precisely-typed message) at this surface instead.
  it("keeps the underlying message for an unclassified error rather than discarding it", () => {
    const failure = classifyDecryptFailure(new Error("Unexpected V1 decrypt failure"), SEED);

    expect(failure.kind).toBe("unknown");
    expect(failure.message).toContain("Unexpected V1 decrypt failure");
  });

  // `catch (e)` binds `unknown`; a thrown non-Error must not render as
  // "[object Object]"-grade noise or crash the classifier.
  it("survives a thrown non-Error value", () => {
    const failure = classifyDecryptFailure("boom", SEED);

    expect(failure.kind).toBe("unknown");
    expect(failure.message).toContain("boom");
  });

  // The module exists to be SHARED — `LegacyPrimeMigrationWizard` names a
  // different thing ("this account's secret") than `SeedWordsTab`. A subject
  // hardcoded in here would silently make the module single-use again, which
  // is the exact duplication §5 is fixing.
  it("names the caller's subject, so a second surface can reuse it verbatim", () => {
    const account = classifyDecryptFailure(
      new WrongPasswordError("AES-GCM auth-tag failure"),
      "This account's secret",
    );

    expect(account.message).toContain("This account's secret");
    expect(account.message).not.toContain("seed phrase");
  });
});
