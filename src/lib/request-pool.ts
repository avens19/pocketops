/** A cancellable FIFO limit shared by dashboard panels. Queued off-screen panels never hit the server. */
export function createRequestPool(limit: number) {
  let running = 0;
  const queue: (() => void)[] = [];
  return function run<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const cancelled = () => { const error = new Error('Request cancelled'); error.name = 'AbortError'; return error; };
      const abort = () => { const i = queue.indexOf(start); if (i >= 0) queue.splice(i, 1); reject(cancelled()); };
      const start = () => {
        signal?.removeEventListener('abort', abort);
        if (signal?.aborted) { reject(cancelled()); queue.shift()?.(); return; }
        running++;
        Promise.resolve().then(work).then(resolve, reject).finally(() => { running--; queue.shift()?.(); });
      };
      if (signal?.aborted) { reject(cancelled()); return; }
      if (running < limit) start();
      else { queue.push(start); signal?.addEventListener('abort', abort, { once: true }); }
    });
  };
}
export const dashboardRequest = createRequestPool(4);
