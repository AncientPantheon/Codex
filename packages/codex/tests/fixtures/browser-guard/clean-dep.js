// The other half of the guard's contract: builtins that DO have a real browser
// implementation every major bundler substitutes automatically are NOT
// violations. Real dependencies in codex's graph (@stoachain/stoa-core, bn.js,
// arbundles' web build, tweetnacl) import exactly these, in exactly these two
// spellings, and the published package has always worked in a browser with
// them. A guard that flagged them would be red forever and get switched off.
import { Buffer } from "node:buffer";
import { randomBytes } from "crypto";

export const nonce = () => Buffer.from(randomBytes(8)).toString("hex");
