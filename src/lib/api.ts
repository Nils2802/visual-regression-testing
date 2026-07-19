import { z } from 'zod';
import { ApiError } from '@/lib/api-error';

export function jsonError(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}

// Maps ApiError to its status-coded response; rethrows anything else so it
// surfaces as a 500 instead of being silently absorbed into a 4xx catch-all.
export function errorResponse(err: unknown): Response {
  if (err instanceof ApiError) return jsonError(err.status, err.message);
  throw err;
}

export function serializeBaseline<T extends { maskSelectors: string }>(
  baseline: T
): Omit<T, 'maskSelectors'> & { maskSelectors: string[] } {
  return { ...baseline, maskSelectors: JSON.parse(baseline.maskSelectors) as string[] };
}

export function serializeRun<T extends { viewportIds: string }>(
  run: T
): Omit<T, 'viewportIds'> & { viewportIds: string[] } {
  return { ...run, viewportIds: JSON.parse(run.viewportIds) as string[] };
}

// Strips the encrypted figmaToken from every project response, replacing it
// with a boolean so clients can tell whether a token is set without ever
// seeing plaintext or ciphertext.
export function serializeProject<T extends { figmaToken: string | null }>(
  project: T
): Omit<T, 'figmaToken'> & { figmaTokenSet: boolean } {
  const { figmaToken, ...rest } = project;
  return { ...rest, figmaTokenSet: figmaToken !== null };
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
