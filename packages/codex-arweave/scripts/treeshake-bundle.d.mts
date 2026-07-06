/**
 * Ambient types for the bundle-emit tree-shake gate helper (E-12 / FIX-2).
 * The helper itself is authored as `.mjs` (esbuild is a node-only build tool,
 * kept out of the TS `src` graph); this declaration lets the `.ts` gate test
 * import `emitBundle` with a real signature instead of an implicit `any`.
 */

/**
 * Bundle `entryAbsPath` with esbuild tree-shaking and return the module paths
 * that survived into the emitted bundle (retained output, not the raw crawl).
 */
export function emitBundle(
  entryAbsPath: string,
): Promise<{ inputKeys: string[] }>;
