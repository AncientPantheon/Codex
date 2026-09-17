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

/**
 * Which chain a toast belongs to — drives BOTH its confirmation strategy
 * (`.submitted()`) and its display theme (explorer link + accent color,
 * `MultiStepToastContainer.tsx`). Defaults to `'stoachain'` everywhere it's
 * optional, so the 6 existing Kadena/Stoa modals are byte-for-byte unchanged.
 */
export type ToastChain = 'stoachain' | 'arweave';

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
  /** Defaults to `'stoachain'` — see `ToastChain`. */
  chain?: ToastChain;
  /** How long a SETTLED (done/error) toast lingers before auto-dismissing —
   *  the depletion-bar duration. Computed from `chain` at creation time (see
   *  `DISMISS_MS`/`ARWEAVE_DISMISS_MS`) so the safety-net timeout
   *  (`updateStep`, below) and the container's CSS animation always agree. */
  dismissMs?: number;
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
/**
 * 10x `DISMISS_MS` — per explicit request: Arweave blocks land every ~2
 * minutes (targeted; 2-3 min typical in practice), so a settled Arweave
 * toast needs to stay on screen far longer than a near-instant Pact
 * confirmation for its (now-live) explorer link to still be there when the
 * user looks back at it. Also doubles as the arweave poll budget (see
 * `_pollArweaveConfirmation`) — the toast stays visibly "Confirming…" for
 * exactly as long as this session keeps trying to confirm it, then both
 * agree on how long the settled state lingers afterward.
 */
export const ARWEAVE_DISMISS_MS = DISMISS_MS * 10;

function dismissMsFor(chain: ToastChain): number {
  return chain === 'arweave' ? ARWEAVE_DISMISS_MS : DISMISS_MS;
}

export interface ToastController {
  updateStep(step: number, status: StepStatus, data?: { label?: string; requestKey?: string; result?: string }): void;
  dismiss(): void;
  id: string;
}

interface CreateOpts {
  id?: string;
  title?: string;
  steps?: Array<{ label: string; requestKey?: string }>;
  /** Defaults to `'stoachain'` — see `ToastChain`. */
  chain?: ToastChain;
}

export function createMultiStepToast(opts: CreateOpts = {}): ToastController {
  const id = opts.id ?? `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const title = opts.title ?? 'Transaction';
  const steps: StepData[] = (opts.steps ?? [{ label: 'Processing' }])
    .map(s => ({ ...s, status: 'pending' as StepStatus }));

  // First step starts active
  if (steps.length) steps[0].status = 'active';

  const chain = opts.chain ?? 'stoachain';
  toastStore.add({ id, title, steps, createdAt: Date.now(), chain, dismissMs: dismissMsFor(chain) });

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

      // Safety net: auto-remove after this toast's own dismissMs + buffer (in
      // case CSS animation doesn't fire) — chain-specific, not the flat
      // DISMISS_MS, so an arweave toast's 10x-longer window is honored here too.
      if (allDone && !entry.settledAt) {
        setTimeout(() => toastStore.remove(id), (entry.dismissMs ?? DISMISS_MS) + 2000);
      }
    },
    dismiss() {
      toastStore.remove(id);
    },
  };
}

// ── Convenience helpers ─────────────────────────────────────────────────────

/** What an injected {@link ArweavePollFn} reports back per poll attempt. */
export type ArweavePollResult = 'pending' | 'confirmed' | 'give-up';

/** Injected per-send: checks whether `requestKey` (an Arweave tx id) has been
 *  mined yet. Returning `'give-up'` stops polling immediately rather than
 *  spending the full budget (e.g. a structurally-invalid id, such as mock
 *  mode's fixed placeholder, can never become valid no matter how many times
 *  it's retried) — any OTHER thrown error is treated as transient and simply
 *  retried next interval, matching the StoaChain poll's own behavior. */
export type ArweavePollFn = (requestKey: string) => Promise<ArweavePollResult>;

/** Create toast with spinner → call .submitted() after submit → polls for confirmation automatically.
 *  `opts.chain` (defaults to `'stoachain'`) drives both the display theme
 *  (`MultiStepToastContainer.tsx`) and `.submitted()`'s confirmation
 *  strategy — see `ToastChain`. `opts.pollFn` (arweave only) supplies the
 *  actual chain-status check — see `submitted()`'s doc below. */
export function txPending(title: string, opts: { chain?: ToastChain; pollFn?: ArweavePollFn } = {}) {
  const chain = opts.chain ?? 'stoachain';
  let ctrl: ToastController | null = null;
  const ensureStarted = () => {
    if (!ctrl) ctrl = createMultiStepToast({ title, steps: [{ label: 'Processing' }], chain });
    return ctrl;
  };
  return {
    /** Show the toast (call after password entry / key resolution) */
    start() { ensureStarted(); },
    /**
     * TX submitted on-chain. Shows requestKey.
     *
     * `'stoachain'` (default): starts polling for confirmation — unchanged.
     * When confirmed: settledAt set → depletion bar starts (60s).
     *
     * `'arweave'`: Arweave has no Pact-style request-key/`/api/v1/poll`
     * confirmation model — StoaChain's own poll would hit the wrong chain
     * entirely for an Arweave id. When the caller supplies `opts.pollFn`
     * (`SendArweaveModal` wires arweave-core's `getTransactionStatus`
     * against the live gateway pool — the SAME primitive the Library's own
     * upload-confirmation flow already uses), this polls it every 15s for up
     * to `ARWEAVE_DISMISS_MS` (~10 min — Arweave blocks land every ~2 min, so
     * this is real headroom, not a guess) and flips to "Confirmed" the
     * moment the gateway actually reports it mined — mirroring the "pop a
     * real confirmation" contract Pact's poll gives StoaChain toasts for
     * free. Exhausting the budget (or no `pollFn` supplied at all) falls
     * back to "Submitted" — the gateway's 2xx post accept, already true by
     * the time this fires, still means the send itself succeeded; only the
     * on-chain confirmation display is what's uncertain.
     */
    submitted(requestKey: string, chainId?: string) {
      const c = ensureStarted();
      c.updateStep(0, 'active', { label: 'Confirming…', requestKey });
      if (chain === 'arweave') {
        if (opts.pollFn) {
          _pollArweaveConfirmation(c, requestKey, opts.pollFn);
        } else {
          c.updateStep(0, 'done', { label: 'Submitted', requestKey });
        }
        return;
      }
      // Start polling — dynamic import to avoid circular deps
      import('@stoachain/stoa-core/constants').then(({ KADENA_CHAIN_ID: STOACHAIN_CHAIN_ID }) => {
        _pollConfirmation(c, requestKey, chainId ?? STOACHAIN_CHAIN_ID);
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

/** Poll StoaChain /poll endpoint directly (single fetch, no @kadena/client overhead) */
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

/** 15s between polls — appropriate for Arweave's ~2-minute block time (vs.
 *  StoaChain's 5s/near-instant-finality cadence above); attempts sized so the
 *  total budget matches `ARWEAVE_DISMISS_MS` (~10 min) — the toast stays
 *  visibly "Confirming…" for exactly as long as this keeps trying. */
const ARWEAVE_POLL_INTERVAL_MS = 15000;
const ARWEAVE_POLL_ATTEMPTS = Math.ceil(ARWEAVE_DISMISS_MS / ARWEAVE_POLL_INTERVAL_MS);

/** Poll an injected {@link ArweavePollFn} for real on-chain confirmation. */
async function _pollArweaveConfirmation(ctrl: ToastController, requestKey: string, pollFn: ArweavePollFn) {
  for (let i = 0; i < ARWEAVE_POLL_ATTEMPTS; i++) {
    await new Promise(r => setTimeout(r, ARWEAVE_POLL_INTERVAL_MS));
    let result: ArweavePollResult;
    try {
      result = await pollFn(requestKey);
    } catch {
      // A caller's pollFn is documented to swallow its own transient errors
      // into 'pending' — this is defense-in-depth if one doesn't.
      result = 'pending';
    }
    if (result === 'confirmed') {
      ctrl.updateStep(0, 'done', { label: 'Confirmed', requestKey });
      // Post-TX propagation: the SAME generic "something confirmed, refresh"
      // signal the StoaChain poll fires above — lets a consumer (e.g.
      // codex-arweave's `ArweaveAccountsArea`, whose balance refresh
      // otherwise only fires once at BROADCAST time, before the debit is
      // actually final) react to the REAL confirmation even though the send
      // modal that started this poll closed minutes ago.
      _txConfirmListeners.forEach(fn => { try { fn(); } catch { /* best effort */ } });
      return;
    }
    if (result === 'give-up') break;
  }
  // Timeout (or gave up) — mark as done so user can check the explorer
  // themselves; the SEND already succeeded (this only tracks confirmation).
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
