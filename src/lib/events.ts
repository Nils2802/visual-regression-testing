import { EventEmitter } from 'node:events';

export type RunEvent =
  | { type: 'status'; status: 'running' | 'done' | 'failed'; error?: string }
  | {
      type: 'result';
      resultId: string;
      baselineId: string;
      viewportId: string;
      visualStatus: string | null;
      functionalStatus: string | null;
    };

const bus = new EventEmitter();
bus.setMaxListeners(0); // one listener per open SSE connection

export function emitRunEvent(runId: string, event: RunEvent): void {
  bus.emit(`run:${runId}`, event);
}

export function onRunEvent(runId: string, listener: (e: RunEvent) => void): () => void {
  bus.on(`run:${runId}`, listener);
  return () => bus.off(`run:${runId}`, listener);
}
