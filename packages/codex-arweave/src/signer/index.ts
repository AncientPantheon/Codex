/**
 * Signer SUBPATH barrel for @ancientpantheon/codex-arweave.
 *
 * EXPLICIT NAMED exports only (never `export *`), so the isolated signer surface
 * is auditable (PAT-001). This module is INTERNAL — the adapter consumes it; no
 * `./signer` package.json subpath is declared (the E1 adapter is the public import
 * site). Kept as a dedicated single-file seam so the static Kadena-isolation scan
 * over `src/signer/**` is trivially clean.
 */

export { signArweaveTransaction } from "./sign.js";
