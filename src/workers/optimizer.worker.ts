/// <reference lib="webworker" />
import { PackingSearch } from '../optimizer/packingOptimizer';
import type { WorkerRequest, WorkerResponse } from '../types/packing';

const scope = self as unknown as DedicatedWorkerGlobalScope;

/** How long one uninterrupted slice of optimisation is allowed to run. */
const SLICE_MS = 40;
/** Minimum delay between two progress messages sent to the UI. */
const REPORT_INTERVAL_MS = 100;

let search: PackingSearch | null = null;
let running = false;
let lastReport = 0;

function post(message: WorkerResponse): void {
  scope.postMessage(message);
}

/**
 * Yield mechanism between slices.
 *
 * `setTimeout(0)` would be the obvious choice, but browsers clamp timers hard
 * once a tab stops being visible -- to around one second -- which silently
 * reduces the search to a crawl whenever the user looks elsewhere. Posting to
 * a MessageChannel queues an ordinary task instead: it is not throttled, and
 * it still returns to the event loop so an incoming 'stop' message is
 * delivered between slices.
 */
const scheduler = new MessageChannel();
scheduler.port1.onmessage = () => {
  if (running) loop();
};

function scheduleNextSlice(): void {
  scheduler.port2.postMessage(null);
}

function loop(): void {
  if (!search) return;

  try {
    search.step(SLICE_MS);
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    search = null;
    running = false;
    return;
  }

  const state = search.state;
  if (search.finished) {
    post({ type: 'done', state });
    search = null;
    running = false;
    return;
  }

  const stamp = performance.now();
  if (stamp - lastReport >= REPORT_INTERVAL_MS) {
    lastReport = stamp;
    post({ type: 'progress', state });
  }

  scheduleNextSlice();
}

scope.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;

  if (request.type === 'start') {
    search = new PackingSearch(request.problem, request.options);
    running = true;
    lastReport = 0;
    post({ type: 'progress', state: search.state });
    loop();
    return;
  }

  if (request.type === 'stop') {
    running = false;
    if (search) {
      search.stop();
      post({ type: 'done', state: search.state });
      search = null;
    }
  }
};
