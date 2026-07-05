/**
 * GuardTree — recursive renderer for arbitrary Pact guards. Ported 1:1 from
 * OuronetUI's `src/components/settings/GuardTree.tsx`, with two adaptations
 * for package portability:
 *   - Tailwind utility classes are converted to inline styles (the package
 *     can't assume a Tailwind build in the consumer).
 *   - the copy chip uses `navigator.clipboard` directly instead of
 *     copy-to-clipboard + sonner, so the package needs no toast provider for
 *     this transient action. (Toasts are reintroduced holistically when the
 *     action modals — which genuinely need tx feedback — are ported.)
 *
 * Handled guard shapes: keyset, keyset-ref, capability, user. Exact colors,
 * pill palette, indentation, and S-expression layout are preserved.
 */

import { FC } from "react";
import { Copy } from "lucide-react";

const MONO = "var(--codex-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)";

/* ───── Types ───── */

export interface KeysetGuard {
  readonly pred: string;
  readonly keys: readonly string[];
  readonly keysetRef?: string;
}
export interface KeysetRefGuard {
  readonly keysetref: { readonly ns: string; readonly ksn: string };
}
export interface CapabilityGuard {
  readonly cgName: string;
  readonly cgArgs: readonly unknown[];
  readonly cgPactId: string | null;
}
export interface UserGuard {
  readonly fun: string;
  readonly args: readonly unknown[];
}

export type PactGuard = KeysetGuard | KeysetRefGuard | CapabilityGuard | UserGuard;

type GuardKind = "keyset" | "keyset-ref" | "capability" | "user";

/* ───── Detection ───── */

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export const detectGuardKind = (v: unknown): GuardKind | null => {
  if (!isObject(v)) return null;
  if ("cgName" in v && typeof v.cgName === "string") return "capability";
  if ("fun" in v && typeof v.fun === "string" && "args" in v) return "user";
  if ("keysetref" in v && isObject(v.keysetref)) return "keyset-ref";
  if ("pred" in v && typeof v.pred === "string" && "keys" in v && Array.isArray(v.keys)) {
    return "keyset";
  }
  return null;
};

/* ───── Pill palette ───── */

const KIND_COLORS: Record<GuardKind, { bg: string; fg: string }> = {
  keyset: { bg: "#ceac5f20", fg: "#ceac5f" },
  "keyset-ref": { bg: "#3b82f620", fg: "#60a5fa" },
  capability: { bg: "#14b8a620", fg: "#2dd4bf" },
  user: { bg: "#d946ef20", fg: "#e879f9" },
};

const KIND_LABEL: Record<GuardKind, string> = {
  keyset: "keyset",
  "keyset-ref": "keyset-ref",
  capability: "capability-guard",
  user: "user-guard",
};

/* ───── Tiny helpers ───── */

const CopyChip: FC<{ text: string; label?: string }> = ({ text, label = "Copy" }) => (
  <button
    type="button"
    onClick={() => { navigator.clipboard.writeText(text).catch(() => {}); }}
    style={{
      flexShrink: 0,
      padding: 4,
      borderRadius: 4,
      background: "none",
      border: "none",
      color: "#888",
      cursor: "pointer",
    }}
    title={label}
  >
    <Copy size={12} />
  </button>
);

const KindPill: FC<{ kind: GuardKind }> = ({ kind }) => {
  const c = KIND_COLORS[kind];
  return (
    <span
      style={{
        fontSize: 10,
        padding: "2px 6px",
        borderRadius: 9999,
        fontWeight: 500,
        whiteSpace: "nowrap",
        flexShrink: 0,
        backgroundColor: c.bg,
        color: c.fg,
      }}
    >
      {KIND_LABEL[kind]}
    </span>
  );
};

const BracketedList: FC<{ items: readonly unknown[] }> = ({ items }) => (
  <div style={{ display: "flex", flexDirection: "column" }}>
    <span style={{ fontFamily: MONO, fontSize: 14, fontWeight: 700, lineHeight: 1, userSelect: "none", color: "#555" }}>[</span>
    <div style={{ paddingLeft: 16, paddingTop: 2, paddingBottom: 2, display: "flex", flexDirection: "column", gap: 4 }}>
      {items.length === 0 ? (
        <span style={{ fontSize: 11, fontStyle: "italic", color: "#555" }}>(empty)</span>
      ) : (
        items.map((item, i) => (
          <div key={i}>
            <ValueOrGuard value={item} />
          </div>
        ))
      )}
    </div>
    <span style={{ fontFamily: MONO, fontSize: 14, fontWeight: 700, lineHeight: 1, userSelect: "none", color: "#555" }}>]</span>
  </div>
);

const ParenGroup: FC<{
  pill: React.ReactNode;
  head: string;
  headColor: string;
  children?: readonly unknown[];
  copyLabel?: string;
  trailing?: React.ReactNode;
}> = ({ pill, head, headColor, children = [], copyLabel = "Name", trailing }) => {
  const hasChildren = children.length > 0;
  if (!hasChildren) {
    return (
      <div style={{ display: "flex", alignItems: "center", columnGap: 8, rowGap: 4, flexWrap: "wrap" }}>
        {pill}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, minWidth: 0 }}>
          <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 700, userSelect: "none", flexShrink: 0, color: "#555" }}>(</span>
          <code style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, wordBreak: "break-all", color: headColor }}>{head}</code>
          <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 700, userSelect: "none", flexShrink: 0, color: "#555" }}>)</span>
        </span>
        <div style={{ flex: 1, minWidth: 0 }} />
        <CopyChip text={head} label={copyLabel} />
        {trailing}
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", columnGap: 8, rowGap: 4, flexWrap: "wrap" }}>
        {pill}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, minWidth: 0 }}>
          <span style={{ fontFamily: MONO, fontSize: 14, fontWeight: 700, lineHeight: 1, userSelect: "none", flexShrink: 0, color: "#555" }}>(</span>
          <code style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, wordBreak: "break-all", color: headColor }}>{head}</code>
        </span>
        <div style={{ flex: 1, minWidth: 0 }} />
        <CopyChip text={head} label={copyLabel} />
      </div>
      <div style={{ paddingLeft: 24, paddingTop: 2, paddingBottom: 2, display: "flex", flexDirection: "column", gap: 4 }}>
        {children.map((arg, i) => (
          <div key={i}>
            <ValueOrGuard value={arg} />
          </div>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontFamily: MONO, fontSize: 14, fontWeight: 700, lineHeight: 1, userSelect: "none", color: "#555" }}>)</span>
        {trailing}
      </div>
    </div>
  );
};

/* ───── Typed-value leaf ───── */

const isDecimalBox = (v: unknown): v is { decimal: string } =>
  isObject(v) && "decimal" in v && typeof v.decimal === "string" && Object.keys(v).length === 1;

const isIntBox = (v: unknown): v is { int: string } =>
  isObject(v) && "int" in v && typeof v.int === "string" && Object.keys(v).length === 1;

const typeTag = (label: string) => (
  <span style={{ fontSize: 10, marginLeft: 4, color: "#666" }}>: {label}</span>
);

const ValueLeaf: FC<{ value: unknown }> = ({ value }) => {
  if (value === null || value === undefined) {
    return <code style={{ fontSize: 11, color: "#555" }}>null</code>;
  }
  if (typeof value === "string") {
    return (
      <code style={{ fontFamily: MONO, fontSize: 11, wordBreak: "break-all", color: "#d2d3d4" }}>
        {`"${value}"`}{typeTag("string")}
      </code>
    );
  }
  if (typeof value === "number") {
    return (
      <code style={{ fontFamily: MONO, fontSize: 11, color: "#ceac5f" }}>
        {String(value)}{typeTag("number")}
      </code>
    );
  }
  if (typeof value === "boolean") {
    return (
      <code style={{ fontFamily: MONO, fontSize: 11, color: value ? "#4ade80" : "#c0392b" }}>
        {String(value)}{typeTag("bool")}
      </code>
    );
  }
  if (isDecimalBox(value)) {
    return (
      <code style={{ fontFamily: MONO, fontSize: 11, color: "#ceac5f" }}>
        {value.decimal}{typeTag("decimal")}
      </code>
    );
  }
  if (isIntBox(value)) {
    return (
      <code style={{ fontFamily: MONO, fontSize: 11, color: "#ceac5f" }}>
        {value.int}{typeTag("integer")}
      </code>
    );
  }
  if (Array.isArray(value)) {
    return <BracketedList items={value} />;
  }
  return (
    <code style={{ fontFamily: MONO, fontSize: 11, wordBreak: "break-all", color: "#888" }}>
      {JSON.stringify(value)}{typeTag("object")}
    </code>
  );
};

const ValueOrGuard: FC<{ value: unknown }> = ({ value }) => {
  const kind = detectGuardKind(value);
  if (kind !== null) return <GuardTree guard={value} depth={1} />;
  return <ValueLeaf value={value} />;
};

/* ───── Main component ───── */

interface GuardTreeProps {
  readonly guard: unknown;
  readonly depth?: number;
  readonly identifyKeySource?: (key: string) => { label: string; color: string };
}

const MAX_DEPTH = 5;

export const GuardTree: FC<GuardTreeProps> = ({ guard, depth = 0, identifyKeySource }) => {
  if (depth > MAX_DEPTH) {
    return <span style={{ fontSize: 11, fontStyle: "italic", color: "#555" }}>… (max depth reached)</span>;
  }

  const kind = detectGuardKind(guard);
  if (kind === null) {
    if (guard === null || guard === undefined || guard === false) {
      return <span style={{ fontSize: 11, fontStyle: "italic", color: "#555" }}>— (no guard)</span>;
    }
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 9999, fontWeight: 500, backgroundColor: "#26262680", color: "#888" }}>
          unknown guard shape
        </span>
        <code style={{ display: "block", fontFamily: MONO, fontSize: 11, wordBreak: "break-all", color: "#888" }}>
          {JSON.stringify(guard)}
        </code>
      </div>
    );
  }

  /* ── keyset ── */
  if (kind === "keyset") {
    const g = guard as KeysetGuard;
    return (
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <KindPill kind={kind} />
          <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 700, userSelect: "none", color: "#555" }}>(</span>
          <code style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, wordBreak: "break-all", color: KIND_COLORS.keyset.fg }}>{g.pred}</code>
          {g.keys.length === 0 && (
            <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 700, userSelect: "none", color: "#555" }}>)</span>
          )}
          {g.keysetRef && (
            <span style={{ fontSize: 10, fontFamily: MONO, color: "#60a5fa" }}>via ref {g.keysetRef}</span>
          )}
        </div>
        {g.keys.length > 0 && (
          <>
            <div style={{ paddingLeft: 24, paddingTop: 2, paddingBottom: 2, display: "flex", flexDirection: "column", gap: 2 }}>
              {g.keys.map((key, i) => {
                const info = identifyKeySource?.(key);
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <code style={{ fontFamily: MONO, fontSize: 11, wordBreak: "break-all", flex: 1, color: "#c0c0c0" }}>{key}</code>
                    {info?.label && (
                      <span style={{ fontSize: 10, fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0, color: info.color }}>
                        {info.label}
                      </span>
                    )}
                    <CopyChip text={key} label="Key" />
                  </div>
                );
              })}
            </div>
            <span style={{ fontFamily: MONO, fontSize: 14, fontWeight: 700, lineHeight: 1, userSelect: "none", color: "#555" }}>)</span>
          </>
        )}
      </div>
    );
  }

  /* ── keyset-ref ── */
  if (kind === "keyset-ref") {
    const g = guard as KeysetRefGuard;
    const qualified = `${g.keysetref.ns}.${g.keysetref.ksn}`;
    return (
      <ParenGroup pill={<KindPill kind={kind} />} head={qualified} headColor={KIND_COLORS["keyset-ref"].fg} copyLabel="Ref" />
    );
  }

  /* ── capability-guard ── */
  if (kind === "capability") {
    const g = guard as CapabilityGuard;
    const args = Array.isArray(g.cgArgs) ? g.cgArgs : [];
    const hasPactId = g.cgPactId !== null && g.cgPactId !== undefined;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <ParenGroup pill={<KindPill kind={kind} />} head={g.cgName} headColor={KIND_COLORS.capability.fg} copyLabel="Capability" children={args} />
        {hasPactId && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2, paddingLeft: 24 }}>
            <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em", color: "#666" }}>cgPactId</span>
            <code style={{ fontFamily: MONO, fontSize: 11, color: "#d2d3d4" }}>{String(g.cgPactId)}</code>
          </div>
        )}
      </div>
    );
  }

  /* ── user-guard ── */
  if (kind === "user") {
    const g = guard as UserGuard;
    const args = Array.isArray(g.args) ? g.args : [];
    return (
      <ParenGroup pill={<KindPill kind={kind} />} head={g.fun} headColor={KIND_COLORS.user.fg} copyLabel="Function" children={args} />
    );
  }

  return null;
};

export default GuardTree;
