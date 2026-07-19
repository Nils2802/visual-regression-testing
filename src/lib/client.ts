export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method };
  if (body instanceof Uint8Array) {
    init.body = body as BodyInit;
    init.headers = { 'content-type': 'image/png' };
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'content-type': 'application/json' };
  }
  const res = await fetch(url, init);
  if (!res.ok) {
    let message = `request failed (${res.status})`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      /* non-JSON error body — keep default message */
    }
    throw new ApiClientError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ——— types (mirror Phase 2a responses) ———

export interface Environment { id: string; projectId: string; name: string; baseUrl: string }
export interface Viewport { id: string; projectId: string; name: string; width: number; height: number }
export interface BaselineVersion { id: string; targetId: string; imagePath: string; status: string; isActive: boolean; createdAt: string }
export interface BaselineTarget { id: string; baselineId: string; viewportId: string; viewport?: Viewport; versions?: BaselineVersion[] }
export interface BaselineTargetDetail extends BaselineTarget { viewport: Viewport; versions: BaselineVersion[] }
export interface Baseline { id: string; projectId: string; name: string; pagePath: string; elementSelector: string | null; diffThreshold: number | null; maskSelectors: string[]; sourceType: string; syncStatus: string; syncError: string | null; targets?: BaselineTarget[] }
export interface BaselineDetail extends Baseline { targets: BaselineTargetDetail[] }
export interface Project { id: string; name: string; diffThreshold: number; createdAt: string; figmaTokenSet: boolean }
export interface ProjectSummary extends Project { lastRun: { id: string; status: string; createdAt: string } | null; failedResultCount: number }
export interface ProjectDetail extends Project { environments: Environment[]; viewports: Viewport[]; baselines: Baseline[] }
export interface LogEntry { id: string; type: string; origin: string; message: string; url: string | null; httpStatus: number | null; stack: string | null; ignored: boolean; ignoreRuleId: string | null; timestamp: string }
export interface RunResult { id: string; runId: string; baselineId: string; viewportId: string; captureImagePath: string | null; referenceImagePath: string | null; baselineImagePath: string | null; diffImagePath: string | null; visualStatus: string | null; functionalStatus: string | null; diffRatio: number | null; sizeMismatch: boolean; error: string | null; baseline: { id: string; name: string; elementSelector: string | null }; viewport: Viewport; logEntries: LogEntry[] }
export interface Run { id: string; projectId: string; environmentId: string; referenceEnvironmentId: string | null; type: string; trigger: string; status: string; viewportIds: string[]; expectedResultCount: number | null; error: string | null; createdAt: string; startedAt: string | null; finishedAt: string | null }
export interface RunSummary extends Run { environment: { id: string; name: string }; resultCount: number; failedResultCount: number }
export interface RunDetail extends Run { environment: Environment; referenceEnvironment: Environment | null; results: RunResult[] }
export interface PendingVersion extends BaselineVersion { target: { id: string; viewport: Viewport; baseline: { id: string; name: string; project: { id: string; name: string } } } }
export interface IgnoreRule { id: string; projectId: string; entryType: string | null; urlPattern: string | null; messagePattern: string | null; reason: string }

// ——— client ———

export const api = {
  projects: {
    list: () => request<{ projects: ProjectSummary[] }>('GET', '/api/projects'),
    get: (id: string) => request<ProjectDetail>('GET', `/api/projects/${id}`),
    create: (body: { name: string; diffThreshold?: number }) => request<Project>('POST', '/api/projects', body),
    update: (id: string, body: { name?: string; diffThreshold?: number; figmaToken?: string | null }) => request<Project>('PATCH', `/api/projects/${id}`, body),
    delete: (id: string) => request<undefined>('DELETE', `/api/projects/${id}`),
  },
  environments: {
    create: (projectId: string, body: { name: string; baseUrl: string }) => request<Environment>('POST', `/api/projects/${projectId}/environments`, body),
    update: (id: string, body: { name?: string; baseUrl?: string }) => request<Environment>('PATCH', `/api/environments/${id}`, body),
    delete: (id: string) => request<undefined>('DELETE', `/api/environments/${id}`),
  },
  viewports: {
    create: (projectId: string, body: { name: string; width: number; height: number }) => request<Viewport>('POST', `/api/projects/${projectId}/viewports`, body),
    update: (id: string, body: { name?: string; width?: number; height?: number }) => request<Viewport>('PATCH', `/api/viewports/${id}`, body),
    delete: (id: string) => request<undefined>('DELETE', `/api/viewports/${id}`),
  },
  baselines: {
    create: (projectId: string, body: { name: string; pagePath: string; elementSelector?: string; diffThreshold?: number; maskSelectors?: string[]; sourceType: 'upload' | 'capture'; viewportIds?: string[] }) => request<Baseline>('POST', `/api/projects/${projectId}/baselines`, body),
    get: (id: string) => request<BaselineDetail>('GET', `/api/baselines/${id}`),
    update: (id: string, body: Partial<{ name: string; pagePath: string; elementSelector: string | null; diffThreshold: number | null; maskSelectors: string[] }>) => request<Baseline>('PATCH', `/api/baselines/${id}`, body),
    delete: (id: string) => request<undefined>('DELETE', `/api/baselines/${id}`),
    uploadVersion: (baselineId: string, viewportId: string, png: Uint8Array) => request<BaselineVersion>('POST', `/api/baselines/${baselineId}/targets/${viewportId}/versions`, png),
    sync: (id: string) => request<BaselineDetail>('POST', `/api/baselines/${id}/sync`),
  },
  versions: {
    approve: (id: string) => request<BaselineVersion>('POST', `/api/versions/${id}/approve`),
    reject: (id: string) => request<BaselineVersion>('POST', `/api/versions/${id}/reject`),
    pending: () => request<{ versions: PendingVersion[] }>('GET', '/api/pending-versions'),
  },
  results: {
    promote: (id: string) => request<BaselineVersion>('POST', `/api/results/${id}/promote`),
  },
  runs: {
    trigger: (projectId: string, body: { environmentId: string; type?: 'visual' | 'compare'; referenceEnvironmentId?: string; viewportIds?: string[] }) => request<Run>('POST', `/api/projects/${projectId}/runs`, body),
    list: (projectId: string) => request<{ runs: RunSummary[] }>('GET', `/api/projects/${projectId}/runs`),
    get: (id: string) => request<RunDetail>('GET', `/api/runs/${id}`),
  },
  ignoreRules: {
    list: (projectId: string) => request<{ rules: IgnoreRule[] }>('GET', `/api/projects/${projectId}/ignore-rules`),
    create: (projectId: string, body: { reason: string; entryType?: string; urlPattern?: string; messagePattern?: string }) => request<IgnoreRule>('POST', `/api/projects/${projectId}/ignore-rules`, body),
    update: (id: string, body: Partial<{ reason: string; entryType: string | null; urlPattern: string | null; messagePattern: string | null }>) => request<IgnoreRule>('PATCH', `/api/ignore-rules/${id}`, body),
    delete: (id: string) => request<undefined>('DELETE', `/api/ignore-rules/${id}`),
    fromLogEntry: (logEntryId: string, reason: string) => request<{ rule: IgnoreRule; entry: LogEntry }>('POST', `/api/log-entries/${logEntryId}/ignore-rule`, { reason }),
  },
};

export function imageUrl(relPath: string): string {
  return `/api/images/${relPath}`;
}

export function runEventsUrl(runId: string): string {
  return `/api/runs/${runId}/events`;
}
