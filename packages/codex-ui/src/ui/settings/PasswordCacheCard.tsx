/**
 * PasswordCacheCard — "how long the codex stays unlocked" setting, surfaced in
 * Codex UI Settings. Reads/writes uiSettings.passwordCacheMinutes (the TTL used
 * by authenticate()/requestPassword()).
 */

import { Clock } from "lucide-react";
import { useCodex } from "../../hooks/useCodex.js";
import { useCodexStore } from "../../provider/index.js";

const PRESETS = [1, 5, 15, 30, 60];

export interface PasswordCacheCardProps {
  className?: string;
}

export function PasswordCacheCard({ className }: PasswordCacheCardProps) {
  const { uiSettings } = useCodex();
  const store = useCodexStore();
  const current = typeof uiSettings.passwordCacheMinutes === "number" ? uiSettings.passwordCacheMinutes : 1;

  const set = (minutes: number) => {
    const clamped = Math.max(1, Math.min(720, Math.round(minutes)));
    void store.getState().actions.updateUiSettings({ passwordCacheMinutes: clamped });
  };

  return (
    <div className={className} style={{ display: "flex", flexDirection: "column", gap: 12, fontFamily: "var(--codex-font, inherit)", color: "#d2d3d4" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Clock style={{ width: 16, height: 16, color: "#ceac5f" }} />
        <span style={{ flex: 1, fontSize: 13, fontWeight: 700 }}>Codex Auto-Lock</span>
        <span style={{ fontSize: 12, fontFamily: "var(--codex-font-mono, monospace)", color: "#ceac5f" }}>
          {current} min
        </span>
      </div>
      <p style={{ margin: 0, fontSize: 11, color: "#888", lineHeight: 1.5 }}>
        How long the codex stays unlocked after you enter your password. After this, you'll be
        prompted again the next time a secret is decrypted.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {PRESETS.map((m) => {
          const active = current === m;
          return (
            <button
              key={m}
              type="button"
              onClick={() => set(m)}
              style={{
                padding: "6px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
                border: `1px solid ${active ? "#ceac5f" : "#262626"}`,
                backgroundColor: active ? "#ceac5f15" : "#111",
                color: active ? "#ceac5f" : "#888",
              }}
            >
              {m} min
            </button>
          );
        })}
        <input
          type="number"
          min={1}
          max={720}
          value={current}
          onChange={(e) => set(Number(e.target.value))}
          aria-label="Custom auto-lock minutes"
          style={{
            width: 80, height: 32, padding: "0 10px", borderRadius: 8,
            backgroundColor: "#111", border: "1px solid #262626", color: "#d2d3d4", fontSize: 12,
          }}
        />
      </div>
    </div>
  );
}

export default PasswordCacheCard;
