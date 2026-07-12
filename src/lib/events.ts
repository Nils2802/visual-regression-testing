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
  // EventEmitter.emit is synchronous: without this guard a throwing subscriber
  // would propagate into the emitter (e.g. executeRun) and could corrupt run state.
  const safe = (e: RunEvent) => {
    try {
      listener(e);
    } catch (err) {
      console.error(`run event listener error (${runId}):`, err);
    }
  };
  bus.on(`run:${runId}`, safe);
  return () => bus.off(`run:${runId}`, safe);
}

export function runEventListenerCount(runId: string): number {
  return bus.listenerCount(`run:${runId}`);
}
