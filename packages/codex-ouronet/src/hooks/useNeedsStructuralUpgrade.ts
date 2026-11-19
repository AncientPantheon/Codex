import { useCodex } from "@ancientpantheon/codex-ui/hooks";
import { STRUCTURAL_SHAPE_TARGET_VERSION } from "../structural-migration/index.js";

/** True when the live codex's `Codex_Shape_Version` is not the
 *  current structural target — covers both `undefined`
 *  ("Unversioned") and any older stamped value. Lives in
 *  codex-ouronet (not codex-ui) because it needs
 *  `STRUCTURAL_SHAPE_TARGET_VERSION`, which is a codex-ouronet-owned
 *  constant — codex-ui must not import from codex-ouronet (the
 *  established core <- ui <- ouronet dependency direction). */
export function useNeedsStructuralUpgrade(): boolean {
  const { Codex_Shape_Version } = useCodex();
  return Codex_Shape_Version !== STRUCTURAL_SHAPE_TARGET_VERSION;
}
