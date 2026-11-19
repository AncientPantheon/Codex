// A module the ENTRY does not mention — it is reached one hop away, standing in
// for a node_modules dependency whose bytes never appear in our own dist/. The
// old CI grep ran over `packages/codex/dist/` only, so an offender living here
// was structurally invisible to it; that is the blind spot that shipped twice.
//
// Both offending imports are written in forms the old grep could not match:
//   - `node:`-prefixed (it matched only bare names);
//   - a DYNAMIC `import()` with DOUBLE quotes (it matched only `from '…'`).
export async function readIt(stream) {
  const { pipeline } = await import("node:stream/promises");
  return pipeline(stream, stream);
}

export async function openIt(p) {
  const fs = await import("node:fs/promises");
  return fs.readFile(p);
}
