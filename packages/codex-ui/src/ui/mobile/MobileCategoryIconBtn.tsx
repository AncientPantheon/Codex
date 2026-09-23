/**
 * MobileCategoryIconBtn — a single icon-only category/sub-nav button, mobile.
 *
 * Extracted as a SHARED primitive (docs/work/codex-ui-mobile/design.md §8, the
 * "Blockchain Accounts" cleanup round) because the same icon-only single-line
 * sub-nav shape is now needed in THREE places that can't share a parent
 * component: `OuronetAccountsTab`'s filter row (codex-ouronet), and each
 * foreign-chain panel's own category strip — Arweave's 5 categories
 * (`packages/codex-arweave/src/panel/ArweavePanel.tsx`) and Chainweb's 3
 * (`packages/codex-ouronet/src/ui/chains/ChainwebPanel.tsx`). Those two panels
 * already hand-roll their own icons independently (Arweave avoids
 * `lucide-react` entirely — a documented dual-React-instance bug when
 * imported from that package's location — Chainweb uses real `lucide-react`
 * icons) — this component stays icon-agnostic (`children`, not an `icon`
 * prop tied to one icon library) so BOTH callers can use it without either
 * importing the other's icon source.
 *
 * Visually identical to `OuronetAccountsTab`'s own local
 * `MobileFilterIconBtn` / `CodexSettingsSectionShell`'s own local
 * `MobileSubtabIconBtn` — kept as three near-identical local copies
 * elsewhere (pre-existing convention in this codebase: each mobile branch
 * hand-rolls its own tiny icon-button rather than importing a shared one),
 * this one is the first PROMOTED to a shared export specifically because two
 * of its three callers live in packages that cannot import from each other
 * (codex-arweave and codex-ouronet are peers, not related) — codex-ui is the
 * only common ancestor both already depend on.
 */
import * as React from "react";

export interface MobileCategoryIconBtnProps {
  active: boolean;
  /** Accent colour when active; also tints the border/background. */
  color: string;
  /** Full text a desktop button would show inline — carried via `title`/`aria-label`. */
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}

export function MobileCategoryIconBtn({ active, color, label, onClick, children }: MobileCategoryIconBtnProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        width: 30, height: 30, borderRadius: 8, cursor: "pointer",
        border: `1px solid ${active ? color : "#262626"}`,
        backgroundColor: active ? `${color}1a` : "transparent",
        color: active ? color : "#888",
      }}
    >
      {children}
    </button>
  );
}

export default MobileCategoryIconBtn;
