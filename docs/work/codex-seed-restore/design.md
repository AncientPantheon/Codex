# Codex Restore From Seed Words — Project Design

## Problem

Today a codex can only be restored by the user possessing the actual codex
JSON export. If that file is lost, there is no way back — even though a
codex is ultimately built from Ouronet seed words, it contains an
assortment of independently-generated/imported material (StoaChain seeds,
multiple Ouronet accounts, Arweave seeds and keys, pure keypairs, foreign
keys), so no single seed reconstructs the whole thing today.

This project makes a codex recoverable from nothing but memorized seed
words, by anchoring recovery to the Arweave codex-backup feature already
built (`docs/work/arweave-upload-categories/design.md`'s `codex-backup`
category): if the backup was posted through an Arweave account derivable
from the same words as the Prime Ouronet account, the words alone are
enough to find it and unlock it.

## Approach

Two topics, not strictly sequential — Topic 1 is the mechanism and already
works for any freshly-created codex (a new codex's Prime Ouronet account and
Prime Arweave seed naturally share origin words under the standard kickstart
flow); Topic 2 is what makes an *existing* codex whose prime accounts don't
already share those words — most commonly because it was bootstrapped with
a koala (Kadena-wallet-style) mnemonic — eligible for it too. Topic 2 can
ship after Topic 1 without blocking it.

## Topics

1. `arweave-seed-restore` — the core mechanism: a codex password encrypted
   under the Prime Arweave account's own key, attached to the backup upload;
   a restore flow that derives that account purely from typed seed words,
   finds any backups on chain, and unlocks one.
2. `legacy-prime-migration` — the three-option migration wizard that makes
   an existing, not-yet-eligible codex "deploy ready": aligning its Prime
   Arweave seed with its Prime Ouronet words (or promoting a different
   account, or starting fresh), and the real on-chain fund sweep (native
   STOA + urSTOA) that migration requires, grounded against the actual
   deployed StoaChain contract rather than assumed.
