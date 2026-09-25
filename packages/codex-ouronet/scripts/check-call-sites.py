#!/usr/bin/env python3
"""Every chain call this package (as BUILT — dist/, not src/) and its dependencies make,
checked against the Pact sources.

WHY dist/, NOT src/. This package is consumed as compiled output (bundled into
`@ancientpantheon/codex`, or built on its own); a source-tree grep misses whatever the build
step (template literals resolved, imports flattened) changes in shape, and it is silent about
whatever the package's OWN dependencies (`@ouronet/ouronet-core`) build internally — which is
exactly the class of bug the 2026-09-26 "complete rehaul" round found (this package's `src/`
calls were already fixed; several of the NEWLY-found bugs that round were `@ouronet/ouronet-core`
functions this package calls into, invisible to a `src/`-only scan).

OFFLINE AND COMPLETE. The sources are local (see `generate-pact-signatures.py`) and they are
what is deployed, so nothing here needs the network — which means it can check ALL of it, every
run, instead of one symbol per HTTP round trip. The live `describe-module` / `/local` check
(the ad-hoc verification this whole audit round was built on) remains the on-chain confirmation
for when local and deployed might disagree; this is the one that runs constantly, in CI, for
free.

WHAT IT CATCHES: the function does not exist. A missing member is a RESOLUTION error — `try`
cannot catch it, and callers render a default (an empty list, a "0" balance, a permanently
disabled button) instead of a visible failure. That silence is exactly what let this package's
own `DALOS.UR_AccountKadena` / `INFO-ZERO.DALOS-INFO|URC_*` / `C_RotateKadena` bugs ship
undetected for as long as they did.

ARITY IS DELIBERATELY NOT CHECKED HERE — ported reasoning from the sibling script
(`daimons/OuronetUI/scripts/check-call-sites.py`): a first attempt at counting arguments across
JS template literals produced confident nonsense (call-SHAPED strings live in doc comments,
annotation labels, and rewrite tables, and counting delimiters across an interpolated literal is
fragile in a way that erodes trust in the tool). Arity is covered where the calls are
STRUCTURED rather than interpolated — this package's own direct unit tests
(`tests/ouronet-execute-wiring.test.ts`) already assert the exact Pact-code string every local
builder emits, which is the same guarantee for the calls this package controls directly.

WHAT NOTHING STATIC CATCHES: two same-typed arguments swapped — `(patron executor)` against
`(executor patron)` counts as two either way. That is `ExecutionTooltip.tsx`'s job (renders
arguments positionally against the same parameter manifest this script reads), not this
script's.

    python3 scripts/check-call-sites.py          report, exit 1 on any finding
"""
import json
import pathlib
import re
import sys

PKG = pathlib.Path(__file__).resolve().parent.parent
SIGS_PATH = PKG / "scripts/pact-signatures.full.json"

ROOTS = ["dist", "node_modules/@ouronet/ouronet-core/dist"]
SKIP = ("__tests__", ".d.ts", "pact-signatures", "pactSignatures.generated")

# A CALL, not a mention: an open paren, the namespace, module, function — then whitespace or a
# close paren. Matching a bare qualified name anywhere (a doc comment, a display label) reports
# things that are not calls, which is how a checker earns being ignored.
CALL = re.compile(
    r'\((?:\$\{[A-Za-z_]+\}|ouronet-ns)\.([A-Za-z0-9|_-]+)\.([A-Za-z0-9|_-]+)(?=[\s)"`])')


def main():
    if not SIGS_PATH.is_file():
        print(f"error: {SIGS_PATH.relative_to(PKG)} not found — run "
              f"scripts/generate-pact-signatures.py first")
        return 1
    sigs = json.loads(SIGS_PATH.read_text(encoding="utf8"))

    findings = []
    seen = set()
    for root in ROOTS:
        base = PKG / root
        if not base.is_dir():
            continue
        for path in base.rglob("*"):
            if path.suffix not in (".ts", ".tsx", ".js") or any(s in str(path) for s in SKIP):
                continue
            text = path.read_text(encoding="utf8", errors="replace")
            for m in CALL.finditer(text):
                module, fn = m.group(1), m.group(2)
                qualified = f"{module}.{fn}"
                if qualified in seen:
                    continue
                seen.add(qualified)
                if qualified not in sigs:
                    rel = str(path.relative_to(PKG))
                    findings.append((qualified, rel))

    for q, rel in sorted(findings):
        print(f"  MISSING  {q}")
        print(f"           {rel}")
    print(f"{len(seen)} distinct call shapes checked against {len(sigs)} signatures — "
          f"{len(findings)} finding(s)")
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
