/**
 * ExecutionTooltip -- hover a button, see what it will actually execute. Desktop only.
 *
 * WHAT IT IS FOR. It is a verification engine that ships. A button's wiring is a runtime
 * string: the function name, its argument order, the INFO preview beside it. None of that is
 * reachable by typechecking, and a unit test written from the app asserts whatever the app
 * already sends. The only authority is the chain -- so this asks the chain, on hover, and
 * shows the answer.
 *
 * Three things render, in the order that makes a fault obvious:
 *
 *   1. THE EXECUTION FUNCTION and its parameter list, read from the CONTRACT
 *      (`../../constants/pactSignatures.generated.js`). A button naming a function that no
 *      longer exists says so here -- `not on chain` -- instead of failing when a user presses
 *      it. This is exactly the failure class the 2026-09-26 "complete rehaul" round found by
 *      hand, one function at a time, against `describe-module` -- this component makes that
 *      check ambient instead of an incident response.
 *   2. THE ARGUMENTS the button would send, positionally against those parameters. A missing
 *      or shifted argument shows as a misalignment, which is the class the arity guard cannot
 *      see: two same-typed arguments swapped count as two either way (exactly what the
 *      `executor`/`patron` position swaps this session found looked like before they were
 *      fixed).
 *   3. THE LIVE INFO PREVIEW, run against the same ghost values the ZBOM uses. If that
 *      sentence renders and the IGNIS cost is a number, the whole path resolved: names, arity,
 *      types, and the contract's own reading of the operation.
 *
 * SO A CORRECT TOOLTIP IS EVIDENCE OF CORRECT WIRING. That is the point -- it turns "test every
 * button by hand" into "hover it".
 *
 * WHY DESKTOP ONLY. It is a hover affordance with no touch equivalent, and a tooltip that
 * opened on tap would fight the button it describes. Mobile keeps the ZBOM's own zones (Zone 0
 * FunctionInfoZone, Zone 2 inputs), which show the same information once opened.
 *
 * THE PREVIEW IS A REAL `/local` READ, via this package's own `pactRead` (the same seam every
 * other read in this package uses -- `setPactReader` in tests, tiered caching in production).
 * Debounced and cached per function+args, so sweeping a toolbar does not fire a request per
 * pixel -- but it is real traffic, not a static string. That is deliberate: a static string
 * could not tell you the wiring is broken.
 *
 * Ported from `daimons/OuronetUI/src/components/cfm/ExecutionTooltip.tsx` (sibling repo,
 * OuroborosNetwork workspace) — same engine, repointed at this package's own `pactRead` and
 * `useIsMobile`, and its hover/positioning mechanics rebuilt on this package's own established
 * `ActionTooltip` (Radix `Tooltip.Root` + `Portal`) rather than a hand-rolled absolute-position
 * `<div>` — the reference implementation's own approach — so it gets the SAME
 * viewport-overflow/clipping/z-index handling every other hover explainer in this package
 * already relies on (`InfoTooltip`, the StoaAccountsTab action row, `codex-arweave`'s Send AR
 * buttons), instead of a second, less battle-tested positioning system.
 */
import { useEffect, useRef, useState } from "react";
import { useIsMobile } from "@ancientpantheon/codex-ui/ui";
import { pactRead } from "@stoachain/stoa-core/reads";
import { ActionTooltip } from "../ui/ActionTooltip.js";
import { signatureOf } from "../../constants/pactSignatures.generated.js";

export type ExecutionSpec = {
  /** Fully qualified execution, e.g. "ouronet-ns.TS01-C4.CODEX|C_ReleaseStoicTag". */
  exec: string;
  /** Fully qualified INFO preview, e.g. "ouronet-ns.CODEX.INFO_CODEX|ReleaseStoicTag". */
  info?: string;
  /** Rendered Pact arguments, in order, for `exec` — shown positionally against `exec`'s
   *  parameter list from the manifest (the ZBOM's ghost values). ALREADY Pact-literal syntax
   *  (e.g. `JSON.stringify(address)` for a string arg, a bare `1.0` for a decimal) — these get
   *  interpolated directly into a Pact code string for the INFO preview call, not JS values. */
  args: string[];
  /**
   * Optional — the args for the `info` call, when its arity/order differs from `exec`'s (not
   * uncommon: e.g. `C_ReleaseStoicTag(patron, executor, tag-name)` vs.
   * `INFO_CODEX|ReleaseStoicTag(patron, tag-name)` — INFO drops `executor`). Defaults to
   * `args` when omitted, which is correct whenever EXEC and INFO share the same signature.
   */
  infoArgs?: string[];
};

type Preview =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ok"; text: string; ignis: string | null }
  | { state: "error"; message: string };

const cache = new Map<string, Preview>();

/** `ouronet-ns.TS01-C4.CODEX|C_ReleaseStoicTag` -> `TS01-C4.CODEX|C_ReleaseStoicTag`, the key
 *  the manifest uses. */
const unqualified = (s: string) => s.replace(/^ouronet-ns\./, "");

/**
 * Pull the ZBOM's zone 0 out of a ClientInfo. The shape is the contract's, verified against a
 * live INFO read (see this session's own `getRegisterStoicTagInfoLive` / `getReleaseStoicTagInfoLive`
 * etc. for the same shape already relied on elsewhere in this package):
 *
 *   pre-text  : [string]   the operation, one sentence per line -- what zone 0 shows
 *   post-text : [string]   what success will read as
 *   ignis     : { ignis-full, ignis-discount, ignis-need, ignis-text }
 *
 * A naive first cut would guess at `info-text` / `ignis-cost` and render a JSON dump for every
 * button -- which is the failure mode this component exists to prevent, so the shape is read
 * off a live call rather than assumed.
 */
function readablePreview(data: any): { text: string; ignis: string | null } {
  if (data === null || data === undefined) return { text: "(no data)", ignis: null };
  if (typeof data === "string") return { text: data, ignis: null };

  const pre = data["pre-text"];
  const text = Array.isArray(pre) && pre.length
    ? pre.join("\n")
    : JSON.stringify(data).slice(0, 300);

  const costs = data["ignis"];
  const need = costs?.["ignis-need"];
  const ignis = need === undefined || need === null
    ? null
    : typeof need === "object" && need?.decimal ? String(need.decimal) : String(need);

  return { text: String(text), ignis };
}

export function useExecutionPreview(spec: ExecutionSpec | null, active: boolean): Preview {
  const [preview, setPreview] = useState<Preview>({ state: "idle" });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const infoArgs = spec?.infoArgs ?? spec?.args ?? [];

  useEffect(() => {
    if (!active || !spec?.info) return;
    const code = `(${spec.info} ${infoArgs.join(" ")})`;
    const hit = cache.get(code);
    if (hit) {
      setPreview(hit);
      return;
    }

    setPreview({ state: "loading" });
    timer.current = setTimeout(async () => {
      let next: Preview;
      try {
        const res: any = await pactRead(code, { tier: "T5" } as any);
        if (res?.result?.status === "success") {
          next = { state: "ok", ...readablePreview(res.result.data) };
        } else {
          next = { state: "error", message: res?.result?.error?.message ?? "refused" };
        }
      } catch (e: any) {
        next = { state: "error", message: e?.message ?? String(e) };
      }
      cache.set(code, next);
      setPreview(next);
    }, 250);

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, spec?.info, infoArgs.join(" ")]);

  return preview;
}

/** The tooltip CARD — always rendered when mounted; the caller decides hover/desktop gating
 *  (see `ExecutionTooltip` below for the batteries-included wrapper). */
export function ExecutionTooltipCard({ spec }: { spec: ExecutionSpec }) {
  const params = signatureOf(unqualified(spec.exec));
  const preview = useExecutionPreview(spec, true);
  const mono = { fontFamily: "monospace", fontSize: "10px" } as const;

  return (
    <div
      className="rounded-lg border"
      style={{
        backgroundColor: "#0b0b0b",
        borderColor: "#2a2a2a",
        padding: "10px 12px",
        maxWidth: "440px",
        boxShadow: "0 8px 24px #000a",
      }}
    >
      <div style={{ ...mono, color: "#ceac5f" }}>{spec.exec}</div>
      {params === null ? (
        <div style={{ ...mono, color: "#8b1a1a", marginTop: 4 }}>
          not on chain — this button names a function the contract does not define
        </div>
      ) : (
        <div style={{ ...mono, color: "#6a6a6a", marginTop: 2 }}>({params.join(" ")})</div>
      )}

      {params && (
        <div style={{ marginTop: 6 }}>
          {params.map((p, i) => (
            <div key={p + i} style={{ ...mono, color: spec.args[i] ? "#9a9a9a" : "#8b1a1a" }}>
              <span style={{ color: "#4a4a4a" }}>{String(i + 1).padStart(2, "0")} </span>
              {p} = {spec.args[i] ?? "MISSING"}
            </div>
          ))}
          {spec.args.length > params.length && (
            <div style={{ ...mono, color: "#8b1a1a" }}>
              +{spec.args.length - params.length} argument(s) too many
            </div>
          )}
        </div>
      )}

      {spec.info && (
        <div style={{ marginTop: 8, borderTop: "1px solid #1c1c1c", paddingTop: 6 }}>
          <div style={{ ...mono, color: "#4a7a4a" }}>{spec.info}</div>
          {preview.state === "loading" && (
            <div style={{ ...mono, color: "#555", marginTop: 3 }}>reading…</div>
          )}
          {preview.state === "ok" && (
            <>
              <div
                style={{ fontSize: "11px", color: "#d8d8d8", marginTop: 3, fontStyle: "italic",
                         whiteSpace: "pre-line" }}
              >
                {preview.text}
              </div>
              {preview.ignis && (
                <div style={{ ...mono, color: "#ceac5f", marginTop: 3 }}>
                  {preview.ignis} IGNIS
                </div>
              )}
            </>
          )}
          {preview.state === "error" && (
            <div style={{ ...mono, color: "#8b1a1a", marginTop: 3 }}>{preview.message}</div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Batteries-included hover wrapper: renders `children` (typically the button/label it
 * describes) and shows `ExecutionTooltipCard` in a floating panel on hover — DESKTOP ONLY
 * (`useIsMobile`, this package's own container-relative detection, not viewport width). On
 * mobile, `children` renders alone; the ZBOM's own Zone 0 / Zone 2 already cover the same
 * ground once the modal is open.
 */
export default function ExecutionTooltip({
  spec,
  children,
}: {
  spec: ExecutionSpec;
  children: React.ReactNode;
}) {
  const isMobile = useIsMobile();

  // DESKTOP ONLY — see this file's own doc comment. Mobile keeps the ZBOM's
  // own Zone 0 / Zone 2, which cover the same ground once the modal is open;
  // a tooltip that opened on tap would fight the button it describes.
  if (isMobile) return <>{children}</>;

  return (
    <ActionTooltip content={<ExecutionTooltipCard spec={spec} />} side="bottom">
      {children}
    </ActionTooltip>
  );
}
