import type { Browser } from 'playwright';
import { prisma } from './db';
import { emitRunEvent } from './events';
import { capturePage } from './capture';
import { diffImages } from './diff';
import { saveImage, loadImage } from './storage';
import { applyIgnoreRules, functionalStatus, IgnoreRuleInput, JudgedEntry } from './ignore';
import type { CollectedEntry } from './collector';

export async function executeRun(runId: string, browser: Browser): Promise<void> {
  const run = await prisma.run.findUniqueOrThrow({
    where: { id: runId },
    include: {
      project: { include: { viewports: true, ignoreRules: true } },
      environment: true,
    },
  });
  try {
    await prisma.run.update({
      where: { id: runId },
      data: { status: 'running', startedAt: new Date() },
    });
    emitRunEvent(runId, { type: 'status', status: 'running' });

    const referenceEnv = run.referenceEnvironmentId
      ? await prisma.environment.findUniqueOrThrow({ where: { id: run.referenceEnvironmentId } })
      : null;
    if (run.type === 'compare' && !referenceEnv) {
      throw new Error('compare run requires a reference environment');
    }

    const selected: string[] = JSON.parse(run.viewportIds);
    const viewports = run.project.viewports.filter(
      (v) => selected.length === 0 || selected.includes(v.id)
    );
    const baselines = await prisma.baseline.findMany({
      where: { projectId: run.projectId },
      include: { targets: { include: { versions: true } } },
    });
    const rules: IgnoreRuleInput[] = run.project.ignoreRules;

    for (const baseline of baselines) {
      for (const viewport of viewports) {
        const target = baseline.targets.find((t) => t.viewportId === viewport.id);
        if (!target) continue; // baseline restricted to a viewport subset

        const result = await prisma.runResult.create({
          data: { runId, baselineId: baseline.id, viewportId: viewport.id },
        });
        try {
          await processResult(browser, {
            runType: run.type,
            resultId: result.id,
            targetId: target.id,
            url: run.environment.baseUrl + baseline.pagePath,
            referenceUrl: referenceEnv ? referenceEnv.baseUrl + baseline.pagePath : null,
            viewport: { width: viewport.width, height: viewport.height },
            elementSelector: baseline.elementSelector,
            maskSelectors: JSON.parse(baseline.maskSelectors) as string[],
            ratioThreshold: baseline.diffThreshold ?? run.project.diffThreshold,
            activeBaselinePath:
              target.versions.find((v) => v.status === 'approved' && v.isActive)?.imagePath ?? null,
            rules,
          });
        } catch (err) {
          await prisma.runResult.update({
            where: { id: result.id },
            data: { visualStatus: 'fail', error: err instanceof Error ? err.message : String(err) },
          });
        }

        // Progress emission must never affect the run outcome: a failure here
        // (e.g. in the DB re-fetch) is logged, not propagated to the outer catch.
        try {
          const finished = await prisma.runResult.findUniqueOrThrow({ where: { id: result.id } });
          emitRunEvent(runId, {
            type: 'result',
            resultId: finished.id,
            baselineId: finished.baselineId,
            viewportId: finished.viewportId,
            visualStatus: finished.visualStatus,
            functionalStatus: finished.functionalStatus,
          });
        } catch (err) {
          console.error(`run ${runId}: result event emission failed:`, err);
        }
      }
    }

    await prisma.run.update({
      where: { id: runId },
      data: { status: 'done', finishedAt: new Date() },
    });
    emitRunEvent(runId, { type: 'status', status: 'done' });
  } catch (err) {
    await prisma.run.update({
      where: { id: runId },
      data: {
        status: 'failed',
        finishedAt: new Date(),
        error: err instanceof Error ? err.message : String(err),
      },
    });
    emitRunEvent(runId, {
      type: 'status',
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

interface ResultJob {
  runType: string;
  resultId: string;
  targetId: string;
  url: string;
  referenceUrl: string | null;
  viewport: { width: number; height: number };
  elementSelector: string | null;
  maskSelectors: string[];
  ratioThreshold: number;
  activeBaselinePath: string | null;
  rules: IgnoreRuleInput[];
}

async function processResult(browser: Browser, job: ResultJob): Promise<void> {
  const capture = await capturePage(browser, {
    url: job.url,
    viewport: job.viewport,
    elementSelector: job.elementSelector,
    maskSelectors: job.maskSelectors,
  });
  const capturePath = await saveImage('captures', job.resultId, capture.png);

  const judged = applyIgnoreRules(capture.entries, job.rules);
  await persistEntries(job.resultId, judged, 'test');
  const funcStatus = functionalStatus(judged);

  let baselinePng: Buffer | null = null;
  let referencePath: string | null = null;

  if (job.runType === 'compare') {
    if (!job.referenceUrl) {
      // never fall through to visual-run/new-baseline logic for compare runs
      throw new Error('compare run requires a reference environment');
    }
    const reference = await capturePage(browser, {
      url: job.referenceUrl,
      viewport: job.viewport,
      elementSelector: job.elementSelector,
      maskSelectors: job.maskSelectors,
    });
    referencePath = await saveImage('references', job.resultId, reference.png);
    const refJudged: JudgedEntry[] = reference.entries.map((e: CollectedEntry) => ({
      ...e,
      ignored: false,
    }));
    await persistEntries(job.resultId, refJudged, 'reference');
    baselinePng = reference.png;
  } else if (job.activeBaselinePath) {
    baselinePng = await loadImage(job.activeBaselinePath);
  }

  if (!baselinePng) {
    // no approved baseline: capture becomes a pending version, result is 'new'
    const versionPath = await saveImage('baselines', `${job.targetId}-${Date.now()}`, capture.png);
    await prisma.baselineVersion.create({
      data: { targetId: job.targetId, imagePath: versionPath, status: 'pending' },
    });
    await prisma.runResult.update({
      where: { id: job.resultId },
      data: { captureImagePath: capturePath, visualStatus: 'new', functionalStatus: funcStatus },
    });
    return;
  }

  const diff = await diffImages(baselinePng, capture.png);
  const diffPath = await saveImage('diffs', job.resultId, diff.diffPng);
  await prisma.runResult.update({
    where: { id: job.resultId },
    data: {
      captureImagePath: capturePath,
      referenceImagePath: referencePath,
      diffImagePath: diffPath,
      diffRatio: diff.ratio,
      sizeMismatch: diff.sizeMismatch,
      visualStatus: diff.ratio <= job.ratioThreshold ? 'pass' : 'diff',
      functionalStatus: funcStatus,
    },
  });
}

async function persistEntries(
  resultId: string,
  entries: JudgedEntry[],
  origin: 'test' | 'reference'
): Promise<void> {
  if (entries.length === 0) return;
  await prisma.logEntry.createMany({
    data: entries.map((e) => ({
      resultId,
      type: e.type,
      origin,
      message: e.message,
      url: e.url,
      httpStatus: e.httpStatus,
      stack: e.stack,
      ignored: e.ignored,
      ignoreRuleId: e.ignoreRuleId,
      timestamp: e.timestamp,
    })),
  });
}
