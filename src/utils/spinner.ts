// Stub spinner — ora is ESM-only and incompatible with Electron's CommonJS loader.
// Replace with a no-op object that satisfies any call sites.
export interface SpinnerLike {
  start: (text?: string) => SpinnerLike;
  stop: () => SpinnerLike;
  succeed: (text?: string) => SpinnerLike;
  fail: (text?: string) => SpinnerLike;
  text: string;
}

export function createSpinner(text: string): SpinnerLike {
  const spinner: SpinnerLike = {
    text,
    start(t?: string) { if (t) this.text = t; console.log('[...] ' + this.text); return this; },
    stop() { return this; },
    succeed(t?: string) { console.log('[ok] ' + (t || this.text)); return this; },
    fail(t?: string) { console.log('[error] ' + (t || this.text)); return this; },
  };
  return spinner;
}
