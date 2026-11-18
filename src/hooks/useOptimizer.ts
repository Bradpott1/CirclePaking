import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  PackingProblem,
  SearchOptions,
  SearchState,
  WorkerRequest,
  WorkerResponse,
} from '../types/packing';

/**
 * Owns the optimisation worker. The heavy search never touches the main
 * thread, so the interface keeps responding while the packing improves.
 */
export function useOptimizer() {
  const workerRef = useRef<Worker | null>(null);
  const [state, setState] = useState<SearchState | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const worker = new Worker(new URL('../workers/optimizer.worker.ts', import.meta.url), {
      type: 'module',
    });
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.type === 'progress') {
        setState(message.state);
      } else if (message.type === 'done') {
        setState(message.state);
        setRunning(false);
      } else {
        setError(message.message);
        setRunning(false);
      }
    };

    worker.onerror = (event) => {
      setError(event.message || 'The optimisation worker failed.');
      setRunning(false);
    };

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const start = useCallback((problem: PackingProblem, options: SearchOptions) => {
    if (!workerRef.current) return;
    setError(null);
    setState(null);
    setRunning(true);
    const request: WorkerRequest = { type: 'start', problem, options };
    workerRef.current.postMessage(request);
  }, []);

  const stop = useCallback(() => {
    if (!workerRef.current) return;
    const request: WorkerRequest = { type: 'stop' };
    workerRef.current.postMessage(request);
  }, []);

  return { state, running, error, start, stop, setState };
}
