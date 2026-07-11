import { prisma } from '@/lib/db';
import { jsonError } from '@/lib/api';
import { onRunEvent, type RunEvent } from '@/lib/events';

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await ctx.params;
  const run = await prisma.run.findUnique({ where: { id } });
  if (!run) return jsonError(404, 'run not found');

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (event: RunEvent | { type: 'status'; status: string; error?: string }) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      const close = () => {
        if (closed) return;
        closed = true;
        off();
        clearInterval(heartbeat);
        controller.close();
      };

      const off = onRunEvent(id, (event) => {
        send(event);
        if (event.type === 'status' && (event.status === 'done' || event.status === 'failed')) {
          close();
        }
      });
      const heartbeat = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(': heartbeat\n\n'));
      }, 15000);
      req.signal.addEventListener('abort', close);

      // Snapshot so late subscribers see the current state immediately; if the
      // run is already terminal, replay that and close.
      send({ type: 'status', status: run.status, error: run.error ?? undefined });
      if (run.status === 'done' || run.status === 'failed') close();
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
