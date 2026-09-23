# Changelog

## 0.4.0 — 2026-09-24

**MINOR — Pantheonic-mobile compliance for the whole Arweave panel, plus
Super Max wallet sweep. No breaking changes.**

- **Mobile layouts for `ArweaveAccountsArea`, `ArweaveSeedsArea`,
  `PureKeysArea`.** Icon-only sticky sub-tab bar, 2-line compact account/seed
  rows, icon-only seed-source buttons (own seed / Ouronet account / Chainweb
  seed), a triple-dot row-actions menu portaled to `document.body` (escaping
  the swipe carousel's `transform`, which otherwise mispositions any
  `position: fixed` descendant), and — mirroring the Chainweb side — a real
  full-screen detail view on tap instead of an inline expand: seed rows and
  Pure Key rows both now portal their expanded content into a full-screen
  `CodexModalShell`. The Pure Key detail view specifically was restructured
  into a vertical stack (single-line truncated address, action buttons, then
  the RSA-parameter disclosure), each on its own row.
- **`ArweaveAddressHighlight`** (in `ArweaveAccountsArea.tsx`) is now
  exported and reused by `PureKeysArea.tsx` instead of duplicating the
  width-measurement/truncation logic.
- **`wordsSecret` on `IArweaveSeed`** (mirrors the same new field on
  `IStoaChainSeed` in `codex-ouronet`): a seed created from typed/generated
  words can now show those real words back on later reveal.
- **Send AR: Super Max.** A second, riskier "empty the wallet" mode
  alongside the existing (buffered) Max — forces "Fee Included", fills the
  whole balance, and uses the exact live-quoted fee with no safety buffer.
  Both now carry an explanatory tooltip via the shared `ActionTooltip`.

## 0.0.1 — 2026-07-04

- Initial package skeleton.
