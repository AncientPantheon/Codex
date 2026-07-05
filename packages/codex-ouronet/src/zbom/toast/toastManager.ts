/**
 * toastManager — cloned verbatim from OuronetUI `src/lib/toast-manager.ts`.
 *
 * Global multi-step transaction toast store + controller factory + the
 * `txPending` helper whose `.submitted(requestKey)` polls the chain for
 * confirmation. The ZBOM modals call `txPending(title)` → `.submitted(rk)`
 * exactly as My Codex does; this REPLACES OuronetUI's
 * transaction-context.setCurrentTransaction callback prop (blueprint §7.2).
 *
 * Data-seam swap (T1): post-tx propagation routes to the package's `tierClock`
 * (visual T4 flash) instead of OuronetUI's `pactQueryCache.triggerPostTx()`.
 */

export type StepStatus = 'pending' | 'active' | 'done' | 'error';

export interface StepData {
  label: string;
  status: StepStatus;
  requestKey?: string;
  result?: string;
}

export interface ToastEntry {
  id: string;
  title: string;
  steps: StepData[];
  createdAt: number;
  settledAt?: number; // set once when all steps done or any error
}

// ── Global state ────────────────────────────────────────────────────────────

let _toasts = new Map<string, ToastEntry>();
let _listeners: Array<() => void> = [];

// TX confirmed event — consumers subscribe to refresh primordials post-tx.
let _txConfirmListeners: Array<() => void> = [];
export function onTxConfirmed(fn: () => void) {
  _txConfirmListeners.push(fn);
  return () => { _txConfirmListeners = _txConfirmListeners.filter(l => l !== fn); };
}
function _notify() {
  _listeners.forEach(fn => fn());
}

export const toastStore = {
  subscribe(fn: () => void) {
    _listeners.push(fn);
    return () => { _listeners = _listeners.filter(l => l !== fn); };
  },

  getAll(): ToastEntry[] {
    return Array.from(_toasts.values());
  },

  get(id: string): ToastEntry | undefined {
    return _toasts.get(id);
  },

  add(entry: ToastEntry) {
    _toasts.set(entry.id, entry);
    _notify();
  },

  update(id: string, patch: Partial<ToastEntry>) {
    const e = _toasts.get(id);
    if (!e) return;
    _toasts.set(id, { ...e, ...patch });
    _notify();
  },

  remove(id: string) {
    if (_toasts.delete(id)) _notify();
  },
};

// ── Controller factory ──────────────────────────────────────────────────────

export const DISMISS_MS = 60000;

export interface ToastController {
  updateStep(step: number, status: StepStatus, data?: { label?: string; requestKey?: string; result?: string }): void;
  dismiss(): void;
  id: string;
}

interface CreateOpts {
  id?: string;
  title?: string;
  steps?: Array<{ label: string; requestKey?: string }>;
}

export function createMultiStepToast(opts: CreateOpts = {}): ToastController {
  const id = opts.id ?? `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const title = opts.title ?? 'Transaction';
  const steps: StepData[] = (opts.steps ?? [{ label: 'Processing' }])
    .map(s => ({ ...s, status: 'pending' as StepStatus }));

  // First step starts active
  if (steps.length) steps[0].status = 'active';

  toastStore.add({ id, title, steps, createdAt: Date.now() });

  return {
    id,
    updateStep(stepIdx, status, data) {
      const entry = toastStore.get(id);
      if (!entry) return;

      const newSteps = entry.steps.map((s, i) => {
        if (i !== stepIdx) return s;
        return {
          ...s,
          status,
          ...(data?.label != null ? { label: data.label } : {}),
          ...(data?.requestKey != null ? { requestKey: data.requestKey } : {}),
          ...(data?.result != null ? { result: data.result } : {}),
        };
      });

      // Auto-activate next pending step when current completes
      if (status === 'done' && stepIdx + 1 < newSteps.length && newSteps[stepIdx + 1].status === 'pending') {
        newSteps[stepIdx + 1] = { ...newSteps[stepIdx + 1], status: 'active' };
      }

      const allDone = newSteps.every(s => s.status === 'done');
      const hasError = newSteps.some(s => s.status === 'error');
      // settledAt: set ONCE
      const settledAt = (allDone || hasError) && !entry.settledAt ? Date.now() : entry.settledAt;

      toastStore.update(id, { steps: newSteps, settledAt });

      // Safety net: auto-remove after DISMISS_MS + buffer (in case CSS animation doesn't fire)
      if (allDone && !entry.settledAt) {
        setTimeout(() => toastStore.remove(id), DISMISS_MS + 2000);
      }
    },
    dismiss() {
      toastStore.remove(id);
    },
  };
}

// ── Convenience helpers ─────────────────────────────────────────────────────

/** Create toast with spinner → call .submitted() after submit → polls for confirmation automatically */
export function txPending(title: string) {
  let ctrl: ToastController | null = null;
  const ensureStarted = () => {
    if (!ctrl) ctrl = createMultiStepToast({ title, steps: [{ label: 'Processing' }] });
    return ctrl;
  };
  return {
    /** Show the toast (call after password entry / key resolution) */
    start() { ensureStarted(); },
    /**
     * TX submitted on-chain. Shows requestKey, starts polling for confirmation.
     * When confirmed: settledAt set → depletion bar starts (60s).
     */
    submitted(requestKey: string, chainId?: string) {
      const c = ensureStarted();
      c.updateStep(0, 'active', { label: 'Confirming…', requestKey });
      // Start polling — dynamic import to avoid circular deps
      import('@stoachain/stoa-core/constants').then(({ KADENA_CHAIN_ID }) => {
        _pollConfirmation(c, requestKey, chainId ?? KADENA_CHAIN_ID);
      });
    },
    /** Manually mark done (skips polling) */
    done(opts?: string | { label?: string; requestKey?: string; result?: string }) {
      const c = ensureStarted();
      if (typeof opts === 'string') {
        c.updateStep(0, 'done', { label: opts });
      } else {
        c.updateStep(0, 'done', { label: opts?.label ?? 'Done', requestKey: opts?.requestKey, result: opts?.result });
      }
    },
    fail(msg?: string) { ensureStarted().updateStep(0, 'error', { label: msg ?? 'Failed' }); },
    dismiss() { if (ctrl) ctrl.dismiss(); },
  };
}

/** Poll Kadena /poll endpoint directly (single fetch, no @kadena/client overhead) */
async function _pollConfirmation(ctrl: ToastController, requestKey: string, chainId: string) {
  const { getPactUrl } = await import('@stoachain/stoa-core/constants');
  const pactUrl = getPactUrl(chainId);
  const pollUrl = `${pactUrl}/api/v1/poll`;
  const body = JSON.stringify({ requestKeys: [requestKey] });

  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 5000)); // 5s intervals, max 200s
    try {
      const res = await fetch(pollUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      if (!res.ok) continue;
      const json = await res.json();
      const txResult = json[requestKey];
      if (!txResult) continue; // not yet mined

      const result = txResult.result;
      if (result?.status === 'failure') {
        ctrl.updateStep(0, 'error', {
          label: 'Failed',
          requestKey,
          result: result?.error?.message ?? 'TX failed on chain',
        });
        return;
      }
      // Success — invalidate all cache tiers to force instant refresh
      const data = result?.data;
      const resultText = typeof data === 'string' ? data : JSON.stringify(data ?? 'confirmed', null, 2);
      ctrl.updateStep(0, 'done', {
        label: 'Confirmed',
        requestKey,
        result: resultText.slice(0, 500),
      });
      // Post-TX propagation: flash the visual T4 tier + notify consumers.
      try {
        const { tierClock } = await import('../debouncer/tierClock.js');
        tierClock.triggerPostTx();
      } catch { /* best effort */ }
      _txConfirmListeners.forEach(fn => { try { fn(); } catch { /* best effort */ } });
      return;
    } catch {
      // network error, retry
    }
  }
  // Timeout — mark as done so user can check explorer
  ctrl.updateStep(0, 'done', { label: 'Submitted', requestKey });
}

/** Instant success toast */
export function txSuccess(title: string, msg?: string) {
  const ctrl = createMultiStepToast({ title, steps: [{ label: 'Processing' }] });
  ctrl.updateStep(0, 'done', { label: msg ?? 'Done' });
  return ctrl;
}

/** Instant error toast */
export function txError(title: string, msg?: string) {
  const ctrl = createMultiStepToast({ title, steps: [{ label: 'Processing' }] });
  ctrl.updateStep(0, 'error', { label: msg ?? 'Failed' });
  return ctrl;
}
