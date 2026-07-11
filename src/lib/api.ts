import { z } from 'zod';

export function jsonError(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}

export async function readJson<S extends z.ZodTypeAny>(
  req: Request,
  schema: S
): Promise<{ ok: true; data: z.infer<S> } | { ok: false; res: Response }> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { ok: false, res: jsonError(400, 'invalid JSON body') };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join('.') || 'body'}: ${i.message}`)
      .join('; ');
    return { ok: false, res: jsonError(400, detail) };
  }
  return { ok: true, data: parsed.data };
}
