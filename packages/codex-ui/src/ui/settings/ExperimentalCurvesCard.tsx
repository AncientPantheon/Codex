/**
 * ExperimentalCurvesCard — token-styled port of OuronetUI's
 * ExperimentalCurvesCardContent.
 *
 * RETIRED AS A TOGGLE (owner ruling, 2026-09-26): "the Apollo Curve is
 * always on because it represents both Pythia APIs and Codex halves. so
 * its graduated from experimental to in use." Apollo (₱./Π.) is no longer
 * an opt-in primitive — `SpawnAccountModal` already renders it
 * unconditionally alongside DALOS Genesis, regardless of
 * `uiSettings.experimentalCurvesEnabled`. Presenting an "Enable/Disable
 * Experimental Curves" BUTTON here was actively misleading: clicking it
 * flipped a flag nothing reads anymore, implying a control the user does
 * not actually have. This card is now a static status display — no
 * read/write of `experimentalCurvesEnabled`, no click target.
 *
 * The flag itself (`uiSettings.experimentalCurvesEnabled`,
 * `types/entities.ts`) is UNTOUCHED — still declared, still defaulted to
 * `false` — reserved as an inert seam for a genuinely future experimental
 * curve, per the original design. Only THIS PAGE's presentation changes:
 * it must stop implying Apollo is conditional when it is not.
 */

export interface ExperimentalCurvesCardProps {
  className?: string;
}

export function ExperimentalCurvesCard({
  className,
}: ExperimentalCurvesCardProps) {
  return (
    <div
      className={className}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        fontFamily: "var(--codex-font)",
        color: "var(--codex-text)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "8px",
        }}
      >
        <span
          style={{
            fontSize: "12px",
            fontWeight: 500,
            padding: "2px 10px",
            borderRadius: "999px",
            color: "var(--codex-success)",
            border: "1px solid var(--codex-success)",
          }}
        >
          Graduated · Always On
        </span>
      </div>

      <p
        style={{
          fontSize: "10px",
          lineHeight: 1.6,
          color: "var(--codex-text-dim)",
          backgroundColor: "var(--codex-surface)",
          borderRadius: "var(--codex-radius)",
          padding: "8px",
        }}
      >
        The{" "}
        <strong style={{ color: "var(--codex-success)" }}>APOLLO 1024-bit</strong>{" "}
        curve has graduated from experimental to in-use: it represents both{" "}
        <strong style={{ color: "var(--codex-success)" }}>Pythia API keys</strong>{" "}
        and{" "}
        <strong style={{ color: "var(--codex-success)" }}>Codex halves</strong>,
        so it is always available in Spawn Account, able to activate and
        sign unconditionally. There is nothing left to toggle here — no
        experimental curve is currently gated by anything on this page.
      </p>
    </div>
  );
}

export default ExperimentalCurvesCard;
