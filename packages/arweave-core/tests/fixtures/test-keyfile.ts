/**
 * ============================================================================
 * TEST FIXTURE ONLY — NEVER FUND, NEVER REUSE.
 * ============================================================================
 *
 * This is a real 4096-bit RSA private key (JWK) generated ONCE via runtime
 * WebCrypto (`RSA-PSS`, `modulusLength: 4096`, `publicExponent: [1,0,1]`,
 * `hash: "SHA-256"`, extractable) and committed verbatim so the keyfile,
 * generation, and address suites share one deterministic key-material source.
 *
 * The private components (`d`, `p`, `q`, `dp`, `dq`, `qi`) are committed to
 * source control. That is acceptable ONLY because this key must never hold
 * value: do not fund the address it derives, do not import it anywhere real,
 * do not reuse it outside this test tree.
 *
 * Invariants (asserted by tests/keys-keyfile.test.ts):
 *   - exactly the 9 canonical fields, `kty === "RSA"`, `e === "AQAB"`
 *   - `n` is 683 base64url chars and decodes to exactly 512 bytes (4096-bit)
 */

import type { ArweaveJwk } from "../../src/keys/types.js";

export const TEST_KEYFILE: ArweaveJwk = {
  kty: "RSA",
  n: "mMqZd7AU7QK3fj2IEKv6CcBVXGUQaVGfe44eeJ5mNf0rIThyDJbSrMuDmkBpjLyrDOppmmy-BHilxMHy2Xxl04RYm9sXzmsqth5RD6j_2lMNyqU6UObluAFhWhXMyxbBVqo08FtshWZX3r8AxqeAJXdGNJFbPKThw_XGeKFMEBGKlAxgG3gPMe7UMoPlcLj3aLq-iBWC9tmrSfbKJUGjZXDFOUvECv_KoLMs8gKl-x9axCsfS5lIgql0yLOci8YSy7FuOcMA2eNFg_HGm2eCKK16DPFN5FMX09ntmCXMuwa9KgioFwjZv94e7XUIzWq_mxCLQH7pLlVTwWyQgekrSVz0O2-v6k9-HT5WxOWKrEVQm-SFiTa8d7sdMzybxub6I_6BiJPCgnEYOHK0oT_JzCSEqfKBx45UOJvxAwVVZajtWmViZlfl9n6mHka26jrYwD12nmOseblrQBXmsU_8OQBz3LNdN_NT1HPnqCB0MNlLnnN0MurmQ1tA1osJjY51Hu5hR4Z8YcNfASx-9RSbBP6JHEuKaEyK8wh93k4S_r2gjjLTj6rBqCwtRAPtLA99_myImokSfB6mFBu8BC9Fwyl6v0jYCtcXV8fPIWgIGowFBmdWxeRhcQ15mfg3fb4u90VA3DGyTGdQi7x8o37eASCyh1vnZzvIFvSMQNlrgvE",
  e: "AQAB",
  d: "BKYVaUjYOiXdA2BH5Yn1_5n0fu0sRKgRHCdE0hKvtXDQgSBAiBWGr285v9W54GhVI_113Rb16RjqokPsaaWZS4g5UfSmksc783KUsM9JiZEBWGsSjSeZUbHpDl6fboZwt3xSRAXkFWL5xXM2SNUL1xf78NmDVyMFI3s04LK3p72A4-REgFF01OYZWrgcoQNfs7YK2gUdiPkydvulRuDqYcm-lnGxs0v5FE6fTXW7KxrXHiTZvOkbBa62OO0OFEqgg8YQPn2qZva9RLh0fIH3udkdX4tv_URx8yYsTnbH9eDMnJzK0Hiad3YApuTqsaVP0x37vqid26UI-VeeRfWcNYEuhPu1r8OeVmDC_IlD1aX1T4LTwpwOJ3n30d0WMwX6mWVl5BLR_7xcjY63VIIIko9tgWoGbygmczdUhsGMo94QUdYW0x-AijRHHYBkyB9BV5L3JeF5VCcujpW52id5QWv238HlqsPdOZ_kU75SPOMbKcfDX-ooETjUngGQ3ftch_tNxKv6szJ6vqqeWs34jak7wJzaw8x1htJGI2a1nZRFeIIOpGVwHGCBmYSBavdopyIUDYOTADKZ-FpAfjPbf3z9yK-8bgobAKmuKLhWvdhv1QIn7eyoYsSgNQJxbwtp_s14je4zRypzabAKhPguD60P2QCcdYMkdJq_O-HYbWk",
  p: "ywHqjR2Z-nfZK7FCsXEFrkqnDvCMgkHjha7h5WbeOA_Cdx-mvu7Ab50G6IAJiWshAc29vNwbByiVJvIhc4Ziuh8nadI0NteibiA4XvunKHNEWWC9CAxG0hZEVHU9stedLv3MjgQHTic_8dwGsmFnOCoPf2N_9fw5BF0IZhsbPulUxXJWrKvKyb7YT4pjYiPkN_Goj9exuJ84phUTD7F1m9-2ciEF8JaW68gKUJl_Vh-Lw20cFWceY-yoPOOApUzZucsPln0jYPM05bYsP4CWegQJLfPbFHWc9fjh1N9i_Apy4FXbtuSx_MQw-gwPARAUNYp70PeXmMGaJs8kSHCOVw",
  q: "wKz3f-LAHc5KWdp-UdaENZWPIrTmIgWNQp3Xg-Bq18pda74ha0kHzRAhdQlMTbm-6CmXR2I_lRYmseIcnfRRagf8PPRv-AQYY4wWwS343Eljtw7WwB_ckDIXtQ_k76Rdhe7H5PkSqcwZoN0ztLAIXZgSjr_blisVQ-jVT3F1GxlaviYmSp4cmduVTUolz9HQsNdoW304mm07kML2RbJhmo6sKZGc-YaAWpbHbJhM17d6RRJNdOMdVMPTk8KhR4HavM-RM-F7CSMCswDFFA6NrSJwxbgnl2RT1WM8zgoctCS_AaFiudBAlNdQTVNvbT0gIOHwRCMmODaJOyTEGUkb9w",
  dp: "VOofRxmrr6Xz9B-4SuqAus_FIy2hSFbxKZjmKoOlzgNhj1xw7gqF-enP2u67jnx-GPgLNnVG5O6nvNuo_F6o6ztezBe9-XanHbNigPB4kiXs4Anj5_rioLvppv5HaYhg2igVKQ4sVBd82tjzAChX-Zk2VE21V5pB6z5S5grOkbkd2V0jPiS5tTub1WGIgqOKsY_mtww87YHEO0wzZewPyrx_3ytLBcCnrkZFckNSjR6y4nLAPX-dqaRzFsz-oaYMqHd0tLjxVHtGlBNoXMOXrcAEavFGoT81AXoyVE2AZPal6IphVhZBEP6rkdv7ZrFoEqEze0wlYCMTLMqWXaqfDw",
  dq: "oRa74t8osoLL5O3pWPDaHpbJUkIeemlb3ktraWXSzlHx42fWNwWbERagcmJwujdG5oIHafY5pKMdfPHH7UPcYaMFf8z6ZEjAP1Jbn-2YuExfoygz4fOBi8llysrcJIOucZDe7ZBUy0PKVZU7aqEWjXHcah78L0QcBmf_F-mK-DothPcOYqpozTYqULFihastKP0f0gYSsgILoA9wqXrnYbpRNHv62yBZ5eNUHnYDIQPUpTUVL1nHJxyGo25BOzDVObDs_IxTOqNb2V8WZpt4Vj2KPbSm3UtTUAAlUTphHzftviY5DZOQuyB9kfjlG1bUqslcAQvGI49tEta9YUqfpw",
  qi: "n7xOgGbcNdI3vhXpeHP9HTLxfTTfv2hQxDmocK1ynTUlvyPPbbqMFS4oU4_ZmdyvXilAeOKip1R93pP7no2pHwS5HJ18YXXVOt__pZqesPW9geEqXYggjerd-Tyymy_ht2Qm5sTc-A2hMoaeQhtzqYPUlTHT0UCoOTKgJRBKn2GbHRhU6lnjULhCI34_4PBMLDTxWcIT_Rr7Z9eH-YF5ZoQPThZ-CMGF03HLwW9iRTu1MBSTrv2XuEWRh6UQ_osYE32pIvzFUtNGzRSIWXkCXAxizXncYHDjhyunpxv-wFPDKdTX1GFf4jLGkCU4RC9hTIwuqfq9fdsJjNdWkrTM4Q",
};
