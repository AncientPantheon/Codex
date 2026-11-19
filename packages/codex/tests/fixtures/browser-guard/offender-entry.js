// Stands in for a published entry (`dist/<subpath>/index.js`). It imports NOTHING
// Node-only itself: every unsafe specifier lives in `#fake-external-dep`, reached
// through a BARE specifier — the shape that defeated both previous guards.
//
// Why bare and not a relative hop: the CI grep ran over `packages/codex/dist/`,
// and the treeshake gate blanket-externalizes bare specifiers it cannot resolve.
// Both are therefore blind to an offender whose bytes live in a DEPENDENCY. If
// this guard is ever "simplified" into externalizing dependencies wholesale, this
// entry stops producing violations and the test that reads it goes red.
export { readIt, openIt } from "#fake-external-dep";
