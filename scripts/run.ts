import { chromium } from 'playwright';
import { prisma } from '../src/lib/db';
import { executeRun } from '../src/lib/runner';
import { enqueue } from '../src/lib/queue';

async function main() {
  const [projectId] = process.argv.slice(2);
  if (!projectId) {
    console.error('usage: npx tsx scripts/run.ts <projectId>');
    process.exit(1);
  }
  const env = await prisma.environment.findFirstOrThrow({ where: { projectId } });
  const run = await prisma.run.create({
    data: { projectId, environmentId: env.id, type: 'visual', trigger: 'manual' },
  });
  const browser = await chromium.launch();
  await enqueue(() => executeRun(run.id, browser));
  await browser.close();

  const done = await prisma.run.findUniqueOrThrow({
    where: { id: run.id },
    include: { results: { include: { baseline: true, viewport: true, logEntries: true } } },
  });
  console.log(`run ${done.id}: ${done.status}`);
  for (const r of done.results) {
    const logs = r.logEntries.filter((e) => !e.ignored).length;
    console.log(
      `  ${r.baseline.name} @ ${r.viewport.name}: visual=${r.visualStatus} functional=${r.functionalStatus} (${logs} log entries)`
    );
  }
}

main().finally(() => prisma.$disconnect());
