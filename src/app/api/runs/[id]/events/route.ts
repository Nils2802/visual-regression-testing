import { prisma } from '@/lib/db';
import { jsonError } from '@/lib/api';
import { onRunEvent, type RunEvent } from '@/lib/events';

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await ctx.params;
  const exists = await prisma.run.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return jsonError(404, 'run not found');

  const encoder = new TextEncoder();
  let closed = false;
  let off: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  // Shared by start() and cancel(): unsubscribe from the bus and stop the
  // heartbeat. Must never touch the controller — cancel() runs when the
  // runtime has already torn it down (e.g. client disconnected).
  const cleanup = () => {
    if (off) {
      off();
      off = null;
    }
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: RunEvent | { type: 'status'; status: string; error?: string }) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // Controller already closed/errored out from under us (e.g. the
          // client disconnected between our `closed` check and this call).
          closed = true;
          cleanup();
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        cleanup();
        try {
          controller.close();
        } catch {
          // The runtime may have already closed/cancelled this controller
          // (e.g. client disconnect racing our own terminal-event close).
        }
      };

      off = onRunEvent(id, (event) => {
        send(event);
        if (event.type === 'status' && (event.status === 'done' || event.status === 'failed')) {
          close();
        }
      });
      heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'));
        } catch {
          closed = true;
          cleanup();
        }
      }, 15000);
      req.signal.addEventListener('abort', close);

      // Re-fetch AFTER subscribing (not the pre-stream 404 check above): if the
      // run reached a terminal state between that check and the onRunEvent
      // subscription just above, the terminal emit was missed, but the DB
      // write always happens before the emit (see executeRun), so this fetch
      // still observes it. Snapshot so late subscribers see the current state
      // immediately; if the run is already terminal, replay that and close.
      const run = await prisma.run.findUniqueOrThrow({ where: { id } });
      send({ type: 'status', status: run.status, error: run.error ?? undefined });
      if (run.status === 'done' || run.status === 'failed') close();
    },
    cancel() {
      // Runtime-driven cancellation (e.g. client tab closed): the controller
      // is already gone, so only unsubscribe/clear timers here — calling
      // controller.close() (or enqueue) in this path throws.
      closed = true;
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    },
  });
}
