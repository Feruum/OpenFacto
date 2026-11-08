const listeners = new Set<() => void>();

/** Advisory in-process notification; SQL and the recovery timer remain authoritative. */
export function requestBusinessWake(): void {
  if (process.env.AI_IMMEDIATE_DISPATCH === '0') return;
  // A subscriber may change registrations; newly added listeners wait for the next signal.
  const currentListeners = [...listeners];
  for (const listener of currentListeners) {
    try { listener(); }
    catch { /* A failed notification must not fail an already committed request. */ }
  }
}

export function subscribeBusinessWake(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Coalesce notifications while preserving one follow-up for work arriving mid-sweep. */
export function createBusinessSweepScheduler(sweep: () => Promise<void>, report: () => void) {
  let started = false, stopped = false, pending = false;
  let current: Promise<void> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let unsubscribe: (() => void) | undefined;
  const wake = () => {
    if (!started || stopped) return;
    pending = true;
    if (current) return;
    // Deferring the first pass also merges a same-turn burst into one sweep.
    current = Promise.resolve().then(async () => {
      while (!stopped && pending) {
        pending = false;
        try { await sweep(); }
        catch {
          try { report(); }
          catch { /* Logging failures cannot wedge scheduling or shutdown. */ }
        }
      }
    }).finally(() => {
      current = undefined;
      if (!stopped && pending) wake();
    });
  };
  const stop = () => {
    stopped = true;
    pending = false;
    clearInterval(timer);
    unsubscribe?.();
    unsubscribe = undefined;
  };
  return {
    start() {
      if (started || stopped) return;
      started = true;
      unsubscribe = subscribeBusinessWake(wake);
      timer = setInterval(wake, 2000);
      wake();
    },
    stop,
    async close() { stop(); await current; },
  };
}
