/**
 * PreZbomHint — hover a LAUNCHER button (the one that OPENS a ZBOM), see what
 * it will call before the modal ever mounts. Desktop only.
 *
 * REBUILT (registry `@ouronet/talos-registry@2.1.0`) on the shared canon:
 * `tooltipModel`/`tooltipModels`. Read `node_modules/@ouronet/talos-registry/
 * TOOLTIP-CANON.md` before touching this file — it is the authoritative
 * source, not this comment, and it is shared with OuronetUI so neither app
 * drifts from the other. This file renders the model; it does not compute
 * placeholders, chain classification, or guard restrictions itself anymore —
 * all of that used to be hand-rolled here (and in a hand-authored
 * `nativeStoaSpecs.ts`, now deleted) and is exactly the kind of logic the
 * canon exists to stop two apps from reimplementing slightly differently.
 *
 * WHY THIS IS A SEPARATE COMPONENT TREE FROM `ExecutionTooltip.tsx`, NOT A
 * REUSE. That component is wired onto the WRONG surface for this feature by
 * design: per the owner's ruling, the tooltip belongs on the LAUNCHER, never
 * a ZBOM's own execute button — inside an open ZBOM the information is
 * already on the page, and a tooltip there would draw over the modal it
 * annotates. `ExecutionTooltip.tsx` stays exactly as it is, untouched.
 *
 * THE CANON'S OWN RULES, briefly (see TOOLTIP-CANON.md for the why):
 *
 *   Rule 0  Chainweb only. A key `tooltipModel` cannot describe (Arweave,
 *           anything else off-registry) gets NO tooltip — not an empty one.
 *           `PreZbomHint` fails open (renders `children` alone) rather than
 *           ever calling `tooltipModel` on such a key (which would throw).
 *   Rule 1  `m.slots` is EVERY execution parameter, always, in order — never
 *           the preview's (often shorter/differently-named) list.
 *   Rule 2  Arguments are the EXECUTION's; cost is the PREVIEW's. The two
 *           lists are shown separately, each under its own name.
 *   Rule 3  Names and types each get their own row (`signatureRows(m)`).
 *   Rule 4  Three chains, each with a canonical border colour
 *           (`m.chainColor`/`m.chainLabel`) — never invented per-app.
 *   Rule 4b The CONSUMER (who is rendering — Codex, violet) is a second,
 *           separate axis from the chain colour, carried as `m.consumer`.
 *   Rule 5  A ghost is not data — `isPlaceholder`/`isPreflightFed` render
 *           visibly differently from a real value, and `m.shouldRead` gates
 *           the live cost read.
 *   Rule 6  A guard's `display` form is rendered, its raw form is never
 *           prefilled — `tooltipModel` already applies both.
 *
 * Everything below this point is presentation only: cycling (multiple
 * entrypoints), the live `/local` cost read, hover-affordance wiring
 * (Radix `ActionTooltip`), and this package's own on/off setting + mobile
 * gate — none of which the model expresses, all of which the canon's own
 * "Placement and behaviour" section requires of every renderer.
 */
import { useEffect, useMemo, useRef, useState, isValidElement, cloneElement, type ReactElement } from "react";
import { useIsMobile } from "@ancientpantheon/codex-ui/ui";
import { pactRead } from "@stoachain/stoa-core/reads";
import {
  tooltipModel,
  signatureRows,
  chainOf,
  CONSUMERS,
  type TooltipModel,
} from "@ouronet/talos-registry";
import { ActionTooltip } from "../ui/ActionTooltip.js";
import { usePreZbomTooltipSetting } from "./usePreZbomTooltipSetting.js";
import { readablePreview, shorten, mono, previewCardStyle, type Preview } from "./previewFormatting.js";
import { LOCAL_STOA_SIGNATURES, resolveLocalStoaSlots, type LocalStoaSignature } from "./localStoaSignatures.js";

/**
 * How long each variant holds the window before the next, for a button that
 * cycles through more than one entrypoint. Canon: "Cycle at 10 seconds...
 * the transaction toaster's ~3s is the wrong model to copy: a toast is
 * glanced at, this panel is read."
 */
const CYCLE_MS = 10_000;

/**
 * The registry-resolved card's own border colour. Deliberately NOT this —
 * the canon reverses this session's own earlier "violet border" fix: the
 * border encodes WHICH CHAIN (`m.chainColor` — blue/gold/green), never WHO
 * is rendering. The consumer's own violet accent (`CONSUMERS.Codex.accent`)
 * is a SEPARATE axis, carried as a small corner marker (`ConsumerBadge`
 * below) — merging the two axes is exactly what rule 4b warns against.
 */

/**
 * `tooltipModel`/`tooltipModels`' `values` parameter takes ALREADY-RENDERED
 * Pact literals (the same universe every ghost value and `preview.call`
 * lives in) — a bare JS string like `"NewName"` is substituted into a call
 * verbatim, UNQUOTED, which is invalid Pact for a `string`-typed slot
 * (confirmed live: an unquoted override broke `preview.call`'s own syntax).
 * Every current caller of `PreZbomHint`'s own `values` prop passes a plain
 * JS string meant as a Pact STRING (an account address, a tag, a label) —
 * never a decimal/bool/guard override — so this file, not each of the ~15
 * call sites, is the one place responsible for quoting. `JSON.stringify`
 * produces the same escaped `"..."` form the registry's own ghost data uses.
 */
function toModelValues(values: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!values) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) out[k] = JSON.stringify(v);
  return out;
}

const warnedOffRegistry = new Set<string>();

/** Warns exactly once per distinct key this model cannot describe at all —
 *  every current launcher in this package names a Chainweb entrypoint it
 *  expects to resolve, so this always signals real drift (a stale/typo'd
 *  key), never an expected "different kind of button" case (this package
 *  has no Arweave launchers to intentionally exclude). */
function warnOffRegistryOnce(key: string): void {
  if (warnedOffRegistry.has(key)) return;
  warnedOffRegistry.add(key);
  // eslint-disable-next-line no-console
  console.warn(
    `[PreZbomHint] "${key}" is not a Chainweb key \`tooltipModel\` can describe — either the ` +
      `name is stale or the module is not deployed. Rendering children with no tooltip (fail open).`,
  );
}

/**
 * Rule 8 — "a refusal is an answer; render it as one". `No value found in
 * table ouronet-ns.ATS_ATS|Ledger for key: SilverStoa…` is not a crash — the
 * chain is saying THIS SUBJECT HAS NO ROW HERE, often the single most useful
 * thing the preview could say, and in plain red it reads as a broken
 * contract instead.
 *
 * The canon's own second case ("placeholder argument → name the argument,
 * do not show the refusal") is structurally unreachable in THIS renderer:
 * `m.shouldRead` (checked before `usePreZbomPreview` ever fires a read) is
 * already false whenever the rendered call contains a placeholder — so a
 * `preview.state === "error"` here can only ever be a genuine on-chain
 * refusal, never a foregone placeholder-caused one. Only the other two
 * cases apply: a classified "missing row", or "anything else", shown raw.
 *
 * THE REGEX IS DELIBERATELY BROAD, AND THAT IS A REAL TRADE-OFF, NOT AN
 * OVERSIGHT: this exact package has shipped the identical string shape —
 * `"No value found in table … for key …"` — from a cause that was NOT "no
 * row for this subject" at all, at least four separate times (confirmed
 * reading `ouroSelectorReads.ts`'s own doc comment: `getWrapperPaymentKey`
 * calling the RETIRED `DALOS.UR_AccountKadena` surfaced this exact refusal
 * shape instead of a resolution error; `RotateGuardModal.tsx`/
 * `RenameDualLaneModal.tsx`/`ActivateApolloPythiaKeyModal.tsx`/
 * `RegisterStoicTagModal.tsx` all document hitting the same class against a
 * different tombstoned module). A genuinely broken/stale wiring bug could
 * therefore produce the SAME string a legitimate "you don't have a
 * position here yet" answer would — so the raw message is ALWAYS carried
 * through too (on `title`, matching this file's own `shorten()` convention
 * of "the full/raw form stays reachable on hover, never fully replaced"),
 * even when the friendly form is what's shown inline. A real wiring
 * regression stays discoverable on inspection; it is never fully hidden
 * behind reassuring text.
 */
function classifyRefusal(message: string): { classified: boolean; display: string; raw: string } {
  if (/no value found in table .+ for key/i.test(message)) {
    return {
      classified: true,
      display: "No existing record for this yet — the operation itself is valid; there's simply nothing here to act on.",
      raw: message,
    };
  }
  return { classified: false, display: message, raw: message };
}

const liveReadCache = new Map<string, Preview>();

/**
 * The live-read effect. `callString` is `m.preview.call` — the model's own
 * ready-to-`/local` string, computed in the render body — a plain string,
 * referentially stable across renders whenever the underlying model is
 * unchanged. The effect depends on THAT string, never a values object (an
 * inline object literal is a new identity every render; keying on it
 * re-fires the read every render, which sets state, which re-renders,
 * forever).
 */
function usePreZbomPreview(callString: string | null): Preview {
  const [preview, setPreview] = useState<Preview>({ state: "idle" });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!callString) {
      setPreview({ state: "idle" });
      return;
    }
    const key = callString;
    const hit = liveReadCache.get(key);
    if (hit) {
      setPreview(hit);
      return;
    }

    setPreview({ state: "loading" });
    timer.current = setTimeout(async () => {
      let next: Preview;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const res: any = await pactRead(key, { tier: "T5" } as any);
        if (res?.result?.status === "success") {
          next = { state: "ok", ...readablePreview(res.result.data) };
        } else {
          next = { state: "error", message: res?.result?.error?.message ?? "refused" };
        }
      } catch (e) {
        next = { state: "error", message: e instanceof Error ? e.message : String(e) };
      }
      liveReadCache.set(key, next);
      setPreview(next);
    }, 250);

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callString]);

  return preview;
}

/** The "who is rendering" marker — rule 4b, a DIFFERENT axis from the
 *  chain-coloured border. Reads `m.consumer` rather than hardcoding a
 *  colour/label, so this stays correct if this package's own `consumerName`
 *  ever changes (already the single spelling the settings registry uses). */
function ConsumerBadge({ consumer }: { consumer: { name: string; accent: string } }) {
  return (
    <div
      style={{
        position: "absolute",
        top: 6,
        right: 8,
        fontSize: "8px",
        fontWeight: 700,
        letterSpacing: "0.08em",
        color: consumer.accent,
        opacity: 0.85,
      }}
    >
      {consumer.name.toUpperCase()}
    </div>
  );
}

/**
 * The cycling footer — a depletion bar (drains over `CYCLE_MS`, resets on
 * every slot advance) plus one dot per variant (the active one gold).
 * Renders only when `PreZbomTooltipCard` is given more than one entrypoint
 * key that resolves to a model. Canon: "Cycle in the order the ZBOM
 * presents, so the first thing hovered is the first thing met."
 */
function CycleFooter({
  execs,
  slot,
  cycleProgress,
}: {
  execs: readonly string[];
  slot: number;
  cycleProgress: number;
}) {
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ height: "2px", backgroundColor: "#1a1a1a", overflow: "hidden", borderRadius: "1px" }}>
        <div
          style={{
            height: "100%",
            width: `${Math.max(0, Math.min(1, 1 - cycleProgress)) * 100}%`,
            backgroundColor: "#ceac5f",
            transition: "width 120ms linear",
          }}
        />
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
        <span style={{ fontSize: "9px", color: "#6a6a6a" }}>
          this button offers {execs.length} executions
        </span>
        <span style={{ display: "flex", gap: "3px" }}>
          {execs.map((exec, i) => (
            <span
              key={exec}
              style={{
                width: "5px",
                height: "5px",
                borderRadius: "9999px",
                backgroundColor: i === slot ? "#ceac5f" : "#333",
              }}
            />
          ))}
        </span>
      </div>
    </div>
  );
}

/**
 * A minimal gold `stoa`-styled card for a `coin.*` key the registry itself
 * cannot describe yet — `LOCAL_STOA_SIGNATURES`'s own doc comment names the
 * exact gap (`coin.C_TransferAcross`, confirmed absent from the installed
 * `STOA_SIGNATURES` table). No live preview, no IGNIS — same as every other
 * `stoa`-kind `ModelCard`, just without a `TooltipModel` to read `chainColor`/
 * `slots` from, since `tooltipModel` would throw on this key today. Delete
 * this branch (and its one call site below) once the registry adds the
 * entry upstream and `ModelCard` can render it like everything else.
 *
 * `values` (already-quoted Pact literals — the SAME `modelValues` every
 * registry model receives) resolves through `resolveLocalStoaSlots`, the
 * type-aware fallback that mirrors `tooltipModel`'s own private
 * `offRegistryModel` — a live bug fix: this card used to render ONLY the
 * signature's param NAMES, ignoring any caller-supplied `values` entirely
 * (unlike every registry-backed `ModelCard`), so a launcher's real
 * sender/receiver/target-chain never reached this specific card even when
 * correctly passed in.
 */
function LocalStopgapCard({
  signature,
  values,
  description,
  footer,
}: {
  signature: LocalStoaSignature;
  values?: Record<string, string>;
  description?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const STOA_GOLD = "#ceac5f";
  const slots = resolveLocalStoaSlots(signature, values);
  return (
    <div className="rounded-lg border" style={{ ...previewCardStyle, border: `2px solid ${STOA_GOLD}` }}>
      <ConsumerBadge consumer={CONSUMERS.Codex} />
      <div style={{ ...mono, color: STOA_GOLD, fontWeight: 700 }}>STOA NATIVE</div>
      <div style={{ ...mono, color: STOA_GOLD, marginTop: 4 }}>{signature.exec}</div>
      {description && (
        <div style={{ fontSize: "11px", color: "#9a9a9a", marginTop: 4 }}>{description}</div>
      )}
      {/* rule 3: names and types each on their own row, mirroring ModelCard. */}
      <div style={{ ...mono, color: "#6a6a6a", marginTop: 2 }}>({slots.map((s) => s.name).join(" ")})</div>
      <div style={{ ...mono, color: "#4a4a4a" }}>({slots.map((s) => s.type).join(" ")})</div>
      <div style={{ marginTop: 4 }}>
        {slots.map((slot) => (
          <div key={slot.name} style={{ ...mono, color: slot.isPlaceholder ? "#5a5a4a" : "#9a9a9a" }}>
            <span style={{ color: "#4a4a4a" }}>{String(slot.index).padStart(2, "0")} </span>
            {slot.name} ={" "}
            {slot.isPlaceholder ? (
              <span style={{ fontStyle: "italic" }}>&lt;no live example&gt;</span>
            ) : (
              <span title={slot.value}>{shorten(slot.value)}</span>
            )}
          </div>
        ))}
      </div>
      <div style={{ ...mono, color: "#5a5a5a", marginTop: 8, borderTop: "1px solid #1c1c1c", paddingTop: 6 }}>
        no IGNIS — this is not an Ouronet operation. A StoaChain `coin` call, so nothing prices it.
        Gas is still sponsored.
      </div>
      {footer}
    </div>
  );
}

/**
 * One resolved `TooltipModel`, fully rendered — rules 1 through 6 all show
 * up here. The SAME renderer for every `kind` ("ouronet" | "stoa" |
 * "kadena"): the model already carries `chainColor`/`chainLabel`/`preview`
 * (or its absence), so there is no separate "native card" branch anymore —
 * unifying that was rule 4's own point (treat every kind as a first-class
 * member of one table, not one styled path and two afterthoughts).
 */
function ModelCard({
  m,
  description,
  footer,
}: {
  m: TooltipModel;
  description?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const shouldFireLive = m.shouldRead && !!m.preview;
  const preview = usePreZbomPreview(shouldFireLive ? m.preview!.call : null);
  const { names, types } = signatureRows(m);

  return (
    <div className="rounded-lg border" style={{ ...previewCardStyle, border: `2px solid ${m.chainColor}` }}>
      {m.consumer && <ConsumerBadge consumer={m.consumer} />}
      <div style={{ ...mono, color: m.chainColor, fontWeight: 700 }}>{m.chainLabel}</div>
      {description && (
        <div style={{ fontSize: "11px", color: "#9a9a9a", marginTop: 4 }}>{description}</div>
      )}
      <div style={{ ...mono, color: m.chainColor, marginTop: 4 }}>{m.exec}</div>

      {/* rule 3: names and types each on their own row, never inlined together. */}
      <div style={{ ...mono, color: "#6a6a6a", marginTop: 2 }}>({names.join(" ")})</div>
      <div style={{ ...mono, color: "#4a4a4a" }}>({types.join(" ")})</div>

      {/* rule 1: every EXECUTION parameter, always, in order — never the
          preview's own (often shorter/differently-named) list. */}
      <div style={{ marginTop: 4 }}>
        {m.slots.map((slot) => (
          <div
            key={slot.name}
            style={{
              ...mono,
              color: slot.isPlaceholder || slot.isPreflightFed ? "#5a5a4a" : "#9a9a9a",
            }}
          >
            <span style={{ color: "#4a4a4a" }}>{String(slot.index).padStart(2, "0")} </span>
            {slot.name} ={" "}
            {slot.isPreflightFed ? (
              <span style={{ fontStyle: "italic" }}>
                {slot.note ? `‹${slot.note}›` : "<from a preflight read>"}
              </span>
            ) : slot.isPlaceholder ? (
              <span style={{ fontStyle: "italic" }}>&lt;no live example&gt;</span>
            ) : (
              <span title={slot.value}>{shorten(slot.value)}</span>
            )}
          </div>
        ))}
      </div>

      {/* rule 2: the preview is a SEPARATE list, under its OWN name — never
          merged into the execution's numbered list above, and never
          labelled with the execution's own parameter names. */}
      {m.preview ? (
        <div style={{ marginTop: 8, borderTop: "1px solid #1c1c1c", paddingTop: 6 }}>
          <div style={{ ...mono, color: "#4a7a4a" }}>{m.preview.name}</div>
          <div style={{ fontSize: "10px", color: "#5a5a5a", marginTop: 1 }}>
            ({m.preview.params.join(" ")}) — this preview's own arguments
          </div>
          {!m.shouldRead ? (
            <div style={{ ...mono, color: "#555", marginTop: 3 }}>
              no cost preview — no live example on chain
            </div>
          ) : (
            <>
              {preview.state === "loading" && (
                <div style={{ ...mono, color: "#555", marginTop: 3 }}>reading…</div>
              )}
              {preview.state === "ok" && (
                <>
                  <div
                    style={{
                      fontSize: "11px",
                      color: "#d8d8d8",
                      marginTop: 3,
                      fontStyle: "italic",
                      whiteSpace: "pre-line",
                    }}
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
              {preview.state === "error" && (() => {
                const classified = classifyRefusal(preview.message);
                // Rule 8: a classified refusal reads as an ANSWER (grey,
                // matter-of-fact), never as a broken contract. Red is
                // reserved for the unclassified case only — prettifying
                // every refusal is how a genuinely broken contract call
                // would get hidden. The RAW message is always on `title`
                // (matching `shorten()`'s own "full form stays reachable on
                // hover" convention) — a friendly classification never fully
                // hides a possibly-real wiring bug from inspection, only from
                // the inline, glance-at-a-hover text.
                return classified.classified ? (
                  <div title={classified.raw} style={{ ...mono, color: "#8a8a5a", marginTop: 3, fontStyle: "italic" }}>{classified.display}</div>
                ) : (
                  <div style={{ ...mono, color: "#8b1a1a", marginTop: 3 }}>{classified.display}</div>
                );
              })()}
            </>
          )}
        </div>
      ) : (
        // rule 4: no INFO_ preview exists for stoa/kadena at all — say so,
        // rather than leaving the cost section empty ("an empty panel
        // reads as 'the price failed to load'"). Rule 4's own retraction:
        // a StoaChain native call is STILL gas-station-sponsored (every
        // native modal carries GAS_PAYER); Kadena is a genuinely different
        // chain whose gas this app's gas station never touches.
        <div style={{ ...mono, color: "#5a5a5a", marginTop: 8, borderTop: "1px solid #1c1c1c", paddingTop: 6 }}>
          {m.kind === "kadena"
            ? "no IGNIS — this is Kadena MAINNET, a DIFFERENT CHAIN. Its own gas, its own balances — nothing here is Ouronet-sponsored."
            : "no IGNIS — this is not an Ouronet operation. A StoaChain `coin` call, so nothing prices it. Gas is still sponsored."}
        </div>
      )}

      {m.warnings.length > 0 && (
        <div style={{ fontSize: "9px", color: "#c0392b", marginTop: 4 }}>{m.warnings.join(" · ")}</div>
      )}

      {footer}
    </div>
  );
}

/**
 * One cycle slot for `PreZbomTooltipCard` — either a registry-resolvable
 * `TooltipModel` or this file's own `LOCAL_STOA_SIGNATURES` stopgap for a
 * key the registry can't describe yet. A cycling set (e.g. Kadena's Send
 * button offering same-chain / same-chain-create / cross-chain) can freely
 * mix both kinds — the registry currently covers Kadena's crosschain
 * variant natively but not StoaChain's, so a single button's three variants
 * may be two `"model"` slots and one `"local"` slot, in any order.
 */
type CardSlot =
  | { kind: "model"; model: TooltipModel }
  | { kind: "local"; signature: LocalStoaSignature };

/**
 * The card content — MODULE SCOPE (a component declared inside another
 * component's render body gets a new identity every render, which unmounts
 * and remounts the whole subtree — canon: "a flickering tooltip is usually
 * a remount"). Always rendered when mounted; the caller (`PreZbomHint`)
 * decides the hover/setting/mobile/fail-open gate.
 */
export function PreZbomTooltipCard({
  entrypoint,
  values,
  description,
}: {
  /** One entrypoint, or SEVERAL when the button fronts a runtime choice
   *  (e.g. Send picking `coin.C_Transfer` vs `coin.C_TransferAnew` depending
   *  on whether the receiver account exists — unknowable at hover time).
   *  Given several, the card CYCLES through them one at a time. A bare
   *  string is the common, non-cycling case. */
  entrypoint: string | readonly string[];
  /** Caller-supplied REAL values, keyed by EITHER the execution's OR the
   *  preview's own parameter name (`tooltipModel` merges by name against
   *  BOTH lists at once) — every value here is treated as a Pact STRING
   *  literal; see `toModelValues`'s own doc comment. */
  values?: Record<string, string>;
  /** Descriptive text (e.g. a live-balance-aware caption an existing plain
   *  `ActionTooltip` used to carry) rendered above the technical section. */
  description?: React.ReactNode;
}) {
  // Every entrypoint this button could run, in order. A bare string is the
  // one-element case. Memoized on a joined-string key (not the array/string
  // prop itself, and not `values` — see `usePreZbomPreview`'s own doc
  // comment on why keying an effect on an inline object identity is a
  // re-render loop) so an inline array literal doesn't defeat the memo.
  const keys = useMemo(
    () => (Array.isArray(entrypoint) ? entrypoint : [entrypoint]).filter(Boolean) as readonly string[],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [Array.isArray(entrypoint) ? entrypoint.join(" ") : entrypoint],
  );
  const modelValues = useMemo(
    () => toModelValues(values),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(values ?? {})],
  );
  // Every describable key becomes one cycle slot, in the ORDER the caller
  // gave them — a registry-resolvable key becomes a real `TooltipModel`, a
  // key this file's own `LOCAL_STOA_SIGNATURES` stopgap covers (the
  // registry itself can't describe it yet — currently just
  // `coin.C_TransferAcross`) becomes a stopgap slot, and anything neither
  // side can describe is DROPPED rather than throwing — rule 0's own "fail
  // open" contract, applied per-variant: a button offering three executions
  // should not lose its tooltip because one is stale. A real and a stopgap
  // slot mix freely in the same cycle (this used to be handled by
  // `tooltipModels`, which only ever produced real-model slots, plus a
  // SEPARATE single-key-only branch below for a lone stopgap key — that
  // meant a button offering, say, "same-chain / same-chain-create /
  // cross-chain" for a chain whose crosschain variant is stopgap-only could
  // never show that third variant at all. `PreZbomHint`'s own pre-check
  // already confirmed at least ONE key resolves before this card ever
  // mounts.
  const slots = useMemo<CardSlot[]>(() => {
    const out: CardSlot[] = [];
    for (const k of keys) {
      // `chainOf` THROWS on a genuinely AMBIGUOUS key (declared for both
      // chains) rather than guessing — correct for `tooltipModel`'s own
      // "picking wrong describes a call on the wrong chain" reasoning, but
      // fatal here if left uncaught (mirrors `PreZbomHint`'s own top-level
      // gate, which has the identical guard for the identical reason).
      let chain: string | undefined;
      try {
        chain = chainOf(k);
      } catch {
        chain = undefined;
      }
      if (chain !== undefined) {
        out.push({ kind: "model", model: tooltipModel(k, modelValues, CONSUMERS.Codex) });
      } else if (Object.hasOwn(LOCAL_STOA_SIGNATURES, k)) {
        out.push({ kind: "local", signature: LOCAL_STOA_SIGNATURES[k] });
      }
    }
    return out;
  }, [keys, modelValues]);

  const [slot, setSlot] = useState(0);
  const [cycleProgress, setCycleProgress] = useState(0);
  const cycles = slots.length > 1;

  // NO `open`/`onOpenChange` state of its own: `PreZbomTooltipCard` is only
  // ever rendered by React while Radix's `Tooltip.Content` is actually open
  // (the same lazy-mount assumption the on/off gate's own test relies on).
  // That means this effect's own mount/unmount IS "start cycling on
  // hover"/"stop on leave", and `useState(0)`'s initial value already gives
  // "restart at slot 0 on every fresh hover" for free.
  useEffect(() => {
    if (!cycles) return;
    const STEP = 120;
    let elapsed = 0;
    const t = setInterval(() => {
      elapsed += STEP;
      if (elapsed >= CYCLE_MS) {
        elapsed = 0;
        setSlot((i) => (i + 1) % slots.length);
      }
      setCycleProgress(elapsed / CYCLE_MS);
    }, STEP);
    return () => clearInterval(t);
  }, [cycles, slots.length]);

  if (slots.length === 0) {
    // Defensive only — `PreZbomHint`'s own pre-check should make this
    // unreachable in practice; if it's ever hit, fail open silently rather
    // than rendering a broken/empty card (rule 0).
    return null;
  }

  const active = slots[Math.min(slot, slots.length - 1)];
  const execNames = slots.map((s) => (s.kind === "model" ? s.model.exec : s.signature.exec));
  const footer = cycles ? <CycleFooter execs={execNames} slot={slot} cycleProgress={cycleProgress} /> : null;

  return active.kind === "model"
    ? <ModelCard m={active.model} description={description} footer={footer} />
    : <LocalStopgapCard signature={active.signature} values={modelValues} description={description} footer={footer} />;
}

export interface PreZbomHintProps {
  /** The registered entrypoint key, e.g. `"TS01-C4.PYTHIA|C_Link"`, or a
   *  native `coin.*` key — resolved live against `@ouronet/talos-registry`'s
   *  `tooltipModel` at render time. Given SEVERAL keys, the tooltip cycles
   *  through them (see `PreZbomTooltipCard`'s own doc comment). */
  entrypoint: string | readonly string[];
  /** Caller-supplied REAL values, keyed by EITHER the execution's or the
   *  preview's own parameter name. Optional; falls back to the
   *  entrypoint's own ghost example data, then a type-appropriate
   *  placeholder — both already handled inside `tooltipModel`. */
  values?: Record<string, string>;
  /** Descriptive text (e.g. a live-balance-aware caption) shown above the
   *  technical section — see `PreZbomTooltipCard`'s own doc comment. */
  description?: React.ReactNode;
  children: React.ReactNode;
}

/** Strips a native `title` attribute off the wrapped child, when it has
 *  one — a live-reported bug: the browser's own native title tooltip
 *  appeared ALONGSIDE this component's Radix-rendered card, since every
 *  wrapped button already carries its own `title="Rotate Guard"`-style
 *  attribute. Once `PreZbomHint` provides the richer tooltip, that native
 *  attribute is always redundant for a ZBOM-opening launcher specifically
 *  (which is the only thing this component ever wraps) and the two
 *  tooltips fighting for the same hover is worse than neither. Deliberately
 *  scoped to `PreZbomHint`'s own child, not any of this package's shared
 *  button components — `GoldenBtn`/`VioletBtn`/`GreenBtn` keep their
 *  `title` prop everywhere else they're used outside a `PreZbomHint`. */
function withoutNativeTitle(child: React.ReactNode): React.ReactNode {
  if (!isValidElement(child)) return child;
  const props = child.props as Record<string, unknown>;
  if (!("title" in props) || props.title === undefined) return child;
  return cloneElement(child as ReactElement<{ title?: unknown }>, { title: undefined });
}

/**
 * The hover wrapper — MODULE SCOPE. Renders `children` alone when the
 * "Pre-ZBOM Tooltip" setting is off, on mobile (no hover affordance), OR
 * when NONE of the given `entrypoint` key(s) are Chainweb keys
 * `tooltipModel` can describe (rule 0's own "fail open" contract — an
 * unknown/off-registry key gets NO tooltip, not an empty one). In every
 * case `PreZbomTooltipCard` (and its live-read effect) is never even
 * mounted, so "off means off: no read fires" holds structurally.
 */
export default function PreZbomHint({ entrypoint, values, description, children }: PreZbomHintProps) {
  const { enabled } = usePreZbomTooltipSetting();
  const isMobile = useIsMobile();

  if (!enabled || isMobile) return <>{children}</>;

  const keys = Array.isArray(entrypoint) ? entrypoint : [entrypoint];
  // `chainOf(k) !== undefined` is the real "can tooltipModel describe this
  // key" check — despite its name and its own doc comment's claim,
  // `isOffRegistryKey` returns FALSE for a perfectly valid ouronet key
  // (confirmed live: `isOffRegistryKey("TS01-C4.PYTHIA|C_Link") === false`)
  // and is only true for the hand-transcribed stoa/kadena tables — i.e. it
  // answers "is this off the GENERATED registry", not "is this describable
  // at all". `chainOf`'s own contract ("undefined for a key this model does
  // not describe") is the one that actually matches rule 0's fail-open gate.
  const anyDescribable = keys.some((k) => {
    // A local-stopgap key (see `LOCAL_STOA_SIGNATURES`'s own doc comment) is
    // describable by THIS file even though the registry itself can't yet.
    if (Object.hasOwn(LOCAL_STOA_SIGNATURES, k)) return true;
    // `chainOf` THROWS on a genuinely AMBIGUOUS key (both stoa and kadena
    // claim it) rather than guessing — correct for `tooltipModel`'s own
    // "picking wrong describes a call on the wrong chain" reasoning, but
    // fatal here if left uncaught: "fail open" means this gate must never
    // crash the button it's deciding whether to wrap.
    try {
      return chainOf(k) !== undefined;
    } catch {
      return false;
    }
  });
  if (!anyDescribable) {
    for (const k of keys) warnOffRegistryOnce(k);
    return <>{children}</>;
  }

  return (
    <ActionTooltip
      content={<PreZbomTooltipCard entrypoint={entrypoint} values={values} description={description} />}
      side="bottom"
      unstyled
    >
      <span style={{ display: "inline-block" }}>{withoutNativeTitle(children)}</span>
    </ActionTooltip>
  );
}
