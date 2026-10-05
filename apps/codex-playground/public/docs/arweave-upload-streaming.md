# How uploads work

This page explains, in plain terms, what happens when you upload a file (or a
set of files) to Arweave from this app. It is written for anyone using the
Codex — not for engineers — so you won't find any internal code names here.

## The short version

- Your files are sent to Arweave — a permanent, worldwide storage network —
  so once an upload finishes, it's there for good.
- For a long time, this app could only handle uploads up to about 1 GiB at
  once, because it had to hold your whole upload in your browser's memory
  before it could send it. That limit has been removed for most people.
- Bigger uploads now **stream** instead: your files are read and sent a
  little at a time, directly from disk, instead of being pulled entirely
  into memory first. This means there's no real size ceiling anymore for
  browsers that support it.

## Why your browser's "private storage" matters

To stream a large upload without running out of memory, this app needs to
use a small, private area of storage that modern browsers set aside — think
of it as a private scratch space on your own device that only this app can
see, used only while your upload is in progress and cleaned up right after.

Most up-to-date desktop browsers (Chrome, Edge, Firefox, and others built on
the same engines) support this. Some browser contexts don't — for example,
certain private-browsing modes, some embedded/sandboxed views, or a browser
that is simply older. This app checks for that support automatically, once,
at the start of your upload session — you don't need to do anything.

## What happens if your browser doesn't support it

If that private storage isn't available, this app falls back to its older,
in-memory method instead — the same one it has always used. That method
still works great for most everyday uploads, but it does have a limit:
selections are capped at 2 GiB total. If you hit that cap, you'll see a
clear message explaining why, and the cap will lift automatically the
moment you're using a browser that supports the private-storage method
above — it is a browser-support limitation, not a permanent restriction.

## What to expect during a very large upload

For a big upload, you'll see a few distinct stages as it progresses:

1. **Preparing your files** — your files are being read and packaged up.
2. **Verifying file integrity** — a checksum-like fingerprint is computed
   over everything, so Arweave (and you) can later confirm nothing was
   corrupted along the way.
3. **Uploading to Arweave** — the actual data is sent, piece by piece. A
   progress indicator shows how much has gone through so far, and updates
   live as the upload continues.
4. **Resuming**, if needed — if something interrupts the upload partway
   through (a lost connection, for example), this app can pick back up
   roughly where it left off, rather than starting over from zero.

Large uploads can take a while — this is normal, especially on a slower
connection, and is not a sign that anything has gone wrong. Because this
process now tracks its own progress on your device as it goes, closing the
tab partway through an upload is more recoverable than it used to be. (A
dedicated way to test and verify that recovery from inside the app is on its
way — see the placeholder section below.)

## Encrypted uploads

If you chose to encrypt your upload, all of the above still applies — your
files are still streamed and checksummed the same way, they're just
encrypted along the way so nobody but you (or whoever you chose to share
with) can read the contents.

## Testing an upload before you commit to it

On the Review step, right next to the real **Confirm & Upload** button,
there's a second button: **"Test this upload (free — runs locally, nothing is
sent to Arweave)."** Click it whenever you want to check a selection — small
or large, encrypted or not — before you actually send anything.

### What it does

It runs your real, chosen files through the exact same preparation,
checksumming, sending, and recovery steps described above — the same code,
the same stages — but instead of actually sending anything to Arweave, every
piece is captured locally, inside your own browser, and then checked. It even
deliberately interrupts itself partway through and picks back up again, the
same way a real upload would recover from a dropped connection — so a "Test"
run genuinely proves the recovery behavior works for your files, not just the
sending.

### What it does NOT do

- **No AR is spent.** Nothing is deducted from any account, ever, as part of
  a test.
- **Nothing is posted to Arweave.** No transaction, no chunk, nothing at all
  reaches the network — this is checked and enforced by this app itself, not
  just assumed.
- **Your files never leave your browser.** Everything a test touches stays
  on your own device, and every trace of it (the temporary working file, the
  progress record) is cleaned up automatically once the test finishes —
  whether it passes or fails.
- **It doesn't change anything about your real upload.** Running a test
  never marks anything as uploaded, never appears in your Library, and never
  affects the real Confirm & Upload button — you can test as many times as
  you like, then still confirm the real upload afterward exactly as before.

### Reading the result

Once a test finishes, you'll see a clear **PASS** or **FAIL** banner, plus a
short readout underneath. Here's what each line means, in plain terms:

- **Files tested** — how many files this test actually ran, start to finish.
- **Total size tested** — the combined size, in bytes, of everything it
  checked.
- **Chunks posted (locally)** — how many pieces your upload was broken into
  while being tested. This is purely informational; a different number here
  doesn't indicate a problem on its own.
- **Interrupt-and-resume tested** — whether this test actually simulated a
  dropped connection partway through and confirmed your upload could
  continue and finish anyway. This is the single most important check for a
  large upload: it's the thing that protects you if your laptop lid closes or
  your Wi-Fi drops midway through a real, multi-hour upload.
- **File-integrity proofs valid** — whether the checksums that let Arweave
  (and anyone else) later verify your file wasn't corrupted were checked
  independently and found correct.
- **Decrypt round-trip OK** — for an encrypted upload only: whether the
  encrypted bytes were decrypted back and compared, byte for byte, against
  your original files, proving the encryption is reversible with the right
  key. Shown as "N/A (unencrypted)" for a Public upload, since there's
  nothing to decrypt.
- **Streaming engine available right now** — whether this browser context
  could actually use the private-storage streaming method described above,
  right now. If this ever says "No" where you'd expect "Yes" (for example,
  it was "Yes" a moment ago in the same app), that's itself worth reporting —
  see below.
- **Took … ms** — how long the test itself took to run. This has no bearing
  on how long the REAL upload will take (a real upload also has to wait on
  network conditions, which a local-only test never touches).

### If it reports FAIL

**Don't proceed with the real upload yet.** A failing test means something
about this exact selection — this file, this key, this browser context right
now — would likely not go through cleanly for real, and a real upload risks
spending AR on something that doesn't complete the way you expect.

Instead:

1. Read the error message(s) shown under the result — they're written to
   name the specific problem (for example, a key that doesn't match, or a
   file that couldn't be read).
2. If you're reporting this to someone for help, include the FULL result
   panel — the PASS/FAIL line and every row underneath it, plus any error
   text shown. That's exactly the evidence needed to diagnose what went
   wrong, without needing access to your files or keys.
3. Once whatever caused the failure is fixed (a different account, a smaller
   selection, a different browser/tab, etc.), you're welcome to test again
   as many times as you like — testing is always free and always safe.
