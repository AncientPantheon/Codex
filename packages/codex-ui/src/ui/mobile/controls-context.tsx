/**
 * Controls registry — the "always-reachable transaction buttons" system.
 *
 * Ported near-verbatim from OuronetUI's `src/context/controls-context.tsx`
 * (see `docs/work/codex-ui-mobile/design.md` §5 — this is generic,
 * chain-agnostic infrastructure). A button becomes "control-valid" simply by
 * being REGISTERED here; a host chrome (e.g. a bottom tab bar's "Controls
 * [N]" riser) shows the live count and opens `<ControlsDrawer/>`, which lists
 * every registered button, full-width, full-text — reachable even when the
 * in-card button gets ghosted/clipped on a small screen.
 *
 * Unlike OuronetUI's copy, this one carries NO `CodexUiRoot`/`useIsMobile`
 * coupling: `ControlsDrawer` renders `position: absolute; inset: 0` and
 * relies on the HOST wrapping it in a `position: relative` container
 * (`CodexUiRoot` already is one — see `CodexUiRoot.tsx` — but a host
 * embedding CodexUI, e.g. a mock outer shell in a playground app, can just as
 * well own that positioning context itself). This keeps the registry usable
 * both INSIDE a single `CodexUiRoot` and OUTSIDE it (registered from anywhere
 * in a host's tree, as long as a `<ControlsProvider>` sits above).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export interface ControlItem {
  id: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** Text shown instead of the label while disabled (e.g. "Codex Locked"). */
  disabledText?: string;
  /** Exact styling so the Controls button matches its in-card twin (already
   *  reflecting its enabled/disabled state — the drawer applies these
   *  verbatim, no extra dimming). */
  gradient?: string;
  color?: string;
  border?: string;
  opacity?: number;
  /** "notimpl" renders the grey/outline unavailable look regardless of gradient. */
  kind?: "gradient" | "outline" | "notimpl";
}

export interface ControlGroup {
  source: string;
  title: string;
  order: number;
  items: ControlItem[];
}

interface ControlsCtx {
  groups: ControlGroup[];
  count: number;
  register: (source: string, title: string, items: ControlItem[], order?: number) => void;
  unregister: (source: string) => void;
  open: boolean;
  setOpen: (o: boolean) => void;
}

const Ctx = createContext<ControlsCtx | null>(null);

const sigOf = (title: string, items: ControlItem[]) =>
  title + "::" + items.map((i) => `${i.id}|${i.label}|${i.disabled ? 1 : 0}|${i.kind ?? ""}|${i.disabledText ?? ""}`).join(",");

export function ControlsProvider({ children }: { children: ReactNode }) {
  const [map, setMap] = useState<Record<string, ControlGroup>>({});
  const [open, setOpen] = useState(false);

  const register = useCallback((source: string, title: string, items: ControlItem[], order = 0) => {
    setMap((prev) => {
      const existing = prev[source];
      if (existing && sigOf(existing.title, existing.items) === sigOf(title, items)) {
        // Same shape — keep the latest closures but don't trigger a re-render storm.
        existing.items = items;
        existing.title = title;
        existing.order = order;
        return prev;
      }
      return { ...prev, [source]: { source, title, order, items } };
    });
  }, []);

  const unregister = useCallback((source: string) => {
    setMap((prev) => {
      if (!prev[source]) return prev;
      const next = { ...prev };
      delete next[source];
      return next;
    });
  }, []);

  const groups = useMemo(
    () => Object.values(map).filter((g) => g.items.length > 0).sort((a, b) => a.order - b.order),
    [map],
  );
  const count = useMemo(() => groups.reduce((s, g) => s + g.items.length, 0), [groups]);

  const value = useMemo(
    () => ({ groups, count, register, unregister, open, setOpen }),
    [groups, count, register, unregister, open],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useControls(): ControlsCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useControls must be used within a ControlsProvider");
  return c;
}

/**
 * Same as `useControls()`, but returns `null` instead of throwing when there
 * is no `<ControlsProvider>` ancestor — for a component that is SOMETIMES
 * mounted without one (e.g. `ObservationalCodexIdDisplay`, which real
 * production OuronetUI mounts today with no `ControlsProvider` anywhere
 * around it) and needs to degrade gracefully: ghost a button into Controls
 * ONLY where Controls actually exists to carry it, and keep the ORIGINAL
 * inline rendering everywhere else, rather than silently making a button
 * unreachable. Mirrors `useIsMobile()`'s own "safe default with no
 * ancestor" precedent (`MobileContext.tsx`).
 */
export function useControlsOptional(): ControlsCtx | null {
  return useContext(Ctx);
}

/**
 * Register a surface's control-valid buttons while `active`. Rebuild `items`
 * freely each render; the registry dedupes by signature so only real changes
 * re-render. Unregisters on inactive/unmount. Throws if there's no
 * `<ControlsProvider>` ancestor — for a caller that KNOWS it's always
 * mounted inside one. See `useRegisterControlsOptional` for a caller that
 * isn't sure.
 */
export function useRegisterControls(source: string, title: string, active: boolean, items: ControlItem[], order = 0) {
  const { register, unregister } = useControls();
  const sig = sigOf(title, items);
  useEffect(() => {
    if (active && items.length > 0) register(source, title, items, order);
    else unregister(source);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, active, sig, order]);
  useEffect(() => () => unregister(source), [source, unregister]);
}

/**
 * Same as `useRegisterControls`, but a no-op (never throws) when there's no
 * `<ControlsProvider>` ancestor. Returns whether a Provider was actually
 * found — `true` means the caller may safely ghost its own inline rendering
 * of these items (Controls will carry them); `false` means there's nowhere
 * for them to go, so the caller should keep rendering them inline.
 */
export function useRegisterControlsOptional(
  source: string,
  title: string,
  active: boolean,
  items: ControlItem[],
  order = 0,
): boolean {
  const ctx = useControlsOptional();
  // Destructure `register`/`unregister` OUT of `ctx` immediately, and depend
  // on THOSE (not on `ctx` itself) below — exactly like `useRegisterControls`
  // does. `ctx` (the wrapping object `ControlsProvider` hands out) gets a
  // NEW reference on every registry change, including ones a registration
  // effect ITSELF causes; `register`/`unregister` are individually stable
  // (`useCallback(..., [])` inside `ControlsProvider`, never change
  // reference). Depending on `ctx` directly here previously caused a real
  // infinite loop: register → new `ctx` reference → effect re-fires →
  // cleanup unregisters → new `ctx` reference → effect re-fires → register
  // again → forever, verified by a hung test run.
  const register = ctx?.register;
  const unregister = ctx?.unregister;
  const sig = sigOf(title, items);
  useEffect(() => {
    if (!register || !unregister) return;
    if (active && items.length > 0) register(source, title, items, order);
    else unregister(source);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [register, unregister, source, active, sig, order]);
  useEffect(() => {
    if (!unregister) return;
    return () => unregister(source);
  }, [unregister, source]);
  return ctx !== null;
}
