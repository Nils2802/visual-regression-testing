import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '@/lib/db';
import { GET as listRules, POST as createRule } from '@/app/api/projects/[id]/ignore-rules/route';
import { PATCH as patchRule, DELETE as deleteRule } from '@/app/api/ignore-rules/[id]/route';
import { POST as ruleFromEntry } from '@/app/api/log-entries/[id]/ignore-rule/route';

let projectId: string;
let entryId: string;

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const jsonReq = (method: string, body: unknown) =>
  new Request('http://t', { method, body: JSON.stringify(body) });

beforeAll(async () => {
  const project = await prisma.project.create({
    data: {
      name: 'rules-proj',
      viewports: { create: [{ name: 'd', width: 800, height: 600 }] },
      environments: { create: [{ name: 'test', baseUrl: 'http://127.0.0.1:1' }] },
    },
    include: { viewports: true, environments: true },
  });
  projectId = project.id;
  const baseline = await prisma.baseline.create({
    data: {
      projectId,
      name: 'b',
      pagePath: '/',
      sourceType: 'capture',
      targets: { create: [{ viewportId: project.viewports[0].id }] },
    },
    include: { targets: true },
  });
  const run = await prisma.run.create({
    data: { projectId, environmentId: project.environments[0].id, trigger: 'manual' },
  });
  const result = await prisma.runResult.create({
    data: { runId: run.id, baselineId: baseline.id, viewportId: project.viewports[0].id },
  });
  const entry = await prisma.logEntry.create({
    data: {
      resultId: result.id,
      type: 'console-error',
      origin: 'test',
      message: 'analytics blocked (tracker.js?v=1.2)',
    },
  });
  entryId = entry.id;
});

describe('ignore rules CRUD', () => {
  it('creates, lists, patches, deletes', async () => {
    const created = await createRule(
      jsonReq('POST', { reason: 'third-party noise', urlPattern: 'tracker\\.example' }),
      ctx(projectId)
    );
    expect(created.status).toBe(201);
    const rule = await created.json();

    const list = await (await listRules(new Request('http://t'), ctx(projectId))).json();
    expect(list.rules.some((r: { id: string }) => r.id === rule.id)).toBe(true);

    const patched = await patchRule(jsonReq('PATCH', { reason: 'updated' }), ctx(rule.id));
    expect((await patched.json()).reason).toBe('updated');

    expect((await deleteRule(new Request('http://t'), ctx(rule.id))).status).toBe(204);
  });

  it('rejects a rule with no criteria and invalid regex', async () => {
    expect((await createRule(jsonReq('POST', { reason: 'empty' }), ctx(projectId))).status).toBe(400);
    expect(
      (await createRule(jsonReq('POST', { reason: 'bad', messagePattern: '(' }), ctx(projectId))).status
    ).toBe(400);
  });
});

describe('one-click rule from log entry', () => {
  it('creates an escaped rule and flags the source entry', async () => {
    const res = await ruleFromEntry(jsonReq('POST', { reason: 'known noise' }), ctx(entryId));
    expect(res.status).toBe(201);
    const { rule, entry } = await res.json();
    expect(rule.entryType).toBe('console-error');
    expect(rule.messagePattern).toBe('analytics blocked \\(tracker\\.js\\?v=1\\.2\\)');
    expect(new RegExp(rule.messagePattern).test('analytics blocked (tracker.js?v=1.2)')).toBe(true);
    expect(entry.ignored).toBe(true);
    expect(entry.ignoreRuleId).toBe(rule.id);
  });

  it('404s for an unknown entry', async () => {
    expect((await ruleFromEntry(jsonReq('POST', { reason: 'x' }), ctx('nope'))).status).toBe(404);
  });
});
