export const clamp = (value: number, min: number = 0, max: number = 1): number => Math.min(Math.max(value, min), max);

export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }

    const timer = window.setTimeout(done, ms);

    function done(): void {
      window.clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }

    signal?.addEventListener("abort", done, { once: true });
  });
}