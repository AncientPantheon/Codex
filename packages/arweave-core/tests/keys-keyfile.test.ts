/**
 * keys-keyfile.test.ts — coverage for the canonical keyfile module (T2.4).
 *
 * The keyfile IS the private key. A silently-accepted malformed JWK can derive
 * a wrong address and lose funds, so import validation must reject loudly on
 * every corruption class and the rejection must NEVER leak key material into
 * the error. These tests lock:
 *   - the 9-field canonical shape and round-trip fidelity
 *   - canonicalization (WebCrypto extras stripped)
 *   - the full rejection matrix (missing / not-a-string / empty / bad-encoding
 *     / wrong-kty / bad-length / bad-exponent)
 *   - the security contract: no field VALUE appears in the thrown error.
 */

import { describe, it, expect } from "vitest";
import { importKeyfile, exportKeyfile } from "../src/keys/keyfile.js";
import { InvalidKeyfileError } from "../src/keys/errors.js";
import type { ArweaveJwk } from "../src/keys/types.js";
import { TEST_KEYFILE } from "./fixtures/test-keyfile.js";

const BASE64URL_FIELDS = ["n", "e", "d", "p", "q", "dp", "dq", "qi"] as const;

/** A fresh deep-ish clone of the fixture so per-test mutation is isolated. */
function cloneFixture(): Record<string, unknown> {
  return { ...TEST_KEYFILE };
}

describe("importKeyfile — valid input acceptance", () => {
  it("accepts the canonical 4096-bit fixture and returns exactly the 9 fields", () => {
    const jwk = importKeyfile(cloneFixture());
    expect(Object.keys(jwk).sort()).toEqual(
      ["d", "dp", "dq", "e", "kty", "n", "p", "q", "qi"].sort(),
    );
    expect(jwk.kty).toBe("RSA");
    expect(jwk.e).toBe("AQAB");
  });

  it("canonicalizes a WebCrypto-flavored JWK by stripping alg/ext/key_ops extras", () => {
    const webcrypto = {
      ...cloneFixture(),
      alg: "PS256",
      ext: true,
      key_ops: ["sign"],
    };
    const jwk = importKeyfile(webcrypto);
    // Extras must not survive canonicalization — exactly the 9 fields remain.
    expect(Object.keys(jwk).sort()).toEqual(
      ["d", "dp", "dq", "e", "kty", "n", "p", "q", "qi"].sort(),
    );
    expect("alg" in jwk).toBe(false);
    expect("ext" in jwk).toBe(false);
    expect("key_ops" in jwk).toBe(false);
  });
});

describe("importKeyfile — round-trip fidelity", () => {
  it("importKeyfile(exportKeyfile(k)) deep-equals the fixture key", () => {
    const k: ArweaveJwk = importKeyfile(cloneFixture());
    const roundTripped = importKeyfile(exportKeyfile(k));
    expect(roundTripped).toEqual(k);
    // And equals the original fixture material field-for-field.
    expect(roundTripped).toEqual({ ...TEST_KEYFILE });
  });

  it("exportKeyfile emits only the 9 canonical fields", () => {
    const k = importKeyfile(cloneFixture());
    const exported = exportKeyfile(k);
    expect(Object.keys(exported as object).sort()).toEqual(
      ["d", "dp", "dq", "e", "kty", "n", "p", "q", "qi"].sort(),
    );
  });
});

describe("importKeyfile — non-object rejection", () => {
  for (const bad of [null, undefined, "a string", 42, true, [] as unknown]) {
    it(`throws InvalidKeyfileError for non-object input: ${String(bad)}`, () => {
      expect(() => importKeyfile(bad)).toThrow(InvalidKeyfileError);
    });
  }
});

describe("importKeyfile — kty rejection", () => {
  it("throws (wrong-kty) when kty is missing", () => {
    const bad = cloneFixture();
    delete bad.kty;
    expect(() => importKeyfile(bad)).toThrow(InvalidKeyfileError);
    try {
      importKeyfile(bad);
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidKeyfileError);
      expect((e as InvalidKeyfileError).reason).toBe("wrong-kty");
      expect((e as InvalidKeyfileError).fields).toContain("kty");
    }
  });

  it("throws (wrong-kty) when kty !== 'RSA'", () => {
    const bad = cloneFixture();
    bad.kty = "EC";
    expect(() => importKeyfile(bad)).toThrow(InvalidKeyfileError);
    try {
      importKeyfile(bad);
    } catch (e) {
      expect((e as InvalidKeyfileError).reason).toBe("wrong-kty");
    }
  });
});

describe("importKeyfile — each base64url field individually deleted (missing)", () => {
  for (const field of BASE64URL_FIELDS) {
    it(`throws (missing) when '${field}' is absent`, () => {
      const bad = cloneFixture();
      delete bad[field];
      expect(() => importKeyfile(bad)).toThrow(InvalidKeyfileError);
      try {
        importKeyfile(bad);
      } catch (e) {
        expect((e as InvalidKeyfileError).fields).toContain(field);
        expect((e as InvalidKeyfileError).reason).toBe("missing");
      }
    });
  }
});

describe("importKeyfile — each base64url field individually corrupted", () => {
  it.each(BASE64URL_FIELDS)("throws (not-a-string) when '%s' is not a string", (field) => {
    const bad = cloneFixture();
    bad[field] = 12345;
    expect(() => importKeyfile(bad)).toThrow(InvalidKeyfileError);
    try {
      importKeyfile(bad);
    } catch (e) {
      expect((e as InvalidKeyfileError).reason).toBe("not-a-string");
      expect((e as InvalidKeyfileError).fields).toContain(field);
    }
  });

  it.each(BASE64URL_FIELDS)("throws (empty) when '%s' is an empty string", (field) => {
    const bad = cloneFixture();
    bad[field] = "";
    expect(() => importKeyfile(bad)).toThrow(InvalidKeyfileError);
    try {
      importKeyfile(bad);
    } catch (e) {
      expect((e as InvalidKeyfileError).reason).toBe("empty");
      expect((e as InvalidKeyfileError).fields).toContain(field);
    }
  });

  it.each(BASE64URL_FIELDS)(
    "throws (bad-encoding) when '%s' contains '=' padding",
    (field) => {
      const bad = cloneFixture();
      bad[field] = String(TEST_KEYFILE[field]).slice(0, -1) + "=";
      expect(() => importKeyfile(bad)).toThrow(InvalidKeyfileError);
      try {
        importKeyfile(bad);
      } catch (e) {
        expect((e as InvalidKeyfileError).reason).toBe("bad-encoding");
        expect((e as InvalidKeyfileError).fields).toContain(field);
      }
    },
  );

  it.each(BASE64URL_FIELDS)(
    "throws (bad-encoding) when '%s' contains standard-base64 '+' or '/'",
    (field) => {
      const bad = cloneFixture();
      bad[field] = "AB+/" + String(TEST_KEYFILE[field]).slice(4);
      expect(() => importKeyfile(bad)).toThrow(InvalidKeyfileError);
      try {
        importKeyfile(bad);
      } catch (e) {
        expect((e as InvalidKeyfileError).reason).toBe("bad-encoding");
        expect((e as InvalidKeyfileError).fields).toContain(field);
      }
    },
  );
});

describe("importKeyfile — value-level invariants", () => {
  it("throws (bad-length) for an alphabet-valid but truncated n (wrong decoded length)", () => {
    const bad = cloneFixture();
    // Drop 4 chars → still base64url-legal, decodes to 509 bytes, not 512.
    bad.n = String(TEST_KEYFILE.n).slice(0, -4);
    expect(() => importKeyfile(bad)).toThrow(InvalidKeyfileError);
    try {
      importKeyfile(bad);
    } catch (e) {
      expect((e as InvalidKeyfileError).reason).toBe("bad-length");
      expect((e as InvalidKeyfileError).fields).toContain("n");
    }
  });

  it("throws (bad-length) when n has length ≡ 1 (mod 4) — impossible byte count", () => {
    const bad = cloneFixture();
    bad.n = String(TEST_KEYFILE.n).slice(0, -2); // 681 chars, 681 % 4 === 1
    expect(() => importKeyfile(bad)).toThrow(InvalidKeyfileError);
    try {
      importKeyfile(bad);
    } catch (e) {
      expect((e as InvalidKeyfileError).reason).toBe("bad-length");
    }
  });

  it("throws (bad-exponent) when e !== 'AQAB'", () => {
    const bad = cloneFixture();
    bad.e = "AQAC";
    expect(() => importKeyfile(bad)).toThrow(InvalidKeyfileError);
    try {
      importKeyfile(bad);
    } catch (e) {
      expect((e as InvalidKeyfileError).reason).toBe("bad-exponent");
      expect((e as InvalidKeyfileError).fields).toContain("e");
    }
  });
});

describe("InvalidKeyfileError — security: never leaks key material", () => {
  it("thrown error's message and fields contain none of the corrupt/private values", () => {
    // Corrupt d (a private value) with an out-of-alphabet char and confirm the
    // secret never appears in the surfaced error.
    const secret = String(TEST_KEYFILE.d);
    const corrupt = secret.slice(0, -1) + "*"; // '*' is out of alphabet
    const bad = cloneFixture();
    bad.d = corrupt;

    try {
      importKeyfile(bad);
      throw new Error("expected importKeyfile to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidKeyfileError);
      const err = e as InvalidKeyfileError;
      const haystack = err.message + JSON.stringify(err.fields) + JSON.stringify(err.reason);
      // Neither the original private value nor the corrupt variant may leak.
      expect(haystack).not.toContain(secret);
      expect(haystack).not.toContain(corrupt);
      expect(haystack).not.toContain(secret.slice(0, 40));
      // But it MUST name the offending FIELD so the caller can act.
      expect(err.fields).toContain("d");
    }
  });
});

describe("test fixture integrity", () => {
  it("fixture is the canonical 9-field form with e === 'AQAB'", () => {
    expect(Object.keys(TEST_KEYFILE).sort()).toEqual(
      ["d", "dp", "dq", "e", "kty", "n", "p", "q", "qi"].sort(),
    );
    expect(TEST_KEYFILE.kty).toBe("RSA");
    expect(TEST_KEYFILE.e).toBe("AQAB");
  });

  it("fixture n decodes to exactly 512 bytes (4096-bit modulus)", () => {
    // Same unpadded-base64url length arithmetic the importer uses.
    const len = TEST_KEYFILE.n.length;
    const mod = len % 4;
    const bytes =
      mod === 0 ? (len / 4) * 3 : mod === 2 ? (len - 2) / 4 * 3 + 1 : mod === 3 ? (len - 3) / 4 * 3 + 2 : -1;
    expect(bytes).toBe(512);
    // And the importer accepts it (n passes the bad-length guard).
    expect(() => importKeyfile({ ...TEST_KEYFILE })).not.toThrow();
  });
});
