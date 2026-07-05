/**
 * ZbomSettingsCard — verbatim clone of OuronetUI's app-settings "ZBOM" subtab
 * (Patron Selection + Zone Expansion + Execute Button Position), rebuilt
 * Redux-free over the package store.
 *
 * Data-layer swap only (markup byte-for-byte with the original):
 *   useAppSelector(s => s.wallet.uiSettings.X) → useCodex().uiSettings.X
 *   dispatch(setUiSettings({...}))             → updateUiSettings({...})
 *   "@/lib/zbomProfiles"                       → "../../zbom/zbomProfiles.js"
 *
 * The zone defaults already live in DEFAULT_UI_SETTINGS, so the reads carry the
 * same `?? fallback` the original used for resilience against partial state.
 */

import { useCallback } from "react";
import { useCodex } from "../../hooks/index.js";
import { useCodexStore } from "../../provider/index.js";
import { detectProfile, getZbomExpansion } from "../../zbom/zbomProfiles.js";
import type { PatronSelectionMode, ZbomProfile } from "../../types/entities.js";

export interface ZbomSettingsCardProps {
  className?: string;
}

export function ZbomSettingsCard({ className }: ZbomSettingsCardProps) {
  const { uiSettings } = useCodex();
  const store = useCodexStore();

  const patronSelectionMode = (uiSettings.patronSelectionMode ?? "wealthiest") as PatronSelectionMode;
  const zbomProfile = (uiSettings.zbomProfile ?? "basic") as ZbomProfile;
  const zbomZone0 = uiSettings.zbomZone0 ?? true;
  const zbomZone1 = uiSettings.zbomZone1 ?? false;
  const zbomZone2 = uiSettings.zbomZone2 ?? false;
  const zbomZone3 = uiSettings.zbomZone3 ?? false;
  const zbomExecutePosition = uiSettings.zbomExecutePosition ?? "top";

  const setUi = useCallback(
    (patch: Record<string, unknown>) => {
      void store.getState().actions.updateUiSettings(patch);
    },
    [store],
  );

  return (
    <div
      className={className}
      // .rounded-xl border p-5 space-y-4 min-h-[200px] — #0a0a0a / #262626.
      style={{
        backgroundColor: "#0a0a0a",
        border: "1px solid #262626",
        borderRadius: 12,
        padding: 20,
        display: "flex",
        flexDirection: "column",
        gap: 16,
        fontFamily: "var(--codex-font, inherit)",
      }}
    >
      <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: "#ceac5f" }}>
        ZBOM
      </h3>

      {/* ── Patron Selection ── */}
      <div className="p-3 rounded-lg border space-y-3" style={{ borderColor: "#262626", backgroundColor: "#111" }}>
        <div>
          <p className="text-sm font-medium" style={{ color: "#d2d3d4" }}>Patron Selection</p>
          <p className="text-xs" style={{ color: "#555" }}>Default patron selection when opening a ZBOM or CFM modal</p>
          <p className="text-[10px] mt-1" style={{ color: "#444" }}>
            If the selected patron has insufficient IGNIS for the operation, the system automatically falls back to the Wealthiest Patron.
            If no patron has enough IGNIS, Zone 1 header turns red. When all patrons have 0 IGNIS, Wealthiest resolves to Codex Prime.
          </p>
        </div>
        <div className="space-y-1.5">
          {([
            { key: "wealthiest", label: "Wealthiest Patron", desc: "Selects the patron with the highest IGNIS balance whose keys are in the codex. Fallback: Codex Prime when all have 0 IGNIS." },
            { key: "prime", label: "Codex Prime", desc: "Always starts with the first account in the codex. Falls back to Wealthiest if insufficient IGNIS." },
            { key: "resident", label: "Resident Account", desc: "Always starts with the currently active resident account. Falls back to Wealthiest if insufficient IGNIS." },
          ] as const).map(({ key, label, desc }) => (
            <button
              key={key}
              onClick={() => setUi({ patronSelectionMode: key })}
              className="w-full flex items-start gap-3 p-2 rounded text-left transition-all"
              style={{
                backgroundColor: patronSelectionMode === key ? "#ceac5f10" : "#0a0a0a",
                border: `1px solid ${patronSelectionMode === key ? "#ceac5f40" : "#1a1a1a"}`,
              }}
            >
              <div className="mt-0.5 flex-shrink-0 w-3 h-3 rounded-full border"
                style={{
                  borderColor: patronSelectionMode === key ? "#ceac5f" : "#333",
                  backgroundColor: patronSelectionMode === key ? "#ceac5f" : "transparent",
                }}
              />
              <div>
                <p className="text-[11px] font-medium" style={{ color: patronSelectionMode === key ? "#ceac5f" : "#d2d3d4" }}>{label}</p>
                <p className="text-[10px]" style={{ color: "#555" }}>{desc}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ── Zone Expansion ── */}
      <div className="p-3 rounded-lg border space-y-3" style={{ borderColor: "#262626", backgroundColor: "#111" }}>
        <div>
          <p className="text-sm font-medium" style={{ color: "#d2d3d4" }}>Zone Expansion</p>
          <p className="text-xs" style={{ color: "#555" }}>Controls which zones are expanded by default</p>
        </div>

        {/* Profile presets */}
        <div className="flex items-center gap-1 rounded-lg border overflow-hidden" style={{ borderColor: "#333" }}>
          {(["simple", "basic", "advanced"] as const).map((p) => (
            <button
              key={p}
              onClick={() => {
                const exp = getZbomExpansion(p);
                setUi({
                  zbomProfile: p,
                  zbomZone0: exp.zone0Info,
                  zbomZone1: exp.zone1Patron,
                  zbomZone2: exp.zone2Inputs,
                  zbomZone3: exp.zone3Signing,
                });
              }}
              className="flex-1 px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-all"
              style={{
                backgroundColor: zbomProfile === p ? "#ceac5f" : "transparent",
                color: zbomProfile === p ? "#0a0a0a" : "#555",
              }}
            >
              {p}
            </button>
          ))}
          {zbomProfile === "custom" && (
            <div className="flex-1 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-center"
              style={{ backgroundColor: "#ceac5f", color: "#0a0a0a" }}>
              Custom
            </div>
          )}
        </div>

        {/* Individual zone toggles */}
        <div className="space-y-1.5">
          {([
            { key: "zbomZone0", label: "Zone 0 — Info", val: zbomZone0 },
            { key: "zbomZone1", label: "Zone 1 — Patron", val: zbomZone1 },
            { key: "zbomZone2", label: "Zone 2 — Inputs", val: zbomZone2 },
            { key: "zbomZone3", label: "Zone 3 — Signing", val: zbomZone3 },
          ] as const).map(({ key, label, val }) => (
            <div key={key} className="flex items-center justify-between py-1 px-2 rounded" style={{ backgroundColor: "#0a0a0a" }}>
              <span className="text-[11px] font-medium" style={{ color: "#d2d3d4" }}>{label}</span>
              <button
                onClick={() => {
                  const newVal = !val;
                  const updated = { [key]: newVal };
                  const z0 = key === "zbomZone0" ? newVal : zbomZone0;
                  const z1 = key === "zbomZone1" ? newVal : zbomZone1;
                  const z2 = key === "zbomZone2" ? newVal : zbomZone2;
                  const z3 = key === "zbomZone3" ? newVal : zbomZone3;
                  setUi({
                    ...updated,
                    zbomProfile: detectProfile(z0, z1, z2, z3),
                  });
                }}
                className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${val ? "bg-yellow-600" : "bg-gray-700"}`}
              >
                <span className={`inline-block h-2.5 w-2.5 transform rounded-full bg-white transition ${val ? "translate-x-3.5" : "translate-x-0.5"}`} />
              </button>
            </div>
          ))}
        </div>

        <div className="text-[10px]" style={{ color: "#444" }}>
          Zone 2: when collapsed, autonomous (system-filled) fields hide but user-input fields stay visible.
        </div>
      </div>

      {/* ── Execute Button Position ── */}
      <div className="p-3 rounded-lg border space-y-3" style={{ borderColor: "#262626", backgroundColor: "#111" }}>
        <div>
          <p className="text-sm font-medium" style={{ color: "#d2d3d4" }}>Execute Button Position</p>
          <p className="text-xs" style={{ color: "#555" }}>Where the Execute button appears in ZBOM/CFM modals</p>
        </div>
        <div className="space-y-1.5">
          {([
            { key: "top" as const, label: "Top", desc: "Execute button appears at the top, just below the header. Faster access without scrolling." },
            { key: "bottom" as const, label: "Bottom", desc: "Execute button appears at the bottom footer. Traditional position." },
          ] as const).map(({ key, label, desc }) => (
            <button
              key={key}
              onClick={() => setUi({ zbomExecutePosition: key })}
              className="w-full flex items-start gap-3 p-2 rounded text-left transition-all"
              style={{
                backgroundColor: zbomExecutePosition === key ? "#ceac5f10" : "#0a0a0a",
                border: `1px solid ${zbomExecutePosition === key ? "#ceac5f40" : "#1a1a1a"}`,
              }}
            >
              <div className="mt-0.5 flex-shrink-0 w-3 h-3 rounded-full border"
                style={{
                  borderColor: zbomExecutePosition === key ? "#ceac5f" : "#333",
                  backgroundColor: zbomExecutePosition === key ? "#ceac5f" : "transparent",
                }}
              />
              <div>
                <p className="text-[11px] font-medium" style={{ color: zbomExecutePosition === key ? "#ceac5f" : "#d2d3d4" }}>{label}</p>
                <p className="text-[10px]" style={{ color: "#555" }}>{desc}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default ZbomSettingsCard;
