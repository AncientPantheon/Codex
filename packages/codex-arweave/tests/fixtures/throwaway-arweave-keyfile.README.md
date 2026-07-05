# THROWAWAY Arweave keyfile — test fixture ONLY

`throwaway-arweave-keyfile.json` is a canonical 9-field `ArweaveJwk`
(RSA-4096, `e = "AQAB"`, `n` decoding to 512 bytes) generated ONCE via a
one-off `generateKey()` script (`@ancientpantheon/arweave-core`) purely so the
E1 test matrix has a deterministic key with a known address.

- **NEVER fund this address.** The private material (`d`/`p`/`q`/`dp`/`dq`/`qi`)
  is committed to the repo in plaintext — anyone who reads it controls the key.
  It exists solely to exercise the encrypt-at-rest / backup round-trip tests.
- **NEVER reuse this JWK for a real wallet.**
- Its deterministic Arweave address (`Base64URL(SHA-256(decode(n)))`) is
  `tzXauR_QBlPW3ZRey3xBzaiDqPqLfiqWk1SWmk2BjM4` — the anchor the E-03 backup
  round-trip asserts against after wipe + restore.
